# Course Review Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-tab dashboard with a course-centered review workspace where each imported lesson becomes a course that expands into the existing active-recall flow.

**Architecture:** Add a small course store that owns course metadata and card membership, then expose course aggregates from the dashboard API. Split the current monolithic HTML into semantic HTML plus local CSS and JavaScript assets; keep upload and translation as compact dialogs while the main page contains only course review.

**Tech Stack:** Python 3 standard library, JSON state files, `unittest`, plain HTML/CSS/JavaScript, Web Speech API, Speech Synthesis API.

## Global Constraints

- Course is the first-level content entity; every review item has one `course_id`.
- The main page has no “今日学习 / 复习台 / 学习回传 / 语音播放” tab bar.
- Upload and Chinese-to-English translation remain available only as compact header tools.
- English answers stay hidden until explicitly revealed; Chinese meanings are complete sentences.
- Existing voice recording, semantic comparison, red missing-word feedback, previous/next navigation, and pass/shaky/fail grading remain.
- Cards use a maximum border radius of 8px and the layout must work at 1440x900 and 390x844 without horizontal scrolling.
- No external account, cloud sync, leaderboard, badge, or social features.
- This directory is not a Git repository, so each task ends with a test checkpoint instead of a commit.

---

### Task 1: Course Store and Existing Data Migration

**Files:**
- Create: `/Users/y/Documents/Y/english-coach/tools/course_store.py`
- Create: `/Users/y/Documents/Y/english-coach/state/courses.json`
- Modify: `/Users/y/Documents/Y/english-coach/state/review-items.json`
- Modify: `/Users/y/Documents/Y/english-coach/tests/test_coach.py`

**Interfaces:**
- Produces: `load_courses(path: Path) -> list[dict]`
- Produces: `save_courses(courses: list[dict], path: Path) -> None`
- Produces: `group_cards_by_course(items: list[dict], courses: list[dict], on_date: date) -> list[dict]`
- Every returned course aggregate includes `id`, `title`, `summary_zh`, `learned_on`, `source_files`, `cards`, `due_count`, `completed_today`, `total_count`, and `mastered_count`.

- [ ] **Step 1: Write failing course-store tests**

Add tests that create two courses and three cards, then assert cards are grouped by `course_id`, due counts use `next_due <= on_date`, and completion counts use history entries from the requested date.

```python
def test_group_cards_by_course_builds_due_and_completed_counts(self):
    course_store = load_course_store()
    courses = [{"id": "louvre", "title": "卢浮宫", "summary_zh": "", "card_ids": ["a", "b"]}]
    items = [
        {"id": "a", "course_id": "louvre", "next_due": "2026-07-11", "status": "needs_review", "history": []},
        {"id": "b", "course_id": "louvre", "next_due": "2026-07-12", "status": "reviewing", "history": [{"date": "2026-07-11", "result": "pass"}]},
    ]
    result = course_store.group_cards_by_course(items, courses, dt.date(2026, 7, 11))
    self.assertEqual(result[0]["due_count"], 1)
    self.assertEqual(result[0]["completed_today"], 1)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python3 -m unittest tests.test_coach.EnglishCoachTests.test_group_cards_by_course_builds_due_and_completed_counts -v`

Expected: FAIL because `course_store.py` and `load_course_store()` do not exist.

- [ ] **Step 3: Implement the course store**

Implement JSON load/save and aggregation. Preserve card order from `course.card_ids`; include cards present by `course_id` even if `card_ids` is incomplete.

```python
def group_cards_by_course(items, courses, on_date):
    by_course = {course["id"]: [] for course in courses}
    for item in items:
        course_id = item.get("course_id")
        if course_id in by_course:
            by_course[course_id].append(item)
    # Return copied course dictionaries with calculated card and progress fields.
```

- [ ] **Step 4: Seed courses and assign every existing card**

Create these course IDs and map existing cards using current manifests and known source metadata:

```text
client-communication-basics
louvre-listening-journey
louvre-tickets-and-services
pet-food-safety
pet-supplies
pet-grooming-and-attachment
puppy-habits
pet-decision-and-care
```

Validate that every object in `review-items.json` has a non-empty `course_id`, and every referenced course exists.

- [ ] **Step 5: Run focused and full tests**

Run: `python3 -m unittest tests.test_coach -v`

