import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../web/assets/workspace-core.js");
const workspace = globalThis.EnglishCoachWorkspace;

test("course dashboard orders the least familiar course first", () => {
  const courses = [
    { id: "known", title: "熟悉课程", order: 1, card_ids: ["known-card"] },
    { id: "new", title: "陌生课程", order: 2, card_ids: ["new-card"] },
  ];
  const reviewItems = [
    {
      id: "known-card",
      course_id: "known",
      item: "Known sentence",
      last_result: "pass",
      interval_days: 30,
      next_due: "2026-08-01",
      history: [{ date: "2026-07-15", result: "pass" }],
    },
    {
      id: "new-card",
      course_id: "new",
      item: "New sentence",
      last_result: "pending",
      interval_days: 1,
      next_due: "2026-07-15",
      history: [],
    },
  ];

  const dashboard = workspace.dashboardFromWorkspace(courses, reviewItems, "2026-07-16");

  assert.deepEqual(dashboard.courses.map((course) => course.id), ["new", "known"]);
  assert.equal(dashboard.courses[0].mastery_label, "很不熟悉");
  assert.equal(dashboard.courses[1].mastery_score, 100);
});

test("cloud review result follows the same interval ladder as the local coach", () => {
  const items = [{
    id: "card",
    course_id: "course",
    interval_days: 2,
    last_result: "pass",
    history: [],
  }];

  const passed = workspace.recordReviewResult(items, "card", "pass", "2026-07-16", "2026-07-16T08:00:00Z");
  const shaky = workspace.recordReviewResult(passed, "card", "shaky", "2026-07-20", "2026-07-20T08:00:00Z");

  assert.equal(passed[0].interval_days, 4);
  assert.equal(passed[0].next_due, "2026-07-20");
  assert.equal(shaky[0].interval_days, 1);
  assert.equal(shaky[0].next_due, "2026-07-21");
  assert.equal(shaky[0].history.length, 2);
});

test("workspace merge keeps courses from both devices and the newer progress", () => {
  const local = {
    courses: [{ id: "local", title: "Local", card_ids: ["card"] }],
    review_items: [{
      id: "card",
      course_id: "local",
      item: "Sentence",
      last_result: "fail",
      next_due: "2026-07-17",
      sync_updated_at: "2026-07-16T08:00:00Z",
      history: [{ date: "2026-07-16", result: "fail", synced_at: "2026-07-16T08:00:00Z" }],
    }],
  };
  const remote = {
    courses: [{ id: "remote", title: "Remote", card_ids: [] }],
    review_items: [{
      id: "card",
      course_id: "local",
      item: "Sentence",
      last_result: "pass",
      next_due: "2026-07-22",
      sync_updated_at: "2026-07-18T08:00:00Z",
      history: [{ date: "2026-07-18", result: "pass", synced_at: "2026-07-18T08:00:00Z" }],
    }],
  };

  const merged = workspace.mergeWorkspace(local, remote);

  assert.deepEqual(merged.courses.map((course) => course.id).sort(), ["local", "remote"]);
  assert.equal(merged.review_items[0].last_result, "pass");
  assert.equal(merged.review_items[0].history.length, 2);
});

test("page exposes account sync and mastery sorting controls", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../web/assets/app.js", import.meta.url), "utf8");

  assert.match(html, /id="accountToolButton"/);
  assert.match(html, /id="courseSortSelect"/);
  assert.match(html, /最不熟优先/);
  assert.match(script, /mastery_score/);
  assert.match(script, /synchronizeWorkspace/);
});
