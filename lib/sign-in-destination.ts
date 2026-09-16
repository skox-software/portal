/** Only allow a portal billing destination, never an external redirect. */
export function billingDestination(value: unknown) {
  if (typeof value !== "string" || value.length > 1000 || /[\\\r\n]/.test(value)) return "/";
  const path = value.startsWith("/portal/") ? value.slice(7) : value;
  if (!/^\/projects\/[a-f0-9-]{36}\/billing(?:[/?#]|$)/i.test(path)) return "/";
  const url = new URL(path, "https://portal.invalid");
  if (url.origin !== "https://portal.invalid" || !/^\/projects\/[a-f0-9-]{36}\/billing(?:\/|$)/i.test(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
