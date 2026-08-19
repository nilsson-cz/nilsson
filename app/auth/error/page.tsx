export default function AuthError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Odkaz neni platny</h1>
        <p className="text-sm text-gray-500 mb-6">Prihlasovaci odkaz expiroval nebo byl jiz pouzit.</p>
        <a href="/portal/login" className="text-sm text-blue-600 hover:underline">Pozadat o novy odkaz</a>
      </div>
    </div>
  )
}
