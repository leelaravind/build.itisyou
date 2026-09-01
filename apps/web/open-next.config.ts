import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext configuration for Cloudflare Workers.
 *
 * Deliberately minimal. Every override here is a place where the deployed application behaves
 * differently from the one the test suite exercised, and this codebase has already been caught three
 * times by an artefact that was not what the tests ran against (KI-027 and its two predecessors).
 *
 * No incremental cache, no tag cache, no queue override:
 *
 * - **Incremental cache** would cache rendered output. Every route in this application is dynamic and
 *   tenant-scoped, and a cache keyed on the URL cannot see the session that decides what the page is
 *   allowed to contain. That is KI-050's mistake one layer up, and it is worse here because a cached
 *   *page* carries far more than a cached query result.
 * - **Tag revalidation** has nothing to revalidate without the cache above.
 * - **The queue** is the outbox, which lives in Postgres and is drained by a separate Worker. Letting
 *   OpenNext manage a queue would create a second, invisible one with different delivery semantics.
 */
export default defineCloudflareConfig({});
