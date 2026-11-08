/* public/sw.js
 * Service worker rodičovského portálu — web push (modul Mikrozprávy, TRD §4.2).
 *
 * Pravidla:
 *  - KAŽDÝ push musí zobrazit notifikaci (userVisibleOnly), jinak iOS/Chrome
 *    odběr časem zruší.
 *  - Payload: { v, title, body, url, tag, token?, urgent?, actions? }.
 *  - Žádné cachování stránek (portál je dynamický, přihlášený).
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { body: event.data ? event.data.text() : '' }
  }

  const title = d.title || 'ZŠ Vilekula'
  const options = {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: d,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    requireInteraction: !!d.urgent,
    actions: Array.isArray(d.actions) ? d.actions : [],
  }

  const tasks = [self.registration.showNotification(title, options)]

  // Potvrzení „doručeno do mobilu" (stav 📱) — jen u mikrozpráv s tokenem.
  if (d.token) {
    tasks.push(
      fetch('/api/z/' + encodeURIComponent(d.token) + '/shown', {
        method: 'POST',
        keepalive: true,
      }).catch(() => {}),
    )
  }

  event.waitUntil(Promise.all(tasks))
})

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {}
  event.notification.close()

  // Akční tlačítka (Android/Chrome; iOS je nezobrazuje) — F1/F2.
  if (d.token && (event.action === 'ack' || (event.action || '').startsWith('vote:'))) {
    const body =
      event.action === 'ack'
        ? { a: 'ack' }
        : { a: 'vote', option: event.action.slice(5) }
    event.waitUntil(
      fetch('/api/z/' + encodeURIComponent(d.token) + '/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {}),
    )
    return
  }

  const url = d.url || '/portal'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w && new URL(w.url).pathname === url) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
