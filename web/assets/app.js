"use strict";

const state = {
  dashboard: null,
  localBackendAvailable: null,
  cloudConfigured: false,
  cloudReady: false,
  cloudCourses: [],
  cloudReviewItems: [],
  user: null,
  syncInProgress: false,
  syncTimer: null,
  sortMode: "mastery",
  expandedCourseId: "",
  selectedCourseId: "",
  sessionCards: [],
  sessionMode: "due",
  currentReviewIndex: 0,
  sessionInitialCount: 0,
  translatedEnglish: "",
  reviewRecognition: null,
  reviewRecording: false,
  reviewTranscriptBase: "",
  chineseRecognition: null,
  chineseRecording: false,
  chineseTranscriptBase: "",
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);
const workspace = window.EnglishCoachWorkspace;
const cloud = window.EnglishCoachCloud;

function bundledVideoCourseSeed() {
  const seed = window.EnglishCoachVideoCourseSeed;
  if (typeof seed?.workspace !== "function") {
    return { courses: [], review_items: [] };
  }
  return seed.workspace();
}

const bundledCourseMetadata = new Map(
  bundledVideoCourseSeed().courses.map((course) => [course.id, course]),
);

function todayIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch (_error) {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function setConnectionStatus(label) {
  $("backendStatus").textContent = label;
}

function hasCloudWorkspace() {
  return Boolean(state.user && state.cloudReady);
}

function coursePriorityMastery(course) {
  return Number(course?.priority_mastery_score ?? course?.selected_mastery_score ?? course?.mastery_score ?? 0);
}

function recentReviewRank(course) {
  return Number(Boolean(course?.reviewed_recently));
}

function sortCourses(courses) {
  const sorted = [...courses];
  if (state.sortMode === "due") {
    sorted.sort((left, right) =>
      recentReviewRank(left) - recentReviewRank(right)
      || Number(right.due_count || 0) - Number(left.due_count || 0)
      || coursePriorityMastery(left) - coursePriorityMastery(right)
      || Number(left.order ?? 9999) - Number(right.order ?? 9999),
    );
  } else if (state.sortMode === "original") {
    sorted.sort((left, right) =>
      recentReviewRank(left) - recentReviewRank(right)
      || Number(left.order ?? 9999) - Number(right.order ?? 9999)
      || String(left.title || "").localeCompare(String(right.title || "")),
    );
  } else {
    sorted.sort((left, right) =>
      recentReviewRank(left) - recentReviewRank(right)
      || coursePriorityMastery(left) - coursePriorityMastery(right)
      || Number(right.due_count || 0) - Number(left.due_count || 0)
      || Number(left.order ?? 9999) - Number(right.order ?? 9999)
      || String(left.title || "").localeCompare(String(right.title || "")),
    );
  }
  return sorted;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function selectedDate() {
  return $("reviewDateInput").value || todayIso();
}

async function refreshDashboard() {
  setConnectionStatus(state.user ? "Syncing" : "Checking");
  if (hasCloudWorkspace() && state.localBackendAvailable === false) {
    state.dashboard = workspace.dashboardFromWorkspace(
      state.cloudCourses,
      state.cloudReviewItems,
      selectedDate(),
    );
    setConnectionStatus("Cloud synced");
    renderDashboard();
    return;
  }
  try {
    state.dashboard = await apiJson(`/api/dashboard?date=${encodeURIComponent(selectedDate())}`);
    state.localBackendAvailable = true;
    setConnectionStatus(state.user ? "Local + cloud" : "Local connected");
    configureLocalOnlyTools();
    renderDashboard();
  } catch (error) {
    state.localBackendAvailable = false;
    configureLocalOnlyTools();
    if (hasCloudWorkspace()) {
      state.dashboard = workspace.dashboardFromWorkspace(
        state.cloudCourses,
        state.cloudReviewItems,
        selectedDate(),
      );
      setConnectionStatus("Cloud synced");
      renderDashboard();
      return;
    }
    setConnectionStatus(state.cloudConfigured ? "Sign in to sync" : "Sync not configured");
    $("courseList").innerHTML = state.cloudConfigured
      ? '<div class="empty-state"><strong>Sign in to see your courses</strong><p>Use “Sign in to sync” in the top-right corner to load your learning content on this device.</p></div>'
      : `<div class="empty-state">Could not load courses: ${escapeHtml(error.message)}</div>`;
  }
}

function bundledCoursePresentation(course) {
  const seededCourse = bundledCourseMetadata.get(course?.id);
  if (seededCourse) {
    return {
      title: seededCourse.title || course?.title || "Untitled course",
      summary: seededCourse.summary_zh || course?.summary || course?.summary_zh || "",
    };
  }
  return {
    title: course?.title || "Untitled course",
    summary: course?.summary || course?.summary_zh || "",
  };
}

function renderDashboard() {
  const courses = sortCourses(state.dashboard?.courses || []);
  const dueCount = courses.reduce((sum, course) => sum + Number(course.due_count || 0), 0);
  const completedCount = courses.reduce((sum, course) => sum + Number(course.completed_today || 0), 0);
  $("courseCountMetric").textContent = String(courses.length);
  $("dueCountMetric").textContent = String(dueCount);
  $("completedCountMetric").textContent = String(completedCount);
  renderCourses(courses);

  if (state.selectedCourseId) {
    const currentCourse = courses.find((course) => course.id === state.selectedCourseId);
    if (currentCourse && !$("courseReviewWorkspace").hidden) {
      const presentation = bundledCoursePresentation(currentCourse);
      $("activeCourseTitle").textContent = presentation.title;
      $("activeCourseSummary").textContent = presentation.summary;
    }
  }
}

function normalizeReviewMode(mode) {
  if (mode === "all") return "full";
  return ["due", "selected", "full"].includes(mode) ? mode : "due";
}

function firstCourseCardList(course, keys) {
  for (const key of keys) {
    if (Array.isArray(course?.[key])) return course[key];
  }
  return [];
}

function courseCardsForMode(course, mode) {
  const normalizedMode = normalizeReviewMode(mode);
  if (normalizedMode === "selected") {
    return firstCourseCardList(course, ["selected_content", "selected_cards"]);
  }
  if (normalizedMode === "full") {
    return firstCourseCardList(course, ["full_content", "all_cards"]);
  }
  return firstCourseCardList(course, ["today_cards"]);
}

function reviewModeMeta(mode) {
  const normalizedMode = normalizeReviewMode(mode);
  if (normalizedMode === "selected") {
    return {
      label: "SELECTED CONTENT",
      description: "Selected content: the core expressions you need to master and practice repeatedly.",
      completeLabel: "Selected-content practice complete",
      emptyTitle: "Selected content is complete",
      emptyDescription: "Core content will be scheduled again based on the mastery you record.",
    };
  }
  if (normalizedMode === "full") {
    return {
      label: "FULL CONTENT",
      description: "Full content: practice every confirmed item in the order of the video course.",
      completeLabel: "Full-content practice complete",
      emptyTitle: "Full content is complete",
      emptyDescription: "Return to the course to continue with selected content or items due today.",
    };
  }
  return {
    label: "TODAY'S REVIEW",
    description: "Due today: practice the items that need reinforcement now.",
    completeLabel: "Today's review complete",
    emptyTitle: "Today's review is complete",
    emptyDescription: "Your next review is scheduled from the result you record.",
  };
}

function recentReviewLabel(course) {
  if (!course?.reviewed_recently || !course?.recent_reviewed_until) return "";
  return `Reviewed recently · lower priority until ${course.recent_reviewed_until}`;
}

function courseRow(course) {
  const presentation = bundledCoursePresentation(course);
  const expanded = course.id === state.expandedCourseId;
  const dueCards = courseCardsForMode(course, "due");
  const selectedCards = courseCardsForMode(course, "selected");
  const fullCards = courseCardsForMode(course, "full");
  const dueCount = Number(course.due_count ?? dueCards.length);
  const selectedCount = Number(course.selected_total_count ?? course.selected_count ?? selectedCards.length);
  const fullCount = Number(course.full_total_count ?? course.full_count ?? course.total_count ?? fullCards.length);
  const dueLabel = dueCount > 0 ? `${dueCount} due today` : "Nothing due today";
  const masteryScore = Math.max(0, Math.min(100, coursePriorityMastery(course)));
  const overallMasteryScore = Math.max(0, Math.min(100, Number(course.mastery_score || 0)));
  const masteryLabel = selectedCount > 0
    ? workspace.masteryLabel(masteryScore, true)
    : workspace.masteryLabel(masteryScore, Number(course.total_count || 0) > 0);
  const masteryTitle = selectedCount > 0 ? "Core mastery" : "Mastery";
  const recentReview = recentReviewLabel(course);
  return `
    <article class="course-row${expanded ? " expanded" : ""}" data-mastery="${masteryScore >= 70 ? "high" : "low"}" data-recent-review="${Boolean(course.reviewed_recently)}">
      <button class="course-summary-button" type="button" aria-expanded="${expanded}" onclick="toggleCourse('${escapeHtml(course.id)}')">
        <span class="course-title-group">
          <strong>${escapeHtml(presentation.title)}</strong>
          <span>${escapeHtml(presentation.summary || "No course summary yet.")}</span>
          ${recentReview ? `<span class="course-recent-review-flag">${escapeHtml(recentReview)}</span>` : ""}
        </span>
        <span class="course-metrics" aria-label="Course stats">
          <span class="course-metric mastery-metric"><strong>${masteryScore.toFixed(0)}%</strong><span>${selectedCount > 0 ? "Core · " : ""}${escapeHtml(masteryLabel)}</span></span>
          <span class="course-metric"><strong>${Number(course.due_count || 0)}</strong><span>Due</span></span>
          <span class="course-metric completed-metric"><strong>${Number(course.completed_today || 0)}</strong><span>Done today</span></span>
          <span class="course-metric"><strong>${Number(course.total_count || 0)}</strong><span>Sentences</span></span>
        </span>
        <span class="course-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="course-detail"${expanded ? "" : " hidden"}>
        <div class="course-detail-grid">
          <div>
            <p>${escapeHtml(presentation.summary || "This course does not have a summary yet.")}</p>
            <div class="course-badges">
              <span class="badge mastery-badge">${masteryTitle} ${masteryScore.toFixed(0)}% · ${escapeHtml(masteryLabel)}</span>
              ${recentReview ? `<span class="badge recent-review-badge">${escapeHtml(recentReview)}</span>` : ""}
              ${selectedCount > 0 ? `<span class="badge">Full-content mastery ${overallMasteryScore.toFixed(0)}%</span>` : ""}
              <span class="badge${course.due_count > 0 ? " due" : ""}">${escapeHtml(dueLabel)}</span>
              <span class="badge">Mastered ${Number(course.mastered_count || 0)} / ${Number(course.total_count || 0)}</span>
              ${course.learned_on ? `<span class="badge">Learned ${escapeHtml(course.learned_on)}</span>` : ""}
            </div>
            <div class="mastery-track" aria-label="${masteryTitle} ${masteryScore.toFixed(0)}%"><span style="width:${masteryScore}%"></span></div>
          </div>
          <div class="course-mode-actions" aria-label="Choose practice content">
            <button class="course-mode-button due" type="button" onclick="startCourseReview('${escapeHtml(course.id)}', 'due')"${dueCards.length ? "" : " disabled"}>
              <strong>Due today</strong>
              <small>${dueCount > 0 ? `${dueCount} scheduled reviews` : "Nothing is due today"}</small>
            </button>
            <button class="course-mode-button selected" type="button" onclick="startCourseReview('${escapeHtml(course.id)}', 'selected')"${selectedCards.length ? "" : " disabled"}>
              <strong>Selected content</strong>
              <small>${selectedCount} core expressions</small>
            </button>
            <button class="course-mode-button full" type="button" onclick="startCourseReview('${escapeHtml(course.id)}', 'full')"${fullCards.length ? "" : " disabled"}>
              <strong>Full content</strong>
              <small>${fullCount} course sentences</small>
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderCourses(courses = state.dashboard?.courses || []) {
  courses = sortCourses(courses);
  if (!courses.length) {
    $("courseList").innerHTML = state.localBackendAvailable === false
      ? '<div class="empty-state"><strong>Your account does not have courses yet</strong><p>On sign-in, the six bundled video courses are added automatically. Courses imported in the Mac workspace also sync here.</p></div>'
      : '<div class="empty-state">No courses yet. Use “Import” in the top-right corner to add screenshots or recordings.</div>';
    return;
  }
  $("courseList").innerHTML = courses.map(courseRow).join("");
}

function configureLocalOnlyTools() {
  const cloudOnly = state.localBackendAvailable === false;
  $("importLocalOnlyNotice").hidden = !cloudOnly;
  $("translateLocalOnlyNotice").hidden = !cloudOnly;
  $("mediaFileInput").disabled = cloudOnly;
  $("syncMediaButton").disabled = cloudOnly;
  $("chineseSpeechButton").disabled = cloudOnly;
  $("chineseSpeechStopButton").disabled = true;
  const translateAction = $("translateDialog").querySelector('button[onclick="translateChineseSpeechText()"]');
  if (translateAction) translateAction.disabled = cloudOnly;
}

function renderAccountState() {
  const signedIn = Boolean(state.user);
  $("signedOutAccountPanel").hidden = signedIn;
  $("signedInAccountPanel").hidden = !signedIn;
  $("accountToolButton").classList.toggle("synced", signedIn && state.cloudReady);
  $("accountToolLabel").textContent = signedIn
    ? (state.user.email || "Signed in").split("@")[0]
    : "Sign in to sync";
  if (signedIn) {
    $("signedInEmail").textContent = state.user.email || "Signed-in account";
    $("accountSyncSummary").textContent = state.cloudReady
      ? `Synced ${state.cloudCourses.length} courses · ${state.cloudReviewItems.length} review items`
      : "Preparing sync";
  }
  if (!state.cloudConfigured) {
    $("accountStatus").textContent = "Cloud sync is not configured. Local review still works normally.";
  }
}

function setAccountBusy(busy, message = "") {
  state.syncInProgress = busy;
  for (const id of ["signInButton", "signUpButton", "syncNowButton"]) {
    const button = $(id);
    if (button) button.disabled = busy;
  }
  if (message) $("accountStatus").textContent = message;
}

function openAccountDialog() {
  renderAccountState();
  openToolDialog("accountDialog");
}

function accountCredentials() {
  const email = $("accountEmailInput").value.trim().toLowerCase();
  const password = $("accountPasswordInput").value;
  if (!email.includes("@")) throw new Error("Enter a valid email address");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  return { email, password };
}

function stripCloudMetadata(workspaceValue) {
  const clean = (item) => {
    const { cloud_updated_at: _ignored, ...payload } = item || {};
    return payload;
  };
  return {
    courses: (workspaceValue?.courses || []).map(clean),
    review_items: (workspaceValue?.review_items || []).map(clean),
  };
}

async function readLocalWorkspace() {
  if (state.localBackendAvailable !== true) return null;
  return apiJson("/api/sync-state");
}

async function writeLocalWorkspace(workspaceValue) {
  if (state.localBackendAvailable !== true) return null;
  return apiJson("/api/sync-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspaceValue),
  });
}

async function synchronizeWorkspace({ silent = false } = {}) {
  if (!state.user || !state.cloudConfigured || state.syncInProgress) return;
  setAccountBusy(true, silent ? "" : "Merging local and cloud learning records…");
  try {
    const [localValue, remoteValue] = await Promise.all([
      readLocalWorkspace(),
      cloud.readWorkspace(state.user.id),
    ]);
    const remote = stripCloudMetadata(remoteValue);
    const local = localValue ? stripCloudMetadata(localValue) : { courses: [], review_items: [] };
    const merged = workspace.mergeSeedWorkspace(
      workspace.mergeWorkspace(local, remote),
      bundledVideoCourseSeed(),
    );
    const mergedFingerprint = workspace.workspaceFingerprint(merged);

    if (localValue && remote.courses.length && mergedFingerprint !== workspace.workspaceFingerprint(local)) {
      await writeLocalWorkspace(merged);
    }
    if (mergedFingerprint !== workspace.workspaceFingerprint(remote)) {
      await cloud.saveWorkspace(state.user.id, merged);
    }

    state.cloudCourses = merged.courses;
    state.cloudReviewItems = merged.review_items;
    state.cloudReady = true;
    $("accountStatus").textContent = `Sync complete: ${merged.courses.length} courses and ${merged.review_items.length} review items.`;
    renderAccountState();
    await refreshDashboard();
  } catch (error) {
    state.cloudReady = false;
    $("accountStatus").textContent = `Sync failed: ${error.message}`;
    if (!silent) showToast(`Sync failed: ${error.message}`);
  } finally {
    setAccountBusy(false);
    renderAccountState();
  }
}

function scheduleCloudSync() {
  if (!state.user || !state.cloudConfigured) return;
  window.clearTimeout(state.syncTimer);
  state.syncTimer = window.setTimeout(() => synchronizeWorkspace({ silent: true }), 650);
}

async function loginAccount(event) {
  event?.preventDefault();
  if (state.syncInProgress) return false;
  try {
    const { email, password } = accountCredentials();
    setAccountBusy(true, "Signing in…");
    state.user = await cloud.signIn(email, password);
    state.cloudReady = false;
    renderAccountState();
    setAccountBusy(false);
    await synchronizeWorkspace();
  } catch (error) {
    setAccountBusy(false, `Sign-in failed: ${error.message}`);
  }
  return false;
}

async function createAccount() {
  if (state.syncInProgress) return;
  try {
    const { email, password } = accountCredentials();
    setAccountBusy(true, "Creating account…");
    const result = await cloud.signUp(email, password);
    if (result.needsEmailConfirmation) {
      $("accountStatus").textContent = "Account created. Confirm it from your email, then return here to sign in.";
      return;
    }
    state.user = result.user;
    state.cloudReady = false;
    renderAccountState();
    setAccountBusy(false);
    await synchronizeWorkspace();
  } catch (error) {
    $("accountStatus").textContent = `Account creation failed: ${error.message}`;
  } finally {
    setAccountBusy(false);
  }
}

async function logoutAccount() {
  if (state.syncInProgress) return;
  setAccountBusy(true, "Signing out…");
  try {
    await cloud.signOut();
    state.user = null;
    state.cloudReady = false;
    state.cloudCourses = [];
    state.cloudReviewItems = [];
    closeCourseReview();
    $("accountStatus").textContent = "Signed out safely.";
    renderAccountState();
    await refreshDashboard();
  } catch (error) {
    $("accountStatus").textContent = `Sign-out failed: ${error.message}`;
  } finally {
    setAccountBusy(false);
  }
}

async function syncAccountNow() {
  if (!state.user) return;
  await synchronizeWorkspace();
}

async function initializeCloudSync() {
  state.cloudConfigured = cloud.isConfigured();
  renderAccountState();
  if (!state.cloudConfigured) return;
  try {
    await cloud.initialize();
    state.user = await cloud.currentUser();
    renderAccountState();
    if (state.user) await synchronizeWorkspace({ silent: true });
  } catch (error) {
    $("accountStatus").textContent = `Cloud sync connection failed: ${error.message}`;
  }
}

function toggleCourse(courseId) {
  state.expandedCourseId = state.expandedCourseId === courseId ? "" : courseId;
  renderCourses();
}

function startCourseReview(courseId, mode = "due") {
  const course = (state.dashboard?.courses || []).find((entry) => entry.id === courseId);
  if (!course) return;
  const normalizedMode = normalizeReviewMode(mode);
  state.selectedCourseId = courseId;
  state.expandedCourseId = courseId;
  state.sessionMode = normalizedMode;
  const preferredCards = courseCardsForMode(course, normalizedMode);
  state.sessionCards = [...(preferredCards || [])];
  state.currentReviewIndex = 0;
  state.sessionInitialCount = state.sessionCards.length;
  const presentation = bundledCoursePresentation(course);
  $("activeCourseTitle").textContent = presentation.title;
  $("activeCourseSummary").textContent = presentation.summary;
  const modeMeta = reviewModeMeta(normalizedMode);
  $("sessionLabel").textContent = modeMeta.label;
  $("reviewModeDescription").textContent = modeMeta.description;
  $("reviewCoreBadge").hidden = normalizedMode !== "selected";
  $("courseReviewWorkspace").hidden = false;
  renderCourses();
  renderActiveCard();
  $("courseReviewWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCourseReview() {
  stopReviewSpeech();
  state.selectedCourseId = "";
  state.sessionCards = [];
  state.sessionMode = "due";
  state.currentReviewIndex = 0;
  $("courseReviewWorkspace").hidden = true;
}

function activeCard() {
  return state.sessionCards[state.currentReviewIndex] || null;
}

function resetCardFeedback() {
  $("answerInput").value = "";
  $("answerTarget").textContent = "The reference answer is hidden by default.";
  $("answerTarget").classList.remove("revealed");
  $("reviewFeedback").textContent = "Recall the English first, then type or say it before checking your answer.";
  $("reviewFeedback").className = "feedback";
  $("diffPanel").hidden = true;
  $("targetDiffText").textContent = "";
  $("answerDiffText").textContent = "";
  $("coreCoverage").textContent = "Match 0%";
}

function renderActiveCard() {
  stopReviewSpeech();
  const card = activeCard();
  const empty = !card;
  $("reviewEmptyState").hidden = !empty;
  $("reviewCard").hidden = empty;
  const completedInSession = Math.max(0, state.sessionInitialCount - state.sessionCards.length);
  const denominator = Math.max(1, state.sessionInitialCount);
  const progress = Math.round((completedInSession / denominator) * 100);
  const modeMeta = reviewModeMeta(state.sessionMode);
  $("sessionProgressBar").style.width = `${empty ? 100 : progress}%`;
  $("sessionProgressText").textContent = empty ? modeMeta.completeLabel : `${completedInSession} complete`;
  $("reviewPositionText").textContent = empty ? `${state.sessionInitialCount} / ${state.sessionInitialCount}` : `${state.currentReviewIndex + 1} / ${state.sessionCards.length}`;
  $("reviewEmptyTitle").textContent = modeMeta.emptyTitle;
  $("reviewEmptyDescription").textContent = modeMeta.emptyDescription;
  if (!card) return;
  resetCardFeedback();
  $("reviewPrompt").textContent = card.prompt_sentence || card.prompt || "Recall how to say this in English.";
  $("previousReviewButton").disabled = state.currentReviewIndex <= 0;
  $("nextReviewButton").disabled = state.currentReviewIndex >= state.sessionCards.length - 1;
}

function renderDiffTokens(tokens, highlighted, className) {
  const remaining = [...highlighted];
  return tokens.map((token) => {
    const index = remaining.indexOf(token);
    if (index >= 0) {
      remaining.splice(index, 1);
      return `<span class="${className}">${escapeHtml(token)}</span>`;
    }
    return escapeHtml(token);
  }).join(" ");
}

function revealReviewAnswer(preferredAnswer = "") {
  const card = activeCard();
  if (!card) return;
  $("answerTarget").textContent = preferredAnswer || card.target_sentence || card.answer;
  $("answerTarget").classList.add("revealed");
}

function checkReviewAnswer() {
  const card = activeCard();
  if (!card) return;
  const answer = $("answerInput").value.trim();
  if (!answer) {
    $("reviewFeedback").textContent = "Type your English or complete a voice input first.";
    $("reviewFeedback").className = "feedback warning";
    return;
  }
  const target = card.target_sentence || card.answer;
  const comparison = workspace.compareReviewAnswer(
    answer,
    target,
    card.keywords || [],
    card.accepted_answers || [],
  );
  revealReviewAnswer(comparison.matchedTarget);
  $("diffPanel").hidden = false;
  $("targetDiffText").innerHTML = renderDiffTokens(comparison.targetTokens, comparison.missing, "token-missing");
  $("answerDiffText").innerHTML = renderDiffTokens(comparison.answerTokens, comparison.extra, "token-extra");
  $("coreCoverage").textContent = `Match ${comparison.coverage}%`;
  if (comparison.exact) {
    $("reviewFeedback").textContent = "Accurate expression. You can mark it as Got it.";
    $("reviewFeedback").className = "feedback good";
  } else if (comparison.coreCorrect) {
    $("reviewFeedback").textContent = "The core meaning is correct. Red text marks missing or different words; an exact word-for-word match is not required.";
    $("reviewFeedback").className = "feedback good";
  } else {
    $("reviewFeedback").textContent = "The core information is still incomplete. Use the red text to try again, then rate your real mastery.";
    $("reviewFeedback").className = "feedback warning";
  }
}

function goToPreviousReviewCard() {
  if (state.currentReviewIndex <= 0) return;
  state.currentReviewIndex -= 1;
  renderActiveCard();
}

function goToNextReviewCard() {
  if (state.currentReviewIndex >= state.sessionCards.length - 1) return;
  state.currentReviewIndex += 1;
  renderActiveCard();
}

async function submitReviewResult(result) {
  const card = activeCard();
  if (!card) return;
  try {
    if (state.localBackendAvailable === false) {
      if (!state.user) throw new Error("Sign in to your account first");
      state.cloudReviewItems = workspace.recordReviewResult(
        state.cloudReviewItems,
        card.id,
        result,
        selectedDate(),
      );
      const updatedItem = state.cloudReviewItems.find((item) => item.id === card.id);
      await cloud.saveReviewItem(state.user.id, updatedItem);
    } else {
      await apiJson("/api/review-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: card.id, result, date: selectedDate() }),
      });
    }
    const labels = { pass: "Marked as got it", shaky: "Marked as shaky", fail: "Scheduled for an early retry" };
    showToast(labels[result]);
    state.sessionCards.splice(state.currentReviewIndex, 1);
    if (state.currentReviewIndex >= state.sessionCards.length) {
      state.currentReviewIndex = Math.max(0, state.sessionCards.length - 1);
    }
    renderActiveCard();
    await refreshDashboard();
    if (state.localBackendAvailable === true) scheduleCloudSync();
  } catch (error) {
    showToast(`Could not save: ${error.message}`);
  }
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setReviewRecordingUi(recording) {
  state.reviewRecording = recording;
  $("reviewSpeechButton").disabled = recording;
  $("reviewStopButton").disabled = !recording;
  $("reviewSpeechButton").textContent = recording ? "Recording…" : "Start recording";
}

function startReviewSpeech() {
  if (state.reviewRecording) return;
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    showToast("Speech recognition is not supported in this browser. Please use Chrome or Safari.");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  state.reviewRecognition = recognition;
  state.reviewTranscriptBase = $("answerInput").value.trim();
  setReviewRecordingUi(true);
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) finalText += `${text} `;
      else interimText += `${text} `;
    }
    if (finalText.trim()) {
      state.reviewTranscriptBase = `${state.reviewTranscriptBase} ${finalText}`.trim();
    }
    $("answerInput").value = `${state.reviewTranscriptBase} ${interimText}`.trim();
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") {
      showToast(`Speech recognition failed: ${event.error}`);
    }
  };
  recognition.onend = () => {
    if (state.reviewRecording && state.reviewRecognition === recognition) {
      window.setTimeout(() => {
        if (state.reviewRecording) {
          try { recognition.start(); } catch (_error) { setReviewRecordingUi(false); }
        }
      }, 120);
    }
  };
  try {
    recognition.start();
  } catch (error) {
    setReviewRecordingUi(false);
    showToast(`Could not start recording: ${error.message}`);
  }
}

function stopReviewSpeech() {
  if (!state.reviewRecognition && !state.reviewRecording) return;
  setReviewRecordingUi(false);
  const recognition = state.reviewRecognition;
  state.reviewRecognition = null;
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch (_error) { /* Recognition was already stopped. */ }
  }
}

function speakEnglish(text) {
  if (!text || !("speechSynthesis" in window)) {
    showToast("This browser cannot play speech.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

function playActiveAnswer() {
  const card = activeCard();
  if (card) speakEnglish(card.target_sentence || card.answer);
}

function openToolDialog(dialogId) {
  const dialog = $(dialogId);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeToolDialog(dialogId) {
  if (dialogId === "translateDialog") stopChineseTranslateSpeech();
  const dialog = $(dialogId);
  if (dialog?.open) dialog.close();
}

function setChineseRecordingUi(recording) {
  state.chineseRecording = recording;
  $("chineseSpeechButton").disabled = recording;
  $("chineseSpeechStopButton").disabled = !recording;
  $("chineseSpeechButton").textContent = recording ? "Recording…" : "Start recording";
}

function startChineseTranslateSpeech() {
  if (state.chineseRecording) return;
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    showToast("Speech recognition is not supported in this browser. Type your Chinese sentence instead.");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  state.chineseRecognition = recognition;
  state.chineseTranscriptBase = $("chineseSpeechInput").value.trim();
  setChineseRecordingUi(true);
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) finalText += text;
      else interimText += text;
    }
    if (finalText) state.chineseTranscriptBase += finalText;
    $("chineseSpeechInput").value = `${state.chineseTranscriptBase}${interimText}`;
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") {
      showToast(`Speech recognition failed: ${event.error}`);
    }
  };
  recognition.onend = () => {
    if (state.chineseRecording && state.chineseRecognition === recognition) {
      window.setTimeout(() => {
        if (state.chineseRecording) {
          try { recognition.start(); } catch (_error) { setChineseRecordingUi(false); }
        }
      }, 120);
    }
  };
  try {
    recognition.start();
  } catch (error) {
    setChineseRecordingUi(false);
    showToast(`Could not start recording: ${error.message}`);
  }
}

function stopChineseTranslateSpeech() {
  if (!state.chineseRecognition && !state.chineseRecording) return;
  setChineseRecordingUi(false);
  const recognition = state.chineseRecognition;
  state.chineseRecognition = null;
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch (_error) { /* Recognition was already stopped. */ }
  }
}

async function translateChineseSpeechText() {
  stopChineseTranslateSpeech();
  if (state.localBackendAvailable === false) {
    $("translationStatus").textContent = "Automatic translation is available in the Mac workspace, not on the public website.";
    return;
  }
  const text = $("chineseSpeechInput").value.trim();
  if (!text) {
    $("translationStatus").textContent = "Enter or say a Chinese sentence first.";
    return;
  }
  $("translationStatus").textContent = "Translating…";
  try {
    const result = await apiJson("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    state.translatedEnglish = result.translation || "";
    $("translationOutput").textContent = state.translatedEnglish || "No translation was generated.";
    $("translationStatus").textContent = result.source || "Translation complete";
  } catch (error) {
    $("translationStatus").textContent = `Translation failed: ${error.message}`;
  }
}

function playTranslatedEnglish() {
  speakEnglish(state.translatedEnglish || $("translationOutput").textContent);
}

function renderSelectedFiles() {
  const files = [...$("mediaFileInput").files];
  if (!files.length) {
    $("selectedFiles").textContent = "No files selected";
    return;
  }
  const names = files.slice(0, 4).map((file) => file.name);
  const extra = files.length > 4 ? ` and ${files.length - 4} more` : "";
  $("selectedFiles").textContent = `${names.join(", ")}${extra}`;
}

async function syncMediaFilesToCodex() {
  if (state.localBackendAvailable === false) {
    $("mediaStatus").textContent = "Import in the Mac workspace; the completed course will then sync to this account.";
    return;
  }
  const files = [...$("mediaFileInput").files];
  if (!files.length) {
    $("mediaStatus").textContent = "Choose screenshots or recordings first.";
    return;
  }
  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.append("date", selectedDate());
  form.append("slot", "Course import");
  form.append("completed", "Screenshot/recording course organization");
  $("syncMediaButton").disabled = true;
  $("mediaStatus").textContent = "Uploading and creating a Codex organization task…";
  try {
    const result = await apiJson("/api/codex-media-inbox", { method: "POST", body: form });
    $("mediaStatus").textContent = "Upload complete. Codex is organizing the course; this page will refresh automatically.";
    pollCodexJob(result.job_id || result.id);
  } catch (error) {
    $("mediaStatus").textContent = `Import failed: ${error.message}`;
    $("syncMediaButton").disabled = false;
  }
}

function pollCodexJob(jobId) {
  window.clearTimeout(state.pollTimer);
  if (!jobId) {
    $("mediaStatus").textContent = "The task was submitted. Refresh your courses shortly.";
    $("syncMediaButton").disabled = false;
    return;
  }
  const check = async () => {
    try {
      const job = await apiJson(`/api/codex-job-status?id=${encodeURIComponent(jobId)}`);
      if (job.status === "completed") {
        $("mediaStatus").textContent = "Organization complete. The course and review sentences were added to your workspace.";
        $("syncMediaButton").disabled = false;
        $("mediaFileInput").value = "";
        renderSelectedFiles();
        await refreshDashboard();
        scheduleCloudSync();
        showToast("Your new course is ready");
        return;
      }
      if (job.status === "failed") {
        $("mediaStatus").textContent = "Codex could not organize the materials. Please submit them again.";
        $("syncMediaButton").disabled = false;
        return;
      }
      $("mediaStatus").textContent = "Codex is identifying the course and generating review sentences…";
      state.pollTimer = window.setTimeout(check, 2500);
    } catch (error) {
      $("mediaStatus").textContent = `Status check failed: ${error.message}`;
      $("syncMediaButton").disabled = false;
    }
  };
  check();
}

function bindDialogDismissal(dialog) {
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) closeToolDialog(dialog.id);
  });
}

async function initialize() {
  $("reviewDateInput").value = todayIso();
  $("reviewDateInput").addEventListener("change", () => {
    closeCourseReview();
    refreshDashboard();
  });
  $("courseSortSelect").addEventListener("change", (event) => {
    state.sortMode = event.target.value || "mastery";
    renderDashboard();
  });
  $("mediaFileInput").addEventListener("change", renderSelectedFiles);
  bindDialogDismissal($("accountDialog"));
  bindDialogDismissal($("importDialog"));
  bindDialogDismissal($("translateDialog"));
  window.addEventListener("beforeunload", () => {
    stopReviewSpeech();
    stopChineseTranslateSpeech();
    window.clearTimeout(state.pollTimer);
    window.clearTimeout(state.syncTimer);
  });
  state.cloudConfigured = cloud.isConfigured();
  renderAccountState();
  await refreshDashboard();
  await initializeCloudSync();
}

initialize().catch((error) => {
  setConnectionStatus("Initialization failed");
  $("courseList").innerHTML = `<div class="empty-state">Page initialization failed: ${escapeHtml(error.message)}</div>`;
});
