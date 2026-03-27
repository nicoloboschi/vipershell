import { describe, it, expect, beforeEach } from 'vitest'
import useStore from '../store'
import type { Session } from '../store'
import { addCommandEntry, getCommandHistory, clearCommandHistory } from '../store'

const makeSession = (id: string, name: string, path = '/tmp'): Session => ({
  id,
  name,
  path,
  username: 'test',
  last_activity: Date.now(),
})

describe('useStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useStore.setState({
      sessions: [],
      currentSessionId: null,
      sessionPreviews: {},
      sessionBusy: {},
      sessionHasUnseen: {},
      sessionLastEvent: {},
      sessionOrder: [],
      sessionMap: {},
      sessionUrls: {},
      sessionLastCommand: {},
      sessionCurrentInput: {},
      wsStatus: 'connecting',
      sheetOpen: false,
      confirm: null,
    })
  })

  describe('setWsStatus', () => {
    it('updates ws status', () => {
      useStore.getState().setWsStatus('connected')
      expect(useStore.getState().wsStatus).toBe('connected')
    })
  })

  describe('setSheetOpen', () => {
    it('toggles sheet state', () => {
      useStore.getState().setSheetOpen(true)
      expect(useStore.getState().sheetOpen).toBe(true)

      useStore.getState().setSheetOpen(false)
      expect(useStore.getState().sheetOpen).toBe(false)
    })
  })

  describe('renderSessions', () => {
    it('stores sessions and builds sessionMap', () => {
      const sessions = [makeSession('$0', 'shell'), makeSession('$1', 'dev')]
      useStore.getState().renderSessions(sessions)

      const state = useStore.getState()
      expect(state.sessions).toHaveLength(2)
      expect(state.sessionMap['$0']).toBeDefined()
      expect(state.sessionMap['$0']!.name).toBe('shell')
      expect(state.sessionMap['$1']!.name).toBe('dev')
    })

    it('builds sessionOrder sorted by id', () => {
      const sessions = [makeSession('$2', 'c'), makeSession('$0', 'a'), makeSession('$1', 'b')]
      useStore.getState().renderSessions(sessions)

      const { sessionOrder } = useStore.getState()
      expect(sessionOrder).toEqual(['$0', '$1', '$2'])
    })
  })

  describe('setCurrentSessionId', () => {
    it('sets current session', () => {
      useStore.getState().setCurrentSessionId('$0')
      expect(useStore.getState().currentSessionId).toBe('$0')
    })

    it('clears unseen when switching to session', () => {
      useStore.getState().markUnseen('$0')
      expect(useStore.getState().sessionHasUnseen['$0']).toBe(true)

      useStore.getState().setCurrentSessionId('$0')
      expect(useStore.getState().sessionHasUnseen['$0']).toBeFalsy()
    })
  })

  describe('updatePreview', () => {
    it('updates preview text', () => {
      useStore.getState().updatePreview('$0', 'ls output...')
      expect(useStore.getState().sessionPreviews['$0']).toBe('ls output...')
    })

    it('marks unseen when preview changes for non-active session', () => {
      useStore.getState().setCurrentSessionId('$1')
      useStore.getState().updatePreview('$0', 'initial')
      useStore.getState().updatePreview('$0', 'changed')
      expect(useStore.getState().sessionHasUnseen['$0']).toBe(true)
    })

    it('does not mark unseen for active session', () => {
      useStore.getState().setCurrentSessionId('$0')
      useStore.getState().updatePreview('$0', 'initial')
      useStore.getState().updatePreview('$0', 'changed')
      expect(useStore.getState().sessionHasUnseen['$0']).toBeUndefined()
    })
  })

  describe('unseen tracking', () => {
    it('marks and clears unseen', () => {
      useStore.getState().markUnseen('$0')
      expect(useStore.getState().sessionHasUnseen['$0']).toBe(true)

      useStore.getState().clearUnseen('$0')
      // clearUnseen deletes the key
      expect(useStore.getState().sessionHasUnseen['$0']).toBeUndefined()
    })

    it('does not mark current session as unseen', () => {
      useStore.getState().setCurrentSessionId('$0')
      useStore.getState().markUnseen('$0')
      expect(useStore.getState().sessionHasUnseen['$0']).toBeUndefined()
    })
  })

  describe('session URLs', () => {
    it('adds and clears URLs', () => {
      useStore.getState().addSessionUrl('$0', 'http://localhost:3000')
      useStore.getState().addSessionUrl('$0', 'http://localhost:8080')

      expect(useStore.getState().sessionUrls['$0']).toEqual([
        'http://localhost:3000',
        'http://localhost:8080',
      ])

      useStore.getState().clearSessionUrls('$0')
      // clearSessionUrls deletes the key
      expect(useStore.getState().sessionUrls['$0']).toBeUndefined()
    })

    it('does not add duplicate URLs', () => {
      useStore.getState().addSessionUrl('$0', 'http://localhost:3000')
      useStore.getState().addSessionUrl('$0', 'http://localhost:3000')

      expect(useStore.getState().sessionUrls['$0']).toHaveLength(1)
    })
  })

  describe('last command and current input', () => {
    it('stores last command per session', () => {
      useStore.getState().setLastCommand('$0', 'npm test')
      expect(useStore.getState().sessionLastCommand['$0']).toBe('npm test')
    })

    it('stores current input per session', () => {
      useStore.getState().setCurrentInput('$0', 'git st')
      expect(useStore.getState().sessionCurrentInput['$0']).toBe('git st')
    })
  })

  describe('split sessions', () => {
    it('adds and removes split session IDs', () => {
      useStore.getState().addSplitSession('$5')
      expect(useStore.getState().splitSessionIds.has('$5')).toBe(true)

      useStore.getState().removeSplitSession('$5')
      expect(useStore.getState().splitSessionIds.has('$5')).toBe(false)
    })
  })

  describe('confirm dialog', () => {
    it('showConfirm sets confirm state', async () => {
      const promise = useStore.getState().showConfirm('Delete session?')

      const { confirm } = useStore.getState()
      const c = confirm
      expect(c).not.toBeNull()
      expect(c!.message).toBe('Delete session?')

      // Resolve it
      useStore.getState().dismissConfirm(true)
      const result = await promise
      expect(result).toBe(true)
    })

    it('dismissConfirm with false rejects', async () => {
      const promise = useStore.getState().showConfirm('Are you sure?')
      useStore.getState().dismissConfirm(false)
      const result = await promise
      expect(result).toBe(false)
    })

    it('dismissConfirm clears confirm state', () => {
      useStore.getState().showConfirm('test')
      useStore.getState().dismissConfirm(true)
      expect(useStore.getState().confirm).toBeNull()
    })
  })

  describe('navigateSession', () => {
    it('returns null when no sessions', () => {
      const result = useStore.getState().navigateSession('down')
      expect(result).toBeNull()
    })

    // navigateSession depends on DOM querySelectorAll('[data-session-id]'),
    // so directional navigation requires component-level tests with rendered elements.
    it('returns null when no DOM elements match', () => {
      const sessions = [makeSession('$0', 'a'), makeSession('$1', 'b')]
      useStore.getState().renderSessions(sessions)
      useStore.getState().setCurrentSessionId('$0')
      // In jsdom without rendered components, no DOM elements exist
      expect(useStore.getState().navigateSession('down')).toBeNull()
    })
  })
})

