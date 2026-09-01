/**
 * Redaction and the data-leaving summary.
 *
 * Contract: gap-spec §11.3 — before the prompt is copied, show the user what data will leave the
 * platform, which sensitive items were detected, what was redacted, the external-AI privacy warning
 * and the organisation policy. Plan §19 requires "sensitive-data redaction before external-AI prompt
 * copy" and an explicit external-AI boundary.
 *
 * **This is the one place project data deliberately leaves.** Everything else in the system is about
 * keeping tenant data inside a boundary; this feature exists to help the user take some of it out.
 * That inversion is why the user is shown exactly what is going, rather than being asked to trust a
 * summary — the platform cannot un-send what someone pastes into a chat window.
 *
 * The detectors are deliberately conservative in the direction of *over*-redacting. A false positive
 * costs the user a slightly less specific prompt. A false negative puts a credential into a third
 * party's training corpus.
 */

export const SENSITIVITY_CLASSES = ['RESTRICTED', 'CONFIDENTIAL', 'INTERNAL', 'PUBLIC'] as const;
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

export interface DetectedItem {
  readonly kind: string;
  readonly sensitivity: SensitivityClass;
  /** Where it was found — a field id, so the user can go and look at it. */
  readonly fieldId: string;
  /** Why it matters, in the user's terms. */
  readonly explanation: string;
  /** Whether the value was removed from the outgoing text. */
  readonly redacted: boolean;
}

interface Detector {
  readonly kind: string;
  readonly sensitivity: SensitivityClass;
  readonly pattern: RegExp;
  readonly explanation: string;
  /** RESTRICTED items are always removed. Others are flagged for the user to decide. */
  readonly alwaysRedact: boolean;
}

/**
 * Detectors, ordered most-severe first.
 *
 * `RESTRICTED` matches gap-spec §37: secrets, credentials, private keys and tokens. Those are
 * removed without asking, because there is no legitimate reason to send one to an external AI and no
 * user intent that would make it correct.
 */
