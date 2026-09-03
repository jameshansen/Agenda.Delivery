/**
 * Self-check for the pure UI-side logic: subscriber parsing and template
 * rendering. No DB, no server.
 *
 *   npx tsx scripts/selfcheck.ts
 */
import assert from "node:assert/strict";
import { parseSubscribers, describeSchedule, MONTH_DAYS } from "../src/lib/mailing";
import {
  renderTemplate,
  toFieldKey,
  BUILTIN_FIELDS,
  missingRequiredFields,
} from "../src/lib/mail-fields";

function checkParsing() {
  const { valid, invalid } = parseSubscribers(
    [
      "sam@example.com",
      "Sam Rivers <sam.r@example.com>",
      "Ada Lovelace, ada@example.com",
      "bea@example.com, Bea Fox",
      "  ",
      "not an address",
      "SAM@example.com", // same as line 1, different case
    ].join("\n"),
  );

  assert.deepEqual(
    valid.map((v) => v.email),
    ["sam@example.com", "sam.r@example.com", "ada@example.com", "bea@example.com"],
  );
  assert.equal(valid[1].name, "Sam Rivers");
  assert.equal(valid[2].name, "Ada Lovelace");
  assert.equal(valid[3].name, "Bea Fox");
  assert.deepEqual(invalid, ["not an address"]);

  // A single line holding several addresses is a comma-separated list, not a
  // "name, email" pair.
  const multi = parseSubscribers("a@example.com, b@example.com, c@example.com");
  assert.equal(multi.valid.length, 3);
  assert.equal(multi.valid[0].name, "");

  assert.equal(parseSubscribers("").valid.length, 0);
}

function checkRendering() {
  assert.equal(renderTemplate("<p>{{a}} {{ b }}</p>", { a: "1", b: "2" }), "<p>1 2</p>");
  // Unknown keys collapse rather than leaking braces into someone's inbox.
  assert.equal(renderTemplate("x{{missing}}y", {}), "xy");
  assert.equal(toFieldKey("  Organization Name! "), "organization_name");
  assert.equal(toFieldKey("chapter #2"), "chapter_2");

  // The keys the Python sender knows about must all be declared here too.
  const keys = new Set(BUILTIN_FIELDS.map((f) => f.key));
  for (const required of ["content", "organization_name", "unsubscribe_url"]) {
    assert.ok(keys.has(required), `missing built-in field ${required}`);
  }
}

function checkEmptyImageStripping() {
  // An account with no logo must not ship a broken-image icon to every inbox.
  const withLogo = '<body><img src="{{logo_url}}" alt="x" />{{content}}</body>';
  assert.ok(!renderTemplate(withLogo, { logo_url: "", content: "hi" }).includes("<img"));
  // A real logo survives untouched.
  const out = renderTemplate(withLogo, { logo_url: "https://x.test/l.png", content: "hi" });
  assert.ok(out.includes('src="https://x.test/l.png"'));
  // Only the empty one goes when a template has both.
  const two = '<img src="" /><img src="https://x.test/a.png" />{{content}}';
  const both = renderTemplate(two, { content: "hi" });
  assert.equal((both.match(/<img/g) ?? []).length, 1, both);
}

function checkRequiredFields() {
  // A template with no way out must be refused, however complete it looks.
  const noOptOut = "<html><body><h1>{{organization_name}}</h1>{{content}}</body></html>";
  assert.deepEqual(missingRequiredFields(noOptOut).map((f) => f.key), ["unsubscribe_url"]);

  const noContent = '<html><body><a href="{{unsubscribe_url}}">out</a></body></html>';
  assert.deepEqual(missingRequiredFields(noContent).map((f) => f.key), ["content"]);

  assert.equal(missingRequiredFields("<p>nothing at all</p>").length, 2);

  const good = '<body>{{content}}<a href="{{unsubscribe_url}}">Unsubscribe</a></body>';
  assert.deepEqual(missingRequiredFields(good), []);
}

function checkSchedule() {
  assert.equal(
    describeSchedule({ sendPolicy: "weekly", threshold: 5, weekday: 2, monthDay: "first" }),
    "weekly on Wednesday",
  );
  assert.equal(
    describeSchedule({ sendPolicy: "monthly", threshold: 5, weekday: 0, monthDay: "last" }),
    "monthly on the last day",
  );
  assert.equal(
    describeSchedule({ sendPolicy: "threshold", threshold: 7, weekday: 0, monthDay: "first" }),
    "when 7 updates are queued",
  );
  // first, last, and the 2nd through the 28th.
  assert.equal(MONTH_DAYS.length, 29);
  assert.equal(MONTH_DAYS.at(-1)?.value, "28");
  assert.equal(MONTH_DAYS.find((m) => m.value === "22")?.label, "the 22nd");
  assert.equal(MONTH_DAYS.find((m) => m.value === "11")?.label, "the 11th");
}

checkParsing();
checkRendering();
checkRequiredFields();
checkEmptyImageStripping();
checkSchedule();
console.log("selfcheck: all checks passed");
