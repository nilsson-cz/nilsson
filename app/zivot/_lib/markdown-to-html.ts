// app/zivot/_lib/markdown-to-html.ts
// Markdown → HTML (POUZE marked, bez sanitizace). Sdílený zdroj konfigurace
// marked pro celý projekt — ať se server (renderMarkdown v markdown.ts) i
// klientský náhled bulletinu chovají 1:1 stejně.
//
// Záměrně NEimportuje sanitize-html, aby šel bezpečně použít i v client
// componentě (náhled autora nad vlastním textem) bez tažení serverové
// sanitizační knihovny do prohlížečového bundlu. Ostrý výstup (e-mail, zeď)
// jde vždy přes renderMarkdown(), který nad tímto HTML pustí sanitizaci.

import { marked } from 'marked'

// gfm:    GitHub-flavored markdown (tabulky, ~~strike~~ …)
// breaks: jeden Enter → <br>. Bez toho markdown slévá odenterované řádky do
//         jednoho odstavce (autoři to nečekají). Nadpisy/odstavce zůstávají.
export const MARKED_OPTIONS = { async: false, gfm: true, breaks: true } as const

export function markdownToHtml(md: string): string {
  return marked.parse(md, MARKED_OPTIONS) as string
}
