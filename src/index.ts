#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import { z } from "zod";
import scraper from "app-store-scraper";
import { privacy } from "./privacy.js";
import { versions } from "./versions.js";
import {
  appListOutputSchema,
  appObjectSchema,
  categoryNames,
  collectionNames,
  country,
  lang,
  optionalBundleId,
  optionalTrackId,
  privacyOutputSchema,
  ratingsOutputSchema,
  reviewsOutputSchema,
  searchOutputSchema,
  sortNames,
  suggestionsOutputSchema,
  trackId,
  verbose,
  versionsOutputSchema,
} from "./schemas.js";

// Cache responses for 5 minutes to avoid hammering Apple's endpoints.
const store = scraper.memoized({ maxAge: 5 * 60 * 1000, max: 1000 });

// ---------- helpers ----------

function ok(data: unknown): CallToolResult {
  const structured = Array.isArray(data)
    ? { results: data }
    : (data as Record<string, unknown>);
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

function requireAppRef(args: { id?: number; appId?: string }) {
  if (args.id === undefined && !args.appId) {
    throw new Error("Either `id` (trackId) or `appId` (bundle id) must be provided.");
  }
}

/**
 * Upstream bug: the ratings parser matches /\d+/ against "4,041,456 Ratings" and returns 4.
 * The histogram is parsed correctly, so derive the total from it.
 */
function fixRatings<T>(result: T): T {
  const r = result as { ratings?: number; histogram?: Record<string, number> };
  if (r && r.histogram && Object.keys(r.histogram).length) {
    r.ratings = Object.values(r.histogram).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  return result;
}

/** Strip bulky fields from list-style results so they fit comfortably in model context. */
function compact(app: any): any {
  if (!app || typeof app !== "object") return app;
  const {
    screenshots,
    ipadScreenshots,
    appletvScreenshots,
    supportedDevices,
    languages,
    releaseNotes,
    description,
    ...rest
  } = app;
  if (typeof description === "string") {
    rest.description = description.length > 300 ? `${description.slice(0, 300)}…` : description;
  }
  return rest;
}

function compactList(results: unknown, isVerbose?: boolean): unknown {
  if (isVerbose || !Array.isArray(results)) return results;
  return results.map(compact);
}

/** Wrap a handler so thrown errors become MCP tool errors instead of protocol failures. */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

// ---------- server ----------

// Report the published package version (package.json is always shipped to npm; release-please bumps it).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({ name: "app-store-scraper", version });

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

server.registerTool(
  "get_app",
  {
    title: "Get App Store Application Metadata",
    description:
      "Retrieve complete App Store metadata for a single iOS, iPadOS, or macOS application from the Apple iTunes Lookup API, including title, full description, price, currency, average rating (`score`), rating count (`reviews`), current version, minimum OS version, file size, genres, developer info (`developerId`), supported devices, and screenshot URLs.\n\n" +
      "When to use: Call this tool when you already have an app's numeric `id` (`trackId`) or reverse-DNS `appId` (bundle ID) and need its full storefront listing. Set `ratings: true` if you also need the 1–5 star rating `histogram` in the same step.\n" +
      "When NOT to use: Do not use to find apps by keyword or name (use `search_apps`), to fetch only the star histogram when app metadata is not needed (use `get_app_ratings`), to inspect historical changelogs (use `get_app_versions`), or to read App Privacy disclosures (use `get_app_privacy`).\n\n" +
      "Behavior: Read-only and idempotent; cached in memory for 5 minutes. Performs 1 HTTP lookup request by default, or 2 requests when `ratings: true` is enabled. Fails with an error if neither `id` nor `appId` is supplied, or if the app is not available (404) in the specified `country` storefront.",
    inputSchema: {
      id: optionalTrackId,
      appId: optionalBundleId,
      country,
      lang,
      ratings: z
        .boolean()
        .optional()
        .describe(
          "When true, performs one additional HTTP request to fetch and merge `ratings` (exact total rating count) and `histogram` (1–5 star distribution) into the returned app object. Defaults to false.",
        ),
    },
    outputSchema: appObjectSchema(),
    annotations: readOnly,
  },
  safe(async (args) => {
    requireAppRef(args);
    const app = await store.app({ ...args });
    return args.ratings ? fixRatings({ ...app }) : app;
  }),
);

server.registerTool(
  "search_apps",
  {
    title: "Search App Store Catalog by Keyword",
    description:
      "Search the Apple App Store catalog for applications matching a keyword or phrase in a regional storefront, returning `{ results }` ordered by Apple's native search relevance rank.\n\n" +
      "When to use: Call this tool to discover apps by name, topic, or category keyword, or to resolve an unknown app's numeric `id` (`trackId`), `appId` (bundle ID), or `developerId` before calling detail tools (`get_app`, `get_app_reviews`, `get_app_privacy`, `get_app_versions`, `list_developer_apps`).\n" +
      "When NOT to use: Do not use for autocomplete keyword ideation (use `get_search_suggestions`), for browsing official top charts (use `list_top_apps`), or when you already know the app's `id` or `appId` (use `get_app`).\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 2 HTTP requests by default (search index query followed by batch metadata lookup), or 1 lightweight request if `idsOnly: true` is set. When `verbose` is false/omitted, each app object is compacted (`description` truncated to 300 chars; screenshot, device, language, and release-note arrays omitted).",
    inputSchema: {
      term: z
        .string()
        .min(1)
        .describe(
          "Non-empty search query string (app name, brand, or keyword phrase, e.g. 'notion', 'habit tracker', 'photo editor').",
        ),
      num: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Maximum number of search results to return per page (integer 1–200, default: 50)."),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based page number of search results for pagination (integer >= 1, default: 1)."),
      country,
      lang,
      idsOnly: z
        .boolean()
        .optional()
        .describe(
          "When true, skips the batch metadata lookup and returns only `{ results: [<trackId>, ...] }`, cutting latency to a single HTTP request. Defaults to false.",
        ),
      verbose,
    },
    outputSchema: searchOutputSchema,
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => compactList(await store.search(args), v)),
);

server.registerTool(
  "list_top_apps",
  {
    title: "List App Store Top Chart Rankings",
    description:
      "Retrieve ranked applications from an official Apple App Store leaderboard chart (`collection`, such as top free, top paid, top grossing, or new releases) in a country storefront, optionally filtered by genre `category`, returning `{ results }` in chart rank order.\n\n" +
      "When to use: Call this tool for market intelligence, category leaderboard tracking, and discovering top-performing apps in a region or genre.\n" +
      "When NOT to use: Do not use to search by keyword (use `search_apps`), to find competitors linked to a specific app (use `list_similar_apps`), or to list all apps from one publisher (use `list_developer_apps`).\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 1 RSS feed request by default returning summary fields (`id`, `appId`, `title`, `url`, `price`, `currency`, `free`, `developer`, `developerId`, `genre`, `released`), or 2 requests when `fullDetail: true` to hydrate complete lookup metadata (ratings `score`, `reviews` count, `version`, `requiredOsVersion`). Compacted by default unless `verbose: true`.",
    inputSchema: {
      collection: z
        .enum(collectionNames)
        .optional()
        .describe(
          "App Store chart collection to fetch (e.g. 'TOP_FREE_IOS', 'TOP_PAID_IOS', 'TOP_GROSSING_IOS', 'TOP_FREE_IPAD', 'TOP_PAID_IPAD', 'TOP_GROSSING_IPAD', 'NEW_IOS', 'NEW_FREE_IOS', 'NEW_PAID_IOS'). Defaults to 'TOP_FREE_IOS'.",
        ),
      category: z
        .enum(categoryNames)
        .optional()
        .describe(
          "Optional App Store genre filter (e.g. 'GAMES', 'GAMES_PUZZLE', 'FINANCE', 'PRODUCTIVITY', 'HEALTH_AND_FITNESS'). When omitted, returns the overall all-categories chart.",
        ),
      country,
      lang: z
        .string()
        .min(2)
        .optional()
        .describe(
          "IETF BCP 47 language tag (e.g. 'en-us', 'ja-jp'). Only takes effect when `fullDetail: true` triggers an iTunes Lookup call.",
        ),
      num: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Number of ranked chart entries to return (integer 1–200, default: 50)."),
      fullDetail: z
        .boolean()
        .optional()
        .describe(
          "When true, performs a second batch iTunes Lookup request so each ranked app includes full metadata (`score`, `reviews`, `version`, `primaryGenre`, `requiredOsVersion`) instead of RSS summary fields only. Defaults to false.",
        ),
      verbose,
    },
    outputSchema: appListOutputSchema,
    annotations: readOnly,
  },
  safe(async ({ collection, category, verbose: v, ...args }) => {
    const results = await store.list({
      ...args,
      collection: collection ? scraper.collection[collection] : undefined,
      category: category ? scraper.category[category] : undefined,
    });
    return compactList(results, v);
  }),
);

server.registerTool(
  "list_developer_apps",
  {
    title: "List All Apps Published by a Developer",
    description:
      "Retrieve all App Store applications published by a specific developer account in a country storefront using the publisher's numeric iTunes `devId` (`artistId`), returning `{ results }`.\n\n" +
      "When to use: Call this tool for publisher portfolio analysis after obtaining `developerId` from `get_app`, `search_apps`, `list_top_apps`, or `list_similar_apps`.\n" +
      "When NOT to use: Do not pass an application `id` (`trackId`) or a text company name here—if you only know the developer's name or app title, call `search_apps` first and read `developerId` from a matching app.\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 1 iTunes Lookup request (`entity=software`). Returns compacted app objects by default (`description` capped at 300 chars; screenshot/device/language/releaseNotes arrays stripped) unless `verbose: true`. Fails with a 404 error if `devId` does not match a valid developer with published apps in that storefront.",
    inputSchema: {
      devId: z
        .number()
        .int()
        .positive()
        .describe(
          "Numeric Apple iTunes artistId of the developer (exposed as `developerId` on app objects from `get_app` or `search_apps`, e.g. 284882218 for Meta Platforms).",
        ),
      country,
      lang,
      verbose,
    },
    outputSchema: appListOutputSchema,
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => compactList(await store.developer(args), v)),
);

server.registerTool(
  "list_similar_apps",
  {
    title: "List Competitors and Similar Apps ('Customers Also Bought')",
    description:
      "Retrieve the 'Customers Also Bought' / 'You Might Also Like' related applications linked from a target app's App Store product page, returning `{ results }`.\n\n" +
      "When to use: Call this tool for competitive analysis and discovering direct peer/competitor apps associated with a known seed app (`id` or `appId`).\n" +
      "When NOT to use: Do not use for broad keyword discovery (use `search_apps`), category leaderboards (use `list_top_apps`), or listing other apps owned by the same publisher (use `list_developer_apps`).\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 2 HTTP requests when `id` is supplied (product page fetch to extract `customersAlsoBoughtApps` IDs, followed by batch iTunes Lookup), or 3 requests when only `appId` is supplied. Returns `{ results: [] }` if Apple lists no similar apps for the title. Compacted by default unless `verbose: true`.",
    inputSchema: {
      id: optionalTrackId,
      appId: optionalBundleId,
      country,
      lang,
      verbose,
    },
    outputSchema: appListOutputSchema,
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => {
    requireAppRef(args);
    return compactList(await store.similar(args), v);
  }),
);

server.registerTool(
  "get_app_reviews",
  {
    title: "Get Written User Reviews for an App",
    description:
      "Fetch a page of up to 50 written customer reviews (reviewer name, 1–5 star `score`, review `title`, written `text`, reviewed app `version`, and `updated` timestamp) from Apple's Customer Reviews RSS feed for a single country storefront, returning `{ results }`.\n\n" +
      "When to use: Call this tool for qualitative user sentiment analysis, bug report mining, and version-specific feedback inspection.\n" +
      "When NOT to use: Do not use to get the total rating count or overall 1–5 star distribution across all users—many users rate without writing a review; use `get_app_ratings` (or `get_app` with `ratings: true`) for aggregate rating metrics.\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 1 HTTP request when numeric `id` is provided, or 2 requests when resolving `appId` first. Apple caps the RSS feed at pages 1–10 (~500 reviews maximum per country storefront). Returns `{ results: [] }` if the requested page has no reviews.",
    inputSchema: {
      id: optionalTrackId,
      appId: optionalBundleId,
      country,
      page: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Page number of reviews to retrieve (integer 1–10, default: 1; each page holds up to 50 reviews and Apple does not serve pages beyond 10).",
        ),
      sort: z
        .enum(sortNames)
        .optional()
        .describe(
          "Review sort order: 'RECENT' (newest reviews first, default) or 'HELPFUL' (most upvoted/helpful reviews first).",
        ),
    },
    outputSchema: reviewsOutputSchema,
    annotations: readOnly,
  },
  safe(async ({ sort, ...args }) => {
    requireAppRef(args);
    return store.reviews({ ...args, sort: sort ? scraper.sort[sort] : undefined });
  }),
);

