/**
 * DataTable and StatTile tests.
 *
 * DataTable appears on 19 designed screens; StatTile opens roughly a dozen. Both carry contract
 * obligations beyond looking right: accessible sorting, empty-state honesty (KI-008), and the
 * no-fake-precision rule from plan section 12.3.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../../src/components/ui/DataTable.tsx';
import { StatTile } from '../../src/components/ui/StatTile.tsx';

interface Risk {
  readonly id: string;
  readonly title: string;
  readonly exposure: number;
}

const RISKS: Risk[] = [
  { id: 'RSK-001', title: 'Vendor lead time', exposure: 40 },
  { id: 'RSK-002', title: 'Unclear compliance scope', exposure: 75 },
];

const COLUMNS: Column<Risk>[] = [
  { id: 'id', header: 'ID', cell: (r) => r.id, mono: true },
  { id: 'title', header: 'Risk', cell: (r) => r.title, sortable: true },
  {
    id: 'exposure',
    header: 'Exposure',
    cell: (r) => String(r.exposure),
    align: 'right',
    sortable: true,
  },
];

function renderTable(overrides: Partial<Parameters<typeof DataTable<Risk>>[0]> = {}) {
  return render(
    <DataTable
      columns={COLUMNS}
      rows={RISKS}
      rowKey={(r) => r.id}
      caption="Project risks"
      {...overrides}
    />,
  );
}

describe('DataTable structure', () => {
  it('renders a caption so the table is identifiable to screen readers', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'Project risks' })).toBeInTheDocument();
  });

  it('renders one column header per column', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('renders one row per record plus the header row', () => {
    renderTable();
    expect(screen.getAllByRole('row')).toHaveLength(RISKS.length + 1);
  });

  it('renders cell content through the column renderer', () => {
    renderTable();
    expect(screen.getByText('Unclear compliance scope')).toBeInTheDocument();
  });

  it('renders identifiers in the mono family, per DESIGN.md', () => {
    const { container } = renderTable();
    const idCell = container.querySelector('tbody tr td');
    expect(idCell?.className).toContain('font-mono');
  });

  it('renders headers in label-caps, per DESIGN.md', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')[0]?.className).toContain('text-label-caps');
  });
});

describe('DataTable sorting is accessible', () => {
  it('exposes sortable headers as buttons, not click handlers on th', () => {
    // A <th> with onClick is invisible to keyboard and screen-reader users - the most common way
    // data tables become unusable.
    renderTable({ onSort: vi.fn() });
    expect(screen.getByRole('button', { name: /Risk/ })).toBeInTheDocument();
  });

  it('does not make non-sortable columns interactive', () => {
    renderTable({ onSort: vi.fn() });
    expect(screen.queryByRole('button', { name: /^ID/ })).not.toBeInTheDocument();
  });

  it('announces the sorted column and direction via aria-sort', () => {
    renderTable({ onSort: vi.fn(), sortColumnId: 'exposure', sortDirection: 'descending' });

    const header = screen.getAllByRole('columnheader')[2];
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('leaves unsorted columns without an aria-sort value', () => {
    renderTable({ onSort: vi.fn(), sortColumnId: 'exposure', sortDirection: 'descending' });
    expect(screen.getAllByRole('columnheader')[1]).not.toHaveAttribute('aria-sort');
  });

  it('calls onSort with the column id when a header is activated', async () => {
    const onSort = vi.fn();
    renderTable({ onSort });

    await userEvent.click(screen.getByRole('button', { name: /Risk/ }));
    expect(onSort).toHaveBeenCalledWith('title');
  });

  it('is operable by keyboard alone', async () => {
    const onSort = vi.fn();
    renderTable({ onSort });

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onSort).toHaveBeenCalled();
  });
});

describe('DataTable empty states tell the truth', () => {
  it('shows an empty state rather than a blank table body', () => {
    renderTable({ rows: [] });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('distinguishes a filtered-out result from nothing existing', () => {
    // Saying "nothing here yet" when a filter excluded everything sends the user off to create a
    // duplicate of something that already exists.
    renderTable({ rows: [], emptyVariant: 'no-matches' });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('distinguishes a permission denial from an empty result', () => {
    renderTable({ rows: [], emptyVariant: 'no-permission' });
    expect(screen.getByText('You do not have access to this')).toBeInTheDocument();
  });

  it('surfaces a load failure as an error, not as emptiness', () => {
    renderTable({ rows: [], emptyVariant: 'error' });
    expect(screen.getByText('Could not load this')).toBeInTheDocument();
  });

  it('accepts a domain-specific empty message', () => {
    renderTable({ rows: [], emptyTitle: 'No risks recorded' });
    expect(screen.getByText('No risks recorded')).toBeInTheDocument();
  });
});

describe('DataTable interaction and density', () => {
  it('invokes the row handler when a row is clicked', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    const rows = screen.getAllByRole('row');
    await userEvent.click(within(rows[1]!).getByText('RSK-001'));
    expect(onRowClick).toHaveBeenCalledWith(RISKS[0]);
  });

  it('does not mark rows as clickable when no handler is supplied', () => {
    const { container } = renderTable();
    expect(container.querySelector('tbody tr')?.className).not.toContain('cursor-pointer');
  });

  it('supports a compact density for enterprise mode', () => {
    const { container } = renderTable({ compact: true });
    expect(container.querySelector('tbody td')?.className).toContain('px-sm');
  });

  it('hides secondary columns on small screens rather than overflowing', () => {
    // Gap-spec section 3.4 requires dense screens to prioritise columns, not merely shrink.
    const columns: Column<Risk>[] = [
      ...COLUMNS,
      { id: 'owner', header: 'Owner', cell: () => 'A. Rostova', secondary: true },
    ];
    const { container } = render(
      <DataTable columns={columns} rows={RISKS} rowKey={(r) => r.id} caption="Risks" />,
    );

    const headers = container.querySelectorAll('th');
    expect(headers[3]?.className).toContain('hidden');
    expect(headers[3]?.className).toContain('lg:table-cell');
  });

  it('scrolls horizontally rather than breaking the page layout', () => {
    const { container } = renderTable();
    expect(container.firstElementChild?.className).toContain('overflow-x-auto');
  });
});

describe('StatTile does not manufacture precision', () => {
  it('renders a plain measured value without a qualifier', () => {
    render(<StatTile label="Open risks" value="12" provenance="measured" />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
  });

  it.each([
    ['calculated', 'Calculated'],
    ['estimated', 'Estimated'],
    ['assumed', 'Assumed'],
    ['unknown', 'Unknown'],
  ] as const)('labels a %s figure so it cannot read as measured fact', (provenance, label) => {
    // Plan section 11.2: the UI must never present inference as confirmed fact. A big confident
    // number in a KPI tile is exactly where that rule gets broken.
    render(<StatTile label="Forecast cost" value="£142,500" provenance={provenance} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders a range instead of a spurious midpoint', () => {
    // Plan section 12.3: "Do not produce a fake single-number estimate."
    render(
      <StatTile
        label="Cost at completion"
        range={{ low: '£120k', high: '£165k' }}
        provenance="estimated"
      />,
    );

    expect(screen.getByText(/£120k/)).toBeInTheDocument();
    expect(screen.getByText(/£165k/)).toBeInTheDocument();
  });

  it('falls back to an em dash rather than showing zero for an absent value', () => {
    // Rendering "0" for missing data is a lie; an em dash is honest.
    render(<StatTile label="Budget" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('encodes delta direction with an arrow, not colour alone', () => {
    const { container } = render(
      <StatTile
        label="Variance"
        value="8%"
        delta={{ value: '2.1%', direction: 'up', tone: 'danger' }}
      />,
    );

    expect(container.querySelector('[data-icon="arrow_upward"]')).not.toBeNull();
    expect(screen.getByText(/increase/)).toBeInTheDocument();
  });

  it('renders the headline figure in the mono family', () => {
    render(<StatTile label="Tasks" value="248" />);
    expect(screen.getByText('248').className).toContain('font-mono');
  });
});
