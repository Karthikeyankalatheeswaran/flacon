import { describe, expect, it } from 'vitest'
import { describeUpdate, initialUpdate, updateReducer, type UpdateEvent, type UpdateStatus } from './update'

const run = (events: UpdateEvent[], from: UpdateStatus = initialUpdate): UpdateStatus => events.reduce(updateReducer, from)

describe('update machine', () => {
  it('walks the happy path to ready', () => {
    const s = run([{ type: 'check' }, { type: 'available', version: '1.2.0' }, { type: 'download' }, { type: 'progress', percent: 41.6 }])
    expect(s).toEqual({ state: 'downloading', version: '1.2.0', percent: 42 })
    expect(updateReducer(s, { type: 'downloaded' })).toEqual({ state: 'ready', version: '1.2.0' })
  })
  it('reports up to date and lets the user check again', () => {
    expect(run([{ type: 'check' }, { type: 'none' }])).toEqual({ state: 'none' })
    expect(run([{ type: 'check' }, { type: 'none' }, { type: 'check' }])).toEqual({ state: 'checking' })
  })
  it('ignores events that don’t apply in the current state', () => {
    expect(run([{ type: 'available', version: '9' }])).toEqual(initialUpdate)
    expect(run([{ type: 'download' }])).toEqual(initialUpdate)
    expect(run([{ type: 'progress', percent: 50 }])).toEqual(initialUpdate)
    expect(run([{ type: 'check' }, { type: 'check' }])).toEqual({ state: 'checking' })
  })
  it('never interrupts a download or a ready update with a new check', () => {
    const dl: UpdateStatus = { state: 'downloading', version: '1.2.0', percent: 10 }
    expect(updateReducer(dl, { type: 'check' })).toBe(dl)
    const ready: UpdateStatus = { state: 'ready', version: '1.2.0' }
    expect(updateReducer(ready, { type: 'check' })).toBe(ready)
    expect(updateReducer(ready, { type: 'error', message: 'late failure' })).toBe(ready)
  })
  it('clamps progress and truncates long errors', () => {
    const dl: UpdateStatus = { state: 'downloading', version: '1', percent: 0 }
    expect(updateReducer(dl, { type: 'progress', percent: 250 })).toMatchObject({ percent: 100 })
    expect(updateReducer(dl, { type: 'progress', percent: -5 })).toMatchObject({ percent: 0 })
    const e = updateReducer(initialUpdate, { type: 'error', message: 'x'.repeat(1000) })
    expect(e.state === 'error' && e.message.length).toBe(300)
  })
  it('recovers from an error with a fresh check', () => {
    expect(run([{ type: 'error', message: 'offline' }, { type: 'check' }])).toEqual({ state: 'checking' })
    expect(run([{ type: 'error', message: 'offline' }, { type: 'reset' }])).toEqual(initialUpdate)
  })
  it('stays unavailable (dev build / no feed) whatever happens', () => {
    const u: UpdateStatus = { state: 'unavailable', reason: 'Updates are available in the installed app.' }
    expect(run([{ type: 'check' }, { type: 'available', version: '2' }], u)).toBe(u)
    expect(describeUpdate(u)).toMatch(/installed app/)
  })
  it('describes every state in words', () => {
    for (const s of [initialUpdate, { state: 'checking' }, { state: 'none' }, { state: 'available', version: '2' }, { state: 'downloading', version: '2', percent: 3 }, { state: 'ready', version: '2' }, { state: 'error', message: 'x' }] as UpdateStatus[])
      expect(describeUpdate(s).length).toBeGreaterThan(8)
  })
})
