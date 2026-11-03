// ReplayGain: scale a track so loud masters and quiet ones play at a similar level.
// Attenuation is always safe; a boost is only applied when the tagged peak proves it can't clip.

export type ReplayGainMode = 'off' | 'track'

export function replayGainFactor(mode: ReplayGainMode, gainDb: number | null | undefined, peak: number | null | undefined): number {
  if (mode === 'off' || typeof gainDb !== 'number' || !Number.isFinite(gainDb)) return 1
  const f = 10 ** (Math.max(-24, Math.min(12, gainDb)) / 20)
  if (typeof peak === 'number' && peak > 0) return Math.min(f, 1 / peak)
  return Math.min(f, 1)
}