server.registerTool(
  "get_app_ratings",
  {
    title: "Get Aggregate Rating Count and 1–5 Star Histogram",
    description:
      "Fetch the total user ratings count (`ratings`) and the 1-to-5 star breakdown (`histogram` with keys `'1'` through `'5'`) for an application in a regional App Store storefront.\n\n" +
      "When to use: Call this tool when you already have the app's numeric `id` (`trackId`) and only need rating volume and star distribution (for example, comparing star histograms across multiple `country` storefronts).\n" +
      "When NOT to use: If you also need general app metadata (title, price, version, developer) for the same storefront in the same step, call `get_app` with `ratings: true` instead to avoid redundant tool calls. If you need written user comments, call `get_app_reviews`. Does not accept `appId` (resolve bundle IDs via `get_app` or `search_apps` first).\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 1 lightweight HTML fragment request to Apple's customer-reviews endpoint and computes the exact `ratings` total by summing the 5 star buckets (fixing upstream's comma-truncation bug). Fails with 404 if the `id` is not found.",
    inputSchema: {
      id: trackId,
      country,
    },
    outputSchema: ratingsOutputSchema,
    annotations: readOnly,
  },
  safe(async (args) => fixRatings({ ...(await store.ratings(args)) })),
);

server.registerTool(
  "get_app_privacy",
  {
    title: "Get App Privacy Nutrition Label Disclosures",
    description:
      "Extract the Apple App Privacy ('nutrition label') disclosure and `privacyPolicyUrl` from an application's `apps.apple.com` product page, detailing what data is used to track the user, linked to the user, or not linked to the user, broken down by `dataCategories`, `dataTypes`, and collection `purposes`.\n\n" +
      "When to use: Call this tool for privacy compliance auditing, SDK/tracking analysis, and inspecting data-collection disclosures for an app identified by its numeric `id` (`trackId`).\n" +
      "When NOT to use: Do not use for general store metadata (use `get_app`) or version changelogs (use `get_app_versions`). Requires numeric `id`; if you only have `appId` or an app name, resolve `id` via `get_app` or `search_apps` first.\n\n" +
      "Behavior: Read-only. Fetches and parses the embedded `serialized-server-data` JSON from `apps.apple.com`, sharing a 5-minute in-memory page cache (max 20 pages) with `get_app_versions`. Returns `privacyTypes: []` if the developer has not submitted privacy disclosures. Fails with an error if the app page returns 404.",
    inputSchema: {
      id: trackId,
      country,
    },
    outputSchema: privacyOutputSchema,
    annotations: readOnly,
  },
  safe(async (args) => privacy(args)),
);

