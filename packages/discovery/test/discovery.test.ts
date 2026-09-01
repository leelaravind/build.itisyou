import { describe, expect, it } from 'vitest';
import type { AccessContext } from '@govintel/db/rbac';
import {
  SEARCHABLE,
  mayFind,
  search,
  tokenise,
  type Document,
  type Searcher,
} from '../src/search.ts';
import { COMMANDS, availableTo, checkCommands, matchCommands, run } from '../src/palette.ts';
import {
  NOTIFICATION_TYPES,
  TYPE_SPEC,
  checkTypes,
  deliver,
  inboxFor,
  markRead,
  type Notification,
} from '../src/notifications.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ORG = 'org1';
const OTHER_ORG = 'org2';
const AT = '2026-01-01T00:00:00.000Z';

function document(overrides: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    kind: 'REQUIREMENT',
    projectId: 'p1',
    organizationId: ORG,
    title: 'Handle personal data lawfully',
    body: 'Lawful basis, retention limits and subject access for every category of personal data held.',
    ...overrides,
  };
}

function searcher(context: AccessContext = { organizationRole: 'ADMIN' }): Searcher {
  return { organizationId: ORG, context, projectRoles: new Set(['p1']) };
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'APPROVAL_REQUIRED',
    recipientId: 'u1',
    projectId: 'p1',
    subjectId: 'gate:security',
    summary: 'The security gate needs your decision.',
    actorId: 'u2',
    at: AT,
    read: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

describe('gap-spec §41: search enforces permission and tenant scope', () => {
  it('finds a matching document', () => {
    // Without this every negative test below passes against a search that returns nothing.
    const results = search(searcher(), [document()], 'personal data');

    expect(results.hits.map((h) => h.id)).toEqual(['d1']);
  });

  it('never returns a document from another organisation', () => {
    expect(mayFind(searcher(), document({ organizationId: OTHER_ORG }))).toBe(false);

    expect(
      search(searcher(), [document({ organizationId: OTHER_ORG })], 'personal data').hits,
    ).toEqual([]);
  });

  it('checks the organisation before the permission', () => {
    /*
     * Same ordering as the portfolio, for the same reason: a check that evaluated permission first
     * would let a bug in role resolution produce cross-tenant results, and cross-tenant is the
     * failure with no acceptable version.
     */
    const owner = searcher({ organizationRole: 'OWNER' });

    expect(mayFind(owner, document({ organizationId: OTHER_ORG }))).toBe(false);
  });

  it('needs an explicit project role for a restricted project', () => {
    const outsider: Searcher = {
      organizationId: ORG,
      context: { organizationRole: 'OWNER' },
      projectRoles: new Set(),
    };

    expect(mayFind(outsider, document({ restricted: true }))).toBe(false);
    expect(mayFind(searcher(), document({ restricted: true }))).toBe(true);
  });

  it('counts only what the searcher can see', () => {
    /*
     * A count computed before filtering tells the searcher how much they cannot see, which is the
     * disclosure the permission was preventing. Total is over the visible set.
     */
    const results = search(
      searcher(),
      [document(), document({ id: 'd2', organizationId: OTHER_ORG })],
      'personal data',
    );

    expect(results.total).toBe(1);
    expect(results.headline).not.toContain('2');
  });

  it('ranks only over what the searcher can see', () => {
    /*
     * Filtering happens before ranking. Filtering afterwards would let the invisible corpus decide
     * the ordering of what is shown — a leak subtle enough that nobody would notice it happening.
     */
    const hidden = document({
      id: 'hidden',
      organizationId: OTHER_ORG,
      title: 'Personal data personal data personal data',
    });

    const results = search(searcher(), [hidden, document()], 'personal data');

    expect(results.hits.map((h) => h.id)).toEqual(['d1']);
  });

  it('reports nothing-found identically whether nothing matched or everything is hidden', () => {
    /*
     * The two must read the same. Telling them apart is exactly how search confirms the existence of
     * something a permission is withholding.
     */
    const nothingMatched = search(searcher(), [document()], 'zebra');
    const allHidden = search(
      searcher(),
      [document({ organizationId: OTHER_ORG })],
      'personal data',
    );

    expect(nothingMatched.hits).toEqual([]);
    expect(allHidden.hits).toEqual([]);
    expect(nothingMatched.headline).toMatch(/^Nothing matching/);
    expect(allHidden.headline).toMatch(/^Nothing matching/);
  });

  it('ranks a title match above a body-only match', () => {
    // Somebody searching for a name is usually looking for the thing with that name rather than
    // everything that mentions it.
    const results = search(
      searcher(),
      [
        document({ id: 'body', title: 'Something else', body: 'mentions retention once' }),
        document({ id: 'title', title: 'Retention policy', body: 'unrelated' }),
      ],
      'retention',
    );

    expect(results.hits[0]?.id).toBe('title');
  });

  it('drops words too common to narrow anything', () => {
    // Otherwise "the project" returns everything, ordered by how often each document says "the".
    expect(tokenise('the project of it')).toEqual(['project']);
    expect(search(searcher(), [document()], 'the of and').hits).toEqual([]);
  });

  it('distinguishes an empty query from a query that found nothing', () => {
    expect(search(searcher(), [document()], '').headline).toMatch(/type something/i);
    expect(search(searcher(), [document()], 'zebra').headline).toMatch(/nothing matching/i);
  });

  it('returns a snippet rather than the whole body', () => {
    // A result list that returns full bodies is an export with a search box on it.
    const long = document({ body: 'x'.repeat(400) + ' retention ' + 'y'.repeat(400) });
    const hit = search(searcher(), [long], 'retention').hits[0];

    expect(hit?.snippet.length).toBeLessThan(200);
  });

  it('is deterministic, including tie-breaks', () => {
    const corpus = [
      document({ id: 'b', title: 'Retention' }),
      document({ id: 'a', title: 'Retention' }),
    ];

    expect(search(searcher(), corpus, 'retention').hits.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('covers every kind §41 names', () => {
    expect(SEARCHABLE).toHaveLength(7);
  });
});

/* -------------------------------------------------------------------------- */
/* Command palette                                                            */
/* -------------------------------------------------------------------------- */

describe('gap-spec §42: the palette is not a security bypass', () => {
  it('offers commands to somebody who can run them', () => {
    expect(availableTo({ organizationRole: 'ADMIN' }).length).toBeGreaterThan(5);
  });

  it('omits a command the user cannot run rather than disabling it', () => {
    /*
     * Absent, not greyed out. A disabled "Archive project" tells somebody archiving happens here and
     * that they are not allowed to do it — the same disclosure a search result would be, delivered by
     * a control they cannot press.
     */
    const auditor = availableTo({ organizationRole: 'AUDITOR' });

    expect(auditor.some((c) => c.id === 'archive-project')).toBe(false);
    expect(auditor.some((c) => c.id === 'go-to-project')).toBe(true);
  });

  it('re-checks the permission when running, not only when listing', () => {
    /*
     * The list is a rendering; this is the authorisation. A palette that trusted its own list would
     * be authorising by rendering, and nobody attacking it would use the list.
     */
    const result = run({ organizationRole: 'AUDITOR' }, 'archive-project', true);

    expect(result.ok ? undefined : result.refusal).toBe('NOT_PERMITTED');
  });

  it('still requires confirmation for a destructive command', () => {
    // The palette is a faster way to reach an action, never a way to reach it with fewer questions.
    const unconfirmed = run({ organizationRole: 'OWNER' }, 'archive-project', false);
    const confirmed = run({ organizationRole: 'OWNER' }, 'archive-project', true);

    expect(unconfirmed.ok ? undefined : unconfirmed.refusal).toBe('NEEDS_CONFIRMATION');
    expect(confirmed.ok).toBe(true);
  });

  it('says what the confirmation is asking', () => {
    // A confirmation that does not say what will happen trains people to press yes, and after that
    // it is a keystroke rather than a decision.
    const result = run({ organizationRole: 'OWNER' }, 'archive-project', false);

    expect(result.ok ? undefined : result.reason).toMatch(/read-only for everybody/i);
  });

  it('refuses an unknown command', () => {
    expect(run({ organizationRole: 'OWNER' }, 'rm-rf', true).ok).toBe(false);
  });

  it('matches on aliases, so people find things by what they call them', () => {
    const matched = matchCommands({ organizationRole: 'OWNER' }, 'money');

    expect(matched.map((c) => c.id)).toContain('open-budget');
  });

  it('matches only over commands the user can run', () => {
    // Same reason as search: a ranking over things the user cannot use lets the invisible set
    // influence what they see.
    expect(matchCommands({ organizationRole: 'AUDITOR' }, 'archive').map((c) => c.id)).toEqual([]);
  });

  it('gives every command a permission', () => {
    /*
     * A palette entry with no permission is the bypass. Making the field required means adding a
     * command forces somebody to decide who may run it.
     */
    for (const command of COMMANDS) {
      expect(command.permission, command.id).toBeTruthy();
    }
  });

  it('finds nothing wrong with the catalogue as it stands', () => {
    expect(checkCommands(COMMANDS)).toEqual([]);
  });

  it('catches a destructive command added without a confirmation', () => {
    /*
     * The most likely way §42's rule gets broken is not a deliberate bypass — it is somebody adding
     * a fifteenth command in a hurry. This fails the build when they do.
     */
    const careless = COMMANDS.map((c) =>
      c.id === 'archive-project' ? { ...c, confirms: false } : c,
    );

    expect(checkCommands(careless).map((f) => f.defect)).toContain(
      'DESTRUCTIVE_WITHOUT_CONFIRMATION',
    );
  });

  it('catches a confirmation with nothing to confirm', () => {
    const vague = COMMANDS.map((c) =>
      c.id === 'export-project' ? { ...c, confirmationAsks: '' } : c,
    );

    expect(checkCommands(vague).map((f) => f.defect)).toContain('CONFIRMATION_WITHOUT_A_QUESTION');
  });
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

describe('gap-spec §43: avoid excessive low-value notifications', () => {
  it('delivers a notification somebody can act on', () => {
    expect(deliver([], notification()).ok).toBe(true);
  });

  it('never notifies somebody about their own action', () => {
    /*
     * The single largest source of notification noise, because the easiest implementation notifies
     * everybody watching a thing including whoever just touched it. They were there.
     */
    const result = deliver([], notification({ actorId: 'u1' }));

    expect(result.ok ? undefined : result.refusal).toBe('SELF_NOTIFICATION');
  });

  it('refuses a notification addressed to nobody', () => {
    const result = deliver([], notification({ recipientId: '  ' }));

    expect(result.ok ? undefined : result.refusal).toBe('NO_RECIPIENT');
  });

  it('suppresses a repeat of a fact somebody already knows', () => {
    /*
     * One failing gate is one fact. Re-sending it on every evaluation is how a useful signal becomes
     * a filter rule in somebody's inbox.
     */
    const first = notification({ type: 'GATE_FAILED', subjectId: 'gate:security' });
    const again = { ...first, id: 'n2', at: '2026-01-02T00:00:00.000Z' };

    const result = deliver([first], again);

    expect(result.ok ? undefined : result.refusal).toBe('ALREADY_NOTIFIED');
  });

  it('replaces an unread notification rather than stacking beside it', () => {
    // Two entries about the same subject make a list look busier than the situation is.
    const first = notification({ type: 'ASSIGNMENT', subjectId: 'task:7' });
    const again = { ...first, id: 'n2', summary: 'Reassigned to you.' };

    const result = deliver([first], again);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.replaced : undefined).toBe('n1');
  });

  it('does not replace a notification that was already read', () => {
    // Replacing a read one would silently rewrite what somebody has already seen and acted on.
    const first = notification({ type: 'ASSIGNMENT', subjectId: 'task:7', read: true });
    const again = { ...first, id: 'n2', read: false };

    const result = deliver([first], again);

    expect(result.ok ? result.replaced : 'not-ok').toBeUndefined();
  });

  it('gives every type an action the recipient can take', () => {
    /*
     * A notification about something the recipient cannot act on is news, and news belongs on a page
     * somebody chooses to open rather than in a channel that interrupts them.
     */
    for (const type of NOTIFICATION_TYPES) {
      expect(TYPE_SPEC[type].action.length, type).toBeGreaterThan(30);
    }
  });

  it('keeps urgency rare', () => {
    /*
     * Each new urgent type is individually defensible, and nobody ever compares the total against
     * what a person can absorb. Past a couple, urgency stops meaning anything and the channel gets
     * muted — taking the genuinely urgent ones with it.
     */
    const urgent = NOTIFICATION_TYPES.filter((type) => TYPE_SPEC[type].urgent);

    expect(urgent.length).toBeLessThanOrEqual(2);
    expect(urgent).toContain('SECURITY_RELEASE_BLOCKER');
  });

  it('finds nothing wrong with the catalogue as it stands', () => {
    expect(checkTypes()).toEqual([]);
  });

  it('names the urgent count separately from the total', () => {
    /*
     * "12 unread" and "12 unread, one of which is blocking a release" are different messages, and
     * only one of them gets read today.
     */
    const inbox = inboxFor(
      [
        notification({ id: 'a', type: 'SECURITY_RELEASE_BLOCKER' }),
        notification({ id: 'b', type: 'ASSIGNMENT' }),
      ],
      'u1',
    );

    expect(inbox.urgent).toHaveLength(1);
    expect(inbox.headline).toMatch(/needing attention now/i);
  });

  it('says nothing is waiting rather than showing a zero', () => {
    expect(inboxFor([], 'u1').headline).toMatch(/nothing waiting on you/i);
  });

  it('shows only the recipient’s own notifications', () => {
    const inbox = inboxFor([notification({ recipientId: 'someone-else' })], 'u1');

    expect(inbox.unread).toEqual([]);
  });

  it('marks one as read without touching the others', () => {
    const list = [notification({ id: 'a' }), notification({ id: 'b' })];
    const after = markRead(list, 'a');

    expect(after.find((n) => n.id === 'a')?.read).toBe(true);
    expect(after.find((n) => n.id === 'b')?.read).toBe(false);
  });

  it('offers only the eight types §43 names', () => {
    /*
     * The whole set. Adding a ninth is a decision somebody makes deliberately in that file, not a
     * side effect of adding a feature — which is how a notification channel becomes noise.
     */
    expect(NOTIFICATION_TYPES).toHaveLength(8);
  });
});
