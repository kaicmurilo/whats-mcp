# whats-mcp

> MCP server standalone para WhatsApp Web — use o WhatsApp de qualquer AI CLI sem servidor HTTP externo.

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio%2FSSE-blue)](https://modelcontextprotocol.io)
[![whatsapp-web.js](https://img.shields.io/badge/whatsapp--web.js-1.32-25D366?logo=whatsapp)](https://github.com/pedroslopez/whatsapp-web.js)

---

## O que é

`whats-mcp` é um servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io) que expõe o WhatsApp Web como ferramentas para qualquer AI CLI compatível (Claude Code, Gemini CLI, etc.).

**Funcionalidades principais:**
- **Daemon compartilhado:** o primeiro CLI que abrir sobe o daemon automaticamente; os demais reaproveitam o mesmo processo (e o mesmo Chromium)
- **Zero configuração de servidor:** sem Redis obrigatório, sem PostgreSQL, sem nada externo
- **Sessão persistente:** dados de auth salvos em disco — reconecta sem QR ao reiniciar
- **Múltiplas sessões:** vários números de WhatsApp simultaneamente

---

## Arquitetura

```
Claude Code / Gemini CLI / qualquer AI CLI
    │
    │  stdio (MCP protocol)
    ▼
index.mjs  (launcher + proxy stdio↔SSE)
    │
    │  1. Verifica se daemon está rodando em :3001
    │  2. Se não: sobe daemon.mjs detached
    │  3. Conecta via SSE → proxeia stdin/stdout
    ▼
daemon.mjs  (servidor MCP SSE/HTTP, processo independente)
    │
    ├── GET  /sse              ← stream SSE para clientes MCP
    ├── POST /message          ← recebe JSON-RPC dos clientes
    └── GET  /health           ← health check
    │
    ▼
src/mcp-server.mjs  (factory com as 24 tools MCP)
    │
    ▼
src/sessions.js  →  whatsapp-web.js (Puppeteer/Chromium headless)
    │
    ▼
WhatsApp Web
```

**Resultado:** o Chromium sobe uma única vez (quando o primeiro CLI abre), e fica vivo independentemente de quantos CLIs estão conectados ou desconectados.

---

## Pré-requisitos

- **Node.js >= 18**
- **WhatsApp** instalado no celular para escanear o QR (apenas na primeira vez)
- Chromium é baixado automaticamente pelo Puppeteer no `npm install` (~170 MB)

---

## Instalação

```bash
git clone <repo>
cd whats-mcp
npm install
cp .env.example .env
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta do daemon SSE/HTTP |
| `WHATS_SESSION_ID` | `default` | ID da sessão padrão |
| `SESSIONS_PATH` | `./sessions` | Pasta onde os dados de auth são salvos |
| `RECOVER_SESSIONS` | `true` | Auto-reconectar sessões salvas ao iniciar |
| `BASE_WEBHOOK_URL` | `http://localhost:3000` | URL para receber eventos via webhook (opcional) |
| `REDIS_HOST` | `localhost` | Host do Redis (opcional) |
| `REDIS_PORT` | `6379` | Porta do Redis (opcional) |
| `REDIS_PASSWORD` | — | Senha do Redis (opcional) |
| `WEB_VERSION` | — | Versão específica do WhatsApp Web (opcional) |
| `WEB_VERSION_CACHE_TYPE` | `none` | Tipo de cache da versão: `none`, `local`, `remote` |

> **Redis é opcional.** Sem Redis, o cache usa memória automaticamente.

---

## Configuração nas AI CLIs

Todas as CLIs usam o mesmo entry point `index.mjs` via **stdio**. O daemon SSE é gerenciado automaticamente.

### Claude Code

```bash
claude mcp add whatsapp node /caminho/absoluto/para/whats-mcp/index.mjs \
  -e WHATS_SESSION_ID=default \
  -e SESSIONS_PATH=/caminho/absoluto/para/whats-mcp/sessions \
  -e RECOVER_SESSIONS=true \
  -e PORT=3001
```

### Gemini CLI

Adicione em `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/caminho/absoluto/para/whats-mcp/index.mjs"],
      "env": {
        "WHATS_SESSION_ID": "default",
        "SESSIONS_PATH": "/caminho/absoluto/para/whats-mcp/sessions",
        "RECOVER_SESSIONS": "true",
        "PORT": "3001"
      }
    }
  }
}
```

---

## Rodar daemon no boot (opcional)

Por padrão, o daemon sobe automaticamente quando qualquer CLI abre. Se quiser que o daemon inicie junto com o sistema (para que o Chromium já esteja pronto antes de abrir qualquer CLI):

### pm2 (recomendado — macOS e Linux)

```bash
npm install -g pm2

cd /caminho/para/whats-mcp
pm2 start daemon.mjs --name whats-mcp \
  --env PORT=3001 \
  --env WHATS_SESSION_ID=default \
  --env SESSIONS_PATH=/caminho/para/whats-mcp/sessions \
  --env RECOVER_SESSIONS=true

pm2 save        # salva lista de processos
pm2 startup     # gera o comando para registrar no boot
```

O `pm2 startup` vai imprimir um comando com `sudo` — execute-o para registrar o daemon no launchd (macOS) ou systemd (Linux):

```bash
# Exemplo do output (execute o que o pm2 gerar, não este):
sudo env PATH=$PATH:/usr/local/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup launchd -u seu-usuario --hp /Users/seu-usuario
```

**Comandos úteis pm2:**

```bash
pm2 status              # ver estado
pm2 logs whats-mcp      # ver logs em tempo real
pm2 restart whats-mcp   # reiniciar daemon
pm2 stop whats-mcp      # parar daemon
```

### launchd manual (macOS)

Crie `~/Library/LaunchAgents/com.whats-mcp.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.whats-mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/caminho/para/whats-mcp/daemon.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/caminho/para/whats-mcp</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>3001</string>
    <key>WHATS_SESSION_ID</key><string>default</string>
    <key>SESSIONS_PATH</key><string>/caminho/para/whats-mcp/sessions</string>
    <key>RECOVER_SESSIONS</key><string>true</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>/tmp/whats-mcp.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.whats-mcp.plist
```

### systemd (Linux)

Crie `/etc/systemd/system/whats-mcp.service`:

```ini
[Unit]
Description=whats-mcp daemon
After=network.target

[Service]
Type=simple
User=seu-usuario
WorkingDirectory=/caminho/para/whats-mcp
ExecStart=/usr/bin/node /caminho/para/whats-mcp/daemon.mjs
Restart=always
Environment=PORT=3001
Environment=WHATS_SESSION_ID=default
Environment=SESSIONS_PATH=/caminho/para/whats-mcp/sessions
Environment=RECOVER_SESSIONS=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable whats-mcp
sudo systemctl start whats-mcp
```

---

## Fluxo de autenticação

```
1. AI chama: whatsapp_start
       │
       ▼
2. Chromium sobe headless
   QR code abre no Preview/visor do sistema (PNG)
   ASCII art do QR aparece também no response da tool
       │
       ▼
3. Usuário escaneia o QR com WhatsApp no celular
       │
       ▼
4. Sessão fica CONNECTED
   Dados salvos em: sessions/session-{id}/
       │
       ▼
5. Próximas execuções: conecta automático sem QR (LocalAuth)
```

> `whatsapp_status` aguarda até **120 segundos** pelo Chromium antes de reportar timeout — normal na primeira vez ou após reinicialização.

---

## Múltiplas sessões

Todas as tools aceitam parâmetro `sessionId` opcional:

```
sessions/
  session-default/    ← número pessoal
  session-empresa/    ← número da empresa
  session-bot/        ← número do bot
```

```bash
# Iniciar sessão adicional
whatsapp_start sessionId=empresa

# Usar sessão específica
whatsapp_send_message to=5511999999999 message="Olá" sessionId=empresa
```

---

## Tools disponíveis

### Sessão

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_start` | `sessionId?` | Inicia sessão. QR abre no sistema se não autenticado |
| `whatsapp_status` | `sessionId?` | Estado atual (CONNECTED, INITIALIZING...) — polling 120s |
| `whatsapp_get_qr` | `sessionId?` | Retorna QR code atual como ASCII art |
| `whatsapp_logout` | `sessionId?` | Encerra sessão (10s timeout) |
| `whatsapp_reset` | `sessionId?` | Force-kill Chromium + deleta sessão do disco |

### Mensagens

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_send_message` | `to`, `message`, `sessionId?` | Envia mensagem de texto |
| `whatsapp_send_image` | `to`, `filePath`, `caption?`, `sessionId?` | Envia imagem de arquivo local |
| `whatsapp_reply` | `chatId`, `messageId`, `message`, `sessionId?` | Responde mensagem específica |
| `whatsapp_react` | `chatId`, `messageId`, `emoji`, `sessionId?` | Reage com emoji |
| `whatsapp_forward_message` | `fromChatId`, `messageId`, `toChatId`, `sessionId?` | Encaminha mensagem |
| `whatsapp_delete_message` | `chatId`, `messageId`, `forEveryone?`, `sessionId?` | Deleta mensagem |

### Chats

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_get_chats` | `limit?`, `sessionId?` | Lista conversas (mais recentes primeiro) |
| `whatsapp_fetch_messages` | `chatId`, `limit?`, `sessionId?` | Busca mensagens de um chat |
| `whatsapp_search_messages` | `query`, `chatId?`, `sessionId?` | Pesquisa mensagens por texto |
| `whatsapp_send_seen` | `chatId`, `sessionId?` | Marca chat como lido |

### Contatos

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_get_contacts` | `limit?`, `sessionId?` | Lista todos os contatos |
| `whatsapp_get_contact` | `contactId`, `sessionId?` | Detalhes de um contato específico |
| `whatsapp_check_number` | `number`, `sessionId?` | Verifica se número está no WhatsApp |
| `whatsapp_get_profile_pic` | `id`, `sessionId?` | URL da foto de perfil |

### Grupos

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_create_group` | `name`, `participants[]`, `sessionId?` | Cria grupo |
| `whatsapp_group_add_participants` | `groupId`, `participants[]`, `sessionId?` | Adiciona participantes |
| `whatsapp_group_remove_participants` | `groupId`, `participants[]`, `sessionId?` | Remove participantes |
| `whatsapp_group_get_invite_link` | `groupId`, `sessionId?` | Retorna link de convite |
| `whatsapp_group_leave` | `groupId`, `sessionId?` | Sair do grupo |

### Conta

| Tool | Parâmetros | Descrição |
|---|---|---|
| `whatsapp_get_my_info` | `sessionId?` | Info da conta conectada (nome, número, plataforma) |
| `whatsapp_set_status` | `status`, `sessionId?` | Atualiza bio/status |
| `whatsapp_set_display_name` | `name`, `sessionId?` | Atualiza nome de exibição |

---

## Formato dos IDs

| Tipo | Formato | Exemplo |
|---|---|---|
| Número individual | `{DDI}{DDD}{número}@c.us` | `5511999999999@c.us` |
| Grupo | `{id}@g.us` | `120363012345678901@g.us` |
| Input simplificado | só o número sem `@c.us` | `5511999999999` (o MCP resolve automaticamente) |

> Sempre use o código do país sem o `+`. Ex: Brasil = `55`, EUA = `1`.
>
> Internamente, o MCP usa `getNumberId()` para resolver o número correto incluindo o LID (Linked Device ID) exigido pelas versões mais recentes do WhatsApp.

---

## Exemplos de uso (via AI CLI)

```
# Iniciar sessão e autenticar
"Inicia o WhatsApp com whatsapp_start e me fala quando estiver conectado"

# Verificar status
"Qual o status da sessão WhatsApp?"

# Enviar mensagem
"Manda 'Reunião amanhã às 10h' para o número 5511999999999 via WhatsApp"

# Listar conversas recentes
"Lista as 10 últimas conversas do WhatsApp com o número de mensagens não lidas"

# Buscar mensagens
"Pesquisa mensagens com o texto 'proposta' em todos os chats do WhatsApp"

# Buscar mensagens de um chat específico
"Busca as últimas 30 mensagens do chat 5511999999999"

# Reagir a mensagem
"Reage com 👍 na mensagem ID abc123 do chat 5511999999999"

# Criar grupo
"Cria um grupo no WhatsApp chamado 'Time Dev' com os números 5511999999991 e 5511999999992"

# Múltiplas sessões
"Inicia sessão 'empresa' no WhatsApp para o número corporativo"
"Envia 'Relatório enviado' para 5511999999999 usando a sessão 'empresa'"
```

---

## Webhooks (opcional)

Defina `BASE_WEBHOOK_URL` no `.env` para receber eventos em tempo real:

```env
BASE_WEBHOOK_URL=http://seu-servidor.com/webhook
```

Payload enviado via `POST`:

```json
{
  "sessionId": "default",
  "dataType": "message",
  "data": { ... }
}
```

| Evento | Descrição |
|---|---|
| `message` | Nova mensagem recebida |
| `message_create` | Mensagem enviada |
| `message_ack` | Confirmação de leitura |
| `message_reaction` | Reação em mensagem |
| `message_revoke_everyone` | Mensagem deletada por todos |
| `qr` | Novo QR code gerado |
| `ready` | Sessão conectada e pronta |
| `authenticated` | Autenticação concluída |
| `disconnected` | Sessão desconectada |
| `auth_failure` | Falha na autenticação |
| `change_state` | Mudança de estado |
| `group_join` | Entrada em grupo |
| `group_leave` | Saída de grupo |
| `group_update` | Atualização de grupo |
| `call` | Chamada recebida |
| `contact_changed` | Número de contato alterado |

Para desabilitar eventos específicos:

```env
DISABLED_CALLBACKS=message_ack|loading_screen
```

---

## Troubleshooting

### QR code não aparece
Aguarde ~20s após `whatsapp_start` — o Chromium leva tempo. O QR abre automaticamente no Preview (macOS) ou visor padrão (Linux). O ASCII art também aparece no response da tool.

### `whatsapp_status` retorna INITIALIZING
Normal — polling de até **120 segundos** aguarda o Chromium restaurar a sessão salva. Se ainda assim timeout, chame `whatsapp_start` novamente.

### Daemon não sobe automaticamente
Teste manualmente para ver o erro:
```bash
cd /caminho/para/whats-mcp
node daemon.mjs
```
Verifique se a porta 3001 está livre: `lsof -i :3001`

### `Session not found. Call whatsapp_start first.`
Chame `whatsapp_start` antes de qualquer outra tool. Com `RECOVER_SESSIONS=true`, sessões salvas reconectam automaticamente.

### `whatsapp_logout` trava
Use `whatsapp_reset` — força SIGKILL no Chromium e deleta os dados da sessão do disco.

### Sessão desconecta frequentemente
- Mantenha o celular com internet ativa
- Não desconecte o WhatsApp do celular manualmente
- `RECOVER_SESSIONS=true` reconecta automaticamente após quedas

### `Error: spawn Chromium ENOENT` ou `Failed to launch the browser`
```bash
# Opção 1: reinstalar
npm install

# Opção 2: usar Chromium do sistema (Linux)
sudo apt-get install -y chromium-browser
# No .env:
CHROME_BIN=/usr/bin/chromium-browser
```

### Linux sem interface gráfica (servidor/WSL)
```bash
sudo apt-get install -y \
  chromium-browser \
  libgbm-dev \
  libxkbcommon-dev \
  libxss1 \
  libasound2
```

### Redis não conecta
Sem Redis, o cache usa memória automaticamente. Mensagem `⚠️ Redis não disponível, usando cache em memória` é normal — não é erro crítico.

### WhatsApp bane a sessão (`auth_failure`)
Uso intensivo ou automatizado pode acionar proteções do WhatsApp. Reduza a frequência de chamadas e evite envio em massa.

### MCP 'Failed to connect' no Claude Code (SDK 1.x+)
Sintoma: `claude mcp list` mostra '✗ Failed to connect' para o whatsapp MCP.
- **Causa:** O middleware `express.json()` consome o stream do request body antes do `SSEServerTransport.handlePostMessage()` conseguir lê-lo, causando erro 'stream is not readable'.
- **Fix:** Já aplicado no código (req.body passado como `parsedBody` para o `handlePostMessage`). Certifique-se de estar usando a versão mais recente do projeto.

### QR code não limpa após autenticar / status continua mostrando QR
Sintoma: Usuário escaneia QR, WhatsApp mostra dispositivo conectado no celular, mas `whatsapp_status` continua pedindo scan.
- **Causa:** O valor de `client.qr` não era zerado após o evento `authenticated`.
- **Fix:** Já aplicado no código (`client.qr = null` no handler do evento 'authenticated').

### Session corrompida / 'Execution context was destroyed' / Estado UNPAIRED
Sintoma: Logs mostram 'Execution context was destroyed' ou status retorna UNPAIRED mesmo após ter funcionado antes.
- **Causa:** Dados de sessão incompatíveis ou corrompidos (ex: daemon foi reiniciado durante autenticação, ou WhatsApp desconectou o dispositivo).
- **Fix:** Use a tool `whatsapp_reset` (via AI), ou manualmente: mate o daemon, delete a pasta `sessions/session-{id}/` e reinicie com `whatsapp_start`.

---

## Estrutura do projeto

```
whats-mcp/
├── index.mjs           ← stdio launcher + proxy (entry point para todas as CLIs)
├── daemon.mjs          ← servidor MCP SSE/HTTP independente (processo persistente)
├── package.json
├── .env.example
├── .env                ← criado por você (não commitado)
├── sessions/           ← criado automaticamente
│   └── session-{id}/   ← dados LocalAuth do WhatsApp
└── src/
    ├── mcp-server.mjs  ← factory McpServer com todas as 24 tools
    ├── config.js       ← configurações via env vars
    ├── sessions.js     ← gerenciamento de sessões whatsapp-web.js
    ├── utils.js        ← helpers (triggerWebhook, waitForNestedObject)
    └── utils/
        └── cache.js    ← Redis com fallback automático para memória
```

---

## Licença

MIT
