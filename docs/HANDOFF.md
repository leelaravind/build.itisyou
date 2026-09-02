# HANDOFF

Written 2026-09-02, ~02:15 London; updated ~07:40 the same morning. Mid-session. Read this first if you are picking the work up.

It exists because the scheduled wake-up that resumes this work is **session-only** — it lives in
memory and dies with the session. This file does not.

---

## What this is

`build.itisyou` — a software project intelligence, planning, execution and governance platform.
Two authoritative contracts: `MASTER_IMPLEMENTATION_PLAN.md` and
`IMPLEMENTATION_GAP_CLOSURE_SPEC.md`. Everything traces to one of them.

The owner's standing instruction is to work the implementation register top-down, autonomously,
without stopping for progress updates or routine decisions, and **not to deploy production** until
the V1 gates can genuinely pass. `build.itisyou.app` stays dark; staging is where things are verified.

---

## The register

`docs/V1_GAP_REGISTER.md` — 118 gaps that survived adversarial verification, 29 of them blockers.
Produced by a 186-agent analysis of both contracts against the implementation, each gap found by one
agent and then verified by a second prompted to refute it.

Owner's priority order:

1. lifecycle transitions — **done**
2. evidence and approvals — **done**
3. audit writes — **done** (landed with the lifecycle, because a transition is what needs one)
4. authentication and identity — **largely done**, see below
5. remaining gate-blocking implementations
6. remaining V1 register items by dependency and risk

---

## What is done and verified on staging

| | |
|---|---|
| Lifecycle | 12 states, 12 edges, central validation, 166 golden tests covering all 144 ordered pairs |
| Evidence and approvals | 17 MANUAL gate criteria are now satisfiable; they were permanently unsatisfiable before |
| Audit | The first audit events this system has ever written, in the same transaction as the change |
| Concurrency | `projects.version` increments; `WHERE version = ?` guards transitions |
| Sessions | gap-spec §6.3's eight controls, idle + absolute timeouts, server-side revocation |
| OIDC | Provider-neutral, PKCE/state/nonce, 19 attack-case tests against a real generated key pair |
| CSRF | Explicit origin check; verified live — cross-origin 403, no-origin 403, same-origin 200 |
| Cookie signing | `SESSION_SECRET` now signs what its comment always claimed it signed |
| Rules → gates | 51–62 rule-emitted criteria per project now reach the gates; before, all 73 were discarded |
| Evidence artefacts | R2 upload and download, §35's controls applied to the real bytes, hash recorded |
| Sign-in, end to end | Five journeys against a mock issuer run as a separate process |
| Rate limiting | Eighteen tests, including a drift guard that reads the call sites out of the source |

Roughly 2,290 unit tests. Full E2E runs against the deployed staging environment.

---

## Immediate next tasks

Continue the register top-down. The two CI-only failures from the new surfaces are closed: the
`getByRole('alert')` strict-mode violation and all 13 axe violations on the plan page.

### Three things found after the register was written

None was in it, and each was found by running something rather than by reading anything.

**Signing in emptied the product.** `currentOrganizationId` read only the guest cookie, so a
signed-in caller resolved to no tenant and row-level security returned nothing — every project,
answer, twin node and evidence row invisible. Twelve ownership checks separately refused any project
that had been *claimed*, because claiming sets `guest_session_id` to NULL. And a signed-in user could
not start a project at all. All three are the same assumption: guest-first written as guest-only.
Now one rule in `apps/web/src/lib/server/project-access.ts`.

**The rules could not fail a gate.** The evaluator produced 73 gate criteria and every caller threw
them away, so none of 287 rules could stop a project advancing. `gatesWith()` folds them in;
`evaluateForProject` is the single place the engine is run.

**No icon was rendering.** See below.

### The icons were never rendering

Worth knowing about because of how long it survived. `MaterialIcon` wrote the icon's *name* into a
span and relied on a ligature font to turn it into a glyph. No `@font-face`, no font file, and the
class was undefined - so every icon on all 50 screens drew its own name in the body font. The header
brand mark read `settings_suggest`.

Nothing caught it. Icons are `aria-hidden`, so axe steps over them; the E2E suites address the
product by role and by text, both of which stayed correct. The only symptom that reached a test was
six pixels of horizontal overflow on `/login` at phone width.

