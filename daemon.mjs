#!/usr/bin/env node
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import { mkdirSync } from 'fs'
import 'dotenv/config'

import { createServer, restoreSessions } from './src/mcp-server.mjs'
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
