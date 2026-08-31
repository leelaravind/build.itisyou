import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 18 requires CSP and secure headers;
 * gap-spec section 66 makes them a pre-live gate and section 67 re-verifies them after deployment.
 *
 * CSP is NOT set here. It needs a per-request nonce, so it lives in `src/middleware.ts` - see the
 * rationale there for why `'unsafe-inline'` was rejected. These are the static headers that need no
 * per-request value.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@govintel/shared', '@govintel/db', '@govintel/intake'],
  // PGlite ships a WASM binary that must not be bundled into the server output.
  serverExternalPackages: ['@electric-sql/pglite'],
  typedRoutes: true,
  // Next's config type requires a Promise-returning function here. There is nothing to await, so
  // this resolves directly rather than being declared `async` with no await inside it.
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
