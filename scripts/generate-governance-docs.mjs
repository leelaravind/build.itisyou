#!/usr/bin/env node
/**
 * Generate `docs/GOVERNANCE_MODEL_SPEC.md` from `packages/governance/src/`.
 *
 * Covers §29 (baselines), §30–31 (documents), §32/§35 (evidence), §33 (approvals) and §40 (audit).
 *
 * §40 in particular asks for a *documented strategy* for legal deletion rather than merely a
 * mechanism, and generating that section from the code is the only way to be sure the document
 * describes what actually happens. A hand-written account of a redaction policy would survive any
 * amount of drift in the policy itself.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), 'docs', 'GOVERNANCE_MODEL_SPEC.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { BASELINE_TYPES, BASELINE_MEANING, REQUIRES_APPROVAL, BASELINE_REFUSALS } = await load(
  'packages/governance/src/baseline.ts',
);

const {
  EVIDENCE_TYPES,
  EVIDENCE_STRENGTH,
  RETENTION_CLASSES,
  RETENTION_MEANING,
  ALLOWED_MIME_TYPES,
  MAX_EVIDENCE_BYTES,
  UPLOAD_REFUSALS,
} = await load('packages/governance/src/evidence.ts');

const { APPROVAL_STATES, APPROVAL_STATE_MEANING, APPROVABLE_SUBJECTS, SIGN_OFF } = await load(
  'packages/governance/src/approval.ts',
);

const { SECTION_ORIGINS, ORIGIN_MEANING, DOCUMENT_STATES, REGENERATION_OUTCOMES } = await load(
  'packages/governance/src/document.ts',
);

const { AUDIT_CATEGORIES, LOG_DEFECTS } = await load('packages/governance/src/audit.ts');

const code = (s) => `\`${s}\``;

const baselineRows = BASELINE_TYPES.map(
  (type) =>
    `| ${code(type)} | ${BASELINE_MEANING[type]} | ${REQUIRES_APPROVAL[type] ? '**yes**' : 'no'} |`,
);

const evidenceRows = EVIDENCE_TYPES.map((type) => `| ${code(type)} | ${EVIDENCE_STRENGTH[type]} |`);

const retentionRows = RETENTION_CLASSES.map(
  (cls) => `| ${code(cls)} | ${RETENTION_MEANING[cls]} |`,
);

const mimeRows = Object.entries(ALLOWED_MIME_TYPES).map(
  ([mime, extensions]) => `| ${code(mime)} | ${extensions.map(code).join(', ')} |`,
);

const approvalRows = APPROVAL_STATES.map(
  (state) => `| ${code(state)} | ${APPROVAL_STATE_MEANING[state]} |`,
);

const signOffRows = SIGN_OFF.map(
  (r) => `| ${code(r.subjectType)} | ${r.roles.map(code).join(' **and** ')} | ${r.why} |`,
);

const originRows = SECTION_ORIGINS.map(
  (origin) => `| ${code(origin)} | ${ORIGIN_MEANING[origin]} |`,
);

const content = `# GOVERNANCE MODEL SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/governance/src/{baseline,evidence,approval,document,audit}.ts\`.
> Regenerate with \`pnpm docs:governance\`. CI runs \`pnpm docs:governance --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §29 (baselines), §30–31 (documents), §32 and §35
(evidence), §33 (approvals), §38 (retention), §40 (audit immutability);
\`MASTER_IMPLEMENTATION_PLAN.md\` Phase 13.

---

## 1. Baselines

§29 opens with "Baselines are deliberate governance snapshots", and the adjective is the design. A
snapshot taken automatically on a schedule is a backup. A baseline is somebody saying *this* is what
we agreed, on this date, for this reason.

| Type | What it records | Needs approval |
|---|---|---|
${baselineRows.join('\n')}

The other two types §29.1 names — monthly control and contract baselines — are *optional later*, and
they are **absent** rather than present and unused. An enum member nothing produces looks like a
supported feature to everyone reading the type, and the first person to select it discovers it does
nothing.

### Refusals

${BASELINE_REFUSALS.map(code).join(', ')}

An **empty** project cannot be baselined. An empty baseline hashes cleanly and verifies forever while
recording nothing, which makes it worse than no baseline: it looks like one.

A baseline with **no reason** is refused because that field is what makes eleven baselines
distinguishable from each other. Six months later somebody needs to know which one mattered.

### Never edited (§29.3)

Three words in the spec, and the module has no way to. **Not a guard that throws — an absence.** A
guard is a decision somebody can reverse in a hurry at two in the morning; a missing function is one
they have to notice they are adding. A test asserts no export matching \`edit\`/\`update\`/\`amend\`
exists, and it fails when one is added.

Superseding produces a **chain**: the new baseline, and the old one carrying a pointer to it. The old
one's content is untouched, and the pointer lives outside the hashed content precisely so that
recording the supersession cannot break the integrity of what was baselined.

### Integrity

A baseline nobody can verify is a claim about the past with nothing behind it, so the checksum makes
"has this been tampered with" a computation rather than an assumption.

A failing check is **not repaired by recomputing the hash** — that would erase the only sign anything
was wrong. Until the difference is explained, the baseline cannot be used as evidence of what was
agreed.

### Variance

Reported as named ids: what changed, what was added, what was removed, and which edges moved. There
is no drift percentage. "38% divergence" is unactionable and optimisable; "these four requirements
changed and this one was removed" is the conversation somebody needs to have.

**Removal is called out separately** because it is the one people miss: a requirement that quietly
stopped existing does not appear in a diff of the things that are still there.

---

## 2. Evidence

§32 lists the types and the fields. Each field is what makes evidence *evidence* rather than a file
somebody kept, and the one carrying the most weight is the hash: a record with no hash cannot be
distinguished from a record whose artefact was swapped, and at that point it is testimony.

| Type | What it can and cannot show |
|---|---|
${evidenceRows.join('\n')}

§32 permits manual attestation "if unavoidable", and that qualifier is preserved in the model rather
than lost in prose — an attestation should never sit in a report looking identical to a scan output.

### Upload constraints (§35)

Maximum size: ${String(MAX_EVIDENCE_BYTES)} bytes.

| MIME type | Permitted extensions |
|---|---|
${mimeRows.join('\n')}

Deny-by-default. Nothing on the list can execute in a browser, which is a property to guarantee
rather than to hope for.

**SVG is deliberately absent.** It is an image to a user and a script host to a browser, and it is
the single most common way an image upload becomes stored cross-site scripting.

The extension/MIME consistency check matters because a file declaring \`image/png\` while named
\`.html\` is not a mistake anybody makes by accident, and trusting the declared type alone lets the
browser decide what the file is at download time.

Refusals: ${UPLOAD_REFUSALS.map(code).join(', ')}

### Tampering: quarantine, never delete

The central decision in the evidence model. **The fact that evidence was tampered with is the most
important thing the system knows about it**, and deleting the record destroys exactly that. A
quarantined record still says what it claimed, who uploaded it and when, which is what an
investigation needs.

It also keeps the *absence* of evidence meaningful. If tampered records were deleted, a missing one
could mean "never existed" or "was removed", and nobody could tell.

A retention sweep **cannot** delete quarantined evidence regardless of its class. Housekeeping that
tidies away the record of tampering is the most convenient possible bug, and it would look like
housekeeping working correctly.

### Retention (§38)

| Class | Meaning |
|---|---|
${retentionRows.join('\n')}

Held on the evidence rather than derived from its type: two test reports can carry entirely different
obligations depending on what they were evidence *of*, and deriving the class would quietly delete
the one that mattered.

---

## 3. Approvals

§33 opens with "Approval is separate from normal task completion". Finishing the work and deciding to
accept it are two acts by two people, and a system treating a completed task as an approved one has
quietly removed the second.

Approvable subjects: ${APPROVABLE_SUBJECTS.map(code).join(', ')}

| State | Meaning |
|---|---|
${approvalRows.join('\n')}

\`WITHDRAWN\` is distinct from \`REJECTED\`. Rejected means somebody considered it and said no;
withdrawn means it was pulled before anybody decided. Collapsing them attributes a decision to
somebody who never made one.

### Staleness, resolved strictly

§33 ends with "if subject changes after approval: approval becomes stale/invalid as policy dictates".
The policy here is that a materially changed subject **invalidates** the approval.

The lenient reading makes a claim about a person: an approver who signed off version 3 has not signed
off version 7, and any system treating their approval as still standing has put their name on a
decision they did not make. That is worse than an inconvenient re-approval, and it is the kind of
error nobody discovers until it matters.

A **rejection** does not go stale. It records what somebody thought of the version they saw, and that
remains true.

### Deciding

- An approval needs no comment; a **rejection requires one**. A rejection with no reason leaves the
  requester guessing at what would make it acceptable, so the next attempt is a guess too.
- **Self-approval is refused.** It records a decision with nobody independent behind it, which is
  worse than no approval at all, because the record looks complete.
- If the subject moved between the request and the decision, the decision is **refused**. Recording it
  against the requested version misattributes it; recording it against the current one claims the
  approver reviewed a request nobody showed them.

### Sign-off

| Subject | Roles | Why |
|---|---|---|
${signOffRows.join('\n')}

Every named role must approve, not any one of them. "Any of" is how a multi-party sign-off quietly
becomes a single-party one: the fastest approver clears it and the others never look.

A stale approval does not count towards a sign-off, or a multi-party gate could be satisfied by
decisions made about a version nobody is shipping.

---

## 4. Documents

§30 sets a deliberate ceiling and says explicitly not to build real-time collaboration. That restraint
is the design: a governance platform's documents are read far more than written, and usually written
by one person at a time. Building for simultaneous editors spends most of the budget on the rarest
case.

States: ${DOCUMENT_STATES.map(code).join(', ')}

An **approved** document is frozen, for the same reason a baseline is: somebody signed off *this
text*, and editing it in place would change what they approved while leaving their name on it.

### §31's two instructions

> canonical data wins … preserve edits, do not silently overwrite, identify affected sections during
> regeneration, offer merge/update

Those pull in opposite directions, and resolving them badly gives one of the two failure modes every
document generator has. Overwrite, and somebody's carefully worded paragraph disappears; the second
time it happens they stop using the feature. Never overwrite, and the document drifts until it is
actively misleading — which is worse, because it still looks authoritative.

The resolution is **per-section provenance**:

| Origin | Behaviour |
|---|---|
${originRows.join('\n')}

Regeneration outcomes: ${REGENERATION_OUTCOMES.map(code).join(', ')}

A \`PROPOSED\` outcome carries both texts side by side, and says what leaving it unchanged would mean —
that the document says something the project no longer does. A prompt reading "these differ" is a
chore; one that says what ignoring it costs is a reason.

Accepting a proposal returns the section to \`GENERATED\`. Leaving it \`EDITED\` would prompt forever,
which teaches people to dismiss the prompt — and the next one, and the one that mattered.

Changes are reported as **named affected sections**, never as a whole-document staleness flag. A
document flagged stale in its entirety gets re-read once and ignored thereafter.

---

## 5. Audit

§40: append, query and retention are allowed; updating an event and deleting an individual event are
not.

Categories: ${AUDIT_CATEGORIES.map(code).join(', ')}

Enforced by **absence**, like the baseline. There is no \`update\`, no \`delete\`, and nothing exported
from which one could be built. A test asserts that and fails when such a function is added.

The **sequence is derived** from the log rather than supplied, so a caller cannot produce two events
claiming the same position — which would make the log's ordering unusable exactly where it matters.

An unnamed actor is recorded as \`unknown\` rather than left blank. An empty actor and an automated one
are different, and a log that cannot distinguish them cannot answer "did a person do this".

### The strategy for legal deletion

§40 asks for this to be documented rather than avoided, and the requirement is real: a subject access
erasure request can cover personal data that ended up in an audit payload.

The naive implementation deletes the row. That destroys the sequence, and a log with unexplained gaps
proves nothing about anything near them — a missing row cannot be distinguished from a row that was
never written.

**The strategy is redaction, not deletion.** The event keeps its id, its position in the sequence, its
timestamp, its actor, its category and its action. The named payload keys are removed and replaced by
a record of *what* was removed, *by whom*, and *under what authority*.

A redaction with no recorded authority is refused: the basis is what distinguishes a lawful erasure
from somebody removing an inconvenient record. Redacting an already-redacted event is refused, because
that would overwrite the record of the first redaction — the one thing a second redaction must not do.

The redaction is itself an auditable act and is appended to the log as one.

### Auditing the audit

Defects: ${LOG_DEFECTS.map(code).join(', ')}

A **sequence gap** is the one that matters. It means an event was deleted or never written, and it is
the single defect nothing else would reveal: every individual event still looks correct, and only the
sequence shows one is missing.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing;

  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/GOVERNANCE_MODEL_SPEC.md is missing. Run `pnpm docs:governance`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/GOVERNANCE_MODEL_SPEC.md is out of date with the governance model. Run `pnpm docs:governance`.',
    );
    process.exit(1);
  }

  console.log('Governance model specification is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log('Wrote docs/GOVERNANCE_MODEL_SPEC.md');
}
