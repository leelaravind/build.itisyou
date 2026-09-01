/**
 * Security findings and the threat model.
 *
 * Gap-spec §34 requires a threat model before production and lists nineteen threats to cover. The
 * decision here is to hold that list **in code** rather than in prose, so each threat carries the
 * control that addresses it and the test that proves the control fires — and so `docs/THREAT_MODEL.md`
 * is generated from it and checked in CI.
 *
 * A threat model that lives only in a document decays from the day it is written. Every threat below
 * names a mitigation and a verification, and a threat whose verification is missing is reported as a
 * gap rather than assumed handled. That is the difference between a threat model and a list of
 * things somebody once worried about.
 *
 * Contract: gap-spec §15.7 (Security Gate), §34 (threat model), §35, §36.
 */

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Severity, with `INFORMATIONAL` retained.
 *
 * Informational findings are the ones people delete to tidy the list, and they are frequently the
 * first half of a chain: an information disclosure that is harmless alone and is the reconnaissance
 * step for something that is not.
 */
export const FINDING_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * What has been decided about a finding.
 *
 * `ACCEPTED` and `FALSE_POSITIVE` are deliberately distinct. "We looked and it isn't real" and "it is
 * real and we are shipping anyway" are different claims, they age differently, and only one of them
 * needs revisiting when the system changes around it.
 */
export const FINDING_STATES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'ACCEPTED',
  'FALSE_POSITIVE',
] as const;

export type FindingState = (typeof FINDING_STATES)[number];

export const FINDING_SOURCES = [
  'DEPENDENCY_SCAN',
  'SECRET_SCAN',
  'STATIC_ANALYSIS',
  'PENETRATION_TEST',
  'CODE_REVIEW',
  'THREAT_MODEL',
  'INCIDENT',
  'EXTERNAL_REPORT',
] as const;

export type FindingSource = (typeof FINDING_SOURCES)[number];

export interface SecurityFinding {
  readonly id: string;
  readonly title: string;
  readonly severity: FindingSeverity;
  readonly state: FindingState;
  readonly source: FindingSource;
  /** Threat keys from `THREATS` this finding is an instance of. */
  readonly threats: readonly string[];
  /** Required on `ACCEPTED` and `FALSE_POSITIVE`. Checked. */
  readonly rationale?: string;
  /** Who decided. Required on any decided state. */
  readonly decidedBy?: string;
  /** Evidence node ids supporting the resolution. */
  readonly evidence: readonly string[];
}

/**
 * Whether a finding blocks release, by severity.
 *
 * Critical and high block. Medium does not — and that is a policy statement rather than a fact, which
 * is why it is one exported function rather than scattered comparisons: somewhere there is a project
 * whose risk appetite differs, and this is where they would change it, once.
 */
export function blocksRelease(severity: FindingSeverity): boolean {
  return severity === 'CRITICAL' || severity === 'HIGH';
}

/** Whether a finding is still outstanding. Accepted is *not* resolved. */
export function isOutstanding(finding: SecurityFinding): boolean {
  return finding.state === 'OPEN' || finding.state === 'IN_PROGRESS';
}

/* -------------------------------------------------------------------------- */
/* The threat model                                                           */
/* -------------------------------------------------------------------------- */

export interface Threat {
  readonly key: string;
  readonly title: string;
  /** What an attacker is trying to achieve, in their terms rather than in ours. */
  readonly goal: string;
  /** What stops it, or what would. */
  readonly mitigations: readonly string[];
  /**
   * How we know the mitigation works.
   *
   * A test name, a scan, a documented review. Empty means the mitigation is believed rather than
   * demonstrated, and `checkThreatModel` reports that.
   */
  readonly verifiedBy: readonly string[];
  /** Stated plainly. A threat model claiming full coverage is the least believable kind. */
  readonly residualRisk: string;
}

/**
 * The nineteen threats §34 names, in the order it names them.
 *
 * Order is the spec's, not a severity ranking, so that a reader can check this list against the
 * contract line by line without having to hold a mapping in their head.
 */
