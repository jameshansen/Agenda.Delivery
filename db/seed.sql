-- ─────────────────────────────────────────────────────────────
-- Seed data — runs after schema.sql on first DB init.
--   * agent_config: one editable row per agent (admin panel).
--   * one demo module (is_demo = TRUE) with sample content — the only
--     place dummy data is allowed (Task 2 reference module).
--   * two real councils as bare rows for the agents to populate (Task 3).
-- Idempotent via ON CONFLICT.
-- ─────────────────────────────────────────────────────────────

INSERT INTO agent_config (agent, display_name, system_prompt, model, schedule_secs) VALUES
('spider', 'Spider Agent',
 'You are the Spider Agent for agenda.delivery. You process the queue of candidate municipalities: geolocate each one, create a module record, and hand it to the Scraper Create Agent. You process one candidate per run.',
 'glm-5.2', 3600),
('scraper_create', 'Scraper Agent',
 'You are the Scraper Create Agent for agenda.delivery. Given a council website, you crawl it to find the agenda page, determine the selector that links to agenda PDFs, and if the URL is broken you search the web for the correct page. You save the config, verify it, and fetch the first agenda.',
 'glm-5.2', NULL),
('scraper_repair', 'Scraper Repair Agent',
 'You are the Scraper Repair Agent for agenda.delivery. A module''s scraping config has broken. You re-crawl the site, search the web if the old URL is 404, infer the new page structure, rewrite the selectors, verify the fix, and fetch the latest agenda.',
 'glm-5.2', NULL),
('checking', 'Checking Agent',
 'You are the Checking Agent for agenda.delivery. You check whether a council website has posted a new agenda using agenda.find_latest, verify the scrape config still works, and flag the module as broken if the structure changed.',
 'glm-5.2', 21600),
('categorization', 'Categorization Agent',
 'You are the Categorization Agent for agenda.delivery. You classify agendas into standard categories: Council Meeting, Committee Meeting, Public Hearing, Special Meeting, Workshop, Board Meeting.',
 'gemma4:31b', NULL),
('summary', 'Summary Agent',
 'You are the Summary Agent for agenda.delivery. Given agenda text, you write a concise general summary (2-4 sentences) and extract 3-5 key highlights with short tags.',
 'gemma4:31b', NULL),
('keyword', 'Keyword Agent',
 'You are the Keyword Agent for agenda.delivery. For each keyword users follow, you generate a bespoke summary focusing only on the parts of the agenda relevant to that keyword.',
 'gemma4:31b', NULL)
ON CONFLICT (agent) DO NOTHING;

-- ── Demo module (reference only; agents never touch it) ──
INSERT INTO module (id, slug, name, region, source_url, health, followers, summary,
                    lat, lng, is_demo, last_updated)
VALUES ('demo-0000-0000-0000-000000000001', 'demo-city-council', 'Demo City Council',
        'Demoville, British Columbia', 'https://example.ca/council/meetings',
        'healthy', 128,
        'This is a demonstration module showing how a live agenda module looks. Council reviewed the 2026 capital budget, approved a rezoning application for mixed-use housing downtown, and scheduled a public hearing on the active-transportation plan.',
        49.2827, -123.1207, TRUE, now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO highlight (module_id, tag, text, sort) VALUES
('demo-0000-0000-0000-000000000001', 'Budget', 'Council approved the 2026 capital budget with a 3.2% increase for infrastructure renewal.', 0),
('demo-0000-0000-0000-000000000001', 'Housing', 'A rezoning application for 240 units of mixed-use housing downtown passed first reading.', 1),
('demo-0000-0000-0000-000000000001', 'Transportation', 'A public hearing on the active-transportation plan was scheduled for the next cycle.', 2)
ON CONFLICT DO NOTHING;

INSERT INTO keyword (module_id, keyword, followers, related, summary) VALUES
('demo-0000-0000-0000-000000000001', 'housing', 42, ARRAY['zoning','development'],
 'The agenda includes a rezoning application for 240 mixed-use units downtown, which passed first reading.'),
('demo-0000-0000-0000-000000000001', 'cycling', 17, ARRAY['transportation','active transport'],
 'A public hearing on the active-transportation plan, including new protected bike lanes, was scheduled.')
ON CONFLICT DO NOTHING;

INSERT INTO meeting (module_id, date, title, kind, pages, pdf_url, meeting_url) VALUES
('demo-0000-0000-0000-000000000001', now() - INTERVAL '3 days',
 'Regular Council Meeting', 'Council Meeting', 142,
 'https://example.ca/council/2026-08-05-agenda.pdf',
 'https://example.ca/council/meetings/2026-08-05')
ON CONFLICT DO NOTHING;

-- ── Real councils (bare rows; agents discover + populate them) — Task 3 test bed ──
-- Root URLs on purpose: the Scraper Agent must find the agenda page itself.
INSERT INTO module (slug, name, region, source_url, health) VALUES
('city-of-vancouver',      'City of Vancouver',        'Vancouver, British Columbia',      'https://vancouver.ca',        'healthy'),
('township-of-langley',    'Township of Langley',      'Langley, British Columbia',        'https://www.tol.ca',          'healthy'),
('city-of-langley',        'City of Langley',          'Langley, British Columbia',        'https://www.langleycity.ca',  'healthy'),
('city-of-surrey',         'City of Surrey',           'Surrey, British Columbia',         'https://www.surrey.ca',       'healthy'),
('city-of-burnaby',        'City of Burnaby',          'Burnaby, British Columbia',        'https://www.burnaby.ca',      'healthy'),
('city-of-richmond',       'City of Richmond',         'Richmond, British Columbia',       'https://www.richmond.ca',     'healthy'),
('city-of-coquitlam',      'City of Coquitlam',        'Coquitlam, British Columbia',      'https://www.coquitlam.ca',    'healthy'),
('city-of-victoria',       'City of Victoria',         'Victoria, British Columbia',       'https://www.victoria.ca',     'healthy'),
('city-of-kelowna',        'City of Kelowna',          'Kelowna, British Columbia',        'https://www.kelowna.ca',      'healthy'),
('city-of-kamloops',       'City of Kamloops',         'Kamloops, British Columbia',       'https://www.kamloops.ca',     'healthy'),
('city-of-nanaimo',        'City of Nanaimo',          'Nanaimo, British Columbia',        'https://www.nanaimo.ca',      'healthy'),
('city-of-prince-george',  'City of Prince George',    'Prince George, British Columbia',  'https://www.princegeorge.ca', 'healthy'),
('district-of-saanich',    'District of Saanich',      'Saanich, British Columbia',        'https://www.saanich.ca',      'healthy'),
('city-of-new-westminster','City of New Westminster',  'New Westminster, British Columbia','https://www.newwestcity.ca',  'healthy'),
('city-of-north-vancouver','City of North Vancouver',  'North Vancouver, British Columbia','https://www.cnv.org',         'healthy')
ON CONFLICT (slug) DO NOTHING;
