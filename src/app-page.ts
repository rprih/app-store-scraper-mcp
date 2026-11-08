/**
 * Helpers for reading the redesigned apps.apple.com product page, which embeds its data
 * in a `serialized-server-data` JSON script. Used by the workarounds that upstream
 * app-store-scraper can't provide (privacy, version history).
 */

// Same 5-minute TTL as the upstream memoized store. Pages are large (~1 MB), so keep few.
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 20;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

/** Fetch an app's product page and return its embedded server data (cached for 5 minutes). */
export function fetchAppPageData(id: number, country = "us"): Promise<unknown> {
  const url = `https://apps.apple.com/${country.toLowerCase()}/app/id${id}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const data = loadPageData(url);
  data.catch(() => cache.delete(url)); // don't cache failures
  cache.delete(url);
  cache.set(url, { at: Date.now(), data });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return data;
}

async function loadPageData(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (res.status === 404) throw new Error("App not found (404)");
  if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
  const html = await res.text();

  const match = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Could not find app data on the App Store page (page format changed?)");
  return JSON.parse(match[1]);
}

/** Collect every object with the given `$kind` anywhere in the tree. */
export function collectKind<T>(root: unknown, kind: string): T[] {
  const out: T[] = [];
  const seen = new Set<object>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if ((node as { $kind?: string }).$kind === kind) out.push(node as T);
    for (const v of Object.values(node)) walk(v);
  };
  walk(root);
  return out;
}

/** Depth-first search for the first value stored under `key` anywhere in the tree. */
export function findKey(root: unknown, key: string): unknown {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (key in node) return (node as Record<string, unknown>)[key];
    stack.push(...Object.values(node));
  }
  return undefined;
}
