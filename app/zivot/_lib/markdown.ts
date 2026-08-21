// app/zivot/_lib/markdown.ts
// Markdown → HTML pro obsah zdi i bulletinu (emails/BulletinEmail.tsx).
// Obsah je autorovaný personálem (body_md / description_md), ALE marked v18
// nesanitizuje a výstup jde do dangerouslySetInnerHTML — jediný kompromitovaný
// nebo zlomyslný staff účet by jinak spustil <script>/onerror v prohlížeči
// každého rodiče (veřejná zeď + portál + e-mail). Proto sanitizace přes
// DOMPurify s allowlistem tagů, které Markdown reálně produkuje.
// (audit 2026-08-20, nález 4.3)

import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

// Tagy, které marked z Markdownu generuje. Vše ostatní (script, iframe, style…)
// a všechny on*-handlery DOMPurify zahodí.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'del', 's', 'sub', 'sup', 'mark',
  'a', 'img',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'target', 'rel']

export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(md, { async: false }) as string
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // href/src omezit na bezpečná schémata (http/https/mailto/tel) + relativní.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  })
}
