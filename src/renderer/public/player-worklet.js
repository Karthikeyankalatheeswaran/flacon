// AudioWorklet ring-buffer player. Plain JS because worklets load as standalone modules.
// PcmRing is exported so it can be unit-tested in Node (registerProcessor is guarded).

/** Planar float ring buffer with absolute frame counters (never wrap), so track marks stay exact. */
export class PcmRing {
  constructor(channels, capacityFrames) {
    this.channels = channels
    this.capacity = capacityFrames
    this.data = Array.from({ length: channels }, () => new Float32Array(capacityFrames))
    this.readPos = 0 // absolute frames consumed
    this.writePos = 0 // absolute frames written
  }
  get buffered() {
    return this.writePos - this.readPos
  }
  get free() {
    return this.capacity - this.buffered
  }
  /** Write interleaved f32 frames. Returns frames accepted (may be < offered when full). */
  writeInterleaved(src, frames) {
    const n = Math.min(frames, this.free)
    for (let i = 0; i < n; i++) {
      const idx = (this.writePos + i) % this.capacity
      for (let c = 0; c < this.channels; c++) this.data[c][idx] = src[i * this.channels + c]
    }
    this.writePos += n
    return n
  }
  /** Read into planar outputs; returns frames actually read (rest left untouched). */
  read(out, frames) {
    const n = Math.min(frames, this.buffered)
    for (let i = 0; i < n; i++) {
      const idx = (this.readPos + i) % this.capacity
      for (let c = 0; c < this.channels; c++) out[c][i] = this.data[c][idx]
    }
    this.readPos += n
    return n
  }
  /**
   * Equal-power crossfade: blend `n` interleaved frames of a new track into audio already buffered at absolute
   * position `abs`. `done` of `len` frames of the fade have been mixed before this call. Frames whose slot was
   * already played are skipped. Returns frames processed (always n).
   */
  mixAt(abs, src, n, done, len) {
    for (let i = 0; i < n; i++) {
      const pos = abs + i
      if (pos < this.readPos || pos >= this.writePos) continue
      const t = (done + i + 0.5) / len
      const fo = Math.cos((t * Math.PI) / 2)
      const fi = Math.sin((t * Math.PI) / 2)
      const idx = pos % this.capacity
      for (let c = 0; c < this.channels; c++) this.data[c][idx] = this.data[c][idx] * fo + src[i * this.channels + c] * fi
    }
    return n
  }
  /** Drop everything buffered (seek / stop). */
  flush() {
    this.readPos = this.writePos
  }
}

const FADE_FRAMES = (rate) => Math.round(rate * 0.01) // 10 ms click-free fades

