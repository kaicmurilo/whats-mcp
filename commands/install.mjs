// commands/install.mjs
import { mkdirSync, existsSync, writeFileSync, openSync } from 'fs'
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
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
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
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
  } else if (process.platform === 'linux') {
    const ok = registerSystemd()
    if (ok) console.log('✓ Auto-start registered via systemd user service')
    else console.warn('⚠ Could not register systemd — start manually with: whats-mcp install')
  } else {
    console.log('ℹ Auto-start not supported on this platform. Run whats-mcp install after reboot.')
  }
}

export default async function install() {
  mkdirSync(DATA_DIR, { recursive: true })

  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, `WHATS_MCP_PORT=${PORT}\nRECOVER_SESSIONS=true\n`, 'utf8')
  }

  // Register auto-start on boot
  registerAutoStart()

  const existingPid = readPid(PID_FILE)
  if (existingPid && pidExists(existingPid)) {
    console.log(`✓ Daemon already running (PID ${existingPid})`)
    console.log(`  MCP SSE: ${BASE_URL}/sse`)
    console.log(`  Swagger: ${BASE_URL}/swagger`)
    return
  }

  console.log('Starting whats-mcp daemon...')

  const logFd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [join(ROOT, 'daemon.mjs')], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, WHATS_MCP_PORT: String(PORT), RECOVER_SESSIONS: 'true' },
    cwd: ROOT,
  })
  child.unref()

  const ready = await waitReady()
  if (!ready) {
    console.error('Daemon did not respond after 15s. Check logs: whats-mcp logs')
    process.exit(1)
  }

  console.log('✓ whats-mcp daemon started\n')
  console.log(`  MCP SSE:  ${BASE_URL}/sse`)
  console.log(`  Health:   ${BASE_URL}/health`)
  console.log(`  Swagger:  ${BASE_URL}/swagger`)
  console.log(`  Logs:     whats-mcp logs -f`)
  console.log(`\nNext: authenticate WhatsApp (one-time only):`)
  console.log(`  whats-mcp start`)
  console.log(`\nThen connect your AI CLI:`)
  console.log(`  whats-mcp connect claude-code`)
  console.log(`  whats-mcp connect cursor`)
}
