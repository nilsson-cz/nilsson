/**
 * components/gdpr/ConsentFullText.tsx
 * Plné znění GDPR souhlasů (rodiče / zaměstnanci) — webový přepis školních
 * formulářů. Originály ke stažení v public/dokumenty/gdpr-souhlas-*.docx.
 *
 * Při změně formuláře upravit OBĚ místa (text zde + .docx v public/).
 * Zaškrtávací políčka a podpisové řádky z papírové verze se nepřepisují —
 * v IS se souhlas vyjadřuje přepínačem.
 */

export const GDPR_DOCX = {
  rodice: '/dokumenty/gdpr-souhlas-rodice.docx',
  zamestnanci: '/dokumenty/gdpr-souhlas-zamestnanci.docx',
} as const

const SPRAVCE = 'Základní škola Vilekula Teplice, J. V. Sládka 1548/22, 415 01 Teplice'
const POVERENEC = 'Mgr. Jana Švecová'
const POVERENEC_EMAIL = 'jana.svecova@zsvilekula.cz'

const h2 = 'text-base font-semibold text-stone-900 dark:text-stone-100'
const p = 'text-sm leading-relaxed text-stone-700 dark:text-stone-300'

function Header() {
  return (
    <dl className="rounded-xl bg-stone-50 dark:bg-stone-800/60 px-4 py-3 text-sm space-y-1">
      <div>
        <dt className="inline font-medium text-stone-900 dark:text-stone-100">Správce osobních údajů: </dt>
        <dd className="inline text-stone-700 dark:text-stone-300">{SPRAVCE}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-stone-900 dark:text-stone-100">Pověřenec pro ochranu osobních údajů: </dt>
        <dd className="inline text-stone-700 dark:text-stone-300">
          {POVERENEC},{' '}
          <a href={`mailto:${POVERENEC_EMAIL}`} className="underline underline-offset-2">
            {POVERENEC_EMAIL}
          </a>
        </dd>
      </div>
    </dl>
  )
}

function Rights({ subject }: { subject: 'rodice' | 'zamestnanci' }) {
  return (
    <>
      <p className={`${p} font-medium`}>Máte právo:</p>
      <ul className={`${p} list-disc pl-5 space-y-1`}>
        <li>svůj souhlas kdykoliv odvolat písemným sdělením, předaným pověřenci pro ochranu osobních údajů,</li>
        {subject === 'rodice' ? (
          <li>požadovat umožnění přístupu k osobním údajům Vašim i Vašeho syna/dcery,</li>
        ) : (
          <li>požadovat umožnění přístupu k Vašim osobním údajům,</li>
        )}
        <li>
          požadovat opravu nepřesných osobních údajů (pokud se domníváte, že osobní údaje
          zpracovávané {subject === 'rodice' ? 'u školy ' : ''}jsou nepřesné),
        </li>
        <li>
          požadovat výmaz osobních údajů zpracovávaných na základě souhlasu, pokud již neexistuje
          jiný právní důvod jejich zpracování,
        </li>
        <li>podat stížnost u dozorového orgánu (Úřad pro ochranu osobních údajů).</li>
      </ul>
      <p className={p}>
        Vaše požadavky budou vždy řádně posouzeny a vypořádány v souladu s příslušnými ustanoveními
        obecného nařízení o ochraně osobních údajů (GDPR). Svá práva vůči škole uplatňujte písemně
        cestou pověřence pro ochranu osobních údajů.
      </p>
    </>
  )
}