Expected: all tests pass; the new migration integrity test reports zero orphan cards.

---

### Task 2: Course-Centered Dashboard API

**Files:**
- Modify: `/Users/y/Documents/Y/english-coach/tools/web_server.py`
- Modify: `/Users/y/Documents/Y/english-coach/tests/test_coach.py`

**Interfaces:**
- Consumes: `course_store.group_cards_by_course(...)`
- Produces: `dashboard_payload(...)["courses"]`
- Keeps: `review_cards` and `completed_reviews` during migration for backward compatibility.

- [ ] **Step 1: Write failing dashboard-course tests**

Create temporary `courses.json`, review state, and notes. Assert `/api/dashboard` payload order is: courses with due cards first, then newest learned course, then remaining courses. Assert each card still contains `prompt_sentence`, `target_sentence`, `keywords`, `last_result`, and `next_due`.

- [ ] **Step 2: Run tests and verify RED**

Run: `python3 -m unittest tests.test_coach.EnglishCoachTests.test_dashboard_payload_groups_review_cards_by_course -v`

Expected: FAIL because `dashboard_payload` has no `courses` argument or output.

- [ ] **Step 3: Integrate the course store**

Add `courses_path: Path = course_store.DEFAULT_COURSES` to `dashboard_payload`. Build course cards using the existing `review_card()` formatter, and return only due cards in each course’s `today_cards`; expose all cards as `all_cards` for explicit full review.

- [ ] **Step 4: Preserve result updates**

Test that `record_review_result(item_id, result, date)` changes only the target review item and that a subsequent dashboard read updates the owning course’s `completed_today`, `due_count`, and `mastered_count`.

- [ ] **Step 5: Run the full backend suite**

Run: `python3 -m unittest tests.test_coach -v`

Expected: all tests pass with no regression in translation, upload, speech-related HTML contracts, or reminder commands.

---

### Task 3: Multi-Course Media Analysis and Import

**Files:**
- Modify: `/Users/y/Documents/Y/english-coach/tools/web_server.py`
- Modify: `/Users/y/Documents/Y/english-coach/tools/codex_inbox.py`
- Modify: `/Users/y/Documents/Y/english-coach/tests/test_coach.py`

**Interfaces:**
- Accepts new analysis shape: `{ "courses": [{"id_hint", "title", "summary_zh", "learned", "review_cards"}] }`
- Continues to accept the legacy single-course shape.
- Produces course records and review items with stable `course_id` values.

- [ ] **Step 1: Write failing multi-course import tests**

Use an analysis fixture with two courses, two cards each, and one video source. Assert two course records are created, cards receive the matching `course_id`, and all new cards have `status="new"`, `last_result="pending"`, empty history, and a future `next_due`.

- [ ] **Step 2: Run tests and verify RED**

Run: `python3 -m unittest tests.test_coach.EnglishCoachTests.test_complete_codex_job_creates_multiple_courses -v`

Expected: FAIL because the current schema only supports one title and caps the result at ten flat cards.

- [ ] **Step 3: Expand the analysis schema and prompt**

Update the JSON schema and Codex job instructions so recorded material is segmented into actual lessons first. Each lesson should produce 3-10 high-value full-sentence cards. Remove the global 3-8-card cap; apply the cap per course.

- [ ] **Step 4: Implement backward-compatible normalization**

Add `normalize_analysis_courses(ai_analysis) -> list[dict]`. Wrap legacy analysis in one course and preserve title/summary. Upsert courses by stable slug plus learned date; update cards without resetting mastered cards to shaky.

- [ ] **Step 5: Run all import and backend tests**

Run: `python3 -m unittest tests.test_coach -v`

Expected: all tests pass, including existing single-course job fixtures.

---

### Task 4: Single-Surface Course Review UI

**Files:**
- Modify: `/Users/y/Documents/Y/english-coach/tools/web_server.py`
- Rewrite: `/Users/y/Documents/Y/english-coach/web/index.html`
- Create: `/Users/y/Documents/Y/english-coach/web/assets/app.css`
- Create: `/Users/y/Documents/Y/english-coach/web/assets/app.js`
- Modify: `/Users/y/Documents/Y/english-coach/tests/test_coach.py`

