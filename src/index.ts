#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import { z } from "zod";
import scraper from "app-store-scraper";
import { privacy } from "./privacy.js";

// Cache responses for 5 minutes to avoid hammering Apple's endpoints.
const store = scraper.memoized({ maxAge: 5 * 60 * 1000, max: 1000 });

const collectionNames = Object.keys(scraper.collection) as [string, ...string[]];
const categoryNames = Object.keys(scraper.category) as [string, ...string[]];
const sortNames = Object.keys(scraper.sort) as [string, ...string[]];

// ---------- shared schema pieces ----------

const country = z
  .string()
  .length(2)
  .optional()
  .describe("Two-letter country code of the store (default: us). Also affects result language.");
const lang = z
  .string()
  .optional()
  .describe("Language code for result text, e.g. 'en-us'. Defaults to the country's language.");
const trackId = z
  .number()
  .int()
  .positive()
  .describe("Numeric iTunes trackId of the app, e.g. 553834731 (Candy Crush Saga).");
const bundleId = z
  .string()
  .describe("Bundle id of the app, e.g. 'com.midasplayer.apps.candycrushsaga'.");
const verbose = z
  .boolean()
  .optional()
  .describe(
    "Return full app objects (screenshots, full description, devices). Default false returns a compact form.",
  );

// ---------- helpers ----------

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

server.registerTool(
  "app_details",
  {
    title: "App details",
    description:
      "Get full details for an App Store app (title, description, price, rating, version, developer, screenshots…). Provide either `id` or `appId`.",
    inputSchema: {
      id: trackId.optional(),
      appId: bundleId.optional(),
      country,
      lang,
      ratings: z
        .boolean()
        .optional()
        .describe("Also load the ratings count and star histogram (one extra request)."),
    },
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
    title: "Search apps",
    description: "Search the App Store for apps matching a term.",
    inputSchema: {
      term: z.string().min(1).describe("Search term."),
      num: z.number().int().min(1).max(200).optional().describe("Results per page (default 50)."),
      page: z.number().int().min(1).optional().describe("Page of results (default 1)."),
      country,
      lang,
      idsOnly: z
        .boolean()
        .optional()
        .describe("Return only an array of trackIds (skips the detail lookup; faster)."),
      verbose,
    },
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => compactList(await store.search(args), v)),
);

server.registerTool(
  "list_apps",
  {
    title: "Top charts",
    description:
      "Get apps from an App Store chart/collection (top free, top paid, top grossing, new…), optionally filtered by category.",
    inputSchema: {
      collection: z
        .enum(collectionNames)
        .optional()
        .describe("Chart to fetch (default TOP_FREE_IOS)."),
      category: z.enum(categoryNames).optional().describe("Restrict to a category/genre."),
      country,
      lang,
      num: z.number().int().min(1).max(200).optional().describe("Number of apps (default 50, max 200)."),
      fullDetail: z
        .boolean()
        .optional()
        .describe("Do an extra lookup to return full app attributes like app_details."),
      verbose,
    },
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
  "developer_apps",
  {
    title: "Developer apps",
    description: "List all apps published by a developer, given the developer's iTunes artistId.",
    inputSchema: {
      devId: z
        .number()
        .int()
        .positive()
        .describe("iTunes artistId of the developer (the `developerId` field of an app), e.g. 284882218."),
      country,
      lang,
      verbose,
    },
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => compactList(await store.developer(args), v)),
);

server.registerTool(
  "similar_apps",
  {
    title: "Similar apps",
    description:
      "Get the 'customers also bought' / similar apps shown on an app's page. Provide either `id` or `appId`.",
    inputSchema: {
      id: trackId.optional(),
      appId: bundleId.optional(),
      country,
      lang,
      verbose,
    },
    annotations: readOnly,
  },
  safe(async ({ verbose: v, ...args }) => {
    requireAppRef(args);
    return compactList(await store.similar(args), v);
  }),
);

server.registerTool(
  "app_reviews",
  {
    title: "App reviews",
    description:
      "Get a page of user reviews for an app (up to 10 pages of ~50 reviews). Provide either `id` or `appId`.",
    inputSchema: {
      id: trackId.optional(),
      appId: bundleId.optional(),
      country,
      page: z.number().int().min(1).max(10).optional().describe("Page 1–10 (default 1)."),
      sort: z.enum(sortNames).optional().describe("RECENT (default) or HELPFUL."),
    },
    annotations: readOnly,
  },
  safe(async ({ sort, ...args }) => {
    requireAppRef(args);
    return store.reviews({ ...args, sort: sort ? scraper.sort[sort] : undefined });
  }),
);

server.registerTool(
  "app_ratings",
  {
    title: "App ratings",
    description: "Get the total ratings count and 1–5 star histogram for an app.",
    inputSchema: { id: trackId, country },
    annotations: readOnly,
  },
  safe(async (args) => fixRatings({ ...(await store.ratings(args)) })),
);

server.registerTool(
  "app_privacy",
  {
    title: "App privacy",
    description: "Get the App Privacy ('nutrition label') details for an app.",
    inputSchema: {
      id: trackId,
      country: z
        .string()
        .length(2)
        .optional()
        .describe("Two-letter country code (default us)."),
    },
    annotations: readOnly,
  },
  safe(async (args) => privacy(args)),
);

server.registerTool(
  "search_suggestions",
  {
    title: "Search suggestions",
    description:
      "Get up to 50 App Store search autocomplete suggestions for a term. Useful for keyword/ASO research.",
    inputSchema: { term: z.string().min(1).describe("Partial search term."), country },
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
