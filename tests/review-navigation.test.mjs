import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

await import("../web/assets/workspace-core.js");
await import("../web/assets/vocabulary-core.js");
const workspace = globalThis.EnglishCoachWorkspace;
const vocabulary = globalThis.EnglishCoachVocabulary;
const app = await readFile(new URL("../web/assets/app.js", import.meta.url), "utf8");
// Exercise the production handlers without starting account/network initialization.
const handlers = app.slice(0, app.lastIndexOf("\ninitialize().catch("));

function fixture({ kind = "course", mode = "full", count = 2, local = false, saveItem, saveCourse } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === "reviewDateInput" ? "2026-10-19" : ["vocabularyKind", "vocabularySource"].includes(id) ? "all" : "", style: {},
      classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {},
    });
    return nodes.get(id);
  };
  const grades = [node("pass"), node("shaky"), node("fail")];
  const calls = { items: [], courses: [], local: [], toasts: [], refreshes: 0 };
  const courseId = kind === "vocabulary" ? vocabulary.GROUP_ID : "lesson";
  const items = Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, course_id: courseId, item: `Example ${i}`, prompt: `中文 ${i}`, interval_days: 1, next_due: "2026-10-19", last_result: "pending", history: [] }));
  const course = { id: courseId, title: "Fixture", card_ids: items.map(item => item.id) };
  const context = vm.createContext({
    window: {
      EnglishCoachWorkspace: workspace,
      EnglishCoachVocabulary: vocabulary,
      EnglishCoachCloud: {
        async saveReviewItem(userId, item) {
          calls.items.push(structuredClone(item));
          await saveItem?.(item);
        },
        async saveCourse(userId, value) {
          calls.courses.push(structuredClone(value));
          await saveCourse?.(value);
        },
      },
    },
    document: { getElementById: node, querySelectorAll: selector => selector === ".grade-button" ? grades : [] },
    fixtureRefresh: async () => { calls.refreshes += 1; },
    fixtureToast: message => calls.toasts.push(message),
    fixtureApi: async (path, options) => { calls.local.push({ path, body: JSON.parse(options.body) }); },
  });
  vm.runInContext(handlers + `
    refreshDashboard = async () => {
      await fixtureRefresh();
      state.vocabularyWorkspace = { courses: state.cloudCourses, review_items: state.cloudReviewItems };
    };
    showToast = fixtureToast;
    apiJson = fixtureApi;
    scheduleCloudSync = () => {};
    renderCourses = () => {};
    globalThis.frontend = { state, activeCard, goToPreviousReviewCard, goToNextReviewCard, submitReviewResult, renderActiveCard, startCourseReview, closeCourseReview, startVocabularyReview, continueVocabularyReview, startVocabularyGroup, vocabularyGroups, setVocabularyGroupFilter, renderVocabulary, vocabularyTeachingHtml, revealReviewAnswer };
  `, context);
  const frontend = context.frontend;
  Object.assign(frontend.state, {
    user: { id: "fixture-user" }, localBackendAvailable: local,
    cloudCourses: [course], cloudReviewItems: items,
    localWorkspace: { courses: [course], review_items: items },
    vocabularyWorkspace: { courses: [course], review_items: items },
    sessionKind: kind, sessionMode: mode, selectedCourseId: courseId,
    sessionCards: items.map(workspace.reviewCard), currentReviewIndex: 0,
    sessionInitialCount: count, reviewSessionId: "fixture-session", fullReviewCompletionEventId: "fixture-round",
    dashboard: workspace.dashboardFromWorkspace([course], items, "2026-10-19"),
  });
  frontend.renderActiveCard();
  return { ...frontend, calls, node };
}

test("Next saves each card and counts a full round only after submitting the last one", async () => {
  const view = fixture();
  assert.equal(view.calls.courses.length, 0);
  await view.goToNextReviewCard();
  assert.equal(view.calls.items[0].history[0].result, "reviewed");
  assert.equal(view.activeCard().id, "card-1");
  assert.equal(view.node("sessionProgressText").textContent, "1 complete");
  assert.equal(view.calls.courses.length, 0);
  assert.equal(view.node("nextReviewButton").disabled, false);
  assert.equal(view.node("nextReviewButton").textContent, "完成本轮 ✓");
  await view.goToNextReviewCard();
  assert.equal(view.calls.courses.length, 1);
  assert.equal(view.calls.courses[0].full_review_events.length, 1);
  assert.equal(view.activeCard(), null);
  assert.equal(view.state.sessionCards.length, 2);
  assert.equal(view.node("reviewEmptyState").hidden, false);
  await view.goToNextReviewCard();
  assert.equal(view.calls.items.length, 2);
});

test("a failed save leaves both the card and cloud progress unchanged", async () => {
  const view = fixture({ saveItem: () => { throw Error("offline"); } });
  await view.goToNextReviewCard();
  assert.equal(view.state.sessionCards[0].id, "card-0");
  assert.equal(view.state.cloudReviewItems[0].history.length, 0);
  assert.equal(view.calls.courses.length, 0);
  assert.equal(view.node("nextReviewButton").disabled, false);
  assert.match(view.calls.toasts.at(-1), /offline/);
});

