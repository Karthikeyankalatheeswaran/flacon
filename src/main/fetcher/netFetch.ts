import { net } from 'electron'
import type { FetchFn } from './download'

/**
 * fetch() over Chromium's network stack (system proxy + certificate store apply) with *real* manual redirects.
 * Electron's `net.fetch(..., { redirect: 'manual' })` cancels instead of returning the 3xx, which broke every
 * Internet Archive download (/download/ 302s to a data node). We need to see each hop so it can be re-checked
 * against the https / no-private-network rules.
 */
export const electronFetch: FetchFn = (url, init) =>
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
