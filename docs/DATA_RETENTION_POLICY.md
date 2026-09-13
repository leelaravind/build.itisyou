# DATA RETENTION POLICY

Contract: gap-spec §38 (this document and its twelve categories), §5.2–5.3 (guest data), §40 (audit
immutability), §51 (backup and recovery). Governance model: `docs/GOVERNANCE_MODEL_SPEC.md` §2.

Two rules govern everything below, and they are the reason this document is longer than a table of
numbers would be.

**A period nobody has decided is not a period.** §51's rule about proposed-and-unaccepted targets
applies here too: where the system enforces a limit, this says so and names the code that enforces
it; where it does not, this says *nothing deletes this today* rather than writing down a number that
would be an aspiration wearing the clothes of a control.

**Deletion is not immediate, and saying otherwise would be false.** §38 ends with "do not promise
immediate physical deletion from backups if not technically true". It is not true here, and §5 says
exactly how untrue it is, with the measured window.

---

## 1. The twelve categories

| Category | Retained for | Enforced by |
|---|---|---|
| Guest projects | 72 hours from the session's creation, not extended by activity | **Enforced.** `DEFAULT_GUEST_TTL_HOURS` (`packages/db/src/guest.ts`), overridable per environment with `GUEST_PROJECT_TTL_HOURS`; swept by `purgeExpiredGuestSessions`, called every three hours by the outbox Worker's `scheduled` handler. The sweep takes the whole tenant: the projects, the audit events, the session, and the organisation the session owned. See §2 for why the audit events had to be part of it |
| Active projects | As long as the organisation that owns them | **Enforced by cascade, not by a clock.** `projects.organization_id` is `ON DELETE CASCADE`; nothing expires an active project, and no dormancy rule has been decided |
| Archived projects | Indefinitely | **Nothing deletes them.** `ARCHIVED` is a lifecycle state, not a deletion: the row and its twin, evidence and audit rows all remain. Deliberate — an archived project is the one most likely to be asked about later |
| Deleted projects | Not applicable — **there is no delete** | **Absent, and stated rather than implied.** The product has no path that deletes a project. The two ways a project row disappears are guest expiry and deleting the organisation, both by cascade — and guest expiry is not a route anybody can ask for. See §4 |
| Evidence | By class, on the record: `TRANSIENT`, `PROJECT_LIFETIME`, `REGULATORY`, `INDEFINITE` | **Decided and unswept.** The class is held on each record and `mayDelete` (`packages/governance/src/evidence.ts`) decides what a sweep would be allowed to remove — refusing `REGULATORY`, `INDEFINITE`, and anything quarantined, regardless of class. It has tests and no production caller, so in practice evidence is kept until its project is |
| Audit logs | Indefinitely, except a guest's own | **Enforced against deletion, in the database.** `audit_events_no_update` and `audit_events_no_delete` raise `audit_events is append-only`, so §40's immutability does not depend on every caller remembering it. §40 also permits *retention*, and exactly one path takes it: the guest sweep, inside a transaction that sets `govintel.audit_retention` with `SET LOCAL`. Updates are refused whether or not it is set. Content is redacted *before* it is written, because a log kept this long is a long-lived exposure if a secret reaches it |
| AI raw imports | With the project | **Enforced by cascade.** `ai_imports.project_id` is `ON DELETE CASCADE`. `raw` holds exactly what was pasted and is never rewritten, so a guest's pasted text has the guest project's 72-hour life |
| AI generated prompts | Nothing is stored | **Nothing to retain.** The prompt is built on render and its id derived from the project, so the only persisted trace is `ai_imports.prompt_id` — the id of the prompt a response claims to answer, which is what makes a mismatch detectable |
| Exports | Nothing is produced | **Not implemented.** §39's export does not exist yet. When it does, an export is a copy of project data outside every control in this document and needs its own entry here before it ships |
| Background-job logs | Outbox rows: indefinitely. Worker logs: Cloudflare's setting | **Partly absent.** `outbox_events` rows, including dead-lettered ones, are never deleted — deliberate for the failed ones, unconsidered for the drained ones. Worker log retention is a Cloudflare platform setting that has not been configured here, and this document does not claim a number for it |
| Security logs | Cloudflare's setting | **Absent here.** Authentication and authorisation events that matter are audit events, and covered by that row. Everything else is structured log output to Workers observability (`[observability] enabled = true`), whose retention is Cloudflare's and is not configured by this repository |
| Backups | **6 hours**, measured | **Enforced by the platform.** Neon history retention is 21,600 seconds on both the staging and production projects, read from the API on 2026-09-05. See §5 |

---

## 2. The guest sweep deletes audit events, and had to

