# mdn-worker

Vietnamese version of [MDN Web Docs](https://developer.mozilla.org), built with MDN's own tools and served on Cloudflare Workers.

**Live at [mdn.go-mizu.dev](https://mdn.go-mizu.dev)**

## Features

- Looks exactly like MDN because it *is* MDN, built with the same toolchain ([rari](https://github.com/nickinprice/rari) and [Fred](https://github.com/nickinprice/fred))
- Vietnamese translated pages from [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) are pre-built and served as `/vi/docs/...`
- Pages that don't have a translation yet are fetched from upstream MDN on the fly, with locale paths rewritten to `/vi/`
- Static assets are served straight from Cloudflare's edge, so it's fast

## How it works

MDN's build tool `rari` doesn't support the `vi` locale. So we work around it:

1. Copy the full en-US content tree to a temp directory
2. Overlay Vietnamese markdown files onto the matching en-US slug paths (with rari's special character encoding like `::` to `_doublecolon_`)
3. Build everything as en-US using `rari build`
4. Render the JSON output to HTML with Fred's SSR
5. Export only the pages that have Vietnamese translations to `dist/vi/`
6. Rewrite all `/en-US/` references to `/vi/` in the HTML

The Cloudflare Worker then serves these pre-built pages. For anything not in the static export, it proxies upstream MDN and rewrites the locale on the fly.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Cloudflare Worker                    │
│                                                      │
│   /            redirect to /vi/                      │
│   /en-US/*     redirect to /vi/*                     │
│   /vi/docs/*   serve static HTML or proxy from MDN   │
│   /*           proxy upstream MDN                    │
└──────────────────────────────────────────────────────┘
```

## Quick start

### Prerequisites

- Node.js 22+
- [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) cloned next to this repo, with `npm install` already done

### Build and preview

```bash
npm install

# Build static pages (takes about 4 minutes)
npm run build:static

# Preview locally at http://127.0.0.1:8787
npm run preview
```

### Deploy

```bash
# Build and deploy to Cloudflare Workers in one step
npm run deploy

# Or if dist/ is already built, just deploy
npx wrangler deploy
```

### Development

```bash
# Start wrangler dev server (serves from dist/, proxies the rest)
npm run dev
```

## Project structure

```
mdn-worker/
├── src/
│   └── index.ts              # Cloudflare Worker
├── scripts/
│   ├── export-static.mjs     # Build pipeline (md to HTML)
│   └── preview-local.mjs     # Local preview server
├── dist/                     # Built output (gitignored)
│   ├── vi/docs/              # Pre-rendered Vietnamese pages
│   └── static/               # CSS, JS, fonts
├── wrangler.jsonc
├── tsconfig.json
└── package.json
```

## License

Code in this repo is [MIT licensed](LICENSE).

MDN content is licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) by Mozilla and individual contributors. See the [MDN License](https://github.com/mdn/content/blob/main/LICENSE.md) for details.
