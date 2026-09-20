import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const videoCourseIds = [
  "pet-food-safety",
  "pet-supplies",
  "pet-grooming-and-attachment",
  "puppy-habits",
  "lets-get-a-puppy-speaking",
  "pet-decision-and-care",
  "what-if-integrated",
  "using-not-for-negatives",
  "confidants-and-affection",
  "no-regrets-listening",
  "positive-side-speaking",
  "dating-and-entertainment",
  "quantifiers-how-much-how-many",
  "attitudes-and-feelings",
  "online-dating-vocabulary",
  "perfect-match-listening",
  "first-date-speaking",
  "talking-about-a-date",
];

const externalCourseManifestPaths = [
  resolve(projectRoot, "tools/sep4_level3_courses.json"),
  resolve(projectRoot, "tools/sep20_review_notes_courses.json"),
];

const englishCourseMetadata = Object.freeze({
  "pet-food-safety": {
    title: "Articles in Pet Food Safety",
    summary: "Practice a, an, and the through pet-food safety, including human foods that cats and dogs should not eat.",
  },
  "pet-supplies": {
    title: "Pet Supplies",
    summary: "Learn to ask about and describe common pet supplies, including collars, litter boxes, parrots, and cages.",
  },
  "pet-grooming-and-attachment": {
    title: "Pet Grooming & Attachment",
    summary: "Practice vocabulary for grooming, care, training, and the emotional bond with a new pet.",
  },
  "puppy-habits": {
    title: "Puppy Habits",
    summary: "Talk about a puppy's sleeping habits, daily care, and the love puppies give their owners.",
  },
  "lets-get-a-puppy-speaking": {
    title: "Let's Get a Puppy — Speaking",
    summary: "Practice a conversation about getting a puppy, including responsibility, training, and caring for a dog.",
  },
  "pet-decision-and-care": {
    title: "Getting a Pet: Decisions & Care",
    summary: "Ask for advice and discuss the practical decisions involved in caring for a pet.",
  },
  "what-if-integrated": {
    title: "What If…? — Integrated",
    summary: "Discuss a difficult birthday, busy careers, and imagining a different life.",
  },
  "using-not-for-negatives": {
    title: "Using Not for Negatives",
    summary: "Use not in travel plans and preferences to express contrast and negation.",
  },
  "confidants-and-affection": {
    title: "Confidants & Affection",
    summary: "Talk about trust, affection, adoration, and admitting mistakes.",
  },
  "no-regrets-listening": {
    title: "No Regrets — Listening",
    summary: "Follow a freelance designer's career decision and positive mindset.",
  },
  "positive-side-speaking": {
    title: "Finding the Positive Side — Speaking",
    summary: "Practice discussing a resignation, uncertainty, and finding fulfilling work.",
  },
  "dating-and-entertainment": {
    title: "Dating & Entertainment",
    summary: "Learn first-date vocabulary for reservations, honesty, nerves, and live music.",
  },
  "quantifiers-how-much-how-many": {
    title: "Quantifiers: How Much / How Many",
    summary: "Use quantifiers for interests, time, profiles, and online-dating conversations.",
  },
  "attitudes-and-feelings": {
    title: "Attitudes & Feelings",
    summary: "Describe relationships and outlook with keep in touch, get along, positive, and negative.",
  },
  "online-dating-vocabulary": {
    title: "Online Dating",
    summary: "Talk about dating apps, signing up, attention, and a charming profile.",
  },
  "perfect-match-listening": {
    title: "A Perfect Match — Listening",
    summary: "Explore how the internet changed dating and created interest-based apps.",
  },
  "first-date-speaking": {
    title: "First Date — Speaking",
    summary: "Discuss music preferences politely during a date and respond to disappointment.",
  },
  "talking-about-a-date": {
    title: "Discussing a Date — Speaking",
    summary: "Describe a difficult date, hurt feelings, common interests, and compatibility.",
  },
});

const [courses, reviewItems] = await Promise.all([
  readFile(resolve(projectRoot, "state/courses.json"), "utf8").then(JSON.parse),
  readFile(resolve(projectRoot, "state/review-items.json"), "utf8").then(JSON.parse),
]);

const byCourseId = new Map(courses.map((course) => [course.id, course]));
const selectedCourses = videoCourseIds.map((courseId) => {
  const source = byCourseId.get(courseId);
  if (!source) throw new Error(`Missing video course: ${courseId}`);
  const english = englishCourseMetadata[courseId];
  return {
    id: source.id,
    title: english.title,
    summary_zh: english.summary,
    source_files: ["Video course"],
    card_ids: [...(source.card_ids || [])],
    order: source.order,
    selected_card_ids: [...(source.selected_card_ids || [])],
  };
});

