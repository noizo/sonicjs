/**
 * Unit tests for the AUTH_FORM_RENDER hook feature.
 *
 * Tests are written against the standalone exported handler functions so the
 * module-level globalHookSystem.register() side-effect is not re-triggered
 * inside each test.
 */

import { describe, it, expect } from 'vitest'
import { HookSystemImpl } from '../../plugins/hook-system'
import { HOOKS } from '../../types'
import { authFormRenderHandler as oauthHandler } from '../../plugins/core-plugins/oauth-providers'
import { authFormRenderHandler as magicLinkHandler } from '../../plugins/available/magic-link-auth'

// Minimal HookContext shape expected by HookHandler
const hookCtx = { plugin: '', context: {} as any }

// Helper: build a minimal mock D1Database
function mockDb(pluginRows: Record<string, { settings?: string; status?: string }>) {
  return {
    prepare: (sql: string) => ({
      first: async () => {
        // Extract id from SQL WHERE clause: `WHERE id = 'some-id'`
        const match = sql.match(/WHERE id = '([^']+)'/)
        if (!match) return null
        const id = match[1]
        return pluginRows[id] ?? null
      }
    })
  }
}

// ─── oauth-providers handler ──────────────────────────────────────────────────

describe('oauthHandler (AUTH_FORM_RENDER)', () => {
  it('returns null when db is missing', async () => {
    const result = await oauthHandler({}, hookCtx)
    expect(result).toBeNull()
  })

  it('returns null when plugins row is absent', async () => {
    const db = mockDb({})
    const result = await oauthHandler({ db }, hookCtx)
    expect(result).toBeNull()
  })

  it('returns null when no provider is enabled', async () => {
    const db = mockDb({
      'oauth-providers': {
        settings: JSON.stringify({
          providers: {
            google: { enabled: false, clientId: 'x', clientSecret: 'y' },
            github: { enabled: false, clientId: 'x', clientSecret: 'y' }
          }
        })
      }
    })
    const result = await oauthHandler({ db }, hookCtx)
    expect(result).toBeNull()
  })

  it('returns Google button when Google is enabled', async () => {
    const db = mockDb({
      'oauth-providers': {
        settings: JSON.stringify({
          providers: {
            google: { enabled: true, clientId: 'gid', clientSecret: 'gsec' }
          }
        })
      }
    })
    const result = await oauthHandler({ db }, hookCtx)
    expect(typeof result).toBe('string')
    expect(result).toContain('/auth/oauth/google')
    expect(result).toContain('Google')
  })

  it('returns GitHub button when GitHub is enabled', async () => {
    const db = mockDb({
      'oauth-providers': {
        settings: JSON.stringify({
          providers: {
            github: { enabled: true, clientId: 'ghid', clientSecret: 'ghsec' }
          }
        })
      }
    })
    const result = await oauthHandler({ db }, hookCtx)
    expect(typeof result).toBe('string')
    expect(result).toContain('/auth/oauth/github')
    expect(result).toContain('GitHub')
  })
})

// ─── magic-link handler ───────────────────────────────────────────────────────

describe('magicLinkHandler (AUTH_FORM_RENDER)', () => {
  it('returns null when email plugin is not active', async () => {
    const db = mockDb({ email: { status: 'inactive' } })
    const result = await magicLinkHandler({ db }, hookCtx)
    expect(result).toBeNull()
  })

  it('returns button HTML when email plugin is active', async () => {
    const db = mockDb({ email: { status: 'active' } })
    const result = await magicLinkHandler({ db }, hookCtx)
    expect(typeof result).toBe('string')
    expect(result).toContain('/auth/magic-link/request')
    expect(result).toContain('magic-link-email')
  })
})

// ─── HookSystemImpl integration ───────────────────────────────────────────────

describe('HookSystemImpl collects multiple AUTH_FORM_RENDER handlers', () => {
  it('getHooks returns all registered handlers in priority order', async () => {
    const hs = new HookSystemImpl()
    const order: number[] = []

    hs.register(HOOKS.AUTH_FORM_RENDER, async () => { order.push(1); return 'a' }, 10)
    hs.register(HOOKS.AUTH_FORM_RENDER, async () => { order.push(2); return 'b' }, 20)

    const hooks = hs.getHooks(HOOKS.AUTH_FORM_RENDER)
    expect(hooks).toHaveLength(2)

    const ctx = { plugin: '', context: {} as any }
    const results = await Promise.all(hooks.map(h => h.handler({}, ctx)))
    expect(results).toEqual(['a', 'b'])
    expect(order).toEqual([1, 2])
  })
})
