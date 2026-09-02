# DATABASE MIGRATION POLICY

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §50; `MASTER_IMPLEMENTATION_PLAN.md` Phase 18.

Hand-written rather than generated, unlike most documents in `docs/`. The generated ones describe
code, and this describes a **procedure people follow** — generating it from a constant would produce
something that looks authoritative and is enforced by nothing.

Where it is enforceable, it is enforced. `packages/db/src/client.ts` carries a SHA-256 fingerprint of
the DDL and refuses to start against a database it does not recognise, and `pnpm test` fails when the
Drizzle schema and the DDL disagree. Those two checks are the parts of this policy a machine can hold.

---

## 1. Additive first

A migration adds; it does not change or remove in the same step.

Adding a nullable column, a new table or a new index is safe against running code, because code that
does not know about it is unaffected. Renaming or dropping is not: for the duration of a deployment
two versions of the application are running, and one of them is holding a query against the old shape.

The sequence for anything destructive is therefore three deployments, not one:

1. **Add** the new shape. Both shapes exist.
2. **Move** — write to both, read from the new one, backfill the old rows. Both shapes still exist,
   and either version of the application works.
3. **Remove** the old shape, once nothing reads it.

Each step is separately reversible, which is the whole reason for the shape. A single migration that
renames a column has one recovery path, and it is a restore.

### What "safe against running code" does not cover here

§1 is true of the database and not currently true of this application. `packages/db` carries a
SHA-256 fingerprint of the DDL and **refuses to serve against a shape it does not recognise** — an
exact match, not a compatibility check. So even a purely additive migration is a hard cutover for
this system: the moment it lands, the running release stops serving until a build that knows the new
fingerprint is deployed.

That is a deliberate trade and worth stating rather than discovering. The fingerprint turns "the
database is a different shape" from a silent wrong answer into a refusal, which is the right default
for a system that has no migrations. Now that written migrations exist, it is also the thing
preventing the rolling deployment §1 describes.

Closing it properly means the fingerprint check accepting a *set* of known-compatible shapes rather
than one — the current shape and any it can be migrated from — so a release can serve both across a
deployment. Until then: **migrate and deploy back to back, and expect a gap**. Build the artefact
first, so the gap is the length of a deploy rather than the length of a build.

## 2. Backfill separately

A migration that rewrites a million rows holds locks for as long as it takes, and the deployment that
triggered it cannot complete until it does.

Backfills run as their own operation: batched, resumable, and interruptible without leaving the data
half-converted. That is why step 2 above writes to both shapes — the backfill can stop and restart
without anything depending on it having finished.

## 3. Dual read and write, only where needed

Reading from two places is genuinely expensive to get right, and every dual-read window is a period
where two answers exist and something has to decide which wins.

So it is used only where the alternative is downtime: a type change on a column something reads on
every request, or a table split. For a new nullable column it is unnecessary, and adding it anyway
means paying the complexity without the reason.

## 4. Destructive only after a safe transition

Nothing is dropped in the same release that stops using it.

The gap between "no code reads this" and "this is deleted" is what makes a rollback possible. A
release that removes a column and is then rolled back leaves the previous version querying something
that no longer exists — and the rollback, which was supposed to be the safe move, becomes the outage.

One full release cycle of separation, minimum.

## 5. Tested against a production-like fixture

A migration tested only against an empty database has been tested against the case it cannot fail.

What matters in a fixture is not row count but **shape**: null values in columns nobody expected to be
null, rows that predate a constraint, encodings from an older client, and the specific duplicate that
made somebody add the unique index in the first place. Those are what a migration trips over.

`packages/db` runs its schema tests against PGlite, which is real Postgres — the same parser, the same
constraint semantics, the same failure messages. A migration that passes there has been tested against
Postgres rather than against an abstraction of it.

## 6. Reconciliation

After a migration, something checks that the data means what it did before.

Row counts are the weakest possible version of this and are still worth having, because they catch the
worst outcome. Better ones are specific: the sum of a column, the count of distinct values, a sample
of rows compared field by field. Any check somebody would have to think about to fake.

The schema fingerprint is the automated half. `SCHEMA_FINGERPRINT` is a hash of the DDL and the
row-level security policies, compared on boot, and a database that does not match it refuses to be
used rather than being quietly upgraded — see KI-026, which is the incident that produced it.

## 7. Rollback or forward-fix, decided in advance

Every migration is written with one of these chosen **before** it runs, because deciding under
pressure produces the wrong answer reliably.

**Rollback** is available when the migration is additive and nothing has written to the new shape.
Reversing it costs nothing and loses nothing.

**Forward-fix** is the only option once anything has written data the old shape cannot represent.
Attempting a rollback then destroys the writes that happened in between — and those writes are
somebody's work, made after the deployment, in good faith.

The decision is recorded in the migration itself. A migration that does not say which one applies has
implicitly chosen "decide during the incident".

---

## What is enforced automatically

| Rule | Enforcement |
|---|---|
| Schema matches the DDL | `SCHEMA_FINGERPRINT` compared on boot; a mismatch refuses to start (KI-026) |
| DDL matches the Drizzle schema | `packages/db/test/schema-drift.test.ts` — 13 tests, verified by deleting a table |
| Row-level security still applies | Tenant isolation tests under a `NOSUPERUSER` role (SEC-001) |
| Rebuild is refused in a deployed environment | `rebuildSchema` throws when `APP_ENV` is not local |

## What is not, and cannot be

The additive-first sequence, the backfill separation, the fixture shape and the rollback decision are
procedural. A machine cannot tell whether a fixture contains the rows that will break the migration,
and a policy claiming otherwise would be the same kind of false assurance this platform refuses
everywhere else.

What the automation does is narrower and real: it makes a schema that has drifted from the code
impossible to run against, so the class of failure where nobody notices for three weeks cannot happen.
