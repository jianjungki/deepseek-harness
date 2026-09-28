import { createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const SESSION_COOKIE = '__Host-dsh_policy_session'
const OIDC_STATE_COOKIE = '__Host-dsh_policy_oidc_state'
const OIDC_STATE_MAX_AGE = 600
const SESSION_MAX_AGE = 30 * 24 * 60 * 60

/** Require an HTTPS origin with no path, query, fragment, or credentials. */
export function requireOrigin(value, name) {
  if (value === undefined || value.trim() === '') throw new Error(name + ' is required')
  let url
  try { url = new URL(value) } catch { throw new Error(name + ' must be a valid HTTPS origin') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(name + ' must be an HTTPS origin without credentials, path, query, or fragment')
  }
  return url.origin
}

/** Read and validate deployment configuration. */
export function readConfig(env = process.env) {
  const publicOrigin = requireOrigin(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN')
  const issuer = requireOrigin(env.ZITADEL_ISSUER, 'ZITADEL_ISSUER')
  const clientId = required(env.ZITADEL_CLIENT_ID, 'ZITADEL_CLIENT_ID')
  const clientSecret = optional(env.ZITADEL_CLIENT_SECRET)
  const sessionSecret = required(env.SESSION_SECRET, 'SESSION_SECRET')
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
  const redirectUri = env.ZITADEL_REDIRECT_URI === undefined || env.ZITADEL_REDIRECT_URI.trim() === ''
    ? publicOrigin + '/oauth/callback' : exactHttpsUrl(env.ZITADEL_REDIRECT_URI, 'ZITADEL_REDIRECT_URI')
  if (new URL(redirectUri).origin !== publicOrigin) throw new Error('ZITADEL_REDIRECT_URI must use PUBLIC_ORIGIN')
  const downloadPageUrl = env.DOWNLOAD_PAGE_URL === undefined || env.DOWNLOAD_PAGE_URL.trim() === ''
    ? publicOrigin + '/download' : exactHttpsUrl(env.DOWNLOAD_PAGE_URL, 'DOWNLOAD_PAGE_URL')
  if (new URL(downloadPageUrl).origin !== publicOrigin) throw new Error('DOWNLOAD_PAGE_URL must use PUBLIC_ORIGIN so Desktop can approve it')
  const minDesktopVersion = optionalVersion(env.MIN_DESKTOP_VERSION, 'MIN_DESKTOP_VERSION')
  const policyPlatform = enumValue(env.POLICY_PLATFORM ?? 'all', ['all', 'win32', 'darwin'], 'POLICY_PLATFORM')
  const policyArch = enumValue(env.POLICY_ARCH ?? 'all', ['all', 'x64', 'arm64'], 'POLICY_ARCH')
  const policyChannel = env.POLICY_CHANNEL ?? 'nightly'
  if (!/^[A-Za-z0-9._-]+$/.test(policyChannel)) throw new Error('POLICY_CHANNEL contains unsupported characters')
  return {
    host: env.HOST ?? '127.0.0.1', port: integer(env.PORT ?? '8787', 'PORT', 1, 65535),
    publicOrigin, issuer, clientId, clientSecret, sessionSecret, redirectUri, downloadPageUrl,
    minDesktopVersion, policyPlatform, policyArch, policyChannel,
    titleZh: env.UPDATE_TITLE_ZH ?? '请更新 DeepSeek Harness',
    detailZh: env.UPDATE_DETAIL_ZH ?? '当前版本已停止支持，请下载并安装新版本。',
    titleEn: env.UPDATE_TITLE_EN ?? 'Update DeepSeek Harness',
    detailEn: env.UPDATE_DETAIL_EN ?? 'This version is no longer supported. Download and install the latest version.',
  }
}

function required(value, name) {
  if (value === undefined || value.trim() === '') throw new Error(name + ' is required')
  return value
}

function optional(value) {
  return value === undefined || value.trim() === '' ? undefined : value
}

function exactHttpsUrl(value, name) {
  let url
  try { url = new URL(value) } catch { throw new Error(name + ' must be a valid HTTPS URL') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error(name + ' must be an HTTPS URL')
  return url.href
}

function integer(value, name, min, max) {
  if (!/^[0-9]+$/.test(value)) throw new Error(name + ' must be an integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(name + ' is out of range')
  return parsed
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(name + ' must be one of ' + allowed.join(', '))
  return value
}

/** Parse the complete SemVer form used by Desktop headers and policy thresholds. */
export function parseVersion(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  if (match === null) throw new Error('invalid version ' + JSON.stringify(value))
  const prerelease = match[4] === undefined ? [] : match[4].split('.').map((part) => {
    if (/^[0-9]+$/.test(part)) {
      if (part.length > 1 && part.startsWith('0')) throw new Error('invalid numeric prerelease identifier ' + part)
      return Number(part)
    }
    return part
  })
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

function optionalVersion(value, name) {
  if (value === undefined || value.trim() === '') return undefined
  try { return parseVersion(value) } catch (error) { throw new Error(name + ' must be a complete SemVer: ' + error.message) }
}

function compareVersion(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    if (typeof a === 'number' && typeof b === 'string') return -1
    if (typeof a === 'string' && typeof b === 'number') return 1
    return a < b ? -1 : 1
  }
  return 0
}

function isBelow(value, minimum) { return compareVersion(value, minimum) < 0 }

/** Validate the required Desktop request headers. */
export function readClientIdentity(headers) {
  const platformValue = header(headers, 'x-client-platform')
  const platform = platformValue === 'desktop-win' ? 'win32' : platformValue === 'desktop-mac' ? 'darwin' : undefined
  if (platform === undefined) throw clientError('unsupported x-client-platform')
  const version = versionHeader(headers, 'x-client-version')
  const bundledVersion = versionHeader(headers, 'x-client-bundled-dsh-version')
  const arch = header(headers, 'x-client-arch')
  if (arch !== 'x64' && arch !== 'arm64') throw clientError('unsupported x-client-arch')
  if (platform === 'win32' && arch !== 'x64') throw clientError('Windows Desktop supports x64 only')
  const channel = header(headers, 'x-client-update-channel')
  if (channel === undefined || channel === '') throw clientError('missing x-client-update-channel')
  const localeValue = header(headers, 'x-client-locale')
  const locale = localeValue?.startsWith('zh') ? 'zh_CN' : localeValue?.startsWith('en') ? 'en_US' : undefined
  if (locale === undefined) throw clientError('unsupported x-client-locale')
  if (header(headers, 'x-client-bundle-id') === undefined) throw clientError('missing x-client-bundle-id')
  const timezone = header(headers, 'x-client-timezone-offset')
  if (timezone === undefined || !/^-?[0-9]+$/.test(timezone)) throw clientError('invalid x-client-timezone-offset')
  return { platform, arch, version, bundledVersion, channel, locale }
}

function header(headers, name) {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function versionHeader(headers, name) {
  const value = header(headers, name)
  if (value === undefined || value === '') throw clientError('missing ' + name)
  try { return parseVersion(value) } catch { throw clientError('invalid ' + name) }
}

function clientError(message) { return Object.assign(new Error(message), { statusCode: 400, responseCode: 40001 }) }

function noForce() { return { code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: null } } }

function policyResponse(identity, config) {
  if (config.policyPlatform !== 'all' && config.policyPlatform !== identity.platform) return noForce()
  if (config.policyArch !== 'all' && config.policyArch !== identity.arch) return noForce()
  if (identity.channel !== config.policyChannel || config.minDesktopVersion === undefined) return noForce()
  if (!isBelow(identity.version, config.minDesktopVersion) && !isBelow(identity.bundledVersion, config.minDesktopVersion)) return noForce()
  const chinese = identity.locale === 'zh_CN'
  return { code: 40005, msg: 'Client version too low', data: {
    show_content: { title: chinese ? config.titleZh : config.titleEn, detail: chinese ? config.detailZh : config.detailEn },
    desktop_app_link: config.downloadPageUrl,
  } }
}

function base64url(value) { return Buffer.from(value).toString('base64url') }

function seal(value, secret) {
  const encoded = base64url(JSON.stringify(value))
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return encoded + '.' + signature
}

function unseal(value, secret) {
  if (value === undefined) return undefined
  const parts = value.split('.')
  if (parts.length !== 2) return undefined
  const expected = createHmac('sha256', secret).update(parts[0]).digest()
  const actual = Buffer.from(parts[1], 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.exp !== 'number' || parsed.exp < Date.now() / 1000) return undefined
    return parsed
  } catch { return undefined }
}

function cookies(headers) {
  const result = new Map()
  for (const part of (headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) result.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()))
  }
  return result
}

function setCookie(name, value, maxAge) { return name + '=' + encodeURIComponent(value) + '; Max-Age=' + maxAge + '; Path=/; HttpOnly; Secure; SameSite=Lax' }
function clearCookie(name) { return name + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' }
function randomBase64url(size) { return randomBytes(size).toString('base64url') }

async function sha256Base64url(value) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('base64url')
}

async function oidcMetadata(config) {
  const response = await fetch(config.issuer + '/.well-known/openid-configuration', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('Zitadel discovery failed')
  const metadata = await response.json()
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']) {
    if (typeof metadata[key] !== 'string') throw new Error('Zitadel metadata is missing ' + key)
    if (new URL(metadata[key]).origin !== config.issuer) throw new Error('Zitadel metadata has an invalid ' + key)
  }
  return metadata
}

async function beginLogin(response, config) {
  const metadata = await oidcMetadata(config)
  const state = randomBase64url(32)
  const verifier = randomBase64url(48)
  const challenge = await sha256Base64url(verifier)
  const stateValue = seal({ state, verifier, exp: Math.floor(Date.now() / 1000) + OIDC_STATE_MAX_AGE }, config.sessionSecret)
  const authorize = new URL(metadata.authorization_endpoint)
  authorize.searchParams.set('client_id', config.clientId)
  authorize.searchParams.set('redirect_uri', config.redirectUri)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', 'openid profile email')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  response.writeHead(303, { location: authorize.href, 'cache-control': 'no-store', 'set-cookie': setCookie(OIDC_STATE_COOKIE, stateValue, OIDC_STATE_MAX_AGE) })
  response.end()
}

async function completeLogin(request, response, config, url) {
  const stateValue = unseal(cookies(request.headers).get(OIDC_STATE_COOKIE), config.sessionSecret)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (stateValue === undefined || code === null || state === null || state !== stateValue.state) {
    jsonResponse(response, 400, { error: 'invalid_oidc_callback' }, { 'set-cookie': clearCookie(OIDC_STATE_COOKIE) })
    return
  }
  const metadata = await oidcMetadata(config)
  const tokenRequest = { grant_type: 'authorization_code', client_id: config.clientId, code, redirect_uri: config.redirectUri, code_verifier: stateValue.verifier }
  if (config.clientSecret !== undefined) tokenRequest.client_secret = config.clientSecret
  const tokenResponse = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(tokenRequest) })
  if (!tokenResponse.ok) throw new Error('Zitadel token exchange failed')
  const tokens = await tokenResponse.json()
  if (typeof tokens.access_token !== 'string') throw new Error('Zitadel token response has no access_token')
  const userResponse = await fetch(metadata.userinfo_endpoint, { headers: { authorization: 'Bearer ' + tokens.access_token, accept: 'application/json' } })
  if (!userResponse.ok) throw new Error('Zitadel userinfo failed')
  const user = await userResponse.json()
  if (typeof user.sub !== 'string' || user.sub === '') throw new Error('Zitadel userinfo has no subject')
  const sessionValue = seal({ sub: user.sub, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE }, config.sessionSecret)
  response.writeHead(303, { location: '/', 'cache-control': 'no-store', 'set-cookie': [setCookie(SESSION_COOKIE, sessionValue, SESSION_MAX_AGE), clearCookie(OIDC_STATE_COOKIE)] })
  response.end()
}

