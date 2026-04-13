/**
 * export-static.mjs
 *
 * Builds Vietnamese MDN content into static HTML pages.
 *
 * Pipeline:
 *   1. Symlink en-US content from mdn-translated-content-vi as the base
 *   2. Overwrite translated pages by symlinking Vietnamese files over en-US slugs
 *   3. Run `rari build` to compile markdown → JSON (handles macros, sidebars, etc.)
 *   4. Run `fred-ssr` to render JSON → full HTML pages
 *   5. Copy only the pages that have Vietnamese translations to dist/vi/
 *   6. Rewrite /en-US/ → /vi/ in all HTML files
 *   7. Copy shared static assets (CSS, JS, fonts) from Fred's out/ directory
 */

import { execSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const CONTENT_REPO = path.resolve(
  process.env.CONTENT_REPO ?? "../mdn-translated-content-vi",
);
const DIST_DIR = path.resolve("./dist");
const TMP_DIR = path.resolve("/tmp/mdn-worker-build");
const TMP_CONTENT = path.join(TMP_DIR, "files");
const TMP_BUILD = path.join(TMP_DIR, "build");

const RARI_BIN = path.join(CONTENT_REPO, "node_modules", ".bin", "rari");
const FRED_SSR = path.join(
  CONTENT_REPO,
  "node_modules",
  "@mdn",
  "fred",
  "build",
  "ssr.js",
);
const FRED_OUT = path.join(
  CONTENT_REPO,
  "node_modules",
  "@mdn",
  "fred",
  "out",
);

console.log(`Content repo: ${CONTENT_REPO}`);
console.log(`Temp dir:     ${TMP_DIR}`);
console.log(`Dist dir:     ${DIST_DIR}`);

// ── Step 0: Verify content repo ──────────────────────────────────────
if (!existsSync(path.join(CONTENT_REPO, "files", "vi"))) {
  console.error(
    `Vietnamese content not found at ${CONTENT_REPO}/files/vi`,
  );
  process.exit(1);
}

// ── Step 1: Prepare merged content directory ─────────────────────────
console.log("\n[1/6] Preparing merged content directory...");
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_CONTENT, { recursive: true });

// Symlink en-US content as the base (provides all pages + cross-references)
symlinkSync(
  path.join(CONTENT_REPO, "files", "en-us"),
  path.join(TMP_CONTENT, "en-us"),
);
// Symlink sidebars and jsondata
symlinkSync(
  path.join(CONTENT_REPO, "files", "sidebars"),
  path.join(TMP_CONTENT, "sidebars"),
);
symlinkSync(
  path.join(CONTENT_REPO, "files", "jsondata"),
  path.join(TMP_CONTENT, "jsondata"),
);

console.log("  Linked en-US content, sidebars, and jsondata.");

// ── Step 2: Collect Vietnamese file slugs ────────────────────────────
console.log("\n[2/6] Collecting Vietnamese translated files...");
const viRoot = path.join(CONTENT_REPO, "files", "vi");
const viFiles = []; // relative paths like: web/javascript/index.md
const viSlugs = []; // slugs like: Web/JavaScript

function walkDir(dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(base, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, relPath);
    } else if (entry.name === "index.md") {
      viFiles.push(relPath);
    }
  }
}
walkDir(viRoot, "");

/**
 * Extract the slug from a markdown file's YAML front-matter.
 */
function extractSlug(filePath) {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fmMatch = match[1].match(/^slug:\s*(.+)$/m);
  return fmMatch ? fmMatch[1].trim() : null;
}

console.log(`  Found ${viFiles.length} Vietnamese translated pages.`);

/**
 * Convert a slug to the disk path format rari expects.
 * Rari encodes special characters: :: → _doublecolon_, : → _colon_, * → _star_
 */
function slugToDiskPath(slug) {
  return slug
    .toLowerCase()
    .replaceAll("::", "_doublecolon_")
    .replaceAll(":", "_colon_")
    .replaceAll("*", "_star_");
}

// ── Step 3: Override en-US files with Vietnamese translations ─────────
console.log("\n[3/6] Overlaying Vietnamese content onto en-US...");

// We need to actually copy the en-US dir since we'll modify it
// Remove the symlink and copy instead
rmSync(path.join(TMP_CONTENT, "en-us"));
console.log("  Copying en-US content (this may take a moment)...");
cpSync(
  path.join(CONTENT_REPO, "files", "en-us"),
  path.join(TMP_CONTENT, "en-us"),
  { recursive: true },
);

