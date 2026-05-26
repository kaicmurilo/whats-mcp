// commands/update.mjs
import { execSync } from 'child_process'
import { createRequire } from 'module'
import http from 'http'
import { BASE_URL, PORT, PID_FILE } from '../lib/config.mjs'
import { readPid, pidExists } from '../lib/pid.mjs'

const require = createRequire(import.meta.url)
const { name: PKG_NAME } = require('../package.json')

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

export default async function update() {
  // Stop daemon if running
  if (await ping()) {
    console.log('Stopping daemon...')
    const pid = readPid(PID_FILE)
    if (pid && pidExists(pid)) {
      process.kill(pid, 'SIGTERM')
    } else {
      try { execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' }) } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  console.log(`Updating ${PKG_NAME}...`)
  try {
    execSync(`npm install -g ${PKG_NAME}@latest`, { stdio: 'inherit' })
  } catch {
    console.error('npm update failed. Check your connection and npm credentials.')
    process.exit(1)
  }

  console.log('Starting updated daemon...')
  try {
    execSync('whats-mcp install', { stdio: 'inherit' })
  } catch {
    process.exit(1)
  }
}
