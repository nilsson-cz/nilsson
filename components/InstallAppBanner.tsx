'use client'

// components/InstallAppBanner.tsx
// Lišta „Nainstalujte si appku Nilsson" pro zaměstnance na mobilu (PRD-pwa F1).
//  - Android/Chrome: zachytí beforeinstallprompt → tlačítko Nainstalovat.
//  - iPhone/iPad: návod Sdílet → Přidat na plochu (jinak nejde; web push na iOS
//    funguje jen z appky na ploše).
//  - Neukazuje se v appce (standalone), na desktopu (lg+) ani po „Teď ne" (30 dní).

import { useEffect, useState, useSyncExternalStore } from 'react'
import { isIos, isStandalone } from '@/lib/pwa-detect'
import { NilssonLogo } from '@/components/NilssonLogo'

const SKRYTO_KEY = 'nilsson_install_skryto_do'
const SKRYTI_DNY = 30

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function skrytoDo(): number {
  try { return Number(localStorage.getItem(SKRYTO_KEY) ?? 0) } catch { return 0 }
}

const bezOdberu = () => () => {}
/** iPhone v prohlížeči, lišta neskrytá → návod (jen na klientu; na serveru false). */
const iosNavodSnapshot = () => isIos() && !isStandalone() && skrytoDo() <= Date.now()

export function InstallAppBanner() {
  const iosNavod = useSyncExternalStore(bezOdberu, iosNavodSnapshot, () => false)
  const [vyzva, setVyzva] = useState<BeforeInstallPromptEvent | null>(null)
  const [zavreno, setZavreno] = useState(false)

  useEffect(() => {
    if (isIos() || isStandalone() || skrytoDo() > Date.now()) return
    const onPrompt = (e: Event) => {
      e.preventDefault() // vlastní lišta místo výchozí výzvy prohlížeče
      setVyzva(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setZavreno(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function tedNe() {
    try { localStorage.setItem(SKRYTO_KEY, String(Date.now() + SKRYTI_DNY * 86_400_000)) } catch { /* jen tato relace */ }
    setZavreno(true)
  }

  async function nainstalovat() {
    if (!vyzva) return
    await vyzva.prompt()
    const { outcome } = await vyzva.userChoice
    setVyzva(null)
    if (outcome === 'accepted') setZavreno(true)
  }

  const stav: 'skryto' | 'android' | 'ios' = zavreno ? 'skryto' : vyzva ? 'android' : iosNavod ? 'ios' : 'skryto'
  if (stav === 'skryto') return null

  return (
    <div className="lg:hidden mx-4 mt-4 rounded-2xl border border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/40 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white dark:bg-stone-900 flex items-center justify-center shrink-0">
          <NilssonLogo size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Nilsson jako appka v telefonu</p>
          {stav === 'android' ? (
            <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
              Otevře se rovnou z plochy, bez prohlížeče.
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
              V Safari klepněte na <strong>Sdílet</strong> (čtvereček se šipkou) a zvolte{' '}
              <strong>Přidat na plochu</strong>.
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            {stav === 'android' && (
              <button
                onClick={nainstalovat}
                className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 transition"
              >
                Nainstalovat
              </button>
            )}
            <button onClick={tedNe} className="text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400">
              Teď ne
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
