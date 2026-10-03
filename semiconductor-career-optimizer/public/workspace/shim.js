/* Server-mode shim: gives the workspace the same two things the Claude artifact runtime gives it
   (state persistence and an AI "sample" function), backed by this server's authenticated API. */
(function () {
  var json = function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok) { var e = new Error(d.error || ("Request failed (" + res.status + ")")); e.status = res.status; throw e; } return d; }); };
  var post = function (url, body, signal) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: signal }).then(json); };
  var timer = null, pending = null, failed = false;
  var adapter = {
    mode: "server",
    user: null, aiProvider: "AI",
    load: function () {
      return Promise.all([fetch("/api/me").then(json).catch(function () { return null; }), fetch("/api/ai/status").then(json).catch(function () { return { available: false }; }), fetch("/api/state").then(json).catch(function () { return { state: null }; })]).then(function (r) {
        if (r[0] && r[0].email) adapter.user = { email: r[0].email };
        adapter.ai = r[1]; adapter.aiProvider = r[1].provider || "AI";
        return r[2].state;
      });
    },
    save: function (state) {
      pending = state; if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: pending }) }).then(json).then(function () { failed = false; }).catch(function (e) { if (!failed) { failed = true; console.error("Could not save to the server: " + e.message); } });
      }, 700);
    },
    logout: function () { return post("/api/auth/logout", {}).then(function () { location.href = "/login"; }); },
    fetchJob: function (url) { return post("/api/jobs/fetch", { url: url }).then(function (d) { return d.text; }); },
    storeFile: function (file) { var fd = new FormData(); fd.append("file", file); return fetch("/api/resume/upload", { method: "POST", body: fd }).then(json).then(function (d) { return d.id; }); },
    deleteFile: function (id) { return fetch("/api/resume/" + id, { method: "DELETE" }).then(json); },
    deleteAll: function (password, scope) { return fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: password, scope: scope }) }).then(json).then(function () { if (scope === "account") location.href = "/login"; else location.reload(); }); }
  };
  window.SCO_ADAPTER = adapter;
  var sample = null;
  var make = function () {
    var complete = function (system, user, opts) { return post("/api/ai/complete", { system: system, user: user }, opts && opts.signal).then(function (d) { return d.text; }); };
    var fn = function (input, opts) { var text = typeof input === "string" ? input : input.map(function (m) { return m.content; }).join("\n\n"); return complete("", text, opts).then(function (t) { return { text: t, truncated: false }; }); };
    fn.complete = complete; return fn;
  };
  var downloads = { save: function (req) {
    return new Promise(function (resolve, reject) {
      try {
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = req.filename; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); resolve({ status: "saved" });
      } catch (e) { reject({ code: "unavailable", message: String(e) }); }
    });
  } };
  window.claude = { use: function (name) {
    if (name === "downloads") return Promise.resolve(downloads);
    if (name === "sample") return Promise.resolve(adapter.ai && adapter.ai.available ? (sample = sample || make()) : null);
    return Promise.resolve(null);
  } };
})();
