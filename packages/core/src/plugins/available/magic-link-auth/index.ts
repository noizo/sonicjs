/**
 * Magic Link Authentication Plugin
 *
 * Provides passwordless authentication via email magic links
 * Users receive a secure one-time link to sign in without passwords
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Plugin, PluginContext, HookHandler } from '../../types'
import type { D1Database } from '@cloudflare/workers-types'
import { AuthManager, getJwtExpirySecondsFromDb } from '../../../middleware/auth'
import { EMAIL_SVG, AUTH_CTA_BUTTON_CLASSES } from '../../../templates/icons/auth-icons'
import { globalHookSystem } from '../../hook-system'
import { HOOKS } from '../../types'

const magicLinkRequestSchema = z.object({
  email: z.string().email('Valid email is required')
})

/**
 * AUTH_FORM_RENDER handler for the magic-link-auth plugin.
 *
 * Exported as a standalone function so tests can call it directly without
 * triggering the module-level globalHookSystem.register side-effect.
 *
 * Renders a "Sign in with email link" button + a minimal inline popover with a
 * vanilla-JS submit handler (`window.__sendMagicLink`).
 *
 * Returns null when the `email` plugin dependency is not active in the DB,
 * or when the DB is not available (table missing / not initialised).
 *
 * @param data - `{ db }` — the D1 database instance
 */
export const authFormRenderHandler: HookHandler = async (data: any, _ctx: any): Promise<string | null> => {
  try {
    if (data?.db) {
      const row = await data.db.prepare(
        `SELECT status FROM plugins WHERE id = 'email'`
      ).first() as { status: string } | null
      if (!row || row.status !== 'active') return null
    }
  } catch {
    // DB not ready or table missing — silently skip
    return null
  }

  return `
    <button
      type="button"
      onclick="document.getElementById('magic-link-popover').classList.toggle('hidden')"
      class="${AUTH_CTA_BUTTON_CLASSES}"
    >
      <span class="h-5 w-5 shrink-0">${EMAIL_SVG}</span>
      <span>Sign in with email link</span>
    </button>
    <div id="magic-link-popover" class="hidden mt-2 rounded-lg bg-zinc-800 p-4 ring-1 ring-white/10">
      <label for="magic-link-email" class="block text-sm font-medium text-white mb-2">Your email address</label>
      <div class="flex gap-2">
        <input
          id="magic-link-email"
          type="email"
          placeholder="you@example.com"
          class="flex-1 rounded-lg bg-zinc-700 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
        >
        <button
          type="button"
          onclick="window.__sendMagicLink && window.__sendMagicLink()"
          class="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-100 transition-colors"
        >Send link</button>
      </div>
      <p id="magic-link-msg" class="mt-2 text-xs text-zinc-400"></p>
      <script>
        window.__sendMagicLink = async function() {
          var email = document.getElementById('magic-link-email').value;
          var msg = document.getElementById('magic-link-msg');
          if (!email) { msg.textContent = 'Please enter your email.'; return; }
          try {
            var res = await fetch('/auth/magic-link/request', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email })
            });
            var json = await res.json();
            msg.textContent = json.message || json.error || 'Done.';
          } catch(e) {
            msg.textContent = 'Request failed. Please try again.';
          }
        };
      </script>
    </div>`
}

