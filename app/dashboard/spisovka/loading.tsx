/**
 * app/dashboard/spisovka/loading.tsx
 * Skeleton zobrazený během SSR načítání dat
 */

export default function SpisovkaLoading() {
  return (
    <div className="px-4 py-6 lg:px-8 max-w-screen-xl mx-auto animate-pulse">
      {/* Hlavička */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-6 w-32 bg-stone-200 dark:bg-stone-700 rounded-md" />
          <div className="h-4 w-48 bg-stone-100 dark:bg-stone-800 rounded-md mt-1.5" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-16 bg-stone-100 dark:bg-stone-800 rounded-lg" />
          <div className="h-9 w-36 bg-emerald-100 dark:bg-emerald-900 rounded-lg" />
        </div>
      </div>

      {/* Filtry */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-4 mb-4">
        <div className="flex gap-3">
          <div className="flex-1 h-9 bg-stone-100 dark:bg-stone-800 rounded-lg" />
          <div className="h-9 w-28 bg-stone-100 dark:bg-stone-800 rounded-lg" />
          <div className="h-9 w-28 bg-stone-100 dark:bg-stone-800 rounded-lg" />
          <div className="h-9 w-36 bg-stone-100 dark:bg-stone-800 rounded-lg" />
          <div className="h-9 w-48 bg-stone-100 dark:bg-stone-800 rounded-lg" />
        </div>
      </div>

      {/* Tabulka */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
        <div className="border-b border-stone-100 dark:border-stone-800 px-4 py-3 flex gap-8">
          {['w-16', 'w-48', 'w-24', 'w-16', 'w-20', 'w-20', 'w-8', 'w-20'].map((w, i) => (
            <div key={i} className={`h-4 ${w} bg-stone-100 dark:bg-stone-800 rounded`} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-stone-50 dark:border-stone-800 flex gap-8 items-center">
            <div className="h-4 w-24 bg-stone-100 dark:bg-stone-800 rounded font-mono" />
            <div className="h-4 w-64 bg-stone-100 dark:bg-stone-800 rounded" />
            <div className="h-4 w-16 bg-stone-100 dark:bg-stone-800 rounded" />
            <div className="h-5 w-16 bg-stone-100 dark:bg-stone-800 rounded-md" />
            <div className="h-5 w-20 bg-stone-100 dark:bg-stone-800 rounded-md" />
            <div className="h-4 w-20 bg-stone-100 dark:bg-stone-800 rounded" />
            <div className="h-5 w-5 bg-stone-100 dark:bg-stone-800 rounded" />
            <div className="h-4 w-20 bg-stone-100 dark:bg-stone-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
