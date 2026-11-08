import 'server-only'
import { editInteractionResponse } from '@/lib/discord-bot'
import {
  type Admin, type GroupLite, type MicroMessage, type StaffIdentity,
  authorGuardianIds, channelDefaultGroups, filterValidGroups, getActiveSchoolYearAdmin, getMessage,
  getMessageGroupIds, listGroups, logAction, previewCounts, previewCountsForAuthor, resolveStaffByDiscord,
  setMessageGroups,
} from './data'
import {
  BODY_MAX, CID, EPHEMERAL, POLL_QUESTION_MAX, closedMessage, composeModal, composePollModal, ephemeralText,
  previewMessage, scheduledMessage,
} from './discord-ui'
import { nextSendAt, pragueDate } from './quiet-hours'
import { parseDeadline, parseOptions } from './deadline'
import { recentMessagesForResults } from './results'
import { canAmend, correctMessage, retractMessage } from './amend'

// lib/mikrozpravy/interactions.ts
// Router Discord interakcí mikrozpráv (TRD §3.3).
//
// ZÁSADA „nejdřív odpověz, pak pracuj": Discord čeká na odpověď max 3 s a na
// produkci (Vercel iad1 ↔ Supabase, studený start) se několik DB dotazů za sebou
// do limitu nevejde. Proto:
//   - /rodicum a „Poslat rodičům" otevřou formulář HNED, bez DB — volby příkazu
//     nesou v custom_id formuláře; koncept vznikne až po odeslání formuláře
//   - odeslání formuláře a tlačítka odpoví HNED odloženou odpovědí (type 5/6)
//     a veškerou práci (autorizace, DB, náhled) udělá `later` → PATCH @original
//     (token interakce platí 15 min)
//   - „Upravit text" potřebuje text do formuláře → 1 dotaz (bez autorizace;
//     ta proběhne při odeslání formuláře)
//   - našeptávač skupin z paměťové cache (5 min)
// Každá akce, která něco mění, ověří autora (aktivní zaměstnanec přes staff_discord).

// ── Minimální typy Discord payloadu ─────────────────────────────────────────

interface DiscordOption { name: string; type: number; value?: string | number | boolean; focused?: boolean }
interface DiscordComponent { type: number; custom_id?: string; value?: string; components?: DiscordComponent[]; component?: DiscordComponent }

export interface DiscordInteraction {
  id: string
  type: number
  token: string
  channel_id?: string
  guild_id?: string
  member?: { user?: { id: string } }
  user?: { id: string }
  message?: { id: string }
  data?: {
    name?: string
    type?: number
    custom_id?: string
    options?: DiscordOption[]
    values?: string[]
    target_id?: string
    resolved?: { messages?: Record<string, { content?: string }> }
    components?: DiscordComponent[]
  }
}

export interface HandlerResult {
  response: unknown
  later?: () => Promise<void>
}

const T = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 } as const
const R = { PONG: 1, MESSAGE: 4, DEFERRED_MESSAGE: 5, DEFERRED_UPDATE: 6, UPDATE: 7, AUTOCOMPLETE: 8, MODAL: 9 } as const

export const COMMAND_RODICUM = 'rodicum'
export const COMMAND_ANKETA = 'anketa'
export const COMMAND_VYSLEDKY = 'vysledky'
export const COMMAND_CONTEXT = 'Poslat rodičům'

const NOT_LINKED = 'Nejste propojen/a s Nilssonem (nebo nemáte aktivní úvazek). Požádejte ředitele o propojení Discord účtu v Nilssonu: Správa školy → Discord.'
const NO_SELF_GUARDIAN = 'Pro „jen mně" nemáte v Nilssonu propojený vlastní záznam rodiče. Požádejte ředitele o propojení (Správa školy → Discord).'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export { isSafeMode } from './env'
import { isSafeMode } from './env'

function discordUserId(i: DiscordInteraction): string | undefined {
  return i.member?.user?.id ?? i.user?.id
}

