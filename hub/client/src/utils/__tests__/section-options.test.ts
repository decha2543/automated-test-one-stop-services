import { describe, expect, it } from 'vitest';
import { groupSections, sectionDisplayLabel } from '../section-options.js';

describe('groupSections', () => {
  it('returns empty groups/ungrouped for no sections', () => {
    expect(groupSections([])).toEqual({ ungrouped: [], groups: [] });
  });

  it('keeps bare sections (no slash) ungrouped, value === label', () => {
    expect(groupSections(['smoke', 'regression'])).toEqual({
      ungrouped: [
        { value: 'smoke', label: 'smoke' },
        { value: 'regression', label: 'regression' },
      ],
      groups: [],
    });
  });

  it('groups nested sections by parent with full path as value and leaf as label', () => {
    expect(groupSections(['ta/domestic', 'ta/inbound', 'ta/inter'])).toEqual({
      ungrouped: [],
      groups: [
        {
          name: 'ta',
          items: [
            { value: 'ta/domestic', label: 'domestic' },
            { value: 'ta/inbound', label: 'inbound' },
            { value: 'ta/inter', label: 'inter' },
          ],
        },
      ],
    });
  });

  it('handles multiple groups plus bare sections', () => {
    expect(groupSections(['motor/type-1', 'smoke', 'ta/inter'])).toEqual({
      ungrouped: [{ value: 'smoke', label: 'smoke' }],
      groups: [
        { name: 'motor', items: [{ value: 'motor/type-1', label: 'type-1' }] },
        { name: 'ta', items: [{ value: 'ta/inter', label: 'inter' }] },
      ],
    });
  });

  it('keeps deeper nesting in the leaf label (parent is only the first segment)', () => {
    expect(groupSections(['a/b/c'])).toEqual({
      ungrouped: [],
      groups: [{ name: 'a', items: [{ value: 'a/b/c', label: 'b/c' }] }],
    });
  });
});

describe('sectionDisplayLabel', () => {
  it('renders a nested path with spaced separators', () => {
    expect(sectionDisplayLabel('ta/domestic')).toBe('ta / domestic');
    expect(sectionDisplayLabel('a/b/c')).toBe('a / b / c');
  });

  it('leaves a bare section unchanged', () => {
    expect(sectionDisplayLabel('smoke')).toBe('smoke');
  });
});
