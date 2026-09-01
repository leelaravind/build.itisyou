/**
 * A no-op stand-in for `server-only` in the test runner.
 *
 * The real package throws on import — that is its entire purpose: it turns "this module was pulled
 * into a client bundle" from a runtime data leak into a build error. Vitest is neither a server
 * component nor a client bundle, so it trips the guard while proving nothing.
 *
 * Aliased rather than removed from the modules under test. The import is load-bearing in the
 * application: `database.ts` and `session.ts` handle connection strings and session ids, and the
 * marker is what stops either being imported from a component that ships to a browser.
 */
export {};
