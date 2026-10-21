(function initVocabulary(root) {
  "use strict";
  const GROUP_ID = "__english_coach_vocabulary__";
  const REVIEW_BATCH_SIZE = 30;
  const SPELLING_VARIANTS = {
    customize: ["customise"], customized: ["customised"],
    favorite: ["favourite"], favourite: ["favorite"],
    flavor: ["flavour"], flavour: ["flavor"],
    humor: ["humour"], humour: ["humor"],
    apologize: ["apologise"], apologise: ["apologize"],
    donut: ["doughnut"], doughnut: ["donut"],
    behavior: ["behaviour"], behaviour: ["behavior"],
    discolored: ["discoloured"], discolor: ["discolour"],
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[‐–—]/g, "-").replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ").trim();
  const supplements = root.EnglishCoachDoubaoVocabulary?.entries || [];
  const guides = [...(root.EnglishCoachVocabularyGuides || []), ...supplements];
  const byExpression = new Map();
  for (const guide of guides) {
    for (const form of [guide.term, ...(guide.aliases || [])]) {
      if (!byExpression.has(normalize(form))) byExpression.set(normalize(form), guide);
    }
  }

  const matchers = guides.map(guide => ({ guide,
    forms: [guide.term, ...(guide.aliases || [])].map(form => ` ${normalize(form)} `),
  }));

  function standaloneGuide(item) {
    return byExpression.get(normalize(item?.item || item?.answer));
  }

  function isStandalone(item) {
    if (item?.course_id === GROUP_ID) return false;
    const guide = standaloneGuide(item);
    return Boolean(guide && guide.kind !== "expression") || completeGuide(item?.vocabulary_guide);
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
    const include = (guide, source, supplementalSource = null) => {
      if (!completeGuide(guide) || (!supplementalSource && !coursesById.has(source.course_id))) return;
      const key = normalize(guide.term);
      if (!collected.has(key)) collected.set(key, { guide, sources: new Map() });
      const entry = collected.get(key);
      if (supplementalSource && entry.guide !== guide) {
        const prior = entry.guide;
        const meaning = prior.meaning.includes(guide.meaning) ? prior.meaning : `${prior.meaning}；${guide.meaning}`;
        const usage = prior.usage.includes(guide.usage) ? prior.usage : `${prior.usage}\n补充用法：${guide.usage}`;
        entry.guide = { ...prior, ...guide, term: prior.term, kind: prior.kind, meaning, usage };
      }
      const sourceInfo = supplementalSource || {
        course_id: source.course_id,
        title: coursesById.get(source.course_id).title || source.course_id,
        source_type: "course",
      };
      entry.sources.set(sourceInfo.course_id, sourceInfo);
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
    // Study-summary material belongs directly to the independent library. It
    // contributes source labels, without creating courses in the course list.
    for (const guide of supplements) {
      for (const topic of guide.topics || ["学习汇总"]) include(guide, null, {
        course_id: `notes:doubao:${encodeURIComponent(topic)}`,
        title: `豆包汇总 · ${topic}`, source_type: "notes",
      });
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
        pronunciation: guide.pronunciation || "",
        source: "Words & phrases", source_courses: [...sources.values()],
        accepted_answers: guide.accepted_answers || SPELLING_VARIANTS[key] || [],
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
      && (courseId === "all" || item.source_courses?.some(c => c.course_id === courseId
        || (courseId === "notes:doubao:all" && c.source_type === "notes")))
      && (!dueOnly || String(item.next_due || "9999-12-31") <= date)
      && (!search || normalize(`${item.item} ${item.meaning} ${item.usage} ${item.example} ${item.example_zh}`).includes(search)));
  }

  function reviewBatch(items, { date, excludedIds = [] } = {}) {
    const excluded = new Set(excludedIds);
    // Saved history keeps a newly opened round from always starting at A.
    // Within due/future cards, favour the least reviewed expressions first.
    return items.filter(item => !excluded.has(item.id)).sort((a, b) => {
      const dueA = String(a.next_due || "9999-12-31") <= date;
      const dueB = String(b.next_due || "9999-12-31") <= date;
      const historyA = Array.isArray(a.history) ? a.history : [];
      const historyB = Array.isArray(b.history) ? b.history : [];
      const latest = history => history.reduce((last, event) => {
        const stamp = event?.synced_at || event?.reviewed_at || event?.date || "";
        return stamp > last ? stamp : last;
      }, "");
      return Number(dueB) - Number(dueA)
        || historyA.length - historyB.length
        || latest(historyA).localeCompare(latest(historyB))
        || a.item.localeCompare(b.item, "en");
    }).slice(0, REVIEW_BATCH_SIZE);
  }

  root.EnglishCoachVocabulary = { GROUP_ID, REVIEW_BATCH_SIZE, withLibrary, courseWorkspace, entries, filterEntries, reviewBatch, isStandalone, normalize };
})(typeof globalThis !== "undefined" ? globalThis : this);
