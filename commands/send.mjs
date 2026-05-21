// commands/send.mjs
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
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode, data: null }) }
      })
    })
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

export default async function send(args) {
  const [to, ...msgParts] = args
  const message = msgParts.join(' ')

  if (!to || !message) {
    console.error('Usage: whats-mcp send <number> <message>')
    console.error('Example: whats-mcp send 5511999999999 "Hello!"')
    process.exit(1)
  }

  const number = to.replace(/\D/g, '')

  const res = await post('/send-message', { chatId: `${number}@c.us`, contentType: 'string', content: message })
    .catch((err) => { console.error('Error:', err.message); process.exit(1) })

  if (res.status === 200) {
    console.log(`✓ Message sent to ${number}`)
  } else {
    console.error(`✗ Failed (${res.status}):`, JSON.stringify(res.data))
    process.exit(1)
  }
}
