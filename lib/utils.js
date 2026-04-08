// Shared utility — runBatch for controlled concurrency across pipeline steps

/**
 * Runs asyncFn over items in sequential chunks of batchSize,
 * with full parallelism within each chunk. Max concurrency = batchSize.
 *
 * @param {Array}    items
 * @param {Function} asyncFn  — receives (item, index)
 * @param {number}   batchSize — default 5
 * @returns {Array} flattened results in original order
 */
export async function runBatch(items, asyncFn, batchSize = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map((item, j) => asyncFn(item, i + j)));
    results.push(...chunkResults);
  }
  return results;
}
