import { describe, it, expect, vi } from 'vitest'
import { PubSub } from '../pubsub.js'

describe('PubSub', () => {
  it('delivers messages to subscribers', () => {
    const ps = new PubSub<string>()
    const received: string[] = []
    ps.subscribe('ch', (msg) => received.push(msg))

    ps.publish('ch', 'hello')
    ps.publish('ch', 'world')

    expect(received).toEqual(['hello', 'world'])
  })

  it('delivers to multiple subscribers on the same channel', () => {
    const ps = new PubSub<number>()
    const a: number[] = []
    const b: number[] = []
    ps.subscribe('ch', (n) => a.push(n))
    ps.subscribe('ch', (n) => b.push(n))

    ps.publish('ch', 42)

    expect(a).toEqual([42])
    expect(b).toEqual([42])
  })

  it('does not deliver to other channels', () => {
    const ps = new PubSub<string>()
    const received: string[] = []
    ps.subscribe('a', (msg) => received.push(msg))

    ps.publish('b', 'nope')

    expect(received).toEqual([])
  })

  it('unsubscribe via returned function stops delivery', () => {
    const ps = new PubSub<string>()
    const received: string[] = []
    const unsub = ps.subscribe('ch', (msg) => received.push(msg))

    ps.publish('ch', 'before')
    unsub()
    ps.publish('ch', 'after')

    expect(received).toEqual(['before'])
  })

  it('unsubscribe via method stops delivery', () => {
    const ps = new PubSub<string>()
    const received: string[] = []
    const fn = (msg: string) => received.push(msg)
    ps.subscribe('ch', fn)

    ps.publish('ch', 'before')
    ps.unsubscribe('ch', fn)
    ps.publish('ch', 'after')

    expect(received).toEqual(['before'])
  })

  it('subscriber errors do not break other subscribers', () => {
    const ps = new PubSub<string>()
    const received: string[] = []
    ps.subscribe('ch', () => { throw new Error('boom') })
    ps.subscribe('ch', (msg) => received.push(msg))

    ps.publish('ch', 'ok')

    expect(received).toEqual(['ok'])
  })

  it('publishing to channel with no subscribers is a no-op', () => {
    const ps = new PubSub<string>()
    expect(() => ps.publish('empty', 'msg')).not.toThrow()
  })

  describe('channelSize', () => {
    it('returns 0 for unknown channel', () => {
      const ps = new PubSub<string>()
      expect(ps.channelSize('nope')).toBe(0)
    })

    it('tracks subscriber count', () => {
      const ps = new PubSub<string>()
      const unsub1 = ps.subscribe('ch', () => {})
      ps.subscribe('ch', () => {})

      expect(ps.channelSize('ch')).toBe(2)

      unsub1()
      expect(ps.channelSize('ch')).toBe(1)
    })
  })

  describe('channelStats', () => {
    it('returns stats for all channels', () => {
      const ps = new PubSub<string>()
      ps.subscribe('a', () => {})
      ps.subscribe('a', () => {})
      ps.subscribe('b', () => {})

      const stats = ps.channelStats()
      expect(stats).toEqual(
        expect.arrayContaining([
          { channel: 'a', subscribers: 2 },
          { channel: 'b', subscribers: 1 },
        ])
      )
    })

    it('returns empty array when no channels', () => {
      const ps = new PubSub<string>()
      expect(ps.channelStats()).toEqual([])
    })
  })
})