const selectedCourseIds = new Set(videoCourseIds);
const selectedItems = reviewItems
  .filter((item) => selectedCourseIds.has(item.course_id))
  .map((item) => ({
    id: item.id,
    course_id: item.course_id,
    item: item.item,
    type: item.type || "sentence",
    source: "bundled video course",
    status: "new",
    last_result: "pending",
    next_due: "2025-01-01",
    interval_days: 1,
    example: item.example || item.item,
    note: "Translate the Chinese prompt into English. The reference answer is hidden by default.",
    prompt: item.prompt,
    accepted_answers: [...(item.accepted_answers || [])],
    history: [],
  }));

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 112) || "card";
}

const externalManifests = await Promise.all(
  externalCourseManifestPaths.map((path) => readFile(path, "utf8").then(JSON.parse)),
);
const existingCourseIds = new Set(selectedCourses.map((course) => course.id));
const highestExistingOrder = selectedCourses.reduce((highest, course) => Math.max(highest, course.order || 0), 0);
const externalCourses = [];
const externalItems = [];

for (const manifest of externalManifests) {
  for (const sourceCourse of manifest.courses || []) {
    const courseId = sourceCourse.id_hint;
    const fullContent = sourceCourse.full_content || [];
    const selectedContent = sourceCourse.selected_content || [];
    if (!courseId || existingCourseIds.has(courseId) || !sourceCourse.title || !sourceCourse.summary) {
      throw new Error(`Invalid or duplicate external video course: ${courseId || "unknown"}`);
    }
    if (!fullContent.length || !selectedContent.length) {
      throw new Error(`External video course needs full and selected content: ${courseId}`);
    }
    const cardsByItem = new Map();
    const cardIds = fullContent.map((card, index) => {
      if (!card.item || !card.prompt || cardsByItem.has(card.item)) {
        throw new Error(`Invalid or duplicate external course card: ${courseId}`);
      }
      const id = `${courseId}-${slugify(card.item)}-${index + 1}`;
      cardsByItem.set(card.item, id);
      externalItems.push({
        id,
        course_id: courseId,
        item: card.item,
        type: "chunk",
        source: "bundled video course",
        status: "new",
        last_result: "pending",
        next_due: "2025-01-01",
        interval_days: 1,
        example: card.item,
        note: "Translate the Chinese prompt into English. The reference answer is hidden by default.",
        prompt: card.prompt,
        accepted_answers: [],
        history: [],
      });
      return id;
    });
    const selectedCardIds = selectedContent.map((item) => {
      const id = cardsByItem.get(item);
      if (!id) throw new Error(`Selected external card is missing from full content: ${courseId}`);
      return id;
    });
    externalCourses.push({
      id: courseId,
      title: sourceCourse.title,
      summary_zh: sourceCourse.summary,
      source_files: sourceCourse.source_files || ["Video course"],
      card_ids: cardIds,
      order: highestExistingOrder + externalCourses.length + 1,
      selected_card_ids: selectedCardIds,
    });
    existingCourseIds.add(courseId);
  }
}

const allCourses = [...selectedCourses, ...externalCourses];
const allItems = [...selectedItems, ...externalItems];

const itemKeys = new Set(allItems.map((item) => `${item.course_id}\u0000${item.id}`));
for (const course of allCourses) {
  if (course.card_ids.length !== new Set(course.card_ids).size) {
    throw new Error(`Duplicate card id in ${course.id}`);
  }
  if (course.card_ids.some((cardId) => !itemKeys.has(`${course.id}\u0000${cardId}`))) {
    throw new Error(`Course ${course.id} has a card without seed content`);
  }
  if (course.selected_card_ids.some((cardId) => !course.card_ids.includes(cardId))) {
    throw new Error(`Course ${course.id} selected content is not a full-content subset`);
  }
}

const seed = {
  courses: allCourses,
  review_items: allItems,
};

const output = `// Generated by tools/export_video_course_seed.mjs. Do not add learner progress here.\n(function initEnglishCoachVideoCourseSeed(root, factory) {\n  const api = factory();\n  if (typeof module === "object" && module.exports) module.exports = api;\n  root.EnglishCoachVideoCourseSeed = api;\n})(typeof globalThis !== "undefined" ? globalThis : this, function buildVideoCourseSeed() {\n  const seed = Object.freeze(${JSON.stringify(seed, null, 2)});\n\n  function workspace() {\n    return JSON.parse(JSON.stringify(seed));\n  }\n\n  return { workspace };\n});\n`;

await writeFile(resolve(projectRoot, "web/assets/video-course-seed.js"), output, "utf8");
console.log(`Exported ${allCourses.length} courses and ${allItems.length} cards.`);
