// Audio engine: lives in a hidden BrowserWindow for the whole app session, so audio keeps
// playing when the main window is closed. Owns the AudioContext, the worklet player, device
// routing and navigator.mediaSession. Decoded PCM arrives from the decoder utilityProcess.
import { EQ_FREQS, EQ_Q, bandType, type EqSettings } from '@shared/eq'
import { gainFromSlider, initialPlayback, type PlaybackCommand, type PlaybackState, type TrackInfo, type TrackRef } from '@shared/playback'

interface Stream {
  id: number
  index: number
  startSec: number
  info?: TrackInfo
  ended: boolean
  outstanding: number // frames forwarded to the worklet, not yet consumed
}

const PREFETCH_SECONDS = 15 // pre-decode the next track this long before the end (gapless)
const bridge = window.flaconEngine!

let ctx: AudioContext
let node: AudioWorkletNode
let decoder: MessagePort | null = null
const pendingDecoderMsgs: unknown[] = []

let state: PlaybackState = { ...initialPlayback }
let queue: TrackRef[] = []
let index = 0
let seq = 0
let want = 0 // newest user-requested stream
let current: Stream | null = null // stream the worklet is audibly playing
const streams = new Map<number, Stream>()
const order: Stream[] = [] // write order, for crediting consumed frames to the right stream
let lastConsumed = -1
let sinkId = ''
let pushTimer = 0
let wantPlaying = false

const silent = document.createElement('audio') // keeps the OS media session active (media keys)

function push(patch: Partial<PlaybackState> = {}): void {
  state = { ...state, ...patch }
  if (pushTimer) return
  pushTimer = window.setTimeout(() => {
    pushTimer = 0
    bridge.emitState(state)
  }, 100) // ≤10 Hz
}

function toDecoder(msg: unknown): void {
  if (decoder) decoder.postMessage(msg)
  else pendingDecoderMsgs.push(msg)
}

function closeAll(): void {
  for (const s of streams.values()) toDecoder({ type: 'close', id: s.id })
  streams.clear()
  order.length = 0
  current = null
  lastConsumed = -1 // resync credit accounting after the worklet flush
}

function openStream(i: number, startSec: number): Stream {
  const s: Stream = { id: ++seq, index: i, startSec, ended: false, outstanding: 0 }
  streams.set(s.id, s)
  toDecoder({ type: 'open', id: s.id, path: queue[i]!.path, startSec, sampleRate: ctx.sampleRate, first: true })
  return s
}

function startTrack(i: number, startSec = 0): void {
  if (i < 0 || i >= queue.length) return
  index = i
  closeAll()
  node.port.postMessage({ type: 'flush' })
  const s = openStream(i, startSec)
  want = s.id
  push({ status: wantPlaying ? 'loading' : state.status, queueIndex: i, queueLength: queue.length, positionSec: startSec, error: null })
}

async function play(): Promise<void> {
  wantPlaying = true
  if (ctx.state !== 'running') await ctx.resume() // auto-resume when the OS suspended the context
  node.port.postMessage({ type: 'play' })
  void silent.play().catch(() => undefined)
  push({ status: current ? 'playing' : 'loading' })
  syncMediaSession()
}

function pause(): void {
  wantPlaying = false
  node.port.postMessage({ type: 'pause' })
  silent.pause()
  push({ status: 'paused' })
  navigator.mediaSession.playbackState = 'paused'
}

function skipBad(s: Stream, message: string): void {
  // Corrupt/unsupported/DRM: skip with a toast, never wedge the queue.
  const name = queue[s.index]?.path.split(/[\\/]/).pop() ?? 'track'
  push({ toast: `Skipped “${name}”: ${message}`, error: message })
  streams.delete(s.id)
  if (s.id === want || s === current) {
    if (index + 1 < queue.length) startTrack(index + 1)
    else {
      closeAll()
      node.port.postMessage({ type: 'flush' })
      wantPlaying = false
      push({ status: 'error' })
    }
  }
}

