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

const viSlugToFile = new Map(); // slug → relFile (for date lookup)

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
  viSlugToFile.set(slug, relFile);

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

// ── Pre-step: Build last-modified date map from English source ────────
// Rari reads from a temp dir with no git history → all pages show 1970.
// Primary source: tamnd/mdn-content git history (accurate, reflects when
// the English content actually changed). Fallback: vi translation commit date.
const EN_CONTENT_REPO = path.resolve(CONTENT_REPO, "../mdn-content");

// Build a map: en-US disk path (e.g. "web/html/guides/index.md") → ISO date
const enGitDates = new Map();
if (existsSync(EN_CONTENT_REPO)) {
  try {
    // Build list of en-US paths we need, derived from the vi slugs we'll export
    const neededPaths = viSlugs.map(s => `files/en-us/${slugToDiskPath(s)}/index.md`);
    const BATCH = 400;
    let loaded = 0;
    for (let i = 0; i < neededPaths.length; i += BATCH) {
      const batch = neededPaths.slice(i, i + BATCH);
      const result = spawnSync(
        "git",
        ["log", "--format=COMMIT %cI", "--name-only", "--no-merges", "--"].concat(batch),
        { cwd: EN_CONTENT_REPO, encoding: "utf8", maxBuffer: 50_000_000, timeout: 60_000 },
      );
      if (result.stdout) {
        let currentDate = null;
        for (const line of result.stdout.split("\n")) {
          const t = line.trim();
          if (t.startsWith("COMMIT ")) {
            currentDate = t.slice(7);
          } else if (t.startsWith("files/en-us/") && currentDate) {
            const rel = t.slice("files/en-us/".length);
            if (!enGitDates.has(rel)) {
              enGitDates.set(rel, currentDate);
              loaded++;
            }
          }
        }
      }
    }
    console.log(`  Loaded en-US git dates for ${loaded} pages from mdn-content.`);
  } catch (e) {
    console.warn("  Warning: could not load en-US git dates:", e.message);
  }
} else {
  console.warn(`  mdn-content not found at ${EN_CONTENT_REPO}, dates will fall back to vi commit date.`);
}

// Fallback: vi file commit dates (used when en-US date not available)
const viGitDates = new Map();
try {
  const rawLog = execSync(
    'git log --format="COMMIT %cI" --name-only -- files/vi/',
    { cwd: CONTENT_REPO, encoding: "utf8", maxBuffer: 50_000_000 },
  );
  let currentDate = null;
  for (const line of rawLog.split("\n")) {
    const t = line.trim();
    if (t.startsWith("COMMIT ")) {
      currentDate = t.slice(7);
    } else if (t.startsWith("files/vi/") && currentDate) {
      const rel = t.slice("files/vi/".length);
      if (!viGitDates.has(rel)) viGitDates.set(rel, currentDate);
    }
  }
} catch { /* non-fatal */ }

