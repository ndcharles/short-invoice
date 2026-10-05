import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/** Where `wrangler dev` serves the Worker (API + short links) locally. */
const WORKER_DEV_ORIGIN = 'http://127.0.0.1:8787';

export default function nextConfig(phase: string): NextConfig {
  // `next dev` proxies API and short-link paths to the local Worker, so the
  // UI keeps hot reload while talking to the real Worker + local D1.
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      async rewrites() {
        return [
          { source: '/api/:path*', destination: `${WORKER_DEV_ORIGIN}/api/:path*` },
          { source: '/s/:path*', destination: `${WORKER_DEV_ORIGIN}/s/:path*` },
        ];
      },
    };
  }

  // Production is a fully static export served by Workers Static Assets.
  return { output: 'export' };
}
