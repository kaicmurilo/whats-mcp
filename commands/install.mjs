// commands/install.mjs
import { mkdirSync, existsSync, writeFileSync, openSync } from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import http from 'http'
import { DATA_DIR, PID_FILE, LOG_FILE, ENV_FILE, PORT, BASE_URL } from '../lib/config.mjs'
import { readPid, pidExists } from '../lib/pid.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.setTimeout(1000, () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

async function waitReady(maxMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (await ping()) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

export default async function install() {
  const existingPid = readPid(PID_FILE)
  if (existingPid && pidExists(existingPid)) {
    console.log(`whats-mcp daemon already running (PID ${existingPid})`)
    console.log(`  MCP SSE: ${BASE_URL}/sse`)
    console.log(`  Swagger: ${BASE_URL}/swagger`)
    return
  }

  mkdirSync(DATA_DIR, { recursive: true })

  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, `WHATS_MCP_PORT=${PORT}\nRECOVER_SESSIONS=true\n`, 'utf8')
  }

  console.log('Starting whats-mcp daemon...')

  const logFd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [join(ROOT, 'daemon.mjs')], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, WHATS_MCP_PORT: String(PORT) },
    cwd: ROOT,
  })
  child.unref()

  const ready = await waitReady()
  if (!ready) {
    console.error(`Daemon did not respond after 15s. Check logs: whats-mcp logs`)
    process.exit(1)
  }

  console.log('✓ whats-mcp daemon started successfully\n')
  console.log(`  MCP SSE:  ${BASE_URL}/sse`)
  console.log(`  Health:   ${BASE_URL}/health`)
  console.log(`  Swagger:  ${BASE_URL}/swagger`)
  console.log(`  Logs:     whats-mcp logs -f`)
  console.log(`\nNext step: authenticate WhatsApp`)
  console.log(`  Scan the QR code — check logs: whats-mcp logs`)
  console.log(`\nThen connect your AI CLI:`)
  console.log(`  whats-mcp connect claude-code`)
  console.log(`  whats-mcp connect cursor`)
}