export function createMagicLinkAuthPlugin(): Plugin {
  const magicLinkRoutes = new Hono()

  // Request a magic link
  magicLinkRoutes.post('/request', async (c: any) => {
    try {
      const body = await c.req.json()
      const validation = magicLinkRequestSchema.safeParse(body)

      if (!validation.success) {
        return c.json({
          error: 'Validation failed',
          details: validation.error.issues
        }, 400)
      }

      const { email } = validation.data
      const normalizedEmail = email.toLowerCase()
      const db = c.env.DB as D1Database

      // Check rate limiting
      const oneHourAgo = Date.now() - (60 * 60 * 1000)
      const recentLinks = await db.prepare(`
        SELECT COUNT(*) as count
        FROM magic_links
        WHERE user_email = ? AND created_at > ?
      `).bind(normalizedEmail, oneHourAgo).first() as any

      const rateLimitPerHour = 5 // TODO: Get from plugin settings
      if (recentLinks && recentLinks.count >= rateLimitPerHour) {
        return c.json({
          error: 'Too many requests. Please try again later.'
        }, 429)
      }

      // Check if user exists
      const user = await db.prepare(`
        SELECT id, email, role, is_active
        FROM users
        WHERE email = ?
      `).bind(normalizedEmail).first() as any

      const allowNewUsers = false // TODO: Get from plugin settings

      if (!user && !allowNewUsers) {
        // Don't reveal if user exists or not for security
        return c.json({
          message: 'If an account exists for this email, you will receive a magic link shortly.'
        })
      }

      if (user && !user.is_active) {
        return c.json({
          error: 'This account has been deactivated.'
        }, 403)
      }

      // Generate secure token
      const token = crypto.randomUUID() + '-' + crypto.randomUUID()
      const tokenId = crypto.randomUUID()
      const linkExpiryMinutes = 15 // TODO: Get from plugin settings
      const expiresAt = Date.now() + (linkExpiryMinutes * 60 * 1000)

      // Store magic link
      await db.prepare(`
        INSERT INTO magic_links (
          id, user_email, token, expires_at, used, created_at, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      `).bind(
        tokenId,
        normalizedEmail,
        token,
        expiresAt,
        Date.now(),
        c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown',
        c.req.header('user-agent') || 'unknown'
      ).run()

      // Generate magic link URL
      const baseUrl = new URL(c.req.url).origin
      const magicLink = `${baseUrl}/auth/magic-link/verify?token=${token}`

      // Send email via email plugin
      try {
        const emailPlugin = c.env.plugins?.get('email')
        if (emailPlugin && emailPlugin.sendEmail) {
          await emailPlugin.sendEmail({
            to: normalizedEmail,
            subject: 'Your Magic Link to Sign In',
            html: renderMagicLinkEmail(magicLink, linkExpiryMinutes)
          })
        } else {
          console.error('Email plugin not available')
          // In production, this should fail. For now, log the link for testing
          console.log(`Magic link for ${normalizedEmail}: ${magicLink}`)
        }
      } catch (error) {
        console.error('Failed to send magic link email:', error)
        return c.json({
          error: 'Failed to send email. Please try again later.'
        }, 500)
      }

      return c.json({
        message: 'If an account exists for this email, you will receive a magic link shortly.',
        // For development only - remove in production
        ...(c.env.ENVIRONMENT === 'development' && { dev_link: magicLink })
      })
    } catch (error) {
      console.error('Magic link request error:', error)
      return c.json({ error: 'Failed to process request' }, 500)
    }
  })

  // Verify magic link and sign in
  magicLinkRoutes.get('/verify', async (c: any) => {
    try {
      const token = c.req.query('token')

      if (!token) {
        return c.redirect('/auth/login?error=Invalid magic link')
      }

      const db = c.env.DB as D1Database

      // Find magic link
      const magicLink = await db.prepare(`
        SELECT * FROM magic_links
        WHERE token = ? AND used = 0
      `).bind(token).first() as any

      if (!magicLink) {
        return c.redirect('/auth/login?error=Invalid or expired magic link')
      }

      // Check expiration
      if (magicLink.expires_at < Date.now()) {
        return c.redirect('/auth/login?error=This magic link has expired')
      }

      // Get or create user
      let user = await db.prepare(`
        SELECT * FROM users WHERE email = ? AND is_active = 1
      `).bind(magicLink.user_email).first() as any

      const allowNewUsers = false // TODO: Get from plugin settings

      if (!user && allowNewUsers) {
        // Create new user
        const userId = crypto.randomUUID()
        const username = magicLink.user_email.split('@')[0]
        const now = Date.now()

        await db.prepare(`
          INSERT INTO users (
            id, email, username, first_name, last_name,
            password_hash, role, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 'viewer', 1, ?, ?)
        `).bind(
          userId,
          magicLink.user_email,
          username,
          username,
          '',
          now,
          now
        ).run()

        user = {
          id: userId,
          email: magicLink.user_email,
          username,
          role: 'viewer'
        }
      } else if (!user) {
        return c.redirect('/auth/login?error=No account found for this email')
      }

      // Mark magic link as used
      await db.prepare(`
        UPDATE magic_links
        SET used = 1, used_at = ?
        WHERE id = ?
      `).bind(Date.now(), magicLink.id).run()

      // Generate JWT token
      const tokenTtl = await getJwtExpirySecondsFromDb((c.env as any).DB, c.env as any)
      const jwtToken = await AuthManager.generateToken(
        user.id,
        user.email,
        user.role,
        (c.env as any).JWT_SECRET,
        tokenTtl
      )

      // Set auth cookie
      AuthManager.setAuthCookie(c, jwtToken, { maxAge: tokenTtl })

      // Update last login
      await db.prepare(`
        UPDATE users SET last_login_at = ? WHERE id = ?
      `).bind(Date.now(), user.id).run()

      // Redirect to admin dashboard
      return c.redirect('/admin/dashboard?message=Successfully signed in')
    } catch (error) {
      console.error('Magic link verification error:', error)
      return c.redirect('/auth/login?error=Authentication failed')
    }
  })

  return {
    name: 'magic-link-auth',
    version: '1.0.0',
    description: 'Passwordless authentication via email magic links',
    author: {
      name: 'SonicJS Team',
      email: 'team@sonicjs.com'
    },
    dependencies: ['email'],

    hooks: [{
      name: HOOKS.AUTH_FORM_RENDER,
      handler: authFormRenderHandler,
      priority: 20,
      description: 'Renders a magic-link sign-in button on the auth forms'
    }],

    routes: [{
      path: '/auth/magic-link',
      handler: magicLinkRoutes,
      description: 'Magic link authentication endpoints',
      requiresAuth: false
    }],

    async install(context: PluginContext) {
      console.log('Installing magic-link-auth plugin...')
      // Migration is handled by plugin system
    },

    async activate(context: PluginContext) {
      console.log('Magic link authentication activated')
      console.log('Users can now sign in via /auth/magic-link/request')
    },

    async deactivate(context: PluginContext) {
      console.log('Magic link authentication deactivated')
    },

    async uninstall(context: PluginContext) {
      console.log('Uninstalling magic-link-auth plugin...')
      // Optionally clean up magic_links table
      // await context.db.prepare('DROP TABLE IF EXISTS magic_links').run()
    }
  }
}