/** Odložená práce: chyby se uživateli ukážou v odložené odpovědi, ne jako „Interakce selhala". */
function deferred(token: string, work: () => Promise<unknown | null>): () => Promise<void> {
  return async () => {
    try {
      const body = await work()
      if (body) await editInteractionResponse(token, body)
    } catch (e) {
      console.error('[mikrozpravy] deferred', e)
      await editInteractionResponse(token, closedMessage('⚠️ Něco se pokazilo. Zkuste to prosím znovu, případně dejte vědět řediteli.')).catch(() => {})
    }
  }
}

// ── Vstup ────────────────────────────────────────────────────────────────────

export async function handleInteraction(i: DiscordInteraction, admin: Admin): Promise<HandlerResult> {
  if (i.type === T.PING) return { response: { type: R.PONG } }
  if (!discordUserId(i)) return { response: ephemeralText('Neznámý uživatel.') }

  switch (i.type) {
    case T.AUTOCOMPLETE:
      return handleAutocomplete(i, admin)
    case T.COMMAND:
      if (i.data?.name === COMMAND_RODICUM) return handleRodicum(i)
      if (i.data?.name === COMMAND_ANKETA) return handleAnketa(i)
      if (i.data?.name === COMMAND_VYSLEDKY) {
        return {
          response: { type: R.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } },
          later: deferred(i.token, async () => {
            const staff = await authorize(admin, i)
            if (!staff) return closedMessage(NOT_LINKED)
            return recentMessagesForResults(admin, staff)
          }),
        }
      }
      if (i.data?.name === COMMAND_CONTEXT) return handleContextMenu(i)
      return { response: ephemeralText('Neznámý příkaz.') }
    case T.MODAL_SUBMIT:
      return handleModalSubmit(i, admin)
    case T.COMPONENT:
      return handleComponent(i, admin)
    default:
      return { response: ephemeralText('Nepodporovaná interakce.') }
  }
}

// ── Našeptávač skupin (cache) ───────────────────────────────────────────────

let groupCache: { at: number; year: string; groups: GroupLite[] } | null = null
const GROUP_CACHE_MS = 5 * 60 * 1000

