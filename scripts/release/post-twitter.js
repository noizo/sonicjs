#!/usr/bin/env node

/**
 * Twitter/X Post Script for Release Announcements
 *
 * Uses Twitter API v2 to post release announcements as a single long-form
 * post (X Premium supports up to 25,000 chars). Requires OAuth 1.0a User
 * Context authentication.
 *
 * Environment (loaded from ~/Dropbox/Data/.env):
 *   TWITTER_API_KEY - Twitter API Key (Consumer Key)
 *   TWITTER_API_SECRET - Twitter API Secret (Consumer Secret)
 *   TWITTER_ACCESS_TOKEN - User Access Token
 *   TWITTER_ACCESS_TOKEN_SECRET - User Access Token Secret
 */

import crypto from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'

// Load environment variables from shared .env file
const envPath = `${homedir()}/Dropbox/Data/.env`
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) {
        process.env[key] = valueParts.join('=')
      }
    }
  }
}

const TWITTER_API_URL = 'https://api.twitter.com/2/tweets'

/**
 * @typedef {Object} TwitterCredentials
 * @property {string} apiKey - Twitter API Key (Consumer Key)
 * @property {string} apiSecret - Twitter API Secret (Consumer Secret)
 * @property {string} accessToken - User Access Token
 * @property {string} accessSecret - User Access Token Secret
 */

/**
 * @typedef {Object} TwitterContent
 * @property {string} text - Main announcement text
 * @property {string[]} hashtags - Hashtags appended at the end
 * @property {string[]} [thread] - Optional additional sections; concatenated
 *   into the same long-form post (one section per double newline). Kept for
 *   backward compatibility with existing release-content.json files.
 */

/**
 * Generate OAuth 1.0a signature for Twitter API
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {Object} params - OAuth parameters
 * @param {TwitterCredentials} credentials - Twitter credentials
 * @returns {string} - OAuth signature
 */
function generateOAuthSignature(method, url, params, credentials) {
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(
      Object.keys(params)
        .sort()
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&')
    )
  ].join('&')

  const signingKey = `${encodeURIComponent(credentials.apiSecret)}&${encodeURIComponent(credentials.accessSecret)}`

  return crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64')
}

/**
 * Generate OAuth 1.0a Authorization header
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {TwitterCredentials} credentials - Twitter credentials
 * @returns {string} - Authorization header value
 */
function generateOAuthHeader(method, url, credentials) {
  const oauthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0'
  }

  const signature = generateOAuthSignature(method, url, oauthParams, credentials)
  oauthParams.oauth_signature = signature

  const headerString = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ')

  return `OAuth ${headerString}`
}

/**
 * Get Twitter credentials from environment variables
 * @returns {TwitterCredentials|null}
 */
function getCredentials() {
  const apiKey = process.env.TWITTER_API_KEY
  const apiSecret = process.env.TWITTER_API_SECRET
  const accessToken = process.env.TWITTER_ACCESS_TOKEN
  const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return null
  }

  return { apiKey, apiSecret, accessToken, accessSecret }
}

// X Premium long-post cap. Free/Basic tiers cap at 280 — the script will
// surface a clear error from the API if the account isn't eligible.
const MAX_POST_LENGTH = 25000

/**
 * Build a single long-form post from the content, combining text, optional
 * sections (formerly "thread"), the release URL, and hashtags.
 * @param {TwitterContent} content - Twitter content
 * @param {string} releaseUrl - URL to the release
 * @returns {string} - Combined post text
 */
function buildLongPost(content, releaseUrl) {
  const sections = [content.text]

  if (content.thread && content.thread.length > 0) {
    sections.push(...content.thread)
  }

  sections.push(releaseUrl)

  if (content.hashtags && content.hashtags.length > 0) {
    const hashtagStr = content.hashtags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ')
    sections.push(hashtagStr)
  }

  return sections.join('\n\n')
}

/**
 * Post a single tweet
 * @param {string} text - Tweet text
 * @param {TwitterCredentials} credentials - Twitter credentials
 * @param {string|null} replyToId - Tweet ID to reply to (for threads)
 * @returns {Promise<Object>} - Twitter API response
 */
async function postSingleTweet(text, credentials, replyToId = null) {
  const authHeader = generateOAuthHeader('POST', TWITTER_API_URL, credentials)

  const body = { text }
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId }
  }

  const response = await fetch(TWITTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} - ${JSON.stringify(data)}`)
  }

  return data
}

/**
 * Post a long-form announcement to Twitter/X as a single post.
 * @param {TwitterContent} content - Content to post (text, hashtags, optional thread sections)
 * @param {string} releaseUrl - URL to the release
 * @param {Object} options - Options
 * @param {boolean} options.dryRun - If true, don't actually post
 * @returns {Promise<Object>} - Result with the tweet ID
 */
export async function postToTwitter(content, releaseUrl, options = {}) {
  const credentials = getCredentials()
  const text = buildLongPost(content, releaseUrl)

  if (options.dryRun) {
    console.log(`🔵 [DRY RUN] Would post (${text.length} chars):`)
    console.log('---')
    console.log(text)
    console.log('---')
    return { dryRun: true, text, length: text.length }
  }

  if (!credentials) {
    console.warn('⚠️  Twitter credentials not configured, skipping Twitter post')
    console.warn('   Required env vars: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET')
    return { skipped: true, reason: 'credentials_missing' }
  }

  if (text.length > MAX_POST_LENGTH) {
    console.error(`❌ Post too long: ${text.length}/${MAX_POST_LENGTH} characters`)
    return { error: true, reason: 'post_too_long', length: text.length }
  }

  try {
    console.log(`   Posting ${text.length} chars...`)
    const result = await postSingleTweet(text, credentials, null)
    const tweetId = result.data.id
    const url = `https://twitter.com/i/status/${tweetId}`

    console.log(`✅ Posted: ${url}`)

    return {
      success: true,
      tweetId,
      url,
      text,
      length: text.length
    }
  } catch (error) {
    console.error('❌ Error posting to Twitter:', error.message)
    return { error: true, message: error.message }
  }
}

/**
 * Verify Twitter credentials are valid
 * @returns {Promise<boolean>}
 */
export async function verifyCredentials() {
  const credentials = getCredentials()

  if (!credentials) {
    return false
  }

  try {
    const url = 'https://api.twitter.com/2/users/me'
    const authHeader = generateOAuthHeader('GET', url, credentials)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    })

    return response.ok
  } catch {
    return false
  }
}
