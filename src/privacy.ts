/**
 * Replacement for app-store-scraper's `privacy()`, which broke when Apple redesigned
 * apps.apple.com (the bearer-token regex no longer matches). The new page embeds the
 * privacy "nutrition label" in a `serialized-server-data` JSON script, so we read it there.
 *
 * Output mirrors the shape of the original library's result.
 */

interface RawCategory {
  identifier: string;
  title: string;
  dataTypes?: string[];
}
interface RawPurpose {
  identifier: string;
  title: string;
  categories?: RawCategory[];
}
interface RawPrivacyType {
  $kind: "PrivacyType";
  identifier: string;
  title: string;
  detail?: string;
  style?: string;
  categories?: RawCategory[];
  purposes?: RawPurpose[];
}

const mapCategory = (c: RawCategory) => ({
  dataCategory: c.title,
  identifier: c.identifier,
  dataTypes: c.dataTypes ?? [],
});

/** Collect every object with the given `$kind` anywhere in the tree. */
function collectKind<T>(root: unknown, kind: string): T[] {
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

/** The developer's privacy policy link is tagged with targetId "privacyPolicy" in action metrics. */
function findPrivacyPolicyUrl(root: unknown): string | undefined {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const n = node as { targetId?: unknown; actionUrl?: unknown };
    if (n.targetId === "privacyPolicy" && typeof n.actionUrl === "string") return n.actionUrl;
    stack.push(...Object.values(node));
  }
  return undefined;
}

export async function privacy(opts: { id: number; country?: string }) {
  const country = (opts.country ?? "us").toLowerCase();
  const url = `https://apps.apple.com/${country}/app/id${opts.id}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (res.status === 404) throw new Error("App not found (404)");
  if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
  const html = await res.text();

  const match = html.match(
    /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("Could not find privacy data on the App Store page (page format changed?)");
  const data = JSON.parse(match[1]);

  // The same PrivacyType appears in several places (summary cards and the detail page);
  // prefer the detail-page variant, which carries the full purpose breakdown.
  const byId = new Map<string, RawPrivacyType>();
  for (const t of collectKind<RawPrivacyType>(data, "PrivacyType")) {
    const prev = byId.get(t.identifier);
    if (!prev || (t.style === "detailPage" && prev.style !== "detailPage")) byId.set(t.identifier, t);
  }

  const privacyPolicyUrl = findPrivacyPolicyUrl(data);

  return {
    privacyPolicyUrl,
    privacyTypes: [...byId.values()].map((t) => ({
      privacyType: t.title,
      identifier: t.identifier,
      description: t.detail ?? "",
      dataCategories: (t.categories ?? []).map(mapCategory),
      purposes: (t.purposes ?? []).map((p) => ({
        purpose: p.title,
        identifier: p.identifier,
        dataCategories: (p.categories ?? []).map(mapCategory),
      })),
    })),
  };
}
