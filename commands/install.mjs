// commands/install.mjs
import { mkdirSync, existsSync, writeFileSync, openSync } from 'fs'
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { dirname, join } from 'path'
import http from 'http'
import { createRequire } from 'module'
import { DATA_DIR, SESSIONS_DIR, PID_FILE, LOG_FILE, ENV_FILE, PORT, BASE_URL } from '../lib/config.mjs'
import { readPid, pidExists } from '../lib/pid.mjs'

const require = createRequire(import.meta.url)
const { version: CURRENT_VERSION } = require('../package.json')

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

function getRunningVersion() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/version`, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf).version ?? 'unknown') } catch { resolve('unknown') }
      })
    })
    req.setTimeout(2000, () => { req.destroy(); resolve('unknown') })
    req.on('error', () => resolve('unknown'))
  })
}

async function killDaemon() {
  const pid = readPid(PID_FILE)
  if (pid && pidExists(pid)) {
    process.kill(pid, 'SIGTERM')
    return
  }
  // Fallback: kill by port
  try {
    execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' })
  } catch { /* ignore */ }
}

function getSessionStatus() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/session/status`, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(null) } })
    })
    req.setTimeout(3000, () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
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

function registerLaunchd() {
  const nodePath = process.execPath
  const daemonPath = join(ROOT, 'daemon.mjs')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.whats-mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${daemonPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WHATS_MCP_PORT</key><string>${PORT}</string>
    <key>RECOVER_SESSIONS</key><string>true</string>
    <key>SESSIONS_PATH</key><string>${SESSIONS_DIR}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>`

  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.whats-mcp.plist')
  writeFileSync(plistPath, plist, 'utf8')

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function registerSystemd() {
  const nodePath = process.execPath
  const daemonPath = join(ROOT, 'daemon.mjs')
  const service = `[Unit]
Description=whats-mcp daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
WorkingDirectory=${ROOT}
Restart=always
RestartSec=5
Environment=WHATS_MCP_PORT=${PORT}
Environment=RECOVER_SESSIONS=true
Environment=SESSIONS_PATH=${SESSIONS_DIR}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`

  const systemdDir = join(homedir(), '.config', 'systemd', 'user')
  mkdirSync(systemdDir, { recursive: true })
  const servicePath = join(systemdDir, 'whats-mcp.service')
  writeFileSync(servicePath, service, 'utf8')

  try {
    execSync('systemctl --user daemon-reload && systemctl --user enable whats-mcp', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function registerAutoStart() {
  if (process.platform === 'darwin') {
    const ok = registerLaunchd()
    if (ok) console.log('✓ Auto-start registered via launchd (starts on login)')
    else console.warn('⚠ Could not register launchd — start manually with: whats-mcp install')
    return ok
  } else if (process.platform === 'linux') {
    const ok = registerSystemd()
    if (ok) console.log('✓ Auto-start registered via systemd user service')
    else console.warn('⚠ Could not register systemd — start manually with: whats-mcp install')
    return ok
  } else {
    console.log('ℹ Auto-start not supported on this platform. Run whats-mcp install after reboot.')
    return false
  }
}

export default async function install() {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(SESSIONS_DIR, { recursive: true })

  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, `WHATS_MCP_PORT=${PORT}\nRECOVER_SESSIONS=true\n`, 'utf8')
  }

  // Kill outdated daemon before registering new service (avoids port race)
  const portInUse = await ping()
  if (portInUse) {
    const runningVersion = await getRunningVersion()
    if (runningVersion === CURRENT_VERSION) {
      console.log(`✓ Daemon already running v${CURRENT_VERSION}`)
      console.log(`  MCP SSE: ${BASE_URL}/sse`)
      console.log(`  Swagger: ${BASE_URL}/swagger`)
      return
    }
    console.log(`↻ Daemon v${runningVersion} running, updating to v${CURRENT_VERSION}...`)
    await killDaemon()
    await new Promise((r) => setTimeout(r, 1000))
  }

  // Register auto-start — launchd/systemd will start the daemon automatically
  const managedByService = registerAutoStart()

  // If launchd/systemd started the daemon, wait for it; otherwise spawn manually
  if (managedByService) {
    console.log('Starting whats-mcp daemon...')
    const ready = await waitReady(15000)
    if (ready) {
      // service started it fine
    } else {
      // service failed — fall back to manual spawn
      const logFd = openSync(LOG_FILE, 'a')
      const child = spawn(process.execPath, [join(ROOT, 'daemon.mjs')], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, WHATS_MCP_PORT: String(PORT), RECOVER_SESSIONS: 'true', SESSIONS_PATH: SESSIONS_DIR },
        cwd: ROOT,
      })
      child.unref()
      const ready2 = await waitReady(15000)
      if (!ready2) {
        console.error('Daemon did not respond after 15s. Check logs: whats-mcp logs')
        process.exit(1)
      }
    }
  } else {
    console.log('Starting whats-mcp daemon...')
    const logFd = openSync(LOG_FILE, 'a')
    const child = spawn(process.execPath, [join(ROOT, 'daemon.mjs')], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, WHATS_MCP_PORT: String(PORT), RECOVER_SESSIONS: 'true', SESSIONS_PATH: SESSIONS_DIR },
      cwd: ROOT,
    })
    child.unref()
    const ready = await waitReady(15000)
    if (!ready) {
      console.error('Daemon did not respond after 15s. Check logs: whats-mcp logs')
      process.exit(1)
    }
  }

  console.log('✓ whats-mcp daemon started\n')
  console.log(`  MCP SSE:  ${BASE_URL}/sse`)
  console.log(`  Health:   ${BASE_URL}/health`)
  console.log(`  Swagger:  ${BASE_URL}/swagger`)
  console.log(`  Logs:     whats-mcp logs -f\n`)

  const sessionSt = await getSessionStatus()
  if (sessionSt?.connected) {
    console.log(`✓ WhatsApp connected as ${sessionSt.name} (${sessionSt.number})\n`)
  } else {
    const startMod = await import('./start.mjs')
    await startMod.default([])
  }

  console.log(`\nConnect your AI CLI:`)
  console.log(`  whats-mcp connect claude-code`)
  console.log(`  whats-mcp connect cursor`)
}
