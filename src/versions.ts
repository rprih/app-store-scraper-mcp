/**
 * App version history. Upstream app-store-scraper only returns the current version, so this
 * reads the "Version History" section embedded in the apps.apple.com product page.
 * Apple's page lists at most the ~25 most recent versions.
 */
import { fetchAppPageData, findKey } from "./app-page.js";

interface TitledParagraph {
  $kind?: string;
  text?: string;
  primarySubtitle?: string;
  secondarySubtitle?: string;
}
interface VersionShelf {
  items?: TitledParagraph[];
  seeAllAction?: { pageData?: { shelves?: { items?: TitledParagraph[] }[] } };
}

function toIsoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export async function versions(opts: { id: number; country?: string; num?: number }) {
  const data = await fetchAppPageData(opts.id, opts.country);
  const shelf = findKey(data, "mostRecentVersion") as VersionShelf | undefined;
  if (!shelf) throw new Error("Could not find version history on the App Store page (page format changed?)");

  // The "see all" page has the full list; apps with a single version may only have the summary card.
  const full = shelf.seeAllAction?.pageData?.shelves?.flatMap((s) => s.items ?? []) ?? [];
  const items = (full.length ? full : shelf.items ?? []).filter((i) => i.$kind === "TitledParagraph");

  const list = items.map((i) => ({
    version: (i.primarySubtitle ?? "").replace(/^Version\s+/i, ""),
    date: toIsoDate(i.secondarySubtitle),
    releaseNotes: i.text ?? "",
  }));
  return opts.num ? list.slice(0, opts.num) : list;
}
