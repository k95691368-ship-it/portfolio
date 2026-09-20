import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createLocalDatabase } from './database.mjs'
import { createLocalStorage, privateDirectory, inside } from './storage.mjs'
import { createLocalMailbox } from './mail.mjs'
import { acquireLocalLock } from './lock.mjs'
import { projectRoot, buildDirectory } from './build.mjs'

export const defaultDataDirectory = join(tmpdir(), `portfolio-local-${createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)}`)
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' }

function headerRules(source) {
  const rules = []
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const pattern = line.trim().split('/').map(part => part === '*' ? '.*' : part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')
      rules.push({ pattern: new RegExp(`^${pattern}$`), headers: [] })
    } else if (rules.length) rules.at(-1).headers.push(line.trim())
  }
  return rules
}

function localHeaders(rules, path) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'X-Portfolio-Environment': 'local' })
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue
    for (const entry of rule.headers) {
      if (entry.startsWith('! ')) { headers.delete(entry.slice(2)); continue }
      const separator = entry.indexOf(':')
      if (separator > 0) headers.set(entry.slice(0, separator), entry.slice(separator + 1).trim())
    }
  }
  const csp = headers.get('Content-Security-Policy')
  if (csp) headers.set('Content-Security-Policy', csp.split(';').map(entry => entry.trim())
    .filter(entry => entry && entry !== 'upgrade-insecure-requests')
    .map(entry => entry.startsWith('connect-src ') ? "connect-src 'self'" : entry.startsWith('media-src ') ? "media-src 'self' blob:" : entry).join('; '))
  // Do not persist HTTPS-only policy for a deliberately HTTP loopback origin.
  headers.delete('Strict-Transport-Security')
  return headers
}

