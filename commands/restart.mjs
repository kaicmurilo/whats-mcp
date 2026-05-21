// commands/restart.mjs
import http from 'http'
import { BASE_URL } from '../lib/config.mjs'

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const parsed = new URL(url)
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, body: raw }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

export default async function restart([sessionId] = []) {
  const sid = sessionId || process.env.WHATS_SESSION_ID || 'default'
  try {
    const { status, body } = await httpPost(`${BASE_URL}/session/restart`, { sessionId: sid })
    if (status !== 200) {
      console.error(`✗ Failed (${status}):`, body)
      process.exit(1)
    }
    console.log(`✓ Session '${sid}' restarted — run: whats-mcp start`)
  } catch (err) {
    console.error('✗ Daemon not reachable:', err.message)
    process.exit(1)
  }
}