async function cachedGroups(admin: Admin): Promise<{ year: string; groups: GroupLite[] }> {
  if (groupCache && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache
  const year = await getActiveSchoolYearAdmin(admin)
  const groups = await listGroups(admin, year)
  groupCache = { at: Date.now(), year, groups }
  return groupCache
}

async function handleAutocomplete(i: DiscordInteraction, admin: Admin): Promise<HandlerResult> {
  const focused = i.data?.options?.find(o => o.focused)
  const q = String(focused?.value ?? '').trim().toLocaleLowerCase('cs')
  const { groups } = await cachedGroups(admin)
  const choices = groups
    .filter(g => !q || g.name.toLocaleLowerCase('cs').includes(q))
    .slice(0, 25)
    .map(g => ({ name: g.name.slice(0, 100), value: g.id }))
  return { response: { type: R.AUTOCOMPLETE, data: { choices } } }
}

// ── /rodicum a kontextové menu: formulář HNED, bez DB ───────────────────────

function opt(i: DiscordInteraction, name: string): DiscordOption['value'] | undefined {
  return i.data?.options?.find(o => o.name === name)?.value
}

interface NewDraftSpec {
  confirm: boolean
  urgent: boolean
  excludeAbsent: boolean
  onlyAuthor: boolean
  groupIds: string[]          // z autocomplete (UUID); prázdné → mapování kanálu / výběr v náhledu
  sourceMessageId?: string
  poll?: { closesAt: Date; visibility: 'never' | 'after_vote' | 'after_close' }
}

const VIS_CODE = { never: 'n', after_vote: 'v', after_close: 'c' } as const

/** mz:poll:<příznaky+viditelnost>:<uzávěrka v minutách base36>:<g1>:<g2> */
function encodePollSpec(s: NewDraftSpec & { poll: NonNullable<NewDraftSpec['poll']> }): string {
  const flags = (s.urgent ? 'u' : '') + (s.excludeAbsent ? 'a' : '') + (s.onlyAuthor ? 'm' : '') + VIS_CODE[s.poll.visibility]
  const close = Math.floor(s.poll.closesAt.getTime() / 60000).toString(36)
  return [CID.newPoll, flags, close, ...s.groupIds.slice(0, 2)].join(':')
}

function decodePollSpec(customId: string): NewDraftSpec | null {
  const parts = customId.split(':')
  if (`${parts[0]}:${parts[1]}` !== CID.newPoll) return null
  const flags = parts[2] ?? ''
  const minutes = parseInt(parts[3] ?? '', 36)
  if (!Number.isFinite(minutes)) return null
  const visibility = flags.includes('v') ? 'after_vote' : flags.includes('c') ? 'after_close' : 'never'
  return {
    confirm: false, urgent: flags.includes('u'), excludeAbsent: flags.includes('a'), onlyAuthor: flags.includes('m'),
    groupIds: parts.slice(4).filter(g => UUID_RE.test(g)),
    poll: { closesAt: new Date(minutes * 60000), visibility },
  }
}

/** mz:new:<příznaky>:<g1>:<g2>  (příznaky p=potvrzení u=naléhavé a=bez omluvených m=jen mně, '-' = žádné) */
function encodeNewSpec(s: NewDraftSpec): string {
  const flags = (s.confirm ? 'p' : '') + (s.urgent ? 'u' : '') + (s.excludeAbsent ? 'a' : '') + (s.onlyAuthor ? 'm' : '')
  return [CID.newCommand, flags || '-', ...s.groupIds.slice(0, 2)].join(':')
}

function decodeNewSpec(customId: string): NewDraftSpec | null {
  const parts = customId.split(':')
  if (`${parts[0]}:${parts[1]}` === CID.newContext) {
    return { confirm: false, urgent: false, excludeAbsent: false, onlyAuthor: false, groupIds: [], sourceMessageId: parts[2] || undefined }
  }
  if (`${parts[0]}:${parts[1]}` !== CID.newCommand) return null
  const flags = parts[2] ?? ''
  return {
    confirm: flags.includes('p'), urgent: flags.includes('u'), excludeAbsent: flags.includes('a'), onlyAuthor: flags.includes('m'),
    groupIds: parts.slice(3).filter(g => UUID_RE.test(g)),
  }
}

function handleRodicum(i: DiscordInteraction): HandlerResult {
  const groupIds = [opt(i, 'skupina'), opt(i, 'skupina2')]
    .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
  const spec: NewDraftSpec = {
    confirm: opt(i, 'potvrzeni') === true,
    urgent: opt(i, 'nalehave') === true,
    excludeAbsent: opt(i, 'bez_omluvenych') === true,
    onlyAuthor: opt(i, 'jen_mne') === true,
    groupIds,
  }
  return { response: { type: R.MODAL, data: composeModal(encodeNewSpec(spec), '', null) } }
}

/** /anketa — uzávěrka se ověří hned (čistá funkce, bez DB), formulář se otevře okamžitě. */
function handleAnketa(i: DiscordInteraction): HandlerResult {
  const deadline = parseDeadline(String(opt(i, 'uzaverka') ?? ''))
  if (!deadline.ok) return { response: ephemeralText(`⚠️ ${deadline.error}`) }
  const vis = String(opt(i, 'vysledky') ?? 'never')
  const spec = {
    confirm: false,
    urgent: opt(i, 'nalehave') === true,
    excludeAbsent: opt(i, 'bez_omluvenych') === true,
    onlyAuthor: opt(i, 'jen_mne') === true,
    groupIds: [opt(i, 'skupina'), opt(i, 'skupina2')].filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)),
    poll: { closesAt: deadline.at, visibility: (vis === 'after_vote' || vis === 'after_close' ? vis : 'never') as 'never' | 'after_vote' | 'after_close' },
  }
  return { response: { type: R.MODAL, data: composePollModal(encodePollSpec(spec), '', '', null) } }
}

function handleContextMenu(i: DiscordInteraction): HandlerResult {
  const targetId = i.data?.target_id ?? ''
  const content = (targetId && i.data?.resolved?.messages?.[targetId]?.content) || ''
  const body = content.length > BODY_MAX ? content.slice(0, BODY_MAX - 1) + '…' : content
  return { response: { type: R.MODAL, data: composeModal(`${CID.newContext}:${targetId}`, body, null, 'Přeposlat rodičům') } }
}