test("repeated clicks while saving do not duplicate reviews or skip cards", async () => {
  let finish;
  const view = fixture({ saveItem: () => new Promise(resolve => { finish = resolve; }) });
  const pending = view.goToNextReviewCard();
  await view.goToNextReviewCard();
  await view.submitReviewResult("pass");
  assert.equal(view.node("nextReviewButton").disabled, true);
  assert.equal(view.calls.items.length, 1);
  finish();
  await pending;
  assert.equal(view.state.currentReviewIndex, 1);
  assert.equal(view.state.sessionReviewedIds.length, 1);
});

test("a failed round save can be retried without counting the final card twice", async () => {
  let attempts = 0;
  const view = fixture({ count: 1, saveCourse: () => { if (++attempts === 1) throw Error("round offline"); } });
  await view.goToNextReviewCard();
  assert.equal(view.state.sessionCards.length, 1);
  assert.equal(view.state.cloudReviewItems[0].history.length, 1);
  assert.equal(view.state.fullReviewCompletionRecorded, false);
  await view.goToNextReviewCard();
  assert.equal(view.state.cloudReviewItems[0].history.length, 1);
  assert.equal(view.state.cloudCourses[0].full_review_events.length, 1);
  assert.equal(view.activeCard(), null);
  assert.equal(view.calls.items.length, 1);
  assert.equal(view.calls.refreshes, 1);
});

test("switching courses while saving does not advance or complete the new session", async () => {
  let finish;
  const view = fixture({ saveItem: () => new Promise(resolve => { finish = resolve; }) });
  const pending = view.goToNextReviewCard();
  view.startCourseReview("lesson", "due");
  finish();
  await pending;
  assert.equal(view.state.sessionCards.length, 2);
  assert.equal(view.state.sessionMode, "due");
  assert.equal(view.calls.courses.length, 0);
});

test("Next works for independent vocabulary and local courses without creating full-course rounds", async () => {
  const vocabulary = fixture({ kind: "vocabulary", mode: "vocabulary", count: 1 });
  await vocabulary.goToNextReviewCard();
  assert.equal(vocabulary.calls.items.length, 1);
  assert.equal(vocabulary.calls.courses.length, 0);
  assert.equal(vocabulary.activeCard(), null);
  const local = fixture({ local: true, mode: "due" });
  await local.goToNextReviewCard();
  assert.equal(local.calls.local[0].path, "/api/review-result");
  assert.equal(local.calls.local[0].body.result, "reviewed");
  assert.ok(local.calls.local[0].body.event_id);
  assert.equal(local.state.currentReviewIndex, 1);
});

test("vocabulary completes 30/30/1 batches without repeats or a false full-course round", async () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 61 });
  view.startVocabularyReview("filtered");
  assert.equal(view.state.sessionCards.length, 30);
  assert.equal(view.node("reviewPositionText").textContent, "1 / 30");
  view.continueVocabularyReview();
  assert.equal(view.state.sessionCards.length, 30);
  const seen = new Set();
  for (const batchSize of [30, 30, 1]) {
    assert.equal(view.state.sessionInitialCount, batchSize);
    while (view.activeCard()) {
      const id = view.activeCard().id;
      assert.ok(!seen.has(id), id);
      seen.add(id);
      await view.goToNextReviewCard();
    }
    assert.equal(view.node("reviewEmptyState").hidden, false);
    assert.equal(view.node("reviewPositionText").textContent, `${batchSize} / ${batchSize}`);
    assert.equal(view.node("vocabularyNextBatchButton").hidden, seen.size === 61);
    if (seen.size < 61) view.continueVocabularyReview();
  }
  view.continueVocabularyReview();
  assert.equal(view.activeCard(), null);
  assert.equal(view.calls.items.length, 61);
  assert.equal(view.calls.courses.length, 0);
  assert.ok(view.state.cloudReviewItems.every(item => item.history.length === 1));
});

test("reopening vocabulary uses saved progress instead of restarting the first batch", async () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 65 });
  view.startVocabularyReview("filtered");
  const first = new Set(view.state.sessionCards.map(card => card.id));
  while (view.activeCard()) await view.goToNextReviewCard();
  view.closeCourseReview();
  view.startVocabularyReview("filtered");
  assert.equal(view.state.sessionCards.length, 30);
  assert.ok(view.state.sessionCards.every(card => !first.has(card.id)));
});

test("batching respects search and due filters while single-item and course practice retain their size", () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 65 });
  view.state.vocabularyWorkspace.review_items[0].next_due = "2026-10-20";
  view.node("vocabularySearch").value = "Example 0";
  view.startVocabularyReview("due");
  assert.equal(view.state.vocabularyReview, null);
  view.node("vocabularySearch").value = "Example 6";
  view.startVocabularyReview("filtered");
  assert.equal(view.state.sessionCards.length, 6);
  view.startVocabularyReview("single", "card-0");
  assert.equal(view.state.sessionCards.length, 1);
  const course = fixture({ count: 65 });
  course.startCourseReview("lesson", "full");
  assert.equal(course.state.sessionCards.length, 65);
});

