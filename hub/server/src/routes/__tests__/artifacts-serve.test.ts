import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route test for `GET /api/artifacts/serve` — the streamed (non-buffering)
 * artifact server with HTTP range support (video seeking). We mock the service
 * `serveInfo` (validation/stat) and `fs.createReadStream` so no real disk I/O
 * happens, and assert the status / range headers and the stream byte-range args.
 */

const mockServeInfo =
  vi.fn<(p: string) => { path: string; size: number; mimeType: string } | null>();
vi.mock('../../services/artifacts.js', () => ({
  artifactService: { serveInfo: (p: string) => mockServeInfo(p) },
}));

const mockCreateReadStream = vi.fn<(...args: unknown[]) => Readable>();
vi.mock('node:fs', () => ({
  default: {
    createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
    // config.ts probes for a bash binary at module load via existsSync — stub it
    // (false → BASH_PATH falls back to 'bash'); the serve route never reads disk.
    existsSync: () => false,
  },
}));

vi.mock('../../services/manifest-registry.js', () => ({
  getEnabledToolIds: vi.fn(async () => new Set<string>()),
}));

const FILE = { path: '/abs/outputs/clip.mp4', size: 100, mimeType: 'video/mp4' };

describe('GET /api/artifacts/serve — streamed range serving', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateReadStream.mockReturnValue(Readable.from(Buffer.from('x')));
    app = Fastify();
    const { artifactRoutes } = await import('../artifacts.js');
    await app.register(artifactRoutes);
    await app.ready();
  });

  it('returns 404 when the file is missing or outside outputs/', async () => {
    mockServeInfo.mockReturnValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/artifacts/serve?path=/etc/passwd' });
    expect(res.statusCode).toBe(404);
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('streams the whole file (no range header) with Content-Length = size', async () => {
    mockServeInfo.mockReturnValue(FILE);
    const res = await app.inject({ method: 'GET', url: '/api/artifacts/serve?path=x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe('100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toContain('video/mp4');
    // Whole-file stream — createReadStream called with the path only (no range opts).
    expect(mockCreateReadStream).toHaveBeenCalledWith(FILE.path);
  });

  it('serves a 206 partial response for a valid range and streams only that slice', async () => {
    mockServeInfo.mockReturnValue(FILE);
    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts/serve?path=x',
      headers: { range: 'bytes=0-49' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-49/100');
    expect(res.headers['content-length']).toBe('50');
    expect(mockCreateReadStream).toHaveBeenCalledWith(FILE.path, { start: 0, end: 49 });
  });

  it('clamps an open-ended range to the last byte', async () => {
    mockServeInfo.mockReturnValue(FILE);
    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts/serve?path=x',
      headers: { range: 'bytes=90-' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 90-99/100');
    expect(mockCreateReadStream).toHaveBeenCalledWith(FILE.path, { start: 90, end: 99 });
  });

  it('returns 416 when the range start is beyond the file size', async () => {
    mockServeInfo.mockReturnValue(FILE);
    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts/serve?path=x',
      headers: { range: 'bytes=200-' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */100');
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });
});