The geometry is now inlined at build time by `scripts/generate-icons.mjs` (`pnpm icons`), from the
`@material-symbols/svg-400` devDependency, and `MaterialIcon` takes `keyof` the generated set - so an
icon that does not exist fails to compile. `pnpm icons --check` runs inside `docs:check`.

**There is no web font in this product, deliberately.** Nothing should fetch one; the CSP forbids it
(KI-007) and plan §19 rules it out.

---

## How to build and deploy

**The build does not work on Windows.** The OpenNext bundler creates symlinks and Windows refuses
them without Developer Mode (KI-051). It runs under WSL against an isolated tree:

Sync and build **without** `XDG_CONFIG_HOME`. Setting it here is what produces the SQLite
"disk I/O error" described in the traps below:

```bash
wsl -e bash -lc "export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; export CI=true; \
  export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://127.0.0.1:5432/unused-local-emulation-only'; \
  cd /mnt/e/Project/build && tar --exclude=node_modules --exclude=.git --exclude=.next \
    --exclude=.open-next --exclude=.pglite --exclude=dist --exclude=coverage \
    --exclude=test-results --exclude=playwright-report --exclude='.env*' --exclude=.wrangler \
    --exclude='.claude/skills' -cf - . | (cd /mnt/e/Project/build-wsl && tar -xf -) && \
  cd /mnt/e/Project/build-wsl && pnpm install --frozen-lockfile && \
  pnpm --filter=@govintel/web cf:build"
```

Then deploy. `XDG_CONFIG_HOME` points at `/home/kplee/xdg.config`, which holds a copy of wrangler's
credentials **and** a copy of `~/.config/pnpm/config.yaml` — both are needed, for the reason in the
traps below:

```bash
SHA=$(git rev-parse --short HEAD)
wsl -e bash -c "export PATH=/home/kplee/.nvm/versions/node/v22.23.2/bin:\$PATH; \
  export XDG_CONFIG_HOME=/home/kplee/xdg.config; \
  export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://127.0.0.1:5432/unused-local-emulation-only'; \
  cd /mnt/e/Project/build-wsl/apps/web && npx wrangler deploy --env staging \
    --var APP_VERSION:0.1.0-staging.$SHA --var APP_COMMIT:$SHA"
```

Use `bash -c`, not `bash -lc`. The login shell fails to start a systemd user session and can hang for
minutes before doing anything; sourcing nvm by path avoids it entirely.

Traps, each of which cost real time:

- **`build-wsl` is a separate tree on E:, deliberately.** Running Linux pnpm against the Windows
  `node_modules` rewrites its links and breaks the Windows checkout. It lives on E: because **C: has
  only ~13 GB free** and the owner asked that it not be filled.
- **`opennextjs-cloudflare deploy` does not rebuild.** Syncing source and deploying ships the
  *previous* bundle, silently and successfully. Always `cf:build` first. This happened: a deploy
  reported commit `1180375` while serving an older bundle, because `APP_VERSION` is a label passed by
  hand and not evidence of what is inside.
- **`ERR_SQLITE_ERROR: disk I/O error`** during any pnpm install, including the one
  `opennextjs-cloudflare deploy` runs for itself. **The pnpm store has landed on drvfs**, where
  SQLite cannot take file locks, so it reports a disk error on a filesystem with 953 GB free.

  The repository's own `.npmrc` sets `store-dir=E:/.pnpm-store/v11` — deliberately, because C: has
  only ~13 GB free — and under WSL that Windows path is `/mnt/e/...`, which is drvfs. What normally
  saves you is `~/.config/pnpm/config.yaml` overriding it with `/home/kplee/.pnpm-store` on ext4.
  Redirect `XDG_CONFIG_HOME` and pnpm stops finding that file, falls back to the repository's value,
  and fails.

  So the fix is not to avoid `XDG_CONFIG_HOME` — the deploy needs it for wrangler's credentials — but
  to make sure whatever it points at contains **both** `.wrangler/` and `pnpm/config.yaml`. Check it
  in one command: `pnpm store path` must print a path under `/home`, never under `/mnt`.

  Recorded twice before with the wrong cause: first as a corrupt store index to delete, then as
  "never set `XDG_CONFIG_HOME`". Both were places the symptom appeared.
