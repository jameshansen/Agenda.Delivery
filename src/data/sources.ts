/**
 * sources.toml loader — the single entry point for the council source registry.
 *
 * The Spider Agent calls loadSources() to get the list of councils to process.
 * The file is at the project root (sources.toml) and is version-controlled.
 *
 * In the future this will fetch from a remote URL; for now it reads the local
 * file so the spider can process sources without the hardcoded TS arrays.
 */

import { readFileSync } from "fs";
import { join } from "path";

export type SourceEntry = {
  name: string;
  url: string;
  region: string;
  country: string;
};

/** Cache so we only read the file once per process. */
let cache: SourceEntry[] | null = null;

/** Load and parse sources.toml. Returns an array of source entries. */
export function loadSources(): SourceEntry[] {
  if (cache) return cache;

  const path = join(process.cwd(), "sources.toml");
  const text = readFileSync(path, "utf-8");
  cache = parseTomlSources(text);
  return cache;
}

/**
 * Minimal TOML parser for the [[source]] array-of-tables format.
 * We only need to extract name/url/region/country from each [[source]] block.
 */
function parseTomlSources(text: string): SourceEntry[] {
  const entries: SourceEntry[] = [];
  let current: Partial<SourceEntry> | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    // New [[source]] block
    if (trimmed === "[[source]]") {
      if (current && current.name && current.url) {
        entries.push(current as SourceEntry);
      }
      current = {};
      continue;
    }

    // Skip comments and empty lines
    if (!current || trimmed.startsWith("#") || !trimmed) continue;

    // Parse key = "value"
    const match = trimmed.match(/^(\w+)\s*=\s*"(.*)"$/);
    if (match) {
      const [, key, value] = match;
      if (key === "name" || key === "url" || key === "region" || key === "country") {
        (current as Record<string, string>)[key] = value;
      }
    }
  }

  // Don't forget the last entry
  if (current && current.name && current.url) {
    entries.push(current as SourceEntry);
  }

  return entries;
}