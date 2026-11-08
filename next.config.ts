import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Ostatní tvoje konfigurace...
  serverExternalPackages: ['resend'],
  // Font pro katalogový list musí být přibalen do serverless funkce (Vercel).
  outputFileTracingIncludes: {
    '/dashboard/zaci/[id]/katalogovy-list': ['./lib/katalogovy-list/fonts/**'],
  },
  experimental: {
  },
  // Service worker portálu (Mikrozprávy, TRD §4.2) — nikdy necachovat,
  // ať se nová verze SW projeví hned; striktní CSP jen pro samotný skript.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
      // Stránky a API mikrozpráv s osobním tokenem v URL (TRD §7): token nesmí
      // uniknout přes Referer (např. na Instagram), nic se neindexuje ani necachuje.
      ...['/z/:path*', '/api/z/:path*', '/tym/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      })),
    ];
  },
};

export default nextConfig;