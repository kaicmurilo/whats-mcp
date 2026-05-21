// commands/stop.mjs
import { PID_FILE } from '../lib/config.mjs'
import { readPid, pidExists, removePid } from '../lib/pid.mjs'

export default async function stop() {
  const pid = readPid(PID_FILE)

  if (!pid) {
    console.log('whats-mcp daemon is not running (no PID file)')
    return
  }

  if (!pidExists(pid)) {
    console.log(`PID ${pid} not found — cleaning up stale PID file`)
    removePid(PID_FILE)
    return
  }

  process.kill(pid, 'SIGTERM')
  console.log(`Stopped whats-mcp daemon (PID ${pid})`)
  removePid(PID_FILE)
}
