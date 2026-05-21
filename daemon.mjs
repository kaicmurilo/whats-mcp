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
process.on('exit', () => removePid(PID_FILE))
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

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

// ── Session REST endpoints (used by CLI commands) ─────────────────────────────

app.post('/session/start', (req, res) => {
  const sessionId = req.body?.sessionId || process.env.WHATS_SESSION_ID || 'default'
  const result = setupSession(sessionId)
  if (!result.success && !result.message.includes('already exists')) {
    return res.status(500).json({ error: result.message })
  }
  res.json({ sessionId, started: result.success })
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
  const v = await validateSession(sessionId)
  const client = sessions.get(sessionId)
  res.json({
    connected: v.success,
    state: v.state || 'INITIALIZING',
    name: client?.info?.pushname ?? null,
    number: client?.info?.wid?.user ?? null,
  })
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
})
