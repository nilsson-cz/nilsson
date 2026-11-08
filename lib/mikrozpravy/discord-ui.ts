// lib/mikrozpravy/discord-ui.ts
// Discord zprávy a komponenty mikrozpráv: modal, náhled, odpočet, výsledek.
// Čisté funkce (bez DB) — vstupem jsou hotová data.

import type { GroupLite, MicroMessage, PreviewCounts } from './data'
import { formatPragueTime } from './quiet-hours'

export const EPHEMERAL = 64
export const BODY_MAX = 280

// custom_id prefixy (≤ 100 znaků): mz:<akce>:<messageId>
export const CID = {
  modal: 'mz:modal',
  newCommand: 'mz:new',
  newContext: 'mz:ctx',
  newPoll: 'mz:poll',
  pollModal: 'mz:pmodal',
  groups: 'mz:grp',
  send: 'mz:send',
  edit: 'mz:edit',
  cancel: 'mz:cancel',
  abort: 'mz:abort',
  fix: 'mz:fix',
  fixModal: 'mz:fixm',
  retract: 'mz:ret',
  retractOk: 'mz:retok',
} as const

const COLOR_INFO = 0x0f6e56
const COLOR_URGENT = 0xdc2626
const COLOR_MUTED = 0x6b7280

/** customId: `mz:modal:<messageId>` (úprava) nebo `mz:new:…` / `mz:ctx:…` (nová zpráva, draft vznikne až po odeslání). */
export function composeModal(customId: string, body: string, link: string | null, title = 'Zpráva rodičům') {
  return {
    custom_id: customId,
    title,
    components: [
      {
        type: 1,
        components: [{
          type: 4, custom_id: 'text', style: 2, label: 'Text zprávy (uvidí ho rodiče v notifikaci)',
          min_length: 1, max_length: BODY_MAX, required: true,
          placeholder: 'Např. Vlak má zpoždění, na nádraží budeme v 16:20.',
          ...(body ? { value: body.slice(0, BODY_MAX) } : {}),
        }],
      },
      {
        type: 1,
        components: [{
          type: 4, custom_id: 'link', style: 1, label: 'Odkaz (nepovinné, např. reel na Instagramu)',
          max_length: 300, required: false, placeholder: 'https://…',
          ...(link ? { value: link } : {}),
        }],
      },
    ],
  }
}

export const POLL_QUESTION_MAX = 200

/** Formulář ankety: otázka + možnosti (řádky) + odkaz. customId `mz:poll:…` (nová) / `mz:pmodal:<id>` (úprava). */
export function composePollModal(customId: string, question: string, optionsText: string, link: string | null) {
  return {
    custom_id: customId,
    title: 'Anketa pro rodiče',
    components: [
      { type: 1, components: [{
        type: 4, custom_id: 'text', style: 2, label: 'Otázka', min_length: 1, max_length: POLL_QUESTION_MAX, required: true,
        placeholder: 'Např. Jde dnes vaše dítě plavat?', ...(question ? { value: question.slice(0, POLL_QUESTION_MAX) } : {}),
      }] },
      { type: 1, components: [{
        type: 4, custom_id: 'options', style: 2, label: 'Možnosti — každá na nový řádek (2–5)', min_length: 3, max_length: 400, required: true,
        placeholder: 'Ano\nNe', ...(optionsText ? { value: optionsText } : {}),
      }] },
      { type: 1, components: [{
        type: 4, custom_id: 'link', style: 1, label: 'Odkaz (nepovinné)', max_length: 300, required: false, placeholder: 'https://…',
        ...(link ? { value: link } : {}),
      }] },
    ],
  }
}

const VISIBILITY_LABEL: Record<string, string> = {
  never: 'rodiče výsledky nevidí',
  after_vote: 'rodiče vidí výsledky po svém hlasování',
  after_close: 'rodiče vidí výsledky po uzávěrce',
}

function kindLabel(m: MicroMessage): string {
  if (m.urgent && m.kind === 'poll') return '⚡ Naléhavá anketa — přijde i v tichých hodinách; kdo do 10 min nehlasuje, dostane SMS'
  if (m.urgent) return '⚡ Naléhavá — přijde i v tichých hodinách; kdo do 10 min nepotvrdí 👍, dostane SMS'
  if (m.kind === 'confirm') return '👍 S potvrzením „Beru na vědomí"'
  if (m.kind === 'poll') return '📊 Anketa'
  return 'ℹ️ Informace'
}