if (typeof registerProcessor !== 'undefined') {
  class PlayerProcessor extends AudioWorkletProcessor {
    constructor() {
      super()
      this.ring = new PcmRing(2, sampleRate * 20) // 20 s of headroom; decoder keeps ~10 s ahead
      this.pending = [] // chunks that did not fit yet: {samples, frames, offset}
      this.marks = [] // {at, trackId, startSec}: absolute write position where a track begins
      this.current = null // {trackId, at, startSec}
      this.playing = false
      this.gain = 1
      this.fade = 0 // -1 fading out, +1 fading in, 0 steady
      this.fadeLeft = 0
      this.fadeTotal = FADE_FRAMES(sampleRate)
      this.pauseAfterFade = false
      this.flushAfterFade = false
      this.flushAt = 0
      this.ended = false
      this.xfFrames = 0 // configured crossfade length in frames (0 = off)
      this.xf = null // crossfade in progress: {start, len, done, trackId}
      this.reportAt = 0
      this.port.onmessage = (e) => this.onMessage(e.data)
    }
    onMessage(m) {
      switch (m.type) {
        case 'chunk': {
          if (m.first) {
            const xf = this.planCrossfade(m.trackId)
            if (xf) this.xf = xf
            // With a crossfade the new track begins where the fade begins, inside the old track's buffered tail.
            this.marks.push({ at: xf ? xf.start : this.ring.writePos + this.pendingFrames(), trackId: m.trackId, startSec: m.startSec })
          }
          this.pending.push({ samples: new Float32Array(m.data), frames: m.frames, offset: 0, trackId: m.trackId })
          this.drain()
          break
        }
        case 'crossfade':
          this.xfFrames = Math.max(0, Math.round(m.seconds * sampleRate))
          break
        case 'play':
          this.playing = true
          this.startFade(+1)
          break
        case 'pause':
          this.startFade(-1)
          this.pauseAfterFade = true
          break
        case 'flush': // seek or skip: fade out 10 ms, then drop buffered audio
          // Everything written so far is stale; audio written AFTER this point belongs to the new stream, which
          // may already be decoding while the 10 ms fade runs, so the flush must not touch it.
          this.pending.length = 0
          this.xf = null
          this.flushAt = this.ring.writePos
          if (this.playing) {
            this.startFade(-1)
            this.flushAfterFade = true
          } else this.hardFlush()
          break
        case 'gain':
          this.gain = m.value
          break
      }
    }
    pendingFrames() {
      let n = 0
      let mixLeft = this.xf ? this.xf.len - this.xf.done : 0 // frames that will blend into the buffer instead of extending it
      for (const p of this.pending) {
        let rem = p.frames - p.offset
        if (this.xf && p.trackId === this.xf.trackId) {
          const m = Math.min(rem, mixLeft)
          mixLeft -= m
          rem -= m
        }
        n += rem
      }
      return n
    }
    /** Crossfade only a natural track change: playing, nothing queued behind the ring, and enough of the old track still unplayed. */
    planCrossfade(trackId) {
      if (!this.xfFrames || !this.playing || !this.current || this.xf || this.flushAfterFade || this.pending.length) return null
      const guard = Math.round(sampleRate * 0.25)
      const aStart = this.marks.length ? this.marks[this.marks.length - 1].at : this.current.at
      let len = Math.min(this.xfFrames, this.ring.buffered - guard, Math.floor((this.ring.writePos - aStart) / 2))
      if (len < Math.round(sampleRate * 0.5)) return null
      const start = this.ring.writePos - len
      if (start < this.flushAt || start <= this.ring.readPos) return null
      return { start, len, done: 0, trackId }
    }
    startFade(dir) {
      this.fade = dir
      this.fadeLeft = this.fadeTotal
    }
    /** Drop buffered audio written before `at`, keeping the new stream's audio and track marks (a mark at/after `at`). */
    flushTo(at) {
      this.xf = null
      if (at > this.ring.readPos) this.ring.readPos = at
      this.marks = this.marks.filter((m) => m.at >= at)
      this.current = null
    }
    hardFlush() {
      this.xf = null
      this.ring.flush()
      this.marks.length = 0
      this.current = null
    }
    drain() {
      while (this.pending.length) {
        const p = this.pending[0]
        if (this.xf && p.trackId === this.xf.trackId) {
          const n = Math.min(p.frames - p.offset, this.xf.len - this.xf.done)
          this.ring.mixAt(this.xf.start + this.xf.done, p.samples.subarray(p.offset * 2), n, this.xf.done, this.xf.len)
          p.offset += n
          this.xf.done += n
          this.port.postMessage({ type: 'overlap', trackId: p.trackId, frames: n }) // these frames never occupy ring space
          if (this.xf.done >= this.xf.len) this.xf = null
          if (p.offset >= p.frames) this.pending.shift()
          continue
        }
        if (this.ring.free <= 0) break
        const view = p.samples.subarray(p.offset * 2)
        const n = this.ring.writeInterleaved(view, p.frames - p.offset)
        p.offset += n
        if (p.offset >= p.frames) this.pending.shift()
        else break
      }
    }
    process(_inputs, outputs) {
      const out = outputs[0]
      const frames = out[0].length
      if (!this.playing && this.fade === 0) {
        for (const ch of out) ch.fill(0)
        return true
      }
      const got = this.ring.read(out, frames)
      for (let c = 0; c < out.length; c++) for (let i = got; i < frames; i++) out[c][i] = 0
      // track boundary bookkeeping (gapless: samples simply continue into the next track)
      while (this.marks.length && this.marks[0].at <= this.ring.readPos) {
        const m = this.marks.shift()
        this.current = m
        this.port.postMessage({ type: 'track-started', trackId: m.trackId })
      }
      // gain + fades, in the float domain
      for (let i = 0; i < frames; i++) {
        let g = this.gain
        if (this.fade !== 0) {
          const t = Math.max(0, this.fadeLeft) / this.fadeTotal
          g *= this.fade > 0 ? 1 - t : t
          this.fadeLeft--
        }
        for (let c = 0; c < out.length; c++) out[c][i] *= g
      }
      if (this.fade !== 0 && this.fadeLeft <= 0) {
        this.fade = 0
        if (this.pauseAfterFade) {
          this.playing = false
          this.pauseAfterFade = false
        }
        if (this.flushAfterFade) {
          this.flushTo(this.flushAt)
          this.flushAfterFade = false
          this.startFade(+1)
        }
      }
      this.drain()
      if (this.ring.buffered < this.ring.capacity / 2) this.port.postMessage({ type: 'need-data' })
      if (got < frames && this.playing && this.pending.length === 0 && this.current) this.reportUnderrun()
      if (this.ring.readPos >= this.reportAt) {
        this.reportAt = this.ring.readPos + Math.round(sampleRate / 10)
        const startSec = this.current ? this.current.startSec : 0
        const at = this.current ? this.current.at : 0
        this.port.postMessage({
          type: 'position',
          trackId: this.current ? this.current.trackId : null,
          seconds: startSec + (this.ring.readPos - at) / sampleRate,
          buffered: this.ring.buffered / sampleRate,
          consumed: this.ring.readPos,
          pendingFrames: this.pendingFrames(),
          currentTime
        })
      }
      return true
    }
    reportUnderrun() {
      if (this.ended) return
      this.port.postMessage({ type: 'underrun' })
    }
  }
  registerProcessor('flacon-player', PlayerProcessor)
}
