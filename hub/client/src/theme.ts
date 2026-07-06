import { createTheme, type MantineColorsTuple, rem } from '@mantine/core';

/**
 * Hub design tokens — the single source of truth for how the whole app looks.
 *
 * Why this file exists: the look used to come from a 5-line inline theme in
 * `main.tsx` (`primaryColor: 'blue'` + defaults), which is the stock Mantine
 * palette every template ships with. Centralising real tokens here — brand
 * accent, a softened dark palette, a typographic scale, and shared component
 * defaults — re-skins every page at once and gives one place to tune the brand.
 *
 * To rebrand: edit `brand` (accent) or `slate` (dark surfaces) below. Nothing
 * else in the app hardcodes these colours.
 */

// Accent — a modern indigo. Distinct from Mantine's default blue so the Hub
// reads as its own product, not a stock dashboard. 10 shades, light → dark.
const brand: MantineColorsTuple = [
  '#eef1fd',
  '#d9def7',
  '#b0bbf0',
  '#8595e9',
  '#6175e3',
  '#4b61e0',
  '#3f56df',
  '#3147c6',
  '#293eb2',
  '#1c339e',
];

// Dark surfaces — a neutral slate, softer than Mantine's default blue-black
// navy (the other big "generic Mantine" tell). Warmer greys read as premium
// and reduce eye strain during long test-watching sessions.
const slate: MantineColorsTuple = [
  '#c9cbcf',
  '#adb0b6',
  '#8b8f99',
  '#666b76',
  '#4a4f5a',
  '#3a3f49',
  '#2d313a',
  '#23262d',
  '#1a1d22',
  '#131519',
];

const fontStack = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const theme = createTheme({
  primaryColor: 'brand',
  // Slightly lighter accent in dark mode keeps buttons legible on slate.
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  luminanceThreshold: 0.3,
  colors: { brand, dark: slate },

  fontFamily: fontStack,
  fontFamilyMonospace: 'JetBrains Mono, Fira Code, Consolas, monospace',
  defaultRadius: 'md',

  // Slightly rounder than Mantine defaults (sm 4→6, md 8→10). Soft corners read
  // as friendly/human; sharp right angles are part of the "formal/aggressive"
  // feel. Kept subtle so dense tables/inputs don't turn bubbly.
  radius: {
    xs: rem(4),
    sm: rem(6),
    md: rem(10),
    lg: rem(14),
    xl: rem(20),
  },

  // Interactive controls (Select, Checkbox, Radio…) show a pointer — a small
  // affordance that makes the UI feel responsive and clickable.
  cursorType: 'pointer',

  // A deliberate type scale: tighter line-heights + heavier weights on headings
  // create clear hierarchy so users' eyes land on titles first.
  headings: {
    fontFamily: fontStack,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.3', fontWeight: '700' },
      h2: { fontSize: rem(23), lineHeight: '1.35' },
      h3: { fontSize: rem(19), lineHeight: '1.4' },
      h4: { fontSize: rem(16), lineHeight: '1.45' },
      h5: { fontSize: rem(14), lineHeight: '1.5' },
      h6: { fontSize: rem(12), lineHeight: '1.5' },
    },
  },

  // Shared component defaults — consistency without repeating props everywhere.
  components: {
    // Every tooltip gets an arrow so pointers to their target are unambiguous.
    Tooltip: { defaultProps: { withArrow: true } },
    // Modals centre by default (FormModal already did; now every modal matches).
    Modal: { defaultProps: { centered: true } },
    // Links underline only on hover — cleaner reading, clear affordance.
    Anchor: { defaultProps: { underline: 'hover' } },
    // Cards get a soft elevation so surfaces feel gently lifted rather than
    // boxed in by a hard 1px outline — the main "warmth" lever for content.
    Card: { defaultProps: { shadow: 'sm' } },
  },
});
