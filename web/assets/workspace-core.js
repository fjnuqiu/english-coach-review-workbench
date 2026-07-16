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
  const DEFAULT_SELECTED_CARD_IDS = Object.freeze({
    "pet-food-safety": [
      "the-food-that-you-like-is-not-always-the-best-food-for-your-pet",
      "do-not-feed-chocolate-to-dogs",
      "kittens-cannot-drink-cow-milk",
      "chocolate-is-another-dangerous-food",
      "check-online-before-you-give-human-food-to-pets",
      "it-might-not-be-safe",
    ],
    "pet-supplies": [
      "where-do-you-usually-get-your-pet-supplies-online-or-in-store",
      "should-my-dog-always-wear-a-collar-when-i-take-it-out-for-a-walk",
      "an-automatic-litter-box-saves-time-and-is-easy-to-clean-up",
    ],
    "pet-grooming-and-attachment": [
      "grooming-not-only-makes-your-pet-pretty-but-also-keeps-it-healthy",
      "once-you-win-your-pet-s-love-and-trust-it-will-become-your-most-reliable-friend",
      "if-you-groom-an-animal-you-wash-and-clean-it-to-make-it-look-better",
      "to-grow-attached-to-means-to-start-loving-someone-a-lot",
      "he-is-very-reliable-if-he-says-he-will-do-something-he-will-do-it",
    ],
    "puppy-habits": [
      "puppies-spend-about-fourteen-hours-of-the-day-sleeping",
      "while-it-takes-a-lot-of-time-to-care-for-a-puppy-puppies-give-a-lot-of-love-back-to-their-owners",
    ],
    "lets-get-a-puppy-speaking": [
      "you-have-to-walk-the-dog-every-day-take-him-to-the-vet-when-he-is-sick-and-feed-him-when-he-is-hungry",
      "you-also-have-to-train-him-which-is-a-lot-of-work",
      "guess-what-i-am-going-to-get-us-a-pet",
      "i-do-not-think-buying-a-pet-is-a-good-decision",
      "you-do-not-know-how-to-take-care-of-a-dog",
      "why-do-not-you-get-an-animal-that-is-easier-to-take-care-of",
    ],
    "pet-decision-and-care": [
      "i-wanted-to-ask-you-for-your-advice",
      "what-do-you-do-with-them-when-you-go-on-vacation",
    ],
  });
  const NUMBER_WORD_TOKENS = Object.freeze({
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
    twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
    seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
    thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
    eighty: "80", ninety: "90",
  });

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
    if (!hasCards) return "Not started";
    if (score < 20) return "Very unfamiliar";
    if (score < 45) return "Unfamiliar";
    if (score < 70) return "Learning";
    if (score < 90) return "Familiar";
    return "Mastered";
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
      accepted_answers: Array.isArray(item?.accepted_answers) ? clone(item.accepted_answers) : [],
      note: item?.note || "",
      keywords: reviewKeywords(item),
      mastery_score: cardMasteryScore(item),
      last_result: item?.last_result || "",
      next_due: item?.next_due || "",
      source: item?.source || "",
    };
  }

  function answerTokens(value) {
    const tokens = String(value || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\bit's\b/g, "it is")
      .replace(/\bwe're\b/g, "we are")
      .replace(/\byou're\b/g, "you are")
      .replace(/\bthey're\b/g, "they are")
      .replace(/\bi'm\b/g, "i am")
      .replace(/\bcan't\b/g, "can not")
      .replace(/\bcannot\b/g, "can not")
      .replace(/\bwon't\b/g, "will not")
      .replace(/\bwouldn't\b/g, "would not")
      .replace(/\bshouldn't\b/g, "should not")
      .replace(/\bcouldn't\b/g, "could not")
      .replace(/\bisn't\b/g, "is not")
      .replace(/\baren't\b/g, "are not")
      .replace(/\bwasn't\b/g, "was not")
      .replace(/\bweren't\b/g, "were not")
      .replace(/\bhasn't\b/g, "has not")
      .replace(/\bhaven't\b/g, "have not")
      .replace(/\bhadn't\b/g, "had not")
      .replace(/\bdon't\b/g, "do not")
      .replace(/\bdoesn't\b/g, "does not")
      .replace(/\bdidn't\b/g, "did not")
      .match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
    return tokens.map((token) => NUMBER_WORD_TOKENS[token] || token);
  }

  function normalizeAnswer(value) {
    return answerTokens(value).join(" ");
  }

  function tokenDifference(sourceTokens, referenceTokens) {
    const remaining = new Map();
    for (const token of referenceTokens) remaining.set(token, (remaining.get(token) || 0) + 1);
    const unmatched = [];
    let matched = 0;
    for (const token of sourceTokens) {
      const count = remaining.get(token) || 0;
      if (count > 0) {
        matched += 1;
        remaining.set(token, count - 1);
      } else {
        unmatched.push(token);
      }
    }
    return { matched, unmatched };
  }

  function longestCommonSubsequenceLength(left, right) {
    const previous = new Array(right.length + 1).fill(0);
    for (const leftToken of left) {
      const current = new Array(right.length + 1).fill(0);
      for (let index = 1; index <= right.length; index += 1) {
        current[index] = leftToken === right[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
      }
      for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
    }
    return previous[right.length];
  }

  function semanticPolarity(tokens) {
    const markers = ["not", "no", "never", "without", "neither", "nor"];
    return markers.map((marker) => tokens.filter((token) => token === marker).length);
  }

  function numericValues(tokens) {
    return tokens.filter((token) => /^\d+$/.test(token));
  }

  function compareAgainstTarget(answer, target, keywords) {
    const answerList = answerTokens(answer);
    const targetList = answerTokens(target);
    const targetMatch = tokenDifference(targetList, answerList);
    const answerMatch = tokenDifference(answerList, targetList);
    const important = [...new Set(answerTokens((keywords || []).join(" ")))]
      .filter(Boolean);
    const importantMatches = important.filter((token) => answerList.includes(token)).length;
    const keywordCoverage = important.length ? importantMatches / important.length : 0;
    const tokenCoverage = targetList.length ? targetMatch.matched / targetList.length : 0;
    const sequenceCoverage = targetList.length
      ? longestCommonSubsequenceLength(answerList, targetList) / targetList.length
      : 0;
    const targetPolarity = semanticPolarity(targetList);
    const polarityMatches = semanticPolarity(answerList)
      .every((count, index) => count === targetPolarity[index]);
    const answerNumbers = numericValues(answerList);
    const targetNumbers = numericValues(targetList);
    const numberMatches = answerNumbers.length === targetNumbers.length
      && answerNumbers.every((value, index) => value === targetNumbers[index]);
    const semanticValuesMatch = polarityMatches && numberMatches;
    const exact = normalizeAnswer(answer) === normalizeAnswer(target);
    const coreCorrect = exact || (semanticValuesMatch && (
      keywordCoverage >= 0.66
      && tokenCoverage >= 0.66
      && sequenceCoverage >= 0.58
    )) || (semanticValuesMatch && (
      keywordCoverage >= 0.5
      && tokenCoverage >= 0.8
      && sequenceCoverage >= 0.7
    ));
    const rawCoverage = Math.round((
      (keywordCoverage * 0.45)
      + (tokenCoverage * 0.3)
      + (sequenceCoverage * 0.25)
    ) * 100);
    const coverage = semanticValuesMatch ? rawCoverage : Math.min(rawCoverage, 60);
    return {
      exact,
      coreCorrect,
      polarityMatches,
      numberMatches,
      keywordCoverage,
      tokenCoverage,
      sequenceCoverage,
      coverage,
      matchedTarget: target,
      targetTokens: targetList,
      answerTokens: answerList,
      missing: targetMatch.unmatched,
      extra: answerMatch.unmatched,
    };
  }

  function compareReviewAnswer(answer, target, keywords = [], acceptedAnswers = []) {
    const targets = [...new Set([target, ...(acceptedAnswers || [])].map((value) => String(value || "").trim()).filter(Boolean))];
    const results = targets.map((candidate) => compareAgainstTarget(answer, candidate, keywords));
    return results.sort((left, right) =>
      Number(right.exact) - Number(left.exact)
      || Number(right.coreCorrect) - Number(left.coreCorrect)
      || right.coverage - left.coverage,
    )[0] || compareAgainstTarget(answer, "", keywords);
  }

  function selectedCardIds(course) {
    if (Object.hasOwn(course || {}, "selected_card_ids")) {
      return Array.isArray(course?.selected_card_ids) ? course.selected_card_ids : [];
    }
    const knownSelection = DEFAULT_SELECTED_CARD_IDS[course?.id] || [];
    const courseIds = new Set(Array.isArray(course?.card_ids) ? course.card_ids : []);
    const availableSelection = knownSelection.filter((id) => courseIds.has(id));
    if (availableSelection.length) return availableSelection;
    return Array.isArray(course?.card_ids) ? course.card_ids : [];
  }

  function courseCardSort(course, left, right, orderField = "card_ids") {
    const order = new Map((course?.[orderField] || []).map((id, index) => [id, index]));
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
      const selectedIds = selectedCardIds(course);
      const selectedIdSet = new Set(selectedIds);
      const selectedCards = cards
        .filter((item) => selectedIdSet.has(item.id))
        .sort((a, b) => courseCardSort({ selected_card_ids: selectedIds }, a, b, "selected_card_ids"));
      const selectedActiveCards = selectedCards.filter((item) => item.status !== "retired");
      const selectedDueCards = selectedActiveCards.filter((item) => String(item.next_due || "9999-12-31") <= dateText);
      const selectedCompletedToday = selectedCards.filter((item) =>
        (item.history || []).some((entry) => entry?.date === dateText),
      ).length;
      const selectedMasteredCount = selectedActiveCards.filter((item) => item.last_result === "pass").length;
      const selectedMasteryScore = selectedActiveCards.length
        ? Math.round((selectedActiveCards.reduce((sum, item) => sum + cardMasteryScore(item), 0) / selectedActiveCards.length) * 10) / 10
        : 0;
      const priorityMasteryScore = selectedActiveCards.length ? selectedMasteryScore : masteryScore;
      const allCards = cards.map(reviewCard);
      const selectedReviewCards = selectedCards.map(reviewCard);
      return {
        ...clone(course),
        due_count: dueCards.length,
        completed_today: completedToday,
        total_count: cards.length,
        mastered_count: masteredCount,
        mastery_score: masteryScore,
        mastery_label: masteryLabel(masteryScore, Boolean(activeCards.length)),
        selected_due_count: selectedDueCards.length,
        selected_completed_today: selectedCompletedToday,
        selected_total_count: selectedCards.length,
        selected_mastered_count: selectedMasteredCount,
        selected_mastery_score: selectedMasteryScore,
        selected_mastery_label: masteryLabel(selectedMasteryScore, Boolean(selectedActiveCards.length)),
        priority_mastery_score: priorityMasteryScore,
        all_cards: allCards,
        full_content: allCards,
        today_cards: dueCards.map(reviewCard),
        selected_cards: selectedReviewCards,
        selected_content: selectedReviewCards,
        selected_today_cards: selectedDueCards.map(reviewCard),
      };
    });

    coursePayloads.sort((left, right) =>
      Number(left.priority_mastery_score ?? left.mastery_score ?? 0) - Number(right.priority_mastery_score ?? right.mastery_score ?? 0)
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
    if (!["pass", "shaky", "fail"].includes(result)) throw new Error("Invalid mastery result");
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
    if (!found) throw new Error("Review item was not found");
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

  function migrateKnownCourseSelection(course) {
    const migrated = clone(course);
    if (!Object.hasOwn(migrated, "selected_card_ids") && DEFAULT_SELECTED_CARD_IDS[migrated.id]) {
      const knownSelection = selectedCardIds(migrated);
      if (knownSelection.length) migrated.selected_card_ids = knownSelection;
    }
    return migrated;
  }

  function mergeCourse(localCourse, remoteCourse) {
    if (!localCourse) return migrateKnownCourseSelection(remoteCourse);
    if (!remoteCourse) return migrateKnownCourseSelection(localCourse);
    const merged = {
      ...clone(remoteCourse),
      ...clone(localCourse),
      source_files: [...new Set([...(localCourse.source_files || []), ...(remoteCourse.source_files || [])])],
      card_ids: [...new Set([...(localCourse.card_ids || []), ...(remoteCourse.card_ids || [])])],
    };
    if (Object.hasOwn(localCourse, "selected_card_ids") || Object.hasOwn(remoteCourse, "selected_card_ids")) {
      const selectionSource = Object.hasOwn(localCourse, "selected_card_ids")
        ? localCourse.selected_card_ids
        : remoteCourse.selected_card_ids;
      merged.selected_card_ids = [...new Set(Array.isArray(selectionSource) ? selectionSource : [])]
        .filter((id) => merged.card_ids.includes(id));
    } else {
      const knownSelection = selectedCardIds(merged);
      if (DEFAULT_SELECTED_CARD_IDS[merged.id] && knownSelection.length) {
        merged.selected_card_ids = knownSelection;
      }
    }
    return migrateKnownCourseSelection(merged);
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

  function seedItemKey(item) {
    return `${String(item?.course_id || "")}\u0000${String(item?.id || "")}`;
  }

  // Bundled course material is content-only: it can fill an empty cloud account
  // without replacing a learner's existing course details or review progress.
  function mergeSeedWorkspace(workspaceValue, seedValue) {
    const merged = {
      courses: clone(workspaceValue?.courses || []),
      review_items: clone(workspaceValue?.review_items || []),
    };
    const coursesById = new Map(merged.courses.map((course) => [course.id, course]));
    const knownItems = new Set(merged.review_items.map(seedItemKey));

    for (const sourceCourse of seedValue?.courses || []) {
      const courseId = String(sourceCourse?.id || "").trim();
      if (!courseId) continue;
      const seededCourse = clone(sourceCourse);
      const existing = coursesById.get(courseId);
      if (!existing) {
        merged.courses.push(seededCourse);
        coursesById.set(courseId, seededCourse);
        continue;
      }

      existing.card_ids = [...new Set([...(existing.card_ids || []), ...(seededCourse.card_ids || [])])];
      existing.source_files = [...new Set([...(existing.source_files || []), ...(seededCourse.source_files || [])])];
      if (!Array.isArray(existing.selected_card_ids) || !existing.selected_card_ids.length) {
        existing.selected_card_ids = clone(seededCourse.selected_card_ids || []);
      }
    }

    for (const sourceItem of seedValue?.review_items || []) {
      const item = clone(sourceItem);
      if (!coursesById.has(item.course_id)) continue;
      const key = seedItemKey(item);
      if (knownItems.has(key)) continue;
      merged.review_items.push(item);
      knownItems.add(key);
    }

    return {
      courses: merged.courses.map(migrateKnownCourseSelection),
      review_items: merged.review_items,
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
    answerTokens,
    cardMasteryScore,
    compareReviewAnswer,
    dashboardFromWorkspace,
    masteryLabel,
    mergeSeedWorkspace,
    mergeWorkspace,
    normalizeAnswer,
    recordReviewResult,
    reviewCard,
    workspaceFingerprint,
  };
});
