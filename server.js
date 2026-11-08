// Project 1 networked prototype v6 - server (10-28: + keep / let go per round)
// Two people join the same room; the first is "m" (he), the second is "f" (she).
// Each round both send their choice; when both are in, the server tells both.
// Run:  node server.js   (then open http://localhost:3000/?room=test in two windows)
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log("P1 server on port " + PORT));
// 11-08 v2: memories left by players (one sentence each) -> memories.json next to this file
const fs = require("fs"), path = require("path");
const MEM = path.join(__dirname, "memories.json");
function readMem() { try { return JSON.parse(fs.readFileSync(MEM, "utf8")); } catch (e) { return []; } }
app.use(express.json({ limit: "4kb" }));
app.get("/memories", (q, s) => s.json({ memories: readMem().slice(-30).reverse().map(x => x.text) }));
app.post("/memory", (q, s) => {
  const t = String((q.body && q.body.text) || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!t) return s.status(400).json({ ok: false });
  const m = readMem(); m.push({ t: new Date().toISOString(), room: String((q.body && q.body.room) || "").slice(0, 40), role: q.body && q.body.role === "f" ? "f" : "m", text: t });
  fs.writeFileSync(MEM, JSON.stringify(m, null, 1)); console.log("memory:", t); s.json({ ok: true, n: m.length });
});
app.use(express.static("public", { etag: false, maxAge: 0, setHeaders: r => r.setHeader("Cache-Control", "no-store") }));

const io = require("socket.io")(server);
const rooms = {};   // room -> { m, f, choices: { round: { m, f } }, keeps: { round: { m, f } } }

function roomState(name) {
  if (!rooms[name]) rooms[name] = { m: null, f: null, choices: {}, keeps: {} };
  return rooms[name];
}
function count(r) { return (r.m ? 1 : 0) + (r.f ? 1 : 0); }

io.on("connection", socket => {
  let roomName = null, role = null;
  console.log("connect", socket.id);

  socket.on("join", data => {
    roomName = (data && data.room) || "default";
    const r = roomState(roomName);
    const want = data && (data.as === "m" || data.as === "f") ? data.as : null;   // ?as=m / ?as=f 固定角色(10-27)
    if (want && !r[want]) role = want;
    else if (!r.m) role = "m"; else if (!r.f) role = "f"; else { socket.emit("full"); return; }
    r[role] = socket.id;
    socket.join(roomName);
    socket.emit("role", { role, n: count(r) });
    io.to(roomName).emit("players", { n: count(r) });
    console.log(roomName, role, "joined, players:", count(r));
  });

  socket.on("choose", data => {
    if (!roomName || !role) return;
    const r = roomState(roomName);
    const round = data.round;
    if (!r.choices[round]) r.choices[round] = {};
    r.choices[round][role] = data.emo;
    socket.to(roomName).emit("partner_chose", { round });            // the other side sees "she has chosen"
    const c = r.choices[round];
    if (c.m && c.f) io.to(roomName).emit("both", { round, m: c.m, f: c.f });
  });

  socket.on("keep", data => {                                        // keep this memory? both must say yes
    if (!roomName || !role) return;
    const r = roomState(roomName);
    const round = data.round;
    if (!r.keeps[round]) r.keeps[round] = {};
    r.keeps[round][role] = !!data.keep;
    socket.to(roomName).emit("partner_kept", { round, keep: !!data.keep });
    const k = r.keeps[round];
    if (k.m !== undefined && k.f !== undefined) io.to(roomName).emit("kept", { round, m: k.m, f: k.f });
  });

  socket.on("pause", data => {                                       // 11-03: one side presses P, the other freezes too
    if (!roomName) return;
    socket.to(roomName).emit("pause", { on: !!(data && data.on) });
  });

  socket.on("bookskip", () => { if (!roomName) return; console.log(roomName, role, "bookskip"); socket.to(roomName).emit("bookskip"); });   // 11-03: skip the book flipping on both sides

  socket.on("restart", () => {
    if (!roomName) return;
    const r0 = roomState(roomName); r0.choices = {}; r0.keeps = {};
    io.to(roomName).emit("restart");
  });

  socket.on("disconnect", () => {
    if (!roomName || !role) return;
    const r = roomState(roomName);
    if (r[role] === socket.id) r[role] = null;
    r.choices = {}; r.keeps = {};
    io.to(roomName).emit("players", { n: count(r) });
    io.to(roomName).emit("partner_left");
    if (count(r) === 0) delete rooms[roomName];
    console.log(roomName, role, "left");
  });
});
