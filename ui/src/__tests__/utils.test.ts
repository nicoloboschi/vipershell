import { describe, it, expect } from 'vitest'
import { tildefy, relativeTime } from '../utils'

describe('tildefy', () => {
  it('returns null/undefined passthrough', () => {
    expect(tildefy(null)).toBeNull()
    expect(tildefy(undefined)).toBeUndefined()
    expect(tildefy('')).toBe('')
  })

  it('returns path unchanged when no username', () => {
    expect(tildefy('/Users/john/code')).toBe('/Users/john/code')
    expect(tildefy('/Users/john/code', undefined)).toBe('/Users/john/code')
  })

  it('replaces macOS home prefix with ~', () => {
    expect(tildefy('/Users/john/code/project', 'john')).toBe('~/code/project')
  })

  it('replaces exact macOS home with ~', () => {
    expect(tildefy('/Users/john', 'john')).toBe('~')
  })

  it('replaces Linux home prefix with ~', () => {
    expect(tildefy('/home/john/code', 'john')).toBe('~/code')
  })

  it('replaces exact Linux home with ~', () => {
    expect(tildefy('/home/john', 'john')).toBe('~')
  })

  it('does not replace partial username match', () => {
    expect(tildefy('/Users/johnny/code', 'john')).toBe('/Users/johnny/code')
  })

  it('does not replace different user', () => {
    expect(tildefy('/Users/alice/code', 'bob')).toBe('/Users/alice/code')
  })

  it('does not touch paths outside home', () => {
    expect(tildefy('/tmp/stuff', 'john')).toBe('/tmp/stuff')
    expect(tildefy('/var/log', 'john')).toBe('/var/log')
  })
})

describe('relativeTime', () => {
  it('returns null for falsy values', () => {
    expect(relativeTime(null)).toBeNull()
    expect(relativeTime(undefined)).toBeNull()
    expect(relativeTime(0)).toBeNull()
  })

  it('returns "just now" for < 10 seconds', () => {
    const now = Date.now()
    expect(relativeTime(now)).toBe('just now')
    expect(relativeTime(now - 5000)).toBe('just now')
  })

  it('returns seconds for < 60 seconds', () => {
    const result = relativeTime(Date.now() - 30_000)
    expect(result).toMatch(/^\d+s ago$/)
  })

  it('returns minutes for < 60 minutes', () => {
    const result = relativeTime(Date.now() - 5 * 60_000)
    expect(result).toBe('5m ago')
  })

  it('returns hours for < 24 hours', () => {
    const result = relativeTime(Date.now() - 3 * 3600_000)
    expect(result).toBe('3h ago')
  })

  it('returns days for >= 24 hours', () => {
    const result = relativeTime(Date.now() - 2 * 86400_000)
    expect(result).toBe('2d ago')
  })
})
