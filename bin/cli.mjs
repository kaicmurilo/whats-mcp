#!/usr/bin/env node
// bin/cli.mjs
import 'dotenv/config'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const [,, cmd, ...args] = process.argv

const COMMANDS = {
  install: () => import('../commands/install.mjs'),
  start:   () => import('../commands/start.mjs'),
  connect: () => import('../commands/connect.mjs'),
  stop:    () => import('../commands/stop.mjs'),
  status:  () => import('../commands/status.mjs'),
  logs:    () => import('../commands/logs.mjs'),
  proxy:   () => import('../index.mjs'),
}

if (cmd === '--version' || cmd === '-v') {
  const { version } = require('../package.json')
  console.log(version)
  process.exit(0)
}

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`
whats-mcp — WhatsApp MCP server

Commands:
  install              Start daemon (first-time setup)
  start [sessionId]    Authenticate WhatsApp — shows QR code in terminal
  connect <cli>        Configure AI CLI (claude-code, cursor, windsurf)
  stop                 Stop daemon
  status               Show daemon status
  logs [-f]            Show daemon logs (use -f to follow)
  proxy                stdio ↔ SSE proxy (used internally by MCP clients)
  `)
  process.exit(0)
}

const loader = COMMANDS[cmd]
if (!loader) {
  console.error(`Unknown command: "${cmd}"\nRun: whats-mcp --help`)
  process.exit(1)
}

const mod = await loader()
await mod.default?.(args)
