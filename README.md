# mdn-worker

MDN Web Docs, but in Vietnamese. Built with the same toolchain as the real MDN and hosted on Cloudflare Workers.

**https://mdn.go-mizu.dev**

## What this does

Vietnamese translations from [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) get pre-built into static HTML and served at `/vi/docs/...`. If a page hasn't been translated yet, the worker fetches it from the real MDN and swaps the locale to `/vi/` so the site feels complete.

It looks like MDN because it is MDN. Same build tool ([rari](https://github.com/nickinprice/rari)), same renderer ([Fred](https://github.com/nickinprice/fred)).

## How the build works

rari doesn't support `vi` as a locale, so we trick it:

1. Copy the en-US content tree to a temp directory
2. Drop the Vietnamese markdown files on top of the matching en-US paths
3. Build everything as en-US with `rari build`
4. Render JSON to HTML with Fred SSR
5. Keep only the pages that have a Vietnamese translation
6. Replace `/en-US/` with `/vi/` in the output HTML

The worker serves these static pages. Anything missing gets proxied from upstream MDN with the locale rewritten on the fly.

## Routing

```
/            -> redirect to /vi/
/en-US/*     -> redirect to /vi/*
/vi/docs/*   -> static HTML, or proxy from MDN
/*           -> proxy upstream MDN
```

## Setup

You need Node.js 22+ and [mdn-translated-content-vi](https://github.com/nickinprice/mdn-translated-content-vi) cloned next to this repo with `npm install` done.

```bash
npm install

# Build static pages (~4 minutes)
npm run build:static

# Preview at http://127.0.0.1:8787
npm run preview
```

## Deploy

```bash
# Build + deploy
npm run deploy

# Or just deploy if dist/ is already built
npx wrangler deploy
```

## Dev

```bash
npm run dev
```

## Structure

```
src/index.ts              Worker (routing, proxying)
scripts/export-static.mjs Build pipeline (md -> HTML)
scripts/preview-local.mjs Local preview server
dist/                     Build output (gitignored)
wrangler.jsonc            Cloudflare config
```

## License

Code is MIT. MDN content is [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) by Mozilla and contributors.
