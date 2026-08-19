import { createSupabaseServerClient } from '@/lib/supabase-server'
import Link from 'next/link'

// app/portal/page.tsx
// Dashboard rodičovského portálu.
// Zobrazuje: metriky (nezaplaceno, dlužná částka, počet posledních zpráv),
//            widget otevřených pohledávek,
//            posledních 5 příspěvků z nástěnky.
// Data přes RPC (migrace 078) — guardian RLS vzor, viz app/portal/zpravy.

export default async function PortalDashboardPage() {
  const supabase = await createSupabaseServerClient()

  // ── Data ──────────────────────────────────────────────────────────

  // Otevřené pohledávky napříč dětmi přihlášeného rodiče (RPC 078).
  // amount_czk = zbytek k úhradě (amount − matched); status z due_date.
  const { data: unpaidRows } = await supabase
    .rpc('get_guardian_unpaid_receivables')

  // status je v DB TEXT → zúžíme na doménovou unii (shape garantuje migrace 078).
  const unpaid = (unpaidRows ?? []) as UnpaidReceivable[]
  const totalOwed = unpaid.reduce((s, r) => s + r.amount_czk, 0)

  // Posledních 5 odeslaných příspěvků nástěnky pro rodiče (RPC 078).
  const { data: bulletinRows } = await supabase
    .rpc('get_guardian_bulletin_posts', { p_limit: 5 })

  const bulletinPosts = (bulletinRows ?? []) as BulletinPost[]

  return (
    <div className="space-y-6">

      {/* ── Metriky ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Nezaplaceno"
          value={unpaid.length}
          unit="pohledávky"
          variant={unpaid.length > 0 ? 'danger' : 'ok'}
        />
        <MetricCard
          label="Dlužná částka"
          value={`${totalOwed.toLocaleString('cs-CZ')} Kč`}
          variant={totalOwed > 0 ? 'warn' : 'ok'}
        />
        <MetricCard
          label="Poslední zprávy"
          value={bulletinPosts.length}
          variant={bulletinPosts.length > 0 ? 'info' : 'ok'}
        />
      </div>

      {/* ── Rychlá akce: Obědy ─────────────────────────────────────── */}
      <Link
        href="/portal/obedy"
        className="portal-card flex items-center gap-4 px-4 py-4 hover:border-(--portal-accent) transition-colors group"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--portal-accent-subtle) text-(--portal-accent)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 11h18a9 9 0 0 1-18 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7c0-1 .5-1.5.5-2M12 7c0-1 .5-1.5.5-2M15.5 7c0-1 .5-1.5.5-2" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-(--portal-text)">Obědy</p>
          <p className="text-xs text-(--portal-text-subtle)">Objednejte nebo zrušte obědy dětem</p>
        </div>
        <span className="text-(--portal-text-subtle) group-hover:text-(--portal-accent) transition-colors">→</span>
      </Link>

      {/* ── Otevřené pohledávky ────────────────────────────────────── */}
      <section>
        <SectionHeader title="Nezaplacené pohledávky" href="/portal/platby" linkLabel="Všechny platby" />
        {unpaid.length === 0 ? (
          <EmptyCard text="Vše zaplaceno. Žádné otevřené pohledávky." />
        ) : (
          <div className="portal-card divide-y divide-(--portal-border)">
            {unpaid.map((r) => (
              <UnpaidRow key={r.id} receivable={r} />
            ))}
          </div>
        )}
      </section>

      {/* ── Nástěnka / Zprávy ──────────────────────────────────────── */}
      <section>
        <SectionHeader title="Zprávy a nástěnka" href="/portal/zpravy" linkLabel="Celá nástěnka" />
        {bulletinPosts.length === 0 ? (
          <EmptyCard text="Žádné příspěvky." />
        ) : (
          <div className="portal-card divide-y divide-(--portal-border)">
            {bulletinPosts.map((post) => (
              <BulletinRow key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}

// ── Typy ────────────────────────────────────────────────────────────

interface UnpaidReceivable {
  id: string
  description: string
  amount_czk: number
  due_date: string        // ISO date string
  status: 'overdue' | 'due' | 'upcoming'
  vs: string
}

interface BulletinPost {
  id: string
  title: string
  body_preview: string
  published_at: string   // ISO datetime string (email_sent_at)
}
// Pozn.: stav přečtení se nesleduje (produkt nemá read-receipty) — viz migrace 078.

// ── Sub-komponenty ───────────────────────────────────────────────────

function MetricCard({
  label, value, unit, variant = 'default',
}: {
  label: string
  value: string | number
  unit?: string
  variant?: 'danger' | 'warn' | 'info' | 'ok' | 'default'
}) {
  const valueColor: Record<string, string> = {
    danger:  'text-(--portal-danger)',
    warn:    'text-(--portal-warn)',
    info:    'text-(--portal-info)',
    ok:      'text-(--portal-accent)',
    default: 'text-(--portal-text)',
  }
  return (
    <div className="portal-metric">
      <p className="portal-metric-label">{label}</p>
      <p className={`portal-metric-value ${valueColor[variant]}`}>{value}</p>
      {unit && <p className="text-xs text-(--portal-text-subtle) mt-0.5">{unit}</p>}
    </div>
  )
}

function SectionHeader({
  title, href, linkLabel,
}: {
  title: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="portal-section-title">{title}</h2>
      <Link href={href} className="text-xs text-(--portal-accent) hover:underline">
        {linkLabel} →
      </Link>
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="portal-card px-4 py-6 text-center text-sm text-(--portal-text-subtle)">
      {text}
    </div>
  )
}

function UnpaidRow({ receivable: r }: { receivable: UnpaidReceivable }) {
  const statusLabel: Record<UnpaidReceivable['status'], string> = {
    overdue:  'po splatnosti',
    due:      `splatnost ${formatDate(r.due_date)}`,
    upcoming: `splatnost ${formatDate(r.due_date)}`,
  }
  const pillVariant: Record<UnpaidReceivable['status'], string> = {
    overdue:  'portal-pill-danger',
    due:      'portal-pill-warn',
    upcoming: 'portal-pill-info',
  }

  return (
    <div className="portal-row">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-(--portal-text) truncate">{r.description}</p>
        <p className="text-xs text-(--portal-text-subtle)">VS {r.vs}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-(--portal-text)">
          {r.amount_czk.toLocaleString('cs-CZ')} Kč
        </p>
        <span className={`portal-pill ${pillVariant[r.status]}`}>
          {statusLabel[r.status]}
        </span>
      </div>
    </div>
  )
}

function BulletinRow({ post }: { post: BulletinPost }) {
  return (
    <div className="portal-row items-start">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-(--portal-text) truncate">
          {post.title}
        </p>
        <p className="text-xs text-(--portal-text-subtle) truncate mt-0.5">
          {post.body_preview}
        </p>
      </div>
      <p className="text-xs text-(--portal-text-subtle) shrink-0 ml-2 mt-0.5">
        {formatRelativeDate(post.published_at)}
      </p>
    </div>
  )
}

// ── Utility ─────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
}

function formatRelativeDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'dnes'
  if (diffDays === 1) return 'včera'
  if (diffDays < 7) return `${diffDays} dny`
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
}
