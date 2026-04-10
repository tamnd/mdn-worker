interface Env {
  ASSETS: Fetcher;
}

const UPSTREAM = "developer.mozilla.org";

function rewriteHTML(body: string, requestURL: URL): string {
  const targetOrigin = requestURL.origin;
  let html = body
    .replaceAll(`https://${UPSTREAM}`, targetOrigin)
    .replaceAll(`href="//${UPSTREAM}`, `href="//${requestURL.host}`)
    .replaceAll(`src="//${UPSTREAM}`, `src="//${requestURL.host}`);

  // Strip ads / banners
  html = html.replace(
    /<div[^>]*class="[^"]*page-layout__banner[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  );
  html = html.replace(/<mdn-placement[^>]*>[\s\S]*?<\/mdn-placement[^>]*>/gi, "");
  html = html.replace(/<mdn-placement-top[^>]*>[\s\S]*?<\/mdn-placement-top>/gi, "");
  html = html.replace(/<mdn-placement-side[^>]*>[\s\S]*?<\/mdn-placement-side>/gi, "");

  return html;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return proxyToMDN(request, url);
    }

    // Redirect root to Vietnamese docs
    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(`${url.origin}/vi/`, 302);
    }

    // Redirect /en-US/docs/... to /vi/docs/... so all content appears as Vietnamese
    if (url.pathname.startsWith("/en-US/")) {
      const viPath = url.pathname.replace(/^\/en-US\//, "/vi/");
      return Response.redirect(`${url.origin}${viPath}${url.search}`, 302);
    }

    // Try serving from static assets first
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      const contentType = assetResponse.headers.get("content-type") ?? "";
      if (!contentType.startsWith("text/html")) {
        return assetResponse;
      }
      const body = await assetResponse.text();
      const rewritten = rewriteHTML(body, url);
      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      return new Response(rewritten, {
        headers,
        status: assetResponse.status,
        statusText: assetResponse.statusText,
      });
    }

    // For /vi/ pages not in our dist, fetch the en-US version from MDN and rewrite
    if (url.pathname.startsWith("/vi/")) {
      const enPath = url.pathname.replace(/^\/vi\//, "/en-US/");
      const proxyURL = new URL(url);
      proxyURL.protocol = "https:";
      proxyURL.hostname = UPSTREAM;
      proxyURL.pathname = enPath;
      const response = await fetch(new Request(proxyURL, request));

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("text/html")) {
        return response;
      }

      let body = await response.text();
      // Rewrite /en-US/ links to /vi/
      body = body.replaceAll("/en-US/docs/", "/vi/docs/");
      body = body.replaceAll("/en-US/search", "/vi/search");
      const rewritten = rewriteHTML(body, url);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(rewritten, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    // Fall back to proxying upstream MDN
    return proxyToMDN(request, url);
  },
};

async function proxyToMDN(
  request: Request,
  url: URL,
): Promise<Response> {
  const proxyURL = new URL(url);
  proxyURL.protocol = "https:";
  proxyURL.hostname = UPSTREAM;
  const response = await fetch(new Request(proxyURL, request));

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/html")) {
    return response;
  }

  // Rewrite HTML responses from upstream
  const body = await response.text();
  const rewritten = rewriteHTML(body, url);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(rewritten, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
