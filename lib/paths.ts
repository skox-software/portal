/**
 * The portal is served inside the main site at skoxsoftware.com/portal, so
 * every path it emits carries that prefix.
 *
 * Next adds it on its own to `<Link>`, `redirect()` and router navigation.
 * It does NOT touch strings we write by hand — a plain `<a href>`, an `<img
 * src>` or a `fetch()` — so those go through `withBase()`.
 */
export const BASE_PATH = "/portal";

/** Prefixes a portal-absolute path for places Next won't rewrite. */
export function withBase(path: string) {
  return `${BASE_PATH}${path}`;
}
