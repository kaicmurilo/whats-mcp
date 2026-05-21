// lib/config.mjs
import { homedir } from 'os'
import { join } from 'path'

export const PORT = parseInt(process.env.WHATS_MCP_PORT || '47891')
export const DATA_DIR = join(homedir(), '.whats-mcp')
export const SESSIONS_DIR = join(DATA_DIR, 'sessions')
export const PID_FILE = join(DATA_DIR, 'daemon.pid')
export const LOG_FILE = join(DATA_DIR, 'daemon.log')
export const ENV_FILE = join(DATA_DIR, '.env')
export const BASE_URL = `http://localhost:${PORT}`

export const CLI_CONFIGS = {
  'claude-code': join(homedir(), '.claude', 'settings.json'),
  cursor: join(homedir(), '.cursor', 'mcp.json'),
  windsurf: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
  'gemini-cli': join(homedir(), '.gemini', 'settings.json'),
}
