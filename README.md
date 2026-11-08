# app-store-scraper-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes [`app-store-scraper`](https://github.com/facundoolano/app-store-scraper) as tools, so AI assistants can query the Apple App Store directly: app details, search, top charts, reviews, ratings, privacy labels, and keyword suggestions.

## Tools

| Tool | Description |
| --- | --- |
| `get_app` | Full app details by `id` (trackId) or `appId` (bundle id). Pass `ratings: true` to include the star histogram. |
| `search_apps` | Search apps by term (`num`, `page`, `idsOnly`). |
| `list_top_apps` | Top charts (`collection`, e.g. `TOP_FREE_IOS`, `TOP_GROSSING_IPAD`), optionally by `category` (e.g. `GAMES_PUZZLE`). |
| `list_developer_apps` | All apps by a developer (`devId` = the app's `developerId`). |
| `list_similar_apps` | "Customers also bought" apps. |
| `get_app_reviews` | One page of reviews (pages 1–10, sort `RECENT` or `HELPFUL`). |
| `get_app_ratings` | Total ratings count and 1–5 star histogram. |
| `get_app_privacy` | The App Privacy ("nutrition label") details. |
| `get_search_suggestions` | Search autocomplete suggestions, useful for ASO and keyword research. |

Most tools accept `country` (two-letter code, default `us`) and `lang`.

List-style tools (`search_apps`, `list_top_apps`, `list_developer_apps`, `list_similar_apps`) return a **compact** form by default: no screenshots, device lists, languages or release notes, and descriptions cut to 300 characters. This keeps responses small in the model's context. Pass `verbose: true` to get full objects.

Responses are cached in memory for 5 minutes.

## Fixes over upstream

- **`get_app_ratings` / `get_app({ratings: true})`**: upstream reports `ratings: 4` for "4,041,456 Ratings" because its regex stops at the comma. This server works out the total from the histogram.
- **`get_app_privacy`**: upstream is broken since Apple's apps.apple.com redesign (the token regex no longer matches). This server reads the privacy data from the page's embedded JSON (`src/privacy.ts`) and keeps the original output shape, plus a `privacyPolicyUrl` field.

## Setup

No install needed: clients run it with `npx`. Requires Node.js 18+.

### Claude Code

```bash
claude mcp add app-store -- npx -y app-store-scraper-mcp
```

### Claude Desktop / other clients

```json
{
  "mcpServers": {
    "app-store": {
      "command": "npx",
      "args": ["-y", "app-store-scraper-mcp"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/rprih/app-store-scraper-mcp.git && cd app-store-scraper-mcp
npm install && npm run build
claude mcp add app-store -- node "$PWD/dist/index.js"
```

### Debugging

```bash
npm run inspect   # opens the MCP Inspector against the built server
```

## Notes

This is unofficial scraping of Apple endpoints. It can break when Apple changes things, and heavy use may get rate-limited.
