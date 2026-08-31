import { cn } from './cn.ts';
import { EmptyState, type EmptyStateVariant } from './EmptyState.tsx';

/**
 * Data table.
 *
 * Appears on 19 of the 50 designed screens. Per DESIGN.md: "High-density with `border-subtle`
 * horizontal separators. Use zebra striping with `surface-low` on hover only." Column headers use
 * `label-caps`; identifiers, hashes and timestamps use the mono family.
 *
 * Two decisions that are accessibility requirements rather than preferences:
 *
 * 1. **Empty is a state, not an absence.** The table renders an `EmptyState` rather than an empty
 *    `<tbody>`, and distinguishes "nothing yet" from "your filter matched nothing" from "you lack
 *    permission" (KI-008). A blank table cannot tell a user which of those happened.
 * 2. **Sortable headers are buttons with `aria-sort`.** A `<th>` with a click handler is invisible
 *    to keyboard and screen-reader users, which is the most common way data tables become unusable.
 */

export interface Column<Row> {
  readonly id: string;
  readonly header: string;
  /** Cell renderer. Returning a string is fine; anything richer can return an element. */
  readonly cell: (row: Row) => React.ReactNode;
  /** Render in the mono family — for IDs, hashes, versions, timestamps (DESIGN.md). */
  readonly mono?: boolean;
  readonly align?: 'left' | 'right';
  readonly sortable?: boolean;
  /** Hidden below the `lg` breakpoint. Dense tables must prioritise columns on small screens. */
  readonly secondary?: boolean;
}

export type SortDirection = 'ascending' | 'descending';

interface DataTableProps<Row> {
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Describes the table for screen readers. Required — an unlabelled table is unnavigable. */
  readonly caption: string;
  readonly sortColumnId?: string;
  readonly sortDirection?: SortDirection;
  readonly onSort?: (columnId: string) => void;
  readonly onRowClick?: (row: Row) => void;
  readonly emptyVariant?: EmptyStateVariant;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: React.ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  sortColumnId,
  sortDirection,
  onSort,
  onRowClick,
  emptyVariant = 'empty',
  emptyTitle,
  emptyDescription,
  emptyAction,
  compact = false,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        variant={emptyVariant}
        {...(emptyTitle === undefined ? {} : { title: emptyTitle })}
        {...(emptyDescription === undefined ? {} : { description: emptyDescription })}
        {...(emptyAction === undefined ? {} : { action: emptyAction })}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const cellPadding = compact ? 'px-sm py-xs' : 'px-md py-sm';

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-outline-variant', className)}>
      <table className="w-full border-collapse text-left">
        {/* Visually hidden rather than omitted: the caption is how a screen-reader user knows what
            this table contains before navigating into it. */}
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="border-b border-outline-variant bg-surface-container">
            {columns.map((column) => {
              const isSorted = column.id === sortColumnId;
              return (
                <th
                  key={column.id}
                  scope="col"
                  // `aria-sort` belongs on the header cell, not the button.
                  aria-sort={isSorted ? sortDirection : undefined}
                  className={cn(
                    cellPadding,
                    'font-sans text-label-caps tracking-wider text-on-surface-variant uppercase',
                    column.align === 'right' && 'text-right',
                    column.secondary === true && 'hidden lg:table-cell',
                  )}
                >
                  {column.sortable === true && onSort !== undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSort(column.id);
                      }}
                      className="inline-flex items-center gap-xs uppercase transition-colors hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {column.header}
                      <span aria-hidden className="material-symbols-outlined text-[14px]">
                        {isSorted
                          ? sortDirection === 'ascending'
                            ? 'arrow_upward'
                            : 'arrow_downward'
                          : 'unfold_more'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              // Zebra striping on hover only, per DESIGN.md.
              className={cn(
                'border-b border-outline-variant/50 transition-colors last:border-0',
                onRowClick !== undefined && 'cursor-pointer hover:bg-surface-container-low',
              )}
              {...(onRowClick === undefined
                ? {}
                : {
                    onClick: () => {
                      onRowClick(row);
                    },
                  })}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    cellPadding,
                    'text-on-surface',
                    column.mono === true ? 'font-mono text-data-mono-sm' : 'font-sans text-body-sm',
                    column.align === 'right' && 'text-right',
                    column.secondary === true && 'hidden lg:table-cell',
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
