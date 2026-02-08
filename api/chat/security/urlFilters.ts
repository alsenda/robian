import net from "node:net";
import { isPrivateIp } from "./ssrf.ts";

// Filter out domains that are commonly bot-blocked, JS-heavy, or hostile to scraping.
// This keeps search_web results actionable and avoids wasted fetch_url calls.
const HOSTILE_DOMAINS = [
  "facebook.com",
  "www.facebook.com",
  "fb.com",
  "m.facebook.com",
  "medium.com",
  "www.medium.com",
];

// Prefer HTML pages over binary/document links.
const NON_HTML_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".tgz",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
]);

export function normalizeHostname(hostname: string): string {
  return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

export function isHostileDomain(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) { return true; }
  return HOSTILE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export function looksLikeNonHtmlPath(pathname: string): boolean {
  const path = String(pathname || "").toLowerCase();
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) { return false; }
  const ext = path.slice(lastDot);
  return NON_HTML_EXTENSIONS.has(ext);
}

export function normalizeAndValidateCandidateUrl(urlText: string): string | null {
  try {
    const parsed = new URL(String(urlText || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { return null; }
    parsed.hash = "";

    const host = normalizeHostname(parsed.hostname);
    if (!host) { return null; }
    if (host === "localhost") { return null; }

    const ipVersion = net.isIP(host);
    if (ipVersion && isPrivateIp(host)) { return null; }
    if (isHostileDomain(host)) { return null; }
    if (looksLikeNonHtmlPath(parsed.pathname)) { return null; }

    return parsed.toString();
  } catch {
    return null;
  }
}
