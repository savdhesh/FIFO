import http from "http";
let calls = 0; const seen = [];
http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => {
  if (req.url === "/__stats") { res.end(JSON.stringify({ calls, seen })); return; }
  calls++; const j = JSON.parse(b || "{}"); const sys = j.messages?.[0]?.content ?? ""; const user = j.messages?.[1]?.content ?? "";
  seen.push({ auth: req.headers.authorization, model: j.model, json: j.response_format?.type, sysHead: sys.slice(0, 40), userBytes: user.length });
  let content = "{}";
  if (/convert the resume text/i.test(sys)) content = JSON.stringify({ identity: { name: "Alex Demo" }, roles: [{ id: "x", title: "Principal Verification Engineer", employer: "Imaginary Corp", startDate: "Jan 2020", endDate: "Present", responsibilities: ["Improved regression efficiency by 40% across all programs."], tools: ["JasperGold"] }] });
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}); }).listen(4010, () => console.log("stub up"));