function mailboxPage(messages, origin) {
  const linkedText = text => text.split(/(http:\/\/127\.0\.0\.1:\d+\/[^\s]+)/g).map(part => {
    try {
      const url = new URL(part)
      if (url.origin === origin && ['/verify-email', '/reset-password', '/application-manage', '/application-status', '/jobs'].includes(url.pathname)) {
        return `<a href="${escapeHtml(url.href)}" rel="noreferrer">${escapeHtml(part)}</a>`
      }
    } catch { /* Ordinary message text. */ }
    return escapeHtml(part)
  }).join('')
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>로컬 메일함 · 외부 발송 없음</title><style>body{font:16px/1.6 system-ui;margin:32px;max-width:960px}article{border:1px solid #ddd;padding:24px;margin:24px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#0067b8}</style>
    <h1>로컬 메일함</h1><p>이 환경에서 생성한 확인용 메일입니다. 실제 수신자에게 발송되지 않습니다. 실제 개인정보를 입력하지 마세요.</p>
    <p><a href="/">사이트로 돌아가기</a> · <a href="/__local/mail">새로고침</a></p>
    ${messages.length ? messages.map(row => `<article><h2>${escapeHtml(row.subject)}</h2><p>수신: ${escapeHtml(row.to)} · ${escapeHtml(row.createdAt)}</p><pre>${linkedText(row.text)}</pre><p>첨부 ${Number(row.attachmentCount) || 0}개 (내용은 메일함에 별도 복제하지 않음)</p></article>`).join('') : '<p>아직 메일이 없습니다.</p>'}</html>`
}

export async function startLocalRuntime({ port = 5173, dataDirectory = defaultDataDirectory, siteDirectory = join(buildDirectory, 'site'),
  apiFile = join(buildDirectory, 'api.mjs') } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid loopback port')
  const site = await realpath(siteDirectory)
  const rules = headerRules(await readFile(join(site, '_headers'), 'utf8'))
  const { dispatch, routeCount } = await import(`${pathToFileURL(apiFile).href}?build=${(await stat(apiFile)).mtimeMs}`)
  const state = await privateDirectory(resolve(dataDirectory))
  const releaseLock = await acquireLocalLock(state)
  let database
  try { database = await createLocalDatabase({ dataDir: join(state, 'database') }) }
  catch (error) { await releaseLock(); throw error }
  let origin, mailbox, env
  const server = createServer(async (req, res) => {
    const send = async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (req.method === 'HEAD' || !response.body) { res.end(); return }
      try {
        await pipeline(Readable.fromWeb(response.body), res)
      } catch { res.destroy() }
    }
    const failure = status => new Response('Local request rejected', { status, headers: localHeaders([], '/') })
    if (!env) return send(failure(503))
    // Bind AND validate Host/Origin: a hostile page or DNS rebinding cannot read
    // the local mail links, submit forms, or reuse local authenticated requests.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site') return send(failure(403))
    let path
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return send(failure(400))
      path = decodeURIComponent(new URL(req.url, origin).pathname)
      if (path.includes('\\') || Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
          path.split('/').some(part => part === '..' || part.startsWith('.'))) return send(failure(400))
      if (path === '/__local/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(failure(405))
        return send(new Response(JSON.stringify({ environment: 'local', externalRequests: false, emailDelivery: 'local-mailbox-only',
          routes: routeCount, migrations: database.migrations }), { headers: { ...Object.fromEntries(localHeaders([], path)), 'Content-Type': 'application/json' } }))
      }
      if (path === '/__local/mail') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(failure(405))
        return send(new Response(mailboxPage(await mailbox.list(), origin), { headers: { ...Object.fromEntries(localHeaders([], path)),
          'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } }))
      }
      if (path === '/api' || path.startsWith('/api/')) {
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        headers.set('CF-Connecting-IP', req.socket.remoteAddress || 'loopback')
        const init = { method: req.method, headers, signal: AbortSignal.timeout(30_000) }
        if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half' }
        const response = await dispatch(new Request(new URL(req.url, origin), init), env)
        response.headers.set('X-Portfolio-Environment', 'local')
        return send(response)
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(failure(405))
      if (path.startsWith('/__local/') || path.startsWith('/_')) return send(failure(404))
      let file = join(site, path === '/' ? 'index.html' : path)
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') }
      catch (error) { if (error.code !== 'ENOENT') throw error; file = extname(path) ? null : join(site, 'index.html') }
      if (!file) return send(failure(404))
      const real = await realpath(file)
      if (!inside(site, real)) return send(failure(403))
      let content = await readFile(real)
      const type = types[extname(real)]
      if (!type) return send(failure(404))
      if (type.startsWith('text/html')) content = Buffer.from(content.toString('utf8').replace('<title>', '<title>로컬 · ')
        .replace('</body>', '<a href="/__local/mail" style="position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 10px;border-radius:4px;background:#171717;color:white;font:12px system-ui">로컬 검증 · 메일함 (외부 발송 없음)</a></body>'))
      const headers = localHeaders(rules, path)
      headers.set('Content-Type', type)
      return send(new Response(content, { headers }))
    } catch (error) {
      return send(failure(error.code === 'ENOENT' ? 404 : 500))
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  try {
    await new Promise((ready, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ready) })
    origin = `http://127.0.0.1:${server.address().port}`
    mailbox = await createLocalMailbox(join(state, 'mail'), origin)
    env = { LOCAL_ONLY: true, LOCAL_MAILBOX: mailbox, DB: database.db,
      DOCUMENTS: await createLocalStorage(join(state, 'documents')),
      INTERVIEW_RECORDINGS: await createLocalStorage(join(state, 'recordings')),
      FINAL_OFFER_FROM_EMAIL: 'local@example.invalid', FINAL_OFFER_FROM_NAME: '로컬 검증',
    }
  } catch (error) { server.close(); await database.close(); await releaseLock(); throw error }
  return { origin, database, mailbox, env, server,
    async close() {
      try { await new Promise(done => { server.close(done); server.closeIdleConnections() }); await database.close() }
      finally { await releaseLock() }
    },
  }
}
