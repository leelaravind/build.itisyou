/**
 * EmptyState and Button tests.
 *
 * EmptyState is designed net-new (KI-008) — it appears in zero exports. Its whole reason for
 * existing is that plan section 24 lists empty, no-permission and error as *separate* required
 * states, and conflating them misleads the user about why they see nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '../../src/components/ui/EmptyState.tsx';
import { Button } from '../../src/components/ui/Button.tsx';

describe('EmptyState variants are genuinely distinguishable', () => {
  it('tells the user nothing exists yet', () => {
    render(<EmptyState variant="empty" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('distinguishes "no matches" from "nothing exists"', () => {
    // Telling someone "nothing here yet" when their filter excluded everything sends them off to
    // create a duplicate of something that already exists.
    render(<EmptyState variant="no-matches" />);
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('distinguishes "no permission" from "no data"', () => {
    // The important one. Saying "no results" when the truth is "you cannot see these" sends the
    // user hunting for data that is right there.
    render(<EmptyState variant="no-permission" />);
    expect(screen.getByText('You do not have access to this')).toBeInTheDocument();
  });

  it('distinguishes an error from an empty result', () => {
    render(<EmptyState variant="error" />);
    expect(screen.getByText('Could not load this')).toBeInTheDocument();
  });

  it('gives each variant a different icon', () => {
    const icons = (['empty', 'no-matches', 'no-permission', 'error'] as const).map((variant) => {
      const { container, unmount } = render(<EmptyState variant={variant} />);
      const icon = container.querySelector('[data-icon]')?.getAttribute('data-icon');
      unmount();
      return icon;
    });

    expect(new Set(icons).size).toBe(4);
  });
});

describe('EmptyState content', () => {
  it('accepts an overriding title', () => {
    render(<EmptyState title="No requirements captured" />);
    expect(screen.getByText('No requirements captured')).toBeInTheDocument();
  });

  it('renders a description explaining what to do', () => {
    render(<EmptyState description="Add the first requirement to begin tracing coverage." />);
    expect(
      screen.getByText('Add the first requirement to begin tracing coverage.'),
    ).toBeInTheDocument();
  });

  it('renders an action when one is supplied', () => {
    render(<EmptyState action={<Button>Add requirement</Button>} />);
    expect(screen.getByRole('button', { name: 'Add requirement' })).toBeInTheDocument();
  });

  it('omits the description element entirely when not supplied', () => {
    const { container } = render(<EmptyState />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('EmptyState accessibility', () => {
  it('announces politely rather than interrupting', () => {
    // `alert` would interrupt a screen-reader user mid-sentence on every filter change.
    render(<EmptyState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a compact form for dense panels without dropping the message', () => {
    render(<EmptyState compact title="No rows" />);
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('defaults to type="button" so it cannot silently submit a form', () => {
    // An unspecified <button> inside a <form> defaults to submit — a classic accidental mutation.
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('honours an explicit submit type', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('calls its handler on click', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);

    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );

    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire while loading', async () => {
    // Double-submit protection at the UI layer. The server still needs idempotency keys
    // (gap-spec section 48) — this only reduces the window.
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks itself busy while loading, not merely disabled', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('gives an icon-only button an accessible name', () => {
    // The most common serious accessibility defect in dashboard UIs.
    render(<Button icon="close" label="Close panel" />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
  });

  it('does not override a visible label with the aria-label prop', () => {
    render(
      <Button icon="save" label="ignored">
        Save changes
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('renders the requested icon', () => {
    const { container } = render(<Button icon="add">New</Button>);
    expect(container.querySelector('[data-icon="add"]')).not.toBeNull();
  });

  it('swaps the icon for a spinner while loading', () => {
    const { container } = render(
      <Button icon="add" loading>
        New
      </Button>,
    );
    expect(container.querySelector('[data-icon="add"]')).toBeNull();
    expect(container.querySelector('[data-icon="progress_activity"]')).not.toBeNull();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('renders the %s variant', (v) => {
    render(<Button variant={v}>Action</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('uses the remapped square radius, not a pill', () => {
    // DESIGN_HANDOFF_SPEC.md D2: the exports' `rounded-lg` maps to `rounded` (0.25rem).
    render(<Button>Action</Button>);
    expect(screen.getByRole('button').className).toMatch(/\brounded\b/);
    expect(screen.getByRole('button').className).not.toContain('rounded-full');
  });

  it('has a visible focus indicator', () => {
    // WCAG 2.2 Focus Appearance. Keyboard users depend on it entirely.
    render(<Button>Action</Button>);
    expect(screen.getByRole('button').className).toContain('focus-visible:outline');
  });
});
