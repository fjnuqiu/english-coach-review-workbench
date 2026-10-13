import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../web/assets/cloud-sync.js", import.meta.url), "utf8");

function cloudFixture(cardCount, failAt = -1) {
  const requests = [];
  const cards = Array.from({ length: cardCount }, (_, i) => ({
    course_id: "lesson", card_id: `card-${i}`, updated_at: "2026-10-13T00:00:00Z",
    payload: { id: `card-${i}`, course_id: "lesson", history: [{ result: "pass", date: "2026-10-13" }] },
  }));
  const mockClient = { from(table) {
    const orders = [];
    const query = {
      select() { return query; },
      eq(column, value) { assert.equal(column, "user_id"); assert.equal(value, "fixture-user"); return query; },
      order(column) { orders.push(column); return query; },
      async range(from, to) {
        requests.push({ table, from, to, orders: [...orders] });
        if (table === "english_coach_review_cards" && from === failAt) return { data: null, error: { message: "page unavailable" } };
        const rows = table === "english_coach_courses" ? [{ course_id: "lesson", payload: { id: "lesson" } }] : cards;
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return query;
  } };
  const root = { ENGLISH_COACH_CONFIG: { supabaseUrl: "https://example.invalid", supabasePublishableKey: "fixture-public-config" } };
  // Stub the external SDK import; exercise the actual production readWorkspace.
  const code = source.replace("await import(SUPABASE_MODULE_URL)", "await globalThis.fixtureSdk");
  vm.runInNewContext(code, { window: root, fixtureSdk: { createClient: () => mockClient } });
  return { cloud: root.EnglishCoachCloud, requests };
}

test("cloud sync reads past the default row limit and retains late-page progress", async () => {
  const { cloud, requests } = cloudFixture(2205);
  const data = await cloud.readWorkspace("fixture-user");
  assert.equal(data.review_items.length, 2205);
  assert.equal(data.review_items.at(-1).id, "card-2204");
  assert.equal(data.review_items.at(-1).history[0].result, "pass");
  const pages = requests.filter(r => r.table === "english_coach_review_cards");
  assert.deepEqual(pages.map(p => [p.from, p.to]), [[0, 499], [500, 999], [1000, 1499], [1500, 1999], [2000, 2499]]);
  assert.ok(pages.every(p => p.orders.join(",") === "course_id,card_id"));
});

test("a failed later page rejects the whole sync instead of returning a partial workspace", async () => {
  const { cloud } = cloudFixture(1205, 500);
  await assert.rejects(cloud.readWorkspace("fixture-user"), /page unavailable/);
});

test("an exact page multiple fetches the final empty page and an empty account remains empty", async () => {
  const full = cloudFixture(1000);
  assert.equal((await full.cloud.readWorkspace("fixture-user")).review_items.length, 1000);
  assert.ok(full.requests.some(p => p.table === "english_coach_review_cards" && p.from === 1000));
  assert.equal((await cloudFixture(0).cloud.readWorkspace("fixture-user")).review_items.length, 0);
});