function onDecoder(m: { type: string; id: number; [k: string]: unknown }): void {
  const s = streams.get(m.id)
  if (!s) return // stale (seek/skip raced it)
  switch (m.type) {
    case 'info':
      s.info = m.info as TrackInfo
      if (s.id === want) push({ track: s.info })
      break
    case 'chunk': {
      const frames = m.frames as number
      s.outstanding += frames
      order.push(s)
      node.port.postMessage({ type: 'chunk', trackId: s.id, data: m.data, frames, first: m.first, startSec: s.startSec }, [m.data as ArrayBuffer])
      break
    }
    case 'end':
      s.ended = true
      if (!s.info) skipBad(s, 'This file has no playable audio.') // zero-length
      break
    case 'error':
      skipBad(s, String(m.message))
      break
  }
}

function onWorklet(m: Record<string, unknown>): void {
  switch (m['type']) {
    case 'track-started': {
      const s = streams.get(m['trackId'] as number)
      if (!s) break
      current = s
      index = s.index
      if (s.id !== want) want = s.id // gapless hand-over to the prefetched track
      push({ track: s.info ?? state.track, queueIndex: s.index, status: wantPlaying ? 'playing' : state.status })
      syncMediaSession()
      break
    }
    case 'position': {
      const consumed = m['consumed'] as number
      if (lastConsumed < 0) lastConsumed = consumed
      creditConsumed(consumed - lastConsumed)
      lastConsumed = consumed
      const latency = (ctx.outputLatency || ctx.baseLatency || 0) // Bluetooth: keep UI time in sync with what is heard
      if (current) push({ positionSec: Math.max(0, (m['seconds'] as number) - latency), outputLatencySec: latency })
      maybePrefetch()
      maybeAdvance(m['buffered'] as number)
      break
    }
    case 'underrun':
      break
  }
}

function creditConsumed(frames: number): void {
  while (frames > 0 && order.length) {
    const s = order[0]!
    const n = Math.min(frames, s.outstanding)
    s.outstanding -= n
    frames -= n
    toDecoder({ type: 'credit', id: s.id, frames: n })
    if (s.outstanding === 0) order.shift()
    else break
  }
}

function maybePrefetch(): void {
  const cur = current
  if (!cur?.info || index + 1 >= queue.length) return
  if ([...streams.values()].some((s) => s.index === index + 1)) return
  if (cur.info.durationSec - state.positionSec <= PREFETCH_SECONDS) openStream(index + 1, 0)
}

function maybeAdvance(buffered: number): void {
  // Current track fully decoded and the ring ran dry, with nothing queued behind it → end of queue.
  if (!current || !current.ended || buffered > 0.02) return
  if ([...streams.values()].some((s) => s !== current)) return
  wantPlaying = false
  node.port.postMessage({ type: 'pause' })
  silent.pause()
  closeAll()
  push({ status: 'idle', positionSec: 0 })
}

function syncMediaSession(): void {
  const t = state.track
  if ('mediaSession' in navigator && t) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'Flacon' })
    navigator.mediaSession.playbackState = wantPlaying ? 'playing' : 'paused'
  }
}

// EQ chain: worklet → 10 biquads → preamp → limiter → destination. Params glide (20 ms) so moving a
// band never clicks. Disabled = every stage at unity (limiter ratio 1), so the signal is untouched.
let bands: BiquadFilterNode[] = []
let preamp: GainNode
let limiter: DynamicsCompressorNode

function buildChain(): void {
  bands = EQ_FREQS.map((f, i) => {
    const b = new BiquadFilterNode(ctx, { type: bandType(i), frequency: f, Q: EQ_Q, gain: 0 })
    return b
  })
  preamp = new GainNode(ctx, { gain: 1 })
  limiter = new DynamicsCompressorNode(ctx, { threshold: 0, knee: 0, ratio: 1, attack: 0.002, release: 0.1 })
  let prev: AudioNode = node
  for (const b of bands) {
    prev.connect(b)
    prev = b
  }
  prev.connect(preamp)
  preamp.connect(limiter)
  limiter.connect(ctx.destination)
}

function applyEq(eq: EqSettings): void {
  const t = ctx.currentTime
  bands.forEach((b, i) => b.gain.setTargetAtTime(eq.enabled ? eq.gains[i]! : 0, t, 0.02))
  preamp.gain.setTargetAtTime(eq.enabled ? 10 ** (eq.preamp / 20) : 1, t, 0.02)
  // Brick-wall-ish safety limiter only while EQ is active; boosts can't clip the output.
  limiter.threshold.setTargetAtTime(eq.enabled ? -1 : 0, t, 0.02)
  limiter.ratio.setTargetAtTime(eq.enabled ? 20 : 1, t, 0.02)
  push({ eq })
}

