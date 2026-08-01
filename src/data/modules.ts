// ponytail: rich sample data for the UI phase. Real modules come from the
// scraper agents + DB in Phase 3-4. Shape here is what those will produce.

export type Meeting = {
  date: string;
  title: string;
  kind: string;
  pages: number;
};

export type KeywordSummary = {
  keyword: string;
  followers: number;
  related: string[]; // other keywords those followers track
  summary: string;
};

export type Highlight = { tag: string; text: string };

export type AgentEvent = {
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
};

export type Health = "healthy" | "repairing" | "broken";

export type ModuleDetail = {
  slug: string;
  name: string;
  region: string;
  sourceUrl: string;
  lastUpdated: string;
  nextExpected: string;
  followers: number;
  health: Health;
  summary: string;
  highlights: Highlight[];
  keywords: KeywordSummary[];
  meetings: Meeting[];
  agentLog: AgentEvent[];
};

const MODULES: Record<string, ModuleDetail> = {
  "township-of-langley": {
    slug: "township-of-langley",
    name: "Township of Langley",
    region: "Langley, British Columbia",
    sourceUrl: "https://www.tol.ca/en/city-hall/council-meetings.aspx",
    lastUpdated: "June 24, 2026",
    nextExpected: "July 8, 2026",
    followers: 184,
    health: "healthy",
    summary:
      "The June 24 Regular Council meeting was dominated by the Willoughby Community Plan amendment, which adds 1,900 units of missing-middle housing near the future SkyTrain alignment. Council also awarded the 200 Street cycling corridor contract and deferred a decision on short-term rental licensing to the July committee of the whole.",
    highlights: [
      { tag: "Housing", text: "Willoughby plan amendment: +1,900 missing-middle units approved 6-3." },
      { tag: "Transportation", text: "200 Street protected bike lane contract awarded ($4.2M)." },
      { tag: "Budget", text: "Q2 capital variance report shows road program 8% under budget." },
      { tag: "Deferred", text: "Short-term rental licensing bylaw pushed to July 8 committee." },
    ],
    keywords: [
      {
        keyword: "cycling",
        followers: 5,
        related: ["transit", "pedestrian safety", "vision zero"],
        summary:
          "The 200 Street protected bike lane was funded and awarded, closing a 1.8km gap between Willowbrook and the Nicomekl trail. Staff were directed to report back on secure bike parking minimums for new developments.",
      },
      {
        keyword: "housing",
        followers: 22,
        related: ["zoning", "rental", "development permits"],
        summary:
          "1,900 missing-middle units approved under the Willoughby amendment. Density bonusing requires 10% below-market rental. Two rezoning applications advanced to public hearing.",
      },
      {
        keyword: "parks",
        followers: 8,
        related: ["trails", "recreation", "environment"],
        summary:
          "Nicomekl floodplain trail extension received design funding. No new park acquisitions this cycle.",
      },
    ],
    meetings: [
      { date: "June 24, 2026", title: "Regular Council Meeting", kind: "Council", pages: 312 },
      { date: "June 16, 2026", title: "Committee of the Whole", kind: "Committee", pages: 88 },
      { date: "June 9, 2026", title: "Regular Council Meeting", kind: "Council", pages: 274 },
      { date: "May 26, 2026", title: "Public Hearing", kind: "Hearing", pages: 41 },
    ],
    agentLog: [
      { agent: "Checking Agent", action: "Detected the June 24 agenda was likely posted (agendas land ~4 days before meetings).", tool: "schedule.predict", detail: "confidence 0.91 → poll now" },
      { agent: "Checking Agent", action: "Found a new agenda package linked on the council meetings page.", tool: "http.get", detail: "GET /council-meetings.aspx → 200" },
      { agent: "Scraper Agent", action: "Downloaded the agenda PDF and split it into items.", tool: "pdf.extract", detail: "312 pages → 47 agenda items" },
      { agent: "Scraper Agent", action: "Stripped embedded images and stored the compressed text to S3.", tool: "s3.put", detail: "312p PDF 41MB → 0.9MB text" },
      { agent: "Summary Agent", action: "Wrote the general meeting summary and 4 highlights.", tool: "llm.summarize", detail: "47 items → 1 summary + 4 highlights" },
      { agent: "Keyword Agent", action: "Generated bespoke summaries for 3 tracked keywords.", tool: "llm.summarize", detail: "cycling, housing, parks" },
      { agent: "Checking Agent", action: "Verified links resolve and structure matches last run. Module healthy.", tool: "verify.selfcheck", detail: "6/6 checks passed" },
    ],
  },

  "city-of-langley": {
    slug: "city-of-langley",
    name: "City of Langley",
    region: "Langley, British Columbia",
    sourceUrl: "https://www.langleycity.ca/city-hall/mayor-council/council-meetings",
    lastUpdated: "June 18, 2026",
    nextExpected: "July 7, 2026",
    followers: 96,
    health: "repairing",
    summary:
      "The City's agenda portal changed its URL structure on June 17, which broke the original scraper. The Scraper Repair Agent detected the failure, re-discovered the new agenda listing, and rebuilt the extraction logic within minutes. The June 18 Regular Council meeting focused on the Downtown Master Plan and a new pay-parking pilot on Fraser Highway.",
    highlights: [
      { tag: "Planning", text: "Downtown Master Plan phase 2 endorsed for public consultation." },
      { tag: "Parking", text: "Pay-parking pilot approved for Fraser Highway core (12-month trial)." },
      { tag: "Self-heal", text: "Scraper auto-repaired after the June 17 portal migration." },
    ],
    keywords: [
      {
        keyword: "cycling",
        followers: 5,
        related: ["transit", "greenways", "traffic calming"],
        summary:
          "The Downtown Master Plan phase 2 includes a proposed greenway on Douglas Crescent. No funding attached yet; slated for the consultation package.",
      },
      {
        keyword: "parking",
        followers: 11,
        related: ["downtown", "business", "transportation"],
        summary:
          "A 12-month pay-parking pilot was approved for the Fraser Highway core. Revenue is earmarked for downtown streetscape improvements.",
      },
    ],
    meetings: [
      { date: "June 18, 2026", title: "Regular Council Meeting", kind: "Council", pages: 198 },
      { date: "June 2, 2026", title: "Regular Council Meeting", kind: "Council", pages: 210 },
      { date: "May 20, 2026", title: "Special Council Meeting", kind: "Council", pages: 33 },
    ],
    agentLog: [
      { agent: "Checking Agent", action: "Scheduled poll returned a 404 where the agenda list used to be.", tool: "http.get", detail: "GET /council-meetings → 404" },
      { agent: "Checking Agent", action: "Flagged the module as broken and paged the repair agent.", tool: "verify.selfcheck", detail: "2/6 checks failed" },
      { agent: "Scraper Repair Agent", action: "Crawled the site to re-locate the agenda listing after the migration.", tool: "site.crawl", detail: "found /city-hall/mayor-council/council-meetings" },
      { agent: "Scraper Repair Agent", action: "Inferred the new page structure and rewrote the extraction selectors.", tool: "llm.repair", detail: "new selector: a[href$='.pdf'] in .agenda-list" },
      { agent: "Scraper Repair Agent", action: "Re-ran extraction against the new layout to confirm the fix.", tool: "verify.selfcheck", detail: "6/6 checks passed → healthy" },
      { agent: "Scraper Agent", action: "Downloaded the June 18 agenda and stored compressed text to S3.", tool: "s3.put", detail: "198p PDF 26MB → 0.6MB text" },
      { agent: "Summary Agent", action: "Wrote the general summary and 3 highlights.", tool: "llm.summarize", detail: "1 summary + 3 highlights" },
      { agent: "Keyword Agent", action: "Generated bespoke summaries for 2 tracked keywords.", tool: "llm.summarize", detail: "cycling, parking" },
    ],
  },
};

export function getModule(slug: string): ModuleDetail | undefined {
  return MODULES[slug];
}

export const allModules = Object.values(MODULES);