let overwritten = 0;
let created = 0;
let skipped = 0;
for (const relFile of viFiles) {
  const viFile = path.join(viRoot, relFile);

  // Read the slug from the Vietnamese file to determine the correct target path
  const slug = extractSlug(viFile);
  if (!slug) {
    console.warn(`  Warning: no slug found in ${relFile}, skipping.`);
    skipped++;
    continue;
  }
  viSlugs.push(slug);

  // Place file at the path matching its slug, using rari's encoding
  const diskPath = slugToDiskPath(slug);
  const enUSFile = path.join(TMP_CONTENT, "en-us", diskPath, "index.md");
  const enUSDir = path.dirname(enUSFile);

  if (!existsSync(enUSDir)) {
    mkdirSync(enUSDir, { recursive: true });
    created++;
  } else {
    overwritten++;
  }

  // Copy Vietnamese file over the en-US one
  cpSync(viFile, enUSFile);
}

console.log(
  `  Overlaid ${overwritten} existing, created ${created} new, skipped ${skipped}.`,
);

// ── Step 4: Build with rari ──────────────────────────────────────────
console.log("\n[4/6] Building with rari...");
mkdirSync(TMP_BUILD, { recursive: true });

const rariResult = spawnSync(
  RARI_BIN,
  ["build", "--no-basic", "--content"],
  {
    cwd: CONTENT_REPO,
    env: {
      ...process.env,
      CONTENT_ROOT: TMP_CONTENT,
      BUILD_OUT_ROOT: TMP_BUILD,
      RARI_SKIP_UPDATES: "true",
    },
    stdio: "inherit",
    timeout: 600_000,
  },
);

if (rariResult.status !== 0) {
  console.error("rari build failed with exit code", rariResult.status);
  process.exit(1);
}

// ── Step 4.5: Install vi.ftl into fred's locales ─────────────────────
const VI_FTL_SRC = path.join(CONTENT_REPO, "translate", "vi.ftl");
const VI_FTL_DEST = path.join(
  CONTENT_REPO,
  "node_modules",
  "@mdn",
  "fred",
  "l10n",
  "locales",
  "vi.ftl",
);
if (existsSync(VI_FTL_SRC)) {
  cpSync(VI_FTL_SRC, VI_FTL_DEST);
  console.log("  Installed vi.ftl into fred locales.");
}

// ── Step 5: Render with Fred SSR ─────────────────────────────────────
console.log("\n[5/6] Rendering HTML with Fred SSR...");

const ssrResult = spawnSync("node", [FRED_SSR], {
  cwd: CONTENT_REPO,
  env: {
    ...process.env,
    BUILD_OUT_ROOT: TMP_BUILD,
  },
  stdio: "inherit",
  timeout: 600_000,
});

if (ssrResult.status !== 0) {
  console.error("Fred SSR failed with exit code", ssrResult.status);
  process.exit(1);
}

// ── Step 6: Copy translated pages to dist/ and rewrite paths ─────────
console.log("\n[6/6] Exporting Vietnamese pages to dist/...");
rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

// Copy static assets from Fred (CSS, JS, fonts)
const fredStaticDir = path.join(FRED_OUT, "static");
if (existsSync(fredStaticDir)) {
  cpSync(fredStaticDir, path.join(DIST_DIR, "static"), { recursive: true });
  console.log("  Copied static assets from Fred.");
}

// Also copy the assets from the build output (shared between locales)
const buildStaticDirs = ["static", "assets"];
for (const dir of buildStaticDirs) {
  const src = path.join(TMP_BUILD, dir);
  if (existsSync(src)) {
    cpSync(src, path.join(DIST_DIR, dir), { recursive: true });
    console.log(`  Copied ${dir}/ from build output.`);
  }
}

// Copy SPA pages (search, homepage, etc.)
const spaDirs = ["_spas"];
for (const dir of spaDirs) {
  const src = path.join(TMP_BUILD, dir);
  if (existsSync(src)) {
    cpSync(src, path.join(DIST_DIR, dir), { recursive: true });
    console.log(`  Copied ${dir}/ from build output.`);
  }
}

