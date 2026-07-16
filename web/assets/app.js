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
    throw new Error(payload.message || payload.error || `请求失败 (${response.status})`);
  }
  return payload;
}

function setConnectionStatus(label) {
  $("backendStatus").textContent = label;
}

function hasCloudWorkspace() {
  return Boolean(state.user && state.cloudReady);
}

function sortCourses(courses) {
  const sorted = [...courses];
  if (state.sortMode === "due") {
    sorted.sort((left, right) =>
      Number(right.due_count || 0) - Number(left.due_count || 0)
      || Number(left.mastery_score || 0) - Number(right.mastery_score || 0)
      || Number(left.order ?? 9999) - Number(right.order ?? 9999),
    );
  } else if (state.sortMode === "original") {
    sorted.sort((left, right) =>
      Number(left.order ?? 9999) - Number(right.order ?? 9999)
      || String(left.title || "").localeCompare(String(right.title || "")),
    );
  } else {
    sorted.sort((left, right) =>
      Number(left.mastery_score || 0) - Number(right.mastery_score || 0)
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
  setConnectionStatus(state.user ? "同步中" : "检查中");
  if (hasCloudWorkspace() && state.localBackendAvailable === false) {
    state.dashboard = workspace.dashboardFromWorkspace(
      state.cloudCourses,
      state.cloudReviewItems,
      selectedDate(),
    );
    setConnectionStatus("云端已同步");
    renderDashboard();
    return;
  }
  try {
    state.dashboard = await apiJson(`/api/dashboard?date=${encodeURIComponent(selectedDate())}`);
    state.localBackendAvailable = true;
    setConnectionStatus(state.user ? "本机 + 云端" : "本机已连接");
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
      setConnectionStatus("云端已同步");
      renderDashboard();
      return;
    }
    setConnectionStatus(state.cloudConfigured ? "等待登录" : "未配置同步");
    $("courseList").innerHTML = state.cloudConfigured
      ? '<div class="empty-state"><strong>登录后查看你的课程</strong><p>使用右上角“登录同步”，即可在这台设备加载学习内容。</p></div>'
      : `<div class="empty-state">无法读取课程：${escapeHtml(error.message)}</div>`;
  }
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
      $("activeCourseTitle").textContent = currentCourse.title;
      $("activeCourseSummary").textContent = currentCourse.summary_zh || "";
    }
  }
}

function courseRow(course) {
  const expanded = course.id === state.expandedCourseId;
  const dueLabel = course.due_count > 0 ? `${course.due_count} 条今日到期` : "今日已清空";
  const actionLabel = course.due_count > 0 ? "开始今日复习" : "练习全部句子";
  const actionMode = course.due_count > 0 ? "due" : "all";
  const masteryScore = Math.max(0, Math.min(100, Number(course.mastery_score || 0)));
  const masteryLabel = course.mastery_label || workspace.masteryLabel(masteryScore, Number(course.total_count || 0) > 0);
  return `
    <article class="course-row${expanded ? " expanded" : ""}" data-mastery="${masteryScore >= 70 ? "high" : "low"}">
      <button class="course-summary-button" type="button" aria-expanded="${expanded}" onclick="toggleCourse('${escapeHtml(course.id)}')">
        <span class="course-title-group">
          <strong>${escapeHtml(course.title)}</strong>
          <span>${escapeHtml(course.summary_zh || "尚无课程概要")}</span>
        </span>
        <span class="course-metrics" aria-label="课程数据">
          <span class="course-metric mastery-metric"><strong>${masteryScore.toFixed(0)}%</strong><span>${escapeHtml(masteryLabel)}</span></span>
          <span class="course-metric"><strong>${Number(course.due_count || 0)}</strong><span>待复习</span></span>
          <span class="course-metric completed-metric"><strong>${Number(course.completed_today || 0)}</strong><span>今日完成</span></span>
          <span class="course-metric"><strong>${Number(course.total_count || 0)}</strong><span>全部句子</span></span>
        </span>
        <span class="course-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="course-detail"${expanded ? "" : " hidden"}>
        <div class="course-detail-grid">
          <div>
            <p>${escapeHtml(course.summary_zh || "这门课程还没有概要。")}</p>
            <div class="course-badges">
              <span class="badge mastery-badge">熟练度 ${masteryScore.toFixed(0)}% · ${escapeHtml(masteryLabel)}</span>
              <span class="badge${course.due_count > 0 ? " due" : ""}">${escapeHtml(dueLabel)}</span>
              <span class="badge">已掌握 ${Number(course.mastered_count || 0)} / ${Number(course.total_count || 0)}</span>
              ${course.learned_on ? `<span class="badge">学习于 ${escapeHtml(course.learned_on)}</span>` : ""}
            </div>
            <div class="mastery-track" aria-label="熟练度 ${masteryScore.toFixed(0)}%"><span style="width:${masteryScore}%"></span></div>
          </div>
          <button class="button primary" type="button" onclick="startCourseReview('${escapeHtml(course.id)}', '${actionMode}')">${actionLabel}</button>
        </div>
      </div>
    </article>`;
}

