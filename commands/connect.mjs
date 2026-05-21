// commands/connect.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import { CLI_CONFIGS } from '../lib/config.mjs'

export function buildMcpEntry() {
  return { command: 'whats-mcp', args: ['proxy'] }
}

export function patchConfig(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })

  let config = {}
  if (existsSync(filePath)) {
    try {
      config = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch {
      renameSync(filePath, filePath + '.bak')
      config = {}
    }
  }

  config.mcpServers ??= {}
  config.mcpServers.whatsapp = buildMcpEntry()
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

export default async function connect(args) {
  const target = args[0]
  const supported = Object.keys(CLI_CONFIGS).join(', ')

  if (!target) {
    console.error(`Usage: whats-mcp connect <cli>\nSupported: ${supported}`)
    process.exit(1)
  }

  const configPath = CLI_CONFIGS[target]
  if (!configPath) {
    console.error(`Unknown CLI: "${target}"\nSupported: ${supported}`)
    process.exit(1)
  }

  patchConfig(configPath)

  console.log(`✓ Connected whatsapp MCP to ${target}`)
  console.log(`  Config: ${configPath}`)
  console.log(`  Added:`)
  console.log(`    mcpServers.whatsapp = ${JSON.stringify(buildMcpEntry())}`)
  console.log(`\nRestart ${target} to apply changes.`)
}