// Copy only pages that have Vietnamese translations (using slug-based paths)
let exportedPages = 0;
let missingPages = 0;
for (const slug of viSlugs) {
  // Slug is like: Web/JavaScript
  // Built output uses rari's encoded path: TMP_BUILD/en-us/docs/web/javascript/
  const diskPath = slugToDiskPath(slug);
  const buildHTML = path.join(TMP_BUILD, "en-us", "docs", diskPath, "index.html");

  if (!existsSync(buildHTML)) {
    missingPages++;
    continue;
  }

  let html = readFileSync(buildHTML, "utf8");

  // Rewrite locale paths: /en-US/ → /vi/
  html = html
    .replaceAll("/en-US/docs/", "/vi/docs/")
    .replaceAll("/en-US/search", "/vi/search")
    .replaceAll('hreflang="en-US"', 'hreflang="vi"')
    .replaceAll('hreflang="en"', 'hreflang="vi"')
    .replaceAll('lang="en-US"', 'lang="vi"')
    .replaceAll('lang="en"', 'lang="vi"')
    .replaceAll('"locale":"en-US"', '"locale":"vi"')
    .replaceAll('"English (US)"', '"Tiếng Việt"')
    .replaceAll(">English (US)<", ">Tiếng Việt<");

  // ── Vietnamese UI string replacements ────────────────────────────────
  // Navigation / accessibility
  html = html
    .replaceAll(">Skip to main content<", ">Chuyển đến nội dung chính<")
    .replaceAll(">Skip to search<", ">Chuyển đến tìm kiếm<")
    .replaceAll(">Toggle navigation<", ">Bật/tắt điều hướng<")
    .replaceAll(">Toggle sidebar<", ">Ẩn/hiện thanh bên<")
    .replaceAll(">Filter sidebar<", ">Lọc thanh bên<")
    .replaceAll(' placeholder="Filter"', ' placeholder="Lọc"')
    .replaceAll(">Clear filter input<", ">Xóa bộ lọc<")
    .replaceAll(">In this article<", ">Trong bài này<");

  // Article footer
  html = html
    .replaceAll(">Help improve MDN<", ">Giúp cải thiện MDN<")
    .replaceAll(">Learn how to contribute<", ">Tìm hiểu cách đóng góp<")
    .replaceAll(">View this page on GitHub<", ">Xem trang này trên GitHub<")
    .replaceAll(">Report a problem with this content<", ">Báo cáo sự cố với nội dung này<")
    .replaceAll("This will take you to GitHub to file a new issue.", "Điều này sẽ đưa bạn đến GitHub để gửi sự cố mới.");

  // Baseline
  html = html
    .replaceAll(">Widely available<", ">Khả dụng rộng rãi<")
    .replaceAll(">Newly available<", ">Mới khả dụng<")
    .replaceAll(">Limited availability<", ">Khả dụng hạn chế<")
    .replaceAll(">See full compatibility<", ">Xem tương thích đầy đủ<")
    .replaceAll(">Report feedback<", ">Báo cáo phản hồi<");

  // Compat table labels (baked into SSR HTML)
  html = html
    .replaceAll(">Full support<", ">Hỗ trợ đầy đủ<")
    .replaceAll(">Partial support<", ">Hỗ trợ một phần<")
    .replaceAll(">No support<", ">Không hỗ trợ<")
    .replaceAll(">Support unknown<", ">Không rõ hỗ trợ<")
    .replaceAll(">Experimental<", ">Thử nghiệm<")
    .replaceAll(">Deprecated<", ">Đã lỗi thời<")
    .replaceAll(">Non-standard<", ">Không chuẩn<")
    .replaceAll(">Legend<", ">Chú giải<")
    .replaceAll(">Enable JavaScript to view this browser compatibility table.<",
      ">Bật JavaScript để xem bảng tương thích trình duyệt này.<")
    .replaceAll(">Report problems with this compatibility data<",
      ">Báo cáo sự cố với dữ liệu tương thích này<")
    .replaceAll(">View data on GitHub<", ">Xem dữ liệu trên GitHub<")
    .replaceAll(">Loading…<", ">Đang tải…<");

  // Copy button
  html = html
    .replaceAll(">Copy<", ">Sao chép<")
    .replaceAll(">Copied<", ">Đã sao chép<");

  // Color theme
  html = html
    .replaceAll(">OS default<", ">Mặc định hệ điều hành<")
    .replaceAll(">Light<", ">Sáng<")
    .replaceAll(">Dark<", ">Tối<")
    .replaceAll(">Switch color theme<", ">Đổi giao diện màu<");

  // Search
  html = html
    .replaceAll(">Search the site<", ">Tìm kiếm trên trang<")
    .replaceAll(' placeholder="Search"', ' placeholder="Tìm kiếm"')
    .replaceAll(">Exit search<", ">Đóng tìm kiếm<")
    .replaceAll(">Loading search index…<", ">Đang tải chỉ mục tìm kiếm…<")
    .replaceAll(">Did you mean…<", ">Ý bạn là…<");

  // Content feedback
  html = html
    .replaceAll(">Was this page helpful to you?<", ">Trang này có hữu ích với bạn không?<")
    .replaceAll(">Thank you for your feedback!<", ">Cảm ơn phản hồi của bạn!<")
    .replaceAll(">Why was this page not helpful to you?<",
      ">Tại sao trang này không hữu ích với bạn?<");

  // Footer
  html = html
    .replaceAll(">Advertise with us<", ">Quảng cáo với chúng tôi<")
    .replaceAll(">Community Participation Guidelines<", ">Hướng dẫn tham gia cộng đồng<")
    .replaceAll(">Your blueprint for a better internet.<", ">Nền tảng cho một internet tốt hơn.<")
    .replaceAll(">Community resources<", ">Tài nguyên cộng đồng<")
    .replaceAll(">Writing guidelines<", ">Hướng dẫn viết bài<")
    .replaceAll(">Learn web development<", ">Học phát triển web<")
    .replaceAll(">Web technologies<", ">Công nghệ web<")
    .replaceAll(">Mozilla careers<", ">Nghề nghiệp Mozilla<")
    .replaceAll(">Telemetry Settings<", ">Cài đặt Telemetry<")
    .replaceAll(">Website Privacy Notice<", ">Thông báo quyền riêng tư<")
    .replaceAll(">Hacks blog<", ">Blog Hacks<")
    .replaceAll(">MDN blog RSS feed<", ">Nguồn RSS blog MDN<");

  // Language switcher
  html = html
    .replaceAll(">Remember language<", ">Ghi nhớ ngôn ngữ<");

  // Pagination
  html = html
    .replaceAll(">Next page<", ">Trang tiếp theo<")
    .replaceAll(">Previous page<", ">Trang trước<");

  // 404
  html = html
    .replaceAll(">Page not found<", ">Không tìm thấy trang<")
    .replaceAll(">Go back to the home page<", ">Quay lại trang chủ<");

  // Specifications
  html = html
    .replaceAll(">Specification<", ">Thông số kỹ thuật<")
    .replaceAll(
      ">This feature does not appear to be defined in any specification.<",
      ">Tính năng này dường như chưa được định nghĩa trong bất kỳ thông số kỹ thuật nào.<",
    );

  // Strip ads/banners
  html = html.replace(
    /<div[^>]*class="[^"]*page-layout__banner[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  );
  html = html.replace(/<mdn-placement[^>]*>[\s\S]*?<\/mdn-placement[^>]*>/gi, "");
  html = html.replace(/<mdn-placement-top[^>]*>[\s\S]*?<\/mdn-placement-top>/gi, "");
  html = html.replace(/<mdn-placement-side[^>]*>[\s\S]*?<\/mdn-placement-side>/gi, "");

  // Write to dist/vi/docs/Slug/Path (original casing for URL matching)
  const distFile = path.join(DIST_DIR, "vi", "docs", slug, "index.html");
  mkdirSync(path.dirname(distFile), { recursive: true });
  writeFileSync(distFile, html, "utf8");
  exportedPages++;
}

if (missingPages > 0) {
  console.log(`  (${missingPages} pages had no built HTML, skipped)`);
}

// Create a simple /vi/ landing page that redirects to /vi/docs/Web
const viIndexHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=/vi/docs/Web">
  <title>MDN Web Docs - Tiếng Việt</title>
</head>
<body>
  <p>Redirecting to <a href="/vi/docs/Web">MDN Web Docs (Tiếng Việt)</a>...</p>
</body>
</html>`;
mkdirSync(path.join(DIST_DIR, "vi"), { recursive: true });
writeFileSync(path.join(DIST_DIR, "vi", "index.html"), viIndexHTML, "utf8");

console.log(`\nExported ${exportedPages} Vietnamese pages to ${DIST_DIR}/`);
console.log("Done!");
