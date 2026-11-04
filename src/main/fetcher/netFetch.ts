import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { net } from 'electron'
import { isPrivateHost } from '@shared/fetch'
import type { FetchFn } from './download'

/**
 * A public-looking name can still resolve to 127.0.0.1 or 192.168.x.x. Resolve it first and refuse if any answer is
 * private. Best effort: a name that changes its answer between this check and the connection (DNS rebinding) is not
 * caught, which is why only https to hosts we chose (never to arbitrary user-typed URLs, except Paste link) is used.
 */
async function assertPublicAddress(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return // literals are judged by isPrivateHost already
  const answers = await lookup(host, { all: true }).catch(() => [])
  if (answers.some((a) => isPrivateHost(a.address))) throw new Error('That address points at this computer or local network.')
}

/**
 * fetch() over Chromium's network stack (system proxy + certificate store apply) with *real* manual redirects.
 * Electron's `net.fetch(..., { redirect: 'manual' })` cancels instead of returning the 3xx, which broke every
 * Internet Archive download (/download/ 302s to a data node). We need to see each hop so it can be re-checked
 * against the https / no-private-network rules.
 */
export const electronFetch: FetchFn = async (url, init) => {
  await assertPublicAddress(url)
  return rawFetch(url, init)
}

const rawFetch: FetchFn = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'manual' })
    for (const [k, v] of Object.entries(init.headers)) req.setHeader(k, v)
    const abort = (): void => {
      req.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (init.signal.aborted) return abort()
    init.signal.addEventListener('abort', abort, { once: true })

    req.on('redirect', (status, _method, redirectUrl) => {
      req.abort() // we follow by hand, after checking the target
      init.signal.removeEventListener('abort', abort)
      resolve(new Response(null, { status, headers: { location: redirectUrl } }))
    })
    req.on('response', (incoming) => {
      const res = incoming as typeof incoming & NodeJS.ReadableStream // Electron's IncomingMessage is a Readable at runtime; its typings omit pause/resume
      const headers = new Headers()
      for (const [k, v] of Object.entries(res.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          res.on('data', (b: Buffer) => {
            c.enqueue(new Uint8Array(b))
          })
          res.on('end', () => {
            init.signal.removeEventListener('abort', abort)
            c.close()
          })
          res.on('error', (e: Error) => c.error(e))
          res.on('aborted', () => c.error(new Error('Connection lost')))
        },
        cancel() {
          req.abort()
        }
      })
      resolve(new Response(body, { status: res.statusCode, headers }))
    })
    req.on('error', (e) => {
      init.signal.removeEventListener('abort', abort)
      reject(e)
    })
    req.end()
  })
