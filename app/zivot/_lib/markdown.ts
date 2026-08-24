// app/zivot/_lib/markdown.ts
// Markdown → HTML pro obsah zdi i bulletinu (emails/BulletinEmail.tsx).
// Obsah je autorovaný personálem (body_md / description_md), ALE marked v18
// nesanitizuje a výstup jde do dangerouslySetInnerHTML — jediný kompromitovaný
// nebo zlomyslný staff účet by jinak spustil <script>/onerror v prohlížeči
// každého rodiče (veřejná zeď + portál + e-mail). Proto sanitizace přes
// sanitize-html s allowlistem tagů, které Markdown reálně produkuje.
// (audit 2026-08-20, nález 4.3)
//
// Pozn.: dřív isomorphic-dompurify (DOMPurify + jsdom). jsdom@30 táhne ESM-only
// @exodus/bytes, který html-encoding-sniffer volá přes require() → ERR_REQUIRE_ESM
// a pád serverless funkce při renderu e-mailu. sanitize-html je čistě JS (htmlparser2),
// bez jsdom → v serverless robustní. Allowlist zachován 1:1.

import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

// Tagy, které marked z Markdownu generuje. Vše ostatní (script, iframe, style…)
// a všechny on*-handlery sanitize-html zahodí.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'del', 's', 'sub', 'sup', 'mark',
  'a', 'img',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(md, { async: false }) as string
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    // Atributy allowlistu (odpovídá dřívějšímu ALLOWED_ATTR z DOMPurify):
    // href/target/rel na odkazech, src/alt na obrázcích, title kdekoli.
    allowedAttributes: {
      a:   ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      '*': ['title'],
    },
    // href/src jen bezpečná schémata + relativní/protokol-relativní URL.
    // (ekvivalent původního ALLOWED_URI_REGEXP: http/https/mailto/tel + relativní.)
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: true,
    disallowedTagsMode: 'discard',
  })
}
