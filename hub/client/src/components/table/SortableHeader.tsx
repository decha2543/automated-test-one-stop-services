import { Text, UnstyledButton } from '@mantine/core';
import { TbArrowDown, TbArrowsSort, TbArrowUp } from 'react-icons/tb';

/** Sort direction shared by every sortable data table. */
export type SortDir = 'asc' | 'desc';

/** Page-size options offered by the History / Reports table footers. */
export const PAGE_SIZE_OPTIONS = ['10', '25', '50', '100'];

interface SortableHeaderProps<F extends string> {
  label: string;
  field: F;
  currentField: F;
  currentDir: SortDir;
  onSort: (field: F) => void;
}

/**
 * A clickable column header that shows the active sort direction. Generic over
 * the page's sort-field union, so History and Reports share one implementation
 * instead of each redefining an identical component.
 */
export function SortableHeader<F extends string>({
  label,
  field,
  currentField,
  currentDir,
  onSort,
}: SortableHeaderProps<F>) {
  const isActive = currentField === field;
  return (
    <UnstyledButton
      onClick={() => onSort(field)}
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
    >
      <Text size="xs" fw={600}>
        {label}
      </Text>
      {isActive ? (
        currentDir === 'asc' ? (
          <TbArrowUp size={12} />
        ) : (
          <TbArrowDown size={12} />
        )
      ) : (
        <TbArrowsSort size={12} color="var(--mantine-color-dimmed)" />
      )}
    </UnstyledButton>
  );
}
