import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * Hub client smoke — guards bundle-level changes (lazy chart chunks, merged
 * CSS) that unit tests cannot verify: the built server boots, serves the SPA,
 * every main page mounts, no runtime error fires, and the bundled stylesheet
 * reaches the DOM. English strings only — a fresh profile has no persisted
 * locale and the client falls back to English unless the browser asks for Thai.
 */

/** The app-shell title in the header landmark — proof that React mounted. */
const shellTitle = (page: Page): Locator =>
  page.getByRole('banner').getByRole('heading', { name: 'AutoQA Hub' });

/**
 * The three main pages, each with the locator that proves it mounted. Dashboard
 * and Reports render a `PageHeader` (Mantine `Title order={3}` → h3); the Run
 * page ships no page heading (full-height tabbed console), so its proof is the
 * active nav item. Mantine `NavLink` renders an `<a>` without `href` and so
 * exposes no `link` role — hence `data-active` inside the nav landmark.
 */
const MAIN_PAGES: { name: string; hash: string; mounted: (page: Page) => Locator }[] = [
  {
    name: 'Dashboard',
    hash: '#/',
    mounted: (page) => page.getByRole('heading', { name: 'Dashboard', exact: true }),
  },
  {
    name: 'Run tests',
    hash: '#/run',
    mounted: (page) =>
      page.getByRole('navigation').locator('a[data-active]', { hasText: 'Run Tests' }),
  },
  {
    name: 'Reports',
    hash: '#/reports',
    mounted: (page) => page.getByRole('heading', { name: 'Reports', exact: true }),
  },
];

interface RuntimeProblems {
  consoleErrors: string[];
  pageErrors: string[];
}

/** Listen before the first navigation so no early error is missed. */
function collectRuntimeProblems(page: Page): RuntimeProblems {
  const problems: RuntimeProblems = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => problems.pageErrors.push(`${error.name}: ${error.message}`));
  return problems;
}

test('every main page renders its own content', async ({ page }) => {
  for (const target of MAIN_PAGES) {
    await test.step(target.name, async () => {
      await page.goto(target.hash);
      await expect(shellTitle(page)).toBeVisible();
      await expect(target.mounted(page)).toBeVisible();
    });
  }
});

test('main pages load without console or page errors', async ({ page }) => {
  const problems = collectRuntimeProblems(page);
  for (const target of MAIN_PAGES) {
    await page.goto(target.hash);
    await expect(target.mounted(page)).toBeVisible();
  }
  // Nothing is filtered: a failed chunk import, a React render crash or a failed
  // API call all belong in this smoke test's blast radius.
  expect(problems.pageErrors, 'uncaught page errors').toEqual([]);
  expect(problems.consoleErrors, 'console errors').toEqual([]);
});

test('bundled stylesheet is applied to the app shell', async ({ page }) => {
  await page.goto('#/');
  const header = page.getByRole('banner');
  await expect(header).toBeVisible();
  // Both come from the bundled Mantine AppShell stylesheet, not inline styles:
  // without the merged CSS `position` is `static` and the background transparent.
  const computed = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, backgroundColor: style.backgroundColor };
  });
  expect(computed.position).toBe('fixed');
  expect(computed.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});