// ── Odeslání formuláře: odložená odpověď, práce potom ───────────────────────

function collectModalValues(components: DiscordComponent[] | undefined, out: Record<string, string> = {}): Record<string, string> {
  for (const c of components ?? []) {
    if (c.custom_id && typeof c.value === 'string') out[c.custom_id] = c.value
    if (c.components) collectModalValues(c.components, out)
    if (c.component) collectModalValues([c.component], out)
  }
  return out
}

async function replacePollOptions(admin: Admin, messageId: string, options: string[]): Promise<void> {
  await admin.from('micro_poll_options').delete().eq('message_id', messageId)
  const { error } = await admin.from('micro_poll_options')
    .insert(options.map((label, k) => ({ message_id: messageId, position: k + 1, label })))
  if (error) throw new Error(`micro_poll_options: ${error.message}`)
}

async function pollOptionLabels(admin: Admin, messageId: string): Promise<string[]> {
  const { data } = await admin.from('micro_poll_options').select('label, position').eq('message_id', messageId).order('position')
  return (data ?? []).map(o => o.label)
}

function parseModalFields(i: DiscordInteraction, bodyMax = BODY_MAX): { body: string; link: string | null; warning: string | null; optionsRaw: string } {
  const values = collectModalValues(i.data?.components)
  const body = (values.text ?? '').trim().slice(0, bodyMax)
  const linkRaw = (values.link ?? '').trim()
  const linkOk = linkRaw === '' || (/^https:\/\/\S+$/.test(linkRaw) && linkRaw.length <= 300)
  return {
    body,
    link: linkOk && linkRaw ? linkRaw : null,
    warning: linkOk ? null : 'Odkaz musí začínat https:// — vynechali jsme ho, můžete text upravit.',
    optionsRaw: values.options ?? '',
  }
}

function handleModalSubmit(i: DiscordInteraction, admin: Admin): HandlerResult {
  const customId = i.data?.custom_id ?? ''
  const spec = decodeNewSpec(customId) ?? decodePollSpec(customId)

  if (spec) {
    // Nová zpráva → ephemeral odložená odpověď, koncept a náhled vzniknou až teď.
    return {
      response: { type: R.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } },
      later: deferred(i.token, () => createDraftAndPreview(i, admin, spec)),
    }
  }

  const [, , id] = customId.split(':')

  // Oprava odeslané zprávy (formulář z tlačítka u veřejného zrcadla) → odpověď jen autorovi.
  if (customId.startsWith(`${CID.fixModal}:`)) {
    return {
      response: { type: R.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } },
      later: deferred(i.token, async () => {
        const staff = await authorize(admin, i)
        if (!staff) return closedMessage(NOT_LINKED)
        const m = await getMessage(admin, id ?? '')
        if (!m) return closedMessage('Zpráva nenalezena.')
        if (!canAmend(staff, m)) return closedMessage('Opravit zprávu může jen její autor nebo ředitel.')
        const { body, link } = parseModalFields(i, m.kind === 'poll' ? POLL_QUESTION_MAX : BODY_MAX)
        const r = await correctMessage(admin, staff, m, body, link)
        return closedMessage(r.ok
          ? `✏️ Opraveno. Rodičům šla oprava: 📱 ${r.pushes} push (nahradí původní notifikaci) · ✉️ ${r.emails} e-mail.`
          : `⚠️ ${r.error}`)
      }),
    }
  }

  // Úprava existujícího konceptu („Upravit text") → upravit tentýž náhled.
  return {
    response: i.message ? { type: R.DEFERRED_UPDATE } : { type: R.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } },
    later: deferred(i.token, () => updateDraftAndPreview(i, admin, id ?? '')),
  }
}

async function authorize(admin: Admin, i: DiscordInteraction): Promise<StaffIdentity | null> {
  const uid = discordUserId(i)
  return uid ? resolveStaffByDiscord(admin, uid) : null
}

