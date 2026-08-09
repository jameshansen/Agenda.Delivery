import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const html = readFileSync(join(homedir(), "AppData", "Local", "Temp", "tol_detail.html"), "utf-8");

// Extract title tag
const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
console.log("TITLE TAG:", titleMatch ? titleMatch[1] : "NOT FOUND");

// Extract og:title
const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
console.log("OG:TITLE:", ogMatch ? ogMatch[1] : "NOT FOUND");

// Extract all h1 tags
const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
console.log("H1 COUNT:", h1Matches.length);
for (const h of h1Matches) {
  const text = h[1].replace(/<[^>]+>/g, "").trim();
  console.log("  H1:", text.slice(0, 200));
}

// Extract all h2 tags
const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
console.log("H2 COUNT:", h2Matches.length);
for (const h of h2Matches.slice(0, 10)) {
  const text = h[1].replace(/<[^>]+>/g, "").trim();
  console.log("  H2:", text.slice(0, 200));
}

// Look for date patterns
const dateMatches = html.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi);
console.log("DATE PATTERNS:", dateMatches ? dateMatches.slice(0, 5) : "NONE");

// Check for agenda PDF links
const pdfLinks = [...html.matchAll(/href=["']([^"']+\.pdf)["']/gi)];
console.log("PDF LINKS:", pdfLinks.length);
for (const p of pdfLinks.slice(0, 5)) {
  console.log("  PDF:", p[1]);
}

// Check for meeting-specific text
const meetingText = html.match(/(?:Regular Council|Council Meeting|Public Hearing|Committee Meeting|Special Meeting)/gi);
console.log("MEETING TEXT:", meetingText ? [...new Set(meetingText)].slice(0, 5) : "NONE");

// Show a snippet around "Council" to understand the page structure
const councilIdx = html.toLowerCase().indexOf("council");
if (councilIdx >= 0) {
  const snippet = html.slice(Math.max(0, councilIdx - 100), councilIdx + 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log("CONTEXT AROUND 'council':", snippet.slice(0, 300));
}