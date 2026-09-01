# DEPLOYMENT RUNBOOK

**Contract:** `MASTER_IMPLEMENTATION_PLAN.md` Phases 19–20; `IMPLEMENTATION_GAP_CLOSURE_SPEC.md`
§15.8 (release readiness), §15.9 (production verification), §51 (backup and recovery), §52 (degraded
mode).

Hand-written, like `MIGRATION_POLICY.md` and for the same reason: this describes what people do, and
generating it from a constant would make it look authoritative while being enforced by nothing.

---

## 1. What is decided, and what is not

**Decided: Cloudflare.** Workers for the application (via `@opennextjs/cloudflare`), R2 for evidence,
Queues and Cron Triggers for the outbox, Hyperdrive in front of an external managed PostgreSQL. The
architecture and the reasoning are in `CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md`.

**Settled: the accounts.** Both arrived on 2026-09-01 and staging is partly built. Commands below
that have been run against the real account are marked; the values they returned are recorded rather
than described, because a runbook that says "put the returned id somewhere" is a runbook nobody can
follow a year later.

| Resource | Value | Notes |
|---|---|---|
| Cloudflare account | `a0365f6aaae5fe32b3fdb8fa08fd000c` | Shares the account with unrelated `itisyou-*` resources; everything here is namespaced `govintel-*` |
| PostgreSQL | Neon project `tiny-mode-81422275` | Branch `staging` (`br-frosty-waterfall-zarolebw`), forked from `production` |
| Hyperdrive | `fa38480586e44cebab20fe15ac2121a0` | Created `--caching-disabled`. Same id in both Workers |
| R2 | `govintel-evidence-staging` | Private; no public bucket exists |
| Queues | `govintel-outbox-staging`, `govintel-outbox-dlq-staging` | |
| Worker (outbox) | `govintel-worker-staging` | **Deployed and verified.** Cron `* * * * *`, producer and consumer |
| Worker (web) | `govintel-web-staging` | **Not yet deployed** — see §8 |

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

### Provisioning

Run once per environment, against a real Cloudflare account. **The `--caching-disabled` flag is a
security decision, not a preference** — see SEC-003b and KI-050.

```
# Hyperdrive, in front of the managed PostgreSQL.
wrangler hyperdrive create govintel-staging --caching-disabled --connection-string="postgres://..."

# Evidence. Private; there is deliberately no public bucket.
wrangler r2 bucket create govintel-evidence

# The outbox queue and its dead-letter queue.
wrangler queues create govintel-outbox
wrangler queues create govintel-outbox-dlq
```

Put the returned Hyperdrive id into both `apps/web/wrangler.toml` and `apps/worker/wrangler.toml`,
replacing `REPLACE_WITH_HYPERDRIVE_ID`. **The same id in both** — two Hyperdrive configurations over
one database would be two pools with two independent caches, and the caching decision would then have
to be right in two places.

### Building the web Worker on Windows

The OpenNext bundler creates symlinks, and Windows refuses them without Developer Mode or
Administrator (KI-051). Confirmed directly: `fs.symlinkSync` is denied, `fs.symlinkSync(..., 'junction')`
is allowed — so it is a privilege restriction on symlinks specifically, not a filesystem limitation.

Enabling Developer Mode is a machine-wide change. The build runs under WSL instead:

```
# One-off: a Linux toolchain matching the Windows one. nvm is user-local, no sudo.
wsl -e bash -lc "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
wsl -e bash -lc ". ~/.nvm/nvm.sh && nvm install 22.23.2 && corepack enable && corepack prepare pnpm@11.22.0 --activate"

# An isolated tree. Deliberately NOT the Windows checkout: running Linux pnpm against a
# node_modules built by Windows pnpm rewrites its links and breaks the Windows tree.
# It lives on E: so neither the source nor the 895 MB of node_modules lands on C:.
cd /mnt/e/Project/build && tar --exclude=node_modules --exclude=.git --exclude='.env*'   --exclude=.next --exclude=.open-next --exclude=dist -cf - . | (cd ../build-wsl && tar -xf -)

cd /mnt/e/Project/build-wsl && pnpm install --frozen-lockfile --store-dir /mnt/e/Project/.pnpm-store-wsl
```

Three things that are easy to get wrong:

