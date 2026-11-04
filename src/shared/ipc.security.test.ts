import { describe, expect, it } from 'vitest'
import { AddPathsSchema, AppSettingsSchema, PlayRequestSchema, RendererLibraryRequestSchema, SongsQuerySchema } from './ipc'
import { PlaybackCommandSchema } from './playback'
import { FetchSearchSchema } from './fetchIpc'

// Evidence for docs/security-review.md: what a compromised page cannot ask the main process to do.
describe('renderer → main allow-lists', () => {
  it('library operations that change folders, scan or touch the database are not callable from the renderer', () => {
    for (const op of ['addFolder', 'removeFolder', 'scan', 'init', 'albumPaths', 'scopePaths', 'recordPlay', 'playlistImport', 'exec', '__proto__'])
      expect(RendererLibraryRequestSchema.safeParse({ op, path: '/', paths: [], name: 'x' }).success, op).toBe(false)
  })
  it('only the listed operations pass, with strict shapes', () => {
    expect(RendererLibraryRequestSchema.safeParse({ op: 'duplicates' }).success).toBe(true)
    expect(RendererLibraryRequestSchema.safeParse({ op: 'lyricsOnline', path: '/m/a.flac' }).success).toBe(true)
    expect(RendererLibraryRequestSchema.safeParse({ op: 'lyricsOnline', path: 5 }).success).toBe(false)
    expect(RendererLibraryRequestSchema.safeParse({ op: 'playlistAdd', id: -1, paths: [] }).success).toBe(false)
    expect(RendererLibraryRequestSchema.safeParse({ op: 'playlistAdd', id: 1, paths: Array(5001).fill('/a.flac') }).success).toBe(false)
  })
  it('song sorting cannot smuggle SQL: the sort key must be one of the known columns', () => {
    const base = { dir: 'asc', text: '', offset: 0, limit: 10 }
    expect(SongsQuerySchema.safeParse({ ...base, sort: 'title' }).success).toBe(true)
    for (const sort of ['title; drop table tracks', '1', 'rowid', 'title desc, (select 1)']) expect(SongsQuerySchema.safeParse({ ...base, sort }).success, sort).toBe(false)
    expect(SongsQuerySchema.safeParse({ ...base, sort: 'title', dir: 'asc; --' }).success).toBe(false)
    expect(SongsQuerySchema.safeParse({ ...base, sort: 'title', scope: "all' or '1'='1" }).success).toBe(false)
  })
  it('playback only accepts audio files by name, with bounded sizes', () => {
    const load = (path: string): boolean => PlaybackCommandSchema.safeParse({ type: 'load', tracks: [{ path }], index: 0 }).success
    expect(load('/m/a.flac')).toBe(true)
    for (const p of ['/etc/passwd', '/m/a.sh', '/m/a.flac.exe', '', 'x'.repeat(5000) + '.flac']) expect(load(p), p).toBe(false)
    expect(PlaybackCommandSchema.safeParse({ type: 'load', tracks: Array(5001).fill({ path: '/a.flac' }), index: 0 }).success).toBe(false)
    expect(PlaybackCommandSchema.safeParse({ type: 'shell', cmd: 'rm -rf /' }).success).toBe(false)
    expect(PlaybackCommandSchema.safeParse({ type: 'queueRestore', slot: -1 }).success).toBe(false)
  })
  it('settings patches cannot add unknown keys or wrong types', () => {
    const P = AppSettingsSchema.partial()
    expect(P.safeParse({ crossfade: 3 }).success).toBe(true)
    expect(P.safeParse({ crossfade: 99 }).success).toBe(false)
    expect(P.safeParse({ islandEdge: 'left' }).success).toBe(false)
    expect(P.safeParse({ outputDevice: 'x'.repeat(300) }).success).toBe(false)
    expect(Object.keys(P.parse({ crossfade: 1, evil: true } as never))).toEqual(['crossfade']) // unknown keys are dropped, never stored
  })
  it('fetch requests only name known providers', () => {
    expect(FetchSearchSchema.safeParse({ provider: 'archive', query: 'x', quality: 'best' }).success).toBe(true)
    expect(FetchSearchSchema.safeParse({ provider: 'http://evil', query: 'x' }).success).toBe(false)
  })
  it('play and add-paths requests are bounded', () => {
    expect(PlayRequestSchema.safeParse({ source: { kind: 'scope', scope: 'all; drop', text: '' }, mode: 'play' }).success).toBe(false)
    expect(AddPathsSchema.safeParse(Array(100_000).fill('/a')).success).toBe(false)
  })
})
