import { useCallback, useState } from 'react';
import type { SortDir } from '~/components/table/SortableHeader.js';

/**
 * Sort state for a data table: the active field, the direction, and a toggle
 * handler (click the active column to flip asc/desc; click another column to
 * sort it descending). History and Reports shared this exact logic verbatim.
 */
export function useTableSort<F extends string>(initialField: F, initialDir: SortDir = 'desc') {
  const [sortField, setSortField] = useState<F>(initialField);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const handleSort = useCallback((field: F) => {
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevField;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  return { sortField, sortDir, handleSort, setSortField, setSortDir };
}