function setVolume(slider: number): void {
  node.port.postMessage({ type: 'gain', value: gainFromSlider(slider) })
  push({ volume: slider })
}

async function setOutput(deviceId: string): Promise<void> {
  try {
    await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId)
    sinkId = deviceId
  } catch {
    push({ toast: 'That output device is not available.' })
  }
}

async function onDeviceChange(): Promise<void> {
  if (!sinkId) return
  const devices = await navigator.mediaDevices.enumerateDevices()
  if (!devices.some((d) => d.kind === 'audiooutput' && d.deviceId === sinkId)) {
    // Active device vanished: pause, tell the user, fall back to system default.
    pause()
    await setOutput('')
    push({ toast: 'Output device disconnected. Playback paused on the system default.' })
  }
}

function handle(c: PlaybackCommand | { type: 'resume-context' }): void {
  switch (c.type) {
    case 'load':
      queue = c.tracks
      wantPlaying = !c.paused
      startTrack(Math.min(c.index, queue.length - 1), c.startSec ?? 0)
      if (c.paused) push({ status: 'paused' }) // session restore: ready at the saved spot, silent until the user presses play
      else void play()
      break
    case 'play': void play(); break
    case 'pause': pause(); break
    case 'toggle': state.status === 'playing' || (wantPlaying && state.status === 'loading') ? pause() : void play(); break
    case 'next': if (index + 1 < queue.length) startTrack(index + 1); break
    case 'prev': startTrack(state.positionSec > 3 || index === 0 ? index : index - 1); break
    case 'seek': startTrack(index, c.seconds); break // new decode from the target; ring flushed with a 10 ms fade
    case 'volume': setVolume(c.slider); break
    case 'eq': applyEq(c.eq); break
    case 'output': void setOutput(c.deviceId); break
    case 'resume-context': void ctx.resume(); break
  }
}

/** One second of silence as a WAV blob: a looping <audio> lets Chromium register a media session. */
function silentWavUrl(): string {
  const rate = 8000, n = rate
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string): void => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

async function boot(): Promise<void> {
  ctx = new AudioContext({ latencyHint: 'playback' })
  await ctx.audioWorklet.addModule('./player-worklet.js')
  node = new AudioWorkletNode(ctx, 'flacon-player', { numberOfInputs: 0, outputChannelCount: [2] })
  buildChain()
  node.port.onmessage = (e) => onWorklet(e.data as Record<string, unknown>)
  setVolume(state.volume)

  silent.src = silentWavUrl()
  silent.loop = true
  silent.volume = 0.001
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => void play())
  ms.setActionHandler('pause', () => pause())
  ms.setActionHandler('nexttrack', () => handle({ type: 'next' }))
  ms.setActionHandler('previoustrack', () => handle({ type: 'prev' }))
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && handle({ type: 'seek', seconds: d.seekTime }))

  navigator.mediaDevices.addEventListener('devicechange', () => void onDeviceChange())
  ctx.addEventListener('statechange', () => {
    // The OS may suspend the context (sleep, device change). Resume if we should be playing.
    if (ctx.state === 'suspended' && wantPlaying) void ctx.resume()
  })
  booted = true
  push({ outputRate: ctx.sampleRate, queueLength: 0 })
  early.splice(0).forEach(handle) // commands that arrived while the worklet module was loading
}

window.addEventListener('message', (ev) => {
  if (ev.data !== 'flacon-decoder-port' || !ev.ports[0]) return
  decoder = ev.ports[0]
  decoder.onmessage = (e) => onDecoder(e.data)
  pendingDecoderMsgs.splice(0).forEach((m) => decoder!.postMessage(m))
})

// Listen immediately: main may send `load` (file association launch) before boot() finishes.
const early: Array<PlaybackCommand | { type: 'resume-context' }> = []
let booted = false
bridge.onCommand((c) => (booted ? handle(c) : early.push(c)))
void boot()