function authenticated(request, config) { return unseal(cookies(request.headers).get(SESSION_COOKIE), config.sessionSecret) }

function jsonResponse(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders })
  response.end(JSON.stringify(body))
}

function securityHeaders() {
  return { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
}

/** Create the policy service HTTP handler. */
export function createHandler(config) {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', config.publicOrigin)
    const headers = securityHeaders()
    if (request.method === 'GET' && url.pathname === '/healthz') {
      response.writeHead(200, { ...headers, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('ok\\n')
      return
    }
    if (request.method === 'GET' && url.pathname === '/logout') {
      response.writeHead(303, { ...headers, location: '/', 'set-cookie': clearCookie(SESSION_COOKIE) })
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      try { await completeLogin(request, response, config, url) } catch { jsonResponse(response, 502, { error: 'oidc_unavailable' }, headers) }
      return
    }
    if (request.method === 'GET' && url.pathname === '/') {
      if (authenticated(request, config) === undefined) {
        try { await beginLogin(response, config) } catch { jsonResponse(response, 502, { error: 'oidc_unavailable' }, headers) }
        return
      }
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><meta charset=utf-8><title>DeepSeek Harness policy login</title><p>登录成功，可以关闭此窗口。</p>')
      return
    }
    if (request.method === 'GET' && url.pathname === '/download') {
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><meta charset=utf-8><title>DeepSeek Harness download</title><p>请将此地址替换为实际发布下载页面。</p>')
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v0/check_client_update') {
      if (authenticated(request, config) === undefined) {
        jsonResponse(response, 401, { error: { code: 'UNAUTHENTICATED' } }, { ...headers, 'www-authenticate': 'Bearer realm=desktop-policy' })
        return
      }
      try {
        const identity = readClientIdentity(request.headers)
        jsonResponse(response, 200, policyResponse(identity, config), headers)
      } catch (error) {
        const value = typeof error === 'object' && error !== null ? error : {}
        const status = 'statusCode' in value && typeof value.statusCode === 'number' ? value.statusCode : 400
        const code = 'responseCode' in value && typeof value.responseCode === 'number' ? value.responseCode : 40001
        jsonResponse(response, status, { code, msg: error instanceof Error ? error.message : String(error), data: { biz_code: 1, biz_msg: 'invalid request', biz_data: null } }, headers)
      }
      return
    }
    jsonResponse(response, 404, { error: 'not_found' }, headers)
  }
}

/** Start the service when this module is executed directly. */
export function start(config = readConfig()) {
  const handler = createHandler(config)
  const server = createServer((request, response) => { void handler(request, response).catch(() => jsonResponse(response, 500, { error: 'internal_error' }, securityHeaders())) })
  server.listen(config.port, config.host, () => console.log('desktop policy service listening on ' + config.host + ':' + config.port))
  return server
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) start()
