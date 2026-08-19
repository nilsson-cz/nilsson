/**
 * app/api/cron/fio-import/route.ts
 *
 * Volá se automaticky přes Vercel Cron každý den v 6:00 (viz vercel.json).
 * Lze spustit i manuálně: GET /api/cron/fio-import
 * (chráněno CRON_SECRET — viz níže)
 *
 * Env proměnné:
 *   FIO_TOKEN       — API token Fio banky
 *   CRON_SECRET     — tajný klíč pro ochranu endpointu
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { fetchFioTransactions } from '@/lib/fio'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Ochrana endpointu — Vercel Cron posílá Authorization header automaticky
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.FIO_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'FIO_TOKEN není nastavena' }, { status: 500 })
  }

  // ---------------------------------------------------------------------------
  // 1. Stáhnout transakce z Fio API
  // ---------------------------------------------------------------------------

  const from = req.nextUrl.searchParams.get('from') ?? undefined

  let transactions
  try {
    transactions = await fetchFioTransactions(token, from)
  } catch (err) {
    console.error('[fio-import] Fio API chyba:', err)
    return NextResponse.json({ error: 'Fio API nedostupné' }, { status: 502 })
  }

  if (transactions.length === 0) {
    console.log('[fio-import] Žádné nové transakce.')
    return NextResponse.json({ imported: 0, matched: 0, unmatched: 0, ignored: 0 })
  }

  const supabase = createSupabaseAdmin()

  let imported  = 0
  let matched   = 0
  let unmatched = 0
  let ignored   = 0

  // ---------------------------------------------------------------------------
  // 2. Zpracovat každou transakci
  // ---------------------------------------------------------------------------

  for (const tx of transactions) {
    // -------------------------------------------------------------------------
    // 2a. Pokusit se matchovat žáka přes VS (pro student_id na transakci)
    // -------------------------------------------------------------------------
    let studentId: string | null = null

    if (tx.variableSymbol) {
      const paddedVS = tx.variableSymbol.padStart(3, '0')
      const { data: studentRaw } = await supabase
        .from('students')
        .select('id')
        .like('kod_zaka', `%-${paddedVS}`)
        .maybeSingle()

      if (studentRaw) {
        studentId = (studentRaw as any).id
      }
    }

    // -------------------------------------------------------------------------
    // 2b. Pokusit se matchovat pohledávku přes SS + VS (obě podmínky musí sedět)
    // -------------------------------------------------------------------------
    let obligationId: string | null = null

    if (tx.specificSymbol && studentId) {
      const { data: obligationRaw } = await supabase
        .from('payment_obligations')
        .select('id')
        .eq('ss_kod' as any, tx.specificSymbol)
        .eq('student_id', studentId)
        .maybeSingle()

      if (obligationRaw) {
        obligationId = (obligationRaw as any).id
      }
    }

    const matchStatus = obligationId ? 'matched' : 'unmatched'

    // Odchozí platby (záporný obrat: bankovní poplatky, vrácení dotací, odchozí
    // převody) nikdy neodpovídají pohledávkám žáků — ukládáme je rovnou jako
    // ignored, aby neplnily seznam nespárovaných. Jen unmatched; spárované
    // záporné (edge case) necháváme na manuální posouzení.
    // Viz ARCH-NOTE-auto-ignore-negative-transactions.
    const isIgnored = tx.amount < 0 && matchStatus === 'unmatched'

    // -------------------------------------------------------------------------
    // 3. INSERT do payment_transactions (přeskočit duplicity)
    // -------------------------------------------------------------------------

    const { data: insertedRaw, error: insertErr } = await supabase
      .from('payment_transactions')
      .insert({
        fio_transaction_id:   tx.fioTransactionId,
        student_id:           studentId,
        variable_symbol:      tx.variableSymbol,
        specific_symbol:      tx.specificSymbol,   // ← přidáno
        amount:               tx.amount,
        currency:             tx.currency,
        counterparty_name:    tx.counterpartyName,
        counterparty_account: tx.counterpartyAccount,
        transaction_date:     tx.date,
        note:                 tx.note,
        match_status:         matchStatus,
        ignored:              isIgnored,
      } as any)
      .select('id')
      .single()

    if (insertErr) {
      if (insertErr.code === '23505') {
        console.log(`[fio-import] Přeskočena duplicita: ${tx.fioTransactionId}`)
        continue
      }
      console.error('[fio-import] INSERT chyba:', insertErr)
      continue
    }

    imported++
    const transactionUuid = (insertedRaw as any).id

    // -------------------------------------------------------------------------
    // 4. Matched → INSERT payment_matches
    // -------------------------------------------------------------------------

    if (matchStatus === 'matched' && obligationId) {
      const { error: matchErr } = await supabase
        .from('payment_matches')
        .insert({
          transaction_id:  transactionUuid,
          obligation_id:   obligationId,
          matched_amount:  tx.amount,
          matched_at:      new Date().toISOString(),
          matched_by:      null,   // automatické párování, ne ruční
        })

      if (matchErr) {
        console.error('[fio-import] payment_matches INSERT chyba:', matchErr)
        // Transakce je v DB, ale match se nepovedl — degradovat na unmatched
        await supabase
          .from('payment_transactions')
          .update({ match_status: 'unmatched' })
          .eq('id', transactionUuid)
        unmatched++
      } else {
        matched++
        console.log(`[fio-import] Spárováno: tx ${tx.fioTransactionId} → obligation ${obligationId}`)
      }
      continue
    }

    // -------------------------------------------------------------------------
    // 5. Unmatched → system_alert
    // -------------------------------------------------------------------------

    // Ignorované výdaje (záporné) nezakládají alert ani neplní seznam
    // nespárovaných — rovnou uložené jako ignored (viz výše).
    if (isIgnored) {
      ignored++
      continue
    }

    unmatched++

    const { error: alertErr } = await supabase
      .from('system_alerts')
      .insert({
        module:      'payments',
        alert_type:  'unmatched_transaction',
        severity:    'warning',
        entity_type: 'transaction',
        entity_id:   transactionUuid,
        message:     `Nespárovaná transakce ${tx.amount} ${tx.currency} od "${tx.counterpartyName ?? 'neznámý'}" (VS: ${tx.variableSymbol ?? 'chybí'}, SS: ${tx.specificSymbol ?? 'chybí'}, Fio ID: ${tx.fioTransactionId})`,
      })

    if (alertErr) {
      console.error('[fio-import] Alert INSERT chyba:', alertErr)
    }
  }

  console.log(`[fio-import] Hotovo: ${imported} importováno, ${matched} spárováno, ${unmatched} nespárováno, ${ignored} ignorováno (výdaje).`)
  return NextResponse.json({ imported, matched, unmatched, ignored })
}
