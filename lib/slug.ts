// lib/slug.ts
// Slug z názvu pro URL zdi „Ze života školy" (posts/galleries mají slug NOT NULL).
// Odstraní diakritiku, zmenší, nepísmena → pomlčky.

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diakritika (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
