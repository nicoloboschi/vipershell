import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { createApiRouter } from '../api.js'
import type { TmuxBridge } from '../bridge.js'
import type { MemoryStore, MemoryConfig } from '../memory.js'
import type { LogBuffer } from '../server.js'

// ── Mock bridge ──────────────────────────────────────────────────────────────

const mockBridge: TmuxBridge = {
  listSessions: vi.fn().mockResolvedValue([]),
  getSessionPid: vi.fn().mockResolvedValue(null),
} as unknown as TmuxBridge

// ── Mock memory ──────────────────────────────────────────────────────────────

const defaultConfig: MemoryConfig = {
  hindsightEnabled: false,
  llmProvider: 'mock',
  llmApiKey: '',
  llmModel: '',
  retainChunkChars: 3000,
  observationsEnabled: false,
  uiPort: 18765,
}

const mockMemory: MemoryStore = {
  get active() { return false },
  get apiUrl() { return 'http://127.0.0.1:9027' },
  get startedAt() { return null },
  get retainChunkChars() { return 3000 },
  getConfig: vi.fn().mockReturnValue(defaultConfig),
  saveConfig: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  retain: vi.fn().mockResolvedValue(undefined),
  recall: vi.fn().mockResolvedValue([]),
  startUi: vi.fn().mockResolvedValue(null),
} as unknown as MemoryStore

// ── Mock logBuffer ───────────────────────────────────────────────────────────

const mockLogBuffer: LogBuffer = {
  entries: vi.fn().mockReturnValue([]),
  subscribe: vi.fn().mockReturnValue(() => {}),
  log: vi.fn(),
} as unknown as LogBuffer

// ── Server setup ─────────────────────────────────────────────────────────────

let baseUrl: string
let server: ReturnType<typeof createServer>

beforeAll(() => {
  return new Promise<void>((resolve) => {
    const app = express()
    app.use(express.json())
    app.use('/api', createApiRouter(mockBridge, mockLogBuffer, mockMemory))

    server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      baseUrl = `http://127.0.0.1:${addr.port}/api`
      resolve()
    })
  })
})

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/version', () => {
  it('returns version 0.1.0', async () => {
    const res = await fetch(`${baseUrl}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body).toEqual({ version: '0.1.0' })
  })
})

describe('GET /api/sessions', () => {
  it('returns an array', async () => {
    const res = await fetch(`${baseUrl}/sessions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /api/memory/config', () => {
  it('has hindsightEnabled, active, llmProvider fields', async () => {
    const res = await fetch(`${baseUrl}/memory/config`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('hindsightEnabled')
    expect(body).toHaveProperty('active')
    expect(body).toHaveProperty('llmProvider')
  })

  it('active is false when memory not active', async () => {
    const res = await fetch(`${baseUrl}/memory/config`)
    const body = await res.json() as Record<string, unknown>
    expect(body.active).toBe(false)
  })
})

describe('POST /api/memory/restart', () => {
  it('returns { ok: true }', async () => {
    const res = await fetch(`${baseUrl}/memory/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hindsightEnabled: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body).toEqual({ ok: true })
  })
})

describe('POST /api/memory/mcp-setup', () => {
  it('returns { ok: false, error: "Hindsight not running" } when memory not active', async () => {
    const res = await fetch(`${baseUrl}/memory/mcp-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Hindsight not running')
  })
})

describe('GET /api/hindsight/health', () => {
  it('returns 503 when memory not active', async () => {
    const res = await fetch(`${baseUrl}/hindsight/health`)
    expect(res.status).toBe(503)
  })
})
