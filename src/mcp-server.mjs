import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const { setupSession, sessions, sessionLastReady, validateSession, deleteSession, restoreSessions } = require('./sessions')
const { MessageMedia } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')

const SESSION_ID = process.env.WHATS_SESSION_ID || 'default'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtId(id) {
  if (!id || id.includes('@')) return id
  return `${id}@c.us`
}

function brAlternate(num) {
  if (/^55\d{2}9\d{8}$/.test(num)) return `${num.slice(0, 4)}${num.slice(5)}`
  if (/^55\d{2}\d{8}$/.test(num)) return `${num.slice(0, 4)}9${num.slice(4)}`
  return null
}

async function resolveId(client, id) {
  if (!id) return id
  if (id.includes('@g.us')) return id
  if (id.includes('@')) return id
  const candidates = [id, brAlternate(id)].filter(Boolean)
  for (const num of candidates) {
    const numberId = await client.getNumberId(`${num}@c.us`)
    if (numberId) return numberId._serialized
  }
  throw new Error(`Number ${id} is not registered on WhatsApp.`)
}

function getClient(sessionId) {
  const client = sessions.get(sessionId)
  if (!client) throw new Error(`Session '${sessionId}' not found. Call whatsapp_start first.`)
  return client
}

async function assertConnected(sessionId) {
  // Sticky ready: if 'ready' fired within last 60s, trust it (handles pupPage cycling)
  const readyAt = sessionLastReady.get(sessionId)
  if (readyAt && Date.now() - readyAt < 60000) return

  const validation = await validateSession(sessionId)
  if (!validation.success) {
    throw new Error(`Session '${sessionId}' not connected (${validation.message}). Start session and scan QR.`)
  }
}

function generateQrAscii(qrData) {
  return new Promise((resolve) => {
    qrcode.generate(qrData, { small: true }, (art) => resolve(art))
  })
}

async function showQr(qrData) {
  try { await openQrImage(qrData) } catch (_) {}
  const art = await generateQrAscii(qrData)
  return art
}

