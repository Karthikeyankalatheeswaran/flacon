// Pure play-queue rules, shared by the audio engine and tested without Electron.

export type RepeatMode = 'off' | 'all' | 'one'

/** Index to play after `index`, or null at the end of the queue. */
export function nextIndex(index: number, length: number, repeat: RepeatMode): number | null {
  if (length === 0) return null
  if (repeat === 'one') return index
  if (index + 1 < length) return index + 1
  return repeat === 'all' ? 0 : null
}

/** Index "previous" goes to (restarts the current track when it is the first). */
export const prevIndex = (index: number): number => Math.max(0, index - 1)

/** Fisher–Yates on a copy. `rand` is injectable for tests. */
export function shuffled<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Shuffle everything after `index`; already-played tracks and the current one stay put. */
export function shuffleAfter<T>(queue: T[], index: number, rand?: () => number): T[] {
  return [...queue.slice(0, index + 1), ...shuffled(queue.slice(index + 1), rand)]
}

export interface QueueOp<T> { queue: T[]; index: number }

export function insertAt<T>(q: QueueOp<T>, at: number, items: T[]): QueueOp<T> {
  const pos = Math.max(0, Math.min(q.queue.length, at))
  return { queue: [...q.queue.slice(0, pos), ...items, ...q.queue.slice(pos)], index: pos <= q.index && q.queue.length > 0 ? q.index + items.length : q.index }
}

/** Remove one row. Removing the playing row keeps `index` pointing at the row that slides into its place. */
export function removeAt<T>(q: QueueOp<T>, at: number): QueueOp<T> {
  if (at < 0 || at >= q.queue.length) return q
  const queue = q.queue.filter((_, i) => i !== at)
  const index = at < q.index ? q.index - 1 : q.index
  return { queue, index: Math.max(0, Math.min(index, queue.length - 1)) }
}

/** Move a row; the playing track keeps playing wherever it ends up. */
export function moveItem<T>(q: QueueOp<T>, from: number, to: number): QueueOp<T> {
  if (from === to || from < 0 || to < 0 || from >= q.queue.length || to >= q.queue.length) return q
  const queue = q.queue.slice()
  const [item] = queue.splice(from, 1)
  queue.splice(to, 0, item!)
  let index = q.index
  if (from === q.index) index = to
  else if (from < q.index && to >= q.index) index--
  else if (from > q.index && to <= q.index) index++
  return { queue, index }
}
