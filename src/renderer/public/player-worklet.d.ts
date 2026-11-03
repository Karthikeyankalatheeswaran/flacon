export class PcmRing {
  constructor(channels: number, capacityFrames: number)
  readonly buffered: number
  readonly free: number
  readPos: number
  writePos: number
  writeInterleaved(src: Float32Array, frames: number): number
  read(out: Float32Array[], frames: number): number
  flush(): void
}
