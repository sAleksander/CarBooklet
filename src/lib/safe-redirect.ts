/**
 * Same-origin guard for the `Referer`-based "return the user where they were"
 * redirects used by the no-JS preference toggles (`/api/lang/*`, `/api/theme/*`).
 *
 * `Referer` is attacker-influenceable, and `context.redirect()` performs no
 * validation — it writes the string straight into `Location`. Without this
 * guard the endpoints are open redirects: a page carrying
 * `<meta name="referrer" content="unsafe-url">` plus an auto-submitting form
 * gets the app to bounce the victim to an arbitrary origin, which is exactly
 * what makes an open redirect useful for phishing. Neither endpoint requires
 * authentication, so nothing else stands in the way.
 *
 * Anything that is not a same-origin URL falls back to `/dashboard`.
 */
const FALLBACK = "/dashboard";

export function safeReferer(request: Request, currentUrl: URL, fallback = FALLBACK): string {
  const referer = request.headers.get("Referer");
  if (!referer) return fallback;

  let parsed: URL;
  try {
    // A relative Referer is not a thing browsers send, but resolving against
    // the current URL means a malformed or relative value degrades to
    // same-origin rather than throwing.
    parsed = new URL(referer, currentUrl);
  } catch {
    return fallback;
  }

  if (parsed.origin !== currentUrl.origin) return fallback;

  // Return a path-only value: the origin is already known to match, and
  // emitting a relative Location keeps the response independent of how the
  // app is proxied.
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
