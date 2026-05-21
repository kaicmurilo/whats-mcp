// commands/status.mjs
import http from 'http'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PID_FILE, BASE_URL } from '../lib/config.mjs'
import { readPid, pidExists } from '../lib/pid.mjs'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: LOCAL_VERSION } = require(join(__dirname, '..', 'package.json'))

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, data: JSON.parse(body) }) }
        catch { resolve({ ok: res.statusCode === 200, data: null }) }
      })
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, data: null }) })
    req.on('error', () => resolve({ ok: false, data: null }))
  })
}

export default async function status() {
  const pid = readPid(PID_FILE)
  const processAlive = pid ? pidExists(pid) : false

  const [healthRes, versionRes, sessionRes] = await Promise.all([
    httpGet(`${BASE_URL}/health`),
    httpGet(`${BASE_URL}/version`),
    httpGet(`${BASE_URL}/session/status`, 5000),
  ])

  const runningVersion = versionRes.ok && versionRes.data?.version ? versionRes.data.version : null
  const versionMismatch = runningVersion && runningVersion !== LOCAL_VERSION

  console.log(`Version:  ${LOCAL_VERSION}${runningVersion ? ` (daemon: ${runningVersion}${versionMismatch ? ' ⚠ mismatch — run: whats-mcp install' : ''})` : ''}`)
  console.log(`Daemon:   ${processAlive ? `running (PID ${pid})` : healthRes.ok ? 'running (orphan — no PID file)' : 'stopped'}`)
  console.log(`HTTP:     ${healthRes.ok ? 'reachable' : 'not reachable'}`)

  if (!healthRes.ok) return

  if (sessionRes.ok && sessionRes.data) {
    const s = sessionRes.data
    if (s.connected) {
      console.log(`WhatsApp: connected ✓ — ${s.name ?? ''} (${s.number ?? ''})`)
    } else if (s.state === 'NOT_STARTED') {
      console.log(`WhatsApp: not started — run: whats-mcp start`)
    } else if (s.state === 'WAITING_QR') {
      console.log(`WhatsApp: waiting QR scan — run: whats-mcp start`)
    } else {
      console.log(`WhatsApp: ${s.state ?? 'initializing...'}`)
    }
  } else {
    console.log(`WhatsApp: unknown`)
  }

  console.log(`Swagger:  ${BASE_URL}/swagger`)
}
