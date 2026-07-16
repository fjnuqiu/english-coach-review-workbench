import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readProjectFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("personal learning data and local secrets are excluded from git", async () => {
  const gitignore = await readProjectFile(".gitignore");
  const ignoredPatterns = new Set(
    gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );

  for (const pattern of [
    "node_modules/",
    "dist/",
    "dist-*/",
    ".env.*",
    "!.env.example",
    "state/",
    "notes/",
    "uploads/",
    "codex-inbox/",
    "imports/",
    "*.png",
    "*.mp4",
    "*.log",
    "**/backups/",
  ]) {
    assert.equal(ignoredPatterns.has(pattern), true, `missing .gitignore pattern: ${pattern}`);
  }
});

test("Supabase schema uses per-user composite keys, triggers, and full RLS", async () => {
  const sql = await readProjectFile("supabase/english_coach.sql");

  assert.match(sql, /create table if not exists public\.english_coach_courses/);
  assert.match(sql, /primary key \(user_id, course_id\)/);
  assert.match(sql, /create table if not exists public\.english_coach_review_cards/);
  assert.match(sql, /primary key \(user_id, course_id, card_id\)/);
  assert.match(sql, /payload jsonb not null default '\{\}'::jsonb/g);
  assert.match(sql, /create trigger touch_english_coach_courses_updated_at/);
  assert.match(sql, /create trigger touch_english_coach_review_cards_updated_at/);

  for (const table of ["english_coach_courses", "english_coach_review_cards"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`for ${operation}\\n  to authenticated`));
  }
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /with check \(auth\.uid\(\) = user_id\)/);
});

test("GitHub Pages build injects public Supabase configuration", async () => {
  const [packageJson, viteConfig, workflow, envExample] = await Promise.all([
    readProjectFile("package.json"),
    readProjectFile("vite.pages.config.mjs"),
    readProjectFile(".github/workflows/pages.yml"),
    readProjectFile(".env.example"),
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.scripts["build:pages"], "vite build --config vite.pages.config.mjs");
  assert.match(viteConfig, /GITHUB_PAGES_BASE_PATH/);
  assert.match(viteConfig, /root: webRoot/);
  assert.match(viteConfig, /outDir: outputRoot/);
  assert.match(viteConfig, /window\.ENGLISH_COACH_CONFIG/);
  assert.match(viteConfig, /replaceAll\('src="\/assets\//);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /VITE_SUPABASE_URL: \$\{\{ vars\.VITE_SUPABASE_URL \}\}/);
  assert.match(
    workflow,
    /VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.VITE_SUPABASE_PUBLISHABLE_KEY \}\}/,
  );
  assert.match(envExample, /^VITE_SUPABASE_URL=$/m);
  assert.match(envExample, /^VITE_SUPABASE_PUBLISHABLE_KEY=$/m);
});
