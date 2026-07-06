// Loads the `@testing-library/jest-dom` matcher type augmentations (toBeInTheDocument,
// toHaveAttribute, toBeChecked, …) for the TypeScript compiler.
//
// The matchers are registered at runtime in `vitest.setup.ts`
// (`import '@testing-library/jest-dom/vitest'`), but that setup file lives at
// the package root, outside this project's `src/**/*` tsconfig `include`. As a
// result `tsc -b` never sees the `expect` augmentation and reports the matchers
// as missing on `Assertion`. Importing the same module from a `.d.ts` inside
// `src/` makes the augmentation visible during typecheck without widening the
// tsconfig include or weakening any compiler option.
import '@testing-library/jest-dom/vitest';
