import { z } from 'zod'
import { QUALITIES, type FetchJob, type License } from './fetch'

// Renderer ↔ main contract for the fetcher. Kept free of node imports so the preload can bundle it.
// The renderer never supplies a download URL for a catalogue provider: it names a search hit by id and main resolves it.

export const ProviderIdSchema = z.enum(['archive', 'commons', 'jamendo', 'link'])
const QualitySchema = z.enum(QUALITIES).optional()
export const FetchSearchSchema = z.object({ provider: ProviderIdSchema, query: z.string().min(1).max(2000), quality: QualitySchema })
export const FetchPickSchema = z.object({ provider: ProviderIdSchema, id: z.string().min(1).max(2200), quality: QualitySchema })
export const FetchControlSchema = z.object({ op: z.enum(['pause', 'resume', 'cancel', 'clear']), id: z.string().max(64).optional() })
export const FetchSettingsSchema = z.object({
  jamendoClientId: z.string().max(64).regex(/^[A-Za-z0-9]*$/),
  watchDownloads: z.boolean()
})
export type FetchSettings = z.infer<typeof FetchSettingsSchema>
export const defaultFetchSettings: FetchSettings = { jamendoClientId: '', watchDownloads: false }

export interface SearchHit { provider: z.infer<typeof ProviderIdSchema>; id: string; title: string; artist: string; license?: License; quality?: string }
export type SearchResponse = { ok: true; results: SearchHit[] } | { ok: false; error: string }
export type EnqueueResponse = { ok: true; count: number } | { ok: false; error: string }

export interface FetchBridge {
  fetchSearch(q: z.infer<typeof FetchSearchSchema>): Promise<SearchResponse>
  fetchEnqueue(p: z.infer<typeof FetchPickSchema>): Promise<EnqueueResponse>
  fetchControl(c: z.infer<typeof FetchControlSchema>): void
  fetchGet(): Promise<FetchJob[]>
  onFetch(cb: (jobs: FetchJob[]) => void): () => void
  fetchSettings(): Promise<FetchSettings>
  fetchSetSettings(s: FetchSettings): Promise<FetchSettings>
}