async function createDraftAndPreview(i: DiscordInteraction, admin: Admin, spec: NewDraftSpec) {
  const staff = await authorize(admin, i)
  if (!staff) return closedMessage(NOT_LINKED)
  if (spec.onlyAuthor && (await authorGuardianIds(admin, staff.staffId)).length === 0) return closedMessage(NO_SELF_GUARDIAN)

  const { body, link, warning, optionsRaw } = parseModalFields(i, spec.poll ? POLL_QUESTION_MAX : BODY_MAX)
  let pollOptions: string[] = []
  if (spec.poll) {
    const parsed = parseOptions(optionsRaw)
    if (!parsed.ok) return closedMessage(`⚠️ ${parsed.error}\n\nVáš text (zkopírujte a zkuste /anketa znovu):\n${body}\n${optionsRaw}`)
    pollOptions = parsed.options
  }
  const year = await getActiveSchoolYearAdmin(admin)
  let groupIds = spec.onlyAuthor ? [] : await filterValidGroups(admin, spec.groupIds, year)
  if (!spec.onlyAuthor && groupIds.length === 0 && i.channel_id) groupIds = await channelDefaultGroups(admin, i.channel_id, year)

  const now = new Date().toISOString()
  const { data: draft, error } = await admin.from('micro_messages').insert({
    author_staff_id: staff.staffId,
    school_year: year,
    kind: spec.poll ? 'poll' : spec.urgent || spec.confirm ? 'confirm' : 'info',
    poll_closes_at: spec.poll ? spec.poll.closesAt.toISOString() : null,
    results_visibility: spec.poll ? spec.poll.visibility : 'never',
    urgent: spec.urgent,
    exclude_absent: spec.excludeAbsent,
    only_author: spec.onlyAuthor,
    body,
    link_url: link,
    status: 'draft',
    source: 'discord',
    discord_channel_id: i.channel_id ?? null,
    discord_source_message_id: spec.sourceMessageId ?? null,
    discord_preview_token: i.token,
    discord_preview_token_at: now,
  }).select('*').single()
  if (error || !draft) throw new Error(`micro_messages insert: ${error?.message}`)
  await setMessageGroups(admin, draft.id, groupIds)
  if (pollOptions.length) await replacePollOptions(admin, draft.id, pollOptions)
  await logAction(admin, draft.id, staff.staffId, 'created', { via: spec.sourceMessageId ? 'context_menu' : 'command' })

  return buildPreview(admin, draft, warning)
}

