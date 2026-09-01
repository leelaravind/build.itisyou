/**
 * Search.
 *
 * §41 says two things. The first is a scope decision — start with PostgreSQL, do not add a search
 * service until scale proves one necessary — and the second is the sentence that shapes this module:
 * *"Every search result must enforce permission and tenant scope server-side."*
 *
 * Search is the second place a tenanted product leaks, after the portfolio, and it leaks differently.
 * A portfolio leaks through aggregates; search leaks through **absence and presence**. If a query for
 * "Acquisition of Meridian" returns nothing for one user and something for another, the first user
 * has learned the term matches nothing they can see — but if the *count* differs, or results are
 * ranked against a corpus including documents they cannot open, the ranking itself carries
 * information about the hidden set.
 *
 * So the rule here is that filtering happens **before** ranking and counting, not after. That is
 * slower and it is the only order that does not let the invisible corpus influence what a user sees.
 *
 * Contract: gap-spec §41, §7.5 (tenant isolation).
 */

import { can, type AccessContext, type Permission } from '@govintel/db/rbac';

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

/** §41's list, in the order it names them. */
export const SEARCHABLE = [
  'PROJECT',
  'TASK',
  'REQUIREMENT',
  'RISK',
  'DOCUMENT',
  'DECISION',
  'MILESTONE',
] as const;

export type Searchable = (typeof SEARCHABLE)[number];

/**
 * The permission each kind requires to appear in results.
 *
 * Explicit per kind rather than a single "can read the project" check, because they genuinely
 * differ — a viewer who may see a project's tasks may not see its budget-bearing documents — and a
 * single check would either hide too much or reveal too much depending on which one it chose.
 */
export const REQUIRED_PERMISSION: Readonly<Record<Searchable, Permission>> = {
  PROJECT: 'project:read',
  TASK: 'project:read',
  REQUIREMENT: 'requirements:read',
  RISK: 'project:read',
  DOCUMENT: 'documents:read',
  DECISION: 'architecture:read',
  MILESTONE: 'project:read',
};

export interface Document {
  readonly id: string;
  readonly kind: Searchable;
  readonly projectId: string;
  readonly organizationId: string;
  readonly title: string;
  /** The text searched. Never returned wholesale — see `snippet`. */
  readonly body: string;
  /** Whether the containing project needs an explicit project role. */
  readonly restricted?: boolean;
}

export interface Searcher {
  readonly organizationId: string;
  readonly context: AccessContext;
  /** Project ids this person holds an explicit role on. */
  readonly projectRoles: ReadonlySet<string>;
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether a document may appear in this searcher's results at all.
 *
 * Organisation first, then restriction, then permission — the same ordering as the portfolio, for the
 * same reason: a check that evaluated permission first would let a bug in role resolution produce
 * cross-tenant results, and cross-tenant is the failure with no acceptable version.
 */
export function mayFind(searcher: Searcher, document: Document): boolean {
  if (document.organizationId !== searcher.organizationId) return false;
  if (document.restricted === true && !searcher.projectRoles.has(document.projectId)) return false;

  return can(searcher.context, REQUIRED_PERMISSION[document.kind]);
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

export interface Hit {
  readonly id: string;
  readonly kind: Searchable;
  readonly projectId: string;
  readonly title: string;
  /** A short extract around the match. Never the whole body. */
  readonly snippet: string;
  /** Higher is better. Comparable only within one result set. */
  readonly score: number;
}

export interface Results {
  readonly hits: readonly Hit[];
  /**
   * How many documents matched **and were visible**.
   *
   * Not the number that matched. A count computed before filtering tells the searcher how much they
   * cannot see, which is the disclosure the permission was preventing.
   */
  readonly total: number;
  /** What was searched, echoed so a reader can tell an empty result from an empty query. */
  readonly query: string;
  readonly headline: string;
}

/**
 * Terms too common to narrow anything.
 *
 * Removed before matching so a query of "the project" does not return everything with a relevance
 * ordering driven entirely by how often each document says "the".
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'on',
  'is',
  'it',
]);

export function tokenise(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

/**
 * Search, filtering before ranking.
 *
 * The order is the security property. Filtering after ranking means the invisible corpus decided the
 * ordering of what is shown, which leaks the shape of a set the searcher is not entitled to — subtly
 * enough that nobody would ever notice it happening.
 */
export function search(
  searcher: Searcher,
  corpus: readonly Document[],
  query: string,
  limit = 20,
): Results {
  const terms = tokenise(query);

  if (terms.length === 0) {
    return {
      hits: [],
      total: 0,
      query,
      headline:
        query.trim() === ''
          ? 'Type something to search.'
          : 'Nothing to search for — those are all words too common to narrow anything down.',
    };
  }

  // Filter first. Everything downstream — scoring, counting, truncation — sees only what this
  // searcher may see, so nothing about the rest can influence what they are shown.
  const visible = corpus.filter((document) => mayFind(searcher, document));

  const scored = visible
    .map((document) => ({ document, score: scoreOf(document, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Stable tie-break on id, so two runs over the same data return the same order and a user
        // paging through results does not see one shuffle between pages.
        a.document.id.localeCompare(b.document.id),
    );

  const hits = scored.slice(0, limit).map(({ document, score }): Hit => ({
    id: document.id,
    kind: document.kind,
    projectId: document.projectId,
    title: document.title,
    snippet: snippetOf(document.body, terms),
    score,
  }));

  return {
    hits,
    total: scored.length,
    query,
    headline: headlineFor(scored.length, hits.length, query),
  };
}

/**
 * Relevance.
 *
 * A title match counts for more than a body match, because somebody searching for a name is usually
 * looking for the thing with that name rather than everything that mentions it. Beyond that this is
 * deliberately simple: an elaborate scoring function that nobody can explain produces an ordering
 * nobody can question, and §41 says to start with what Postgres gives us.
 */
function scoreOf(document: Document, terms: readonly string[]): number {
  const title = document.title.toLowerCase();
  const body = document.body.toLowerCase();

  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 10;
    if (body.includes(term)) score += 1;
  }

  // Every term present is worth more than one term present many times, so a two-word query prefers
  // the document containing both.
  if (terms.every((term) => title.includes(term) || body.includes(term))) score += 5;

  return score;
}

/** A short extract around the first match, so a result can be judged without opening it. */
function snippetOf(body: string, terms: readonly string[]): string {
  const lower = body.toLowerCase();
  const at = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);

  if (at.length === 0) return body.slice(0, 120);

  const start = Math.max(0, Math.min(...at) - 40);
  const extract = body.slice(start, start + 160);

  return `${start > 0 ? '…' : ''}${extract}${start + 160 < body.length ? '…' : ''}`;
}

function headlineFor(total: number, shown: number, query: string): string {
  if (total === 0) {
    /*
     * Deliberately does not distinguish "nothing matched" from "everything that matched is hidden
     * from you". Those two must read identically, because telling them apart is exactly how search
     * confirms the existence of something a permission is withholding.
     */
    return `Nothing matching "${query}".`;
  }

  if (shown < total) {
    return `${String(shown)} of ${String(total)} results for "${query}". Narrow the search to see the rest.`;
  }

  return `${String(total)} result${total === 1 ? '' : 's'} for "${query}".`;
}
