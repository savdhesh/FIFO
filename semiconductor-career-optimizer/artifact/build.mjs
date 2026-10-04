// Builds dist/artifact.html: one self-contained page (engine + UI + CSS inlined).
import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";

fs.mkdirSync("dist", { recursive: true });
execSync("npx tailwindcss -c artifact/tailwind.config.cjs -i artifact/in.css -o dist/artifact.css --minify", { stdio: "inherit" });
const out = await build({
  entryPoints: ["artifact/app.tsx"], bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: "es2020",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" }, jsx: "automatic",
  external: ["canvg", "html2canvas", "dompurify"], logLevel: "warning", legalComments: "none", charset: "ascii",
  alias: { "@": "./src" },
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync("dist/artifact.css", "utf8");
const head = fs.readFileSync("artifact/head.html", "utf8");
fs.writeFileSync("dist/artifact.html", `${head}\n<style>${css}</style>\n<div id="root"></div>\n<script>${js}</script>\n`);
console.log("dist/artifact.html", (fs.statSync("dist/artifact.html").size / 1024).toFixed(0) + " KB");

// Self-hosted workspace: the same bundle served as static files by the Next.js app (auth via middleware), plus a shim for server mode.
fs.mkdirSync("public/workspace", { recursive: true });
const style = head.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
fs.writeFileSync("public/workspace/app.js", out.outputFiles[0].text);
fs.writeFileSync("public/workspace/app.css", `${style}\n${css}`);
fs.copyFileSync("artifact/shim.js", "public/workspace/shim.js");
fs.writeFileSync("public/workspace/index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Semiconductor Career Optimizer</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"><link rel="stylesheet" href="/workspace/app.css"></head><body><div id="root"></div><script src="/workspace/shim.js"></script><script src="/workspace/app.js"></script></body></html>`);
console.log("public/workspace/ written");
