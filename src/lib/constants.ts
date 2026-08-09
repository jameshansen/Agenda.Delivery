/**
 * Application-wide constants.
 *
 * Centralized so magic numbers don't get scattered across the codebase.
 * Each constant is documented with its purpose.
 */

/** Maximum chars of agenda text passed to the LLM for summarization. */
export const MAX_SUMMARY_TEXT = 8000;

/** Maximum chars of agenda text passed to the LLM for categorization. */
export const MAX_CATEGORIZATION_TEXT = 2000;

/** Maximum number of keywords summarized per module (product spec limit). */
export const MAX_KEYWORDS_PER_MODULE = 5;

/** Maximum number of highlights extracted per meeting. */
export const MAX_HIGHLIGHTS = 5;

/** HTTP fetch timeout for general page fetches (ms). */
export const HTTP_TIMEOUT_MS = 15_000;

/** HTTP fetch timeout for PDF downloads (ms). */
export const PDF_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Maximum number of links the site.crawl tool returns. */
export const MAX_CRAWL_LINKS = 20;

/** Maximum agent run duration before timeout (ms). */
export const AGENT_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Maximum PDF pages to extract text from. */
export const MAX_PDF_PAGES = 20;

/** Maximum chars of agenda text stored/sliced for display. */
export const MAX_AGENDA_TEXT = 12000;

/** Scheduler: checking agent interval in production (6 hours). */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Scheduler: checking agent interval in dev (30 minutes). */
export const CHECK_INTERVAL_DEV_MS = 30 * 60 * 1000;

/** SSE heartbeat interval (ms). */
export const SSE_HEARTBEAT_MS = 15_000;

/** Maximum events kept in a live SSE client buffer. */
export const SSE_MAX_LIVE_EVENTS = 30;

/** Maximum events kept in a replayed SSE client buffer. */
export const SSE_MAX_REPLAY_EVENTS = 50;

/** Agent event cleanup: events older than this are deleted (30 days). */
export const EVENT_RETENTION_DAYS = 30;