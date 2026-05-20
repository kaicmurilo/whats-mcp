#!/usr/bin/env node
/**
 * whats-mcp daemon — SSE/HTTP transport
 *
 * Roda como processo independente (pm2 / launchd).
 * Chromium fica vivo permanentemente — sem boot delay ao abrir CLIs.
 *
 * Start:  node daemon.mjs   (ou: npm run daemon)
 * Claude: claude mcp add whatsapp --transport sse http://localhost:3001/sse
 * Gemini: adicione em ~/.gemini/settings.json (url: http://localhost:3001/sse)
 */
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import express from 'express'
import 'dotenv/config'

import { createServer, restoreSessions } from './src/mcp-server.mjs'

const PORT = parseInt(process.env.PORT || '3001')

// Reconecta sessões salvas em disco automaticamente
if ((process.env.RECOVER_SESSIONS || 'true').toLowerCase() === 'true') {
  restoreSessions()
}

const app = express()
app.use(express.json())

// Map de transports ativos (um por cliente conectado via SSE)
const transports = new Map()

// SSE endpoint — cada cliente AI CLI conecta aqui e mantém stream aberto
app.get('/sse', async (req, res) => {
  const server = createServer()
  const transport = new SSEServerTransport('/message', res)
  transports.set(transport.sessionId, transport)
  res.on('close', () => transports.delete(transport.sessionId))
  await server.connect(transport)
})

// POST endpoint — cliente envia comandos MCP aqui
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId
  const transport = transports.get(sessionId)
  if (!transport) {
    res.status(404).json({ error: `No active SSE session: ${sessionId}` })
    return
  }
  await transport.handlePostMessage(req, res, req.body)
})

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT })
})

app.listen(PORT, () => {
  process.stderr.write(`whats-mcp daemon running at http://localhost:${PORT}\n`)
  process.stderr.write(`  SSE endpoint:  GET  http://localhost:${PORT}/sse\n`)
  process.stderr.write(`  POST endpoint: POST http://localhost:${PORT}/message\n`)
  process.stderr.write(`  Health check:  GET  http://localhost:${PORT}/health\n`)
})
