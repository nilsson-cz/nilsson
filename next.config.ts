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
};

export default nextConfig;