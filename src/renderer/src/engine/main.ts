// Audio engine: lives in a hidden BrowserWindow for the whole app session, so audio keeps
// playing when the main window is closed. Owns the AudioContext, the worklet player, device
// routing and navigator.mediaSession. Decoded PCM arrives from the decoder utilityProcess.
import { barRanges, foldBars } from '@shared/spectrum'
import { EQ_FREQS, EQ_Q, bandType, type EqSettings } from '@shared/eq'
import { gainFromSlider, initialPlayback, type PlaybackCommand, type PlaybackState, type TrackInfo, type TrackRef } from '@shared/playback'
import { insertAt, moveItem, nextIndex, removeAt, shuffleAfter, shuffled, type RepeatMode } from '@shared/queue'
import { replayGainFactor, type ReplayGainMode } from '@shared/replayGain'

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
let original: TrackRef[] = [] // unshuffled order, only meaningful while shuffle is on
let shuffleOn = false
let repeat: RepeatMode = 'off'
let rgMode: ReplayGainMode = 'off'
let rgFactor = 1 // ReplayGain factor of the track the worklet is playing
let badRun = 0 // consecutive unplayable tracks (stops repeat-all from looping forever on a dead queue)
let queueRev = 0
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
  const ref = queue[i]!
  // CUE slice: decode the real file from slice start (+ any seek into it) and stop at the slice end; position/duration stay slice-relative.
  const base = ref.cue?.startSec ?? 0
  const durationSec = ref.cue ? Math.max(0.001, ref.cue.endSec - base - startSec) : undefined
  toDecoder({ type: 'open', id: s.id, path: ref.file ?? ref.path, startSec: base + startSec, durationSec, sampleRate: ctx.sampleRate, first: true })
  return s
}

function startTrack(i: number, startSec = 0): void {
  if (i < 0 || i >= queue.length) return
  index = i
  closeAll()
  node.port.postMessage({ type: 'flush' })
  applyReplayGain(queue[i]!)
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
  badRun++
  if (s.id === want || s === current) {
    const ni = nextIndex(index, queue.length, repeat === 'one' ? 'off' : repeat)
    if (ni !== null && badRun < queue.length) startTrack(ni)
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
    case 'info': {
      const raw = m.info as TrackInfo
      const ref = queue[s.index]
      s.info = { ...raw, path: ref?.path ?? raw.path, title: ref?.title ?? raw.title, durationSec: ref?.cue ? Math.max(0, ref.cue.endSec - ref.cue.startSec) : raw.durationSec }
    }
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
      badRun = 0
      applyReplayGain(queue[s.index])
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
    case 'overlap': {
      // Crossfaded frames were blended into the previous track's buffer: they will never be "consumed" on their own.
      const s = streams.get(m['trackId'] as number)
      const n = m['frames'] as number
      if (s) {
        s.outstanding = Math.max(0, s.outstanding - n)
        toDecoder({ type: 'credit', id: s.id, frames: n })
      }
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
  if (!cur?.info) return
  const ni = nextIndex(index, queue.length, repeat)
  if (ni === null) return
  if ([...streams.values()].some((s) => s !== cur && s.index === ni)) return
  if (cur.info.durationSec - state.positionSec <= PREFETCH_SECONDS) openStream(ni, 0)
}

function maybeAdvance(buffered: number): void {
  // Current track fully decoded and the ring ran dry, with nothing queued behind it → end of queue.
  if (!current || !current.ended || buffered > 0.02) return
  if ([...streams.values()].some((s) => s !== current)) return
  if (repeat === 'one') { startTrack(index); return } // gapless restart when the prefetch could not cover it
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
let analyser: AnalyserNode
let vizTimer = 0

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
  // Side tap for the visualizer: reads the final signal, adds nothing to it.
  analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.6, minDecibels: -80, maxDecibels: -10 })
  limiter.connect(analyser)
}