export function previewMessage(opts: {
  message: MicroMessage
  groups: GroupLite[]           // všechny skupiny roku (pro select)
  selectedGroupIds: string[]
  counts: PreviewCounts
  sendAt: Date
  heldByQuietHours: boolean
  safeMode: boolean
  pollOptions?: string[]
}) {
  const { message: m, groups, selectedGroupIds, counts, sendAt, heldByQuietHours, safeMode, pollOptions } = opts
  const names = groups.filter(g => selectedGroupIds.includes(g.id)).map(g => g.name)
  const target = m.only_author ? '🧪 Jen vám (test)' : names.length ? names.join(' + ') : '— vyberte skupinu —'

  const delivery = counts.guardians === 0
    ? 'Nikdo — ve vybraných skupinách nejsou rodiče s kontaktem.'
    : `📱 ${counts.withPush} push · ✉️ ${counts.emailOnly} e-mail${counts.noContact ? ` · ⚠️ ${counts.noContact} bez kontaktu` : ''}`

  const when = heldByQuietHours
    ? `🌙 Tiché hodiny — zpráva počká a odejde v **${formatPragueTime(sendAt)}**.`
    : 'Hned po potvrzení (60 s na zrušení).'

  const fields = [
    { name: 'Doručení', value: delivery },
    { name: 'Typ', value: kindLabel(m) },
    ...(m.kind === 'poll' ? [
      { name: 'Možnosti (hlasuje se za každé dítě)', value: (pollOptions ?? []).map((o, k) => `${k + 1}. ${o}`).join('\n') || '—' },
      { name: 'Uzávěrka', value: m.poll_closes_at ? `${new Date(m.poll_closes_at).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} v ${formatPragueTime(new Date(m.poll_closes_at))} · ${VISIBILITY_LABEL[m.results_visibility] ?? ''}` : '—' },
    ] : []),
    { name: 'Odeslání', value: when },
    ...(m.exclude_absent ? [{ name: 'Filtr', value: 'Bez dětí, které mají na dnešek omluvenku.' }] : []),
    ...(m.link_url ? [{ name: 'Odkaz', value: m.link_url }] : []),
    ...(m.only_author ? [{ name: '🧪 Jen mně', value: 'Ostrá cesta (push, e-mail, stránka, zrcadlo), ale dostanete ji jen vy jako rodič. Skupiny se ignorují.' }] : []),
    ...(safeMode ? [{ name: '🧪 Testovací prostředí', value: 'Odejde jen testovacím rodičům (MICRO_TEST_GUARDIAN_IDS).' }] : []),
  ]

  const canSend = (m.only_author || selectedGroupIds.length > 0) && counts.guardians > 0 && m.body.length > 0
    && (m.kind !== 'poll' || ((pollOptions?.length ?? 0) >= 2 && !!m.poll_closes_at && new Date(m.poll_closes_at).getTime() > sendAt.getTime()))

  return {
    flags: EPHEMERAL,
    content: '',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${target} · ${counts.children} ${plural(counts.children, 'dítě', 'děti', 'dětí')}`,
      description: `>>> ${m.body}`,
      color: m.urgent ? COLOR_URGENT : COLOR_INFO,
      fields,
      footer: { text: `${counts.guardians} ${plural(counts.guardians, 'rodič', 'rodiče', 'rodičů')} · náhled vidíte jen vy` },
    }],
    components: [
      ...(groups.length > 0 && !m.only_author ? [{
        type: 1,
        components: [{
          type: 3,
          custom_id: `${CID.groups}:${m.id}`,
          placeholder: 'Komu poslat (skupiny)',
          min_values: 1,
          max_values: Math.min(25, groups.slice(0, 25).length),
          options: groups.slice(0, 25).map(g => ({
            label: g.name.slice(0, 100), value: g.id, default: selectedGroupIds.includes(g.id),
          })),
        }],
      }] : []),
      {
        type: 1,
        components: [
          { type: 2, style: m.urgent ? 4 : 3, custom_id: `${CID.send}:${m.id}`, label: m.urgent ? '⚡ Odeslat naléhavě' : 'Odeslat', disabled: !canSend },
          { type: 2, style: 2, custom_id: `${CID.edit}:${m.id}`, label: m.kind === 'poll' ? 'Upravit anketu' : 'Upravit text' },
          { type: 2, style: 2, custom_id: `${CID.cancel}:${m.id}`, label: 'Zrušit' },
        ],
      },
    ],
  }
}

export function scheduledMessage(m: MicroMessage, targetLabel: string, sendAt: Date, held: boolean) {
  const when = held
    ? `🌙 Odejde v **${formatPragueTime(sendAt)}** (tiché hodiny). Do té doby jde zrušit.`
    : `⏳ Odesílám v **${formatPragueTime(sendAt, true)}**…`
  return {
    content: '',
    embeds: [{
      title: `${targetLabel}`,
      description: `>>> ${m.body}\n\n${when}`,
      color: m.urgent ? COLOR_URGENT : COLOR_INFO,
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 4, custom_id: `${CID.abort}:${m.id}`, label: 'Zrušit odeslání' }],
    }],
  }
}

export function closedMessage(text: string) {
  return {
    content: '',
    embeds: [{ description: text, color: COLOR_MUTED }],
    components: [],
  }
}

export function ephemeralText(text: string) {
  return { type: 4, data: { flags: EPHEMERAL, content: text, allowed_mentions: { parse: [] } } }
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}