async function updateDraftAndPreview(i: DiscordInteraction, admin: Admin, id: string) {
  const staff = await authorize(admin, i)
  if (!staff) return closedMessage(NOT_LINKED)
  const m = await getMessage(admin, id)
  if (!m || m.author_staff_id !== staff.staffId) return closedMessage('Zpráva nenalezena.')
  if (m.status !== 'draft') return closedMessage('Zpráva už byla odeslána nebo zrušena.')

  const { body, link, warning, optionsRaw } = parseModalFields(i, m.kind === 'poll' ? POLL_QUESTION_MAX : BODY_MAX)
  if (m.kind === 'poll') {
    const parsed = parseOptions(optionsRaw)
    if (!parsed.ok) return buildPreview(admin, m, `${parsed.error} Změny nebyly uloženy.`)
    await replacePollOptions(admin, m.id, parsed.options)
  }
  const { data: updated, error } = await admin.from('micro_messages')
    .update({
      body, link_url: link,
      discord_preview_token: i.token, discord_preview_token_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', m.id).eq('status', 'draft')
    .select('*').single()
  if (error || !updated) return closedMessage('Zprávu se nepodařilo uložit.')
  return buildPreview(admin, updated, warning)
}

// ── Náhled ──────────────────────────────────────────────────────────────────

async function buildPreview(admin: Admin, m: MicroMessage, warning: string | null) {
  const [groups, selected] = await Promise.all([
    listGroups(admin, m.school_year),
    getMessageGroupIds(admin, m.id),
  ])
  const counts = m.only_author
    ? await previewCountsForAuthor(admin, m.author_staff_id, m.school_year)
    : await previewCounts(admin, selected, m.school_year, m.exclude_absent, pragueDate())
  const { sendAt, heldByQuietHours } = nextSendAt(new Date(), m.urgent)
  const pollOptions = m.kind === 'poll' ? await pollOptionLabels(admin, m.id) : undefined
  const msg = previewMessage({ message: m, groups, selectedGroupIds: selected, counts, sendAt, heldByQuietHours, safeMode: isSafeMode(), pollOptions })
  if (warning) msg.content = `⚠️ ${warning}`
  if (m.kind === 'poll' && m.poll_closes_at && new Date(m.poll_closes_at).getTime() <= sendAt.getTime()) {
    msg.content = `${msg.content ? msg.content + '\n' : ''}⚠️ Uzávěrka je dřív, než zpráva odejde (tiché hodiny?). Zrušte a založte anketu s pozdější uzávěrkou.`
  }
  if (groups.length > 25 && !m.only_author) {
    msg.content = `${msg.content ? msg.content + '\n' : ''}ℹ️ Skupin je víc než 25 — ve výběru je prvních 25; další zadejte parametrem \`skupina\` příkazu /rodicum.`
  }
  return msg
}

// ── Tlačítka a výběr: odložená odpověď, práce potom ─────────────────────────

function handleComponent(i: DiscordInteraction, admin: Admin): Promise<HandlerResult> | HandlerResult {
  const cid = i.data?.custom_id ?? ''
  const lastColon = cid.lastIndexOf(':')
  const action = cid.slice(0, lastColon)
  const id = cid.slice(lastColon + 1)

  // „Upravit text" musí odpovědět formulářem hned (nejde odložit) → 1 dotaz na text.
  if (action === CID.edit) return openEditModal(admin, id)

  // ── Zrcadlo (veřejná zpráva v kanálu): Opravit / Stáhnout ──
  if (action === CID.fix) return openFixModal(admin, id)
  if (action === CID.retract) {
    // Potvrzení bez DB (oprávnění se ověří až po potvrzení).
    return {
      response: {
        type: R.MESSAGE,
        data: {
          flags: EPHEMERAL,
          content: '**Opravdu stáhnout zprávu?** Rodičům, kterým dorazila push notifikace, ji nahradí upozornění „Zpráva byla stažena", kdo ji dostal e-mailem, dostane opravný e-mail. Hlasování v anketě se zastaví.',
          components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: `${CID.retractOk}:${id}`, label: 'Ano, stáhnout' }] }],
        },
      },
    }
  }
  if (action === CID.retractOk) {
    return {
      response: { type: R.DEFERRED_UPDATE },
      later: deferred(i.token, async () => {
        const staff = await authorize(admin, i)
        if (!staff) return closedMessage(NOT_LINKED)
        const m = await getMessage(admin, id)
        if (!m) return closedMessage('Zpráva nenalezena.')
        if (!canAmend(staff, m)) return closedMessage('Stáhnout zprávu může jen její autor nebo ředitel.')
        const r = await retractMessage(admin, staff, m)
        return closedMessage(r.ok
          ? `🚫 Staženo. Upozornění: 📱 ${r.pushes} push · ✉️ ${r.emails} e-mail. Zrcadlo se do minuty přepíše.`
          : `⚠️ ${r.error}`)
      }),
    }
  }

  return {
    response: { type: R.DEFERRED_UPDATE },
    later: deferred(i.token, () => componentWork(i, admin, action, id)),
  }
}

async function openFixModal(admin: Admin, id: string): Promise<HandlerResult> {
  const m = await getMessage(admin, id)
  if (!m || m.status !== 'sent') return { response: ephemeralText('Opravit jde jen odeslanou zprávu.') }
  return { response: { type: R.MODAL, data: composeModal(`${CID.fixModal}:${m.id}`, m.body, m.link_url, 'Oprava odeslané zprávy') } }
}

async function openEditModal(admin: Admin, id: string): Promise<HandlerResult> {
  const m = await getMessage(admin, id)
  if (!m || m.status !== 'draft') return { response: { type: R.UPDATE, data: closedMessage('Tahle zpráva už byla odeslána nebo zrušena.') } }
  if (m.kind === 'poll') {
    const labels = await pollOptionLabels(admin, m.id)
    return { response: { type: R.MODAL, data: composePollModal(`${CID.pollModal}:${m.id}`, m.body, labels.join('\n'), m.link_url) } }
  }
  return { response: { type: R.MODAL, data: composeModal(`${CID.modal}:${m.id}`, m.body, m.link_url) } }
}

