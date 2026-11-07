// Injects <script src="hosted.js"></script> immediately before the app.js script tag.
const HOSTED_TAG = '<script src="hosted.js"></script>';
const APP_TAG_RE = /<script\s+src=(["'])app\.js\1[^>]*>/;

export const isHtmlEntry = (pathname) => pathname === "/" || pathname === "/index.html";

// Pure string fallback (used when HTMLRewriter is unavailable, e.g. Node tests).
export function injectHostedScript(html) {
  return html.replace(APP_TAG_RE, (m) => HOSTED_TAG + m);
}

export async function rewriteHtmlResponse(res) {
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  if (typeof HTMLRewriter !== "undefined") {
    return new HTMLRewriter()
      .on('script[src="app.js"]', { element: (el) => el.before(HOSTED_TAG, { html: true }) })
      .transform(res);
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(injectHostedScript(await res.text()), { status: res.status, headers });
}
