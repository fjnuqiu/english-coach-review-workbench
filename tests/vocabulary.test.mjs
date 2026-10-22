import assert from "node:assert/strict";
import test from "node:test";

await import("../web/assets/workspace-core.js");
await import("../web/assets/video-course-seed.js");
await import("../web/assets/vocabulary-guides.js");
await import("../web/assets/doubao-vocabulary-seed.js");
await import("../web/assets/vocabulary-metadata.js");
await import("../web/assets/vocabulary-core.js");
const vocabulary = globalThis.EnglishCoachVocabulary;
const workspace = globalThis.EnglishCoachWorkspace;
const seed = globalThis.EnglishCoachVideoCourseSeed.workspace();
const supplementary = globalThis.EnglishCoachDoubaoVocabulary;

test("all bundled courses contribute teaching entries, with explanations and actual examples", () => {
  const library = vocabulary.withLibrary(seed);
  const entries = vocabulary.entries(library);
  const sourceIds = new Set(entries.flatMap(item => item.source_courses.filter(c => c.source_type !== "notes").map(c => c.course_id)));
  assert.equal(sourceIds.size, seed.courses.length);
  assert.ok(entries.length > 150);
  for (const item of entries) {
    for (const field of ["meaning", "usage", "example", "example_zh"]) assert.ok(item[field]?.trim(), `${item.item}: ${field}`);
    if (item.kind !== "expression") assert.notEqual(item.example.toLowerCase(), item.item.toLowerCase(), `${item.item}: example must be a sentence`);
    assert.ok(item.example.split(/\s+/).length >= 3);
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
  assert.deepEqual(entries.find(i => i.item === "parrot").source_courses.filter(c => c.source_type !== "notes").map(c => c.course_id), ["one", "two"]);
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

test("Doubao material is visible without a matching course and does not create course rows", () => {
  const value = vocabulary.withLibrary({ courses: [], review_items: [] });
  const items = vocabulary.entries(value);
  assert.ok(items.length > 1000);
  assert.equal(value.courses.length, 1);
  assert.equal(vocabulary.courseWorkspace(value).courses.length, 0);
  const notes = vocabulary.filterEntries(items, { courseId: "notes:doubao:all" });
  assert.equal(notes.length, items.length);
  assert.ok(vocabulary.filterEntries(notes, { kind: "word", query: "career-minded" }).length);
  assert.ok(vocabulary.filterEntries(notes, { kind: "expression", query: "patience" }).length);
});

test("shared course and note terms remain one card with both sources and retain saved progress", () => {
  const value = vocabulary.withLibrary(seed);
  const entries = vocabulary.entries(value);
  const term = entries.find(item => item.item === "look forward to");
  assert.equal(entries.filter(item => item.item === "look forward to").length, 1);
  assert.ok(term.source_courses.some(s => s.source_type === "course"));
  assert.ok(term.source_courses.some(s => s.source_type === "notes"));
  const graded = { ...value, review_items: workspace.recordReviewResult(value.review_items, term.id, "pass", "2026-10-13", "2026-10-13T08:00:00Z") };
  const restored = vocabulary.entries(vocabulary.withLibrary(graded)).find(item => item.id === term.id);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.next_due, "2026-10-15");
});

test("summary expressions leave original complete course sentences in the course view", () => {
  const sentence = "I still keep in touch with my colleagues.";
  const value = { courses: [{ id: "original" }], review_items: [{ id: "original-card", course_id: "original", item: sentence }] };
  const regular = vocabulary.courseWorkspace(vocabulary.withLibrary(value));
  assert.equal(regular.review_items[0].item, sentence);
});

test("reviewed pronunciation and usage distinctions survive importing", () => {
  const items = vocabulary.entries(vocabulary.withLibrary(seed));
  const live = items.find(item => item.item === "live");
  assert.match(live.pronunciation, /lɪv/);
  assert.match(live.pronunciation, /laɪv/);
  assert.match(live.usage, /词性/);
  assert.match(items.find(item => item.item === "chef").usage, /不必然/);
  assert.match(items.find(item => item.item === "cuddle").usage, /give.*cuddle/);
  assert.match(items.find(item => item.item === "dairy").usage, /diary/);
});

test("public supplement contains teaching content without conversations or learner records", () => {
  const material = JSON.stringify(supplementary);
  assert.doesNotMatch(material, /doubao\.com\/chat|\/Users\/|Qiu Jincheng|Jingjing|三江口|630110999/);
  for (const entry of supplementary.entries) {
    assert.ok(entry.source_lines.length);
    for (const key of ["history", "user_id", "next_due", "status"]) assert.equal(key in entry, false);
    for (const key of ["meaning", "usage", "example", "example_zh"]) assert.ok(entry[key]);
  }
});

test("standalone vocabulary rejects changed meanings even when the root matches", () => {
  assert.equal(workspace.compareVocabularyAnswer("career-minded", "career").coreCorrect, false);
  assert.equal(workspace.compareVocabularyAnswer("few", "a few").coreCorrect, false);
  assert.equal(workspace.compareVocabularyAnswer("little", "a little").coreCorrect, false);
  assert.equal(workspace.compareVocabularyAnswer("career-minded", "career-minded").exact, true);
  assert.equal(workspace.compareVocabularyAnswer("customise", "customize", [], ["customise"]).exact, true);
  const favorite = vocabulary.entries(vocabulary.withLibrary(seed)).find(item => item.item === "favourite");
  assert.ok(favorite.accepted_answers.includes("favorite"));
});

test("a vocabulary round caps a large library at 30 and advances from saved reviews", () => {
  const library = vocabulary.withLibrary(seed);
  const before = structuredClone(library);
  const first = vocabulary.reviewBatch(vocabulary.entries(library), { date: "2026-10-21" });
  assert.equal(first.length, 30);
  assert.deepEqual(library, before);
  let reviewed = library.review_items;
  for (const item of first) reviewed = workspace.recordReviewResult(reviewed, item.id, "reviewed", "2026-10-21");
  const reloaded = vocabulary.withLibrary({ ...library, review_items: reviewed });
  const next = vocabulary.reviewBatch(vocabulary.entries(reloaded), { date: "2026-10-21" });
  assert.equal(next.length, 30);
  assert.ok(next.every(item => !first.some(prior => prior.id === item.id)));
});

test("batch selection favours due and least-reviewed cards, respects exclusions, and permits short final groups", () => {
  const items = [
    { id: "future", item: "A", next_due: "2026-11-01", history: [] },
    { id: "old", item: "B", next_due: "2026-10-20", history: [{ date: "2026-10-01" }] },
    { id: "new", item: "C", next_due: "2026-10-21", history: [] },
    { id: "recent", item: "D", next_due: "2026-10-21", history: [{ date: "2026-10-19" }] },
  ];
  assert.deepEqual(vocabulary.reviewBatch(items, { date: "2026-10-21" }).map(item => item.id), ["new", "old", "recent", "future"]);
  assert.deepEqual(vocabulary.reviewBatch(items, { date: "2026-10-21", excludedIds: ["new", "old", "recent"] }).map(item => item.id), ["future"]);
  assert.deepEqual(vocabulary.reviewBatch([], { date: "2026-10-21" }), []);
});

test("every bundled word and phrase has pronunciation and sense-specific grammatical labels", () => {
  const entries = vocabulary.entries(vocabulary.withLibrary(seed));
  const lexical = entries.filter(item => item.kind !== "expression");
  assert.equal(lexical.length, 889);
  for (const item of lexical) {
    assert.match(item.pronunciation, /\/[^/]+\//, `${item.item}: IPA`);
    assert.ok(item.part_of_speech?.trim(), `${item.item}: part of speech`);
  }
  for (const sentence of entries.filter(item => item.kind === "expression")) {
    assert.equal(sentence.part_of_speech, "", `${sentence.item}: sentences are not single words`);
  }
  const find = term => entries.find(item => item.item === term);
  assert.equal(find("accompany").part_of_speech, "vt. 及物动词");
  assert.equal(find("arrive").part_of_speech, "vi. 不及物动词");
  assert.equal(find("calling").part_of_speech, "n. 名词");
  assert.equal(find("net").part_of_speech, "adj. 形容词");
  assert.equal(find("look forward to").part_of_speech, "动词短语");
  assert.equal(find("litter box").part_of_speech, "名词短语");
  assert.equal(find("Take care!").part_of_speech, "句型/固定表达");
});

test("metadata covers course guides outside the bundled course set and reaches actual review cards", () => {
  const guides = globalThis.EnglishCoachVocabularyGuides;
  const value = vocabulary.withLibrary({
    courses: [{ id: "all-guides", title: "All guides" }],
    review_items: guides.map((guide, index) => ({ id: `guide-${index}`, course_id: "all-guides", item: guide.term })),
  });
  const entries = vocabulary.entries(value);
  for (const guide of guides) {
    const entry = entries.find(item => vocabulary.normalize(item.item) === vocabulary.normalize(guide.term));
    assert.ok(entry?.part_of_speech, guide.term);
    assert.ok(entry?.pronunciation, guide.term);
    const card = workspace.reviewCard(entry);
    assert.equal(card.part_of_speech, entry.part_of_speech);
    assert.equal(card.pronunciation, entry.pronunciation);
    assert.equal(card.prompt_sentence, entry.meaning);
  }
  const live = entries.find(item => item.item === "live");
  assert.match(live.pronunciation, /lɪv/);
  assert.match(live.pronunciation, /laɪv/);
  const close = entries.find(item => item.item === "close");
  assert.match(close.pronunciation, /kləʊs/);
  assert.match(close.pronunciation, /kləʊz/);
});

test("private guide metadata is retained and lexical enrichment keeps existing review identities and progress", () => {
  const guide = { term: "private term", kind: "phrase", meaning: "私有术语", usage: "私有用法", example: "Use this private term.", example_zh: "使用这个私有术语。", pronunciation: "/ˈpraɪvət tɜːm/", part_of_speech: "名词短语" };
  const value = vocabulary.withLibrary({ courses: [{ id: "private" }], review_items: [{ id: "private-card", course_id: "private", vocabulary: [guide] }] });
  const entry = vocabulary.entries(value).find(item => item.item === guide.term);
  assert.equal(entry.pronunciation, guide.pronunciation);
  assert.equal(entry.part_of_speech, guide.part_of_speech);
  const reviewed = { ...value, review_items: workspace.recordReviewResult(value.review_items, entry.id, "reviewed", "2026-10-22", "2026-10-22T03:00:00Z", "metadata-check") };
  const before = reviewed.review_items.find(item => item.id === entry.id);
  const after = vocabulary.entries(vocabulary.withLibrary(reviewed)).find(item => item.id === entry.id);
  assert.equal(after.id, before.id);
  assert.equal(after.next_due, before.next_due);
  assert.deepEqual(after.history, before.history);
});
