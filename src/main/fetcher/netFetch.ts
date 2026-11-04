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
      try {
      const res = incoming as typeof incoming & NodeJS.ReadableStream // Electron's IncomingMessage is a Readable at runtime; its typings omit pause/resume
      const headers = new Headers()
      const encoded = Object.keys(res.headers).some((k) => k.toLowerCase() === 'content-encoding')
      for (const [k, v] of Object.entries(res.headers)) {
        // Chromium has already decoded the body, so these no longer describe it. (Audio downloads keep their real length.)
        if (/^(content-encoding|transfer-encoding)$/i.test(k) || (encoded && k.toLowerCase() === 'content-length')) continue
        // A server's odd header (ccMixter sends one the Headers class refuses) must not abort the whole response.
        try { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)) } catch { /* skip it */ }
      }
      // Listen straight away (as Chromium's stream wants) and hand the chunks to the Response as they come.
      let ctl!: ReadableStreamDefaultController<Uint8Array>
      let closed = false
      const queue: Uint8Array[] = []
      let ready = false
      const finish = (err?: Error): void => {
        if (closed) return
        closed = true
        init.signal.removeEventListener('abort', abort)
        if (!ready) { if (err) queue.push(err as unknown as Uint8Array); return }
        err ? ctl.error(err) : ctl.close()
      }
      res.on('data', (b: Buffer) => {
        const chunk = new Uint8Array(b)
        if (ready) ctl.enqueue(chunk)
        else queue.push(chunk)
      })
      res.on('end', () => finish())
      res.on('error', (e: Error) => finish(e))
      res.on('aborted', () => finish(new Error('Connection lost')))
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c
          ready = true
          let failed: Error | undefined
          for (const q of queue) { if (q instanceof Error) failed = q; else c.enqueue(q) }
          queue.length = 0
          if (failed) { closed = true; c.error(failed) } else if (closed) c.close()
        },
        cancel() {
          req.abort()
        }
      })
      resolve(new Response(body, { status: res.statusCode, headers }))
      } catch (e) {
        init.signal.removeEventListener('abort', abort)
        req.abort()
        reject(e instanceof Error ? e : new Error('Bad response'))
      }
    })
    req.on('error', (e) => {
      init.signal.removeEventListener('abort', abort)
      reject(e)
    })
    req.end()
  })