export function ParentConsentFullText() {
  return (
    <article className="space-y-4">
      <h2 className={h2}>Souhlas se zpracováním osobních údajů</h2>
      <Header />
      <p className={p}>
        Já, níže podepsaný/á, souhlasím, aby Základní škola Vilekula Teplice (dále jen „škola“)
        v souvislosti se zajištěním vzdělávání zpracovávala osobní údaje mého syna/dcery pro
        následující účely:
      </p>
      <ol className={`${p} list-decimal pl-5 space-y-3`}>
        <li>
          Zveřejněním jména a příjmení v prostorách školy na nástěnkách, ve školním časopise,
          v místním tisku nebo zpravodaji za účelem prezentace činnosti školy. Tento souhlas uděluji
          na celou dobu vzdělávání mého syna/dcery ve škole.
        </li>
        <li>
          Zveřejněním jména a příjmení prostřednictvím oficiálních webových stránek školy za účelem
          prezentace činnosti a úspěchů školy. Tento souhlas uděluji na celou dobu vzdělávání mého
          syna/dcery.
        </li>
        <li>
          Pořizováním a následným zveřejněním fotografie, zvukových a obrazových záznamů
          prostřednictvím oficiálních webových stránek školy za účelem prezentace činnosti a úspěchů
          školy. Tento souhlas uděluji na celou dobu vzdělávání mého syna/dcery.
        </li>
        <li>
          Pořizováním a následným zveřejněním fotografie, zvukových a obrazových záznamů
          prostřednictvím oficiálního profilu na Instagramu za účelem prezentace činnosti a úspěchů
          školy. Tento souhlas uděluji na celou dobu vzdělávání mého syna/dcery.
        </li>
        <li>
          Dále uděluji výslovný a informovaný souhlas ke zpracování osobních údajů a zvláštních
          kategorií osobních údajů mého syna/dcery za účelem poskytování poradenských služeb
          výchovným poradcem, psychologem, speciálním pedagogem, asistentem pedagoga, metodikem
          prevence, v rámci kterých mohou být zpracovávány osobní údaje a zvláštní kategorie
          osobních údajů získané zejména z doporučení poskytnutých příslušným školským poradenským
          zařízením.
        </li>
      </ol>
      <p className={p}>
        Základní škola Vilekula Teplice shromažďuje osobní údaje i zvláštní kategorie osobních údajů
        v souladu se zákonem č. 561/2004 Sb. o předškolním, základním, středním, vyšším odborném
        a jiném vzdělávání (školský zákon), vyhláškou č. 27/2016 Sb. o vzdělávání žáků se
        speciálními vzdělávacími potřebami a žáků nadaných a vyhláškou č. 72/2005 Sb.
        o poskytování poradenských služeb ve školách a školských poradenských zařízeních.
      </p>
      <p className={p}>
        Zpracovávané osobní údaje a zvláštní kategorie osobních údajů jsou uchovávány po dobu
        stanovenou zvláštními právními předpisy a Skartačním plánem Základní školy Vilekula Teplice.
      </p>
      <p className={p}>
        Údaje zpracovávané za tímto účelem nejsou předávány žádným dalším příjemcům, vyjma situací,
        kdy tak ukládá zvláštní zákon.
      </p>
      <p className={p}>
        Při zpracování osobních údajů nedochází k automatizovanému zpracování, na jehož základě by
        byly činěny úkony či rozhodnutí, jejichž obsahem by byl zásah do práv či oprávněných zájmů
        zákonných zástupců a žáků.
      </p>
      <Rights subject="rodice" />
    </article>
  )
}

export function StaffConsentFullText() {
  return (
    <article className="space-y-4">
      <h2 className={h2}>Souhlas se zpracováním osobních údajů zaměstnance</h2>
      <Header />
      <p className={p}>
        Já, níže podepsaný/á, souhlasím, aby Základní škola Vilekula Teplice v souvislosti
        s prezentací její činnosti zpracovávala mé osobní údaje pro následující účel:
      </p>
      <p className={`${p} border-l-2 border-stone-300 dark:border-stone-600 pl-3`}>
        pořizování a zveřejňování fotografií, zvukových a obrazových záznamů zaměstnance pořízených
        při výkonu pracovních činností nebo při akcích školy, a to prostřednictvím oficiálních
        webových stránek zaměstnavatele a oficiálního profilu na Instagramu za účelem prezentace
        činnosti školy.
      </p>
      <p className={p}>
        Souhlas uděluji do doby ukončení mého pracovního poměru u tohoto zaměstnavatele a současně
        souhlasím s dalším uchováním výše uvedených osobních údajů po dobu trvání účelu prezentace.
        Zaměstnavatel nenese odpovědnost za případné další zpracování výše uvedených zveřejněných
        osobních údajů dalšími osobami nebo správci osobních údajů, které je neslučitelné s tímto
        účelem.
      </p>
      <Rights subject="zamestnanci" />
    </article>
  )
}

/** Odkaz na stažení originálního formuláře (.docx). */
export function ConsentDocxLink({ which }: { which: keyof typeof GDPR_DOCX }) {
  return (
    <a
      href={GDPR_DOCX[which]}
      download
      className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Stáhnout formulář (.docx)
    </a>
  )
}
