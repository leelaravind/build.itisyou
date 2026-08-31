# PERMISSIONS MATRIX

> **Generated file — do not edit by hand.**
> Source of truth: `packages/db/src/rbac.ts`. Regenerate with `pnpm docs:permissions`.
> CI runs `pnpm docs:permissions --check` and fails if this file has drifted from the code.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §7.4 (explicit matrix covering every sensitive
action), `MASTER_IMPLEMENTATION_PLAN.md` §18 (server-side authorisation, least privilege,
object-level authorisation), §83 (authorisation must remain deterministic).

## Evaluation rules

1. **Deny by default.** Anything not explicitly granted is denied. A permission added to the enum
   but forgotten in the matrix is therefore denied rather than granted — the safe direction for an
   oversight.
2. **Organisation and project grants combine as a union**, not as a maximum of two independent
   answers. An organisation `ADMIN` who is only a `VIEWER` on a project still holds admin
   authority over it, because organisation admin *is* a grant over the tenant's projects.
3. **Tenant scope is checked separately and first.** Holding a permission never implies access to
   another organisation's data; see `packages/db/src/tenancy.ts`.
4. **Guest permissions are not a role.** They apply only to a project the guest's own session owns,
   and ownership is verified independently.

## Organisation roles

| Permission | OWNER | ADMIN | MEMBER | AUDITOR |
|---|:-:|:-:|:-:|:-:|
| `project:create` | ✅ | ✅ | ✅ | · |
| `project:read` | ✅ | ✅ | ✅ | ✅ |
| `project:edit` | ✅ | ✅ | · | · |
| `project:archive` | ✅ | ✅ | · | · |
| `project:delete` | ✅ | · | · | · |
| `project:export` | ✅ | ✅ | · | · |
| `project:transition_lifecycle` | ✅ | ✅ | · | · |
| `intake:edit` | ✅ | ✅ | · | · |
| `ai_import:create` | ✅ | ✅ | · | · |
| `ai_import:approve` | ✅ | ✅ | · | · |
| `requirements:read` | ✅ | ✅ | · | ✅ |
| `requirements:edit` | ✅ | ✅ | · | · |
| `architecture:read` | ✅ | ✅ | · | ✅ |
| `architecture:edit` | ✅ | ✅ | · | · |
| `work:read` | ✅ | ✅ | · | ✅ |
| `work:edit` | ✅ | ✅ | · | · |
| `risks:read` | ✅ | ✅ | · | ✅ |
| `risks:edit` | ✅ | ✅ | · | · |
| `budget:read` | ✅ | ✅ | · | ✅ |
| `budget:edit` | ✅ | ✅ | · | · |
| `evidence:read` | ✅ | ✅ | · | ✅ |
| `evidence:upload` | ✅ | ✅ | · | · |
| `evidence:delete` | ✅ | ✅ | · | · |
| `gate:read` | ✅ | ✅ | · | ✅ |
| `gate:approve` | ✅ | ✅ | · | · |
| `gate:override` | ✅ | ✅ | · | · |
| `exception:request` | ✅ | ✅ | · | · |
| `exception:approve` | ✅ | ✅ | · | · |
| `baseline:create` | ✅ | ✅ | · | · |
| `change_request:create` | ✅ | ✅ | · | · |
| `change_request:approve` | ✅ | ✅ | · | · |
| `approval:decide` | ✅ | ✅ | · | · |
| `deployment:record` | ✅ | ✅ | · | · |
| `members:read` | ✅ | ✅ | ✅ | ✅ |
| `members:manage` | ✅ | ✅ | · | · |
| `integrations:manage` | ✅ | ✅ | · | · |
| `audit:read` | ✅ | ✅ | · | ✅ |
| `organization:manage` | ✅ | · | · | · |

## Project roles

