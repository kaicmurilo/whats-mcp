#!/usr/bin/env node
/**
 * whats-mcp — stdio launcher + proxy
 *
 * Comportamento:
 *   1. Verifica se daemon está rodando em PORT (default 3001)
 *   2. Se não: sobe daemon.mjs como processo detached independente
 *   3. Proxeia stdio ↔ SSE daemon (qualquer CLI usa sem saber do daemon)
 *
 * Resultado: primeiro CLI sobe o daemon, demais reaproveitam.
 * Chromium fica vivo enquanto daemon viver (independente de qual CLI abriu).
 */
import http from 'http'
import readline from 'readline'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.WHATS_MCP_PORT || process.env.PORT || '47891')
const BASE = `http://localhost:${PORT}`

// ─── Check / start daemon ──────────────────────────────────────────────────

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.setTimeout(1000, () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

async function ensureDaemon() {
  if (await ping()) return // já rodando

  const child = spawn(process.execPath, [join(__dirname, 'daemon.mjs')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref() // não bloqueia este processo

  // Aguarda daemon responder (até 15s — express bind é rápido)
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (await ping()) return
  }
  throw new Error('whats-mcp daemon não respondeu após 15s')
}

// ─── SSE proxy ────────────────────────────────────────────────────────────

function connectSSE() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/sse`, { headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connect failed: HTTP ${res.statusCode}`))
        return
      }

      let buf = ''
      let sessionId = null
      const pending = []

      function postMessage(body) {
        const data = Buffer.from(body)
        const r = http.request(`${BASE}/message?sessionId=${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        }, (res) => res.resume())
        r.on('error', (e) => process.stderr.write(`[whats-mcp] POST error: ${e.message}\n`))
        r.write(data)
        r.end()
      }

      res.on('data', (chunk) => {
        buf += chunk.toString()
        let idx
        // SSE blocks separados por \n\n
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)

          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim()
            else if (line.startsWith('data: ')) data = line.slice(6).trim()
          }

          if (event === 'endpoint' && data) {
            // data = "/message?sessionId=<uuid>"
            try {
              const url = new URL(data, BASE)
              sessionId = url.searchParams.get('sessionId')
            } catch (_) {
              // fallback: data pode ser só o sessionId direto
              sessionId = data.split('sessionId=')[1]?.split('&')[0] ?? data
            }
            resolve({ postMessage, pending })
            // Flush mensagens que chegaram antes do sessionId
            for (const m of pending) postMessage(m)
            pending.length = 0
          } else if (event === 'message' && data) {
            // Resposta MCP → stdout (Claude lê daqui)
            process.stdout.write(data + '\n')
          }
        }
      })

      res.on('error', (e) => process.stderr.write(`[whats-mcp] SSE error: ${e.message}\n`))
      res.on('end', () => {
        process.stderr.write('[whats-mcp] daemon SSE stream ended\n')
        process.exit(0)
      })
    })

    req.on('error', reject)
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────

await ensureDaemon()
const { postMessage, pending } = await connectSSE()

// stdin → daemon: lê JSON-RPC line por line
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  postMessage(trimmed)
})

rl.on('close', () => process.exit(0))
