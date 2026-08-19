// app/actions/payments.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { payliboUrl } from '@/lib/paylibo'
import { Resend } from 'resend'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type ObligationType = 'lunch' | 'event' | 'tuition' | 'druzina'

export interface StudentAmount {
  studentId: string
  amount: number
}

export interface CreateObligationsInput {
  type: ObligationType
  popis: string
  dueDate: string        // 'YYYY-MM-DD'
  schoolYear: string     // '2026/2027'
  year: number           // 2027
  month: number          // 1–12
  students: StudentAmount[]
  referenceEventId?: string
  notifyGuardians?: boolean  // po insertu odešle notifikace zákonným zástupcům (amount > 0)
}

export interface CreateObligationsResult {
  created: number
  ssKody: string[]
  notificationsSent?: number  // počet odeslaných notifikací (pouze pokud notifyGuardians = true)
  error?: string
}

export interface SendNotificationsResult {
  sent: number
  error?: string
}

export interface ManualMatchInput {
  transactionId: string
  obligationId: string
  matchedAmount: number
}

export interface ManualMatchResult {
  success: boolean
  error?: string
}

export interface IgnoreTransactionResult {
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Helper: generovat SS kód
// ---------------------------------------------------------------------------

async function generateSsKod(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  type: ObligationType,
  year: number,
  month: number,
): Promise<string> {
  const prefix = type === 'lunch' ? '10'
               : type === 'tuition' ? '70'
               : type === 'druzina' ? '30'
               : '20'
  const yyyymm = `${year}${String(month).padStart(2, '0')}`

  const { data } = await supabase
    .from('payment_obligations')
    .select('ss_kod')
    .like('ss_kod', `${prefix}${yyyymm}%`)
    .order('ss_kod', { ascending: false })
    .limit(1)

  const lastRank = data?.[0]?.ss_kod
    ? parseInt((data[0].ss_kod as string).slice(-2))
    : 0

  const rank = String(lastRank + 1).padStart(2, '0')
  return `${prefix}${yyyymm}${rank}`
}

// ---------------------------------------------------------------------------
// 1. createObligations
// ---------------------------------------------------------------------------

export async function createObligations(
  input: CreateObligationsInput,
): Promise<CreateObligationsResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { created: 0, ssKody: [], error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { created: 0, ssKody: [], error: 'Nedostatečná oprávnění' }

  const ssKod = await generateSsKod(supabase, input.type, input.year, input.month)

  const rows = input.students.map((s) => ({
    student_id:          s.studentId,
    type:                input.type,
    amount:              s.amount,
    currency:            'CZK',
    due_date:            input.dueDate,
    school_year:         input.schoolYear,
    ss_kod:              ssKod,
    popis:               input.popis,
    created_by:          user.id,
    ...(input.referenceEventId ? { reference_event_id: input.referenceEventId } : {}),
  }))

  // Vracíme id pro případné hromadné notifikace
  const { data: inserted, error } = await supabase
    .from('payment_obligations')
    .insert(rows)
    .select('id, amount')

  if (error) {
    console.error('[createObligations] INSERT chyba:', error)
    return { created: 0, ssKody: [], error: error.message }
  }

  revalidatePath('/dashboard/platby')
  revalidatePath('/dashboard/platby/pohledavky')

  // Hromadné notifikace — volitelné, nekritické
  let notificationsSent = 0
  if (input.notifyGuardians && inserted) {
    const toNotify = (inserted as { id: string; amount: number }[]).filter(
      (o) => o.amount > 0,
    )
    for (const obligation of toNotify) {
      const result = await sendNotifications(obligation.id)
      if (result.error) {
        console.warn(
          `[createObligations] Notifikace selhala pro pohledávku ${obligation.id}:`,
          result.error,
        )
      } else {
        notificationsSent += result.sent
      }
    }
  }

  return {
    created:           (inserted as any[])?.length ?? rows.length,
    ssKody:            [ssKod],
    notificationsSent: input.notifyGuardians ? notificationsSent : undefined,
  }
}

// ---------------------------------------------------------------------------
// 2. sendNotifications
// ---------------------------------------------------------------------------

export async function sendNotifications(
  obligationId: string,
): Promise<SendNotificationsResult> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { sent: 0, error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { sent: 0, error: 'Nedostatečná oprávnění' }

  const { data: obligation, error: obErr } = await supabase
    .from('payment_obligations')
    .select('id, student_id, amount, due_date, ss_kod, popis')
    .eq('id', obligationId)
    .single()

  if (obErr || !obligation) return { sent: 0, error: 'Pohledávka nenalezena' }

  const { data: student, error: stErr } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('id', obligation.student_id)
    .single()

  if (stErr || !student) return { sent: 0, error: 'Žák nenalezen' }

  const vs = (student as any).kod_zaka?.split('-').pop() ?? ''

  const { data: guardians, error: gErr } = await supabase
    .from('student_guardian_links')
    .select(`
      guardian:guardian_id (
        id,
        first_name,
        last_name,
        email
      )
    `)
    .eq('student_id', obligation.student_id)
    .eq('je_zakonny_zastupce', true)

  if (gErr || !guardians) {
    console.error('[sendNotifications] gErr:', JSON.stringify(gErr))
    return { sent: 0, error: 'Chyba načítání zákonných zástupců' }
  }

  const recipients = (guardians as any[])
    .map((g: any) => g.guardian)
    .filter((g: any) => g?.email)

  if (recipients.length === 0) return { sent: 0, error: 'Žádní zákonní zástupci s emailem' }

  const qrUrl = payliboUrl({
    amount:  obligation.amount,
    vs,
    ss:      obligation.ss_kod ?? '',
    message: obligation.popis ?? '',
  })

  let sent = 0
  for (const guardian of recipients) {
    const { error: emailErr } = await resend.emails.send({
      from:    'ZŠ Vilekula <nilsson@zsvilekula.cz>',
      to:      guardian.email,
      subject: `Platba: ${obligation.popis}`,
      html: `
        <p>Vážení,</p>
        <p>evidujeme pohledávku pro žáka <strong>${(student as any).first_name} ${(student as any).last_name}</strong>:</p>
        <table>
          <tr><td>Popis:</td><td><strong>${obligation.popis}</strong></td></tr>
          <tr><td>Částka:</td><td><strong>${obligation.amount} CZK</strong></td></tr>
          <tr><td>Splatnost:</td><td>${obligation.due_date}</td></tr>
          <tr><td>Variabilní symbol:</td><td>${vs}</td></tr>
          <tr><td>Specifický symbol:</td><td>${obligation.ss_kod}</td></tr>
          <tr><td>Číslo účtu:</td><td>${process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER}/${process.env.NEXT_PUBLIC_BANK_CODE}</td></tr>
        </table>
        <p>Pro platbu naskenujte QR kód:</p>
        <img src="${qrUrl}" alt="QR platba" style="max-width:200px" />
        <p>
          Pohledávku a historii plateb najdete také v
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/portal/platby">rodičovském portálu</a>.
        </p>
        <p>ZŠ Vilekula</p>
      `,
    })

    if (emailErr) {
      console.error(`[sendNotifications] Resend chyba pro ${guardian.email}:`, emailErr)
    } else {
      sent++
    }
  }

  await supabase
    .from('payment_obligations')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', obligationId)

  revalidatePath(`/dashboard/platby/pohledavky/${obligationId}`)

  return { sent }
}

// ---------------------------------------------------------------------------
// 3. manualMatch
// ---------------------------------------------------------------------------

export async function manualMatch(
  input: ManualMatchInput,
): Promise<ManualMatchResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Nedostatečná oprávnění' }

