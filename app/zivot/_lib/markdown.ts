// app/zivot/_lib/markdown.ts
// Markdown → HTML pro obsah zdi. Stejný vzor jako emails/BulletinEmail.tsx
// (marked v sync módu). Obsah je autorovaný personálem (body_md / description_md).

import { marked } from 'marked'

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string
}
