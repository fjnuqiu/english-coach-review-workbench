import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(projectRoot, "web");
const outputRoot = resolve(projectRoot, "dist-pages");
const pagesBase = process.env.GITHUB_PAGES_BASE_PATH ?? "/";

function browserRuntimeConfig() {
  const config = {
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
    supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  };
  const serialized = JSON.stringify(config).replaceAll("<", "\\u003c");

  return {
    name: "english-coach-browser-runtime-config",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        let servedHtml = html.replaceAll('src="/assets/', `src="${pagesBase}assets/`);
        // Classic scripts are copied as-is. Version their URLs together with the
        // HTML so an older cached app cannot be paired with the new vocabulary UI.
        for (const match of html.matchAll(/src="\/assets\/([\w.-]+\.js)"/g)) {
          const source = await readFile(resolve(webRoot, "assets", match[1]));
          const version = createHash("sha256").update(source).digest("hex").slice(0, 12);
          const url = `${pagesBase}assets/${match[1]}`;
          servedHtml = servedHtml.replaceAll(`src="${url}"`, `src="${url}?v=${version}"`);
        }
        return {
          html: servedHtml,
          tags: [
            {
              tag: "script",
              children: `window.ENGLISH_COACH_CONFIG = Object.freeze(${serialized});`,
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

function copyClassicBrowserAssets() {
  return {
    name: "english-coach-copy-classic-assets",
    apply: "build",
    async closeBundle() {
      const source = resolve(webRoot, "assets");
      const destination = resolve(outputRoot, "assets");
      await mkdir(destination, { recursive: true });
      await cp(source, destination, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: pagesBase,
  root: webRoot,
  publicDir: false,
  plugins: [browserRuntimeConfig(), copyClassicBrowserAssets()],
  build: {
    assetsDir: "assets",
    emptyOutDir: true,
    outDir: outputRoot,
  },
});
