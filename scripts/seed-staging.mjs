#!/usr/bin/env node
/**
 * Generate the staging fixture.
 *
 * Staging data is synthetic. Restoring a production snapshot into staging is the most common way
 * personal data ends up somewhere its retention rules do not reach and its access controls are
 * weaker — and it is convenient precisely because it is realistic, which is what makes it dangerous
 * rather than what makes it acceptable.
 *
 * What testing actually needs from staging data is **shape**: a solo project and a twelve-person one,
 * a project with failing gates, an archived one, a restricted one. The shapes are what exercise the
 * code. The contents are not, and a generated fixture supplies the first without the second.
 *
 * Deterministic, so two runs produce the same fixture and a failure in staging can be reproduced
 * locally rather than described.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'fixtures', 'staging.json');

/**
 * Names that are obviously not real people.
 *
 * Deliberately not a realistic name generator. A fixture full of plausible names is one somebody
 * eventually mistakes for real data — when deciding whether a screenshot can be shared, or whether a
 * table can be exported. Names nobody could mistake remove that question entirely.
 */
const PEOPLE = ['Fixture One', 'Fixture Two', 'Fixture Three', 'Fixture Four', 'Fixture Five'];

/** Project shapes worth having, and what each exercises. */
const SHAPES = [
  {
    key: 'solo',
    name: 'Fixture: solo project',
    exercises:
      'The one-person hierarchy collapse, and the rule that a solo project reports no unassigned work.',
    teamSize: 1,
    health: 'HEALTHY',
    archived: false,
    restricted: false,
  },
  {
    key: 'team',
    name: 'Fixture: twelve-person delivery',
    exercises: 'The full hierarchy, workstream selection, and cross-project resource load.',
    teamSize: 12,
    health: 'WATCH',
    archived: false,
    restricted: false,
  },
  {
    key: 'failing',
    name: 'Fixture: failing gates',
    exercises:
      'Gate failure propagation into release readiness and closure, and the exception path.',
    teamSize: 4,
    health: 'CRITICAL',
    archived: false,
    restricted: false,
  },
  {
    key: 'archived',
    name: 'Fixture: archived project',
    exercises: 'Read-only behaviour, and that an archived project sorts last regardless of health.',
    teamSize: 3,
    health: 'CRITICAL',
    archived: true,
    restricted: false,
  },
  {
    key: 'restricted',
    name: 'Fixture: restricted project',
    exercises:
      'The partial-view path: visible to members with an explicit project role, absent for everybody else.',
    teamSize: 2,
    health: 'HEALTHY',
    archived: false,
    restricted: true,
  },
];

const fixture = {
  /*
   * Stamped by the caller rather than read from a clock, so the fixture is byte-identical between
   * runs. A fixture that differs every time cannot be diffed, and a diff is how somebody notices that
   * the seed changed when they did not expect it to.
   */
  generatedFor: process.env.APP_ENV ?? 'staging',
  warning:
    'Synthetic data. Contains no real people, organisations or projects. Never seed staging from a production snapshot: it moves personal data somewhere its retention rules do not reach and its access controls are weaker.',
  organizations: [
    { id: 'fixture-org-1', name: 'Fixture Organisation A' },
    { id: 'fixture-org-2', name: 'Fixture Organisation B' },
  ],
  people: PEOPLE.map((name, index) => ({
    id: `fixture-user-${String(index + 1)}`,
    name,
    email: `fixture-${String(index + 1)}@example.invalid`,
  })),
  projects: SHAPES.map((shape, index) => ({
    id: `fixture-project-${shape.key}`,
    // Two organisations, so cross-tenant isolation has something to be tested against. A single-org
    // fixture makes every isolation test pass by having nothing to leak.
    organizationId: index % 2 === 0 ? 'fixture-org-1' : 'fixture-org-2',
    ...shape,
  })),
};

writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

console.log(
  `Wrote fixtures/staging.json — ${String(fixture.projects.length)} projects across ${String(fixture.organizations.length)} organisations, all synthetic.`,
);
