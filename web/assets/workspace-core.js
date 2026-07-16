(function initEnglishCoachWorkspace(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EnglishCoachWorkspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildWorkspaceCore() {
  "use strict";

  const RESULT_MASTERY_WEIGHTS = {
    pending: [0, 0, 0],
    fail: [5, 5, 10],
    shaky: [25, 10, 15],
    pass: [55, 25, 20],
  };
  const INTERVAL_STEPS = [1, 2, 4, 7, 14, 30];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function effectiveResult(item) {
    const result = String(item?.last_result || "").trim().toLowerCase();
    if (Object.hasOwn(RESULT_MASTERY_WEIGHTS, result)) return result;
    return ({ new: "pending", needs_review: "shaky", reviewing: "pass" })[
      String(item?.status || "").trim().toLowerCase()
    ] || "pending";
  }

  function historyPassRatio(item) {
    const results = (item?.history || [])
      .map((entry) => String(entry?.result || "").trim().toLowerCase())
      .filter((result) => ["pass", "shaky", "fail"].includes(result));
    return results.length ? results.filter((result) => result === "pass").length / results.length : 0;
  }

  function cardMasteryScore(item) {
    const [base, intervalWeight, historyWeight] = RESULT_MASTERY_WEIGHTS[effectiveResult(item)];
    const interval = Math.min(Math.max(Number(item?.interval_days || 0), 0), 30) / 30;
    const score = base + (interval * intervalWeight) + (historyPassRatio(item) * historyWeight);
    return Math.round(Math.min(Math.max(score, 0), 100) * 10) / 10;
  }

  function masteryLabel(score, hasCards = true) {
    if (!hasCards) return "未开始";
    if (score < 20) return "很不熟悉";
    if (score < 45) return "不熟悉";
    if (score < 70) return "学习中";
    if (score < 90) return "较熟悉";
    return "已掌握";
  }

  function reviewKeywords(item) {
    const stopWords = new Set([
      "a", "an", "and", "are", "at", "be", "but", "for", "i", "is", "it", "of", "on", "or",
      "so", "that", "the", "this", "to", "was", "we", "were", "you",
    ]);
    const tokens = String(item?.item || item?.example || "")
      .toLowerCase()
      .match(/[a-z]+(?:'[a-z]+)?/g) || [];
    return tokens.filter((token) => token.length > 1 && !stopWords.has(token)).slice(0, 8);
  }

  function reviewCard(item) {
    const prompt = ["prompt", "translation", "meaning", "zh", "chinese"]
      .map((key) => String(item?.[key] || "").trim())
      .find(Boolean) || String(item?.note || item?.item || "").trim();
    return {
      id: item?.id || "",
      prompt,
      prompt_sentence: prompt,
      answer: item?.item || "",
      target_sentence: item?.example || item?.item || "",
      example: item?.example || "",
      keywords: reviewKeywords(item),
      last_result: item?.last_result || "",
      next_due: item?.next_due || "",
      source: item?.source || "",
    };
  }

  function courseCardSort(course, left, right) {
    const order = new Map((course?.card_ids || []).map((id, index) => [id, index]));
    const leftOrder = order.has(left.id) ? order.get(left.id) : order.size;
    const rightOrder = order.has(right.id) ? order.get(right.id) : order.size;
    return leftOrder - rightOrder || String(left.id || "").localeCompare(String(right.id || ""));
  }

  function dashboardFromWorkspace(courses, reviewItems, dateText) {
    const grouped = new Map((courses || []).map((course) => [course.id, []]));
    for (const item of reviewItems || []) {
      if (grouped.has(item.course_id)) grouped.get(item.course_id).push(item);
    }

    const coursePayloads = (courses || []).map((course) => {
      const cards = [...(grouped.get(course.id) || [])].sort((a, b) => courseCardSort(course, a, b));
      const activeCards = cards.filter((item) => item.status !== "retired");
      const dueCards = activeCards.filter((item) => String(item.next_due || "9999-12-31") <= dateText);
      const completedToday = cards.filter((item) =>
        (item.history || []).some((entry) => entry?.date === dateText),
      ).length;
      const masteredCount = activeCards.filter((item) => item.last_result === "pass").length;
      const masteryScore = activeCards.length
        ? Math.round((activeCards.reduce((sum, item) => sum + cardMasteryScore(item), 0) / activeCards.length) * 10) / 10
        : 0;
      return {
        ...clone(course),
        due_count: dueCards.length,
        completed_today: completedToday,
        total_count: cards.length,
        mastered_count: masteredCount,
        mastery_score: masteryScore,
        mastery_label: masteryLabel(masteryScore, Boolean(activeCards.length)),
        all_cards: cards.map(reviewCard),
        today_cards: dueCards.map(reviewCard),
      };
    });

    coursePayloads.sort((left, right) =>
      Number(left.mastery_score || 0) - Number(right.mastery_score || 0)
      || Number(right.due_count || 0) - Number(left.due_count || 0)
      || Number(left.order ?? 9999) - Number(right.order ?? 9999)
      || String(left.title || "").localeCompare(String(right.title || "")),
    );
    return { date: dateText, courses: coursePayloads };
  }

  function addDays(dateText, days) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function nextInterval(current, result) {
    if (["fail", "shaky"].includes(result)) return 1;
    return INTERVAL_STEPS.find((step) => Number(current || 1) < step) || INTERVAL_STEPS.at(-1);
  }

  function recordReviewResult(reviewItems, itemId, result, dateText, now = new Date().toISOString()) {
    if (!["pass", "shaky", "fail"].includes(result)) throw new Error("无效的掌握结果");
    let found = false;
    const updated = (reviewItems || []).map((source) => {
      if (source.id !== itemId) return clone(source);
      found = true;
      const item = clone(source);
      const previousInterval = Number(item.interval_days || 1);
      const interval = nextInterval(previousInterval, result);
      const nextDue = addDays(dateText, interval);
      item.last_result = result;
      item.interval_days = interval;
      item.next_due = nextDue;
      item.status = result === "pass" ? "reviewing" : "needs_review";
      item.sync_updated_at = now;
      item.history = [...(item.history || []), {
        date: dateText,
        result,
        previous_interval_days: previousInterval,
        next_interval_days: interval,
        next_due: nextDue,
        synced_at: now,
      }];
      return item;
    });
    if (!found) throw new Error("没有找到这条复习内容");
    return updated;
  }

  function eventKey(entry) {
    return [
      entry?.synced_at || "",
      entry?.date || "",
      entry?.result || "",
      entry?.next_due || "",
      entry?.next_interval_days ?? "",
    ].join("|");
  }

  function progressStamp(item) {
    const history = item?.history || [];
    const latest = history.reduce((value, entry) =>
      String(entry?.synced_at || entry?.date || "") > value
        ? String(entry?.synced_at || entry?.date || "")
        : value,
    "");
    return String(item?.sync_updated_at || latest || "");
  }

  function mergeReviewItem(localItem, remoteItem) {
    if (!localItem) return clone(remoteItem);
    if (!remoteItem) return clone(localItem);
    const localStamp = progressStamp(localItem);
    const remoteStamp = progressStamp(remoteItem);
    const localHistoryLength = (localItem.history || []).length;
    const remoteHistoryLength = (remoteItem.history || []).length;
    const progressSource = remoteStamp > localStamp || (
      remoteStamp === localStamp && remoteHistoryLength > localHistoryLength
    ) ? remoteItem : localItem;
    const contentSource = localItem.item || localItem.prompt ? localItem : remoteItem;
    const historyMap = new Map();
    for (const entry of [...(localItem.history || []), ...(remoteItem.history || [])]) {
      historyMap.set(eventKey(entry), clone(entry));
    }
    return {
      ...clone(remoteItem),
      ...clone(contentSource),
      last_result: progressSource.last_result,
      interval_days: progressSource.interval_days,
      next_due: progressSource.next_due,
      status: progressSource.status,
      sync_updated_at: progressSource.sync_updated_at,
      history: [...historyMap.values()].sort((left, right) => eventKey(left).localeCompare(eventKey(right))),
    };
  }

  function mergeCourse(localCourse, remoteCourse) {
    if (!localCourse) return clone(remoteCourse);
    if (!remoteCourse) return clone(localCourse);
    return {
      ...clone(remoteCourse),
      ...clone(localCourse),
      source_files: [...new Set([...(localCourse.source_files || []), ...(remoteCourse.source_files || [])])],
      card_ids: [...new Set([...(localCourse.card_ids || []), ...(remoteCourse.card_ids || [])])],
    };
  }

  function mergeWorkspace(local, remote) {
    const localCourses = new Map((local?.courses || []).map((item) => [item.id, item]));
    const remoteCourses = new Map((remote?.courses || []).map((item) => [item.id, item]));
    const localItems = new Map((local?.review_items || []).map((item) => [item.id, item]));
    const remoteItems = new Map((remote?.review_items || []).map((item) => [item.id, item]));
    const courseIds = [...new Set([...localCourses.keys(), ...remoteCourses.keys()])];
    const itemIds = [...new Set([...localItems.keys(), ...remoteItems.keys()])];
    return {
      courses: courseIds.map((id) => mergeCourse(localCourses.get(id), remoteCourses.get(id))),
      review_items: itemIds.map((id) => mergeReviewItem(localItems.get(id), remoteItems.get(id))),
    };
  }

  function workspaceFingerprint(workspace) {
    const normalized = {
      courses: [...(workspace?.courses || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      review_items: [...(workspace?.review_items || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    };
    return JSON.stringify(normalized);
  }

  return {
    cardMasteryScore,
    dashboardFromWorkspace,
    masteryLabel,
    mergeWorkspace,
    recordReviewResult,
    reviewCard,
    workspaceFingerprint,
  };
});