const DETECTORS: readonly Detector[] = [
  {
    kind: 'Private key',
    sensitivity: 'RESTRICTED',
    pattern: /-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----/,
    explanation: 'A private key. Removed — this must never leave the platform.',
    alwaysRedact: true,
  },
  {
    kind: 'API key or token',
    sensitivity: 'RESTRICTED',
    pattern:
      /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/,
    explanation: 'Something shaped like an API key. Removed.',
    alwaysRedact: true,
  },
  {
    kind: 'Connection string',
    sensitivity: 'RESTRICTED',
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@\S+/i,
    explanation: 'A database connection string containing a password. Removed.',
    alwaysRedact: true,
  },
  {
    kind: 'Bearer token',
    sensitivity: 'RESTRICTED',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/i,
    explanation: 'An authorisation token. Removed.',
    alwaysRedact: true,
  },
  {
    kind: 'Payment card number',
    sensitivity: 'RESTRICTED',
    // Luhn is not checked: a 16-digit run in a project description is worth removing either way.
    pattern: /\b(?:\d[ -]?){13,19}\b/,
    explanation: 'A long digit sequence that could be a payment card number. Removed.',
    alwaysRedact: true,
  },
  {
    kind: 'Email address',
    sensitivity: 'CONFIDENTIAL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    explanation: 'An email address. Personal data — removed by default.',
    alwaysRedact: true,
  },
  {
    kind: 'Internal hostname',
    sensitivity: 'CONFIDENTIAL',
    pattern: /\b[a-z0-9-]+\.(?:internal|local|lan|corp|intranet)\b/i,
    explanation: 'An internal hostname. Reveals infrastructure — removed.',
    alwaysRedact: true,
  },
  {
    kind: 'IP address',
    sensitivity: 'CONFIDENTIAL',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    explanation: 'An IP address. Flagged so you can decide whether it matters.',
    alwaysRedact: false,
  },
  {
    kind: 'Source code',
    sensitivity: 'CONFIDENTIAL',
    pattern: /(?:\bfunction\s+\w+\s*\(|\bclass\s+\w+\s*\{|=>\s*\{|\bSELECT\b.+\bFROM\b)/i,
    explanation: 'Something that looks like source code. Flagged for your review.',
    alwaysRedact: false,
  },
];

export const REDACTION_MARKER = '[redacted]';

export interface RedactionResult {
  readonly text: string;
  readonly detected: readonly DetectedItem[];
  readonly changed: boolean;
}

/** Redact one field's text, reporting everything found. */
export function redactField(fieldId: string, text: string): RedactionResult {
  let output = text;
  const detected: DetectedItem[] = [];

  for (const detector of DETECTORS) {
    // Fresh global regex per pass: a shared `lastIndex` across calls silently skips matches.
    const global = new RegExp(detector.pattern.source, `${detector.pattern.flags}g`);
    if (!global.test(output)) continue;

    detected.push({
      kind: detector.kind,
      sensitivity: detector.sensitivity,
      fieldId,
      explanation: detector.explanation,
      redacted: detector.alwaysRedact,
    });

    if (detector.alwaysRedact) {
      output = output.replace(
        new RegExp(detector.pattern.source, `${detector.pattern.flags}g`),
        REDACTION_MARKER,
      );
    }
  }

  return { text: output, detected, changed: output !== text };
}

export interface DataLeavingSummary {
  /** Field ids whose content is included in the prompt. */
  readonly includedFields: readonly string[];
  readonly detected: readonly DetectedItem[];
  /** True when anything RESTRICTED was found — surfaced prominently. */
  readonly hasRestricted: boolean;
  readonly redactedCount: number;
  readonly flaggedCount: number;
}

export function summariseDataLeaving(fields: readonly { fieldId: string; text: string }[]): {
  readonly redacted: readonly { fieldId: string; text: string }[];
  readonly summary: DataLeavingSummary;
} {
  const redacted: { fieldId: string; text: string }[] = [];
  const detected: DetectedItem[] = [];

  for (const field of fields) {
    const result = redactField(field.fieldId, field.text);
    redacted.push({ fieldId: field.fieldId, text: result.text });
    detected.push(...result.detected);
  }

  return {
    redacted,
    summary: {
      includedFields: fields.map((f) => f.fieldId),
      detected,
      hasRestricted: detected.some((d) => d.sensitivity === 'RESTRICTED'),
      redactedCount: detected.filter((d) => d.redacted).length,
      flaggedCount: detected.filter((d) => !d.redacted).length,
    },
  };
}

/**
 * External-AI policy modes (plan §19).
 *
 * `DISABLED` must be enforced server-side. An organisation that has switched the workflow off must
 * not be able to reach it by crafting a request — a UI that merely hides the button is not a policy.
 */
export const EXTERNAL_AI_MODES = [
  'DISABLED',
  'REDACTED_ONLY',
  'APPROVED_PROVIDERS_ONLY',
  'USER_CHOICE',
] as const;

export type ExternalAiMode = (typeof EXTERNAL_AI_MODES)[number];

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  /** True when the policy forbids sending anything that was merely flagged rather than removed. */
  readonly requiresFullRedaction: boolean;
}

export function evaluatePolicy(mode: ExternalAiMode, summary: DataLeavingSummary): PolicyDecision {
  if (mode === 'DISABLED') {
    return {
      allowed: false,
      reason: 'Your organisation has turned off the external-AI workflow.',
      requiresFullRedaction: false,
    };
  }

  // Restricted material is removed before this point, so its presence is a detection record rather
  // than a live exposure. It still blocks under the strict mode, because the safe response to
  // "we found a credential in your project description" is to have the user look at it.
  if (mode === 'REDACTED_ONLY' && summary.flaggedCount > 0) {
    return {
      allowed: false,
      reason:
        'Your organisation only permits fully redacted prompts, and some items could not be removed automatically. Review the flagged items first.',
      requiresFullRedaction: true,
    };
  }

  return { allowed: true, requiresFullRedaction: mode === 'REDACTED_ONLY' };
}