  const { error: matchErr } = await supabase
    .from('payment_matches')
    .insert({
      transaction_id:  input.transactionId,
      obligation_id:   input.obligationId,
      matched_amount:  input.matchedAmount,
      matched_at:      new Date().toISOString(),
      matched_by:      user.id,
    })

  if (matchErr) {
    console.error('[manualMatch] INSERT chyba:', matchErr)
    return { success: false, error: matchErr.message }
  }

  const { error: txErr } = await supabase
    .from('payment_transactions')
    .update({ match_status: 'manual_override' })
    .eq('id', input.transactionId)

  if (txErr) {
    console.error('[manualMatch] UPDATE match_status chyba:', txErr)
    return { success: false, error: txErr.message }
  }

  const supabaseAdmin = createSupabaseAdmin()
  const { error: alertErr } = await supabaseAdmin
    .from('system_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('entity_id', input.transactionId)
    .eq('alert_type', 'unmatched_transaction')
    .is('resolved_at', null)

  if (alertErr) {
    console.error('[manualMatch] Alert resolve chyba:', alertErr)
    // Nekritická chyba — match proběhl, jen alert se nevyřešil
  }

  revalidatePath('/dashboard/platby')
  revalidatePath('/dashboard/platby/transakce')
  revalidatePath(`/dashboard/platby/transakce/${input.transactionId}`)

  return { success: true }
}

// ---------------------------------------------------------------------------
// 4. ignoreTransaction
// Označí transakci jako nerelevantní (státní dotace, bankovní poplatky apod.).
// Soft delete — řádek zůstává v DB pro auditní stopu a ochranu před re-importem.
// ---------------------------------------------------------------------------

export async function ignoreTransaction(
  transactionId: string,
): Promise<IgnoreTransactionResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Nedostatečná oprávnění' }

