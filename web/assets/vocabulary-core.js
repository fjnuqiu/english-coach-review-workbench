(function initVocabulary(root) {
  "use strict";
  const GROUP_ID = "__english_coach_vocabulary__";
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[‐–—]/g, "-").replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ").trim();
  const guides = root.EnglishCoachVocabularyGuides || [];
  const byExpression = new Map();
  for (const guide of guides) {
    for (const form of [guide.term, ...(guide.aliases || [])]) byExpression.set(normalize(form), guide);
  }

  const matchers = guides.map(guide => ({ guide,
    forms: [guide.term, ...(guide.aliases || [])].map(form => ` ${normalize(form)} `),
  }));

  function standaloneGuide(item) {
    return byExpression.get(normalize(item?.item || item?.answer));
  }

  function isStandalone(item) {
    if (item?.course_id === GROUP_ID) return false;
    return Boolean(standaloneGuide(item)) || completeGuide(item?.vocabulary_guide);
  }

  function completeGuide(value) {
    return value?.term && value?.meaning && value?.usage && value?.example && value?.example_zh;
  }

  function withLibrary(value) {
    const input = copy(value || { courses: [], review_items: [] });
    const courses = (input.courses || []).filter(c => c.id !== GROUP_ID);
    const sourceItems = (input.review_items || []).filter(i => i.course_id !== GROUP_ID && i.status !== "retired");
    const previousItems = new Map((input.review_items || []).filter(i => i.course_id === GROUP_ID).map(i => [i.id, i]));
    const coursesById = new Map(courses.map(c => [c.id, c]));
    const collected = new Map();
    const include = (guide, source) => {
      if (!completeGuide(guide) || !coursesById.has(source.course_id)) return;
      const key = normalize(guide.term);
      if (!collected.has(key)) collected.set(key, { guide, sources: new Map() });
      const entry = collected.get(key);
      entry.sources.set(source.course_id, {
        course_id: source.course_id,
        title: coursesById.get(source.course_id).title || source.course_id,
      });
    };
    for (const item of sourceItems) {
      const text = ` ${normalize(`${item.item || ""} ${item.example || ""}`).replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ")} `;
      const direct = standaloneGuide(item);
      if (direct) include(direct, item);
      for (const { guide, forms } of matchers) {
        if (forms.some(form => text.includes(form))) include(guide, item);
      }
      // Newly imported courses may carry their own full, contextual vocabulary guides.
      // These stay inside the learner's private workspace, rather than the public bundle.
      for (const guide of Array.isArray(item.vocabulary) ? item.vocabulary : []) include(guide, item);
      if (completeGuide(item.vocabulary_guide)) include(item.vocabulary_guide, item);
    }
    const items = [...collected.entries()].map(([key, { guide, sources }]) => {
      const id = `vocab:${encodeURIComponent(key)}`;
      const existing = previousItems.get(id) || {};
      return {
        ...existing,
        id, course_id: GROUP_ID, type: "vocabulary", item: guide.term,
        kind: guide.kind || (guide.term.split(/\s+/).length === 1 ? "word" : "phrase"),
        prompt: guide.meaning, meaning: guide.meaning, usage: guide.usage,
        example: guide.example, example_zh: guide.example_zh,
        source: "Words & phrases", source_courses: [...sources.values()],
        accepted_answers: guide.accepted_answers || [],
        status: existing.status || "new", last_result: existing.last_result || "pending",
        next_due: existing.next_due || "2025-01-01", interval_days: existing.interval_days || 1,
        history: Array.isArray(existing.history) ? existing.history : [],
      };
    }).sort((a, b) => a.item.localeCompare(b.item, "en"));
    // Retain saved entries even if a source course has since been retired.
    for (const old of previousItems.values()) {
      if (!items.some(item => item.id === old.id)) items.push(old);
    }
    const previousCourse = (input.courses || []).find(c => c.id === GROUP_ID) || {};
    const group = {
      ...previousCourse, id: GROUP_ID, course_group: "vocabulary", title: "单词与短语",
      summary_zh: "先理解意思，再掌握用法，最后用例句加深记忆。",
      card_ids: items.map(item => item.id), selected_card_ids: [], order: 10000,
    };
    return { courses: [...courses, group], review_items: [...(input.review_items || []).filter(i => i.course_id !== GROUP_ID), ...items] };
  }

  function courseWorkspace(value) {
    return {
      courses: (value?.courses || []).filter(c => c.id !== GROUP_ID),
      review_items: (value?.review_items || []).filter(i => i.course_id !== GROUP_ID && !isStandalone(i)),
    };
  }

  function entries(value) {
    return (value?.review_items || []).filter(item => item.course_id === GROUP_ID && item.status !== "retired");
  }

  function filterEntries(items, { query = "", kind = "all", courseId = "all", dueOnly = false, date = "" } = {}) {
    const search = normalize(query);
    return items.filter(item => (kind === "all" || item.kind === kind)
      && (courseId === "all" || item.source_courses?.some(c => c.course_id === courseId))
      && (!dueOnly || String(item.next_due || "9999-12-31") <= date)
      && (!search || normalize(`${item.item} ${item.meaning} ${item.usage} ${item.example} ${item.example_zh}`).includes(search)));
  }

  root.EnglishCoachVocabulary = { GROUP_ID, withLibrary, courseWorkspace, entries, filterEntries, isStandalone, normalize };
})(typeof globalThis !== "undefined" ? globalThis : this);