// ── UI translation table ──────────────────────────────────────────────
// All [from, to] string replacements applied to every exported HTML page.
// Ordered so longer/more-specific strings come before shorter ones.
const UI_TRANSLATIONS = [
  // Locale paths
  ["/en-US/docs/", "/vi/docs/"],
  ["/en-US/search", "/vi/search"],
  ['hreflang="en-US"', 'hreflang="vi"'],
  ['hreflang="en"', 'hreflang="vi"'],
  ['lang="en-US"', 'lang="vi"'],
  ['lang="en"', 'lang="vi"'],
  ['"locale":"en-US"', '"locale":"vi"'],
  ['"English (US)"', '"Tiếng Việt"'],
  [">English (US)<", ">Tiếng Việt<"],

  // Navigation / accessibility
  [">Skip to main content<", ">Chuyển đến nội dung chính<"],
  [">Skip to search<", ">Chuyển đến tìm kiếm<"],
  [">Toggle navigation<", ">Bật/tắt điều hướng<"],
  ['aria-label="Toggle navigation"', 'aria-label="Bật/tắt điều hướng"'],
  [">Toggle sidebar<", ">Ẩn/hiện thanh bên<"],
  [">Filter sidebar<", ">Lọc thanh bên<"],
  [' placeholder="Filter"', ' placeholder="Lọc"'],
  [">Clear filter input<", ">Xóa bộ lọc<"],
  [">In this article<", ">Trong bài này<"],

  // Article footer
  [">Help improve MDN<", ">Giúp cải thiện MDN<"],
  [">Learn how to contribute<", ">Tìm hiểu cách đóng góp<"],
  [">View this page on GitHub<", ">Xem trang này trên GitHub<"],
  [">Report a problem with this content<", ">Báo cáo sự cố với nội dung này<"],
  ["This will take you to GitHub to file a new issue.", "Điều này sẽ đưa bạn đến GitHub để gửi sự cố mới."],
  ["This page was last modified on", "Trang này được sửa đổi lần cuối vào"],
  ["</time> by <a", "</time> bởi <a"],
  [">MDN contributors<", ">những người đóng góp MDN<"],

  // Baseline
  [">Widely available<", ">Khả dụng rộng rãi<"],
  [">Newly available<", ">Mới khả dụng<"],
  [">Limited availability<", ">Khả dụng hạn chế<"],
  [">See full compatibility<", ">Xem tương thích đầy đủ<"],
  [">Report feedback<", ">Báo cáo phản hồi<"],

  // Compat table
  [">Full support<", ">Hỗ trợ đầy đủ<"],
  [">Partial support<", ">Hỗ trợ một phần<"],
  [">No support<", ">Không hỗ trợ<"],
  [">Support unknown<", ">Không rõ hỗ trợ<"],
  [">Experimental<", ">Thử nghiệm<"],
  [">Deprecated<", ">Đã lỗi thời<"],
  [">Non-standard<", ">Không chuẩn<"],
  [">Legend<", ">Chú giải<"],
  [">Enable JavaScript to view this browser compatibility table.<", ">Bật JavaScript để xem bảng tương thích trình duyệt này.<"],
  [">Report problems with this compatibility data<", ">Báo cáo sự cố với dữ liệu tương thích này<"],
  [">View data on GitHub<", ">Xem dữ liệu trên GitHub<"],
  [">Loading…<", ">Đang tải…<"],

  // Copy button
  [">Copy<", ">Sao chép<"],
  [">Copied<", ">Đã sao chép<"],

  // Color theme
  [">OS default<", ">Mặc định hệ điều hành<"],
  [">Light<", ">Sáng<"],
  [">Dark<", ">Tối<"],
  [">Switch color theme<", ">Đổi giao diện màu<"],
  ['aria-label="Switch color theme"', 'aria-label="Đổi giao diện màu"'],

  // Search
  [">Search the site<", ">Tìm kiếm trên trang<"],
  ['title="Search the site"', 'title="Tìm kiếm trên trang"'],
  [' placeholder="Search"', ' placeholder="Tìm kiếm"'],
  [">Exit search<", ">Đóng tìm kiếm<"],
  [">Loading search index…<", ">Đang tải chỉ mục tìm kiếm…<"],
  [">Did you mean…<", ">Ý bạn là…<"],

  // Content feedback
  [">Was this page helpful to you?<", ">Trang này có hữu ích với bạn không?<"],
  [">Thank you for your feedback!<", ">Cảm ơn phản hồi của bạn!<"],
  [">Why was this page not helpful to you?<", ">Tại sao trang này không hữu ích với bạn?<"],

  // Footer text — uses newlines around text nodes so we match bare text,
  // not ">...<" delimiters. Multi-word phrases are safe from URL collisions.
  ["Your blueprint for a better internet.", "Nền tảng cho một internet tốt hơn."],
  ["Advertise with us", "Quảng cáo với chúng tôi"],
  ["Community Participation Guidelines", "Hướng dẫn tham gia cộng đồng"],
  ["Community resources", "Tài nguyên cộng đồng"],
  ["Writing guidelines", "Hướng dẫn viết bài"],
  ["Learn web development", "Học phát triển web"],
  ["Web technologies", "Công nghệ web"],
  ["Mozilla careers", "Nghề nghiệp Mozilla"],
  ["Telemetry Settings", "Cài đặt Telemetry"],
  ["Website Privacy Notice", "Thông báo quyền riêng tư"],
  ["Hacks blog", "Blog Hacks"],
  ["MDN Community", "Cộng đồng MDN"],
  ["Product help", "Trợ giúp sản phẩm"],
  // "About" as sole link text in footer (regex avoids replacing in URLs or prose)
  [/>\s*About\s*<\/a>/g, ">Giới thiệu</a>"],
  // Social links
  [">MDN blog RSS feed<", ">Nguồn RSS blog MDN<"],
  ['aria-label="MDN blog RSS feed"', 'aria-label="Nguồn RSS blog MDN"'],
  ['title="MDN Blog RSS Feed"', 'title="Nguồn RSS Blog MDN"'],
  [">MDN on GitHub<", ">MDN trên GitHub<"],
  [">MDN on Bluesky<", ">MDN trên Bluesky<"],
  [">MDN on Mastodon<", ">MDN trên Mastodon<"],
  [">MDN on X<", ">MDN trên X<"],
  ['aria-label="MDN on GitHub"', 'aria-label="MDN trên GitHub"'],
  ['aria-label="MDN on Bluesky"', 'aria-label="MDN trên Bluesky"'],
  ['aria-label="MDN on Mastodon"', 'aria-label="MDN trên Mastodon"'],
  ['aria-label="MDN on X"', 'aria-label="MDN trên X"'],
  ['aria-label="MDN logo"', 'aria-label="Logo MDN"'],
  ['aria-label="Mozilla logo"', 'aria-label="Logo Mozilla"'],

  // Language switcher
  [">Remember language<", ">Ghi nhớ ngôn ngữ<"],

  // Pagination
  [">Next page<", ">Trang tiếp theo<"],
  [">Previous page<", ">Trang trước<"],

  // 404
  [">Page not found<", ">Không tìm thấy trang<"],
  [">Go back to the home page<", ">Quay lại trang chủ<"],

  // Sidebar section headers (plain text match for whitespace tolerance)
  [">Further resources<", ">Tài nguyên thêm<"],
  [">Extension modules<", ">Mô-đun mở rộng<"],
  [">Additional tutorials<", ">Hướng dẫn bổ sung<"],

  // Navigation tab buttons (scoped to menu__tab-label class to avoid content collisions)
  [/class="menu__tab-label"\s*>All<\/span/g, 'class="menu__tab-label">Tất cả</span'],
  [/class="menu__tab-label"\s*>Learn<\/span/g, 'class="menu__tab-label">Học</span'],
  [/class="menu__tab-label"\s*>Tools<\/span/g, 'class="menu__tab-label">Công cụ</span'],

  // Navigation mega-menu section titles
  [">HTML: Markup language<", ">HTML: Ngôn ngữ đánh dấu<"],
  [">CSS: Styling language<", ">CSS: Ngôn ngữ tạo kiểu<"],
  [">JavaScript: Scripting language<", ">JavaScript: Ngôn ngữ kịch bản<"],
  [">Web APIs: Programming interfaces<", ">Web API: Giao diện lập trình<"],
  ["Get to know MDN better", "Tìm hiểu thêm về MDN"],
  ["Discover our tools", "Khám phá công cụ của chúng tôi"],
  [">About MDN<", ">Giới thiệu MDN<"],
  [">See all…<", ">Xem tất cả…<"],
  [">Web documentation<", ">Tài liệu web<"],
  [">All web technology<", ">Tất cả công nghệ web<"],
  ["Getting started modules", "Mô-đun bắt đầu"],
  ["Core modules", "Mô-đun cốt lõi"],

  // Navigation "See all" aria-labels and titles (quoted strings match both attrs)
  ['"See all HTML references"', '"Xem tất cả tham chiếu HTML"'],
  ['"See all HTML guides"', '"Xem tất cả hướng dẫn HTML"'],
  ['"See all CSS references"', '"Xem tất cả tham chiếu CSS"'],
  ['"See all CSS guides"', '"Xem tất cả hướng dẫn CSS"'],
  ['"See all JavaScript references"', '"Xem tất cả tham chiếu JavaScript"'],
  ['"See all JavaScript guides"', '"Xem tất cả hướng dẫn JavaScript"'],
  ['"See all Web API guides"', '"Xem tất cả hướng dẫn Web API"'],
  ['"See all web technology references"', '"Xem tất cả tham chiếu công nghệ web"'],

  // Navigation category headers (dt elements in mega-menu)
  ["<dt>HTML reference</dt>", "<dt>Tham chiếu HTML</dt>"],
  ["<dt>HTML guides</dt>", "<dt>Hướng dẫn HTML</dt>"],
  ["<dt>CSS reference</dt>", "<dt>Tham chiếu CSS</dt>"],
  ["<dt>CSS guides</dt>", "<dt>Hướng dẫn CSS</dt>"],
  ["<dt>JS reference</dt>", "<dt>Tham chiếu JavaScript</dt>"],
  ["<dt>JS guides</dt>", "<dt>Hướng dẫn JavaScript</dt>"],
  ["<dt>Web API reference</dt>", "<dt>Tham chiếu Web API</dt>"],
  ["<dt>Web API guides</dt>", "<dt>Hướng dẫn Web API</dt>"],
  ["<dt>Markup languages</dt>", "<dt>Ngôn ngữ đánh dấu</dt>"],
  ["<dt>Frontend developer course</dt>", "<dt>Khóa học nhà phát triển frontend</dt>"],
  ["<dt>Learn HTML</dt>", "<dt>Học HTML</dt>"],
  ["<dt>Learn CSS</dt>", "<dt>Học CSS</dt>"],
  ["<dt>Learn JavaScript</dt>", "<dt>Học JavaScript</dt>"],
  ["<dt>Layout cookbook</dt>", "<dt>Sách hướng dẫn bố cục</dt>"],
  ["<dt>Technologies</dt>", "<dt>Công nghệ</dt>"],
  ["<dt>Topics</dt>", "<dt>Chủ đề</dt>"],
  ["<dt>Contribute</dt>", "<dt>Đóng góp</dt>"],
  ["<dt>Developers</dt>", "<dt>Nhà phát triển</dt>"],

  // Specifications
  [">Specification<", ">Thông số kỹ thuật<"],
  [">This feature does not appear to be defined in any specification.<",
    ">Tính năng này dường như chưa được định nghĩa trong bất kỳ thông số kỹ thuật nào.<"],
];

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

