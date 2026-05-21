// commands/logs.mjs
import { existsSync, createReadStream, statSync, watch } from 'fs'
import { LOG_FILE } from '../lib/config.mjs'

export default async function logs(args) {
  const follow = args.includes('-f') || args.includes('--follow')

  if (!existsSync(LOG_FILE)) {
    console.log(`No log file at ${LOG_FILE} — is the daemon running?`)
    return
  }

  await new Promise((resolve) => {
    const stream = createReadStream(LOG_FILE, 'utf8')
    stream.pipe(process.stdout, { end: false })
    stream.on('end', resolve)
  })

  if (!follow) return

  console.log('\n--- following (Ctrl+C to stop) ---')
  let pos = statSync(LOG_FILE).size

  watch(LOG_FILE, () => {
    const stat = statSync(LOG_FILE)
    if (stat.size <= pos) return
    const stream = createReadStream(LOG_FILE, { start: pos, encoding: 'utf8' })
    stream.pipe(process.stdout, { end: false })
    pos = stat.size
  })
}
