// tests/connect.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { patchConfig, buildMcpEntry } from '../commands/connect.mjs'

const TMP = join(tmpdir(), 'whats-mcp-connect-test-' + Date.now())
mkdirSync(TMP, { recursive: true })

test('buildMcpEntry returns correct structure', () => {
  const entry = buildMcpEntry()
  assert.deepEqual(entry, {
    command: 'whats-mcp',
    args: ['proxy'],
  })
})

test('patchConfig creates file with mcpServers if missing', () => {
  const file = join(TMP, 'settings.json')
  patchConfig(file)
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(result.mcpServers?.whatsapp)
  assert.equal(result.mcpServers.whatsapp.command, 'whats-mcp')
})

test('patchConfig merges into existing config preserving other keys', () => {
  const file = join(TMP, 'existing.json')
  writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'foo' } } }))
  patchConfig(file)
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(result.theme, 'dark')
  assert.ok(result.mcpServers.other)
  assert.ok(result.mcpServers.whatsapp)
})

test('patchConfig handles invalid JSON by backing up and recreating', () => {
  const file = join(TMP, 'broken.json')
  writeFileSync(file, 'not json {{{')
  assert.doesNotThrow(() => patchConfig(file))
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(result.mcpServers?.whatsapp)
})

test('patchConfig is idempotent — running twice does not duplicate', () => {
  const file = join(TMP, 'idempotent.json')
  patchConfig(file)
  patchConfig(file)
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(Object.keys(result.mcpServers).length, 1)
})
