/**
 * Status chip tests.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 25 requires "non-color status indicators" —
 * WCAG 1.4.1 forbids colour as the sole carrier of meaning. These tests exist to make that
 * structural rather than aspirational: every status must carry a text label and an icon, on every
 * status in every vocabulary, with no exceptions reachable through the public API.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  GateStateChip,
  HealthChip,
  SeverityChip,
  ValidationChip,
} from '../../src/components/ui/StatusChip.tsx';
import {
  GATE_STATES,
  GATE_STATE_DESCRIPTORS,
  HEALTH_STATES,
  HEALTH_DESCRIPTORS,
  SEVERITIES,
  SEVERITY_DESCRIPTORS,
  VALIDATION_STATES,
  VALIDATION_DESCRIPTORS,
  TONE_CLASSES,
} from '../../src/components/ui/status.ts';

describe('non-colour encoding — every gate state', () => {
  it.each(GATE_STATES)('%s renders a visible text label', (state) => {
    render(<GateStateChip state={state} />);
    expect(screen.getByText(GATE_STATE_DESCRIPTORS[state].label)).toBeInTheDocument();
  });

  it.each(GATE_STATES)('%s renders a distinguishing icon', (state) => {
    const { container } = render(<GateStateChip state={state} />);
    const icon = container.querySelector(`[data-icon="${GATE_STATE_DESCRIPTORS[state].icon}"]`);
    expect(icon).not.toBeNull();
  });

  it.each(GATE_STATES)('%s exposes a description to assistive technology', (state) => {
    render(<GateStateChip state={state} />);
    expect(
      screen.getByText(new RegExp(GATE_STATE_DESCRIPTORS[state].description)),
    ).toBeInTheDocument();
  });

  it('gives PASS and FAIL different icons, not just different colours', () => {
    // The single most important pair in the product: a red/green-only distinction is invisible to
    // the most common form of colour blindness.
    expect(GATE_STATE_DESCRIPTORS.PASS.icon).not.toBe(GATE_STATE_DESCRIPTORS.FAIL.icon);
    expect(GATE_STATE_DESCRIPTORS.PASS.label).not.toBe(GATE_STATE_DESCRIPTORS.FAIL.label);
  });

  it('gives every gate state a unique icon', () => {
    const icons = GATE_STATES.map((s) => GATE_STATE_DESCRIPTORS[s].icon);
    expect(new Set(icons).size).toBe(GATE_STATES.length);
  });

  it('gives every gate state a unique label', () => {
    const labels = GATE_STATES.map((s) => GATE_STATE_DESCRIPTORS[s].label);
    expect(new Set(labels).size).toBe(GATE_STATES.length);
  });
});

describe('non-colour encoding — health, severity and validation', () => {
  it.each(HEALTH_STATES)('health %s renders label and icon', (state) => {
    const { container } = render(<HealthChip state={state} />);
    expect(screen.getByText(HEALTH_DESCRIPTORS[state].label)).toBeInTheDocument();
    expect(
      container.querySelector(`[data-icon="${HEALTH_DESCRIPTORS[state].icon}"]`),
    ).not.toBeNull();
  });

  it.each(SEVERITIES)('severity %s renders label and icon', (severity) => {
    const { container } = render(<SeverityChip severity={severity} />);
    expect(screen.getByText(SEVERITY_DESCRIPTORS[severity].label)).toBeInTheDocument();
    expect(
      container.querySelector(`[data-icon="${SEVERITY_DESCRIPTORS[severity].icon}"]`),
    ).not.toBeNull();
  });

  it.each(VALIDATION_STATES)('validation %s renders label and icon', (state) => {
    const { container } = render(<ValidationChip state={state} />);
    expect(screen.getByText(VALIDATION_DESCRIPTORS[state].label)).toBeInTheDocument();
    expect(
      container.querySelector(`[data-icon="${VALIDATION_DESCRIPTORS[state].icon}"]`),
    ).not.toBeNull();
  });

  it('gives every health state a unique icon', () => {
    const icons = HEALTH_STATES.map((s) => HEALTH_DESCRIPTORS[s].icon);
    expect(new Set(icons).size).toBe(HEALTH_STATES.length);
  });

  it('distinguishes UNSAFE from INVALID, which have the same tone', () => {
    // Both are danger-toned. Without distinct icons and labels they would be indistinguishable,
    // and they mean very different things: rejected by security policy vs malformed.
    expect(VALIDATION_DESCRIPTORS.UNSAFE.tone).toBe(VALIDATION_DESCRIPTORS.INVALID.tone);
    expect(VALIDATION_DESCRIPTORS.UNSAFE.icon).not.toBe(VALIDATION_DESCRIPTORS.INVALID.icon);
    expect(VALIDATION_DESCRIPTORS.UNSAFE.label).not.toBe(VALIDATION_DESCRIPTORS.INVALID.label);
  });
});

describe('tone mapping stays inside the frozen palette', () => {
  it('references only tokens defined in globals.css', () => {
    // Catches the class of defect that produced KI-001 (`border-subtle` used 67 times, defined
    // nowhere) — a class name that silently resolves to nothing.
    const defined = [
      'success',
      'danger',
      'warning',
      'exception',
      'info',
      'unknown',
      'on-surface-variant',
      'surface-container-high',
      'outline-variant',
    ];
    for (const [tone, classes] of Object.entries(TONE_CLASSES)) {
      for (const token of classes.split(' ')) {
        const name = /^(?:text|bg|border)-([a-z-]+)(?:\/\d+)?$/.exec(token)?.[1];
        expect(defined, `tone "${tone}" references unknown token "${token}"`).toContain(name);
      }
    }
  });

  it('uses a square-ish radius, not a pill', () => {
    // DESIGN.md: chips must "avoid the playfulness associated with circular pills".
    const { container } = render(<GateStateChip state="PASS" />);
    expect(container.firstElementChild?.className).toContain('rounded-sm');
    expect(container.firstElementChild?.className).not.toContain('rounded-full');
  });

  it('renders labels in the mono family, per DESIGN.md', () => {
    const { container } = render(<GateStateChip state="PASS" />);
    expect(container.firstElementChild?.className).toContain('font-mono');
  });
});

describe('density', () => {
  it('renders a compact variant for high-density tables', () => {
    const { container } = render(<GateStateChip state="PASS" compact />);
    expect(container.firstElementChild?.className).toContain('px-xs');
  });

  it('keeps the label and icon in the compact variant', () => {
    // Compactness must never be achieved by dropping the accessible channel.
    const { container } = render(<GateStateChip state="BLOCKED" compact />);
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="block"]')).not.toBeNull();
  });
});

describe('descriptor table completeness', () => {
  it('covers every declared gate state', () => {
    expect(Object.keys(GATE_STATE_DESCRIPTORS).sort()).toEqual([...GATE_STATES].sort());
  });

  it('covers every declared health state', () => {
    expect(Object.keys(HEALTH_DESCRIPTORS).sort()).toEqual([...HEALTH_STATES].sort());
  });

  it('covers every declared severity', () => {
    expect(Object.keys(SEVERITY_DESCRIPTORS).sort()).toEqual([...SEVERITIES].sort());
  });

  it('covers every declared validation state', () => {
    expect(Object.keys(VALIDATION_DESCRIPTORS).sort()).toEqual([...VALIDATION_STATES].sort());
  });

  it('never leaves a label or icon empty', () => {
    const all = [
      ...Object.values(GATE_STATE_DESCRIPTORS),
      ...Object.values(HEALTH_DESCRIPTORS),
      ...Object.values(SEVERITY_DESCRIPTORS),
      ...Object.values(VALIDATION_DESCRIPTORS),
    ];
    for (const d of all) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});
