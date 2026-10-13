import assert from "node:assert/strict";
import test from "node:test";

await import("../web/assets/workspace-core.js");
await import("../web/assets/video-course-seed.js");
await import("../web/assets/vocabulary-guides.js");
await import("../web/assets/vocabulary-core.js");
const vocabulary = globalThis.EnglishCoachVocabulary;
const workspace = globalThis.EnglishCoachWorkspace;
const seed = globalThis.EnglishCoachVideoCourseSeed.workspace();

test("all bundled courses contribute teaching entries, with explanations and actual examples", () => {
  const library = vocabulary.withLibrary(seed);
  const entries = vocabulary.entries(library);
  const sourceIds = new Set(entries.flatMap(item => item.source_courses.map(c => c.course_id)));
  assert.equal(sourceIds.size, seed.courses.length);
  assert.ok(entries.length > 150);
  for (const item of entries) {
    for (const field of ["meaning", "usage", "example", "example_zh"]) assert.ok(item[field]?.trim(), `${item.item}: ${field}`);
    assert.notEqual(item.example.toLowerCase(), item.item.toLowerCase(), `${item.item}: example must be a sentence`);
    assert.ok(item.example.split(/\s+/).length > 3);
    assert.match(item.meaning, /[\u4e00-\u9fff]/);
    assert.match(item.usage, /[\u4e00-\u9fff]/);
  }
});

test("repeated terms and inflected forms merge across private and bundled courses", () => {
  const value = { courses: [{ id: "one", title: "One" }, { id: "two", title: "Two" }], review_items: [
    { id: "one-1", course_id: "one", item: "a parrot" },
    { id: "two-1", course_id: "two", item: "Parrots make good pets." },
    { id: "two-2", course_id: "two", item: "I signed up for a course." },
  ] };
  const entries = vocabulary.entries(vocabulary.withLibrary(value));
  assert.equal(entries.filter(i => i.item === "parrot").length, 1);
  assert.deepEqual(entries.find(i => i.item === "parrot").source_courses.map(c => c.course_id), ["one", "two"]);
  assert.ok(entries.some(i => i.item === "sign up"));
});

test("building, merging, and grading the library preserve all original course progress", () => {
  const original = structuredClone(seed);
  original.review_items[0].history = [{ date: "2026-10-10", result: "pass" }];
  original.review_items[0].next_due = "2026-10-24";
  const before = structuredClone(original);
  const library = vocabulary.withLibrary(original);
  const entry = vocabulary.entries(library)[0];
  const graded = { ...library, review_items: workspace.recordReviewResult(library.review_items, entry.id, "pass", "2026-10-13", "2026-10-13T06:00:00Z") };
  const rebuilt = vocabulary.withLibrary(graded);
  const again = vocabulary.withLibrary(rebuilt);
  assert.deepEqual(original, before);
  assert.deepEqual(rebuilt.review_items.filter(i => i.course_id !== vocabulary.GROUP_ID), before.review_items);
  assert.deepEqual(rebuilt.courses.filter(c => c.id !== vocabulary.GROUP_ID), before.courses);
  assert.equal(rebuilt.review_items.find(i => i.id === entry.id).history.length, 1);
  assert.equal(rebuilt.review_items.find(i => i.id === entry.id).next_due, "2026-10-15");
  assert.equal(workspace.workspaceFingerprint(again), workspace.workspaceFingerprint(rebuilt));
  const merged = vocabulary.withLibrary(workspace.mergeWorkspace(library, graded));
  assert.equal(merged.review_items.find(i => i.id === entry.id).history.length, 1);
});

test("course practice omits standalone vocabulary but retains sentences and grammar", () => {
  const source = { courses: [{ id: "one", title: "Lesson" }], review_items: [
    { id: "word", course_id: "one", item: "supplies" },
    { id: "sentence", course_id: "one", item: "We need to buy supplies." },
    { id: "grammar", course_id: "one", item: "Does + base verb" },
    { id: "unknown", course_id: "one", item: "new terminology", type: "word" },
  ] };
  const original = structuredClone(source);
  const regular = vocabulary.courseWorkspace(vocabulary.withLibrary(source));
  assert.deepEqual(regular.courses, source.courses);
  assert.deepEqual(regular.review_items.map(i => i.id), ["sentence", "grammar", "unknown"]);
  assert.deepEqual(source, original);
});

test("private imported guides participate without adding that content to the public seed", () => {
  const guide = { term: "scope creep", kind: "phrase", meaning: "项目范围未经控制地增加。", usage: "使用 prevent scope creep 表示防止范围扩大。", example: "Clear requirements help prevent scope creep.", example_zh: "明确的需求有助于防止范围扩大。" };
  const value = { courses: [{ id: "private-course", title: "My own material" }], review_items: [{ id: "private-item", course_id: "private-course", item: "Custom content.", vocabulary: [guide] }] };
  const entries = vocabulary.entries(vocabulary.withLibrary(value));
  assert.equal(entries.find(i => i.item === guide.term).source_courses[0].course_id, "private-course");
  assert.ok(!vocabulary.entries(vocabulary.withLibrary(seed)).some(i => i.item === guide.term));
});

test("review checks the expression instead of the illustrative example sentence", () => {
  const entry = vocabulary.entries(vocabulary.withLibrary(seed)).find(i => i.item === "look forward to");
  const card = workspace.reviewCard(entry);
  assert.equal(card.target_sentence, "look forward to");
  assert.notEqual(card.target_sentence, card.example);
  assert.equal(card.usage, entry.usage);
  assert.ok(workspace.compareReviewAnswer("look forward to", card.target_sentence).exact);
});

test("filters combine Chinese/English search, kind, source course, and due date", () => {
  const entries = vocabulary.entries(vocabulary.withLibrary(seed));
  const result = vocabulary.filterEntries(entries, { query: "期待", kind: "phrase", courseId: "dating-and-entertainment", dueOnly: true, date: "2026-10-13" });
  assert.ok(result.some(i => i.item === "look forward to"));
  assert.ok(result.every(i => i.kind === "phrase"));
  assert.equal(vocabulary.filterEntries(entries, { query: "zzzzzz" }).length, 0);
  assert.equal(vocabulary.filterEntries(entries, { query: "look forward to", dueOnly: true, date: "2024-12-31" }).length, 0);
});
