// commands/start.mjs
import http from 'http'
import { BASE_URL } from '../lib/config.mjs'

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body))
    const req = http.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => resolve(JSON.parse(buf)))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => resolve(JSON.parse(buf)))
    })
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

async function renderQr(qrData) {
  const { createRequire } = await import('module')
  const { fileURLToPath } = await import('url')
  const { dirname } = await import('path')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  const qrcode = require('qrcode-terminal')
  return new Promise((resolve) => {
    qrcode.generate(qrData, { small: true }, (art) => resolve(art))
  })
}

export default async function start(args) {
  const sessionId = args[0] || process.env.WHATS_SESSION_ID || 'default'

  // Check daemon running
  const status = await get('/session/status').catch(() => null)
  if (!status) {
    console.error('Daemon not running. Run: whats-mcp install')
    process.exit(1)
  }

  if (status.connected) {
    console.log(`✓ Already connected as ${status.name} (${status.number})`)
    return
  }

  // Start session
  console.log(`Starting WhatsApp session '${sessionId}'...`)
  await post('/session/start', { sessionId })

  // Poll for QR or connected
  const deadline = Date.now() + 60000
  let lastQr = null
  let shown = false

  process.stdout.write('Waiting for QR code')

  while (Date.now() < deadline) {
    const [qrRes, stRes] = await Promise.all([
      get(`/session/qr?sessionId=${sessionId}`).catch(() => ({ qr: null })),
      get(`/session/status?sessionId=${sessionId}`).catch(() => ({ connected: false })),
    ])

    if (stRes.connected) {
      process.stdout.write('\n')
      console.log(`✓ Connected as ${stRes.name} (${stRes.number})`)
      return
    }

    if (qrRes.qr && qrRes.qr !== lastQr) {
      lastQr = qrRes.qr
      if (shown) {
        // Clear previous QR (move cursor up ~30 lines)
        process.stdout.write('\x1B[30A\x1B[0J')
      } else {
        process.stdout.write('\n')
        shown = true
      }
      const art = await renderQr(qrRes.qr)
      process.stdout.write(art)
      console.log('\nScan this QR code with WhatsApp on your phone.')
      console.log('QR expires in ~20s — a new one will appear automatically.\n')
    } else if (!shown) {
      process.stdout.write('.')
    }

    await new Promise((r) => setTimeout(r, 2000))
  }

  console.error('\nTimeout: QR not scanned within 60s. Run whats-mcp start again.')
  process.exit(1)
}