describe('command history', () => {
  beforeEach(() => {
    clearCommandHistory('test-session')
  })

  it('starts empty', () => {
    expect(getCommandHistory('test-session')).toEqual([])
  })

  it('adds and retrieves commands', () => {
    addCommandEntry('test-session', 'ls -la', 10)
    addCommandEntry('test-session', 'pwd', 15)

    const history = getCommandHistory('test-session')
    expect(history).toHaveLength(2)
    expect(history[0]!.cmd).toBe('ls -la')
    expect(history[0]!.line).toBe(10)
    expect(history[1]!.cmd).toBe('pwd')
  })

  it('skips blank commands', () => {
    addCommandEntry('test-session', '  ', 10)
    expect(getCommandHistory('test-session')).toEqual([])
  })

  it('trims commands', () => {
    addCommandEntry('test-session', '  echo hello  ', 10)
    expect(getCommandHistory('test-session')[0]!.cmd).toBe('echo hello')
  })

  it('clears history for session', () => {
    addCommandEntry('test-session', 'cmd1', 1)
    addCommandEntry('test-session', 'cmd2', 2)
    clearCommandHistory('test-session')
    expect(getCommandHistory('test-session')).toEqual([])
  })

  it('caps history at MAX_HISTORY', () => {
    for (let i = 0; i < 210; i++) {
      addCommandEntry('test-session', `cmd-${i}`, i)
    }
    const history = getCommandHistory('test-session')
    expect(history.length).toBeLessThanOrEqual(200)
    // Should keep the latest entries
    expect(history[history.length - 1]!.cmd).toBe('cmd-209')
  })
})
