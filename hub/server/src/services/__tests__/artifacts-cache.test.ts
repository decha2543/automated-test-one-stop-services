import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit test for the `browseAll()` TTL cache (perf: the recursive `outputs/`
 * walk is the dashboard-poll hot path). We mock `node:fs` so no real disk walk
 * happens, and count `readdirSync` calls to prove:
 *   - a second `browseAll()` within the TTL is served from cache (no re-walk),
 *   - `invalidateBrowseAll()` forces the next call to re-walk.
 */

const mockExistsSync = vi.fn<(p: string) => boolean>();
const mockReaddirSync =
  vi.fn<(p: string, opts: unknown) => Array<{ name: string; isDirectory: () => boolean }>>();
const mockStatSync = vi.fn();

vi.mock('node:fs', () => ({
  default: {
    existsSync: (p: string) => mockExistsSync(p),
    readdirSync: (p: string, opts: unknown) => mockReaddirSync(p, opts),
    statSync: (p: string) => mockStatSync(p),
  },
}));

describe('artifactService.browseAll — TTL cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]); // empty outputs/ — one readdir per walk
    const { artifactService } = await import('../artifacts.js');
    artifactService.invalidateBrowseAll(); // reset module-level cache between tests
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
  });

  it('serves the second call from cache (walks the tree only once)', async () => {
    const { artifactService } = await import('../artifacts.js');

    artifactService.browseAll();
    artifactService.browseAll();

    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  it('re-walks after invalidateBrowseAll()', async () => {
    const { artifactService } = await import('../artifacts.js');

    artifactService.browseAll();
    artifactService.invalidateBrowseAll();
    artifactService.browseAll();

    expect(mockReaddirSync).toHaveBeenCalledTimes(2);
  });
});
