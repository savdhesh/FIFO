# End-to-end checks (headless Chromium)

Not part of `npm test` because they need a browser and, for server mode, a running app and a stub AI vendor.

```bash
npm i -D playwright-core          # once; Chromium path via CHROMIUM=/path/to/chrome or /opt/pw-browsers
npm run build                     # builds dist/artifact.html and public/workspace
node e2e/claude-mode.mjs          # artifact with a fake Claude runtime (function-valued `sample`, `downloads`)
node e2e/ui-audit.mjs             # every tab at 1280/400 px: overflow, unlabeled controls, blocked storage, dark mode
# server mode:
node e2e/stub-ai.mjs &            # fake OpenAI-compatible vendor on :4010
AI_PROVIDER=openai OPENAI_API_KEY=sk-test OPENAI_BASE_URL=http://localhost:4010 npm start &
node e2e/server-mode.mjs          # register, workspace, AI proxy, persistence across reload, SSRF block, download, delete
```
Some fixture paths (older resumes, a PDF) are placeholders pointing at `tests/fixtures`; adjust if you want the full multi-resume path.