- **`deploy` does not build.** `opennextjs-cloudflare deploy` reads the compiled config and runs
  `wrangler deploy`; it does not re-run the bundler. Syncing source and deploying ships the *previous*
  build, silently and successfully. Always `cf:build` first.
- **The local Hyperdrive string is required even to deploy.** The deploy path starts a local platform
  proxy to read the environment, which refuses without
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. Give it a **credential-free placeholder**
  (`postgres://127.0.0.1:5432/unused-local-emulation-only`); it is used only by the local emulator, and
  putting the real DSN there would write a live credential into a shell history for no benefit.
- **Wrangler credentials are shared, not re-created.** Point WSL at the Windows config rather than
  logging in twice: `export XDG_CONFIG_HOME=/mnt/c/Users/<you>/AppData/Roaming/xdg.config`.

The alternative is CI on `ubuntu-latest`, which needs a `CLOUDFLARE_API_TOKEN` repository secret —
a `wrangler login` OAuth token cannot be used from CI. That is the only thing in this runbook that
must be created by hand in the dashboard.

### Secrets

```
wrangler secret put DATABASE_URL   --env staging   # the Hyperdrive connection string
wrangler secret put SESSION_SECRET --env staging
```

`APP_VERSION` and `APP_COMMIT` are set by CI at build time, not stored as secrets — they are not
secret, and a value set by hand is a value that drifts from what is actually deployed.

### Steps

1. **Migrate.** `DATABASE_URL_UNPOOLED=... pnpm migrate`. Additive only; see `MIGRATION_POLICY.md`.
   The script creates a schema **from empty and nothing else** — it refuses a database holding a
   different fingerprint, and refuses one holding unrelated tables, because guessing at a migration is
   how a script destroys data on the day the guess is wrong. There is no `DROP` in it, not even behind
   a flag. The application separately refuses to start against a schema whose fingerprint it does not
   recognise, so a failed migration surfaces at boot rather than at the first query.
2. **Verify isolation.** `APP_ENV=staging DATABASE_URL_UNPOOLED=... pnpm verify:isolation`. This is
   the check that cannot run anywhere but a real pooled database — see SEC-003.
3. **Deploy.**
   ```
   pnpm --filter=@govintel/web cf:deploy -- --env staging
   pnpm --filter=@govintel/worker cf:deploy -- --env staging
   ```
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
2. **Deploy.**
   ```
   pnpm --filter=@govintel/web cf:deploy -- --env production
   pnpm --filter=@govintel/worker cf:deploy -- --env production
   ```
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
| **Web Worker deployment** | The OpenNext build (KI-051). Being built under WSL; if that fails, CI on `ubuntu-latest` builds it and needs a `CLOUDFLARE_API_TOKEN` repository secret — the one thing here that must be created by hand in the dashboard, because a `wrangler login` OAuth token cannot be used from CI |
| E2E against a staging URL | The web Worker being deployed |
| `SESSION_SECRET` | Generated at deploy time; not sourced from anywhere, so not a blocker |
| Production deployment | A passing staging gate |
| The ten §15.9 production checks | A running production deployment |
| RPO/RTO acceptance | A restore drill, which needs a real database |
| Rollback timing | A staging environment to drill in |
| OIDC provider | Deliberately deferred; local mock in use |

### What staging has already proved

Not "the configuration parses" — the behaviour, end to end, against the real thing:

| Check | Result |
|---|---|
| Schema applied to a networked PostgreSQL | `pnpm migrate` — first non-PGlite schema this project has ever had |
| Tenant isolation under a real pool | `pnpm verify:isolation` — 40/40 isolated. The pre-fix code measured 18/40 **wrong tenant** |
| RLS is enforced, not merely defined | Application role is neither superuser nor `BYPASSRLS`; `neondb_owner` *is*, which is why the role switch is load-bearing |
| Cron → Hyperdrive → Queue → consumer | Three events processed; one unrecognised event **dead-lettered**, not silently marked done |

Four P1 defects were found by doing this that no local test could have found — KI-052 through KI-055,
plus the measurement that turned KI-049 from a reasoned risk into an observed one. That is the
argument for staging existing, made concrete.

Everything else is built and verified. The Worker bundles and resolves its bindings
(`wrangler deploy --dry-run`: 349.85 KiB, 72.29 KiB gzipped), the tenant scope is safe under pooling
with regression tests that fail when it is not, and the Next.js Worker build runs in CI on Linux
because Windows will not create the symlinks the bundler needs (KI-051).
