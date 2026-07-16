(function initEnglishCoachCloud(root) {
  "use strict";

  const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.2/+esm";
  const COURSES_TABLE = "english_coach_courses";
  const CARDS_TABLE = "english_coach_review_cards";
  let client = null;

  function config() {
    return root.ENGLISH_COACH_CONFIG || {};
  }

  function isConfigured() {
    const value = config();
    return Boolean(value.supabaseUrl?.trim() && value.supabasePublishableKey?.trim());
  }

  async function initialize() {
    if (client) return client;
    if (!isConfigured()) return null;
    const { createClient } = await import(SUPABASE_MODULE_URL);
    const value = config();
    client = createClient(value.supabaseUrl, value.supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
    return client;
  }

  async function currentUser() {
    const activeClient = await initialize();
    if (!activeClient) return null;
    const { data, error } = await activeClient.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session?.user || null;
  }

  async function signIn(email, password) {
    const activeClient = await initialize();
    if (!activeClient) throw new Error("Cloud sync is not configured");
    const { data, error } = await activeClient.auth.signInWithPassword({
      email: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    });
    if (error) throw new Error(error.message);
    return data.user;
  }

  async function signUp(email, password) {
    const activeClient = await initialize();
    if (!activeClient) throw new Error("Cloud sync is not configured");
    const { data, error } = await activeClient.auth.signUp({
      email: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    });
    if (error) throw new Error(error.message);
    return {
      user: data.user,
      needsEmailConfirmation: Boolean(data.user && !data.session),
    };
  }

  async function signOut() {
    const activeClient = await initialize();
    if (!activeClient) return;
    const { error } = await activeClient.auth.signOut();
    if (error) throw new Error(error.message);
  }

  function onAuthStateChange(callback) {
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
    return () => data.subscription.unsubscribe();
  }

  async function readWorkspace(userId) {
    const activeClient = await initialize();
    if (!activeClient) throw new Error("Cloud sync is not configured");
    const [coursesResult, cardsResult] = await Promise.all([
      activeClient.from(COURSES_TABLE).select("course_id,payload,updated_at").eq("user_id", userId),
      activeClient.from(CARDS_TABLE).select("course_id,card_id,payload,updated_at").eq("user_id", userId),
    ]);
    if (coursesResult.error) throw new Error(coursesResult.error.message);
    if (cardsResult.error) throw new Error(cardsResult.error.message);
    return {
      courses: (coursesResult.data || []).map((row) => ({
        ...(row.payload || {}),
        id: row.payload?.id || row.course_id,
        cloud_updated_at: row.updated_at,
      })),
      review_items: (cardsResult.data || []).map((row) => ({
        ...(row.payload || {}),
        id: row.payload?.id || row.card_id,
        course_id: row.payload?.course_id || row.course_id,
        cloud_updated_at: row.updated_at,
      })),
    };
  }

  function lastHistory(item) {
    return (item.history || []).at(-1) || null;
  }

  function successStreak(item) {
    let streak = 0;
    for (const entry of [...(item.history || [])].reverse()) {
      if (entry?.result !== "pass") break;
      streak += 1;
    }
    return streak;
  }

  function courseRow(userId, course) {
    return {
      user_id: userId,
      course_id: course.id,
      title: course.title || "",
      summary_zh: course.summary_zh || "",
      learned_on: course.learned_on || null,
      display_order: Number(course.order || 0),
      payload: course,
    };
  }

  function cardRow(userId, item) {
    const last = lastHistory(item);
    const reviewedAt = last?.synced_at
      || (last?.date ? `${last.date}T00:00:00Z` : null);
    return {
      user_id: userId,
      course_id: item.course_id,
      card_id: item.id,
      prompt: item.prompt || item.translation || item.meaning || "",
      answer: item.item || item.example || "",
      status: item.status || "new",
      mastery_score: Math.round(root.EnglishCoachWorkspace.cardMasteryScore(item)),
      interval_days: Math.max(0, Number(item.interval_days || 0)),
      review_count: (item.history || []).length,
      success_streak: successStreak(item),
      last_result: item.last_result || null,
      next_due: item.next_due || null,
      last_reviewed_at: reviewedAt,
      payload: item,
    };
  }

  async function saveWorkspace(userId, workspace) {
    const activeClient = await initialize();
    if (!activeClient) throw new Error("Cloud sync is not configured");
    const courseRows = (workspace.courses || []).map((course) => courseRow(userId, course));
    if (courseRows.length) {
      const { error } = await activeClient.from(COURSES_TABLE).upsert(courseRows, {
        onConflict: "user_id,course_id",
      });
      if (error) throw new Error(error.message);
    }
    const cardRows = (workspace.review_items || []).map((item) => cardRow(userId, item));
    for (let index = 0; index < cardRows.length; index += 150) {
      const { error } = await activeClient.from(CARDS_TABLE).upsert(cardRows.slice(index, index + 150), {
        onConflict: "user_id,course_id,card_id",
      });
      if (error) throw new Error(error.message);
    }
  }

  async function saveReviewItem(userId, item) {
    const activeClient = await initialize();
    if (!activeClient) throw new Error("Cloud sync is not configured");
    const { error } = await activeClient.from(CARDS_TABLE).upsert(cardRow(userId, item), {
      onConflict: "user_id,course_id,card_id",
    });
    if (error) throw new Error(error.message);
  }

  root.EnglishCoachCloud = {
    currentUser,
    initialize,
    isConfigured,
    onAuthStateChange,
    readWorkspace,
    saveReviewItem,
    saveWorkspace,
    signIn,
    signOut,
    signUp,
  };
})(window);