- The deploy path needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` even though it
  never connects to it. Give it a **credential-free placeholder**, never a real DSN.

---

## Infrastructure

| Resource | Value |
|---|---|
| GitHub | `leelaravind/build.itisyou`, private. CI runs on every push |
| Cloudflare account | `a0365f6aaae5fe32b3fdb8fa08fd000c`; zone `itisyou.app` active |
| Staging Worker | `govintel-web-staging` → https://govintel-web-staging.kpleelaaravind.workers.dev |
| Staging Hyperdrive | `fa38480586e44cebab20fe15ac2121a0`, **caching disabled** |
| Production Worker | `build-itisyou-web-production`, configured for `build.itisyou.app`, **not deployed** |
| Production Hyperdrive | `c697deee65094523ac73e77dc94b9fd0`, **caching disabled** |
| Neon staging | project `tiny-mode-81422275`, branch `staging` |
| Neon production | project `fragrant-fog-40333847`, branch `production` |
| Outbox Worker | `govintel-worker-staging`, cron every minute (drain + guest expiry purge) |

**Caching is disabled on both Hyperdrive configs as a security control, not a preference** — see
SEC-003b and KI-050. Under RLS two tenants issue byte-identical queries.

### Credentials

Live DSNs and the app-role passwords are in this session's scratchpad, which is temporary:

```
C:\Users\kplee\AppData\Local\Temp\claude\E--Project-build\<session>\scratchpad\
  staging.dsn  staging-app.dsn  staging-app.pw
  prod-owner.dsn  prod-app.dsn  prod-app.pw
```

If they are gone, regenerate: `npx neon connection-string <branch> --project-id <id>` for the owner
DSN, then `APP_ROLE_PASSWORD=<new> pnpm migrate` to reset the application role's password.

---

## Two things about the database that are easy to get wrong

**The application connects as `govintel_app`, never as the owner.** Neon's `neondb_owner` is not a
superuser and *does* have `rolbypassrls`, so connecting as it makes every RLS policy inert while
leaving it visible in the catalogue. `assertRestrictedRole` refuses to serve as a role that can
bypass, own or disable RLS. A role created through the **Neon API** comes back with `BYPASSRLS`,
`CREATEDB` and `CREATEROLE` whatever you asked for — it must be created in SQL by the owner, which
`scripts/migrate.mjs` does.

**Guest sessions own an organisation.** Guest projects used to carry a NULL tenant key, which put
every guest row outside every RLS policy — unreadable and unwritable under a restricted role, and
protected by nothing while running as the owner. See KI-063.

### Changing the schema

The fingerprint changes, and the application refuses to serve against a schema it does not recognise.
Rebuild both databases:

```bash
# as owner: DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO neondb_owner;
APP_ROLE_PASSWORD=<pw> DATABASE_URL_UNPOOLED=<owner dsn> pnpm migrate
APP_ENV=staging DATABASE_URL_UNPOOLED=<app dsn> pnpm verify:isolation   # must be 6/6
```

---

## Gates

```
pnpm format:check  pnpm lint  pnpm typecheck  pnpm docs:check
pnpm test          pnpm scan:secrets  pnpm audit:deps  pnpm build
pnpm verify:isolation                      # needs APP_ENV=staging and a real pooled Postgres
E2E_BASE_URL=<staging url> pnpm test:e2e   # the one that counts
```

CI runs all of them. The isolation gate runs in CI against `postgres:17-alpine`, **as the restricted
role** — connected as a superuser it would pass for the wrong reason.

---

## House rules that are not negotiable

- Never weaken a valid failing test to make a gate green. Fix the root cause.
- An unmeasured claim is a hypothesis. Measure it, then say the number.
- Verify the verifier: plant the defect, watch the test fail, restore.
- If a document asserts something, check it is still true. Two were found asserting things that were
  not — a threat model citing tests in a package that does not exist, and a runbook describing a mock
  OIDC provider that was never built.
- Do not deploy production. The owner approved it only once the V1 gates can genuinely pass, and they
  cannot yet.

## The one owner-only action outstanding

Registering a redirect URI with a real OIDC provider, to obtain a `client_id` and `client_secret`.
Everything else in the sign-in flow is built and **now verified end to end**: five journeys run
against `e2e/support/mock-oidc.mjs`, a separate process speaking OIDC that the application cannot
distinguish from a real one. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and
`OIDC_REDIRECT_URI` and it works; unset, the login page says so and guest-first carries the whole
product.

That verification is worth more than it looks: the journeys found three defects on their first run,
each of them fatal to the signed-in experience and none visible to a unit test.
