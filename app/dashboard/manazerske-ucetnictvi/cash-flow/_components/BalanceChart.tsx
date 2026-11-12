'use client'

/**
 * Zůstatek účtu po měsících: jedna řada — skutečnost plnou čarou, výhled čárkovaně
 * (pila: 1. den po výdajích → konec měsíce po příjmech),
 * vodorovná referenční linka minimálního zůstatku. Body pod minimem mají kritický
 * status (červený kroužek + text v tooltipu, nikdy jen barva). Hover = crosshair + tooltip.
 * Barva řady = kategorický slot 1 validované palety (stejná jako NarokChart).
 * Textová alternativa = tabulky pod grafem.
 */

import { useState } from 'react'

export type BalancePoint = { key: string; label: string; value: number | null; vyhled: boolean; bezPopisku?: boolean }

const W = 760
const H = 240
const PAD_L = 64
const PAD_R = 16
const PAD_T = 16
const PAD_B = 28

const compact = new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 })
const kc = (n: number) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`

function niceStep(range: number) {
  const raw = range / 4
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

export default function BalanceChart({ points, min }: { points: BalancePoint[]; min: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = points.flatMap((p) => (p.value === null ? [] : [p.value]))
  if (vals.length === 0) return <p className="text-sm text-gray-500 dark:text-stone-400">Zatím nejsou data o zůstatku.</p>

  const lo0 = Math.min(...vals, min, 0)
  const hi0 = Math.max(...vals, min)
  const step = niceStep(hi0 - lo0 || 1)
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.ceil(hi0 / step) * step || step
  const x = (i: number) => PAD_L + (points.length === 1 ? 0 : (i * (W - PAD_L - PAD_R)) / (points.length - 1))
  const y = (v: number) => PAD_T + ((hi - v) * (H - PAD_T - PAD_B)) / (hi - lo)
  const ticks: number[] = []
  for (let t = lo; t <= hi + 1e-6; t += step) ticks.push(t)

  const idx = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null) as (BalancePoint & { i: number; value: number })[]
  const actual = idx.filter((p) => !p.vyhled)
  // Výhled navazuje na poslední skutečný bod.
  const forecast = idx.filter((p) => p.vyhled)
  const fcLine = actual.length && forecast.length ? [actual[actual.length - 1], ...forecast] : forecast
  const path = (pts: { i: number; value: number }[]) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const h = hover === null ? null : points[hover]

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Zůstatek účtu po měsících, skutečnost a výhled"
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="stroke-gray-200 dark:stroke-stone-800" strokeWidth={1} />
            <text x={PAD_L - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-gray-500 dark:fill-stone-400 text-[11px] tabular-nums">{compact.format(t)}</text>
          </g>
        ))}
        {/* Minimální zůstatek */}
        <line x1={PAD_L} x2={W - PAD_R} y1={y(min)} y2={y(min)} className="stroke-gray-500 dark:stroke-stone-400" strokeWidth={1} strokeDasharray="2 3" />
        <text x={W - PAD_R} y={y(min) - 4} textAnchor="end" className="fill-gray-500 dark:fill-stone-400 text-[11px]">minimum {compact.format(min)}</text>

        {points.map((p, i) => !p.bezPopisku && (
          <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-gray-500 dark:fill-stone-400 text-[11px]">{p.label}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} className="stroke-gray-300 dark:stroke-stone-600" strokeWidth={1} />}

        <path d={path(actual)} fill="none" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth={2} strokeLinejoin="round" />
        <path d={path(fcLine)} fill="none" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
        {idx.map((p) => {
          const pod = p.value < min
          return (
            <circle key={p.key} cx={x(p.i)} cy={y(p.value)} r={pod ? 5 : 4}
              className={pod
                ? 'fill-white stroke-[#e34948] dark:fill-stone-900 dark:stroke-[#e66767]'
                : p.vyhled ? 'fill-white stroke-[#2a78d6] dark:fill-stone-900 dark:stroke-[#3987e5]' : 'fill-[#2a78d6] stroke-white dark:fill-[#3987e5] dark:stroke-stone-900'}
              strokeWidth={2} />
          )
        })}
        {/* Hit oblasti po sloupcích (větší než značka) */}
        {points.map((p, i) => {
          const half = points.length > 1 ? (W - PAD_L - PAD_R) / (points.length - 1) / 2 : 20
          return <rect key={p.key} x={x(i) - half} y={PAD_T} width={half * 2} height={H - PAD_T - PAD_B} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        })}
      </svg>
      {h && h.value !== null && (
        <div className="pointer-events-none absolute top-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: hover! > points.length / 2 ? 'translateX(-105%)' : 'translateX(5%)' }}>
          <div className="font-medium text-gray-900 dark:text-stone-100">{h.label} — {h.vyhled ? 'výhled' : 'skutečnost'}</div>
          <div className="tabular-nums text-gray-700 dark:text-stone-300">{kc(h.value)}</div>
          {h.value < min && <div className="mt-0.5 text-red-700 dark:text-red-400">⚠ pod minimem ({kc(min)})</div>}
        </div>
      )}
      <p className="mt-1 text-[11px] text-gray-500 dark:text-stone-400">
        Plná čára = skutečný zůstatek ke konci měsíce (aktuální měsíc k dnešku), čárkovaně = výhled v nejhorším scénáři:
        bod bez popisku = 1. den po výdajích, bod s popiskem = konec měsíce po příjmech. Tečkovaná linka = nastavené minimum.
      </p>
    </div>
  )
}