/**
 * Render magic link email template
 */
function renderMagicLinkEmail(magicLink: string, expiryMinutes: number): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Magic Link</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: #ffffff;
          border-radius: 8px;
          padding: 40px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .header h1 {
          color: #0ea5e9;
          margin: 0;
          font-size: 24px;
        }
        .content {
          margin-bottom: 30px;
        }
        .button {
          display: inline-block;
          padding: 14px 32px;
          background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%);
          color: #ffffff !important;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          text-align: center;
          margin: 20px 0;
        }
        .button:hover {
          opacity: 0.9;
        }
        .expiry {
          color: #ef4444;
          font-size: 14px;
          margin-top: 20px;
        }
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 12px;
          color: #6b7280;
          text-align: center;
        }
        .security-note {
          background: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 12px 16px;
          margin-top: 20px;
          border-radius: 4px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔗 Your Magic Link</h1>
        </div>

        <div class="content">
          <p>Hello!</p>
          <p>You requested a magic link to sign in to your account. Click the button below to continue:</p>

          <div style="text-align: center;">
            <a href="${magicLink}" class="button">Sign In</a>
          </div>

          <p class="expiry">⏰ This link expires in ${expiryMinutes} minutes</p>

          <div class="security-note">
            <strong>Security Notice:</strong> If you didn't request this link, you can safely ignore this email.
            Someone may have entered your email address by mistake.
          </div>
        </div>

        <div class="footer">
          <p>This is an automated email from SonicJS.</p>
          <p>For security, this link can only be used once.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

// Register with the module-level singleton so auth routes pick up this handler
// even when PluginManager.install() is not called (the current app.ts pattern).
globalHookSystem.register(HOOKS.AUTH_FORM_RENDER, authFormRenderHandler, 20)

export default createMagicLinkAuthPlugin()
