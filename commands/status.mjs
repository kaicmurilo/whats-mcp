// commands/status.mjs
import http from 'http'
import { PID_FILE, BASE_URL } from '../lib/config.mjs'
import { readPid, pidExists } from '../lib/pid.mjs'

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ ok: res.statusCode === 200, body }))
    })
    req.setTimeout(2000, () => { req.destroy(); resolve({ ok: false, body: '' }) })
    req.on('error', () => resolve({ ok: false, body: '' }))
  })
}

export default async function status() {
  const pid = readPid(PID_FILE)
  const processAlive = pid ? pidExists(pid) : false
  const { ok, body } = await httpGet(`${BASE_URL}/health`)

  console.log(`Process: ${processAlive ? `running (PID ${pid})` : 'stopped'}`)
  console.log(`HTTP:    ${ok ? 'reachable' : 'not reachable'}`)
  if (ok) {
    console.log(`Detail:  ${body}`)
    console.log(`Swagger: ${BASE_URL}/swagger`)
  }
}
