/**
 * Status vocabulary and its visual encoding.
 *
 * Contract:
 *  - MASTER_IMPLEMENTATION_PLAN.md section 9: gate states are NOT_READY / READY / PASS / FAIL /
 *    BLOCKED / EXCEPTION.
 *  - Section 25: "non-color status indicators" - status must never be conveyed by colour alone.
 *  - docs/DESIGN.md: "Pass: Emerald icon + PASS in mono", "Fail: Rose icon + FAIL in mono", etc.
 *
 * Why the icon and label are part of the data, not the component's discretion:
 *
 * WCAG 1.4.1 forbids colour as the sole carrier of meaning. If a badge component merely *accepts* an
 * optional icon, some call site will eventually omit it, and the omission is invisible to everyone
 * except the users who need it. Binding icon + label to the status here makes the accessible encoding
 * structural: rendering a status without them is not expressible.
 */

/** Quality gate states (plan section 9). */
export const GATE_STATES = ['NOT_READY', 'READY', 'PASS', 'FAIL', 'BLOCKED', 'EXCEPTION'] as const;
export type GateState = (typeof GATE_STATES)[number];

/** Known-issue severities (gap-spec section 76). */
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Project health / RAG status (gap-spec section 23). */
export const HEALTH_STATES = ['HEALTHY', 'WATCH', 'AT_RISK', 'CRITICAL', 'UNKNOWN'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** AI import validation outcomes (plan section 11.1). */
export const VALIDATION_STATES = [
  'VALID',
  'VALID_WITH_WARNINGS',
  'INCOMPLETE',
  'CONFLICTING',
  'UNSUPPORTED',
  'INVALID',
  'UNSAFE',
] as const;
export type ValidationState = (typeof VALIDATION_STATES)[number];

/** The token name a status maps to. Constrained to the frozen palette in `globals.css`. */
export type StatusTone =
  'success' | 'danger' | 'warning' | 'exception' | 'info' | 'unknown' | 'neutral';

export interface StatusDescriptor {
  /** Uppercase label, rendered in mono per DESIGN.md. Never omitted. */
  readonly label: string;
  /** Material Symbols name. Never omitted - this is the non-colour channel. */
  readonly icon: string;
  readonly tone: StatusTone;
  /** Screen-reader text where the label alone would be ambiguous out of context. */
  readonly description: string;
}

export const GATE_STATE_DESCRIPTORS: Readonly<Record<GateState, StatusDescriptor>> = {
  NOT_READY: {
    label: 'NOT READY',
    icon: 'radio_button_unchecked',
    tone: 'neutral',
    description: 'Gate criteria have not yet been attempted',
  },
  READY: {
    label: 'READY',
    icon: 'pending',
    tone: 'info',
    description: 'Gate is ready to be evaluated',
  },
  PASS: {
    label: 'PASS',
    icon: 'check_circle',
    tone: 'success',
    description: 'All gate criteria passed',
  },
  FAIL: {
    label: 'FAIL',
    icon: 'cancel',
    tone: 'danger',
    description: 'One or more gate criteria failed',
  },
  BLOCKED: {
    label: 'BLOCKED',
    icon: 'block',
    tone: 'warning',
    description: 'Gate cannot be evaluated because it is blocked',
  },
  EXCEPTION: {
    label: 'EXCEPTION',
    icon: 'gpp_maybe',
    tone: 'exception',
    description: 'Gate passed under a documented, approved exception',
  },
};

export const HEALTH_DESCRIPTORS: Readonly<Record<HealthState, StatusDescriptor>> = {
  HEALTHY: {
    label: 'HEALTHY',
    icon: 'check_circle',
    tone: 'success',
    description: 'No issues detected',
  },
  WATCH: {
    label: 'WATCH',
    icon: 'visibility',
    tone: 'info',
    description: 'Worth monitoring, no action required yet',
  },
  AT_RISK: {
    label: 'AT RISK',
    icon: 'warning',
    tone: 'warning',
    description: 'Action required to avoid impact',
  },
  CRITICAL: {
    label: 'CRITICAL',
    icon: 'error',
    tone: 'danger',
    description: 'Impact is occurring and needs immediate action',
  },
  UNKNOWN: {
    label: 'UNKNOWN',
    icon: 'help',
    tone: 'unknown',
    description: 'Not enough information to assess',
  },
};

export const SEVERITY_DESCRIPTORS: Readonly<Record<Severity, StatusDescriptor>> = {
  P0: { label: 'P0', icon: 'e911_emergency', tone: 'danger', description: 'Blocker' },
  P1: { label: 'P1', icon: 'error', tone: 'danger', description: 'Critical' },
  P2: { label: 'P2', icon: 'warning', tone: 'warning', description: 'Major' },
  P3: { label: 'P3', icon: 'info', tone: 'info', description: 'Minor' },
  P4: { label: 'P4', icon: 'palette', tone: 'neutral', description: 'Cosmetic' },
};

export const VALIDATION_DESCRIPTORS: Readonly<Record<ValidationState, StatusDescriptor>> = {
  VALID: {
    label: 'VALID',
    icon: 'check_circle',
    tone: 'success',
    description: 'Response passed every validation layer',
  },
  VALID_WITH_WARNINGS: {
    label: 'WARNINGS',
    icon: 'warning',
    tone: 'warning',
    description: 'Response is usable but has warnings to review',
  },
  INCOMPLETE: {
    label: 'INCOMPLETE',
    icon: 'more_horiz',
    tone: 'warning',
    description: 'Response is missing required information',
  },
  CONFLICTING: {
    label: 'CONFLICTING',
    icon: 'sync_problem',
    tone: 'warning',
    description: 'Response contradicts information you confirmed',
  },
  UNSUPPORTED: {
    label: 'UNSUPPORTED',
    icon: 'do_not_disturb_on',
    tone: 'unknown',
    description: 'Response describes something outside supported project types',
  },
  INVALID: {
    label: 'INVALID',
    icon: 'cancel',
    tone: 'danger',
    description: 'Response failed structural or schema validation',
  },
  UNSAFE: {
    label: 'UNSAFE',
    icon: 'gpp_bad',
    tone: 'danger',
    description: 'Response was rejected by security policy',
  },
};

/**
 * Tailwind classes per tone. Foreground uses the full-strength token; background uses a
 * low-opacity wash, per DESIGN.md: "Backgrounds should be low-opacity versions of status colors."
 *
 * Radius is `rounded-sm` (2px), the remap of the exports' `rounded` - see DESIGN_HANDOFF_SPEC.md D2.
 * DESIGN.md is explicit that chips stay square-ish rather than becoming pills.
 */
export const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
  success: 'text-success bg-success/10 border-success/30',
  danger: 'text-danger bg-danger/10 border-danger/30',
  warning: 'text-warning bg-warning/10 border-warning/30',
  exception: 'text-exception bg-exception/10 border-exception/30',
  info: 'text-info bg-info/10 border-info/30',
  unknown: 'text-unknown bg-unknown/10 border-unknown/30',
  neutral: 'text-on-surface-variant bg-surface-container-high border-outline-variant',
};
