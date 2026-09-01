/**
 * Golden fixtures for Digital Twin generation.
 *
 * Contract: plan §34 — the Phase-6 gate is "deterministic generation from golden fixture".
 *
 * These are hand-written rather than generated. A fixture produced by the code it tests proves only
 * that the code agrees with itself; these describe three real project shapes and were written by
 * reading the intake catalogue, not by running the generator and recording what it did.
 *
 * Every timestamp is fixed. A fixture containing `new Date()` would make the golden test assert that
 * the generator is deterministic *given a varying input*, which is not the claim being made.
 */

import type { IntakeField } from '@govintel/intake/schema';
import { FIELD_DEFINITIONS } from '@govintel/intake/fields';

export const FIXED_TIME = '2026-03-01T09:00:00.000Z';
export const FIXTURE_PROJECT_ID = '11111111-1111-4111-8111-111111111111';

/** Look the category up rather than restating it — a mismatch here would be a fixture bug. */
function categoryOf(fieldId: string): IntakeField['category'] {
  const definition = FIELD_DEFINITIONS.find((d) => d.id === fieldId);
  if (definition === undefined) {
    // Loud, not silent. A fixture referring to a field that no longer exists is testing nothing, and
    // would otherwise fail much later with an unrelated-looking message.
    throw new Error(`fixture references unknown intake field: ${fieldId}`);
  }
  return definition.category;
}

interface AnswerSpec {
  readonly fieldId: string;
  readonly value: unknown;
  readonly state?: IntakeField['state'];
  readonly provenance?: IntakeField['provenance'];
  readonly confidence?: IntakeField['confidence'];
}

function answer(spec: AnswerSpec): IntakeField {
  const state = spec.state ?? 'CONFIRMED';

  return {
    fieldId: spec.fieldId,
    category: categoryOf(spec.fieldId),
    value: spec.value,
    state,
    provenance: spec.provenance ?? (state === 'ASSUMED' ? 'ASSUMPTION' : 'USER_CONFIRMED'),
    confidence: spec.confidence ?? (state === 'ASSUMED' ? 'MEDIUM' : 'HIGH'),
    lastUpdatedAt: FIXED_TIME,
    ...(state === 'CONFIRMED' ? { confirmedBy: 'fixture-user' } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Fixture A — a well-answered SaaS product                                   */
/* -------------------------------------------------------------------------- */

/**
 * The case the product is designed around: someone who answered the questions.
 *
 * Should produce requirements for authentication, personal data, accessibility and availability, the
 * SaaS phase pack including tenant isolation, and the public-exposure risk — but *not* the
 * unknown-budget or single-person risks, because both are answered.
 */
export const WELL_ANSWERED_SAAS: readonly IntakeField[] = [
  answer({ fieldId: 'idea.summary', value: 'A scheduling tool sold to dental practices.' }),
  answer({ fieldId: 'objectives.primary', value: 'Cut no-show appointments by a quarter.' }),
  answer({ fieldId: 'users.primary', value: 'Practice managers and reception staff.' }),
  answer({ fieldId: 'capabilities.key', value: ['Booking', 'Reminders', 'Reporting'] }),
  answer({ fieldId: 'project.type', value: 'SAAS_WEB_APP' }),
  answer({ fieldId: 'budget.total', value: 120000 }),
  answer({ fieldId: 'budget.currency', value: 'GBP' }),
  answer({ fieldId: 'deadline.target', value: '2026-11-30' }),
  answer({ fieldId: 'deadline.fixed', value: false }),
  answer({ fieldId: 'team.size', value: 5 }),
  answer({ fieldId: 'team.skills', value: ['TypeScript', 'PostgreSQL', 'React'] }),
  answer({ fieldId: 'data.types', value: ['Account details', 'Personal data', 'Health data'] }),
  answer({ fieldId: 'security.authentication', value: true }),
  answer({ fieldId: 'accessibility.target', value: 'WCAG 2.2 AA' }),
  answer({ fieldId: 'availability.expectation', value: 'Business hours' }),
  answer({ fieldId: 'performance.expectation', value: 'Standard web responsiveness' }),
  answer({ fieldId: 'compliance.regimes', value: ['UK GDPR'] }),
];

/* -------------------------------------------------------------------------- */
/* Fixture B — a guest who answered almost nothing                            */
/* -------------------------------------------------------------------------- */

/**
 * The case that matters most, and the one most easily got wrong.
 *
 * A first-time user with an idea and nothing else. The generator must still produce something, and
 * everything it could not establish must appear as an explicit `UNKNOWN` node rather than as a
 * confident default. Plan §10: the missing-information engine's output is part of the plan.
 */
export const BARELY_ANSWERED: readonly IntakeField[] = [
  answer({ fieldId: 'idea.summary', value: 'An app for tracking allotment plots.' }),
  {
    fieldId: 'project.type',
    category: categoryOf('project.type'),
    value: null,
    state: 'UNKNOWN',
    provenance: 'USER_PROVIDED',
    confidence: 'LOW',
    lastUpdatedAt: FIXED_TIME,
  },
];

/* -------------------------------------------------------------------------- */
/* Fixture C — the risky shape                                                */
/* -------------------------------------------------------------------------- */

/**
 * One person, a fixed date, no budget, and a public-facing product.
 *
 * Every risk rule that can fire, fires — which is the point. A generator that produced a calm-looking
 * plan for this project would be actively misleading, and this fixture is what stops that regressing.
 * It also carries an `ASSUMED` field, so the assumption-node path is covered.
 */
export const RISKY_SOLO: readonly IntakeField[] = [
  answer({ fieldId: 'idea.summary', value: 'A marketplace for handmade furniture.' }),
  answer({ fieldId: 'objectives.primary', value: 'Take a hundred orders in the first quarter.' }),
  answer({ fieldId: 'project.type', value: 'ECOMMERCE' }),
  answer({ fieldId: 'deadline.fixed', value: true }),
  answer({ fieldId: 'deadline.target', value: '2026-06-30' }),
  answer({ fieldId: 'team.size', value: 1 }),
  answer({ fieldId: 'data.types', value: ['Personal data', 'Payment card data'] }),
  answer({ fieldId: 'security.authentication', value: true }),
  answer({
    fieldId: 'accessibility.target',
    value: 'WCAG 2.2 AA',
    state: 'ASSUMED',
  }),
];

/** A project type the taxonomy does not cover, to prove the fallback is not a web app by default. */
export const UNSUPPORTED_TYPE: readonly IntakeField[] = [
  answer({ fieldId: 'idea.summary', value: 'Firmware for a greenhouse controller.' }),
  answer({ fieldId: 'project.type', value: 'EMBEDDED_FIRMWARE' }),
];