function setViz(on: boolean): void {
  window.clearInterval(vizTimer)
  vizTimer = 0
  if (!on) return
  const bytes = new Uint8Array(analyser.frequencyBinCount)
  const ranges = barRanges(ctx.sampleRate, analyser.fftSize)
  let wasPlaying = true
  vizTimer = window.setInterval(() => {
    const playing = state.status === 'playing'
    if (!playing && !wasPlaying) return // paused: one frame of silence was sent, nothing more
    wasPlaying = playing
    if (playing) analyser.getByteFrequencyData(bytes)
    else bytes.fill(0)
    bridge.emitViz(foldBars(bytes, ranges))
  }, 33)
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

function sendGain(): void {
  node.port.postMessage({ type: 'gain', value: gainFromSlider(state.volume) * rgFactor })
}

function setVolume(slider: number): void {
  state = { ...state, volume: slider }
  sendGain()
  push({ volume: slider })
}

function applyReplayGain(ref: TrackRef | undefined): void {
  rgFactor = ref ? replayGainFactor(rgMode, ref.gainDb, ref.peak) : 1
  sendGain()
}

/** Earlier queues, so a mis-click on Clear or a replaced queue can be undone. Newest last. */
interface QueueSnap { queue: TrackRef[]; original: TrackRef[]; index: number; why: string; at: number }
const snaps: QueueSnap[] = []
const MAX_SNAPS = 10
function snapshot(why: string): void {
  if (queue.length === 0) return
  snaps.push({ queue: queue.slice(), original: original.slice(), index, why, at: Date.now() })
  if (snaps.length > MAX_SNAPS) snaps.shift()
}

/** Tell main what the queue holds (play order) so the UI can show and edit it. */
function publishQueue(): void {
  queueRev++
  bridge.emitQueue(queue.map((t) => t.path), index)
  push({ queueRev, queueLength: queue.length, queueIndex: index, queueHistory: snaps.map((s) => ({ why: s.why, count: s.queue.length, at: s.at })) })
}

function setShuffle(on: boolean): void {
  if (on === shuffleOn) return
  shuffleOn = on
  if (on) {
    original = queue.slice()
    queue = shuffleAfter(queue, index)
  } else if (original.length) {
    const cur = queue[index]
    const kept = original.filter((t) => queue.includes(t))
    const added = queue.filter((t) => !original.includes(t))
    queue = [...kept, ...added]
    index = Math.max(0, cur ? queue.indexOf(cur) : 0)
    original = []
  }
  push({ shuffle: on })
  publishQueue()
}

/** The output the user chose, by name; kept so an unplugged DAC is picked up again when it returns. */
let preferredLabel = ''

async function listOutputs(): Promise<Array<{ id: string; label: string }>> {
  const all = await navigator.mediaDevices.enumerateDevices()
  // "default" and "communications" are aliases of a real device: Settings shows "System default" itself.
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label).map((d) => ({ id: d.deviceId, label: d.label }))
}

async function refreshOutputs(): Promise<void> {
  const outputDevices = await listOutputs()
  push({ outputDevices, outputId: sinkId })
  // The preferred device came back (or was just chosen at launch): switch to it.
  const want = preferredLabel && outputDevices.find((d) => d.label === preferredLabel)
  if (want && want.id !== sinkId) await setOutput(want.id, undefined, true)
}

async function setOutput(deviceId: string, label?: string, quiet = false): Promise<void> {
  if (label !== undefined) preferredLabel = label
  else if (!quiet) preferredLabel = deviceId ? ((await listOutputs()).find((d) => d.id === deviceId)?.label ?? '') : ''
  try {
    const id = deviceId || (label ? ((await listOutputs()).find((d) => d.label === label)?.id ?? '') : '')
    await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(id)
    sinkId = id
    push({ outputId: sinkId })
  } catch {
    if (!quiet) push({ toast: 'That output device is not available.' })
  }
}

async function onDeviceChange(): Promise<void> {
  if (sinkId) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    if (!devices.some((d) => d.kind === 'audiooutput' && d.deviceId === sinkId)) {
      // Active device vanished: pause, tell the user, fall back to system default (the preference is kept for when it returns).
      pause()
      const keep = preferredLabel
      await setOutput('', undefined, true)
      preferredLabel = keep
      push({ toast: 'Output device disconnected. Playback paused on the system default.' })
    }
  }
  await refreshOutputs()
}

