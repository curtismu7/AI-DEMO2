import { useMemo, useState } from 'react';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const compareValues = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
};

export const dateOf = (field) => (row) => new Date(row[field] || 0).getTime();
export const latestUpdate = (row) => new Date(row.updatedAt || row.createdAt || 0).getTime();

/**
 * Client-side column sorting for table pages.
 *
 * `accessors` maps a column key to a function extracting the sortable value
 * from a row. Define it at module level so the memo stays stable.
 * The default key may be a hidden (non-column) accessor, e.g. "latest update".
 */
export function useSortableTable(rows, accessors, defaultKey, defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const sortedRows = useMemo(() => {
    const accessor = accessors[sortKey];
    if (!Array.isArray(rows) || !accessor) return rows;
    const sign = sortDir === 'desc' ? -1 : 1;
    return rows
      .map((row) => [accessor(row), row])
      .sort((a, b) => sign * compareValues(a[0], b[0]))
      .map((pair) => pair[1]);
  }, [rows, accessors, sortKey, sortDir]);

  const requestSort = (key) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return { sortedRows, sortKey, sortDir, requestSort };
}

export function SortableTh({ columnKey, label, sort }) {
  const active = sort.sortKey === columnKey;
  return (
    <th
      onClick={() => sort.requestSort(columnKey)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden="true" style={{ marginLeft: '0.3rem', fontSize: '0.7rem', opacity: active ? 1 : 0.35 }}>
        {active ? (sort.sortDir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}
