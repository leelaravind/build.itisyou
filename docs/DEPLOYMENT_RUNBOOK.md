# DEPLOYMENT RUNBOOK

**Contract:** `MASTER_IMPLEMENTATION_PLAN.md` Phases 19–20; `IMPLEMENTATION_GAP_CLOSURE_SPEC.md`
§15.8 (release readiness), §15.9 (production verification), §51 (backup and recovery), §52 (degraded
mode).

Hand-written, like `MIGRATION_POLICY.md` and for the same reason: this describes what people do, and
generating it from a constant would make it look authoritative while being enforced by nothing.

---

## 1. What is decided, and what is not

**Not decided: the hosting provider.** This was deferred to Phase 19 by explicit instruction, and it
remains open. Nothing in the codebase names a provider — no vendor SDK, no provider-specific
configuration, no deployment manifest for a particular platform.

That is not an omission to be tidied up later. It is the same position taken for authentication:
provider-neutral interfaces, so choosing costs a configuration change rather than a rewrite. What it
means for this runbook is that the *steps* below are complete and the *commands* for two of them are
not, and this document says which.

**Decided:**

| Question | Answer |
|---|---|
| Environment stages | `local → CI → preview → staging → production`, enforced in code (`mayPromoteTo`) |
| Environment identity | `APP_ENV`, validated against a closed set; deployed values refuse a schema rebuild |
| Build identity | `APP_VERSION` and `APP_COMMIT`, reported by `/api/health` from the running process |
| Database | PostgreSQL. PGlite in development and test is the same engine, so behaviour transfers |
| Migration approach | Additive-first, three-deployment sequence for anything destructive (`MIGRATION_POLICY.md`) |
| Rollback decision | Recorded per migration, before it runs |

---

## 2. Before any deployment

Everything here is automated and runs in CI. A deployment that skips it is not a deployment, it is a
copy.

```
pnpm format:check     # formatting
pnpm lint             # 40+ rules including type-aware ones
pnpm typecheck        # tsc --build across every package, max strictness
pnpm docs:check       # ten generated documents match their source
pnpm test             # unit and integration
pnpm test:e2e         # browser, five projects
pnpm scan:secrets     # verified against five planted credential types
pnpm audit:deps       # moderate and above
pnpm build            # production build
```

The one worth explaining is `docs:check`. Ten documents are generated from code — the permissions
matrix, the twin schema, the rule catalogue, the calculation specs, the traceability model, the threat
model, the impact rules, the governance model, the responsive contract. If any has drifted from what
it describes, CI fails. That is how a specification stops being a thing somebody meant to update.

---

## 3. Staging

### Steps

1. **Provision.** Requires a provider. *(open)*
2. **Configure.** `APP_ENV=staging`, database URL, session secret, `APP_VERSION`, `APP_COMMIT`.
3. **Migrate.** Additive migrations only; see `MIGRATION_POLICY.md`. The application refuses to start
   against a schema whose fingerprint it does not recognise, so a failed migration surfaces at boot
   rather than at the first query.
4. **Seed.** `pnpm seed:staging` — see §4 below.
5. **Verify.** `pnpm test:e2e` against the staging URL, plus `e2e/staging.spec.ts` for deployment
   identity and the performance smoke.
6. **Confirm rollback readiness.** §5.

### What "staging green" means

Every gate in §2 passing **against the staging deployment**, not against a local build. That
distinction is the entire reason staging exists — three separate stale-artefact incidents in this
project (KI-027 and its two predecessors) came from a server running something other than the code
under test, and each looked like a code failure until somebody checked what was actually running.

`e2e/staging.spec.ts` asserts the deployed artefact answers for itself: version identity from the
process, health that queries rather than remembers, a production build rather than a development one.

---

## 4. The staging fixture

Staging data is **synthetic and safe**, and the rule has no exceptions.

Restoring a production snapshot into staging is the most common way personal data ends up somewhere
its retention rules do not reach and its access controls are weaker. It is convenient exactly because
it is realistic, and that is what makes it dangerous rather than what makes it acceptable.

The fixture is generated: projects with realistic *shape* — a solo project, a twelve-person project,
one with failing gates, one archived, one restricted — and no real names, no real addresses, no real
anything. The shapes are what testing needs; the contents are not.

---

## 5. Rollback readiness

Confirmed **before** promoting, because confirming it afterwards means confirming it during an
incident.

| Question | How it is answered |
|---|---|
| What version is running? | `/api/health` reports `version` and `commit` from the process |
| What version would we go back to? | Recorded in the release manifest before promoting |
| Is the previous artefact still deployable? | Kept, not rebuilt — a rebuilt "same" version is a different artefact |
| Would the database still work with it? | Yes for additive migrations; for anything else the migration's rollback decision applies |
| How long does it take? | Timed during the drill, not estimated |

### The drill

Run in staging, not in production, and run before it is needed:

1. Deploy version N.
2. Deploy version N+1.
3. Roll back to N.
4. Time it, and check `/api/health` reports N.

An untimed rollback plan is a hypothesis. Phase 11 reports one as such (`ROLLBACK_NOT_REHEARSED`) and
does not block on it — blocking would make the field get ticked rather than the rehearsal get done.

---

## 6. Production

### Steps

1. **Approve.** Two roles, both required: engineering and product. §33 keeps approval separate from
   completion, and `signOffStatus` requires every named role rather than any one of them.
2. **Deploy.** Requires a provider. *(open)*
3. **Verify.** The ten checks §15.9 names — availability, TLS, security headers, critical journeys,
   authentication, APIs, monitoring, logging, backup/restore, deployment identity.
4. **Record.** Each check's result, who ran it, when, and the evidence.

### What "production verified" means, and what it cannot mean

The platform models this itself, and the model is deliberately strict: an unrecorded production check
is `NOT_CHECKED`, and the gate returns **indeterminate** rather than passed.

That rule applies to this project as much as to any project it manages. **These ten checks cannot be
recorded as passed until somebody runs them against a real production deployment**, and no amount of
local verification substitutes. Claiming otherwise here would be the exact failure the Phase-11 gate
was built to prevent — and doing it in the document that describes that gate would be worse than
doing it anywhere else.

A check that ran and failed is `FAILED`. A check nobody ran is `INDETERMINATE`. The two must never
read alike, because the second is the one that gets quietly treated as the first.

---

## 7. Recovery targets (§51)

§51 says: *do not invent claims.* So these are **proposed** and unaccepted.

| Target | Proposed | Basis |
|---|---|---|
| RPO — how much data may be lost | 15 minutes | Continuous archiving with a 15-minute cadence. Unverified until a restore is timed |
| RTO — how long recovery may take | 4 hours | An estimate, not a measurement. Becomes a target when a drill produces a number |

Both are proposals until somebody with authority accepts them and a drill produces real figures.
§51's own words: *"Initial V1 proposed targets must be explicitly accepted during deployment design."*
Neither has been accepted, because deployment design needs the provider that has not been chosen.

Recording them as targets now would be the fake precision the whole platform refuses.

---

## 8. What remains open

| Item | Blocked on |
|---|---|
| Staging provisioning and deployment | Hosting provider |
| Production deployment | Hosting provider |
| The ten §15.9 production checks | A running production deployment |
| RPO/RTO acceptance | Deployment design, which needs the provider |
| Rollback timing | A staging environment to drill in |
| OIDC provider | Deliberately deferred; local mock in use |

Everything else in Phases 19 and 20 is built, and every part of it that can be verified without a
provider has been.
