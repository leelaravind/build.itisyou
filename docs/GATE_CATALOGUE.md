# QUALITY GATE CATALOGUE

> **Generated file — do not edit by hand.**
> Source of truth: `packages/rules/src/gates.ts`, `lifecycle.ts`, `methodology.ts`.
> Regenerate with `pnpm docs:rules`. CI runs `pnpm docs:rules --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §15 (eleven gates, each with exact criteria) and
§16 (methodology engine); `MASTER_IMPLEMENTATION_PLAN.md` §6 (lifecycle state machine).

---

## 1. What "exact criteria" means here

A criterion phrased as "security reviewed" is a checkbox someone ticks. A criterion has to be a
question the platform can answer from the project graph, or it is a self-assessment with extra steps.

**39 of 59 criteria are answered automatically** from the
graph. The rest require an EVIDENCE or APPROVAL node — which is still stricter than a checkbox:
something has to exist in the record, attributable and timestamped.

A criterion that cannot be decided returns *undecidable* rather than *failed*, and a gate with any
undecidable blocking criterion is `INDETERMINATE`. "We checked and it is not met" and "we cannot tell
yet" are different states, and collapsing them into failure teaches people that gate failures are
noise.

---

## 2. The eleven gates

## Discovery

Enough is established to plan against without guessing at the fundamentals.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `objective-defined` | The project has a stated objective. | automatic | **blocking** |
| `type-established` | The kind of project is known, or has been explicitly assumed. | automatic | **blocking** |
| `constraints-captured` | The constraints that shape the plan have been recorded. | automatic | reported |
| `unknowns-identified` | What is not known has been written down rather than glossed over. | automatic | reported |
| `research-done-or-deferred` | External research has been done, or explicitly deferred. | automatic | reported |

### Why each criterion exists

- **The project has a stated objective.** Every requirement in the plan is justified by tracing back to an objective. Without one, nothing in the plan can be argued for or against.
- **The kind of project is known, or has been explicitly assumed.** Project type selects the security, testing and release rule packs. Without it the plan is generic, and generic plans omit precisely the obligations that matter most.
- **The constraints that shape the plan have been recorded.** A plan built without knowing the budget, the deadline or the team is a plan built against an imaginary project.
- **What is not known has been written down rather than glossed over.** An unknown that is merely absent from the record is indistinguishable from one nobody thought to ask about.
- **External research has been done, or explicitly deferred.** Deferring research is a legitimate decision. Forgetting about it is not, and the two look identical unless one is recorded.

---

## Requirements

What the system must do is written down, and each item can be shown to be met.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `critical-captured` | The requirements that matter have been captured. | automatic | **blocking** |
| `verification-defined` | Every requirement says how it will be shown to be met. | automatic | **blocking** |
| `critical-unknowns-resolved` | No requirement is still blocked by something critical that nobody knows. | automatic | **blocking** |
| `privacy-security-included` | Where personal data or authentication is involved, the corresponding requirements exist. | automatic | **blocking** |
| `no-orphan-objectives` | Every objective has at least one requirement working towards it. | automatic | reported |

### Why each criterion exists

- **The requirements that matter have been captured.** Work that implements nothing in particular cannot be prioritised, estimated or verified.
- **Every requirement says how it will be shown to be met.** A requirement with no verification method can only be closed by opinion, and a traceability matrix full of opinions proves nothing.
- **No requirement is still blocked by something critical that nobody knows.** Planning around a critical unknown means planning around a guess, and the guess disappears from view once the plan is written.
- **Where personal data or authentication is involved, the corresponding requirements exist.** These obligations are the ones most often discovered late, when they are most expensive and least negotiable.
- **Every objective has at least one requirement working towards it.** An objective nothing implements is either not really an objective, or a gap nobody has noticed.

---

## Architecture

How the system is put together is decided and recorded, not discovered during build.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `components-identified` | The major components exist in the record. | automatic | **blocking** |
| `decisions-captured` | The decisions that were genuinely decisions have been recorded. | automatic | **blocking** |
| `environments-defined` | The environments the system runs in are named. | automatic | **blocking** |
| `component-dependencies-acyclic` | The component dependencies form no cycles. | automatic | **blocking** |
| `security-architecture` | Security is part of the architecture rather than a later addition. | evidence | **blocking** |

### Why each criterion exists

- **The major components exist in the record.** Components are what work attaches to. Without them, estimates are against an undivided lump.
- **The decisions that were genuinely decisions have been recorded.** An architectural decision nobody wrote down is one that will be re-argued, usually at the worst moment and without the original reasoning.
- **The environments the system runs in are named.** Deployment topology decides a large part of the operational cost, and discovering it during release is the most expensive time to find out.
- **The component dependencies form no cycles.** A cyclic architecture cannot be built or deployed in any order.
- **Security is part of the architecture rather than a later addition.** Security retrofitted onto a finished design costs several times what designing for it costs, and usually cannot reach the same standard.

---

## Planning

The work is broken down, ordered, estimated and paid for.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `breakdown-exists` | The work has been broken down. | automatic | **blocking** |
| `dependencies-valid` | The dependencies between work items contain no cycles. | automatic | **blocking** |
| `estimates-present` | The work carries estimates. | automatic | **blocking** |
| `milestones-defined` | There are milestones to measure progress against. | automatic | reported |
| `risks-captured` | The major risks have been written down. | automatic | **blocking** |
| `budget-complete` | The budget has been worked out. | automatic | reported |
| `approval-recorded` | Someone with the authority to commit has approved the plan. | evidence | **blocking** |

### Why each criterion exists

- **The work has been broken down.** A project with no breakdown cannot be scheduled, assigned or tracked.
- **The dependencies between work items contain no cycles.** A dependency cycle is a deadlock the plan would otherwise present as a schedule.
- **The work carries estimates.** A plan with no estimates cannot be compared against a budget or a deadline, so it cannot be wrong — which is not the same as being right.
- **There are milestones to measure progress against.** Without intermediate points, the first honest signal about the schedule arrives at the end.
- **The major risks have been written down.** A risk register that is empty means nobody looked, not that there is nothing to find.
- **The budget has been worked out.** Without a budget the estimates have no ceiling to check against, so the plan cannot tell anyone when it has become unaffordable.
- **Someone with the authority to commit has approved the plan.** Committing money and time is a decision a person takes. The platform records it; it does not make it.

---

## Development

What was scoped for this release is built, and someone other than the author has looked at it.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `scope-complete` | The work in scope for this release is finished. | automatic | **blocking** |
| `review-evidence` | The required review has happened and left a record. | evidence | **blocking** |
| `unit-tests-present` | The work is covered by tests. | automatic | **blocking** |

### Why each criterion exists

- **The work in scope for this release is finished.** Verifying half-built work produces results about a system that will not ship.
- **The required review has happened and left a record.** Review is the cheapest defect-detection available, and it is the first thing dropped under time pressure — which is exactly when it is most needed.
- **The work is covered by tests.** Untested code is not finished; it is code whose behaviour nobody has checked, which is a different thing from code that works.

---

## Testing

The system has been checked against what was agreed, and the failures are known.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `categories-executed` | Every required category of test has been run. | automatic | **blocking** |
| `no-critical-failures` | No critical test is failing. | automatic | **blocking** |
| `exceptions-documented` | Anything accepted despite failing has been written down and attributed. | automatic | **blocking** |
| `coverage-meets-policy` | Requirement verification coverage meets the policy. | automatic | **blocking** |

### Why each criterion exists

- **Every required category of test has been run.** Passing every unit test says nothing about whether the parts work together, and passing integration tests says nothing about accessibility.
- **No critical test is failing.** Releasing over a known critical failure is a decision someone should take deliberately, not one that happens because the gate was quiet about it.
- **Anything accepted despite failing has been written down and attributed.** An accepted exception that nobody recorded becomes, six months later, a defect nobody knew about.
- **Requirement verification coverage meets the policy.** Coverage measured in lines says how much code ran. Coverage measured in requirements says how much of what was promised was checked.

---

## Security

The security work has been done and its findings resolved or consciously accepted.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `findings-reviewed` | The security findings have been looked at. | evidence | **blocking** |
| `blocking-findings-resolved` | Nothing that blocks release is outstanding. | automatic | **blocking** |
| `authz-verified` | Authentication and authorisation have been verified, not assumed. | automatic | **blocking** |
| `scans-acceptable` | Dependency and secret scans are clean, or their findings accepted. | evidence | **blocking** |

### Why each criterion exists

- **The security findings have been looked at.** A scan nobody read is a scan that was not run, except that it also produces a false sense of having been.
- **Nothing that blocks release is outstanding.** A release-blocking finding that ships is a decision to accept it, and that decision must be taken by a person rather than by an omission.
- **Authentication and authorisation have been verified, not assumed.** Broken object-level authorisation is the most common serious web vulnerability, and it passes every test that only checks the happy path.
- **Dependency and secret scans are clean, or their findings accepted.** Most breaches arrive through a dependency nobody chose and a credential nobody meant to commit.

---

## Release readiness

Everything needed to release — and to undo the release — exists before it happens.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `deployment-plan` | There is a deployment plan. | automatic | **blocking** |
| `rollback-plan` | There is a rollback plan. | evidence | **blocking** |
| `migration-plan` | Any data migration has a plan, including how to reverse it. | evidence | reported |
| `approvals` | The release has been approved. | evidence | **blocking** |
| `monitoring` | Monitoring is in place before the release, not after it. | evidence | **blocking** |
| `no-stale-gates` | No earlier gate passed on a basis that has since changed. | automatic | **blocking** |
| `backup-readiness` | Backups exist and restoring from one has been tried. | evidence | **blocking** |

### Why each criterion exists

- **There is a deployment plan.** Improvised deployments fail in ways that are hard to diagnose under pressure.
- **There is a rollback plan.** The moment a rollback is needed is the worst possible moment to design one. An untested rollback plan is a hypothesis.
- **Any data migration has a plan, including how to reverse it.** Code rolls back cleanly; data does not. A migration without a reverse path makes the whole release one-way.
- **The release has been approved.** Someone accountable has to say yes, and the record has to show who.
- **Monitoring is in place before the release, not after it.** Monitoring added after a release cannot tell you whether the release caused what you are now seeing.
- **No earlier gate passed on a basis that has since changed.** Gap-spec §8.3: a passed gate whose evidence has been invalidated still reads "passed". Releasing on that basis is the precise false assurance this whole system exists to prevent — the record says it was checked, and what was checked no longer exists.
- **Backups exist and restoring from one has been tried.** A backup nobody has restored from is a belief about a backup. The restore is the part that fails.

---

## Production verification

What is actually running has been checked, rather than assumed from what was released.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `availability` | The system is reachable and serving. | automatic | **blocking** |
| `tls` | TLS is configured correctly on the real hostname. | evidence | **blocking** |
| `security-headers` | The security headers are present in production. | evidence | **blocking** |
| `critical-journeys` | The journeys that matter have been walked in production. | evidence | **blocking** |
| `logging` | Logs are arriving where someone will see them. | evidence | **blocking** |
| `authentication` | Signing in works against the production identity provider. | evidence | **blocking** |
| `apis` | The APIs production depends on answer from production. | evidence | **blocking** |
| `deployment-identity` | Production is running the version that was released. | evidence | **blocking** |

### Why each criterion exists

- **The system is reachable and serving.** A deployment that reported success and a system that is serving traffic are different claims.
- **TLS is configured correctly on the real hostname.** Certificate and redirect problems appear only against the real hostname, which is exactly what staging does not have.
- **The security headers are present in production.** Headers are frequently correct in the application and stripped or overridden by whatever sits in front of it.
- **The journeys that matter have been walked in production.** Everything can be individually healthy while the thing users actually do is broken.
- **Logs are arriving where someone will see them.** The first incident is the wrong time to discover that logging was never wired up in this environment.
- **Signing in works against the production identity provider.** The redirect URI, the client secret and the issuer are all per-environment; a sign-in that works on staging proves nothing about production.
- **The APIs production depends on answer from production.** Credentials, allow-lists and quotas differ by environment, so an integration that passed in staging can refuse production on its first call.
- **Production is running the version that was released.** A deploy can report success while serving the previous build; the version the running system reports is the only evidence of what shipped.

---

## Operational readiness

Somebody owns it, and they have what they need to run it.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `ownership` | Someone owns the system. | automatic | **blocking** |
| `alerts` | Alerts exist and go to someone who will act on them. | evidence | **blocking** |
| `incident-process` | There is an agreed way to handle an incident. | evidence | **blocking** |
| `known-limitations` | The known limitations are written down. | automatic | reported |
| `maintenance-tasks` | Recurring maintenance work has been identified. | automatic | reported |

### Why each criterion exists

- **Someone owns the system.** A system with no owner has no one to notice it is failing, and no one to decide what to do about it.
- **Alerts exist and go to someone who will act on them.** An alert delivered to an unread inbox is worse than no alert, because it makes people believe they are covered.
- **There is an agreed way to handle an incident.** Deciding who does what during an outage costs time nobody has at the time.
- **The known limitations are written down.** Limitations that live in one person’s head leave with that person.
- **Recurring maintenance work has been identified.** Certificate renewals, dependency updates and log rotation are cheap when planned and outages when forgotten.

---

## Completion and handover

The project can be closed without anything being quietly dropped.

| Criterion | Must be true | Decided by | Effect |
|---|---|---|---|
| `requirements-dispositioned` | Every requirement is either met or explicitly not. | automatic | **blocking** |
| `tests-complete` | Testing is finished. | automatic | **blocking** |
| `security-resolved` | Security findings are resolved or formally accepted. | automatic | **blocking** |
| `documents-complete` | The handover documents exist. | automatic | **blocking** |
| `ownership-transferred` | Ownership, credentials and administrative access have been transferred. | evidence | **blocking** |
| `debt-recorded` | Outstanding technical debt is recorded rather than left to be discovered. | automatic | reported |

### Why each criterion exists

- **Every requirement is either met or explicitly not.** A requirement left in limbo at handover is one the next person will assume was delivered.
- **Testing is finished.** Handing over untested work transfers the risk without transferring the knowledge.
- **Security findings are resolved or formally accepted.** An unresolved finding at handover becomes the new owner’s problem without them being told it is theirs.
- **The handover documents exist.** Undocumented systems are maintained by guesswork until someone rewrites them.
- **Ownership, credentials and administrative access have been transferred.** A handover where the original team still holds the only administrative access is not a handover.
- **Outstanding technical debt is recorded rather than left to be discovered.** Debt that is written down can be planned for. Debt that is not becomes an unexplained slowdown.


---

## 3. The lifecycle, and which gates each transition needs

12 states. Anything not listed below is refused — deny by default, for the
same reason the graph's edge legality is: the dangerous transitions are the ones nobody thought of.
`IDEA` straight to `LIVE` is not a state change but a lie.

| Transition | Requires | What it asserts |
|---|---|---|
| `IDEA` → `DISCOVERY` | — | Someone has started establishing what this actually is. |
| `DISCOVERY` → `PLANNING` | `DISCOVERY` | Enough is known about the objective, the type and the constraints to plan against. |
| `PLANNING` → `PLANNED` | `REQUIREMENTS`, `ARCHITECTURE`, `PLANNING` | A plan exists, its dependencies are valid and its estimates are present. |
| `PLANNED` → `APPROVED` | `PLANNING` | Someone with the authority to commit the money and the time has agreed to the plan. |
| `APPROVED` → `IN_PROGRESS` | — | Work has started. |
| `IN_PROGRESS` → `VERIFYING` | `DEVELOPMENT` | The scope for this release is built and ready to be checked. |
| `VERIFYING` → `IN_PROGRESS` | — | Verification found something that needs building differently. |
| `VERIFYING` → `RELEASE_READY` | `TESTING`, `SECURITY`, `RELEASE_READINESS` | Tested, security-reviewed, and everything needed to release exists. |
| `RELEASE_READY` → `VERIFYING` | — | Something changed, so the verification has to be redone. |
| `RELEASE_READY` → `LIVE` | `RELEASE_READINESS` | Deployment has been authorised and carried out. |
| `LIVE` → `OPERATING` | `PRODUCTION_VERIFICATION` | What is running in production has been verified as what was released. |
| `LIVE` → `VERIFYING` | — | The release was withdrawn or rolled back. |
| `OPERATING` → `IN_PROGRESS` | — | Further work has started on a system that is already running. |
| `OPERATING` → `COMPLETED` | `OPERATIONAL_READINESS`, `COMPLETION` | Handed over, with ownership and outstanding debt recorded. |
| `COMPLETED` → `ARCHIVED` | — | Closed and made read-only. |
| `ARCHIVED` → `COMPLETED` | — | Restored from the archive so it can be worked on again. |
| `PLANNED` → `PLANNING` | — | The plan needs revisiting before it is approved. |
| `APPROVED` → `PLANNING` | — | Something changed enough that the approved plan no longer holds. |
| `DISCOVERY` → `IDEA` | — | Discovery established that this is not yet a project. |

A project may be archived from any state (11 of
12) and restored from the archive. Archival is not deletion, and a
one-way door would make people avoid archiving things that should be archived.

Backwards transitions are deliberately present. Verification finding something and returning the
project to `IN_PROGRESS` is the system working; a machine that only moves forward forces people to
lie about where they are.

An unevaluated gate counts as **not passed**. Treating it as satisfied would make every gate optional
for anyone who simply never ran it.

---

## 4. Methodology (§16)

- **Iterative (Scrum-like)** — Fixed-length iterations, each ending with something demonstrable.
- **Continuous flow** — Work moves through stages continuously, with a limit on how much is in progress.
- **Sequential** — Phases completed in order, each with an exit gate.
- **Hybrid** — Sequential at the phase level, iterative within the build.
- **Solo or agent-assisted** — One person, possibly with AI assistance, working continuously.

| Methodology | Decomposition | Gate cadence | Change handling |
|---|---|---|---|
| Iterative (Scrum-like) | ITERATION | PER_ITERATION | Change enters the backlog and is prioritised for a future iteration. The current iteration is left alone. |
| Continuous flow | CONTINUOUS_FLOW | CONTINUOUS | Change is added to the queue and pulled when capacity allows. Priority is re-decided at the moment of pulling. |
| Sequential | PHASE | PER_PHASE | Change after a phase closes goes through formal change control, with impact assessed before approval. |
| Hybrid | MIXED | PER_PHASE | Change within a phase is absorbed by the iteration; change crossing a phase boundary goes through change control. |
| Solo or agent-assisted | CONTINUOUS_FLOW | PER_RELEASE | Change is decided immediately by the person doing the work, and recorded. |

### The constraint

§16: **"Methodology must not bypass mandatory security/release gates."**

A methodology decides *how work is organised* — how it is sliced, when it is reviewed, how change is
handled. It does not decide *which obligations apply*. Conflating the two is the most common way a
lighter process becomes a lighter standard, and it happens gradually: a ceremony, then a review, then
a gate, each justified by the methodology rather than by anyone deciding the check was unnecessary.

Every methodology therefore receives every gate. What varies is cadence.

### Each one's weakness, stated

- **Iterative (Scrum-like)** is poorly suited to: Fixed-scope, fixed-price contracts, and work where the sequence is dictated externally — the ceremony then costs time without delivering the adaptation it exists for.
- **Continuous flow** is poorly suited to: Work needing a committed date. Continuous flow optimises throughput, and gives weaker predictions about when a specific item will be done.
- **Sequential** is poorly suited to: Anything where the requirements are still being discovered. The cost of being wrong is paid entirely at the end, when it is most expensive.
- **Hybrid** is poorly suited to: Small teams, where the overhead of maintaining both structures exceeds what either contributes.
- **Solo or agent-assisted** is poorly suited to: Anything needing separation of duties. A single person cannot both request and approve, so the review controls have to come from automation or from someone outside.

A tool presenting every option as equally suitable is not helping anyone choose, and the choice
matters most to the people least equipped to make it.
