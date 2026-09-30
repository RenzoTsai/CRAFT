import type { NextConfig } from 'next';

const backend = process.env.CRAFT_API_ORIGIN || `http://127.0.0.1:${process.env.API_PORT || process.env.CRAFT_PORT || '8000'}`;
const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [{ source: '/backend/:path*', destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
