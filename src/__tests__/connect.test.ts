import { describe, it, expect, vi } from 'vitest'
import { PubSub } from '../pubsub.js'
import { handleSessionConnect, type ConnectDeps } from '../server.js'
import type { BridgeMessage } from '../bridge.js'

// Mock logger (server.ts uses it at module level)
vi.mock('../server.js', async () => {
  const actual = await vi.importActual<typeof import('../server.js')>('../server.js')
  return {
    ...actual,
    logBuffer: { log: vi.fn(), subscribe: vi.fn(), entries: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
})

function createDeps(overrides: Partial<ConnectDeps> = {}) {
  const pubsub = new PubSub<BridgeMessage>()
  const sent: (BridgeMessage | object)[] = []
  return {
    pubsub,
    sent,
    deps: {
      pubsub,
      snapshot: vi.fn().mockResolvedValue('snapshot-content'),
      connectSession: vi.fn().mockResolvedValue(false),
      send: (msg: BridgeMessage | object) => sent.push(msg),
      ...overrides,
    } satisfies ConnectDeps,
  }
}

describe('handleSessionConnect', () => {
  it('sends connected then snapshot output', async () => {
    const { deps, sent } = createDeps()
    await handleSessionConnect('$1', deps)

    expect(sent[0]).toEqual({ type: 'connected' })
    expect(sent[1]).toEqual({ type: 'output', data: 'snapshot-content' })
  })

  it('flushes pending output that arrived during snapshot', async () => {
    const pubsub = new PubSub<BridgeMessage>()
    const sent: (BridgeMessage | object)[] = []

    // snapshot is async — simulate output arriving while it's in progress
    const snapshotFn = vi.fn().mockImplementation(async () => {
      // While snapshot is being taken, PTY produces output
      pubsub.publish('$1', { type: 'output', data: 'live-data-1' } as BridgeMessage)
      pubsub.publish('$1', { type: 'output', data: 'live-data-2' } as BridgeMessage)
      return 'snapshot-content'
    })

    await handleSessionConnect('$1', {
      pubsub,
      snapshot: snapshotFn,
      connectSession: vi.fn().mockResolvedValue(false),
      send: (msg) => sent.push(msg),
    })

    // Should have: connected, snapshot, then the two live data messages
    expect(sent).toEqual([
      { type: 'connected' },
      { type: 'output', data: 'snapshot-content' },
      { type: 'output', data: 'live-data-1' },
      { type: 'output', data: 'live-data-2' },
    ])
  })

  it('does NOT miss output during snapshot (subscribe-before-snapshot)', async () => {
    const pubsub = new PubSub<BridgeMessage>()
    const sent: (BridgeMessage | object)[] = []
    let subscriberCountDuringSnapshot = 0

    const snapshotFn = vi.fn().mockImplementation(async () => {
      // Check that we're already subscribed when snapshot runs
      subscriberCountDuringSnapshot = pubsub.channelSize('$1')
      // Simulate output during snapshot
      pubsub.publish('$1', { type: 'output', data: 'mid-snapshot' } as BridgeMessage)
      return 'snap'
    })

    await handleSessionConnect('$1', {
      pubsub,
      snapshot: snapshotFn,
      connectSession: vi.fn().mockResolvedValue(false),
      send: (msg) => sent.push(msg),
    })

    // The subscriber must be active during snapshot
    expect(subscriberCountDuringSnapshot).toBe(1)
    // The mid-snapshot output must be delivered
    const outputMessages = sent.filter((m: any) => m.type === 'output')
    const outputData = outputMessages.map((m: any) => m.data)
    expect(outputData).toContain('mid-snapshot')
  })

  it('discards pending buffer for newly created PTY', async () => {
    const pubsub = new PubSub<BridgeMessage>()
    const sent: (BridgeMessage | object)[] = []

    // connectSession is async — simulate output arriving before it returns
    const connectFn = vi.fn().mockImplementation(async () => {
      pubsub.publish('$1', { type: 'output', data: 'initial-dump' } as BridgeMessage)
      return true // isNew = true
    })

    await handleSessionConnect('$1', {
      pubsub,
      snapshot: vi.fn().mockResolvedValue('snap'),
      connectSession: connectFn,
      send: (msg) => sent.push(msg),
    })

    // The initial dump should be discarded (it duplicates the snapshot)
    const outputData = sent.filter((m: any) => m.type === 'output').map((m: any) => m.data)
    expect(outputData).toEqual(['snap']) // only snapshot, no initial-dump
  })

  it('returns unsubscribe function that stops delivery', async () => {
    const { pubsub, deps, sent } = createDeps()
    const unsub = await handleSessionConnect('$1', deps)

    // After connect, live output is forwarded directly
    pubsub.publish('$1', { type: 'output', data: 'after-connect' } as BridgeMessage)
    expect(sent.some((m: any) => m.data === 'after-connect')).toBe(true)

    // After unsub, output is no longer forwarded
    unsub()
    const countBefore = sent.length
    pubsub.publish('$1', { type: 'output', data: 'after-unsub' } as BridgeMessage)
    expect(sent.length).toBe(countBefore)
  })

  it('ignores non-output messages in pubsub', async () => {
    const { pubsub, deps, sent } = createDeps()
    await handleSessionConnect('$1', deps)

    pubsub.publish('$1', { type: 'sessions', sessions: [] } as any)
    pubsub.publish('$1', { type: 'preview', data: 'x' } as any)

    const types = sent.map((m: any) => m.type)
    expect(types).toEqual(['connected', 'output']) // only snapshot output
  })

  it('handles empty snapshot gracefully', async () => {
    const { deps, sent } = createDeps({
      snapshot: vi.fn().mockResolvedValue(''),
    })
    await handleSessionConnect('$1', deps)

    expect(sent[0]).toEqual({ type: 'connected' })
    expect(sent[1]).toEqual({ type: 'output', data: '' })
  })

  it('after draining, live output is sent immediately', async () => {
    const { pubsub, deps, sent } = createDeps()
    await handleSessionConnect('$1', deps)

    // Clear sent array to isolate post-connect messages
    sent.length = 0

    pubsub.publish('$1', { type: 'output', data: 'live-1' } as BridgeMessage)
    pubsub.publish('$1', { type: 'output', data: 'live-2' } as BridgeMessage)

    expect(sent).toEqual([
      { type: 'output', data: 'live-1' },
      { type: 'output', data: 'live-2' },
    ])
  })
})