test("recall prompt stays Chinese-only while revealed meaning retains escaped grammatical labels and IPA", () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 1 });
  const details = { meaning: "陪同", pronunciation: "/əˈkʌmpəni/", part_of_speech: "vt. 及物动词 <tag>" };
  Object.assign(view.state.vocabularyWorkspace.review_items[0], details);
  Object.assign(view.state.sessionCards[0], details, { prompt_sentence: "陪同" });
  view.renderActiveCard();
  assert.equal(view.node("reviewPrompt").textContent, "陪同");
  assert.equal(view.node("vocabularyExplanation").hidden, true);
  view.renderVocabulary();
  assert.match(view.node("vocabularyList").innerHTML, /<strong class="vocabulary-meaning">陪同<span class="vocabulary-meta">/);
  view.revealReviewAnswer();
  assert.equal(view.node("vocabularyExplanation").hidden, false);
  assert.match(view.node("vocabularyExplanation").innerHTML, /陪同<span class="vocabulary-meta">vt\. 及物动词 &lt;tag&gt; · \/əˈkʌmpəni\//);
  assert.equal(view.node("reviewPrompt").textContent, "陪同");
  view.renderActiveCard();
  assert.equal(view.node("vocabularyExplanation").hidden, true);
  assert.equal(view.node("reviewPrompt").textContent, "陪同");
});

test("Previous returns to saved cards and Next moves forward without duplicate reviews or rounds", async () => {
  for (const kind of ["course", "vocabulary"]) {
    const view = fixture({ kind, mode: kind === "course" ? "full" : "vocabulary", count: 2 });
    await view.goToNextReviewCard();
    assert.equal(view.node("previousReviewButton").disabled, false);
    view.goToPreviousReviewCard();
    assert.equal(view.activeCard().id, "card-0");
    assert.equal(view.node("sessionProgressText").textContent, "1 complete");
    assert.match(view.node("reviewNavigationNotice").textContent, /不会重复计数/);
    await view.goToNextReviewCard();
    assert.equal(view.activeCard().id, "card-1");
    assert.equal(view.calls.items.length, 1);
    await view.goToNextReviewCard();
    assert.equal(view.activeCard(), null);
    assert.equal(view.node("reviewCompletedPreviousButton").hidden, false);
    view.goToPreviousReviewCard();
    assert.equal(view.activeCard().id, "card-1");
    await view.goToNextReviewCard();
    assert.equal(view.calls.items.length, 2);
    assert.equal(view.calls.courses.length, kind === "course" ? 1 : 0);
    assert.ok(view.state.cloudReviewItems.every(item => item.history.length === 1));
  }
});

test("group status is derived from saved progress and a partial group resumes with Previous available", async () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 61 });
  view.renderVocabulary();
  assert.match(view.node("vocabularyGroupSummary").textContent, /3 组 · 已复习 0 组 · 进行中 0 组 · 未复习 3 组/);
  view.startVocabularyGroup("vocabulary-group-1");
  const first = view.activeCard().id;
  await view.goToNextReviewCard();
  view.renderVocabulary();
  assert.match(view.node("vocabularyGroupSummary").textContent, /进行中 1 组 · 未复习 2 组/);
  view.closeCourseReview();
  view.startVocabularyGroup("vocabulary-group-1");
  assert.equal(view.state.currentReviewIndex, 1);
  assert.equal(view.node("previousReviewButton").disabled, false);
  view.goToPreviousReviewCard();
  assert.equal(view.activeCard().id, first);
  await view.goToNextReviewCard();
  assert.equal(view.calls.items.length, 1);
  while (view.activeCard()) await view.goToNextReviewCard();
  view.renderVocabulary();
  assert.match(view.node("vocabularyGroupSummary").textContent, /已复习 1 组 · 进行中 0 组 · 未复习 2 组/);
  view.setVocabularyGroupFilter("reviewed");
  assert.match(view.node("vocabularyGroupList").innerHTML, /第 1 组/);
  assert.doesNotMatch(view.node("vocabularyGroupList").innerHTML, /第 2 组/);
  view.continueVocabularyReview();
  assert.equal(view.state.vocabularyReview.groupId, "vocabulary-group-2");
  assert.equal(view.state.sessionCards.length, 30);
  assert.equal(view.state.sessionReviewedIds.length, 0);
});

test("reviewed groups can be deliberately repeated, while search sessions do not masquerade as fixed groups", async () => {
  const view = fixture({ kind: "vocabulary", mode: "vocabulary", count: 2 });
  view.startVocabularyGroup("vocabulary-group-1");
  while (view.activeCard()) await view.goToNextReviewCard();
  view.startVocabularyGroup("vocabulary-group-1");
  assert.equal(view.state.sessionReviewedIds.length, 0);
  await view.goToNextReviewCard();
  assert.equal(view.state.cloudReviewItems.find(item => item.id === view.state.sessionCards[0].id).history.length, 2);
  view.node("vocabularySearch").value = "Example 1";
  view.startVocabularyReview("filtered");
  assert.match(view.node("activeCourseTitle").textContent, /筛选表达/);
  assert.equal(view.state.sessionCards.length, 1);
});