function renderCourses(courses = state.dashboard?.courses || []) {
  courses = sortCourses(courses);
  if (!courses.length) {
    $("courseList").innerHTML = state.localBackendAvailable === false
      ? '<div class="empty-state"><strong>账号里还没有课程</strong><p>先在 Mac 本地工作台登录同一账号，现有课程会自动迁移到云端。</p></div>'
      : '<div class="empty-state">还没有课程。点击右上角“导入材料”添加截图或录屏。</div>';
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
    ? (state.user.email || "已登录").split("@")[0]
    : "登录同步";
  if (signedIn) {
    $("signedInEmail").textContent = state.user.email || "已登录账号";
    $("accountSyncSummary").textContent = state.cloudReady
      ? `已同步 ${state.cloudCourses.length} 门课程 · ${state.cloudReviewItems.length} 条复习内容`
      : "正在准备同步";
  }
  if (!state.cloudConfigured) {
    $("accountStatus").textContent = "云同步尚未配置；本机复习功能仍可正常使用。";
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
  if (!email.includes("@")) throw new Error("请输入有效邮箱");
  if (password.length < 6) throw new Error("密码至少需要 6 位");
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
  setAccountBusy(true, silent ? "" : "正在合并本机与云端学习记录…");
  try {
    const [localValue, remoteValue] = await Promise.all([
      readLocalWorkspace(),
      cloud.readWorkspace(state.user.id),
    ]);
    const remote = stripCloudMetadata(remoteValue);
    const local = localValue ? stripCloudMetadata(localValue) : { courses: [], review_items: [] };
    const merged = workspace.mergeWorkspace(local, remote);
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
    $("accountStatus").textContent = `同步完成：${merged.courses.length} 门课程，${merged.review_items.length} 条复习内容。`;
    renderAccountState();
    await refreshDashboard();
  } catch (error) {
    state.cloudReady = false;
    $("accountStatus").textContent = `同步失败：${error.message}`;
    if (!silent) showToast(`同步失败：${error.message}`);
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
    setAccountBusy(true, "正在登录…");
    state.user = await cloud.signIn(email, password);
    state.cloudReady = false;
    renderAccountState();
    setAccountBusy(false);
    await synchronizeWorkspace();
  } catch (error) {
    setAccountBusy(false, `登录失败：${error.message}`);
  }
  return false;
}

async function createAccount() {
  if (state.syncInProgress) return;
  try {
    const { email, password } = accountCredentials();
    setAccountBusy(true, "正在创建账号…");
    const result = await cloud.signUp(email, password);
    if (result.needsEmailConfirmation) {
      $("accountStatus").textContent = "注册成功。请先打开邮箱确认账号，再返回这里登录。";
      return;
    }
    state.user = result.user;
    state.cloudReady = false;
    renderAccountState();
    setAccountBusy(false);
    await synchronizeWorkspace();
  } catch (error) {
    $("accountStatus").textContent = `注册失败：${error.message}`;
  } finally {
    setAccountBusy(false);
  }
}

async function logoutAccount() {
  if (state.syncInProgress) return;
  setAccountBusy(true, "正在退出…");
  try {
    await cloud.signOut();
    state.user = null;
    state.cloudReady = false;
    state.cloudCourses = [];
    state.cloudReviewItems = [];
    closeCourseReview();
    $("accountStatus").textContent = "已安全退出。";
    renderAccountState();
    await refreshDashboard();
  } catch (error) {
    $("accountStatus").textContent = `退出失败：${error.message}`;
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
    $("accountStatus").textContent = `云同步连接失败：${error.message}`;
  }
}

function toggleCourse(courseId) {
  state.expandedCourseId = state.expandedCourseId === courseId ? "" : courseId;
  renderCourses();
}

function startCourseReview(courseId, mode = "due") {
  const course = (state.dashboard?.courses || []).find((entry) => entry.id === courseId);
  if (!course) return;
  state.selectedCourseId = courseId;
  state.expandedCourseId = courseId;
  const preferredCards = mode === "all" ? course.all_cards : course.today_cards;
  state.sessionCards = [...(preferredCards || [])];
  state.currentReviewIndex = 0;
  state.sessionInitialCount = state.sessionCards.length;
  $("activeCourseTitle").textContent = course.title;
  $("activeCourseSummary").textContent = course.summary_zh || "";
  $("sessionLabel").textContent = mode === "all" ? "COURSE PRACTICE" : "TODAY'S REVIEW";
  $("courseReviewWorkspace").hidden = false;
  renderCourses();
  renderActiveCard();
  $("courseReviewWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCourseReview() {
  stopReviewSpeech();
  state.selectedCourseId = "";
  state.sessionCards = [];
  state.currentReviewIndex = 0;
  $("courseReviewWorkspace").hidden = true;
}

function activeCard() {
  return state.sessionCards[state.currentReviewIndex] || null;
}

function resetCardFeedback() {
  $("answerInput").value = "";
  $("answerTarget").textContent = "参考答案默认隐藏。";
  $("answerTarget").classList.remove("revealed");
  $("reviewFeedback").textContent = "先回忆并输入或说出英文，再检查答案。";
  $("reviewFeedback").className = "feedback";
  $("diffPanel").hidden = true;
  $("targetDiffText").textContent = "";
  $("answerDiffText").textContent = "";
  $("coreCoverage").textContent = "核心 0%";
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
  $("sessionProgressBar").style.width = `${empty ? 100 : progress}%`;
  $("sessionProgressText").textContent = empty ? "今日任务完成" : `已完成 ${completedInSession} 条`;
  $("reviewPositionText").textContent = empty ? `${state.sessionInitialCount} / ${state.sessionInitialCount}` : `${state.currentReviewIndex + 1} / ${state.sessionCards.length}`;
  if (!card) return;
  resetCardFeedback();
  $("reviewPrompt").textContent = card.prompt_sentence || card.prompt || "请回忆这句话的英文表达。";
  $("previousReviewButton").disabled = state.currentReviewIndex <= 0;
  $("nextReviewButton").disabled = state.currentReviewIndex >= state.sessionCards.length - 1;
}

function answerTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bit's\b/g, "it is")
    .replace(/\bwe're\b/g, "we are")
    .replace(/\byou're\b/g, "you are")
    .replace(/\bthey're\b/g, "they are")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bisn't\b/g, "is not")
    .replace(/\baren't\b/g, "are not")
    .replace(/\bdon't\b/g, "do not")
    .replace(/\bdoesn't\b/g, "does not")
    .replace(/\bdidn't\b/g, "did not")
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
}

function normalizeAnswer(value) {
  return answerTokens(value).join(" ");
}

function compareReviewAnswer(answer, target, keywords = []) {
  const answerList = answerTokens(answer);
  const targetList = answerTokens(target);
  const answerSet = new Set(answerList);
  const targetSet = new Set(targetList);
  const important = (keywords.length ? keywords : targetList.filter((token) => token.length > 2))
    .map((token) => normalizeAnswer(token))
    .filter(Boolean);
  const importantUnique = [...new Set(important)];
  const matchedKeywords = importantUnique.filter((token) => answerSet.has(token));
  const keywordCoverage = importantUnique.length ? matchedKeywords.length / importantUnique.length : 0;
  const matchedTarget = targetList.filter((token) => answerSet.has(token)).length;
  const tokenCoverage = targetList.length ? matchedTarget / targetList.length : 0;
  const exact = normalizeAnswer(answer) === normalizeAnswer(target);
  const coreCorrect = exact || keywordCoverage >= 0.66 || (keywordCoverage >= 0.5 && tokenCoverage >= 0.72);
  return {
    exact,
    coreCorrect,
    keywordCoverage,
    tokenCoverage,
    coverage: Math.round(Math.max(keywordCoverage, tokenCoverage) * 100),
    targetTokens: targetList,
    answerTokens: answerList,
    missing: targetList.filter((token) => !answerSet.has(token)),
    extra: answerList.filter((token) => !targetSet.has(token)),
  };
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

function revealReviewAnswer() {
  const card = activeCard();
  if (!card) return;
  $("answerTarget").textContent = card.target_sentence || card.answer;
  $("answerTarget").classList.add("revealed");
}

function checkReviewAnswer() {
  const card = activeCard();
  if (!card) return;
  const answer = $("answerInput").value.trim();
  if (!answer) {
    $("reviewFeedback").textContent = "先输入英文或完成一次语音输入。";
    $("reviewFeedback").className = "feedback warning";
    return;
  }
  const target = card.target_sentence || card.answer;
  const comparison = compareReviewAnswer(answer, target, card.keywords || []);
  revealReviewAnswer();
  $("diffPanel").hidden = false;
  $("targetDiffText").innerHTML = renderDiffTokens(comparison.targetTokens, comparison.missing, "token-missing");
  $("answerDiffText").innerHTML = renderDiffTokens(comparison.answerTokens, comparison.extra, "token-extra");
  $("coreCoverage").textContent = `核心 ${comparison.coverage}%`;
  if (comparison.exact) {
    $("reviewFeedback").textContent = "表达准确，可以标记为“会”。";
    $("reviewFeedback").className = "feedback good";
  } else if (comparison.coreCorrect) {
    $("reviewFeedback").textContent = "核心意思正确。红色部分是遗漏或不同之处，不要求逐字一致。";
    $("reviewFeedback").className = "feedback good";
  } else {
    $("reviewFeedback").textContent = "核心信息还不完整。对照红色部分再说一次，然后按真实掌握情况评分。";
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
      if (!state.user) throw new Error("请先登录账号");
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
    const labels = { pass: "已掌握", shaky: "已标记不熟", fail: "已安排近期重练" };
    showToast(labels[result]);
    state.sessionCards.splice(state.currentReviewIndex, 1);
    if (state.currentReviewIndex >= state.sessionCards.length) {
      state.currentReviewIndex = Math.max(0, state.sessionCards.length - 1);
    }
    renderActiveCard();
    await refreshDashboard();
    if (state.localBackendAvailable === true) scheduleCloudSync();
  } catch (error) {
    showToast(`保存失败：${error.message}`);
  }
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setReviewRecordingUi(recording) {
  state.reviewRecording = recording;
  $("reviewSpeechButton").disabled = recording;
  $("reviewStopButton").disabled = !recording;
  $("reviewSpeechButton").textContent = recording ? "录音中" : "开始录音";
}

function startReviewSpeech() {
  if (state.reviewRecording) return;
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    showToast("当前浏览器不支持语音识别，请使用 Chrome 或 Safari。 ");
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
      showToast(`录音识别失败：${event.error}`);
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
    showToast(`无法开始录音：${error.message}`);
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
    showToast("当前浏览器无法播放语音。");
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
  $("chineseSpeechButton").textContent = recording ? "录音中" : "开始录音";
}

function startChineseTranslateSpeech() {
  if (state.chineseRecording) return;
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    showToast("当前浏览器不支持语音识别，请直接输入中文。 ");
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
      showToast(`录音识别失败：${event.error}`);
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
    showToast(`无法开始录音：${error.message}`);
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
    $("translationStatus").textContent = "云端网站暂不提供自动翻译，请在 Mac 本地工作台使用。";
    return;
  }
  const text = $("chineseSpeechInput").value.trim();
  if (!text) {
    $("translationStatus").textContent = "请先输入或说一句中文。";
    return;
  }
  $("translationStatus").textContent = "正在翻译…";
  try {
    const result = await apiJson("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    state.translatedEnglish = result.translation || "";
    $("translationOutput").textContent = state.translatedEnglish || "未生成翻译。";
    $("translationStatus").textContent = result.source || "翻译完成";
  } catch (error) {
    $("translationStatus").textContent = `翻译失败：${error.message}`;
  }
}

function playTranslatedEnglish() {
  speakEnglish(state.translatedEnglish || $("translationOutput").textContent);
}

function renderSelectedFiles() {
  const files = [...$("mediaFileInput").files];
  if (!files.length) {
    $("selectedFiles").textContent = "尚未选择文件";
    return;
  }
  const names = files.slice(0, 4).map((file) => file.name);
  const extra = files.length > 4 ? ` 等 ${files.length} 个文件` : "";
  $("selectedFiles").textContent = `${names.join("、")}${extra}`;
}

async function syncMediaFilesToCodex() {
  if (state.localBackendAvailable === false) {
    $("mediaStatus").textContent = "请在 Mac 本地工作台导入；整理完成后会同步到这个账号。";
    return;
  }
  const files = [...$("mediaFileInput").files];
  if (!files.length) {
    $("mediaStatus").textContent = "请先选择截图或录屏。";
    return;
  }
  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.append("date", selectedDate());
  form.append("slot", "课程导入");
  form.append("completed", "截图/录屏课程整理");
  $("syncMediaButton").disabled = true;
  $("mediaStatus").textContent = "正在上传并创建 Codex 整理任务…";
  try {
    const result = await apiJson("/api/codex-media-inbox", { method: "POST", body: form });
    $("mediaStatus").textContent = "上传完成，Codex 正在按课程整理。页面会自动刷新。";
    pollCodexJob(result.job_id || result.id);
  } catch (error) {
    $("mediaStatus").textContent = `导入失败：${error.message}`;
    $("syncMediaButton").disabled = false;
  }
}

function pollCodexJob(jobId) {
  window.clearTimeout(state.pollTimer);
  if (!jobId) {
    $("mediaStatus").textContent = "任务已提交，请稍后刷新课程。";
    $("syncMediaButton").disabled = false;
    return;
  }
  const check = async () => {
    try {
      const job = await apiJson(`/api/codex-job-status?id=${encodeURIComponent(jobId)}`);
      if (job.status === "completed") {
        $("mediaStatus").textContent = "整理完成，课程与复习句已加入学习台。";
        $("syncMediaButton").disabled = false;
        $("mediaFileInput").value = "";
        renderSelectedFiles();
        await refreshDashboard();
        scheduleCloudSync();
        showToast("新课程已整理完成");
        return;
      }
      if (job.status === "failed") {
        $("mediaStatus").textContent = "Codex 整理失败，请重新提交。";
        $("syncMediaButton").disabled = false;
        return;
      }
      $("mediaStatus").textContent = "Codex 正在识别课程并生成复习句…";
      state.pollTimer = window.setTimeout(check, 2500);
    } catch (error) {
      $("mediaStatus").textContent = `状态检查失败：${error.message}`;
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
  setConnectionStatus("初始化失败");
  $("courseList").innerHTML = `<div class="empty-state">页面初始化失败：${escapeHtml(error.message)}</div>`;
});
