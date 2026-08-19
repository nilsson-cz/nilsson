// app/zivot/vstup/page.tsx
// Veřejná „na pozvánku" stránka zdi. NENÍ gatovaná — proxy ji propouští
// (viz GATE_PATH v lib/zivot-gate.ts), jinak by vznikl redirect loop.

export const metadata = { title: 'Ze života školy' }

export default async function ZivotGatePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const isInvalid = error === 'invalid'

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">Ze života školy</h1>
        {isInvalid ? (
          <p className="text-sm text-red-600">
            Odkaz je neplatný nebo mu vypršela platnost. Požádejte prosím školu o nový.
          </p>
        ) : error ? (
          <p className="text-sm text-red-600">
            Něco se nepovedlo. Zkuste to prosím znovu, nebo požádejte školu o nový odkaz.
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            Tato stránka je přístupná jen přes odkaz, který rozesílá škola.
          </p>
        )}
      </div>
    </div>
  )
}
