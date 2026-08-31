import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GovIntel Platform',
    template: '%s · GovIntel Platform',
  },
  description:
    'Software project intelligence, planning, execution and governance. Deterministic by design.',
  // Guest-first (plan section 2.3): the landing and intake flow are public and indexable.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b1326',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The CSP nonce in `src/middleware.ts` is generated per response, so it cannot exist in HTML that
 * was rendered at build time - a prerendered page's inline scripts carry no nonce and the browser
 * blocks them. Static prerendering and nonce-based CSP are mutually exclusive.
 *
 * Given the choice, dynamic rendering is the right trade for this product: it is overwhelmingly
 * authenticated and tenant-scoped, so almost nothing is cacheable across users anyway. Revisit only
 * for the public landing page in Phase 4, and only with hash-based CSP - never by relaxing the
 * policy to `'unsafe-inline'`.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-density` drives the Beginner/Professional/Enterprise complexity scaling required by
    // plan section 2.4. It lives on <html> so every component inherits it and none hardcodes a density.
    <html lang="en" data-density="professional">
      <body>{children}</body>
    </html>
  );
}
