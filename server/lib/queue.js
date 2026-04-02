/**
 * Concurrency-limited async queue.
 * Processes items with at most `concurrency` running at once.
 */
async function* asyncPool(concurrency, iterable, fn) {
  const executing = new Set();
  for (const item of iterable) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
    yield p;
  }
  while (executing.size > 0) {
    await Promise.race(executing);
    yield Promise.race(executing);
  }
}

async function runQueue(items, fn, concurrency = 5) {
  const results = [];
  for await (const result of asyncPool(concurrency, items, fn)) {
    try {
      results.push(await result);
    } catch (err) {
      results.push({ error: err.message });
    }
  }
  return results;
}

module.exports = { runQueue };