server.registerTool(
  "get_app_versions",
  {
    title: "Get App Version History and Release Notes",
    description:
      "Retrieve an application's historical release log (`version` string, ISO-8601 release `date`, and localized `releaseNotes`), ordered newest first, from the Version History section of its `apps.apple.com` product page, returning `{ results }`.\n\n" +
      "When to use: Call this tool for release cadence analytics, update frequency tracking, and changelog history inspection across up to ~25 recent releases.\n" +
      "When NOT to use: Do not use if you only need the current live version number or current release notes—call `get_app` (with `verbose` or default) instead, which uses the lighter iTunes Lookup JSON API. Requires numeric `id` (`trackId`).\n\n" +
      "Behavior: Read-only. Parses `serialized-server-data` from `apps.apple.com`, sharing the 5-minute in-memory product page cache with `get_app_privacy`. Apple's product page exposes at most the ~25 most recent versions; use `num` to slice to fewer entries. Fails with an error on 404 or if version history is absent.",
    inputSchema: {
      id: trackId,
      country: z
        .string()
        .length(2)
        .regex(/^[a-zA-Z]{2}$/, "Must be a two-letter ISO 3166-1 alpha-2 country code, e.g. 'us', 'gb', 'jp'.")
        .optional()
        .describe(
          "Two-letter ISO 3166-1 alpha-2 country code of the App Store storefront (default: 'us'). Determines both regional page availability and the language of `releaseNotes`.",
        ),
      num: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Maximum number of most-recent version entries to return (integer 1–100). When omitted, returns all versions listed on the page (up to ~25 from Apple).",
        ),
    },
    outputSchema: versionsOutputSchema,
    annotations: readOnly,
  },
  safe(async (args) => versions(args)),
);

server.registerTool(
  "get_search_suggestions",
  {
    title: "Get App Store Search Autocomplete Suggestions",
    description:
      "Retrieve up to 50 Apple App Store search bar autocomplete keyword suggestions (`{ results: [{ term }] }`) for a partial prefix or seed keyword in a country storefront.\n\n" +
      "When to use: Call this tool for App Store Optimization (ASO) keyword research, query expansion, and discovering high-intent search phrases users type into the App Store.\n" +
      "When NOT to use: Do not use to retrieve actual application listings or app metadata matching a query—call `search_apps` instead.\n\n" +
      "Behavior: Read-only, cached for 5 minutes. Performs 1 fast XML hint request to Apple's `MZSearchHints` endpoint using the storefront header for `country`. Returns `{ results: [] }` if Apple has no autocomplete hints for the prefix.",
    inputSchema: {
      term: z
        .string()
        .min(1)
        .describe(
          "Seed keyword or partial search prefix to expand into autocomplete suggestions (e.g. 'budget', 'fitness tracker', 'ai photo').",
        ),
      country,
    },
    outputSchema: suggestionsOutputSchema,
    annotations: readOnly,
  },
  safe(async (args) => store.suggest(args)),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("app-store-scraper MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
