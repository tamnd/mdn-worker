# mdn-worker

**Vietnamese MDN Web Docs** — a full, ad-free mirror of [MDN Web Docs](https://developer.mozilla.org) with Vietnamese translations, deployed on Cloudflare Workers.

**Live:** [mdn.go-mizu.dev](https://mdn.go-mizu.dev)

---

## Features

- **100% MDN look & feel** — uses MDN's own build tools ([rari](https://github.com/nickinprice/rari) + [Fred](https://github.com/nickinprice/fred)) for pixel-perfect rendering
- **Vietnamese translations** — pre-built pages from [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) served as `/vi/docs/...`
- **Ad-free** — all ad placements and banners stripped from every page
- **Transparent fallback** — pages without a Vietnamese translation are fetched from upstream MDN and served with Vietnamese locale rewriting
- **Fast** — static assets served from Cloudflare's edge; HTML rewriting happens in the Worker

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Cloudflare Worker                   │
│                                                     │
│   /  ──────────────── 302 → /vi/                    │
│   /en-US/* ────────── 302 → /vi/*                   │
│   /vi/docs/* ──┬───── static asset (pre-built HTML) │
│                └───── proxy MDN /en-US/* → rewrite   │
│   /* ─────────────── proxy upstream MDN              │
└─────────────────────────────────────────────────────┘
```

**Build pipeline** (runs in `scripts/export-static.mjs`):

1. Symlink en-US content from `mdn-translated-content-vi` as base
2. Overlay Vietnamese `.md` files onto en-US using slug-based path mapping
3. Build markdown → JSON with `rari build`
4. Render JSON → HTML with `fred-ssr`
5. Export only Vietnamese-translated pages to `dist/vi/`
6. Rewrite `/en-US/` → `/vi/` and strip ads in all HTML

## Quick Start

### Prerequisites

- Node.js 22+
- [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) cloned alongside this repo (with `npm install` done)

### Build & Preview

```bash
# Install dependencies
npm install

# Build static pages (~4 min)
npm run build:static

# Preview locally at http://127.0.0.1:8787
npm run preview
```

### Deploy

```bash
# Build + deploy to Cloudflare Workers
npm run deploy

# Or deploy with wrangler directly (if dist/ is already built)
npx wrangler deploy
```

### Development

```bash
# Run wrangler dev server (uses dist/ for static assets, proxies the rest)
npm run dev
```

## Project Structure

```
mdn-worker/
├── src/
│   └── index.ts              # Cloudflare Worker entry point
├── scripts/
│   ├── export-static.mjs     # Build pipeline: md → HTML static export
│   └── preview-local.mjs     # Local preview server with proxy fallback
├── dist/                     # Built output (gitignored)
│   ├── vi/docs/              # Pre-rendered Vietnamese pages
│   └── static/               # CSS, JS, fonts from Fred
├── wrangler.jsonc            # Cloudflare Workers config
├── tsconfig.json
└── package.json
```

## How It Works

MDN's build tool `rari` doesn't support the `vi` locale natively. This project works around that by:

1. **Copying** the full en-US content tree to a temp directory
2. **Overlaying** Vietnamese markdown files at the correct en-US slug paths (handling rari's special character encoding: `::` → `_doublecolon_`, `:` → `_colon_`, `*` → `_star_`)
3. **Building** the merged content as en-US with `rari build --no-basic --content`
4. **Rendering** with Fred's SSR to get full HTML pages
5. **Selectively exporting** only pages that have Vietnamese translations
6. **Rewriting** all locale references from en-US to vi

The Cloudflare Worker then serves these pre-built pages and falls back to proxying upstream MDN for anything not in the static export.

## License

The code in this repository (Worker, build scripts) is licensed under the [MIT License](LICENSE).

MDN Web Docs content is licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) by Mozilla and individual contributors. See the [MDN License](https://github.com/nickinprice/mdn-content/blob/main/LICENSE.md) for full details.