function handle(c: PlaybackCommand | { type: 'resume-context' }): void {
  switch (c.type) {
    case 'load': {
      snapshot('Replaced by a new queue')
      let start = Math.min(c.index, c.tracks.length - 1)
      queue = c.tracks
      original = []
      if (shuffleOn) {
        // Spotify-style: the chosen track plays first, everything else follows in random order.
        original = queue.slice()
        const pick = queue[start]!
        queue = [pick, ...shuffled(queue.filter((_, i) => i !== start))]
        start = 0
      }
      wantPlaying = !c.paused
      startTrack(start, c.startSec ?? 0)
      publishQueue()
      if (c.paused) push({ status: 'paused' }) // session restore: ready at the saved spot, silent until the user presses play
      else void play()
      break
    }
    case 'play': void play(); break
    case 'pause': pause(); break
    case 'toggle': state.status === 'playing' || (wantPlaying && state.status === 'loading') ? pause() : void play(); break
    case 'next': {
      const ni = nextIndex(index, queue.length, repeat === 'one' ? 'all' : repeat) // an explicit skip leaves repeat-one's loop
      if (ni !== null) startTrack(ni)
      break
    }
    case 'prev': startTrack(state.positionSec > 3 || index === 0 ? index : index - 1); break
    case 'jump': if (c.index < queue.length) { wantPlaying = true; startTrack(c.index); void play() } break
    case 'enqueue': {
      if (!queue.length) { handle({ type: 'load', tracks: c.tracks, index: 0 }); break }
      const at = c.mode === 'next' ? index + 1 : queue.length
      ;({ queue, index } = insertAt({ queue, index }, at, c.tracks))
      if (shuffleOn) {
        const cur = queue[index]
        const pos = cur ? Math.max(0, original.indexOf(cur)) : original.length - 1
        original.splice(c.mode === 'next' ? pos + 1 : original.length, 0, ...c.tracks)
      }
      publishQueue()
      break
    }
    case 'remove': {
      const gone = queue[c.index]
      snapshot(gone ? `Removed “${gone.title ?? gone.path.split(/[\\/]/).pop() ?? 'a song'}”` : 'Removed a song')
      const wasPlaying = c.index === index
      ;({ queue, index } = removeAt({ queue, index }, c.index))
      if (gone && shuffleOn) original = original.filter((t) => t !== gone)
      if (!queue.length) { closeAll(); node.port.postMessage({ type: 'flush' }); wantPlaying = false; push({ status: 'idle', track: null, positionSec: 0 }) }
      else if (wasPlaying) startTrack(index) // the row that slid into place starts
      publishQueue()
      break
    }
    case 'move': {
      ;({ queue, index } = moveItem({ queue, index }, c.from, c.to))
      publishQueue()
      break
    }
    case 'queueRestore': {
      const s = snaps[c.slot]
      if (!s) break
      const cur = queue[index]
      snaps.splice(c.slot, 1)
      snapshot('Before restoring an earlier queue') // so the restore itself can be undone
      queue = s.queue
      original = s.original
      const at = cur ? queue.findIndex((t) => t.path === cur.path) : -1
      if (at >= 0) index = at // what is playing keeps playing
      else { index = Math.min(s.index, queue.length - 1); startTrack(index) }
      publishQueue()
      break
    }
    case 'clear': {
      snapshot('Cleared the queue')
      // Keep what is playing; drop everything after it.
      queue = queue.slice(0, index + 1)
      if (shuffleOn) original = original.filter((t) => queue.includes(t))
      publishQueue()
      break
    }
    case 'shuffle': setShuffle(c.on); break
    case 'repeat': repeat = c.mode; push({ repeat: c.mode }); break
    case 'crossfade': node.port.postMessage({ type: 'crossfade', seconds: c.seconds }); break
    case 'replayGain': rgMode = c.mode; push({ replayGain: c.mode }); applyReplayGain(queue[index]); break
    case 'seek': startTrack(index, c.seconds); break // new decode from the target; ring flushed with a 10 ms fade
    case 'volume': setVolume(c.slider); break
    case 'eq': applyEq(c.eq); break
    case 'output': void setOutput(c.deviceId, c.label); break
    case 'viz': setViz(c.on); break
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
  void refreshOutputs()
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
