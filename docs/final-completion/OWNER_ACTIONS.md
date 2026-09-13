# Owner actions

Only what Claude Code genuinely cannot do: an account it does not hold, a secret it must not invent,
a billing decision, or a destructive action on something it did not create. Everything else in the
product has been done or is in `COMPLETION_REGISTER.md` with a next step.

## 1. Create an OIDC client with an identity provider — blocks sign-in and production

| | |
|---|---|
| Why | Sign-in is built and tested end to end against a local mock issuer (PKCE, state, nonce, JWKS validation, sessions, guest adoption under row-level security). No provider client exists for any environment, so no real person can sign in. Gap-spec §6.2 requires one production login method. |
| Where | Any standards-compliant OIDC provider you choose (Auth0, Microsoft Entra ID, Google Identity, Okta, Keycloak…). The code is provider-neutral: identity is keyed on `(issuer, subject)`. |
| Create | A "regular web application" / confidential client, authorization-code flow with PKCE, scopes `openid email profile`. |
| Redirect URIs to register | `https://govintel-web-staging.kpleelaaravind.workers.dev/auth/callback` and `https://build.itisyou.app/auth/callback` |
| Values needed | `OIDC_ISSUER` (the issuer URL, not secret) · `OIDC_CLIENT_ID` (not secret) · `OIDC_CLIENT_SECRET` (**secret**) · `OIDC_REDIRECT_URI` (one of the two URIs above, per environment, not secret) |
| Where to store | Never in the repository. From `apps/web`: `npx wrangler secret put OIDC_CLIENT_SECRET --env staging`, and the same for `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI` (secrets are fine for all four; they are read from the environment). Repeat with `--env production`. |
| Verify | `/login` offers "Continue to your identity provider"; sign in; you land on `/portfolio` signed in with a "Sign out" button; a guest project started beforehand appears in "Your projects". Then run `pnpm test:e2e e2e/auth.spec.ts` locally — it still uses the mock and must stay green. |

## 2. Decide the database plan for production — capacity risk

| | |
|---|---|
| Why | Staging's Neon project (free plan) exhausted its 100 CU-hours in ten days and has been **suspended until 2026-10-01**; Neon does not bill past the free quota, it stops the database. The cause (a per-minute cron) is fixed and budgeted by a test, but production on the free plan still has a hard monthly ceiling and no spending alert. |
| Where | Neon console → organisation `org-twilight-tree-13265312` → project `build.itisyou` (`fragrant-fog-40333847`) → Billing. |
| Choice | Stay on Free (hard stop at 100 CU-hours/project/month) or move to Launch (pay per use, about $0.106 per CU-hour; a 0.25 CU compute awake 3 hours a day costs well under $3/month). |
| Secret? | No. |
| Verify | Neon console shows the plan; on Launch, set a spending notification. |

## 3. Optional: delete the suspended staging project

| | |
|---|---|
| Why | `tiny-mode-81422275` (`project-staging`) is suspended for quota until 2026-10-01 and is no longer used: staging now runs on `silent-forest-67621251` (`build-itisyou-staging`). It holds only test data. Deleting a database is destructive and was not done autonomously. |
| Where | Neon console → project `project-staging` → Settings → Delete project. |
| Verify | `Hyperdrive fa38480586e44cebab20fe15ac2121a0` still points at `ep-snowy-silence-zakx92wv` (it does), and staging `/api/health` still reports `NORMAL`. |

## 4. Optional: delete the restore-drill branch

| | |
|---|---|
| Why | The 2026-09-13 restore drill left branch `restore-drill-20260913` (`br-patient-surf-zafipp5p`) with endpoint `ep-green-truth-zaofi0r4` in `silent-forest-67621251`. It holds a 09:59Z copy of staging test data and suspends when idle, so it costs nothing, but a restored copy left lying about is a second, unmonitored copy of the data. Its snapshot and the `endpoint-parking` branch expire on their own on 2026-09-14. |
| Where | Neon console → `build-itisyou-staging` → Branches → `restore-drill-20260913` → Delete. |
| Verify | `staging` is still the default branch and staging `/api/health` reports `NORMAL`. |

## Not owner actions

- **Production deployment** is approved by the contract once the release gates are genuinely green.
  It is currently blocked by item 1 and by the open P1 items in `COMPLETION_REGISTER.md`, which are
  engineering work, not owner work.
- **The custom domain** `build.itisyou.app` is already configured on the production Worker route
  (`custom_domain = true`) in a zone the account holds; deploying attaches it.
