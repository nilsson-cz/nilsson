import 'server-only'

// lib/zivot-notify.ts
// Automatická mikrozpráva všem rodičům, když se ve Fotogalerii poprvé objeví
// nová galerie. Rodič vidí galerii jen přes publikovaný příspěvek s navázanou
// publikovanou galerií → spouští se při publikaci příspěvku i galerie
// (podle toho, co se publikuje jako druhé).
//
// Zpráva se zakládá rovnou jako `scheduled` (source 'nilsson') a rozešle ji
// běžný tick mikrozpráv — včetně tichých hodin, e-mail fallbacku a safe módu
// mimo produkci. Okno na zrušení (UNDO_WINDOW_MS): stažení publikace do odeslání
// naplánovanou zprávu zruší.
//
// Deduplikace bez migrace: jedna zpráva na odkaz (link_url) příspěvku.
// Selhání notifikace nikdy neshodí publikaci (volá se přes after()).

import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYearAdmin, listGroups, logAction, setMessageGroups } from '@/lib/mikrozpravy/data'
import { publicBaseUrl } from '@/lib/mikrozpravy/env'
import { nextSendAt } from '@/lib/mikrozpravy/quiet-hours'

type Admin = ReturnType<typeof createSupabaseAdmin>

interface PostRow { id: string; slug: string; title: string; status: string; school_year: string; gallery_id: string | null }

/** staff.id přihlášeného (pod jeho session, mimo after() — potřebuje cookies). */
export async function currentStaffId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  return data?.id ?? null
}

function postUrl(p: { slug: string; school_year: string }): string {
  return `${publicBaseUrl()}/portal/ze-zivota-skoly/${encodeURIComponent(p.slug)}?rok=${encodeURIComponent(p.school_year)}`
}

async function postsFor(admin: Admin, by: { postId?: string; galleryId?: string }): Promise<PostRow[]> {
  let q = admin.schema('web').from('posts').select('id, slug, title, status, school_year, gallery_id')
  if (by.postId) q = q.eq('id', by.postId)
  else if (by.galleryId) q = q.eq('gallery_id', by.galleryId)
  else return []
  const { data, error } = await q
  if (error) throw new Error(`web.posts: ${error.message}`)
  return (data ?? []) as PostRow[]
}

/**
 * Po publikaci příspěvku nebo galerie: pro každý příspěvek, který je teď
 * viditelný rodičům (post i galerie published), naplánuje mikrozprávu všem
 * třídám aktivního školního roku — pokud pro něj ještě nevznikla.
 */
export async function notifyParentsAboutNewGallery(by: { postId?: string; galleryId?: string }, staffId: string | null): Promise<void> {
  try {
    if (!staffId) return // author_staff_id je NOT NULL; bez zaměstnance nic neposíláme
    const admin = createSupabaseAdmin()
    const posts = (await postsFor(admin, by)).filter((p) => p.status === 'published' && p.gallery_id)
    if (posts.length === 0) return

    const galleryIds = [...new Set(posts.map((p) => p.gallery_id as string))]
    const { data: galleries } = await admin.schema('web').from('galleries')
      .select('id, status').in('id', galleryIds)
    const published = new Set((galleries ?? []).filter((g) => g.status === 'published').map((g) => g.id))

    const year = await getActiveSchoolYearAdmin(admin)
    const groupIds = (await listGroups(admin, year)).map((g) => g.id)
    if (groupIds.length === 0) return

    for (const post of posts) {
      if (!published.has(post.gallery_id as string)) continue
      const url = postUrl(post)

      const { data: existing } = await admin.from('micro_messages')
        .select('id').eq('source', 'nilsson').eq('link_url', url).neq('status', 'cancelled').limit(1)
      if (existing && existing.length > 0) continue

      const { sendAt, heldByQuietHours } = nextSendAt(new Date(), false)
      const { data: msg, error } = await admin.from('micro_messages').insert({
        author_staff_id: staffId,
        school_year: year,
        kind: 'info',
        results_visibility: 'never',
        urgent: false,
        exclude_absent: false,
        only_author: false,
        body: `📸 Nová fotogalerie Ze života školy: ${post.title}`,
        link_url: url,
        status: 'scheduled',
        send_at: sendAt.toISOString(),
        held_by_quiet_hours: heldByQuietHours,
        source: 'nilsson',
      }).select('id').single()
      if (error || !msg) throw new Error(`micro_messages insert: ${error?.message}`)

      await setMessageGroups(admin, msg.id, groupIds)
      await logAction(admin, msg.id, staffId, 'created', { via: 'zivot_gallery', post_id: post.id, gallery_id: post.gallery_id })
      await logAction(admin, msg.id, staffId, 'scheduled', { send_at: sendAt.toISOString(), held_by_quiet_hours: heldByQuietHours, groups: groupIds })
    }
  } catch (e) {
    console.error('[zivot-notify] notify failed', e)
  }
}

/**
 * Stažení publikace (příspěvek/galerie zpět do konceptu): ještě neodeslanou
 * automatickou zprávu zruší. Odeslanou už nevrací (to by byl „Stáhnout" v Discordu).
 */
export async function cancelPendingGalleryNotice(by: { postId?: string; galleryId?: string }, staffId: string | null): Promise<void> {
  try {
    const admin = createSupabaseAdmin()
    const urls = (await postsFor(admin, by)).map(postUrl)
    if (urls.length === 0) return
    const now = new Date().toISOString()
    const { data } = await admin.from('micro_messages')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('source', 'nilsson').eq('status', 'scheduled').in('link_url', urls)
      .select('id')
    for (const m of data ?? []) await logAction(admin, m.id, staffId, 'cancelled', { stage: 'scheduled', via: 'zivot_unpublish' })
  } catch (e) {
    console.error('[zivot-notify] cancel failed', e)
  }
}