async function openQrImage(qrData) {
  const { createWriteStream } = await import('fs')
  const { join } = await import('path')
  const { spawn } = await import('child_process')
  const qrImage = require('qr-image')

  const tmpPath = join('/tmp', `whats-mcp-qr-${Date.now()}.png`)
  const png = qrImage.image(qrData, { type: 'png', size: 10 })

  await new Promise((resolve, reject) => {
    const out = createWriteStream(tmpPath)
    png.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
  })

  const opener = process.platform === 'linux' ? 'xdg-open' : 'open'
  spawn(opener, [tmpPath], { detached: true, stdio: 'ignore' }).unref()

  return tmpPath
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer() {
  const server = new McpServer({ name: 'whats-mcp', version: '1.0.0' })

  // ── Session ─────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_start',
    'Initialize a WhatsApp session. Waits up to 120s for restore or QR code.',
    { sessionId: z.string().optional().describe('Session ID (default: env WHATS_SESSION_ID)') },
    async ({ sessionId }) => {
      const sid = sessionId || SESSION_ID
      const result = setupSession(sid)

      if (!result.success && result.message.includes('already exists')) {
        const client = sessions.get(sid)

        if (client?.qr) {
          const art = await showQr(client.qr)
          return { content: [{ type: 'text', text: `Scan this QR code with WhatsApp:\n\n${art}` }] }
        }

        const deadline = Date.now() + 120000
        while (Date.now() < deadline) {
          if (client?.qr) {
            const art = await showQr(client.qr)
            return { content: [{ type: 'text', text: `Scan this QR code with WhatsApp:\n\n${art}\n\nAfter scanning, call whatsapp_status to confirm.` }] }
          }
          const v = await validateSession(sid)
          if (v.success) {
            const info = client?.info
            return { content: [{ type: 'text', text: `Session '${sid}' connected${info ? ` as ${info.pushname} (${info.wid?.user})` : ''}.` }] }
          }
          await new Promise((r) => setTimeout(r, 2000))
        }

        if (client?.qr) {
          const art = await showQr(client.qr)
          return { content: [{ type: 'text', text: `Scan this QR code with WhatsApp:\n\n${art}` }] }
        }
        return { content: [{ type: 'text', text: 'Session still initializing after 120s. Chromium is slow — wait 30s and call whatsapp_status. If QR appears, scan it.' }] }
      }

      if (!result.success) {
        throw new Error(result.message)
      }

      const qrOrReady = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ type: 'timeout' }), 30000)

        result.client.on('qr', (qr) => {
          clearTimeout(timeout)
          resolve({ type: 'qr', qr })
        })

        result.client.on('ready', () => {
          clearTimeout(timeout)
          resolve({ type: 'ready' })
        })

        result.client.on('authenticated', () => {
          clearTimeout(timeout)
          resolve({ type: 'authenticated' })
        })
      })

      if (qrOrReady.type === 'ready' || qrOrReady.type === 'authenticated') {
        return { content: [{ type: 'text', text: `Session '${sid}' connected (session restored from disk, no QR needed).` }] }
      }

      if (qrOrReady.type === 'qr') {
        const art = await showQr(qrOrReady.qr)
        return { content: [{ type: 'text', text: `Scan this QR code with WhatsApp:\n\n${art}\n\nAfter scanning, call whatsapp_status to confirm connection.` }] }
      }

      return { content: [{ type: 'text', text: 'Timeout waiting for QR. Call whatsapp_get_qr to retry.' }] }
    }
  )

  server.tool(
    'whatsapp_status',
    'Check the connection status of a WhatsApp session.',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const sid = sessionId || SESSION_ID
      if (!sessions.has(sid)) {
        return { content: [{ type: 'text', text: 'Session not found. Call whatsapp_start first.' }] }
      }

      // Polling até conectar ou timeout (120s) — Chromium pode levar 60-90s para restaurar sessão
      const deadline = Date.now() + 120000
      let lastState = 'INITIALIZING'
      while (Date.now() < deadline) {
        const client = sessions.get(sid)
        if (client?.qr) {
          const art = await showQr(client.qr)
          return { content: [{ type: 'text', text: `Needs authentication. Scan QR code:\n\n${art}` }] }
        }
        const v = await validateSession(sid)
        if (v.success) {
          let info = ''
          try { info = ` | Logged as: ${client?.info?.pushname} (${client?.info?.wid?.user})` } catch (_) {}
          return { content: [{ type: 'text', text: `CONNECTED${info}` }] }
        }
        lastState = v.state || 'INITIALIZING'
        if (lastState !== 'INITIALIZING' && lastState !== null) break
        await new Promise((r) => setTimeout(r, 2000))
      }
      return { content: [{ type: 'text', text: `State: ${lastState} | Still initializing after 120s. If QR never appeared, session data may be valid — try whatsapp_start. If it asks for QR, scan and re-authenticate.` }] }
    }
  )

  server.tool(
    'whatsapp_get_qr',
    'Get the current QR code as ASCII art (if session is waiting for scan).',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const sid = sessionId || SESSION_ID
      const client = getClient(sid)
      if (!client.qr) {
        return { content: [{ type: 'text', text: 'No QR available — session may already be connected or not yet initialized.' }] }
      }
      const art = await showQr(client.qr)
      return { content: [{ type: 'text', text: `Scan this QR code with WhatsApp:\n\n${art}` }] }
    }
  )

  server.tool(
    'whatsapp_logout',
    'Terminate and delete a WhatsApp session.',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const sid = sessionId || SESSION_ID
      const validation = await validateSession(sid)
      if (validation.message === 'session_not_found') {
        return { content: [{ type: 'text', text: 'Session not found.' }] }
      }
      await Promise.race([
        deleteSession(sid, validation),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]).catch(() => {
        sessions.delete(sid)
      })
      return { content: [{ type: 'text', text: `Session '${sid}' terminated.` }] }
    }
  )

  server.tool(
    'whatsapp_reset',
    'Force-kill a stuck WhatsApp session and delete its data from disk. Use when whatsapp_logout hangs or session is corrupted.',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const { rm } = await import('fs/promises')
      const { join } = await import('path')
      const sid = sessionId || SESSION_ID
      const client = sessions.get(sid)

      if (client) {
        try { client.pupBrowser?.process()?.kill('SIGKILL') } catch (_) {}
        try { await client.destroy() } catch (_) {}
        sessions.delete(sid)
      }

      const sessionPath = join(process.env.SESSIONS_PATH || './sessions', `session-${sid}`)
      try {
        await rm(sessionPath, { recursive: true, force: true })
      } catch (_) {}

      return { content: [{ type: 'text', text: `Session '${sid}' force-reset. Call whatsapp_start to authenticate again.` }] }
    }
  )

  // ── Messaging ────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_send_message',
    'Send a text message to a phone number or group.',
    {
      to: z.string().describe('Phone number with country code (e.g. 5511999999999) or group ID (e.g. 120363xxx@g.us)'),
      message: z.string().describe('Text to send'),
      sessionId: z.string().optional(),
    },
    async ({ to, message, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const base = to.includes('@') ? to : `${to}@c.us`
      const alt = !to.includes('@') && brAlternate(to) ? `${brAlternate(to)}@c.us` : null
      const candidates = [base, alt].filter(Boolean)
      let lastErr
      for (const chatId of candidates) {
        try {
          const msg = await client.sendMessage(chatId, message)
          return { content: [{ type: 'text', text: `Sent. Message ID: ${msg.id._serialized}` }] }
        } catch (err) { lastErr = err }
      }
      throw lastErr
    }
  )

  server.tool(
    'whatsapp_send_image',
    'Send an image from a local file path.',
    {
      to: z.string().describe('Phone number or group ID'),
      filePath: z.string().describe('Absolute path to the image file'),
      caption: z.string().optional(),
      sessionId: z.string().optional(),
    },
    async ({ to, filePath, caption, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const base = to.includes('@') ? to : `${to}@c.us`
      const alt = !to.includes('@') && brAlternate(to) ? `${brAlternate(to)}@c.us` : null
      const candidates = [base, alt].filter(Boolean)
      const media = MessageMedia.fromFilePath(filePath)
      let lastErr
      for (const chatId of candidates) {
        try {
          const msg = await client.sendMessage(chatId, media, { caption })
          return { content: [{ type: 'text', text: `Sent. Message ID: ${msg.id._serialized}` }] }
        } catch (err) { lastErr = err }
      }
      throw lastErr
    }
  )

  server.tool(
    'whatsapp_reply',
    'Reply to a specific message by ID.',
    {
      chatId: z.string().describe('Chat ID (phone or group)'),
      messageId: z.string().describe('Serialized message ID to reply to'),
      message: z.string(),
      sessionId: z.string().optional(),
    },
    async ({ chatId, messageId, message, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const resolved = await resolveId(client, chatId)
      const chat = await client.getChatById(resolved)
      const msgs = await chat.fetchMessages({ limit: 50 })
      const target = msgs.find((m) => m.id.id === messageId || m.id._serialized === messageId)
      if (!target) throw new Error(`Message ${messageId} not found in last 50 messages.`)
      const reply = await target.reply(message)
      return { content: [{ type: 'text', text: `Replied. Message ID: ${reply.id._serialized}` }] }
    }
  )

  server.tool(
    'whatsapp_react',
    'React to a message with an emoji.',
    {
      chatId: z.string(),
      messageId: z.string(),
      emoji: z.string().describe('Emoji, e.g. 👍'),
      sessionId: z.string().optional(),
    },
    async ({ chatId, messageId, emoji, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const resolved = await resolveId(client, chatId)
      const chat = await client.getChatById(resolved)
      const msgs = await chat.fetchMessages({ limit: 50 })
      const target = msgs.find((m) => m.id.id === messageId || m.id._serialized === messageId)
      if (!target) throw new Error(`Message ${messageId} not found in last 50 messages.`)
      await target.react(emoji)
      return { content: [{ type: 'text', text: `Reacted with ${emoji}.` }] }
    }
  )

  server.tool(
    'whatsapp_forward_message',
    'Forward a message to another chat.',
    {
      fromChatId: z.string().describe('Source chat ID'),
      messageId: z.string(),
      toChatId: z.string().describe('Destination chat ID'),
      sessionId: z.string().optional(),
    },
    async ({ fromChatId, messageId, toChatId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const fromResolved = await resolveId(client, fromChatId)
      const toResolved = await resolveId(client, toChatId)
      const chat = await client.getChatById(fromResolved)
      const msgs = await chat.fetchMessages({ limit: 50 })
      const target = msgs.find((m) => m.id.id === messageId || m.id._serialized === messageId)
      if (!target) throw new Error(`Message ${messageId} not found.`)
      await target.forward(toResolved)
      return { content: [{ type: 'text', text: 'Forwarded.' }] }
    }
  )

  server.tool(
    'whatsapp_delete_message',
    'Delete a message (for everyone or just for yourself).',
    {
      chatId: z.string(),
      messageId: z.string(),
      forEveryone: z.boolean().optional().default(true),
      sessionId: z.string().optional(),
    },
    async ({ chatId, messageId, forEveryone, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const resolved = await resolveId(client, chatId)
      const chat = await client.getChatById(resolved)
      const msgs = await chat.fetchMessages({ limit: 50 })
      const target = msgs.find((m) => m.id.id === messageId || m.id._serialized === messageId)
      if (!target) throw new Error(`Message ${messageId} not found.`)
      await target.delete(forEveryone)
      return { content: [{ type: 'text', text: 'Message deleted.' }] }
    }
  )

  // ── Chats ────────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_get_chats',
    'List all chats (most recent first).',
    {
      limit: z.number().int().min(1).max(200).optional().default(30),
      sessionId: z.string().optional(),
    },
    async ({ limit, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const chats = await client.getChats()
      const result = chats.slice(0, limit).map((c) => ({
        id: c.id._serialized,
        name: c.name,
        isGroup: c.isGroup,
        unreadCount: c.unreadCount,
        lastMessage: c.lastMessage?.body?.slice(0, 100) ?? null,
        timestamp: c.timestamp,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'whatsapp_fetch_messages',
    'Fetch messages from a chat.',
    {
      chatId: z.string().describe('Chat ID or phone number'),
      limit: z.number().int().min(1).max(100).optional().default(30),
      sessionId: z.string().optional(),
    },
    async ({ chatId, limit, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const resolved = await resolveId(client, chatId)
      const chat = await client.getChatById(resolved)
      const msgs = await chat.fetchMessages({ limit })
      const result = msgs.map((m) => ({
        id: m.id._serialized,
        from: m.from,
        body: m.body,
        timestamp: m.timestamp,
        fromMe: m.fromMe,
        hasMedia: m.hasMedia,
        type: m.type,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'whatsapp_search_messages',
    'Search for messages containing a term.',
    {
      query: z.string(),
      chatId: z.string().optional().describe('Limit to this chat (optional)'),
      sessionId: z.string().optional(),
    },
    async ({ query, chatId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const id = chatId ? fmtId(chatId) : undefined
      const results = await client.searchMessages(query, { chatId: id })
      const mapped = results.map((m) => ({
        id: m.id._serialized,
        chatId: m.id.remote,
        body: m.body,
        timestamp: m.timestamp,
        fromMe: m.fromMe,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] }
    }
  )

  server.tool(
    'whatsapp_send_seen',
    'Mark a chat as read.',
    { chatId: z.string(), sessionId: z.string().optional() },
    async ({ chatId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const resolved = await resolveId(client, chatId)
      const chat = await client.getChatById(resolved)
      await chat.sendSeen()
      return { content: [{ type: 'text', text: 'Marked as read.' }] }
    }
  )

  // ── Contacts ─────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_get_contacts',
    'List all contacts.',
    {
      limit: z.number().int().min(1).max(500).optional().default(100),
      sessionId: z.string().optional(),
    },
    async ({ limit, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const contacts = await client.getContacts()
      const result = contacts.slice(0, limit).map((c) => ({
        id: c.id._serialized,
        name: c.name || c.pushname,
        number: c.number,
        isMyContact: c.isMyContact,
        isGroup: c.isGroup,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'whatsapp_get_contact',
    'Get details of a specific contact.',
    { contactId: z.string().describe('Phone number or contact ID'), sessionId: z.string().optional() },
    async ({ contactId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const contact = await client.getContactById(fmtId(contactId))
      const pic = await contact.getProfilePicUrl().catch(() => null)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: contact.id._serialized,
            name: contact.name,
            pushname: contact.pushname,
            number: contact.number,
            isMyContact: contact.isMyContact,
            isBlocked: contact.isBlocked,
            profilePicUrl: pic,
          }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'whatsapp_check_number',
    'Check if a phone number is registered on WhatsApp.',
    { number: z.string().describe('Phone number with country code, e.g. 5511999999999'), sessionId: z.string().optional() },
    async ({ number, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const registered = await client.isRegisteredUser(`${number}@c.us`)
      return { content: [{ type: 'text', text: `${number} is ${registered ? '' : 'NOT '}registered on WhatsApp.` }] }
    }
  )

  server.tool(
    'whatsapp_get_profile_pic',
    'Get profile picture URL of a contact or group.',
    { id: z.string().describe('Phone number or group ID'), sessionId: z.string().optional() },
    async ({ id, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const contact = await client.getContactById(fmtId(id))
      const url = await contact.getProfilePicUrl().catch(() => null)
      return { content: [{ type: 'text', text: url ?? 'No profile picture available.' }] }
    }
  )

  // ── Groups ───────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_create_group',
    'Create a new WhatsApp group.',
    {
      name: z.string(),
      participants: z.array(z.string()).describe('Phone numbers with country code'),
      sessionId: z.string().optional(),
    },
    async ({ name, participants, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const result = await client.createGroup(name, participants.map(fmtId))
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ groupId: result.gid._serialized, title: result.title }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'whatsapp_group_add_participants',
    'Add participants to a group.',
    {
      groupId: z.string().describe('Group ID e.g. 120363xxx@g.us'),
      participants: z.array(z.string()),
      sessionId: z.string().optional(),
    },
    async ({ groupId, participants, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const chat = await client.getChatById(groupId)
      await chat.addParticipants(participants.map(fmtId))
      return { content: [{ type: 'text', text: 'Participants added.' }] }
    }
  )

  server.tool(
    'whatsapp_group_remove_participants',
    'Remove participants from a group.',
    {
      groupId: z.string(),
      participants: z.array(z.string()),
      sessionId: z.string().optional(),
    },
    async ({ groupId, participants, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const chat = await client.getChatById(groupId)
      await chat.removeParticipants(participants.map(fmtId))
      return { content: [{ type: 'text', text: 'Participants removed.' }] }
    }
  )

  server.tool(
    'whatsapp_group_get_invite_link',
    'Get the invite link for a group.',
    { groupId: z.string(), sessionId: z.string().optional() },
    async ({ groupId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const chat = await client.getChatById(groupId)
      const code = await chat.getInviteCode()
      return { content: [{ type: 'text', text: `https://chat.whatsapp.com/${code}` }] }
    }
  )

  server.tool(
    'whatsapp_group_leave',
    'Leave a WhatsApp group.',
    { groupId: z.string(), sessionId: z.string().optional() },
    async ({ groupId, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const chat = await client.getChatById(groupId)
      await chat.leave()
      return { content: [{ type: 'text', text: 'Left group.' }] }
    }
  )

  // ── Account ──────────────────────────────────────────────────────────────────

  server.tool(
    'whatsapp_get_my_info',
    'Get info about the connected WhatsApp account.',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      const info = client.info
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ name: info.pushname, number: info.wid.user, platform: info.platform }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'whatsapp_set_status',
    "Set the WhatsApp account's status/bio.",
    { status: z.string(), sessionId: z.string().optional() },
    async ({ status, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      await client.setStatus(status)
      return { content: [{ type: 'text', text: 'Status updated.' }] }
    }
  )

  server.tool(
    'whatsapp_set_display_name',
    'Set display name (pushname).',
    { name: z.string(), sessionId: z.string().optional() },
    async ({ name, sessionId }) => {
      const sid = sessionId || SESSION_ID
      await assertConnected(sid)
      const client = getClient(sid)
      await client.setDisplayName(name)
      return { content: [{ type: 'text', text: 'Display name updated.' }] }
    }
  )

  return server
}

export { restoreSessions }