  // Ochrana: spárovanou transakci nelze ignorovat
  const { data: tx, error: fetchErr } = await supabase
    .from('payment_transactions')
    .select('match_status, ignored')
    .eq('id', transactionId)
    .single()

  if (fetchErr || !tx) return { success: false, error: 'Transakce nenalezena.' }

  if (tx.match_status === 'matched' || tx.match_status === 'manual_override') {
    return { success: false, error: 'Spárovanou transakci nelze ignorovat. Nejprve zrušte párování.' }
  }

  if (tx.ignored) return { success: false, error: 'Transakce je již ignorována.' }

  const { error } = await supabase
    .from('payment_transactions')
    .update({ ignored: true })
    .eq('id', transactionId)

  if (error) {
    console.error('[ignoreTransaction] UPDATE chyba:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/platby/transakce')
  revalidatePath(`/dashboard/platby/transakce/${transactionId}`)

  return { success: true }
}

// ---------------------------------------------------------------------------
// 5. restoreTransaction
// Odstraní příznak ignored — transakce se vrátí do seznamu jako unmatched.
// ---------------------------------------------------------------------------

export async function restoreTransaction(
  transactionId: string,
): Promise<IgnoreTransactionResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Nedostatečná oprávnění' }

  const { error } = await supabase
    .from('payment_transactions')
    .update({ ignored: false })
    .eq('id', transactionId)
    .eq('ignored', true) // idempotentní — nevadí opakované volání

  if (error) {
    console.error('[restoreTransaction] UPDATE chyba:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/platby/transakce')
  revalidatePath(`/dashboard/platby/transakce/${transactionId}`)

  return { success: true }
}

// ---------------------------------------------------------------------------
// 6. searchUnmatchedTransactions
// Vyhledávání nespárovaných transakcí pro ruční párování.
// Filtruje: match_status = 'unmatched', ignored = false.
// ---------------------------------------------------------------------------

export interface TransactionSearchResult {
  id: string
  transaction_date: string
  amount: number
  variable_symbol: string | null
  counterparty_name: string | null
}

export async function searchUnmatchedTransactions(
  query: string,
): Promise<{ transactions: TransactionSearchResult[]; error?: string }> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { transactions: [], error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { transactions: [], error: 'Nedostatečná oprávnění' }

  let q = supabase
    .from('payment_transactions')
    .select('id, transaction_date, amount, variable_symbol, counterparty_name')
    .eq('match_status', 'unmatched')
    .eq('ignored', false)
    .order('transaction_date', { ascending: false })
    .limit(20)

  // Hledáme podle VS (přesná shoda prefixu) nebo částky
  const asNumber = parseFloat(query.replace(',', '.').replace(/\s/g, ''))
  if (!isNaN(asNumber)) {
    q = q.eq('amount', asNumber)
  } else if (query.trim()) {
    q = q.ilike('variable_symbol', `%${query.trim()}%`)
  }

  const { data, error } = await q

  if (error) {
    console.error('[searchUnmatchedTransactions] chyba:', error)
    return { transactions: [], error: error.message }
  }

  return { transactions: data ?? [] }
}

// ---------------------------------------------------------------------------
// 7. autoIgnoreNegativeTransactions
// Automaticky označí všechny záporné nespárované transakce jako ignored.
// Záporný obrat = odchozí platba (bankovní poplatky, vrácení dotací apod.) —
// tyto transakce nikdy neodpovídají pohledávkám žáků.
//
// Volání: po každém importu z Fio API, nebo jednorázově pro retroaktivní čištění.
// Idempotentní — opakované volání je bezpečné.
// ---------------------------------------------------------------------------

export interface AutoIgnoreResult {
  ignored: number
  error?: string
}

export async function autoIgnoreNegativeTransactions(): Promise<AutoIgnoreResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ignored: 0, error: 'Nepřihlášen' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { ignored: 0, error: 'Nedostatečná oprávnění' }

  // Pouze unmatched — spárované záporné transakce (edge case) necháváme na manuální řešení
  const { error, count } = await supabase
    .from('payment_transactions')
    .update({ ignored: true }, { count: 'exact' })
    .lt('amount', 0)
    .eq('ignored', false)
    .eq('match_status', 'unmatched')

  if (error) {
    console.error('[autoIgnoreNegativeTransactions] UPDATE chyba:', error)
    return { ignored: 0, error: error.message }
  }

  revalidatePath('/dashboard/platby')
  revalidatePath('/dashboard/platby/transakce')

  return { ignored: count ?? 0 }
}
