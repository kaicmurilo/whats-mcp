// tests/pid.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writePid, readPid, pidExists, removePid } from '../lib/pid.mjs'

const TMP = join(tmpdir(), 'whats-mcp-pid-test-' + Date.now())
mkdirSync(TMP, { recursive: true })

test('writePid writes PID to file', () => {
  const file = join(TMP, 'test.pid')
  writePid(file, 12345)
  const content = readFileSync(file, 'utf8').trim()
  assert.equal(content, '12345')
})

test('readPid returns null for missing file', () => {
  const result = readPid(join(TMP, 'nonexistent.pid'))
  assert.equal(result, null)
})

test('readPid returns number for existing file', () => {
  const file = join(TMP, 'read.pid')
  writeFileSync(file, '9999\n')
  assert.equal(readPid(file), 9999)
})

test('pidExists returns false for non-running PID', () => {
  assert.equal(pidExists(99999999), false)
})

test('pidExists returns true for current process', () => {
  assert.equal(pidExists(process.pid), true)
})

test('removePid deletes file if it exists', () => {
  const file = join(TMP, 'remove.pid')
  writeFileSync(file, '1')
  removePid(file)
  assert.equal(existsSync(file), false)
})

test('removePid is no-op for missing file', () => {
  assert.doesNotThrow(() => removePid(join(TMP, 'ghost.pid')))
})