async function componentWork(i: DiscordInteraction, admin: Admin, action: string, id: string) {
  const staff = await authorize(admin, i)
  if (!staff) return closedMessage(NOT_LINKED)
  const m = await getMessage(admin, id)
  if (!m) return closedMessage('Zpráva nenalezena.')
  if (m.author_staff_id !== staff.staffId) return closedMessage('Tuhle zprávu může upravit jen její autor.')

  if (action === CID.abort) return abort(admin, staff, m)
  if (m.status !== 'draft') return closedMessage('Tahle zpráva už byla odeslána nebo zrušena.')

  switch (action) {
    case CID.groups: {
      const ids = await filterValidGroups(admin, i.data?.values ?? [], m.school_year)
      await setMessageGroups(admin, m.id, ids)
      return buildPreview(admin, m, null)
    }
    case CID.cancel: {
      const { error } = await admin.from('micro_messages')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', m.id).eq('status', 'draft')
      if (error) {
        console.error('[mikrozpravy] cancel draft', m.id, error.message)
        return closedMessage('⚠️ Koncept se nepodařilo zrušit. Zkuste to prosím znovu.')
      }
      await logAction(admin, m.id, staff.staffId, 'cancelled', { stage: 'draft' })
      return closedMessage('Zrušeno — nic se neposlalo.')
    }
    case CID.send:
      return send(i, admin, staff, m)
    default:
      return closedMessage('Neznámá akce.')
  }
}

async function send(i: DiscordInteraction, admin: Admin, staff: StaffIdentity, m: MicroMessage) {
  const groupIds = await getMessageGroupIds(admin, m.id)
  if (groupIds.length === 0 && !m.only_author) return buildPreview(admin, m, 'Vyberte aspoň jednu skupinu.')
  if (!m.body) return buildPreview(admin, m, 'Zpráva nemá text.')

  const { sendAt, heldByQuietHours } = nextSendAt(new Date(), m.urgent)
  if (m.kind === 'poll') {
    if ((await pollOptionLabels(admin, m.id)).length < 2) return buildPreview(admin, m, 'Anketa potřebuje aspoň 2 možnosti.')
    if (!m.poll_closes_at || new Date(m.poll_closes_at).getTime() <= sendAt.getTime()) {
      return buildPreview(admin, m, 'Uzávěrka je dřív, než by zpráva odešla.')
    }
  }
  const now = new Date().toISOString()
  const { data: scheduled } = await admin.from('micro_messages')
    .update({
      status: 'scheduled',
      send_at: sendAt.toISOString(),
      held_by_quiet_hours: heldByQuietHours,
      discord_preview_token: i.token,
      discord_preview_token_at: now,
      updated_at: now,
    })
    .eq('id', m.id).eq('status', 'draft')
    .select('*').maybeSingle()
  if (!scheduled) return closedMessage('Tahle zpráva už byla odeslána nebo zrušena.')

  await logAction(admin, m.id, staff.staffId, 'scheduled', { send_at: sendAt.toISOString(), held_by_quiet_hours: heldByQuietHours, groups: groupIds })

  const groups = await listGroups(admin, m.school_year)
  const label = m.only_author ? '🧪 Jen vám (test)' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ')
  return scheduledMessage(scheduled, label, sendAt, heldByQuietHours)
}

async function abort(admin: Admin, staff: StaffIdentity, m: MicroMessage) {
  const { data, error } = await admin.from('micro_messages')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', m.id).eq('status', 'scheduled')
    .select('id').maybeSingle()
  if (error) {
    console.error('[mikrozpravy] abort', m.id, error.message)
    return closedMessage('⚠️ Zrušení se nepodařilo — zkuste to hned znovu, jinak zpráva odejde.')
  }
  if (!data) return closedMessage('Zpráva už odešla — zrušit ji nejde. (Stažení odeslané zprávy přijde v další fázi.)')
  await logAction(admin, m.id, staff.staffId, 'cancelled', { stage: 'scheduled' })
  return closedMessage('Odeslání zrušeno — rodičům nic neodešlo.')
}
