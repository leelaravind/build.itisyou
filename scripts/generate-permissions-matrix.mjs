#!/usr/bin/env node
/**
 * Generate `docs/PERMISSIONS_MATRIX.md` from the RBAC source.
 *
 * Contract: gap-spec §7.4 requires an explicit permissions matrix covering every sensitive action.
 *
 * Generated rather than hand-written, because a hand-written authorisation matrix drifts from the
 * code — and a drifted security document is worse than none: it tells a reviewer the system behaves
 * one way while it behaves another. `pnpm docs:permissions --check` fails CI if the committed file
 * no longer matches the code, so the document cannot silently go stale.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

const OUTPUT = join(process.cwd(), 'docs', 'PERMISSIONS_MATRIX.md');

// The RBAC module is TypeScript; strip types at import time rather than adding a build step.
register('data:text/javascript,', pathToFileURL('./'));

const { PERMISSIONS, organizationGrants, projectGrants, guestCan, isReadPermission } = await import(
  pathToFileURL(join(process.cwd(), 'packages/db/src/rbac.ts')).href
);
const { organizationRoleEnum, projectRoleEnum } = await import(
  pathToFileURL(join(process.cwd(), 'packages/db/src/schema.ts')).href
);

const ORG_ROLES = organizationRoleEnum.enumValues;
const PROJECT_ROLES = projectRoleEnum.enumValues;

const mark = (granted) => (granted ? '✅' : '·');

function table(roles, grantsFor, guestColumn) {
  const header = ['Permission', ...roles, ...(guestColumn ? ['GUEST'] : [])];
  const rows = PERMISSIONS.map((permission) => {
    const cells = roles.map((role) => mark(grantsFor(role).includes(permission)));
    if (guestColumn) cells.push(mark(guestCan(permission)));
    return [`\`${permission}\``, ...cells];
  });

  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map((_, i) => (i === 0 ? '---' : ':-:')).join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

const readOnly = PERMISSIONS.filter(isReadPermission);

const content = `# PERMISSIONS MATRIX

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/db/src/rbac.ts\`. Regenerate with \`pnpm docs:permissions\`.
> CI runs \`pnpm docs:permissions --check\` and fails if this file has drifted from the code.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §7.4 (explicit matrix covering every sensitive
action), \`MASTER_IMPLEMENTATION_PLAN.md\` §18 (server-side authorisation, least privilege,
object-level authorisation), §83 (authorisation must remain deterministic).

## Evaluation rules

1. **Deny by default.** Anything not explicitly granted is denied. A permission added to the enum
   but forgotten in the matrix is therefore denied rather than granted — the safe direction for an
   oversight.
2. **Organisation and project grants combine as a union**, not as a maximum of two independent
   answers. An organisation \`ADMIN\` who is only a \`VIEWER\` on a project still holds admin
   authority over it, because organisation admin *is* a grant over the tenant's projects.
3. **Tenant scope is checked separately and first.** Holding a permission never implies access to
   another organisation's data; see \`packages/db/src/tenancy.ts\`.
4. **Guest permissions are not a role.** They apply only to a project the guest's own session owns,
   and ownership is verified independently.

## Organisation roles

${table(ORG_ROLES, organizationGrants, false)}

## Project roles

${table(PROJECT_ROLES, projectGrants, true)}

## Read-only permissions

These ${readOnly.length} permissions carry no write authority. \`AUDITOR\` is granted exactly this
set and nothing else, so an auditor never needs a write grant merely to inspect.

${readOnly.map((p) => `- \`${p}\``).join('\n')}

## Separation of duties

Deliberate exclusions, each of which would defeat a control if granted:

| Role | Cannot | Why |
|---|---|---|
| \`ENGINEER\` | approve a gate, decide an approval, approve an exception or change request | Gap-spec §33 keeps approval separate from task completion. Self-approval is not a control. |
| \`APPROVER\` | edit requirements, architecture, work or budget | An approver who can edit what they approve makes approval theatre. |
| any project role | \`gate:override\` | Overriding a failed gate is a governance escape hatch and belongs to organisation administrators. |
| \`ADMIN\` | \`project:delete\`, \`organization:manage\` | The two actions with no undo stay with \`OWNER\`. |
| \`ENGINEER\` | \`budget:read\` | Commercial data is routinely restricted from engineers. An organisation wanting otherwise grants it at organisation level rather than widening the role. |
| guest | \`evidence:upload\` | Accepting file uploads before signup opens a malware surface with no accountable owner. |

## Coverage

- Permissions defined: **${PERMISSIONS.length}**
- Organisation roles: **${ORG_ROLES.length}** (${ORG_ROLES.join(', ')})
- Project roles: **${PROJECT_ROLES.length}** (${PROJECT_ROLES.join(', ')})
- Permissions available to a guest: **${PERMISSIONS.filter(guestCan).length}**

Every permission is exercisable by at least one role, and every grant references a declared
permission — both asserted in \`packages/db/test/rbac.test.ts\`.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing = '';
  try {
    existing = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('docs/PERMISSIONS_MATRIX.md is missing. Run `pnpm docs:permissions`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/PERMISSIONS_MATRIX.md is out of date with packages/db/src/rbac.ts.\n' +
        'Run `pnpm docs:permissions` and commit the result.',
    );
    process.exit(1);
  }

  console.log('Permissions matrix is up to date.');
} else {
  writeFileSync(OUTPUT, content, 'utf8');
  console.log(`Wrote ${OUTPUT} (${String(PERMISSIONS.length)} permissions).`);
}
