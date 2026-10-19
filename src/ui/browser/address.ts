/** Address bar input rules: a URL, a host:port (`localhost:5173`), a bare domain, or else a search query. */

export const SEARCH_URL = "https://www.google.com/search?q=";

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(:\d{1,5})?(?:[/?#].*)?$/i;
const HOST_PORT = /^[a-z0-9.-]+:\d{1,5}(?:[/?#].*)?$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/;

/** @returns the URL to load for the address bar text, or null for blank input */
export function resolveAddress(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (/^https?:\/\//i.test(text)) {
    try { return new URL(text).toString(); } catch { return SEARCH_URL + encodeURIComponent(text); }
  }
  if (text === "about:blank") return text;
  if (!/\s/.test(text)) {
    if (LOCAL_HOST.test(text) || IPV4.test(text) || HOST_PORT.test(text)) return new URL(`http://${text}`).toString();
    if (DOMAIN.test(text)) return new URL(`https://${text}`).toString();
  }
  return SEARCH_URL + encodeURIComponent(text);
}

/** The address bar's display of a page URL: the full URL, without the trailing slash of a bare origin. */
export function displayAddress(url: string): string {
  if (url === "" || url === "about:blank") return "";
  return url.replace(/^(https?:\/\/[^/?#]+)\/$/i, "$1");
}

/** The composer reference for a picked element: `[element] selector - text`. */
export function elementReference(selector: string, text: string): string {
  const clipped = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return clipped === "" ? `[element] ${selector}` : `[element] ${selector} - ${clipped}`;
}
