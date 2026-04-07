import type { Context, Next } from 'hono'
import type { Bindings, Variables } from '../../../../app'
import { SecurityAuditService } from '../services/security-audit-service'
import { BruteForceDetector } from '../services/brute-force-detector'
import { PluginService } from '../../../../services'
import type { SecurityAuditSettings, SecurityEventType } from '../types'
import { DEFAULT_SETTINGS } from '../types'

function extractRequestInfo(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  const userAgent = c.req.header('user-agent') || 'unknown'
  const countryCode = c.req.header('cf-ipcountry') || null
  const path = new URL(c.req.url).pathname
  const method = c.req.method

  return { ip, userAgent, countryCode, path, method }
}

function generateFingerprint(ip: string, userAgent: string): string {
  // Simple fingerprint from IP + UA - using a basic hash
  const str = `${ip}:${userAgent}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

async function getPluginSettings(db: any): Promise<SecurityAuditSettings> {
  try {
    const pluginService = new PluginService(db)
    const plugin = await pluginService.getPlugin('security-audit')
    if (plugin?.settings) {
      const settings = typeof plugin.settings === 'string' ? JSON.parse(plugin.settings) : plugin.settings
      return { ...DEFAULT_SETTINGS, ...settings }
    }
  } catch {
    // Plugin not installed or DB not ready
  }
  return DEFAULT_SETTINGS
}

async function isPluginActive(db: any): Promise<boolean> {
  try {
    const result = await db.prepare(
      "SELECT status FROM plugins WHERE id = 'security-audit'"
    ).first() as { status: string } | null
    return result?.status === 'active'
  } catch {
    return false
  }
}

export function securityAuditMiddleware() {
  return async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
    const path = new URL(c.req.url).pathname

    // Only intercept auth-related routes
    if (!path.startsWith('/auth/')) {
      return next()
    }

    const db = c.env.DB

    // Check if plugin is active
    if (!await isPluginActive(db)) {
      return next()
    }

    const settings = await getPluginSettings(db)
    const { ip, userAgent, countryCode, method } = extractRequestInfo(c)
    const fingerprint = generateFingerprint(ip, userAgent)

    // For login POST, check lockout before proceeding
    if (path === '/auth/login' && method === 'POST') {
      let email = ''
      try {
        // Clone the request to read body without consuming it
        const body = await c.req.json()
        email = body?.email?.toLowerCase() || ''
        // We need to re-set the body - but Hono caches parsed JSON so this works
      } catch {
        // Can't parse body, continue
      }

      if (email && settings.bruteForce.enabled) {
        const detector = new BruteForceDetector(c.env.CACHE_KV, settings.bruteForce)
        const lockStatus = await detector.isLocked(ip, email)

        if (lockStatus.locked) {
          const service = new SecurityAuditService(db, settings)
          // Log the blocked attempt asynchronously
          const logPromise = service.logEvent({
            eventType: 'login_failure',
            severity: 'warning',
            email,
            ipAddress: ip,
            userAgent,
            countryCode: countryCode || undefined,
            requestPath: path,
            requestMethod: method,
            fingerprint,
            blocked: true,
            details: { reason: lockStatus.reason }
          })

          if (c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(logPromise)
          }

          return c.json({
            error: lockStatus.reason || 'Too many failed attempts. Please try again later.'
          }, 429)
        }
      }
    }

    // Proceed with the request
    await next()

    // After response, log the event asynchronously
    const logPromise = logAuthEvent(c, db, settings, ip, userAgent, countryCode, fingerprint, path, method)

    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(logPromise)
    }
  }
}

async function logAuthEvent(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  db: any,
  settings: SecurityAuditSettings,
  ip: string,
  userAgent: string,
  countryCode: string | null,
  fingerprint: string,
  path: string,
  method: string
): Promise<void> {
  try {
    const service = new SecurityAuditService(db, settings)
    const status = c.res.status

    // Login POST
    if (path === '/auth/login' && method === 'POST') {
      if (status === 200) {
        if (!settings.logging.logSuccessfulLogins) return

        // Try to get user info from response
        let email = ''
        let userId = ''
        try {
          const cloned = c.res.clone()
          const body = await cloned.json() as any
          email = body?.user?.email || ''
          userId = body?.user?.id || ''
        } catch { /* ignore */ }

        await service.logEvent({
          eventType: 'login_success',
          severity: 'info',
          userId: userId || undefined,
          email: email || undefined,
          ipAddress: ip,
          userAgent,
          countryCode: countryCode || undefined,
          requestPath: path,
          requestMethod: method,
          fingerprint
        })
      } else if (status === 401 || status === 400) {
        // Failed login
        let email = ''
        try {
          // The original request body was already parsed by the route handler
          // We can't re-read it, but we can try to get the email from the error context
        } catch { /* ignore */ }

        await service.logEvent({
          eventType: 'login_failure',
          severity: 'warning',
          email: email || undefined,
          ipAddress: ip,
          userAgent,
          countryCode: countryCode || undefined,
          requestPath: path,
          requestMethod: method,
          fingerprint,
          details: { statusCode: status }
        })

        // Record failed attempt for brute-force detection
        if (email && settings.bruteForce.enabled) {
          const detector = new BruteForceDetector(c.env.CACHE_KV, settings.bruteForce)
          const result = await detector.recordFailedAttempt(ip, email)

          if (result.shouldLockIP) {
            await detector.lockIP(ip)
            await service.logEvent({
              eventType: 'account_lockout',
              severity: 'critical',
              email,
              ipAddress: ip,
              userAgent,
              countryCode: countryCode || undefined,
              requestPath: path,
              requestMethod: method,
              fingerprint,
              details: { reason: 'brute_force_ip', attemptCount: result.ipCount }
            })
          }

          if (result.shouldLockEmail) {
            await detector.lockEmail(email)
            await service.logEvent({
              eventType: 'account_lockout',
              severity: 'critical',
              email,
              ipAddress: ip,
              userAgent,
              countryCode: countryCode || undefined,
              requestPath: path,
              requestMethod: method,
              fingerprint,
              details: { reason: 'brute_force_email', attemptCount: result.emailCount }
            })
          }

          if (result.isSuspicious) {
            await service.logEvent({
              eventType: 'suspicious_activity',
              severity: 'critical',
              ipAddress: ip,
              userAgent,
              countryCode: countryCode || undefined,
              requestPath: path,
              requestMethod: method,
              fingerprint,
              details: { reason: 'multiple_emails_from_ip', ipCount: result.ipCount }
            })
          }
        }
      }
    }

    // Registration POST
    if (path === '/auth/register' && method === 'POST' && settings.logging.logRegistrations) {
      if (status === 201 || status === 200) {
        let email = ''
        let userId = ''
        try {
          const cloned = c.res.clone()
          const body = await cloned.json() as any
          email = body?.user?.email || ''
          userId = body?.user?.id || ''
        } catch { /* ignore */ }

        await service.logEvent({
          eventType: 'registration',
          severity: 'info',
          userId: userId || undefined,
          email: email || undefined,
          ipAddress: ip,
          userAgent,
          countryCode: countryCode || undefined,
          requestPath: path,
          requestMethod: method,
          fingerprint
        })
      }
    }

    // Logout
    if (path === '/auth/logout' && settings.logging.logLogouts) {
      const user = c.get('user')
      await service.logEvent({
        eventType: 'logout',
        severity: 'info',
        userId: user?.userId,
        email: user?.email,
        ipAddress: ip,
        userAgent,
        countryCode: countryCode || undefined,
        requestPath: path,
        requestMethod: method,
        fingerprint
      })
    }
  } catch (error) {
    console.error('[SecurityAudit] Error logging auth event:', error)
  }
}
