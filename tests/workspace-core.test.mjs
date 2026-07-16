import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../web/assets/workspace-core.js");
const workspace = globalThis.EnglishCoachWorkspace;

test("course dashboard orders the least familiar course first", () => {
  const courses = [
    { id: "known", title: "熟悉课程", order: 1, card_ids: ["known-card"], selected_card_ids: ["known-card"] },
    { id: "new", title: "陌生课程", order: 2, card_ids: ["new-card"], selected_card_ids: ["new-card"] },
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
  assert.equal(dashboard.courses[0].selected_total_count, 1);
  assert.deepEqual(dashboard.courses[0].selected_content, dashboard.courses[0].selected_cards);
  assert.deepEqual(dashboard.courses[0].full_content, dashboard.courses[0].all_cards);
});

test("selected content is an ordered subset with its own mastery", () => {
  const courses = [{
    id: "lesson",
    title: "课程",
    card_ids: ["full-only", "core-new", "core-known"],
    selected_card_ids: ["core-new", "core-known"],
  }];
  const reviewItems = [
    { id: "full-only", course_id: "lesson", item: "Full", last_result: "pass", interval_days: 30, next_due: "2026-08-01", history: [{ result: "pass" }] },
    { id: "core-new", course_id: "lesson", item: "Core new", last_result: "pending", interval_days: 1, next_due: "2026-07-16", history: [] },
    { id: "core-known", course_id: "lesson", item: "Core known", last_result: "pass", interval_days: 30, next_due: "2026-08-01", history: [{ result: "pass" }] },
  ];

  const dashboard = workspace.dashboardFromWorkspace(courses, reviewItems, "2026-07-16");
  const course = dashboard.courses[0];

  assert.deepEqual(course.selected_cards.map((card) => card.id), ["core-new", "core-known"]);
  assert.equal(course.selected_due_count, 1);
  assert.equal(course.selected_total_count, 2);
  assert.equal(course.priority_mastery_score, course.selected_mastery_score);
  assert.notEqual(course.selected_mastery_score, course.mastery_score);
});

test("known video courses migrate their curated selection during account sync", () => {
  const course = {
    id: "pet-food-safety",
    title: "宠物饮食",
    card_ids: [
      "are-you-a-pet-owner",
      "the-food-that-you-like-is-not-always-the-best-food-for-your-pet",
      "do-not-feed-chocolate-to-dogs",
      "kittens-cannot-drink-cow-milk",
      "chocolate-is-another-dangerous-food",
      "check-online-before-you-give-human-food-to-pets",
      "it-might-not-be-safe",
    ],
  };
  const items = course.card_ids.map((id) => ({
    id,
    course_id: course.id,
    item: id,
    last_result: "pending",
    interval_days: 1,
    next_due: "2026-07-16",
    history: [],
  }));

  const dashboard = workspace.dashboardFromWorkspace([course], items, "2026-07-16");
  const merged = workspace.mergeWorkspace(
    { courses: [], review_items: [] },
    { courses: [course], review_items: items },
  );

  assert.equal(dashboard.courses[0].selected_total_count, 6);
  assert.deepEqual(
    merged.courses[0].selected_card_ids,
    dashboard.courses[0].selected_cards.map((card) => card.id),
  );
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
    courses: [{ id: "local", title: "Local", card_ids: ["card"], selected_card_ids: ["card"] }],
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
  assert.deepEqual(merged.courses.find((course) => course.id === "local").selected_card_ids, ["card"]);
});

test("answer matching accepts contractions and rejects severely scrambled word order", () => {
  const exact = workspace.compareReviewAnswer(
    "Don't feed chocolate to dogs!",
    "Do not feed chocolate to dogs.",
    ["feed", "chocolate", "dogs"],
  );
  const accepted = workspace.compareReviewAnswer(
    "Please don't feed dogs chocolate.",
    "Do not feed chocolate to dogs.",
    ["feed", "chocolate", "dogs"],
    ["Please don't feed dogs chocolate."],
  );
  const scrambled = workspace.compareReviewAnswer(
    "dogs to chocolate feed not do",
    "Do not feed chocolate to dogs.",
    ["feed", "chocolate", "dogs"],
  );

  assert.equal(exact.exact, true);
  assert.equal(accepted.exact, true);
  assert.equal(scrambled.coreCorrect, false);
});

test("answer matching rejects missing or added negation", () => {
  const missingNot = workspace.compareReviewAnswer(
    "It might be safe.",
    "It might not be safe.",
    ["might", "safe"],
  );
  const missingNotInCommand = workspace.compareReviewAnswer(
    "Do feed chocolate to dogs.",
    "Do not feed chocolate to dogs.",
    ["feed", "chocolate", "dogs"],
  );
  const addedNot = workspace.compareReviewAnswer(
    "You should not check online.",
    "You should check online.",
    ["check", "online"],
  );
  const contraction = workspace.compareReviewAnswer(
    "You shouldn't feed dogs chocolate.",
    "You should not feed dogs chocolate.",
    ["feed", "dogs", "chocolate"],
  );

  assert.equal(missingNot.coreCorrect, false);
  assert.equal(missingNot.polarityMatches, false);
  assert.ok(missingNot.coverage <= 60);
  assert.equal(missingNotInCommand.coreCorrect, false);
  assert.equal(addedNot.coreCorrect, false);
  assert.equal(contraction.exact, true);
});

test("answer matching normalizes number words and rejects changed numbers", () => {
  const equivalent = workspace.compareReviewAnswer(
    "Puppies spend about fourteen hours of the day sleeping.",
    "Puppies spend about 14 hours of the day sleeping.",
    ["puppies", "spend", "hours", "sleeping"],
  );
  const changedNumber = workspace.compareReviewAnswer(
    "Puppies spend about 40 hours of the day sleeping.",
    "Puppies spend about 14 hours of the day sleeping.",
    ["puppies", "spend", "hours", "sleeping"],
  );
  const reversedRange = workspace.compareReviewAnswer(
    "Puppies spend 17 to 16 hours sleeping.",
    "Puppies spend 16 to 17 hours sleeping.",
    ["puppies", "spend", "hours", "sleeping"],
  );

  assert.equal(equivalent.exact, true);
  assert.equal(changedNumber.coreCorrect, false);
  assert.equal(changedNumber.numberMatches, false);
  assert.ok(changedNumber.coverage <= 60);
  assert.equal(reversedRange.coreCorrect, false);
  assert.equal(reversedRange.numberMatches, false);
});

test("page exposes account sync and mastery sorting controls", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../web/assets/app.js", import.meta.url), "utf8");

  assert.match(html, /id="accountToolButton"/);
  assert.match(html, /id="courseSortSelect"/);
  assert.match(html, /最不熟优先/);
  assert.match(script, /mastery_score/);
  assert.match(script, /synchronizeWorkspace/);
  assert.match(script, /selected_content/);
  assert.match(script, /full_content/);
});
