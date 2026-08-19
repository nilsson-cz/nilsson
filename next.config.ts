import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Ostatní tvoje konfigurace...
  serverExternalPackages: ['resend'],
  experimental: {
  },
};

export default nextConfig;