export const THREATS: readonly Threat[] = [
  {
    key: 'guest-session-abuse',
    title: 'Guest session abuse',
    goal: 'Create unlimited guest projects, or resurrect an expired guest session to reach data left behind in it.',
    mitigations: [
      'Guest sessions are opaque, signed and expiring; the cookie carries no identifier that can be guessed or enumerated.',
      'Guest project creation is rate-limited per session and per address (§36).',
      'Guest data expires on a stated schedule rather than accumulating indefinitely (§5.3).',
    ],
    verifiedBy: [
      'e2e/guest-intake.spec.ts — a different session cannot open the project',
      'packages/auth token tests — three malformed and tampered tokens are rejected',
    ],
    residualRisk:
      'A guest who keeps their own cookie retains access for the session lifetime. That is the feature; the limit is the lifetime.',
  },
  {
    key: 'account-takeover',
    title: 'Account takeover',
    goal: 'Sign in as somebody else, by guessing, replaying or intercepting their credentials.',
    mitigations: [
      'Authentication is delegated to an OIDC provider; this platform never holds a password.',
      'Sessions are rotated on privilege change and invalidated on sign-out.',
      'Sign-in attempts are rate-limited (§36).',
    ],
    verifiedBy: ['packages/auth session tests', 'e2e/security-headers.spec.ts'],
    residualRisk:
      'A compromised identity provider account compromises this one. That is the trade for not holding passwords, and it is the right trade, but it is not zero.',
  },
  {
    key: 'cross-tenant-access',
    title: 'Cross-tenant access',
    goal: 'Read or change another organisation’s data.',
    mitigations: [
      'Row-level security with FORCE ROW LEVEL SECURITY, under a NOSUPERUSER application role (SEC-001).',
      'Every query runs inside a tenant context set from the session, never from a request parameter.',
    ],
    verifiedBy: [
      'packages/db tenant isolation tests',
      'e2e/budget.spec.ts and e2e/trace.spec.ts — a second guest receives 404',
    ],
    residualRisk:
      'RLS protects the database. A defect in code that legitimately runs with a tenant context set is not caught by it.',
  },
  {
    key: 'idor',
    title: 'Insecure direct object reference',
    goal: 'Reach an object by supplying its identifier, without being entitled to it.',
    mitigations: [
      'Ownership is checked before permission, and a failure returns 404 rather than 403 — a 403 confirms the object exists.',
      'Identifiers are UUIDs, so they cannot be enumerated by counting.',
    ],
    verifiedBy: [
      'e2e/work.spec.ts — an unknown id is indistinguishable from a forbidden one',
      'e2e/budget.spec.ts — a second guest’s form rewrite is refused',
    ],
    residualRisk:
      'A UUID that leaks through a shared link or a log is a valid identifier for anyone holding it.',
  },
  {
    key: 'privilege-escalation',
    title: 'Privilege escalation',
    goal: 'Act with a role you do not hold.',
    mitigations: [
      'Permissions are a deny-by-default allowlist; a permission absent from the matrix is refused rather than inherited.',
      'Role is resolved server-side per request and never read from the client.',
    ],
    verifiedBy: [
      'packages/auth permission matrix tests',
      'docs/PERMISSIONS_MATRIX.md is generated',
    ],
    residualRisk:
      'A role granted in error by an administrator is indistinguishable from an intended one.',
  },
  {
    key: 'malicious-ai-json',
    title: 'Malicious imported AI JSON',
    goal: 'Get invalid or hostile structure into the Project Digital Twin through the interchange.',
    mitigations: [
      'The interchange is treated as a security boundary: size limits, depth limits, schema validation, then semantic validation, before anything is written.',
      'AI output carries EXTERNAL_AI_INFERENCE provenance, which loses to every user-confirmed fact.',
      'Nothing is applied without explicit user acceptance.',
    ],
    verifiedBy: ['packages/interchange validation tests', 'e2e/ai-import.spec.ts'],
    residualRisk:
      'A well-formed but wrong import that a user accepts becomes project data. The provenance record is what makes it traceable afterwards.',
  },
  {
    key: 'malicious-evidence-upload',
    title: 'Malicious uploaded evidence',
    goal: 'Store a file that harms whoever later downloads it, or that executes where it is stored.',
    mitigations: [
      'Size limit, MIME allowlist, and an extension/MIME consistency check (§35).',
      'Randomised storage keys; no user-controlled object path; no public bucket.',
      'Downloads are served with Content-Disposition set so nothing renders in place.',
    ],
    verifiedBy: [],
    residualRisk:
      'Not yet implemented — upload is out of scope until the evidence surface exists. Recorded here so it is a known gap rather than an oversight.',
  },
  {
    key: 'stored-xss',
    title: 'Stored cross-site scripting in documents',
    goal: 'Persist markup that executes in another user’s browser.',
    mitigations: [
      'All user text is rendered as text; there is no HTML-injection path in the rendering layer.',
      'A Content-Security-Policy without unsafe-inline means an injected script has nothing to run under.',
    ],
    verifiedBy: ['e2e/security-headers.spec.ts — CSP is present and strict'],
    residualRisk:
      'A future rich-text or document-preview feature would reopen this and needs its own review.',
  },
  {
    key: 'injection',
    title: 'Injection',
    goal: 'Get input interpreted as code — SQL, shell, or template.',
    mitigations: [
      'All database access goes through parameterised queries; no string-built SQL.',
      'No user input reaches a shell.',
    ],
    verifiedBy: ['packages/db query tests'],
    residualRisk:
      'Dynamic identifiers in DDL are the exception, and they come from code rather than from users.',
  },
  {
    key: 'ssrf',
    title: 'Server-side request forgery through integrations',
    goal: 'Make the server fetch a URL an attacker chooses, reaching internal services.',
    mitigations: [
      'V1 makes no outbound requests on behalf of users; the AI interchange is paste-based precisely so there is no fetch.',
    ],
    verifiedBy: ['e2e/security-headers.spec.ts — the landing page loads no third-party resources'],
    residualRisk:
      'Any future integration that fetches a user-supplied URL reintroduces this in full and needs an allowlist before it ships.',
  },
  {
    key: 'webhook-forgery',
    title: 'Webhook forgery',
    goal: 'Send a request that the platform believes came from a trusted system.',
    mitigations: ['No inbound webhooks in V1.'],
    verifiedBy: [],
    residualRisk:
      'Not applicable yet. Recorded so that adding webhooks is visibly a security change.',
  },
  {
    key: 'queue-poisoning',
    title: 'Queue poisoning',
    goal: 'Enqueue work that crashes the worker or runs with unintended authority.',
    mitigations: ['No background queue in V1; all work is request-scoped.'],
    verifiedBy: [],
    residualRisk: 'Not applicable yet, and the same note applies as for webhooks.',
  },
  {
    key: 'replay',
    title: 'Replay',
    goal: 'Repeat a captured request to duplicate its effect.',
    mitigations: [
      'State-changing requests are POSTs with an origin check and a same-site cookie.',
      'Idempotency keys on operations where repetition would be harmful (§48).',
    ],
    verifiedBy: ['e2e/security-headers.spec.ts'],
    residualRisk:
      'Idempotency is not yet applied to every mutation; the ones that exist are the ones that needed it.',
  },
  {
    key: 'export-abuse',
    title: 'Data export abuse',
    goal: 'Use the export feature to extract more than the exporter is entitled to, or to extract repeatedly.',
    mitigations: [
      'Export is tenant-scoped by the same context as every read, and rate-limited (§36).',
    ],
    verifiedBy: [],
    residualRisk:
      'Export is not implemented yet. A legitimate exporter can still take everything they can read; that is what export means.',
  },
  {
    key: 'audit-tampering',
    title: 'Audit log tampering',
    goal: 'Remove or alter the record of what was done.',
    mitigations: [
      'Audit rows are append-only: no update or delete grant exists for the application role (§40).',
    ],
    verifiedBy: ['packages/db audit immutability tests'],
    residualRisk:
      'A database superuser can still alter anything. Defence against that is operational, not application-level, and pretending otherwise would be the more dangerous claim.',
  },
  {
    key: 'prompt-data-leakage',
    title: 'Prompt data leakage',
    goal: 'Get sensitive project data into an external AI prompt where it leaves the tenant.',
    mitigations: [
      'The prompt package is shown to the user in full before it leaves; nothing is sent automatically.',
      'A copy-safety screen names what the package contains (§11.3).',
    ],
    verifiedBy: ['e2e/ai-import.spec.ts', 'packages/interchange prompt tests'],
    residualRisk:
      'A user who pastes the package into a provider has sent it to that provider. The control is that they can see exactly what they are sending.',
  },
  {
    key: 'log-leakage',
    title: 'Sensitive log leakage',
    goal: 'Read secrets or personal data out of logs.',
    mitigations: [
      'The logger redacts by key and by pattern before writing (§54).',
      'A secret scan runs in CI over the whole repository.',
    ],
    verifiedBy: [
      'packages/shared logging redaction tests',
      'scripts/scan-secrets.mjs — verified against five planted credential types',
    ],
    residualRisk:
      'Redaction is a denylist over known shapes. A secret in an unrecognised shape passes it.',
  },
  {
    key: 'denial-of-service',
    title: 'Denial of service',
    goal: 'Make the platform unavailable, cheaply.',
    mitigations: [
      'Tiered rate limits on the expensive endpoints: auth, project creation, import validation, upload, search, export, graph analysis (§36).',
      'Graph analysis is bounded: cycle detection is iterative and node scale classes cap traversal (§26.1).',
    ],
    verifiedBy: ['packages/twin graph tests — cycle detection on large graphs'],
    residualRisk:
      'Volumetric attacks are handled at the edge, not here. That is a deployment concern and it is recorded as one rather than claimed as solved.',
  },
  {
    key: 'dependency-compromise',
    title: 'Dependency compromise',
    goal: 'Reach the platform through something it installs.',
    mitigations: [
      'A lockfile with exact versions; `pnpm audit` at moderate and above runs in CI.',
      'No postinstall scripts are permitted for new dependencies without review.',
    ],
    verifiedBy: ['pnpm audit:deps in the gate'],
    residualRisk:
      'An audit only knows about published advisories. A compromised package nobody has reported yet passes cleanly, and no amount of scanning changes that.',
  },
];

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const SECURITY_DEFECTS = [
  'BLOCKING_FINDING_OPEN',
  'ACCEPTED_WITHOUT_RATIONALE',
  'DECIDED_BY_NOBODY',
  'RESOLVED_WITHOUT_EVIDENCE',
  'THREAT_UNVERIFIED',
  'FINDING_FOR_UNKNOWN_THREAT',
] as const;