A guest who does anything auditable — records evidence, advances the lifecycle, imports an AI
response, raises a change request — produces an audit event naming their project.
`audit_events.project_id` is `ON DELETE RESTRICT`, and the trigger above refused every delete, so
that project could not be removed by anything. The sweep deletes every expired session in one
transaction, so a single audited project would have failed the whole batch, once a minute, for as
long as the row existed — logging `guest session purge failed` and retaining guest data past the 72
hours this document promises.

Measured on staging before the fix: **126 guest sessions owned projects with audit events, the first
expiring at 2026-09-05T08:08:57Z.** Nothing had failed yet. It was about half an hour away.

**Corrected 2026-09-13 (FR-005).** The fix above was tested only as a superuser. As the restricted role
the Worker connects as, the sweep could not see the audit events or projects it was deleting — row-level
security hid them — so it would still have failed on the first audited guest. It now deletes each
expired guest in its own transaction, inside that guest's tenant scope, and a guest that cannot be
deleted fails alone and is logged rather than stopping the rest.

Deleting the events with the project is also the right answer rather than the convenient one. §40
permits append, query and retention, and forbids updating an event or deleting an individual one; a
retention sweep removing an expired tenant is the case it allows. The alternative — keeping the
events while deleting the project — would keep a record of what a guest did, with its before/after
summary, in the one table nothing can delete. That is storing guest data permanently by another
route, which is what §5.2 forbids.

---

## 3. What is enforced, and what is only written down

Three of the twelve are enforced by something that runs: guest projects, by a cron that has deleted
rows; audit immutability, by two triggers that refuse the statement; and backups, by the platform
expiring history whether anybody wants it to or not.

Four more are enforced by cascade, which is a real control but a different one: active projects, AI
raw imports, and every child row of a project follow their parent. Cascade answers "when the parent
goes", not "when is it too old".

The rest are honest absences. Nothing sweeps evidence by class — the rule that would govern the
sweep is written and tested and has no caller — nothing prunes drained outbox rows, and no project is
ever deleted by a person asking for it to be. Each of those is a decision waiting for somebody, and
each is worth more as a named gap than as a period written down and unenforced: a policy asserting
"evidence is deleted after seven years" while nothing deletes anything is worse than this document,
because it would stop anybody looking.

---

## 4. There is no way to delete a project, and that is a gap

Worth stating plainly because its absence is easy to read as a decision.

A guest's project disappears when the session expires. An organisation's projects disappear if the
organisation does. There is no "delete this project" anywhere in the product, so a signed-in user who
wants their data removed has no route, and neither does an operator acting on their behalf.

That is a gap against §5.2's spirit and against any right-to-erasure obligation the platform's own
`SEC-PRIV-001` rule tells *users* to plan for. It is not closed here, because deletion touches audit
retention (§40 forbids deleting the events) and evidence retention (`REGULATORY` evidence cannot be
deleted to save space or because the project ended), and the correct design has to say which of the
three wins where they conflict. Recorded rather than improvised.

---

## 5. Backup expiry, measured

Deletion in this system means the row is gone from the database and still present in Neon's history
until that history expires.

| | |
|---|---|
| Neon history retention, staging (`silent-forest-67621251`, from 2026-09-13) | 21,600 seconds — **6 hours** |
| Neon history retention, production (`fragrant-fog-40333847`) | 21,600 seconds — **6 hours** |
| Read from | The Neon API, 2026-09-05 |

So the honest statement of physical deletion is: **deleted data stops being recoverable six hours
after it is deleted**, and within those six hours a restore would bring it back. No claim of
immediate physical deletion is made anywhere in this repository, and none should be.

Two consequences that belong together, because the same number produces both:

- For **privacy**, six hours is short. A guest project purged at 03:00 is unrecoverable by 09:00 with
  no action from anybody.
- For **recovery**, six hours is short in the direction that costs. `docs/DEPLOYMENT_RUNBOOK.md` §7
  proposes an RPO of 15 minutes, which sits comfortably inside the window — but a bad write nobody
  notices for a day has no restore point at all, and the runbook's drill restored the *current*
  state rather than an earlier one. The retention window is the ceiling on point-in-time recovery,
  and it is a plan setting: both projects are on Neon's free tier.

The R2 evidence bucket answers differently again, and the two should not be assumed to match. No
lifecycle rule is configured by this repository; nothing calls the storage adapter's `delete`, so no
artefact has ever been removed; and the bucket has no backup at all, which `docs/DEPLOYMENT_RUNBOOK.md`
§7 already records as one of three named gaps in the recovery drill. An artefact's retention is
therefore "until somebody removes it by hand, at which point immediately and irrecoverably".

---

## 6. What this document does not cover

- **Log retention numbers for Cloudflare Workers.** Not configured by this repository, so not claimed.
- **Any period for evidence classes.** `REGULATORY` means "kept for a period somebody outside the
  project decides", and nobody has decided one for this platform's own evidence.
- **Deletion on request.** See §4.
