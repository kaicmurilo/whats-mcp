// lib/pid.mjs
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'

export function writePid(file, pid) {
  writeFileSync(file, String(pid) + '\n', 'utf8')
}

export function readPid(file) {
  if (!existsSync(file)) return null
  const n = parseInt(readFileSync(file, 'utf8').trim(), 10)
  return isNaN(n) ? null : n
}

export function pidExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function removePid(file) {
  try { unlinkSync(file) } catch { /* no-op */ }
}
