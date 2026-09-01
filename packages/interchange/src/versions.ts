/**
 * Interchange version identifiers.
 *
 * Contract: `MASTER_IMPLEMENTATION_PLAN.md` §11 — "Separate versions: interchange schema version,
 * prompt template version, ruleset version, validator version, project version. **Do not merge them
 * into one version.**"
 *
 * They are separate because they change for unrelated reasons and at unrelated rates:
 *
 * - The **schema** changes when the shape of an accepted response changes. Bumping it invalidates
 *   payloads produced against the old shape, so it is the one a user can actually be caught out by:
 *   they generate a prompt, take a week to run it past someone, and paste the result back after a
 *   deploy. Old payloads must still be recognisable — see `isSupportedSchemaVersion`.
 * - The **prompt template** changes whenever the wording improves, which is often and harmlessly.
 *   A response produced from an older prompt is still perfectly valid if it matches the schema, so
 *   this version is recorded for provenance and never used to reject anything.
 * - The **ruleset** changes when the deterministic rules change. It affects what the platform *does*
 *   with an import, not whether the import is acceptable.
 * - The **validator** changes when validation logic changes. Recorded so a stored validation result
 *   can be re-read later with the knowledge of which logic produced it — a result that says "valid"
 *   means nothing without knowing what "valid" meant at the time.
 *
 * A single merged version would force a schema break every time a word in the prompt improved, and
 * would make "why was this rejected?" unanswerable.
 */

/** Shape of an accepted AI response. Bumping this can invalidate in-flight payloads. */
export const INTERCHANGE_SCHEMA_VERSION = '1.0.0';

/** Wording of the generated prompt package. Recorded for provenance; never used to reject. */
export const PROMPT_TEMPLATE_VERSION = '1.0.0';

/** Deterministic rule pack version. Affects what is done with an import, not its acceptability. */
export const RULESET_VERSION = '0.1.0';

/** Validation logic version. Stored with every result so it can be interpreted later. */
export const VALIDATOR_VERSION = '1.0.0';

/**
 * Schema versions this build can still read.
 *
 * A user may generate a prompt, spend days getting a response, and paste it back after a deploy.
 * Rejecting that outright because a patch version moved would be hostile and would lose their work,
 * so acceptance is deliberately broader than the current version.
 */
const SUPPORTED_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(['1.0.0']);

export function isSupportedSchemaVersion(version: string): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.has(version);
}

export function supportedSchemaVersions(): readonly string[] {
  return [...SUPPORTED_SCHEMA_VERSIONS];
}

/** The full version set stamped onto every prompt package and every validation result. */
export interface InterchangeVersions {
  readonly schema: string;
  readonly promptTemplate: string;
  readonly ruleset: string;
  readonly validator: string;
}

export function currentVersions(): InterchangeVersions {
  return {
    schema: INTERCHANGE_SCHEMA_VERSION,
    promptTemplate: PROMPT_TEMPLATE_VERSION,
    ruleset: RULESET_VERSION,
    validator: VALIDATOR_VERSION,
  };
}