// Copy the Vietnamese Inter font subset into the static assets
const VI_FONT_SRC = path.resolve("./fonts/inter-vietnamese.woff2");
const VI_FONT_DEST = path.join(DIST_DIR, "static", "client", "inter-vietnamese.woff2");
if (existsSync(VI_FONT_SRC)) {
  cpSync(VI_FONT_SRC, VI_FONT_DEST);
  console.log("  Copied inter-vietnamese.woff2.");
}

// @font-face rule to inject — fills the U+1EA0-U+1EF9 gap in the subsetted Inter fonts.
// The bundled inter-latin-extended.woff2 covers up to U+1E9F; Vietnamese tonal characters
// (ấ, ề, ổ, ữ, etc.) start at U+1EA0, so the browser falls back to system fonts without this.
const VI_FONT_STYLE = `<style>@font-face{font-display:swap;font-family:Inter;font-style:normal;font-weight:100 900;src:url(/static/client/inter-vietnamese.woff2) format("woff2");unicode-range:u+1ea0-u+1ef9,u+20ab}</style>`;

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

  // Apply all UI translations from the lookup table.
  // Entries may be [string, string] or [RegExp, string].
  for (const [from, to] of UI_TRANSLATIONS) {
    html = from instanceof RegExp ? html.replace(from, to) : html.replaceAll(from, to);
  }

  // Fix epoch date (1970-01-01) with the actual last-modified date.
  // Priority: en-US source date (most accurate) → vi commit date → build date.
  if (html.includes("1970-01-01T00:00:00.000Z")) {
    const enPath = `${diskPath}/index.md`;
    const viRelFile = viSlugToFile.get(slug);
    const isoDate =
      enGitDates.get(enPath) ??
      (viRelFile && viGitDates.get(viRelFile)) ??
      new Date().toISOString();
    const displayDate = new Date(isoDate).toLocaleDateString("vi-VN", {
      year: "numeric", month: "long", day: "numeric",
    });
    html = html.replace(
      /datetime="1970-01-01T00:00:00\.000Z">[^<]*<\/time>/g,
      `datetime="${isoDate}">${displayDate}</time>`,
    );
  }

  // Inject Vietnamese Inter font-face rule to cover U+1EA0-U+1EF9 (tonal characters)
  html = html.replace("</head>", VI_FONT_STYLE + "</head>");

  // Remove language switcher — single-language site, the dropdown is pointless
  html = html.replace(/<mdn-language-switcher[\s\S]*?<\/mdn-language-switcher>/gi, "");

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
