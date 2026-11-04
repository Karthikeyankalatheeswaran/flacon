import { isAbsolute } from 'node:path'

// ffmpeg picks its demuxer by sniffing *content*, not by file name, and understands URLs. Left alone, a file called
// "x.flac" that is really an HLS playlist or a concat script (or a path like "http://host/x.flac") could make it read
// other files or open network connections. Every input we hand to ffmpeg goes through here.

/** Containers music players meet. Anything else (hls, concat, image2, rtsp, sdp, …) is refused at probe time. */
export const INPUT_DEMUXERS = ['flac', 'wav', 'w64', 'aiff', 'caf', 'ogg', 'mp3', 'mov', 'mp4', 'm4a', 'matroska', 'webm', 'ape', 'wv', 'tta', 'dsf', 'dff', 'iff', 'asf', 'aac', 'ac3', 'eac3', 'dts', 'mpc', 'mpc8', 'tak', 'au', 'amr', 'wsd', 'shn', 'oma', 'rm', 'tak', 'rf64'] as const

/** Never reachable: ffmpeg fails to open it, which the player reports as an unplayable file. */
export const REFUSED_INPUT = '/nonexistent/flacon-refused-input.flac'

/** A plain local file path: absolute, no control characters, not an option, not a URL. */
export function isPlainLocalPath(p: string): boolean {
  if (!p || p.length > 4096 || /[\u0000-\u001f]/.test(p)) return false // eslint-disable-line no-control-regex
  if (!isAbsolute(p) && !/^[A-Za-z]:[\\/]/.test(p) && !p.startsWith('\\\\')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]+:\/\//.test(p)) return false // http://, file://, rtmp://…
  return true
}

/** The arguments that open `path` as input, restricted to local files and known music containers. */
export function inputArgs(path: string): string[] {
  return ['-protocol_whitelist', 'file,pipe', '-format_whitelist', INPUT_DEMUXERS.join(','), '-i', isPlainLocalPath(path) ? path : REFUSED_INPUT]
}
