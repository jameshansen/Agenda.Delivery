# Testing agenda.delivery

The City of Testville at [testcouncil.agenda.delivery](https://testcouncil.agenda.delivery) is a fictional council that this repo runs (`testcouncil/`). agenda.delivery watches it as the **Test Council** module at [/module/test-council](https://agenda.delivery/module/test-council). It publishes when you tell it to, so every feature that hangs off a new agenda can be exercised on demand rather than by waiting for a real council.

## The test council

| Page | What it holds |
|---|---|
| `/` | City news, the latest agenda, the members of Council |
| `/council` | The four bodies (Regular Council, Committee of the Whole, Public Hearing, Advisory Planning Commission) with members and meeting rooms |
| `/meetings` | Agendas & Minutes, newest first, with an Agenda (PDF) and Minutes (PDF) link per meeting. `?committee=public-hearing` filters by body |
| `/meetings/<id>` | One meeting's agenda in HTML, its minutes once they exist, and links to both PDFs |

Each release writes the next meeting's agenda, the minutes of the meeting before it, and three homepage news items in one call to `glm-5.3-flash` on Ollama Cloud (the same `OLLAMA_*` and `AGENT_MODEL` settings the agents use). Every agenda has at least one rezoning or development permit, one budget or finance item, and one parks, transportation or infrastructure item, which keeps keyword tests predictable. When the model call fails (no key, rate limit, bad JSON) the release still goes out with three stock items, including "4410 Elm Street" and "Riverside Park Playground Replacement". Seeing those means the model was unavailable, and `sudo -n docker logs agenda-testcouncil` says why.

Scheduled releases walk Regular Council, Committee of the Whole, Regular Council, Public Hearing, Regular Council, Advisory Planning Commission, and repeat. One goes out every `TESTCOUNCIL_RELEASE_DAYS` (default 7) after the last release of any kind, so a manual release pushes the next scheduled one back. A fresh site starts with three weeks of history, one meeting a week, the newest dated a week ago.

State lives in `/data/state.json` on the `agenda-testcouncil` volume. The site carries `noindex` and a footer saying it is fictional.

## Releasing and reverting

A release posts a new meeting dated today (UTC) and adds minutes to the meeting before it. A revert takes the newest meeting down, removes the minutes and news that came with it, and deletes agenda.delivery's `meeting` row for it. That last step matters because agenda.delivery only counts a meeting as new when it is dated after the newest one it holds. Without it, a second release on the same day would read as old news.

Over HTTP, with `TESTCOUNCIL_TOKEN` from `env.production` on the server:

```bash
curl -X POST -H "Authorization: Bearer $TESTCOUNCIL_TOKEN" https://testcouncil.agenda.delivery/admin/release
```

```bash
curl -X POST -H "Authorization: Bearer $TESTCOUNCIL_TOKEN" "https://testcouncil.agenda.delivery/admin/release?committee=public-hearing"
```

```bash
curl -X POST -H "Authorization: Bearer $TESTCOUNCIL_TOKEN" https://testcouncil.agenda.delivery/admin/revert
```

On the server, no token needed:

```bash
sudo -n docker exec agenda-testcouncil python app.py release
```

```bash
sudo -n docker exec agenda-testcouncil python app.py release advisory-planning-commission
```

```bash
sudo -n docker exec agenda-testcouncil python app.py revert
```

A release answers with the new meeting's id, title, date and URL and takes 20 to 60 seconds while the model writes. A revert answers with the meeting it took down and `forgotten`, the number of agenda.delivery meeting rows it deleted (0 when agenda.delivery had not picked the meeting up yet). Committee names are `regular-council`, `committee-of-the-whole`, `public-hearing` and `advisory-planning-commission`; leaving it out takes the next one in the rotation.

A revert does not undo what agenda.delivery already did with the meeting. The module summary, highlights and any deliveries that went out stay as they are until the next release replaces them.

## Running a check now

The checking agent visits every module every six hours. To skip the wait after a release, queue the full pipeline (limited to 10 requests a minute per IP):

```bash
curl -X POST https://agenda.delivery/api/agents/run -H "Content-Type: application/json" -d '{"agent":"full_pipeline","slug":"test-council"}'
```

Watch it run in the Agent activity rail on [/module/test-council](https://agenda.delivery/module/test-council) or on [/agents](https://agenda.delivery/agents). To see which runs happened, on the server:

```bash
sudo -n docker exec agenda-postgres psql -U agenda -d agenda -c "SELECT agent, status, trigger, created_at FROM agent_run WHERE module_id = (SELECT id FROM module WHERE slug = 'test-council') ORDER BY created_at DESC LIMIT 10"
```

## Adding it to agenda.delivery

`sources.toml` lists the Test Council first, and a spider run takes the first source that is not yet a module. The spider is off on the schedule, so run it by hand:

```bash
curl -X POST https://agenda.delivery/api/agents/run -H "Content-Type: application/json" -d '{"agent":"spider"}'
```

The spider container reads `sources.toml` through a single-file mount, which keeps showing the old file after a `git pull` replaces it. Restart it after pulling a change to the registry:

```bash
sudo -n docker restart agendadelivery-spider-1
```

To run discovery again from scratch, delete the module and its candidate row, then run the spider again:

```bash
sudo -n docker exec agenda-postgres psql -U agenda -d agenda -c "DELETE FROM module WHERE slug = 'test-council'; DELETE FROM spider_candidate WHERE url = 'https://testcouncil.agenda.delivery'"
```

## The test inbox

The VPS has a mailbox for testing email, `agendatest@vmi1269820.contaboserver.net`. It belongs to `agendatest`, a system user with no login. Postfix delivers mail for it to `/var/mail/agendatest` after opendkim has signed it, so a message that lands there went through the same relay and signing as one sent to a real reader. The agenda.delivery account **Test Inbox** uses that address, follows the Test Council, and has the default "Send the summary to my email" action.

Read the newest messages, check signing, or empty the inbox:

```bash
sudo -n tail -n 80 /var/mail/agendatest
```

```bash
sudo -n grep -E "^(Subject|From|DKIM-Signature|Content-Type):" /var/mail/agendatest
```

```bash
sudo -n truncate -s 0 /var/mail/agendatest
```

To look at the newest email as a reader would, save its HTML part, copy it off the server with `scp`, and open it in a browser:

```bash
sudo -n python3 -c "import mailbox; m = list(mailbox.mbox('/var/mail/agendatest'))[-1]; print(next(p.get_payload(decode=True).decode() for p in m.walk() if p.get_content_type() == 'text/html'))" > /tmp/latest-email.html
```

Deleting the Test Council module also deletes the account's follow and action. This sets them up again, and creates the account if it is missing:

```bash
sudo -n docker exec -i agenda-postgres psql -U agenda -d agenda <<'SQL'
INSERT INTO "user" (name, email, email_verified)
VALUES ('Test Inbox', 'agendatest@vmi1269820.contaboserver.net', now())
ON CONFLICT (email) DO NOTHING;
INSERT INTO subscription (user_id, module_id, channel, contact)
SELECT u.id, m.id, 'email', u.email FROM "user" u, module m
 WHERE u.email = 'agendatest@vmi1269820.contaboserver.net' AND m.slug = 'test-council'
   AND NOT EXISTS (SELECT 1 FROM subscription s WHERE s.user_id = u.id AND s.module_id = m.id);
INSERT INTO automation_rule (user_id, module_id, trigger, content_mode, action_kind)
SELECT u.id, m.id, 'new_agenda', 'summary', 'email' FROM "user" u, module m
 WHERE u.email = 'agendatest@vmi1269820.contaboserver.net' AND m.slug = 'test-council'
   AND NOT EXISTS (SELECT 1 FROM automation_rule r WHERE r.user_id = u.id AND r.module_id = m.id AND r.action_kind = 'email');
SQL
```

To sign in as Test Inbox, choose "Continue with email" on /login, enter the address, and read the six-digit code from the inbox. That also tests the sign-in code email. Postfix delivers `agendatest+anything@` to the same inbox, so each plus address can stand in for a separate reader.

To send the Test Council's notifications without a release, run every action on it for its newest recorded meeting. This reaches every account with an action on the Test Council, Discord and script targets included.

```bash
sudo -n docker exec agenda-orchestrator python notify_now.py test-council
```

The inbox shows that mail is sent and signed. Where it lands at Gmail or Outlook (inbox or spam) needs a real address; the domain publishes SPF for the VPS and a DMARC record at `p=none`.

## Feature checklist

Each check below names what to do and what should happen. "Release and check" means a release followed by the pipeline command above.

### Discovery and scraping

- **Spider.** Run the spider. A `spider_candidate` row appears on [/spider](https://agenda.delivery/spider), the module `test-council` is created, and Testville is placed on the map approximately (the geocoder does not know it, so the model guesses a spot in BC).
- **Scraper Create.** In the same run, the scraper crawls the homepage, saves a `scrape_config` whose `agenda_url` is the Agendas & Minutes page, and records the newest meeting. The module page shows it under Recent agendas with a summary.
- **PDF extraction.** The activity log for a check reports how many characters it read and the PDF page count. The meeting's `pdf_url` points at an `...-agenda.pdf` on the test council.

### New agendas

- **Nothing new.** Run the pipeline without a release. The checking agent logs that the latest meeting is already recorded, and no summary, keyword or categorization run follows.
- **New agenda.** Release and check. The checking agent logs "New agenda detected", a new row appears under Recent agendas, and summary, keyword and categorization run in parallel.
- **Same-day release.** Release twice without a revert. The second meeting carries the same date, so agenda.delivery treats it as already seen. This is expected; revert first.

### Summaries, highlights and categories

- **Summary and highlights.** After a new agenda, the AI summary and highlight cards on the module page describe the items in the released agenda, street addresses and dollar amounts included.
- **Categorization.** Release `public-hearing` or `committee-of-the-whole` and check. The newest meeting's kind becomes Public Hearing or Committee Meeting rather than Council Meeting.
- **Latest council meeting.** After a non-council release, the "Download the latest meeting agenda" card and the homepage ticker still point at the most recent Regular Council Meeting, since both only show council meetings. The activity log reports that it also found the last regular council meeting.

### Following and email

- **Notification email.** Release and check (or run `notify_now.py`), then read the test inbox. The subject is "Test Council: " followed by the meeting title. The HTML part is in the site's palette, with "New agenda", the council name, the meeting title, the module summary and up to five highlights, a "Read the agenda" button to the agenda PDF, a "See it on agenda.delivery" button to the module page, and a footer linking to the account page to manage actions. The plain-text part carries the same text and links, and the message has a `DKIM-Signature` for `d=agenda.delivery`.
- **Other content.** An email action set to "Agenda link" shows the two buttons under a one-line lead; "Full agenda text" and artifacts show their text as paragraphs, with markdown bold and bullets rendered rather than left as symbols. Highlights appear only with the AI summary.
- **Signed-in follow.** On the module page, Subscribe, then "Send the summary to my email". The next release and check sends that account the email above.
- **Guest follow.** Signed out, enter an address in the subscribe card, confirm the emailed code on /signup, and land back on the module page following it. An address like `agendatest+guest1@vmi1269820.contaboserver.net` makes a new account each time while its mail, the code included, still arrives in the test inbox.

Following alone sends nothing. Delivery comes only from actions (automation rules), which the two flows above create for you.

### Actions

In Account, Automation, add the Test Council as a subscription, then build actions on it. Release and check once, and every action fires.

- **Artifacts.** Make a Keywords artifact with `rezoning, budget, parks` (every agenda has all three) and a Custom prompt artifact such as "List every street address on this agenda." Use each in an action. The keyword output also appears under Keyword summaries on the module page once the action has run.
- **Email.** "Send to my email" with the AI summary, the agenda link, or the full agenda text.
- **Discord.** "Post to Discord" with a channel webhook URL (Server Settings, Integrations, Webhooks). The post starts with the module name in bold and the meeting title.
- **Script.** "Push to a script" with any HTTPS endpoint that accepts a POST, such as a disposable one from webhook.site. It receives JSON with `module`, `module_name`, `meeting` and `content`.
- **Mailing list.** "Queue to a mailing list", covered next.

### Mailing lists

- **Delivery.** In Mailing Lists, add yourself as a subscriber and create a list with a threshold of 1. Point a "Queue to a mailing list" action at it. Release and check. The update is queued and goes out within a minute, wrapped in the list's template.
- **Schedules.** A weekly or monthly list holds its queue until its day, and sends at most once per UTC day.
- **Templates.** "Generate from AI" drafts a template with the same model; "Send test" sends it to your own address.
- **Unsubscribe.** The link in a list email opens /unsubscribe/<id>, and confirming marks the subscriber unsubscribed. The one-click `List-Unsubscribe` header does the same.

### RSS and the developer API

- **RSS.** [/module/test-council/rss.xml](https://agenda.delivery/module/test-council/rss.xml) gains an item per new meeting, with the agenda PDF as its enclosure.
- **API.** Generate a key in Account and API, follow the Test Council, then:

```bash
curl -H "Authorization: Bearer agd_your_key" https://agenda.delivery/api/me/updates
```

The response lists the Test Council's ten newest meetings, newest first.

### Browsing

- **Homepage and search.** Searching "Test" finds the module, and its council meetings show in the recent agendas ticker.
- **Map.** [/map](https://agenda.delivery/map) shows a pin for it, coloured by health.
- **Agent activity.** [/agents](https://agenda.delivery/agents) streams every run live and filters by agent.

### Self-repair

Take the site down and bring it back.

```bash
sudo -n docker stop agenda-testcouncil
```

Run the pipeline. The check fails, the module goes to `repairing`, and the repair agent runs in the same pipeline and cannot reach the site either. Run it again and the module is `broken`; the scheduler now tries it once a day instead of every six hours. Bring it back and check:

```bash
sudo -n docker start agenda-testcouncil
```

The next pipeline run finds the newest meeting and marks the module `healthy`. A failed check falls through to the browser tier, so each one costs a few model calls. A repair can also rewrite the saved agenda URL; confirm it still points at the test council:

```bash
sudo -n docker exec agenda-postgres psql -U agenda -d agenda -c "SELECT agenda_url, platform FROM scrape_config WHERE module_id = (SELECT id FROM module WHERE slug = 'test-council')"
```

### Escalation

The escalation agent sweeps hourly and emails `ADMIN_EMAIL` about failed runs, site errors, modules broken for over a day, and output that reads like a stack trace. To see an email now, record a site error and run the sweep:

```bash
curl -X POST https://agenda.delivery/api/site-error -H "Content-Type: application/json" -d '{"message":"Test council escalation check","path":"/module/test-council"}'
```

```bash
sudo -n docker exec agenda-orchestrator python -c "import requests; print(requests.post('http://localhost:8000/trigger', json={'flow': 'agent', 'agent': 'escalation'}).text)"
```

Each issue is emailed once, so change the message to test again. A module left broken for over 24 hours is reported the same way.

### Rolling back

Revert, then confirm the meeting is gone from the test council's Agendas & Minutes and from Recent agendas on the module page. Release and check again the same day, and it reads as new, so every action fires again.

## Running it

The `testcouncil` service in `docker-compose.yml` serves on `127.0.0.1:8083`, and the host's Caddy proxies `testcouncil.agenda.delivery` to it. To deploy a change to it alone:

```bash
sudo -n docker compose --env-file env.production -f docker-compose.yml -f docker-compose.override.yml up -d --build testcouncil
```

To start over with fresh history, drop its volume:

```bash
sudo -n docker compose --env-file env.production -f docker-compose.yml -f docker-compose.override.yml rm -sf testcouncil
```

```bash
sudo -n docker volume rm agendadelivery_agenda-testcouncil
```

Locally, `docker compose up --build testcouncil` serves it at http://localhost:8083; with no `OLLAMA_BASE_URL` every release uses the stock items. The self-check needs only Flask and pypdf:

```bash
python testcouncil/test_app.py
```