| Permission | PROJECT_OWNER | PROJECT_MANAGER | ENGINEER | REVIEWER | APPROVER | VIEWER | GUEST |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `project:create` | · | · | · | · | · | · | ✅ |
| `project:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project:edit` | ✅ | ✅ | · | · | · | · | ✅ |
| `project:archive` | ✅ | · | · | · | · | · | · |
| `project:delete` | · | · | · | · | · | · | · |
| `project:export` | ✅ | ✅ | · | · | · | · | · |
| `project:transition_lifecycle` | ✅ | ✅ | · | · | · | · | · |
| `intake:edit` | ✅ | ✅ | · | · | · | · | ✅ |
| `ai_import:create` | ✅ | ✅ | · | · | · | · | ✅ |
| `ai_import:approve` | ✅ | ✅ | · | · | · | · | · |
| `requirements:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `requirements:edit` | ✅ | ✅ | ✅ | · | · | · | · |
| `architecture:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `architecture:edit` | ✅ | ✅ | ✅ | · | · | · | · |
| `work:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `work:edit` | ✅ | ✅ | ✅ | · | · | · | · |
| `risks:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `risks:edit` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| `budget:read` | ✅ | ✅ | · | · | ✅ | · | ✅ |
| `budget:edit` | ✅ | ✅ | · | · | · | · | · |
| `evidence:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `evidence:upload` | ✅ | ✅ | ✅ | · | · | · | · |
| `evidence:delete` | ✅ | · | · | · | · | · | · |
| `gate:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `gate:approve` | ✅ | · | · | · | ✅ | · | · |
| `gate:override` | · | · | · | · | · | · | · |
| `exception:request` | ✅ | ✅ | ✅ | · | · | · | · |
| `exception:approve` | ✅ | · | · | · | ✅ | · | · |
| `baseline:create` | ✅ | ✅ | · | · | · | · | · |
| `change_request:create` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| `change_request:approve` | ✅ | · | · | · | ✅ | · | · |
| `approval:decide` | ✅ | · | · | · | ✅ | · | · |
| `deployment:record` | ✅ | ✅ | · | · | · | · | · |
| `members:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `members:manage` | · | · | · | · | · | · | · |
| `integrations:manage` | · | · | · | · | · | · | · |
| `audit:read` | ✅ | ✅ | · | · | ✅ | · | · |
| `organization:manage` | · | · | · | · | · | · | · |

## Read-only permissions

These 10 permissions carry no write authority. `AUDITOR` is granted exactly this
set and nothing else, so an auditor never needs a write grant merely to inspect.

- `project:read`
- `requirements:read`
- `architecture:read`
- `work:read`
- `risks:read`
- `budget:read`
- `evidence:read`
- `gate:read`
- `members:read`
- `audit:read`

## Separation of duties

Deliberate exclusions, each of which would defeat a control if granted:

| Role | Cannot | Why |
|---|---|---|
| `ENGINEER` | approve a gate, decide an approval, approve an exception or change request | Gap-spec §33 keeps approval separate from task completion. Self-approval is not a control. |
| `APPROVER` | edit requirements, architecture, work or budget | An approver who can edit what they approve makes approval theatre. |
| any project role | `gate:override` | Overriding a failed gate is a governance escape hatch and belongs to organisation administrators. |
| `ADMIN` | `project:delete`, `organization:manage` | The two actions with no undo stay with `OWNER`. |
| `ENGINEER` | `budget:read` | Commercial data is routinely restricted from engineers. An organisation wanting otherwise grants it at organisation level rather than widening the role. |
| guest | `evidence:upload` | Accepting file uploads before signup opens a malware surface with no accountable owner. |

## Coverage

- Permissions defined: **38**
- Organisation roles: **4** (OWNER, ADMIN, MEMBER, AUDITOR)
- Project roles: **6** (PROJECT_OWNER, PROJECT_MANAGER, ENGINEER, REVIEWER, APPROVER, VIEWER)
- Permissions available to a guest: **10**

Every permission is exercisable by at least one role, and every grant references a declared
permission — both asserted in `packages/db/test/rbac.test.ts`.
