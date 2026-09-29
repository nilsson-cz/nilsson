'use client'

/**
 * Složený sloupcový graf nároku: 1 měsíc = 1 sloupec, vrstva = skupina položek.
 * Legenda = přepínače (vypnutá vrstva zmizí, součet nad sloupcem se přepočítá).
 * Barvy: validovaná kategorická paleta (dataviz), pevné pořadí podle skupiny —
 * vypnutí vrstvy ostatní nepřebarví. Tabulka pod grafem je textová alternativa.
 */

import { useMemo, useState } from 'react'

export type ChartSeries = {
  key: string
  label: string
  values: (number | null)[]   // Kč za měsíc; null = chybí vstup
}

// Kategorické sloty 1–8 (light / dark), validované validate_palette.js.
const FILL = [
  'fill-[#2a78d6] dark:fill-[#3987e5]',
  'fill-[#eb6834] dark:fill-[#d95926]',
  'fill-[#1baf7a] dark:fill-[#199e70]',
  'fill-[#eda100] dark:fill-[#c98500]',
  'fill-[#e87ba4] dark:fill-[#d55181]',
  'fill-[#008300] dark:fill-[#008300]',
  'fill-[#4a3aa7] dark:fill-[#9085e9]',
  'fill-[#e34948] dark:fill-[#e66767]',
]
const BG = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#eb6834] dark:bg-[#d95926]',
  'bg-[#1baf7a] dark:bg-[#199e70]',
  'bg-[#eda100] dark:bg-[#c98500]',
  'bg-[#e87ba4] dark:bg-[#d55181]',
  'bg-[#008300] dark:bg-[#008300]',
  'bg-[#4a3aa7] dark:bg-[#9085e9]',
  'bg-[#e34948] dark:bg-[#e66767]',
]

const compact = new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 })
const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`

const H = 260          // výška plochy grafu
const PAD_L = 56       // místo pro osu Y
const PAD_T = 22       // místo pro součet nad sloupcem
const PAD_B = 24       // popisky měsíců
const COL = 52         // šířka sloupce vč. mezery
const BAR = 30
const GAP = 2          // mezera mezi segmenty (povrch)
const R = 4            // zaoblení horního konce

/** Obdélník se zaobleným horním koncem (datový konec), dole rovný (baseline). */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

function niceMax(v: number) {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

export default function NarokChart({
  months,
  series,
}: {
  months: { key: string; label: string }[]
  series: ChartSeries[]
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)

  const visible = series.map((s, i) => ({ ...s, color: i % FILL.length })).filter((s) => !hidden.has(s.key))

  const totals = useMemo(
    () => months.map((_, mi) => visible.reduce((sum, s) => sum + (s.values[mi] ?? 0), 0)),
    [months, visible],
  )
  const yMax = niceMax(Math.max(0, ...totals))
  const W = PAD_L + months.length * COL + 8
  const y = (v: number) => PAD_T + H - (v / yMax) * H
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)

  const toggle = (key: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <div className="space-y-3">
      {/* Legenda = přepínače vrstev */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Zobrazené položky">
        {series.map((s, i) => {
          const off = hidden.has(s.key)
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                off
                  ? 'border-gray-200 text-gray-400 dark:border-stone-700 dark:text-stone-500'
                  : 'border-gray-300 text-gray-700 dark:border-stone-600 dark:text-stone-200'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-sm ${off ? 'bg-gray-200 dark:bg-stone-700' : BG[i % BG.length]}`} />
              {s.label}
            </button>
          )
        })}
      </div>

      <div className="relative overflow-x-auto">
        <svg
          width={W}
          height={PAD_T + H + PAD_B}
          role="img"
          aria-label="Nárok na dotaci po měsících, složený podle položek"
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {/* Mřížka a osa Y */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)}
                className={t === 0 ? 'stroke-[#c3c2b7] dark:stroke-[#383835]' : 'stroke-[#e1e0d9] dark:stroke-[#2c2c2a]'}
                strokeWidth={1} />
              <text x={PAD_L - 6} y={y(t)} dy="0.32em" textAnchor="end"
                className="fill-[#898781] text-[10px] tabular-nums">
                {compact.format(t)}
              </text>
            </g>
          ))}

          {months.map((m, mi) => {
            const x = PAD_L + mi * COL + (COL - BAR) / 2
            let acc = 0
            const segs = visible
              .map((s) => ({ s, v: s.values[mi] ?? 0 }))
              .filter((d) => d.v > 0)
            return (
              <g key={m.key}>
                {segs.map((d, si) => {
                  const y0 = y(acc)
                  acc += d.v
                  const y1 = y(acc)
                  const isTop = si === segs.length - 1
                  const h = Math.max(0, y0 - y1 - (isTop ? 0 : GAP))
                  const top = isTop ? y1 : y1 + GAP
                  return isTop
                    ? <path key={d.s.key} d={topRounded(x, top, BAR, h, R)} className={FILL[d.s.color]} />
                    : <rect key={d.s.key} x={x} y={top} width={BAR} height={h} className={FILL[d.s.color]} />
                })}
                {/* Součet nad sloupcem */}
                {totals[mi] > 0 && (
                  <text x={x + BAR / 2} y={y(totals[mi]) - 5} textAnchor="middle"
                    className="fill-[#52514e] dark:fill-[#c3c2b7] text-[10px] tabular-nums">
                    {compact.format(totals[mi])}
                  </text>
                )}
                <text x={x + BAR / 2} y={PAD_T + H + 15} textAnchor="middle"
                  className="fill-[#898781] text-[10px]">
                  {m.label}
                </text>
                {/* Zásahová plocha (celý sloupec) */}
                <rect
                  x={PAD_L + mi * COL} y={PAD_T} width={COL} height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(mi)}
                  onFocus={() => setHover(mi)}
                  tabIndex={0}
                  aria-label={`${m.label}: ${kc(totals[mi])}`}
                  className={hover === mi ? 'fill-black/[0.03] dark:fill-white/[0.04]' : ''}
                />
              </g>
            )
          })}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md dark:border-stone-700 dark:bg-stone-900"
            style={{
              left: Math.min(PAD_L + hover * COL + COL, W - 200),
            }}
          >
            <div className="mb-1 font-semibold text-gray-900 dark:text-stone-100">{months[hover].label}</div>
            {visible.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-gray-600 dark:text-stone-300">
                  <span className={`h-2 w-2 rounded-sm ${BG[s.color]}`} />
                  {s.label}
                </span>
                <span className="tabular-nums text-gray-900 dark:text-stone-100">
                  {s.values[hover] == null ? '—' : kc(s.values[hover]!)}
                </span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-gray-100 pt-1 font-semibold dark:border-stone-800">
              <span className="text-gray-700 dark:text-stone-200">Celkem</span>
              <span className="tabular-nums text-gray-900 dark:text-stone-100">{kc(totals[hover])}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
