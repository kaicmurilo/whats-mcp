#!/usr/bin/env node
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import { mkdirSync } from 'fs'
import 'dotenv/config'

import { createServer, restoreSessions } from './src/mcp-server.mjs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { setupSession, sessions, validateSession } = require('./src/sessions')
import { PORT, DATA_DIR, PID_FILE } from './lib/config.mjs'
import { writePid, removePid } from './lib/pid.mjs'

mkdirSync(DATA_DIR, { recursive: true })
writePid(PID_FILE, process.pid)
async function shutdown() {
  removePid(PID_FILE)
  // Destroy all WhatsApp clients so Chromium exits cleanly
  for (const [, client] of sessions) {
    try { await client.destroy() } catch { /* ignore */ }
  }
  process.exit(0)
}

process.on('exit', () => removePid(PID_FILE))
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

if ((process.env.RECOVER_SESSIONS || 'true').toLowerCase() === 'true') {
  restoreSessions()
}

const app = express()
app.use(express.json())

const transports = new Map()

app.get('/sse', async (req, res) => {
  const server = createServer()
  const transport = new SSEServerTransport('/message', res)
  transports.set(transport.sessionId, transport)
  res.on('close', () => transports.delete(transport.sessionId))
  await server.connect(transport)
})

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId
  const transport = transports.get(sessionId)
  if (!transport) {
    res.status(404).json({ error: `No active SSE session: ${sessionId}` })
    return
  }
  await transport.handlePostMessage(req, res, req.body)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT })
})

app.get('/version', (_req, res) => {
  try {
    const pkg = require('./package.json')
    res.json({ version: pkg.version })
  } catch {
    res.json({ version: 'unknown' })
  }
})

// ── Session REST endpoints (used by CLI commands) ─────────────────────────────

app.post('/session/start', (req, res) => {
  const sessionId = req.body?.sessionId || process.env.WHATS_SESSION_ID || 'default'
  const result = setupSession(sessionId)
  if (!result.success && !result.message.includes('already exists')) {
    return res.status(500).json({ error: result.message })
  }
  res.json({ sessionId, started: result.success })
})

app.post('/session/restart', async (req, res) => {
  const sessionId = req.body?.sessionId || process.env.WHATS_SESSION_ID || 'default'
  const client = sessions.get(sessionId)
  if (client) {
    sessions.delete(sessionId)
    await client.destroy().catch(() => {})
  }
  const result = setupSession(sessionId)
  res.json({ sessionId, restarted: true, started: result.success })
})

app.get('/session/qr', (req, res) => {
  const sessionId = req.query.sessionId || process.env.WHATS_SESSION_ID || 'default'
  const client = sessions.get(sessionId)
  res.json({ qr: client?.qr ?? null })
})

app.get('/session/status', async (req, res) => {
  const sessionId = req.query.sessionId || process.env.WHATS_SESSION_ID || 'default'
  if (!sessions.has(sessionId)) {
    return res.json({ connected: false, state: 'NOT_STARTED' })
  }
  const client = sessions.get(sessionId)
  if (client?.qr) {
    return res.json({ connected: false, state: 'WAITING_QR', qr: true })
  }
  const v = await Promise.race([
    validateSession(sessionId),
    new Promise((r) => setTimeout(() => r({ success: false, state: 'INITIALIZING' }), 2000)),
  ])
  res.json({
    connected: v.success,
    state: v.state || 'INITIALIZING',
    name: client?.info?.pushname ?? null,
    number: client?.info?.wid?.user ?? null,
  })
})

function alternateBRNumber(chatId) {
  const num = chatId.replace('@c.us', '')
  // 55 + DDD(2) + 9 + 8digits = 13 → try without the 9
  if (/^55\d{2}9\d{8}$/.test(num)) return `${num.slice(0, 4)}${num.slice(5)}@c.us`
  // 55 + DDD(2) + 8digits = 12 → try with 9
  if (/^55\d{2}\d{8}$/.test(num)) return `${num.slice(0, 4)}9${num.slice(4)}@c.us`
  return null
}

app.post('/send-message', async (req, res) => {
  const { chatId, content, sessionId: sid } = req.body
  const sessionId = sid || process.env.WHATS_SESSION_ID || 'default'
  if (!chatId || !content) return res.status(400).json({ error: 'chatId and content required' })
  const client = sessions.get(sessionId)
  if (!client) return res.status(404).json({ error: `Session '${sessionId}' not found` })

  const candidates = [chatId, alternateBRNumber(chatId)].filter(Boolean)
  let lastErr
  for (const cid of candidates) {
    try {
      const msg = await client.sendMessage(cid, content)
      return res.json({ success: true, messageId: msg.id._serialized, chatId: cid })
    } catch (err) {
      lastErr = err
    }
  }
  res.status(500).json({ error: lastErr.message })
})

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'whats-mcp REST API',
      version: '1.0.0',
      description: 'WhatsApp Web MCP server — REST interface',
    },
    servers: [{ url: `http://localhost:${PORT}` }],
  },
  apis: ['./src/routes.js'],
})

app.get('/swagger.json', (_req, res) => res.json(swaggerSpec))
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

app.listen(PORT, () => {
  process.stderr.write(`whats-mcp daemon running at http://localhost:${PORT}\n`)
  process.stderr.write(`  SSE:     GET  http://localhost:${PORT}/sse\n`)
  process.stderr.write(`  Health:  GET  http://localhost:${PORT}/health\n`)
  process.stderr.write(`  Swagger: GET  http://localhost:${PORT}/swagger\n`)
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${PORT} already in use — another daemon is running. Exiting.\n`)
    process.exit(0)  // exit 0 so launchd/systemd don't restart
  }
  throw err
})
