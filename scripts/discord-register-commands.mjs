// scripts/discord-register-commands.mjs
// Registrace příkazů Discord aplikace mikrozpráv jako GUILD commands (okamžitá změna).
//
// Použití:
//   node --env-file=.env.local scripts/discord-register-commands.mjs            # zaregistrovat
//   node --env-file=.env.local scripts/discord-register-commands.mjs --list     # vypsat servery bota
//
// Env: DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (když chybí a bot je
// na právě jednom serveru, použije se ten).
// PUT nahradí celou sadu příkazů aplikace na daném serveru (idempotentní).

const API = 'https://discord.com/api/v10'
const { DISCORD_APP_ID: appId, DISCORD_BOT_TOKEN: token } = process.env
let guildId = process.env.DISCORD_GUILD_ID

if (!appId || !token) {
  console.error('Chybí DISCORD_APP_ID nebo DISCORD_BOT_TOKEN (spouštěj s --env-file=.env.local).')
  process.exit(1)
}

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const STRING = 3
const BOOLEAN = 5
const CHAT_INPUT = 1
const MESSAGE = 3

const commands = [
  {
    type: CHAT_INPUT,
    name: 'rodicum',
    description: 'Rychlá zpráva rodičům (push notifikace / e-mail)',
    dm_permission: false,
    options: [
      { type: STRING, name: 'skupina', description: 'Komu (třída, oddělení, akce)', autocomplete: true, required: false },
      { type: STRING, name: 'skupina2', description: 'Další skupina', autocomplete: true, required: false },
      { type: BOOLEAN, name: 'potvrzeni', description: 'Rodiče potvrdí „Beru na vědomí" 👍', required: false },
      { type: BOOLEAN, name: 'nalehave', description: '⚡ Naléhavé — i v tichých hodinách, vyžaduje potvrzení', required: false },
      { type: BOOLEAN, name: 'bez_omluvenych', description: 'Vynechat děti s omluvenkou na dnešek', required: false },
      { type: BOOLEAN, name: 'jen_mne', description: '🧪 Test: pošle ostře, ale jen mně jako rodiči (skupiny se ignorují)', required: false },
    ],
  },
  {
    type: CHAT_INPUT,
    name: 'anketa',
    description: 'Anketa pro rodiče (hlasuje se za každé dítě)',
    dm_permission: false,
    options: [
      { type: STRING, name: 'uzaverka', description: 'Do kdy hlasovat: 14:00 · zítra 8:30 · 12.11. 18:00', required: true },
      { type: STRING, name: 'skupina', description: 'Komu (třída, oddělení)', autocomplete: true, required: false },
      { type: STRING, name: 'skupina2', description: 'Další skupina', autocomplete: true, required: false },
      { type: STRING, name: 'vysledky', description: 'Uvidí rodiče výsledky?', required: false, choices: [
        { name: 'Ne (výchozí)', value: 'never' },
        { name: 'Po svém hlasování', value: 'after_vote' },
        { name: 'Po uzávěrce', value: 'after_close' },
      ] },
      { type: BOOLEAN, name: 'nalehave', description: '⚡ Naléhavé — i v tichých hodinách', required: false },
      { type: BOOLEAN, name: 'bez_omluvenych', description: 'Vynechat děti s omluvenkou na dnešek', required: false },
      { type: BOOLEAN, name: 'jen_mne', description: '🧪 Test: pošle ostře, ale jen mně jako rodiči', required: false },
    ],
  },
  {
    type: CHAT_INPUT,
    name: 'vysledky',
    description: 'Výsledky mých posledních zpráv a anket (jména jen v Nilssonu)',
    dm_permission: false,
  },
  { type: MESSAGE, name: 'Poslat rodičům', dm_permission: false },
]

async function main() {
if (process.argv.includes('--list')) {
  const guilds = await api('/users/@me/guilds')
  for (const g of guilds) console.log(`${g.id}  ${g.name}`)
  return
}

if (!guildId) {
  const guilds = await api('/users/@me/guilds')
  if (guilds.length !== 1) {
    console.error(`Bot je na ${guilds.length} serverech — nastav DISCORD_GUILD_ID (viz --list).`)
    process.exitCode = 1
    return
  }
  guildId = guilds[0].id
  console.log(`DISCORD_GUILD_ID nenastaveno → jediný server bota: ${guilds[0].name} (${guildId})`)
}

const result = await api(`/applications/${appId}/guilds/${guildId}/commands`, {
  method: 'PUT',
  body: JSON.stringify(commands),
})
console.log(`Zaregistrováno ${result.length} příkazů na serveru ${guildId}:`)
for (const c of result) console.log(` - ${c.name} (type ${c.type}, id ${c.id})`)
}

// process.exitCode místo process.exit(): na Windows exit s otevřeným fetch handle padá v libuv.
await main()
