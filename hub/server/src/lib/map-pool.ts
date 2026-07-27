/**
 * Bounded-parallelism `map`. Runs `task` over `items` with at most `size`
 * promises in flight and returns the results in input order.
 *
 * Single source for every fan-out in the server (git probes per project,
 * output-cleanup deletions, project scanning). Those spawn child processes or
 * hit the filesystem, so an unbounded `Promise.all` would fork one process per
 * project and stall the event loop on a large workspace.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await task(items[idx] as T);
    }
  }
  const workers = Math.max(1, Math.min(size, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