**Interfaces:**
- Consumes: `/api/dashboard?date=YYYY-MM-DD` with `courses`.
- Uses existing: `/api/review-result`, `/api/codex-media-inbox`, `/api/codex-job-status`, `/api/translate`.
- Produces browser functions: `renderCourses`, `toggleCourse`, `startCourseReview`, `renderActiveCard`, `submitReviewResult`, `openToolDialog`, and `closeToolDialog`.

- [ ] **Step 1: Replace old static assertions with failing course-workspace contracts**

Assert the HTML contains `courseList`, `courseReviewWorkspace`, `courseProgress`, `importToolButton`, and `translateToolButton`. Assert it does not contain `tab-bar`, `tabButton`, `overviewTabButton`, `reviewTabButton`, `checkinTabButton`, `speechTabButton`, or the four old tab labels.

- [ ] **Step 2: Run static tests and verify RED**

Run: `python3 -m unittest tests.test_coach.EnglishCoachTests.test_learning_page_is_course_review_workspace -v`

Expected: FAIL against the current four-tab dashboard.

- [ ] **Step 3: Serve local assets**

Add explicit GET routes for `/assets/app.css` and `/assets/app.js` with correct MIME types. Reject unknown asset paths rather than exposing an arbitrary file server.

- [ ] **Step 4: Build the semantic HTML shell**

Use one `<main>` with a compact header, progress strip, `<section id="courseList">`, and `<section id="courseReviewWorkspace">`. Add accessible `<dialog>` elements for import and translation. Do not render raw Markdown notes in the main page.

- [ ] **Step 5: Implement the restrained visual system**

In `app.css`, define neutral gray background, white work surfaces, ink text, green primary actions, blue informational feedback, amber shaky feedback, and red errors. Keep border radius at 8px or below. Use responsive constraints and a single column below 720px.

- [ ] **Step 6: Implement course rendering and accordion behavior**

Render a button per course with title, summary, due/total counts, and progress. Allow one expanded course at a time. Starting a session uses `today_cards`; “复习全部” explicitly uses `all_cards`.

- [ ] **Step 7: Port the existing review mechanics**

Move the proven answer comparison, speech-recognition start/stop state, hidden answer, speech synthesis, word-diff rendering, previous/next navigation, and pass/shaky/fail submission into `app.js`. Scope all state to the selected course session.

- [ ] **Step 8: Move tools into dialogs**

Keep upload and translation functionality unchanged at the API layer. Remove the standalone speech page; place playback only on the active review card and translated output.

- [ ] **Step 9: Run static and backend tests**

Run: `python3 -m unittest tests.test_coach -v`

Expected: all tests pass and old tab labels are absent from the rendered shell.

---

### Task 5: Browser Interaction and Responsive Verification

**Files:**
- Modify as needed: `/Users/y/Documents/Y/english-coach/web/index.html`
- Modify as needed: `/Users/y/Documents/Y/english-coach/web/assets/app.css`
- Modify as needed: `/Users/y/Documents/Y/english-coach/web/assets/app.js`

**Interfaces:**
- Verifies the running dashboard at `http://127.0.0.1:8765/`.

- [ ] **Step 1: Restart the local server and confirm API health**

Run: `curl -fsS 'http://127.0.0.1:8765/api/dashboard?date=2026-07-11'`

Expected: JSON includes non-empty `courses` with nested cards.

- [ ] **Step 2: Verify the desktop workflow at 1440x900**

Check: no old tabs; course list visible; one course expands; start review shows one Chinese sentence; reference English is hidden; text answer check produces feedback; pass/shaky/fail moves the card and updates progress.

- [ ] **Step 3: Verify microphone state control**

Check: start enables stop; recognition may restart while listening; only explicit stop ends the recording session; checking or grading also stops recording safely.

- [ ] **Step 4: Verify mobile at 390x844**

Check: no horizontal scroll, course metadata wraps, action buttons remain within viewport, bottom controls do not overlap content, and long English sentences fit their containers.

- [ ] **Step 5: Inspect console and server logs**

Expected: no JavaScript errors, failed asset requests, unhandled API responses, or server tracebacks during the tested workflow.

- [ ] **Step 6: Run the final test suite**

Run: `python3 -m unittest tests.test_coach -v`

Expected: all tests pass. Record the test count and browser evidence in the handoff.
