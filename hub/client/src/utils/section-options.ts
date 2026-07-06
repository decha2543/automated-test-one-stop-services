export interface SectionOption {
  /** Full path passed to the runner as SECTION, e.g. `ta/domestic`. */
  value: string;
  /** Leaf label shown under the group, e.g. `domestic`; equals `value` when ungrouped. */
  label: string;
}

export interface SectionGroup {
  /** Top-level parent segment, e.g. `ta`. */
  name: string;
  items: SectionOption[];
}

export interface GroupedSections {
  /** Sections with no `/` — rendered as plain options, above the groups. */
  ungrouped: SectionOption[];
  /** Nested sections, grouped by their top-level parent. */
  groups: SectionGroup[];
}

/**
 * Group flat section paths from the API (e.g. `ta/domestic`, `motor/1-type-1`,
 * or a bare `smoke`) by their top-level parent so the dropdown can show where
 * each leaf comes from. Bare sections (no `/`) stay ungrouped. The option
 * `value` is always the full path the runner expects as `SECTION`. Insertion
 * order is preserved (the API already returns sections sorted).
 */
export function groupSections(sections: readonly string[]): GroupedSections {
  const ungrouped: SectionOption[] = [];
  const groups = new Map<string, SectionOption[]>();

  for (const section of sections) {
    const slash = section.indexOf('/');
    if (slash === -1) {
      ungrouped.push({ value: section, label: section });
      continue;
    }
    const parent = section.slice(0, slash);
    const leaf = section.slice(slash + 1);
    const items = groups.get(parent) ?? [];
    items.push({ value: section, label: leaf });
    groups.set(parent, items);
  }

  return { ungrouped, groups: [...groups].map(([name, items]) => ({ name, items })) };
}

/** Display form for a selected section value: `ta/domestic` → `ta / domestic`. */
export function sectionDisplayLabel(value: string): string {
  return value.replaceAll('/', ' / ');
}