export type SecurityDefect = (typeof SECURITY_DEFECTS)[number];

export interface SecurityGap {
  readonly defect: SecurityDefect;
  readonly summary: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly blocking: boolean;
}

export function checkSecurity(findings: readonly SecurityFinding[]): readonly SecurityGap[] {
  const gaps: SecurityGap[] = [];
  const threatKeys = new Set(THREATS.map((t) => t.key));

  for (const finding of findings) {
    if (isOutstanding(finding) && blocksRelease(finding.severity)) {
      gaps.push({
        defect: 'BLOCKING_FINDING_OPEN',
        summary: `${finding.title} (${finding.severity.toLowerCase()}) is still ${finding.state === 'OPEN' ? 'open' : 'in progress'}.`,
        why: 'Release-blocking findings must be resolved or explicitly accepted by somebody, not left in progress until the date arrives. "In progress" at a release gate is a decision made by omission.',
        evidence: [finding.id],
        blocking: true,
      });
    }

    if (
      (finding.state === 'ACCEPTED' || finding.state === 'FALSE_POSITIVE') &&
      (finding.rationale ?? '').trim() === ''
    ) {
      gaps.push({
        defect: 'ACCEPTED_WITHOUT_RATIONALE',
        summary: `${finding.title} is marked ${finding.state.toLowerCase().replace(/_/g, ' ')} with no rationale.`,
        why: '"Accepted" and "false positive" are different claims — one says it is real and we are shipping anyway, the other says we looked and it is not real. Without a rationale neither can be reviewed, and the two become the same button.',
        evidence: [finding.id],
        blocking: blocksRelease(finding.severity),
      });
    }

    if (finding.state !== 'OPEN' && (finding.decidedBy ?? '').trim() === '') {
      gaps.push({
        defect: 'DECIDED_BY_NOBODY',
        summary: `${finding.title} was moved to ${finding.state.toLowerCase().replace(/_/g, ' ')} by nobody.`,
        why: 'Every state other than open is a decision, and decisions have names on them. Otherwise the finding list drains itself between reviews and nobody can say who drained it.',
        evidence: [finding.id],
        blocking: false,
      });
    }

    if (finding.state === 'RESOLVED' && finding.evidence.length === 0) {
      gaps.push({
        defect: 'RESOLVED_WITHOUT_EVIDENCE',
        summary: `${finding.title} is resolved with nothing kept.`,
        why: 'A resolution nobody can check is a claim. The evidence is what lets the next reviewer skip re-doing the work rather than re-opening the argument.',
        evidence: [finding.id],
        blocking: false,
      });
    }

    for (const threat of finding.threats) {
      if (threatKeys.has(threat)) continue;

      gaps.push({
        defect: 'FINDING_FOR_UNKNOWN_THREAT',
        summary: `${finding.title} references the threat "${threat}", which is not in the model.`,
        why: 'Either the threat model is missing something real, or the reference is a typo pointing at nothing. Both are worth knowing, and a dangling reference quietly reads as coverage.',
        evidence: [finding.id],
        blocking: false,
      });
    }
  }

  return gaps;
}

/**
 * Threats whose mitigations are believed rather than demonstrated.
 *
 * Not blocking, and deliberately so: several threats here are mitigated by a feature not existing
 * yet, and there is nothing to verify. What matters is that the list is visible — a threat model
 * where every entry claims verification is the least believable kind.
 */
export function checkThreatModel(): readonly SecurityGap[] {
  return THREATS.filter((threat) => threat.verifiedBy.length === 0).map((threat) => ({
    defect: 'THREAT_UNVERIFIED' as const,
    summary: `${threat.title} has no recorded verification.`,
    why: `Its mitigation is believed rather than demonstrated. Residual risk as recorded: ${threat.residualRisk}`,
    evidence: [`threat:${threat.key}`],
    blocking: false,
  }));
}
