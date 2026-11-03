export interface StreamInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: number
  /** Lowercase hex MD5 of the unencoded audio, or null when the encoder didn't record one (all zeros). */
  md5: string | null
}

/** Parse the mandatory STREAMINFO block at the start of a FLAC file. Returns null when it isn't a FLAC stream. */
export function parseStreamInfo(head: Uint8Array): StreamInfo | null {
  if (head.length < 42 || head[0] !== 0x66 || head[1] !== 0x4c || head[2] !== 0x61 || head[3] !== 0x43) return null // "fLaC"
  if ((head[4]! & 0x7f) !== 0) return null // first block must be STREAMINFO
  const len = (head[5]! << 16) | (head[6]! << 8) | head[7]!
  if (len !== 34) return null
  const b = head.subarray(8, 8 + 34)
  const sampleRate = (b[10]! << 12) | (b[11]! << 4) | (b[12]! >> 4)
  const channels = ((b[12]! >> 1) & 7) + 1
  const bitsPerSample = (((b[12]! & 1) << 4) | (b[13]! >> 4)) + 1
  const totalSamples = (b[13]! & 15) * 2 ** 32 + ((b[14]! << 24) >>> 0) + ((b[15]! << 16) | (b[16]! << 8) | b[17]!)
  const md5 = [...b.subarray(18, 34)].map((x) => x.toString(16).padStart(2, '0')).join('')
  return { sampleRate, channels, bitsPerSample, totalSamples, md5: /^0+$/.test(md5) ? null : md5 }
}
