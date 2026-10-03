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
