// Project 1 prototype v6 (2026-10-28): two strangers build a childhood story with four feelings as cards
//
// opening : the picture book (8 childhood things, sand, flip) -> three questions -> black
// intro   : a few lines typed out: you are connected to a stranger, the rules (like rock paper scissors, with feelings), your role
// home    : camera frame + 4 big gesture icons + this round's story prompt (morning / dusk / going home)
// waiting : until the other person has sent too (solo mode: partner is simulated)
// reveal  : both hands side by side (like showing hands in rock paper scissors) + the stranger's face, mosaic -> clearer each round
// duo     : my childhood figure and theirs, side by side, black & white -> they slide together
// pair    : the pair picture builds up block by block (colour comes back) + one line of the story
//           then: keep this memory? thumb up = keep, fist = let go. Both must keep for it to enter the library.
// final   : the three pictures of this story side by side, like a comic strip
// ending  : the library of 16 (kept between sessions) + again (V gesture) / stay
//
// URL options:  ?room=NAME  (both players use the same name; default "default")   ?as=m / ?as=f  fixed role
//               ?solo=1 partner simulated (no server)   ?skip=1 skip the opening   ?skip=2 skip opening + intro   ?fast=1 four times faster
// Keys: 1-4 choose, 5 keep (thumb), 3 let go (fist) on the keep screen, 6 again, C colour on/off, R restart, P pause/continue (both sides), any other key during the opening = skip it.

const ROUNDS = 4;   // 10-30:四轮(夏天 / 停电 / 郊游 / 搬家)
const EMOS = { m: ["calm", "smile", "down", "surprised"], f: ["calm", "smile", "cry", "surprised"] };
const GESTURE_FILES = ["1_calm", "2_happy", "3_sad", "4_surprised", "5_send", "6_again"];
const GESTURE_NAMES = ["shh", "open hand", "fist", "L shape", "thumb up", "V"];
const FACE_COLOURS = { calm: [120, 170, 255], smile: [255, 200, 90], down: [140, 120, 220], surprised: [255, 110, 120], cry: [140, 120, 220] };
const MOSAIC = [12, 28, 0];                // face resolution per round: 12x12 blocks, 28x28, then the real drawing (0 = full)

// ---- timing (seconds) ----
const T_OUT = 1.4, T_SWAP = 0.4, T_IN = 2.0, T_FADE_BLACK = 0.9;
const T_REVEAL_HOLD = 3.0, T_DUO_HOLD = 1.8, T_DUO_SLIDE = 1.4;
const T_FILL = 3.4, T_HOLD = 1.6, T_RESULT = 1.6, T_STRIP = 1.2, T_STRIP_HOLD = 4.0;
const BLOCK = 20;

const Q = new URLSearchParams(location.search);
const FAST = Q.get("fast") ? 0.25 : 1;
const SOLO = !!Q.get("solo") || typeof io === "undefined";
const ROOM = Q.get("room") || "default";
const ASSETS = window.P1_ASSETS || null;
const src = p => (ASSETS && ASSETS[p]) || p;

let faces = { m: {}, f: {} }, acts = { m: {}, f: {} }, pairs = {}, pairsColour = {}, gestures = [], lines = {};
let role = "m";                 // me; the partner is the other one
const other = () => (role === "m" ? "f" : "m");
let state = "opening";   // opening → intro → rps → dialog → merge (×4) → final → ending
let round = 1, myChoice = null, sent = false, partnerChoice = null, partnerSent = false, history = [];
let myKeep = null, partnerKeep = null, keptResult = null;
let scene, scene2, liquidG, liquidSh, revealBuf, mosaicG;
let trans = null, holdStart = 0;
let hoverIcon = -1, hoverBtn = -1, colourOn = false;
let unlocked = new Set(), newlyLit = new Set();
let pairPhase = "fill", pairT = 0, blocksOn = [], blocksOff = [], duoK = 0, stripT = 0;
let socket = null, players = SOLO ? 2 : 0, netMsg = SOLO ? "solo (partner simulated)" : "connecting...";
// ---- ml5 handPose (10-31):老师课上的三行 setup 搬进来(createCapture / ml5.handPose / detectStart)。
//      只在猜拳和结尾用手;画面里只画 21 个关节点,不放摄像头原视频(Boyd:人不能用原视频)。?nocam=1 关掉,键盘 1 2 3 永远能用。
const CAM = !Q.get("nocam") && typeof ml5 !== "undefined";
let video = null, handPose = null, hands = [], mlReady = false, mlMsg = CAM ? "camera starting..." : "no camera (keys 1 2 3)";
let gestNow = null, gestSince = 0; const T_GEST_HOLD = 0.45;   // 同一个手势稳住 0.6 秒才算数,防抖
function gotHands(results) { hands = results; }                // 老师的 gotHands:每帧把识别结果存起来
async function mlStart() {
  if (!CAM) return;
  try {
    video = createCapture(VIDEO, { flipped: true }); video.size(640, 480); video.hide();
    handPose = ml5.handPose({ flipped: true, maxHands: 1 });
    if (handPose.ready) await handPose.ready;                    // 等模型真的下载完再开始识别(不然 ml5 1.4 会报 estimateHands 为 null)
    handPose.detectStart(video, gotHands); mlReady = true; mlMsg = "camera on";
  } catch (e) { mlMsg = "camera blocked (keys 1 2 3)"; console.log("ml5", e); }
}
function fingerUp(h, name) {   // 指尖离手腕比第二关节(pip)远 = 这根手指伸直了(手怎么转都成立)
  const w = h.wrist, tip = h[name + "_tip"], pip = h[name + "_pip"]; if (!w || !tip || !pip) return false;
  return dist(tip.x, tip.y, w.x, w.y) > dist(pip.x, pip.y, w.x, w.y) * 1.08;
}
function handToGesture() {     // 数伸直的手指(拇指不算):0 根 = 石头 / 食+中 2 根 = 剪刀 / 4 根 = 布;其他 = 看不懂
  if (!hands.length) return null; const h = hands[0];
  const up = ["index_finger", "middle_finger", "ring_finger", "pinky_finger"].map(n => fingerUp(h, n)), n = up.filter(Boolean).length;
  if (n === 0) return "rock"; if (up[0] && up[1] && !up[2]) return "scissors"; if (n >= 3) return "paper"; return null;   // 11-02:无名指弯着就是剪刀(小指翘一点不算布)
}
function gestureStable() {     // 返回已经稳住 0.6 秒的手势,否则 null
  const g = handToGesture(); if (g !== gestNow) { gestNow = g; gestSince = millis(); }
  return g && (millis() - gestSince) / 1000 >= T_GEST_HOLD ? g : null;
}
function drawHandDots(g, b) {  // 把 21 个关节点画进左边的框(320x240 → 框的大小)
  if (!hands.length) return; const h = hands[0], sx = b.w / 640, sy = b.h / 480;
  g.push(); g.noStroke(); g.fill(255, 220, 150, 210);
  for (const k of h.keypoints) g.circle(b.x + k.x * sx, b.y + k.y * sy, 6);
  g.pop();
}


function preload() {
  for (const r of ["m", "f"]) for (const e of EMOS[r]) {
    faces[r][e] = loadImage(src(`assets/face_${r}_${e}.png`) + (ASSETS ? "" : "?v=2"));   // 10-30 换成他的 160 娃娃脸(×4 放大到 640)
    acts[r][e] = loadImage(src(`assets/white/act_${r}_${e}.png`));
  }
  for (const m of EMOS.m) for (const f of EMOS.f) {
    const k = `${m}_${f}`;
    pairs[k] = loadImage(src(`assets/white/pair_${k}.png`));
    // the partner's coloured version, if it exists (assets/colour/pair_*.png); otherwise the white one is used
    pairsColour[k] = null;
    loadImage(src(`assets/colour/pair_${k}.png`), img => { pairsColour[k] = img; }, () => { pairsColour[k] = null; });
  }
  for (const g of GESTURE_FILES) gestures.push(loadImage(src(`assets/gestures/${g}.png`)));
  if (window.P1_LINES) lines = window.P1_LINES; else lines = loadJSON("lines.json?v=11");
  opPreload();
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Georgia");
  makeBuffers();
  revealBuf = createGraphics(640, 640); mergeBuf = createGraphics(MW, MH); mergeBuf.pixelDensity(1);
  mosaicG = createGraphics(64, 64); mosaicG.pixelDensity(1);
  try { JSON.parse(localStorage.getItem("p1_unlocked") || "[]").forEach(k => unlocked.add(k)); } catch (e) {}
  try { JSON.parse(localStorage.getItem("p1_pages") || "[]").forEach(n => pagesLit.add(n)); } catch (e) {}
  if (Q.get("book") === "all") for (const sp of BOOK_SPREADS) for (const n of sp) pagesLit.add(n);   // ?book=all demo: every page lit
  opSetup();
  if (Q.get("skip") === "2") startRps();
  if (Q.get("book")) { history = BOOK_SAMPLE.slice(); bookEnter(); }   // ?book=1 jump straight to the ending book (demo)
  else if (Q.get("skip")) startIntro();
  if (!SOLO) connect();
  mlStart();   // 10-31:开摄像头 + ml5 handPose(浏览器只在 https 或 localhost 才给摄像头)
  pauseInit();
}
function makeBuffers() {
  scene = createGraphics(width, height); scene2 = createGraphics(width, height);
  liquidG = createGraphics(width, height, WEBGL); liquidSh = liquidG.createShader(LIQUID_VS, LIQUID_FS);
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); makeBuffers(); }

// ---------- lines helpers ----------
const pairImg = k => (colourOn && pairsColour[k]) ? pairsColour[k] : pairs[k];
const pairKey = () => (role === "m" ? `${myChoice}_${partnerChoice}` : `${partnerChoice}_${myChoice}`);
const heShe = () => (other() === "f" ? "she" : "he");
const emoWord = e => (e && lines.emo && lines.emo[e]) || e || "";
function fmt(s) {
  if (!s) return "";
  const mF = role === "m" ? myChoice : partnerChoice, fF = role === "m" ? partnerChoice : myChoice;
  return s.replace(/\{me\}/g, emoWord(myChoice)).replace(/\{other\}/g, emoWord(partnerChoice))
          .replace(/\{mFeel\}/g, emoWord(mF)).replace(/\{fFeel\}/g, emoWord(fF))
          .replace(/\{meRole\}/g, role === "m" ? "boy" : "girl").replace(/\{otherRole\}/g, role === "m" ? "girl" : "boy")
          .replace(/\{stem\}/g, roundLine()).replace(/\{they\}/g, heShe()).replace(/\{round\}/g, round);
}
const pickLine = (box, emo) => { if (!box) return ""; const set = box[other()] || box; return set[emo] || ""; };
const roundLine = () => (lines.round && lines.round[round - 1]) || "";

// ---------- network ----------
function connect() {
  socket = io();
  socket.on("connect", () => { netMsg = "connected, joining room " + ROOM; socket.emit("join", { room: ROOM, as: Q.get("as") }); });
  socket.on("role", d => { role = d.role; players = d.n; netMsg = `you are ${role === "m" ? "the boy" : "the girl"} · room ${ROOM}`; });
  socket.on("players", d => { players = d.n; });
  socket.on("full", () => { netMsg = "room is full (two people already)"; });
  socket.on("partner_chose", d => { if (d.round === round) partnerSent = true; });
  socket.on("both", d => {                                        // 两只手都到了服务器:倒数还没完就先存着,倒数完一起亮
    if (d.round !== round || state !== "rps") return;
    if (rpsPhase === "count" && (millis() - rpsT) / 1000 / FAST < T_COUNT) pendingBoth = { m: d.m, f: d.f };
    else if (rpsPhase === "count") settleRps(d.m, d.f);
  });
  socket.on("partner_left", () => { players = 1; });
  socket.on("restart", () => { if (state === "ending") bookAgainStart(); else restart(); });
  socket.on("pause", d => setPaused(!!(d && d.on), true));
  socket.on("bookskip", () => bookSkip(true));   // 11-03:一边按 P 两边一起停
  socket.on("disconnect", () => { netMsg = "disconnected"; players = 0; });
}
// ---------- layout ----------
const bandH = () => floor(height / 6);
const contentH = () => height - bandH();
const S = s => s * 1000 * FAST;

// ---- pause (11-03): P freezes everything - the clock every timer reads, the hands, the music - and tells the other side to freeze too ----
let paused = false, pausedAt = 0, pauseOffset = 0, pausedDrawn = false, pausedAudio = [], _realMillis = null;
function pauseInit() { _realMillis = window.millis; window.millis = () => (paused ? pausedAt : _realMillis()) - pauseOffset; }
function setPaused(on, fromNet) {
  if (on === paused) return;
  paused = on;
  if (on) {
    pausedAt = _realMillis(); pausedDrawn = false; pausedAudio = [];
    for (const a of [opAudio, dlgAudio, bookAudio]) if (a && !a.paused) { a.pause(); pausedAudio.push(a); }
    if (sfxCtx && sfxCtx.state === "running") sfxCtx.suspend();
  } else {
    pauseOffset += _realMillis() - pausedAt; hands = []; gestNow = null;
    for (const a of pausedAudio) { const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); } pausedAudio = [];
    if (sfxCtx && sfxCtx.state === "suspended") sfxCtx.resume();
  }
  if (!fromNet && socket) socket.emit("pause", { on });
}
function drawPaused() {   // drawn once on top of the frozen frame
  push(); noStroke(); fill(0, 150); rect(0, 0, width, height);
  fill(235); textAlign(CENTER, CENTER); textSize(min(40, width / 24)); text("paused", width / 2, height / 2 - 14);
  fill(170); textSize(14); text("press P to continue", width / 2, height / 2 + 26); pop();
}

function draw() {
  if (paused) { if (!pausedDrawn) { drawPaused(); pausedDrawn = true; } return; }
  background(0);
  if (state === "opening") { opDraw(); return; }
  if (trans) { drawTransition(); return; }
  if (state === "intro") drawIntro();
  else if (state === "rps") drawRps(this);
  else if (state === "dialog") drawDialog(this);
  else if (state === "merge") drawMerge(this);
  else if (state === "final") drawFinal();
  else if (state === "ending") drawBook();
  else if (state === "leave") drawLeave();
  else if (state === "end") drawEnd();
  if (CAM && state === "ending" && !trans && bookOptionsOn()) {   // 10-31 ml5:结尾两个选项也能用手 — 剪刀(V) = again,布(张开手) = stay
    const gs = gestureStable();
    if (gs === "scissors") { if (socket) socket.emit("restart"); bookAgainStart(); } else if (gs === "paper") leaveEnter();   // 11-08 v2:张手 = 留下记忆
  }
  drawCorner();
}

function drawCorner() {
  noStroke(); fill(50); textAlign(RIGHT, TOP); textSize(12);
  text(`${colourOn ? "colour" : "black & white"} (C)   pause (P)   restart (R)`, width - 12, 8);
  textAlign(LEFT, TOP);
  fill(players >= 2 ? [80, 160, 80] : [150, 110, 60]);
  text(`${netMsg}   ·   ${SOLO ? "" : players >= 2 ? "both here" : "waiting for the other person to open the page"}`, 12, 8);
}

// dialogue band
let bandFrom = "", bandTo = "", bandAlpha, bandFont = "Georgia", bandFontFrom = "Georgia", bandFontTo = "Georgia";
function drawBand(g, txt, small) {
  if (g === scene) { bandFrom = txt || ""; bandFontFrom = bandFont; return; }
  if (g === scene2) { bandTo = txt || ""; bandFontTo = bandFont; return; }
  const h = bandH(), y = height - h;
  g.noStroke(); g.fill(0); g.rect(0, y, width, h);
  g.stroke(255, 140); g.strokeWeight(1); g.line(24, y, width - 24, y); g.noStroke();
  g.push(); g.textFont(bandFont);
  g.noStroke(); g.fill(235, 255 * (bandAlpha === undefined ? 1 : bandAlpha)); g.textAlign(CENTER, CENTER); g.textSize(max(18, min(28, h * 0.24)));
  g.text(txt || "", 60, y + 10, width - 120, h - (small ? 34 : 20));
  g.pop();
  if (small) { g.fill(80); g.textSize(13); g.textAlign(CENTER, CENTER); g.text(small, width / 2, y + h - 16); }
}

// ---------- intro: the rules, typed out ----------
let introStart = 0, introDone = false;
const CPS = 28, LINE_GAP = 0.7;   // characters per second, pause between lines
function introLines() {
  const base = (lines.intro && lines.intro.length) ? lines.intro.slice() : ["(intro lines go here)"];
  if (lines.role && lines.role[role]) base.push(lines.role[role]);
  return base;
}
function startIntro() { state = "intro"; introStart = millis(); introDone = false; }
function drawIntro() {
  const L = introLines();
  const t = (millis() - introStart) / 1000 / FAST;
  push(); textFont(FONT_ADULT); textAlign(CENTER, CENTER); const sz = max(20, min(34, width / 36)); textSize(sz); textLeading(sz * 1.9);
  let acc = 0, allDone = true;
  const y0 = height / 2 - (L.length - 1) * sz * 0.95;
  for (let i = 0; i < L.length; i++) {
    const dur = L[i].length / CPS;
    const k = constrain((t - acc) / dur, 0, 1);
    if (k < 1) allDone = false;
    const n = floor(L[i].length * k);
    const last = i === L.length - 1;
    fill(last ? [255, 220, 150] : 235);
    text(L[i].slice(0, n), 60, y0 + i * sz * 1.9 - sz, width - 120, sz * 2);
    acc += dur + LINE_GAP;
  }
  pop();
  if (allDone && !introDone) { introDone = true; holdStart = millis(); }
  noStroke(); fill(60); textAlign(RIGHT, BOTTOM); textSize(12); text(introDone ? "click to begin" : "click to skip", width - 12, height - 8);
  if (introDone && millis() - holdStart > S(2)) startRps();
}
function introClick() { if (!introDone) { introStart = -1e9; } else startRps(); }

// ======================================================================================
// v7 的中间(10-30 重写):一轮 = 猜拳 → 舞台 + 气泡(三句配音)→ 两个人滑到中间、碎片拼成这一页 → 字幕。四轮。
// 状态:rps(猜拳) → dialog(对话) → merge(拼页) → 下一轮 rps … → final(四页并排) → ending(大书)
// ======================================================================================
const RPS = ["rock", "paper", "scissors"];                       // 三种手
const RPS_ICON = { rock: 2, paper: 1, scissors: 5 };             // 用哪张手势图:拳头 / 张开的手 / V
const T_COUNT = 3.0, T_RPS_SHOW = 2.0; const T_HAND_WAIT = () => (CAM ? 7.0 : 2.0);   // 11-01:倒数完再等手 7 秒(他说 321 太快)                           // 倒数 3 秒;亮牌 + 结果字停 2.4 秒
const T_LINE_MIN = 1.3, T_LINE_MAX = 4.8, T_DLG_HOLD = 0.7;       // 每句最少 1.6 秒、最多 4.8 秒(配音放完就走);最后一句后停 1 秒
const T_SLIDE = 1.1, T_MOSAIC = 2.8, T_SUB_HOLD = 2.8;           // 两人滑到中间 / 碎片拼页 / 字幕停留
let rpsPhase = "count", rpsT = 0, pendingBoth = null;            // 猜拳的小阶段;对面的手先到了就先存着
let dlgLine = -1, dlgLineT = 0, dlgAudio = null, dlgAudioEnded = true, dlgDone = false, dlgDoneT = 0;
let mergeT = 0, mergeBuf = null, mBlocksOff = [], mBlocksOn = [];
// ---- 11-02 音效(他测:拼页和连环画都没声音):拼页每落一块一声小滴答、连环画四张各一个上行音。浏览器自带合成,不用音频文件。
let sfxCtx = null, sfxLastTick = 0, stripPlayed = 0;
function sfxCtxGet() { try { if (!sfxCtx) sfxCtx = new (window.AudioContext || window.webkitAudioContext)(); if (sfxCtx.state === "suspended") sfxCtx.resume(); return sfxCtx; } catch (e) { return null; } }
function sfxNote(freq, dur, vol, type) {
  const c = sfxCtxGet(); if (!c) return; const o = c.createOscillator(), gn = c.createGain(), t = c.currentTime;
  o.type = type || "sine"; o.frequency.value = freq;
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn); gn.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
const SFX_PENTA = [523.25, 587.33, 659.25, 783.99, 880.0];
function sfxTick() { if (millis() - sfxLastTick < 55) return; sfxLastTick = millis(); sfxNote(random(SFX_PENTA) * (random() < 0.4 ? 2 : 1), 0.14, 0.07, "triangle"); }
function sfxStrip(i) { sfxNote([523.25, 659.25, 783.99, 1046.5][i % 4], 1.0, 0.16, "sine"); sfxNote([523.25, 659.25, 783.99, 1046.5][i % 4] * 2, 0.5, 0.04, "sine"); }
const MB = 60, MW = 960, MH = 540;                               // 拼页用 960x540 的缓冲,60px 一块 = 16x9 块

// ---- 这一轮的信息 ----
const roundInfo = () => (lines.rounds && lines.rounds[round - 1]) || { title: "", note: "" };
const lastH = () => history[history.length - 1];
const sceneData = n => (lines.scenes && lines.scenes[String(n)]) || { lines: [], sub: "" };
function rpsOutcome(m, f) {                                       // 男孩的手 对 女孩的手:0 他赢 / 1 平 / 2 她赢
  if (m === f) return 1; const beats = { rock: "scissors", paper: "rock", scissors: "paper" }; return beats[m] === f ? 0 : 2;
}
function startRps() {
  gestNow = null; state = "rps"; rpsPhase = "count"; rpsT = millis(); myChoice = null; partnerChoice = null; sent = false; partnerSent = false; pendingBoth = null;
}
function sendChoice() {                                           // 我出了手:单机直接记下;联机发给服务器,等它回 both
  if (!myChoice || sent) return; sent = true;
  if (socket) socket.emit("choose", { round, emo: myChoice });
}
function settleRps(m, f) {                                        // 两只手都到了:算结果 → 这一轮是哪一页 → 两人的心情
  const out = rpsOutcome(m, f), scene = BOOK_SPREADS[round - 1][out];
  const feel = out === 0 ? { m: "smile", f: "cry" } : out === 2 ? { m: "down", f: "smile" } : { m: "calm", f: "calm" };
  myChoice = role === "m" ? m : f; partnerChoice = role === "m" ? f : m;
  history.push({ m: feel.m, f: feel.f, rps: { m, f }, out, scene, kept: true });
  rpsPhase = "show"; rpsT = millis();
}
function rpsFrames() {                                             // 左右两个摄像头框
  const top = 58, h = min(contentH() * 0.46, (width - 200) / 2 * 9 / 16), w = h * 16 / 9;
  return [{ x: width / 2 - w - 60, y: top, w, h }, { x: width / 2 + 60, y: top, w, h }];
}
function rpsIconRects() {                                          // 框下面三只手(鼠标/键盘用;ml5 接上后它们只是说明)
  const f = rpsFrames()[0], s = min(64, f.h * 0.3), gap = 26, y = f.y + f.h + 44;
  return RPS.map((k, i) => ({ k, x: width / 2 - (3 * s + 2 * gap) / 2 + i * (s + gap), y, s }));
}
function frameBox(g, b, strong) {
  g.noFill(); g.stroke(255, strong ? 110 : 60); g.strokeWeight(1); g.rect(b.x, b.y, b.w, b.h);
  g.stroke(255, strong ? 230 : 140); g.strokeWeight(3); const L = 22;
  for (const [cx, cy, sx, sy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) { g.line(cx, cy, cx + sx * L, cy); g.line(cx, cy, cx, cy + sy * L); }
}
function drawRps(g) {
  g.background(0);
  const live = state === "rps" && !trans, sec = live ? (millis() - rpsT) / 1000 / FAST : 0;   // 11-02:过场淡入期间倒数不跑(之前 321 在过场里先跑一遍再重来,像残影)
  const [fl, fr] = rpsFrames(), R = lines.rps || {};
  // 标题:第几页 · 这轮的名字
  g.push(); g.textFont(FONT_ADULT); g.noStroke(); g.fill(190); g.textAlign(CENTER, CENTER); g.textSize(max(15, min(22, width / 56)));
  g.text(`Page ${round} \u00b7 ${roundInfo().title}`, width / 2, 30); g.pop();
  frameBox(g, fl, true); frameBox(g, fr, partnerSent || rpsPhase === "show");
  g.noStroke(); g.fill(150); g.textAlign(CENTER, CENTER); g.textSize(13);
  g.text(R.you || "you", fl.x + fl.w / 2, fl.y + fl.h + 16); g.text(R.other || "the other person", fr.x + fr.w / 2, fr.y + fr.h + 16);
  const showHand = (b, hand, dim) => { if (!hand) return; const s = b.h * 0.62; g.push(); g.imageMode(CENTER); g.tint(255, dim ? 90 : 255); g.image(gestures[RPS_ICON[hand]], b.x + b.w / 2, b.y + b.h / 2 - 8, s, s); g.noTint(); g.pop();
    g.noStroke(); g.fill(dim ? 110 : 220); g.textSize(14); g.text(R[hand] || hand, b.x + b.w / 2, b.y + b.h - 18); };
  if (rpsPhase === "count") {
    const n = ceil(T_COUNT - sec), deadline = T_COUNT + T_HAND_WAIT();
    g.noStroke(); g.fill(60); g.textSize(14); g.text(mlMsg, fl.x + fl.w / 2, fl.y + 24); g.text("camera", fr.x + fr.w / 2, fr.y + 24);
    showHand(fl, myChoice, false);
    if (CAM) {                                                   // 10-31 ml5:左框画关节点;手势稳住 0.6 秒 = 出手(键盘 1 2 3 仍可用)
      drawHandDots(g, fl);
      if (live && !myChoice) { const gs = gestureStable(); if (gs && n <= 0) { myChoice = gs; sendChoice(); } else if (gestNow) { g.noStroke(); g.fill(160); g.textSize(13); g.text(R[gestNow] || gestNow, fl.x + fl.w / 2, fl.y + fl.h - 18); } }   // 11-02:321 期间只显示认成什么,数完才锁
    }
    if (partnerSent) { g.fill(140); g.textSize(14); g.text("ready", fr.x + fr.w / 2, fr.y + fr.h / 2); }
    g.push(); g.textFont(FONT_ADULT); g.noStroke(); g.fill(255, 220, 150); g.textAlign(CENTER, CENTER); g.textSize(min(96, fl.h * 0.6));
    if (live) g.text(n > 0 ? n : (myChoice ? "" : (R.showhand || "show your hand")), width / 2, fl.y + fl.h / 2); g.pop();
    if (live && CAM && n > 0 && !myChoice) { g.noStroke(); g.fill(150); g.textSize(14); g.text(R.ready || "get your hand ready", width / 2, fl.y + fl.h / 2 + 50); }
    if (CAM && n <= 0 && !myChoice && !hands.length) { g.noStroke(); g.fill(255, 120, 100); g.textSize(14); g.text("no hand seen - put your hand in front of the camera", width / 2, fl.y + fl.h / 2 + 50); }
    if (live && sec >= deadline) {                                 // 倒数完:还没出手就随便出一只(单机对面也随机)
      if (!myChoice) { myChoice = random(RPS); sendChoice(); }
      if (SOLO) { const other_ = random(RPS); settleRps(role === "m" ? myChoice : other_, role === "m" ? other_ : myChoice); }
      else if (pendingBoth) { settleRps(pendingBoth.m, pendingBoth.f); }
    }
  } else {                                                         // show:两只手亮出来 + 中间结果字
    const h = lastH(); showHand(fl, myChoice, false); showHand(fr, partnerChoice, false);
    const mine = role === "m" ? (h.out === 0) : (h.out === 2), txt = h.out === 1 ? (R.draw || "A draw.") : mine ? (R.win || "You won.") : (R.lose || "You lost.");
    g.push(); g.textFont(FONT_ADULT); g.noStroke(); g.fill(255, 220, 150); g.textAlign(CENTER, CENTER); g.textSize(min(40, fl.h * 0.26));
    g.text(txt, width / 2, fl.y + fl.h / 2); g.pop();
    if (live && sec >= T_RPS_SHOW) { dlgLine = -1; dlgDone = false; startTrans(drawRps, drawDialog, "dialog"); }   // 扭进来之前先清掉上一轮的气泡(残留 bug,10-30)
  }
  // 三只手的小图(点一下也能出手)
  hoverIcon = -1;
  for (const [i, r] of rpsIconRects().entries()) {
    const over = live && rpsPhase === "count" && !myChoice && mouseX > r.x && mouseX < r.x + r.s && mouseY > r.y && mouseY < r.y + r.s;
    if (over) hoverIcon = i;
    g.push(); g.imageMode(CORNER); g.tint(255, myChoice === r.k ? 255 : over ? 200 : 120); g.image(gestures[RPS_ICON[r.k]], r.x, r.y, r.s, r.s); g.noTint(); g.pop();
    g.noStroke(); g.fill(myChoice === r.k ? 230 : 110); g.textAlign(CENTER, CENTER); g.textSize(12); g.text(`${R[r.k] || r.k} \u00b7 ${i + 1}`, r.x + r.s / 2, r.y + r.s + 12);
  }
  bandFont = FONT_ADULT;
  let small = R.small || ""; if (rpsPhase === "count" && myChoice && !SOLO && !pendingBoth) small = R.waiting || "waiting for the other hand...";
  if (roundInfo().note) small = roundInfo().note + "   \u00b7   " + small;
  drawBand(g, R.band || "Rock, paper, scissors \u2014", small);
}

// ---- 舞台 + 气泡 ----
function stageRect() { return { x: 0, y: 44, w: width, h: contentH() * 0.56 }; }
function drawStage(g, k, alpha) {                                   // k=0 两人分开站;k=1 滑到中间。alpha 整体透明度
  const st = stageRect(), h = lastH(), s = st.h * 0.96, cy = st.y + st.h / 2;
  const gapX = lerp(width * 0.21, s * 0.2, k);
  const spk = (!dlgDone && dlgLine >= 0 && sceneData(h.scene).lines[dlgLine]) ? sceneData(h.scene).lines[dlgLine].who : null;
  g.push(); g.imageMode(CENTER);
  for (const [r, x] of [["m", width / 2 - gapX], ["f", width / 2 + gapX]]) {
    const dim = spk && spk !== r; g.tint(255, (dim ? 120 : 255) * alpha);
    g.image(acts[r][h[r]], x, cy, s, s);
  }
  g.noTint(); g.pop();
}
function bubbleAvatar(g, who, x, y, d) {                            // 小头像:圆形里放脸
  const h = lastH(), img = faces[who][h[who]];
  g.push(); g.drawingContext.save(); g.drawingContext.beginPath(); g.drawingContext.arc(x, y, d / 2, 0, TWO_PI); g.drawingContext.clip();
  g.noStroke(); g.fill(20); g.circle(x, y, d); g.imageMode(CENTER); g.image(img, x, y + d * 0.06, d * 1.1, d * 1.1); g.drawingContext.restore();
  g.noFill(); g.stroke(255, 160); g.strokeWeight(1.2); g.circle(x, y, d); g.pop();
}
function drawBubbles(g, alpha) {
  const st = stageRect(), top = st.y + st.h + 14, bottom = contentH() - 8, rows = 3, rh = (bottom - top) / rows;
  const L = sceneData(lastH().scene).lines, d = min(50, rh * 0.7);
  g.push(); g.textFont(FONT_CHILD); const ts = max(15, min(20, width / 64)); g.textSize(ts);
  if (dlgLine < 0) { g.pop(); return; }                               // 对话还没开始(过场中)不画任何气泡
  for (let i = 0; i <= dlgLine && i < L.length; i++) {
    const ln = L[i], y = top + i * rh + rh / 2, left = ln.who === "m";        // 他在左、她在右(和舞台上的位置一致)
    const a = alpha * (i === dlgLine && !dlgDone ? 1 : 0.62);
    const tw = min(width * 0.5, g.textWidth(ln.en) + 34), bh = min(rh - 8, ts * 2.1);
    const ax = left ? 70 : width - 70, bx = left ? ax + d / 2 + 16 : ax - d / 2 - 16 - tw;
    bubbleAvatar(g, ln.who, ax, y, d);
    g.noStroke(); g.fill(0); g.rect(bx, y - bh / 2, tw, bh, 8); g.noFill(); g.stroke(255, 200 * a); g.strokeWeight(1.3); g.rect(bx, y - bh / 2, tw, bh, 8);
    g.noStroke(); g.fill(240, 255 * a); g.textAlign(CENTER, CENTER); g.text(ln.en, bx + tw / 2, y);
  }
  g.pop();
}
function startDialog() { dlgLine = -1; dlgDone = false; dlgAudioEnded = true; nextLine(); }
function nextLine() {
  const L = sceneData(lastH().scene).lines; dlgLine++;
  if (dlgAudio) { try { dlgAudio.pause(); } catch (e) {} dlgAudio = null; }
  if (dlgLine >= L.length) { dlgDone = true; dlgDoneT = millis(); return; }
  dlgLineT = millis(); const f = L[dlgLine].voice; dlgAudioEnded = !f;
  if (f) { dlgAudio = new Audio(src("assets/voice/" + f)); dlgAudio.onended = () => { dlgAudioEnded = true; }; const pr = dlgAudio.play(); if (pr && pr.catch) pr.catch(() => { dlgAudioEnded = true; }); }
}
function drawDialog(g) {
  g.background(0);
  const live = state === "dialog" && !trans;
  drawStage(g, 0, 1); drawBubbles(g, 1);
  if (live) {
    const sec = (millis() - dlgLineT) / 1000 / FAST;
    if (!dlgDone && ((dlgAudioEnded && sec >= T_LINE_MIN) || sec >= T_LINE_MAX)) nextLine();
    if (dlgDone && (millis() - dlgDoneT) / 1000 / FAST >= T_DLG_HOLD) { startMerge(); }
  }
  bandFont = FONT_CHILD; drawBand(g, "", `page ${round} of ${ROUNDS}`);
}

// ---- 两人滑到中间 → 碎片拼成这一页 → 字幕 ----
function startMerge() {
  state = "merge"; mergeT = millis(); mergeBuf.clear();
  const n = (MW / MB) * (MH / MB); mBlocksOff = shuffle([...Array(n).keys()]); mBlocksOn = [];
}
function pageRect() { const w = min(width - 80, (contentH() - 40) * 16 / 9), h = w * 9 / 16; return { x: (width - w) / 2, y: 20 + (contentH() - 20 - h) / 2, w, h }; }
const T_DISSOLVE = 1.1, T_GAP = 0.3;                               // 两人扭曲消失 1.4 秒,黑 0.4 秒,再拼页(他定的:先消失完再出现,别同时)
function drawMerge(g) {
  g.background(0);
  const live = state === "merge" && !trans, sec = (millis() - mergeT) / 1000 / FAST, img = bookImgs[lastH().scene];
  const tIn = T_SLIDE + T_DISSOLVE + T_GAP;                       // 碎片从这一刻开始出现
  const m = ease((sec - tIn) / T_MOSAIC);
  if (live && sec > tIn && img) {
    const nx = MW / MB, total = mBlocksOff.length + mBlocksOn.length, want = floor(m * total);
    let added = 0; while (mBlocksOn.length < want && mBlocksOff.length) { const idx = mBlocksOff.pop(); mBlocksOn.push(idx); const bx = (idx % nx) * MB, by = floor(idx / nx) * MB; mergeBuf.image(img, bx, by, MB, MB, bx, by, MB, MB); added++; }
    if (added) sfxTick();
  }
  if (sec < T_SLIDE) drawStage(g, ease(sec / T_SLIDE), 1);        // 1. 滑到中间
  else if (sec < T_SLIDE + T_DISSOLVE) {                          // 2. 扭曲着消失(用过场的那个液体 shader)
    const k = ease((sec - T_SLIDE) / T_DISSOLVE);
    scene.background(0); drawStage(scene, 1, 1);
    if (g === this) liquid(scene, k * wobble(sec), 1 - k, sec - T_SLIDE); else { g.push(); g.tint(255, 255 * (1 - k)); g.imageMode(CORNER); g.image(scene, 0, 0); g.pop(); }
  } else if (sec >= tIn) {                                        // 3. 碎片拼出这一页
    const r = pageRect(); g.push(); g.imageMode(CORNER); g.image(mergeBuf, r.x, r.y, r.w, r.h); g.pop();
    if (!img) { g.noStroke(); g.fill(60); g.textAlign(CENTER, CENTER); g.textSize(16); g.text(`page ${lastH().scene} (not painted yet)`, width / 2, r.y + r.h / 2); }
  }
  bandFont = FONT_CHILD;
  const a = constrain((sec - tIn - T_MOSAIC * 0.5) / 1.0, 0, 1); bandAlpha = a;
  drawBand(g, sceneData(lastH().scene).sub || "", `page ${round} of ${ROUNDS}`); bandAlpha = undefined;
  if (live && sec >= tIn + T_MOSAIC + T_SUB_HOLD) advance();
}

function drawFinal() {                                        // 四轮完:四页并排成连环画,然后进大书
  background(0);
  const n = history.length, gap = 18, top = 26;
  const w = min((width - 60 - (n - 1) * gap) / n, (contentH() - top - 80) * 16 / 9), h = w * 9 / 16;
  const x0 = (width - (n * w + (n - 1) * gap)) / 2, y = top + (contentH() - top - 80 - h) / 2;
  const sec = (millis() - stripT) / 1000 / FAST;
  for (let i = 0; i < n; i++) {
    const hh = history[i], img = bookImgs[hh.scene], a = ease((sec - i * T_STRIP) / T_STRIP);
    if (sec >= i * T_STRIP && stripPlayed <= i) { stripPlayed = i + 1; sfxStrip(i); }
    push(); imageMode(CORNER); tint(255, 255 * a); if (img) image(img, x0 + i * (w + gap), y, w, h); noTint(); pop();
    noFill(); stroke(255, 70 * a); strokeWeight(1); rect(x0 + i * (w + gap), y, w, h);
    push(); textFont(FONT_CHILD); noStroke(); fill(220, 255 * a); textAlign(CENTER, TOP); textSize(max(11, min(15, w * 0.045)));
    text(sceneData(hh.scene).sub || "", x0 + i * (w + gap) + 6, y + h + 10, w - 12, 70); pop();
  }
  bandFont = FONT_ADULT;
  drawBand(this, lines.strip || "", `${n} of ${ROUNDS} pages   \u00b7   click to continue`);
  if (sec > n * T_STRIP + T_STRIP_HOLD) bookEnter();
}

// ---------- ending: the library + again (V) / stay ----------
function libraryRects() {
  const gap = 8, top = 24, bottom = 90;
  const s = min((width - 5 * gap) / 4, (contentH() - top - bottom - 3 * gap) / 4);
  const x0 = (width - (4 * s + 3 * gap)) / 2, y0 = top + (contentH() - top - bottom - (4 * s + 3 * gap)) / 2;
  const out = [];
  for (const [i, m] of EMOS.m.entries()) for (const [j, f] of EMOS.f.entries()) out.push({ key: `${m}_${f}`, x: x0 + j * (s + gap), y: y0 + i * (s + gap), s });
  return out;
}
function buttonRects() {
  const s = 64, y = contentH() - s - 14;
  return [{ id: "again", x: width / 2 - s - 30, y, w: s, h: s }, { id: "stay", x: width / 2 + 30, y, w: s, h: s }];
}
function drawEnding() {
  background(0);
  const pulse = 0.75 + 0.25 * sin(millis() * 0.004);
  for (const r of libraryRects()) {
    if (unlocked.has(r.key)) {
      push(); imageMode(CORNER);
      if (newlyLit.has(r.key)) tint(255, 255 * pulse);
      if (colourOn && !pairsColour[r.key]) { const c = FACE_COLOURS[r.key.split("_")[0]]; tint(c[0], c[1], c[2], newlyLit.has(r.key) ? 255 * pulse : 255); }
      image(pairImg(r.key), r.x, r.y, r.s, r.s); noTint(); pop();
      if (newlyLit.has(r.key)) { noFill(); stroke(255, 160 * pulse); strokeWeight(1.5); rect(r.x, r.y, r.s, r.s); }
    } else { noFill(); stroke(255, 40); strokeWeight(1); rect(r.x, r.y, r.s, r.s); }
  }
  hoverBtn = -1;
  for (const [i, b] of buttonRects().entries()) {
    const over = mouseX > b.x && mouseX < b.x + b.w && mouseY > b.y && mouseY < b.y + b.h;
    if (over) hoverBtn = i;
    push(); imageMode(CORNER);
    if (b.id === "again") image(gestures[5], b.x, b.y, b.w, b.h);
    else { noFill(); stroke(255, over ? 220 : 110); strokeWeight(1.5); rect(b.x, b.y, b.w, b.h, 4); noStroke(); fill(over ? 240 : 150); textAlign(CENTER, CENTER); textSize(14); text((lines.stay || "stay"), b.x + b.w / 2, b.y + b.h / 2); }
    if (over) { noFill(); stroke(255, 150); strokeWeight(2); rect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
    pop();
    noStroke(); fill(over ? 230 : 110); textAlign(CENTER, CENTER); textSize(13);
    text(b.id === "again" ? `${lines.again || "again"} · ${GESTURE_NAMES[5]}` : (lines.stay || "stay"), b.x + b.w / 2, b.y + b.h + 12);
  }
  bandFont = FONT_CHILD;
  drawBand(this, lines.ending || "", `${unlocked.size} of 16 pages`);
}

// ---------- liquid transitions ----------
function ease(x) { x = constrain(x, 0, 1); return x * x * (3 - 2 * x); }
function wobble(sec) { return 0.88 + 0.12 * noise(sec * 0.35); }
function startTrans(from, to, next) { trans = { from, to, next, start: millis() }; }
function liquid(tex, amp, alpha, tSec) {
  liquidG.shader(liquidSh);
  liquidSh.setUniform("tex", tex);
  liquidSh.setUniform("t", (tSec !== undefined ? tSec : (millis() - trans.start) / 1000) * (FAST < 1 ? 2.5 : 1));
  liquidSh.setUniform("amp", amp);
  liquidSh.setUniform("aspect", width / height);
  liquidSh.setUniform("keepColour", 1.0);   // 10-30:页面本身是彩色的,过场扭曲时不再去色
  liquidG.rect(0, 0, width, height);
  drawingContext.save(); drawingContext.globalAlpha = alpha === undefined ? 1 : alpha;
  imageMode(CORNER); image(liquidG, 0, 0); drawingContext.restore();
}
function drawTransition() {
  const sec = (millis() - trans.start) / 1000 / FAST;
  trans.from(scene, true);
  if (trans.to) trans.to(scene2, false);
  if (sec < T_OUT) liquid(scene, ease(sec / T_OUT) * wobble(sec), 1);
  else if (!trans.to) { const k = (sec - T_OUT) / T_FADE_BLACK; liquid(scene, 1, 1 - ease(k)); if (k >= 1) finishTrans(); }
  else if (sec < T_OUT + T_SWAP) { const k = (sec - T_OUT) / T_SWAP; liquid(scene, 1, 1); liquid(scene2, 1, ease(k)); }
  else { const k = (sec - T_OUT - T_SWAP) / T_IN; liquid(scene2, (1 - ease(k)) * wobble(sec), 1); if (k >= 1) finishTrans(); }
  if (!trans) { drawCorner(); return; }
  let txt = bandFrom, a = 1 - ease(sec / T_OUT); bandFont = bandFontFrom;
  if (trans.to && sec >= T_OUT + T_SWAP) { txt = bandTo; a = ease((sec - T_OUT - T_SWAP) / T_IN); bandFont = bandFontTo; }
  else if (sec >= T_OUT) { txt = ""; a = 0; }
  bandAlpha = a; drawBand(this, txt, ""); bandAlpha = undefined;
  drawCorner();
}
function finishTrans() {
  const next = trans.next; trans = null; state = next; holdStart = millis();
  if (next === "rps") startRps();
  if (next === "dialog") startDialog();
  if (next === "final") { stripT = millis(); stripPlayed = 0; }
}

// ---------- input ----------
function mousePressed() {
  sfxCtxGet();
  if (paused) return;
  if (state === "opening") { opGesture(); return; }
  if (state === "intro") { introClick(); return; }
  if (trans) return;
  if (state === "rps" && rpsPhase === "count" && hoverIcon >= 0 && !myChoice) { myChoice = RPS[hoverIcon]; sendChoice(); }
  else if (state === "dialog" && !dlgDone) nextLine();                 // 点一下 = 这句跳过
  else if (state === "final") bookEnter();
  else if (state === "ending" && !bookOptionsOn()) bookSkip();
  else if (state === "ending" && bookOptionsOn()) { if (hoverBtn === 0) { if (socket) socket.emit("restart"); bookAgainStart(); } else if (hoverBtn === 1) leaveEnter(); }
  else if (state === "leave") leaveClick();
}
function rpsReset() { gestNow = null; rpsPhase = "count"; rpsT = millis(); myChoice = null; partnerChoice = null; sent = false; partnerSent = false; pendingBoth = null; }
function advance() {                                          // 这一页拼完:下一轮,或四轮完进连环画
  if (round < ROUNDS) { round++; rpsReset(); startTrans(drawMerge, drawRps, "rps"); }
  else startTrans(drawMerge, null, "final");
}
function restart() { leaveReset(); bookStay = false; bookAgainT = 0; if (bookAudio) bookAudio.pause(); round = 1; history = []; myChoice = null; partnerChoice = null; sent = false; partnerSent = false; trans = null; newlyLit = new Set(); startRps(); }
function keyPressed() {
  sfxCtxGet();
  if (state === "leave" && memInp && document.activeElement === memInp.elt) { if (keyCode === ENTER) leaveSend(); return; }   // 11-08:在输入框里打字不触发快捷键
  if (key === "p" || key === "P") { setPaused(!paused); return; }
  if (paused) return;
  if (state === "ending" && !bookOptionsOn() && !bookStay && !bookAgainT && !"rRcC".includes(key)) { bookSkip(); return; }
  if (state === "opening") { opGesture(); return; }
  if (state === "intro") { introClick(); return; }
  if (key === "r" || key === "R") { if (socket) socket.emit("restart"); restart(); }
  if (key === "c" || key === "C") colourOn = !colourOn;
  if (trans) return;
  if (state === "rps" && rpsPhase === "count" && !myChoice && "123".includes(key)) { myChoice = RPS[parseInt(key) - 1]; sendChoice(); }   // 1 石头 2 布 3 剪刀(ml5 接上后由它来设 myChoice)
  if (state === "dialog" && !dlgDone && key === " ") nextLine();
  if (state === "ending" && bookOptionsOn() && key === "6") { if (socket) socket.emit("restart"); bookAgainStart(); }   // V = again
  if (state === "ending" && bookOptionsOn() && key === "2") leaveEnter();                                           // open hand = leave a memory (11-08 v2)
}

// =====================================================================
// OPENING: the picture book (drawn into a 1280x720 buffer, then fitted to the window)
// book flat from above -> one pair appears -> turns to coloured sand -> book tilts, sand pours away
// -> empty -> a hand flips the page -> next pair ... x4 -> three questions -> black -> home
// =====================================================================
const OW = 1280, OH = 720, N_SPREADS = 4;
const BOOK_SCALE = 1.35, BOOK_DY = -40;   // 10-27 partner: the book was too small; drawn 1.35x and a little higher
const T_SHOW = 2.2, T_SAND = 1.8, T_TILT = 2.6, T_EMPTY = 0.5, T_FLIP = 1.1;
const T_SPREAD = T_SHOW + T_SAND + T_TILT + T_EMPTY + T_FLIP;
// fonts: adult handwriting = the viewer now (questions, home prompt); child handwriting = the childhood voice
const FONT_ADULT = "Segoe Script", FONT_CHILD = "Segoe Print";
// placeholders - Yi Han writes the real three questions
const QUESTIONS_DEFAULT = ["Were you happy as a child?", "Are you happy now?", "Would you remember your childhood with a stranger?"];
const QUESTIONS = new Proxy(QUESTIONS_DEFAULT, { get: (d, i) => (lines.questions && lines.questions[i] !== undefined) ? lines.questions[i] : d[i] });
const CREAM = [246, 238, 220], COVER = [62, 48, 38];
// drawn size per picture [left,right] - wide pictures smaller so they stay inside the page (page is 266 wide)
const ITEM_S = [[300, 300], [300, 300], [300, 300], [245, 300]];
let opItems = [], opHand, grains = [], grainSpread = -1, og, pageG, opStart = 0, opDone = false;
// opening music (10-30): Fairytale Waltz (Kevin MacLeod, CC BY), silent lead already cut, fades out at 44 s. Browsers block autoplay until the page
// has been touched once: if blocked, the first click/key starts the music and restarts the opening from 0 instead of skipping it.
let opAudio = null, opAudioBlocked = false;
function opAudioStart() {
  if (state !== "opening") return;
  if (!opAudio) { opAudio = new Audio(src("assets/audio/opening.mp3")); opAudio.preload = "auto"; }
  opAudio.currentTime = 0; opAudio.volume = 1;
  const pr = opAudio.play(); if (pr && pr.catch) pr.then(() => { opAudioBlocked = false; }).catch(() => { opAudioBlocked = true; });
}
function opAudioStop() {   // quick fade on skip
  if (!opAudio || opAudio.paused) return; const a = opAudio; let v = a.volume;
  const id = setInterval(() => { v -= 0.1; if (v <= 0) { a.pause(); clearInterval(id); } else a.volume = v; }, 50);
}

function opPreload() {
  for (let i = 1; i <= N_SPREADS; i++) opItems.push([loadImage(src(`assets/opening/item${i}L.png`)), loadImage(src(`assets/opening/item${i}R.png`))]);
  opHand = loadImage(src("assets/opening/hand.png"));
  bookPreload();
}
function opSetup() {
  og = createGraphics(OW, OH); og.pixelDensity(1); og.noStroke(); og.textFont("Microsoft YaHei");
  pageG = createGraphics(560, 560); pageG.pixelDensity(1);
  opStart = millis(); opAudioStart();
}
function opNow() { return (millis() - opStart) / 1000 / FAST; }
function opSkip() { if (!opDone) { opDone = true; opAudioStop(); startIntro(); } }
function opGesture() { if (opAudioBlocked) { opAudioBlocked = false; opStart = millis(); opAudioStart(); } else opSkip(); }   // first touch while blocked = start music + restart, not skip
function opEase(x) { return x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2; }

const T_OP_MUSIC_END = 4 * (2.2 + 1.8 + 2.6 + 0.5 + 1.1) + 8.4;   // 41.2 s:书开始化沙,音乐在这里 1.5 秒淡掉(他定的:沙那一段不要音乐)
function opDraw() {
  og.background(0);
  const t = opNow();
  if (opAudio && !opAudio.paused && t >= T_OP_MUSIC_END) { const v = max(0, 1 - (t - T_OP_MUSIC_END) / 1.5); opAudio.volume = v; if (v <= 0) opAudio.pause(); }
  const idx = floor(t / T_SPREAD);
  if (idx >= N_SPREADS) {
    const qt = t - N_SPREADS * T_SPREAD;
    opQuestions(qt);
    if (qt > T_Q_TOTAL) opSkip();
  } else {
    const lt = t - idx * T_SPREAD;
    let phase, pt;
    if (lt < T_SHOW) { phase = "show"; pt = lt / T_SHOW; }
    else if (lt < T_SHOW + T_SAND) { phase = "sand"; pt = (lt - T_SHOW) / T_SAND; }
    else if (lt < T_SHOW + T_SAND + T_TILT) { phase = "tilt"; pt = (lt - T_SHOW - T_SAND) / T_TILT; }
    else if (lt < T_SHOW + T_SAND + T_TILT + T_EMPTY) { phase = "empty"; pt = (lt - T_SHOW - T_SAND - T_TILT) / T_EMPTY; }
    else { phase = "flip"; pt = (lt - T_SHOW - T_SAND - T_TILT - T_EMPTY) / T_FLIP; }
    let tilt = 0;
    if (phase === "tilt") tilt = opEase(min(1, pt * 1.6));
    if (phase === "empty") tilt = 1 - opEase(pt);
    pageG.clear();
    drawBookFlat(pageG, idx, phase, pt);
    projectBook(pageG, tilt);
    if (phase === "sand" && grainSpread !== idx) makeGrains(idx);
    if (phase === "sand" || phase === "tilt") updateAndDrawGrains(phase, pt, tilt);
    if (phase === "flip") drawHandFlip(pt);
  }
  // fit the 1280x720 picture into the window
  const k = min(width / OW, height / OH), dw = OW * k, dh = OH * k;
  imageMode(CORNER); image(og, (width - dw) / 2, (height - dh) / 2, dw, dh);
  if (idx >= N_SPREADS) opQuestionBand(t - N_SPREADS * T_SPREAD);
  noStroke(); fill(60); textAlign(RIGHT, BOTTOM); textSize(12); text("click or press any key to skip", width - 12, height - 8);
}
function drawBookFlat(g, idx, phase, pt) {
  const y0 = 90, h = 380, half = 280;
  g.noStroke();
  g.fill(...COVER); g.rect(0, y0 - 14, 560, h + 28, 10);
  g.fill(...CREAM); g.rect(10, y0, half - 14, h, 6); g.rect(half + 4, y0, half - 14, h, 6);
  for (let i = 0; i < 14; i++) { const a = 60 - i * 4; g.fill(CREAM[0] - a, CREAM[1] - a, CREAM[2] - a); g.rect(half - 4 - i, y0, 1, h); g.rect(half + 4 + i, y0, 1, h); }
  // first spread fades in as the book opens; later spreads are already printed on the page (they arrived with the flip)
  const show = phase === "show" ? (idx === 0 ? opEase(pt) : 1) : (phase === "sand" ? max(0, 1 - pt * 3) : 0);
  if (show > 0 && phase !== "flip" && phase !== "empty") {
    g.push(); g.tint(255, 255 * show);
    const sL = ITEM_S[idx][0] * (0.9 + 0.1 * show), sR = ITEM_S[idx][1] * (0.9 + 0.1 * show);
    g.image(opItems[idx][0], 10 + (half - 14) / 2 - sL / 2, y0 + h / 2 - sL / 2, sL, sL);
    g.image(opItems[idx][1], half + 4 + (half - 14) / 2 - sR / 2, y0 + h / 2 - sR / 2, sR, sR);
    g.pop();
  }
  if (phase === "flip") {
    const next = idx + 1, last = next >= N_SPREADS;   // after the last spread the pages turn blank (questions come next)
    const k = opEase(pt);
    // 10-27 (supersedes 10-26): like a real book, the next spread is already printed on the pages -
    // the right picture is revealed under the turning leaf, the left picture rides on the back of the leaf
    const pw = half - 14, wq = pw * abs(cos(k * PI));
    const sR = last ? 0 : ITEM_S[next][1], sL2 = last ? 0 : ITEM_S[next][0];
    if (!last) g.image(opItems[next][1], half + 4 + pw / 2 - sR / 2, y0 + h / 2 - sR / 2, sR, sR);   // new right page, under the leaf
    const sh = 18 * sin(k * PI); g.fill(CREAM[0] - sh, CREAM[1] - sh, CREAM[2] - sh);
    if (k < 0.5) g.rect(half + 4, y0, wq, h, 6);                    // front of the leaf (old, now blank) lifting
    else {                                                          // back of the leaf = new left page, landing
      const lx = half - 4 - wq; g.rect(lx, y0, wq, h, 6);
      const sx = wq / pw; if (!last) g.image(opItems[next][0], lx + (wq - sL2 * sx) / 2, y0 + h / 2 - sL2 / 2, sL2 * sx, sL2);
    }
    g.fill(0, 40 * sin(k * PI)); g.rect(half - 4 - wq * (k >= 0.5), y0, wq + 8, h);
  }
}
function projectBook(g, tilt, alpha) {
  if (alpha !== undefined && alpha <= 0) return;
  if (alpha !== undefined) { og.push(); og.tint(255, 255 * alpha); }
  const strips = 24, sh = 560 / strips, S = BOOK_SCALE;
  const squash = 1 - 0.55 * tilt, yOff = 70 * tilt * S;
  for (let i = 0; i < strips; i++) {
    const f = i / (strips - 1);
    const scaleX = 1 - 0.28 * tilt * (1 - f);
    const sw = 560 * scaleX * S;
    const dy = (OH / 2 + BOOK_DY - 280 * squash * S) + i * sh * squash * S + yOff;
    og.image(g, OW / 2 - sw / 2, dy, sw, sh * squash * S + 1, 0, i * sh, 560, sh);
  }
  if (alpha !== undefined) og.pop();
}
function mapPt(px, py, tilt) {
  const S = BOOK_SCALE, squash = 1 - 0.55 * tilt, yOff = 70 * tilt * S, f = py / 560;
  const scaleX = 1 - 0.28 * tilt * (1 - f);
  return { x: OW / 2 + (px - 280) * scaleX * S, y: (OH / 2 + BOOK_DY - 280 * squash * S) + py * squash * S + yOff };
}
function makeGrains(idx) {
  grains = []; grainSpread = idx;
  const y0 = 90, h = 380, half = 280;
  for (let side = 0; side < 2; side++) {
    const img = opItems[idx][side]; img.loadPixels(); const s = ITEM_S[idx][side];
    const ox = side === 0 ? 10 + (half - 14) / 2 - s / 2 : half + 4 + (half - 14) / 2 - s / 2, oy = y0 + h / 2 - s / 2;
    let tries = 0;
    while (grains.length < (side + 1) * 2600 && tries++ < 40000) {
      const u = floor(random(img.width)), v = floor(random(img.height));
      const i = 4 * (v * img.width + u);
      const ca = img.pixels[i + 3];
      if (ca < 100) continue;                                  // transparent paper: no grain
      grains.push({ x: ox + u * s / img.width, y: oy + v * s / img.height, vx: 0, vy: 0, c: [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]], d: random(2.2, 4), j: random(1000) });
    }
  }
}
function makeBookGrains() {
  grains = []; grainSpread = -2;
  pageG.loadPixels();
  const W = pageG.width, Hh = pageG.height;
  let tries = 0;
  while (grains.length < 9000 && tries++ < 120000) {
    const u = floor(random(W)), v = floor(random(Hh));
    const i = 4 * (v * W + u);
    if (pageG.pixels[i + 3] < 100) continue;
    grains.push({ x: u, y: v, vx: 0, vy: 0, c: [pageG.pixels[i], pageG.pixels[i + 1], pageG.pixels[i + 2]], d: random(2.4, 4.4), j: random(1000) });
  }
}
let lastSimT = -1;
function updateAndDrawGrains(phase, pt, tilt) {
  const tn = opNow(); const dt = lastSimT < 0 ? 1 / 60 : constrain(tn - lastSimT, 0, 0.06); lastSimT = tn;
  og.noStroke();
  for (const gr of grains) {
    if (phase === "sand") {
      const k = opEase(pt);
      gr.x += (noise(gr.j, pt * 2) - 0.5) * 2.2 * k;
      gr.y += (noise(gr.j + 50, pt * 2) - 0.5) * 2.2 * k + 0.25 * k;
    } else {
      const g = 1400 * tilt;
      gr.vy += g * dt; gr.vx += (noise(gr.j, pt * 3) - 0.5) * 60 * dt;
      gr.x += gr.vx * dt; gr.y += gr.vy * dt;
      if (gr.y > 470) gr.vy += 2500 * dt;
    }
    const p = mapPt(gr.x, gr.y, tilt);
    if (p.y > OH + 10) continue;
    const alpha = gr.y > 470 ? max(0, 255 - (gr.y - 470) * 1.1) : 255;
    og.fill(gr.c[0], gr.c[1], gr.c[2], alpha); og.circle(p.x, p.y, gr.d * BOOK_SCALE);
  }
}
function drawHandFlip(pt) {
  const k = pt;
  const x = lerp(OW + 120, OW / 2 - 260 * BOOK_SCALE, opEase(min(1, k * 1.25)));
  const y = OH / 2 + BOOK_DY + 40 * BOOK_SCALE + sin(k * PI) * -30;
  const a = k > 0.85 ? 255 * (1 - (k - 0.85) / 0.15) : 255;
  og.push(); og.tint(255, a); og.imageMode(CENTER); og.image(opHand, x, y, 150, 150); og.pop();
}
const T_Q = [0, 2.2, 4.4], T_Q_HOLD = 4.0;                 // third question stays 4 s
const T_Q_FADE = T_Q[2] + T_Q_HOLD;                          // 8.4: book starts turning into sand
const T_BSAND = 1.6, T_BTILT = 2.6, T_BEND = 0.6;             // sand jitter, stand up + flow, black
const T_Q_TOTAL = T_Q_FADE + T_BSAND + T_BTILT + T_BEND;
function opQuestions(t) {
  pageG.clear(); drawBookFlat(pageG, N_SPREADS - 1, "empty", 1);
  if (t >= T_Q_FADE) { opBookToSand(t - T_Q_FADE); return; }
  projectBook(pageG, 0);
  // page centres in og space (flat book, tilt 0): left page x = 10..276, right page x = 284..550, y = 90..470
  const L = mapPt(10 + 133, 280, 0), R = mapPt(284 + 133, 280, 0), PW = 230 * BOOK_SCALE, PH = 300 * BOOK_SCALE;
  og.push(); og.textFont(FONT_ADULT); og.textAlign(CENTER, CENTER); og.textSize(30 * BOOK_SCALE); og.textLeading(40 * BOOK_SCALE);
  for (let i = 0; i < 2; i++) {
    const a = constrain((t - T_Q[i]) / 0.8, 0, 1);
    if (a <= 0) continue;
    const c = i === 0 ? L : R;
    og.fill(60, 50, 40, 255 * a);
    og.text(QUESTIONS[i], c.x - PW / 2, c.y - PH / 2, PW, PH);
  }
  og.pop();
}
// the book (cover, pages, ink) becomes three colours of sand, stands up like the pictures did, and flows away
function opBookToSand(bt) {
  if (bt < T_BSAND) {
    // draw the questions once more into pageG so the ink becomes sand too
    const L = { x: 10 + 133, y: 280 }, R = { x: 284 + 133, y: 280 }, PW = 230, PH = 300;
    pageG.push(); pageG.textFont(FONT_ADULT); pageG.textAlign(CENTER, CENTER); pageG.textSize(30); pageG.textLeading(40); pageG.fill(60, 50, 40);
    pageG.text(QUESTIONS[0], L.x - PW / 2, L.y - PH / 2, PW, PH); pageG.text(QUESTIONS[1], R.x - PW / 2, R.y - PH / 2, PW, PH);
    pageG.pop();
    if (grainSpread !== -2) makeBookGrains();
    const pt = bt / T_BSAND;
    projectBook(pageG, 0, max(0, 1 - pt * 2.5));
    updateAndDrawGrains("sand", pt, 0);
  } else if (bt < T_BSAND + T_BTILT) {
    const pt = (bt - T_BSAND) / T_BTILT;
    updateAndDrawGrains("tilt", pt, opEase(min(1, pt * 1.6)));
  } else {
    og.background(0);
  }
}
// third question: pops in the dialogue band (same band the main flow uses), drawn on the real canvas
function opQuestionBand(t) {
  const a = constrain((t - T_Q[2]) / 0.8, 0, 1) * (1 - constrain((t - T_Q_FADE) / 1.0, 0, 1));
  if (a <= 0) return;
  bandAlpha = a; bandFont = FONT_ADULT; drawBand(window, QUESTIONS[2], ""); bandAlpha = undefined;
}

// ---------- shader: liquid memory ----------
const LIQUID_VS = `
precision mediump float;
attribute vec3 aPosition; attribute vec2 aTexCoord;
varying vec2 vUv;
void main() { vUv = aTexCoord; vec4 p = vec4(aPosition, 1.0); p.xy = p.xy * 2.0 - 1.0; gl_Position = p; }`;
const LIQUID_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tex; uniform float t; uniform float amp; uniform float aspect; uniform float keepColour;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.1 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = vec2(uv.x * aspect, uv.y) * 2.0;
  vec2 q = vec2(fbm(p + vec2(t * 0.10, t * 0.04)), fbm(p + vec2(5.2, 1.3) + vec2(-t * 0.06, t * 0.09)));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.05), fbm(p + 4.0 * q + vec2(8.3, 2.8) + vec2(t * 0.04, -t * 0.07)));
  vec2 d = (r - 0.5) * amp * 0.5;
  vec4 c = texture2D(tex, clamp(uv + d, 0.0, 1.0));
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(vec3(g), c.rgb, keepColour), 1.0);
}`;


// ---------- ending (10-30): the big book - 4 spreads (one per round), 3 slots each (he wins / draw / she wins), the page they made is printed,
// the other two stay empty frames. Flips 1->2->3->4 then back to 1, 2 s per spread; then two choices: again (V) / stay (open hand).
const BOOK_SPREADS = [[1, 2, 3], [4, 5, 6], [10, 11, 12], [7, 8, 9]];   // scene numbers per round: summer / blackout / picnic / moving (round order per the 10-30 script)
const T_BK_HOLD = 1.4, T_BK_FLIP = 0.8, T_BK_OPT = 0.6;   // 11-03:搭档说翻书有点长,稍微加快(整轮 18 s -> 15 s)
const BOOK_SAMPLE = [{ m: "smile", f: "cry", out: 0, scene: 1, kept: true }, { m: "calm", f: "calm", out: 1, scene: 5, kept: true }, { m: "smile", f: "cry", out: 0, scene: 10, kept: true }, { m: "down", f: "smile", out: 2, scene: 9, kept: true }];
let bookImgs = {}, bookStay = false, bookStayT = 0, bookAgainT = 0, bookAudio = null, pagesLit = new Set();
const T_BK_AGAIN = 3.0;   // again: music fades, screen fades to black, 3 s of silence, then back to the choosing screen (not the 46 s opening)
function bookEnter() {
  gestNow = null; state = "ending"; holdStart = millis(); bookStay = false; bookAgainT = 0;
  for (let i = 0; i < BOOK_SPREADS.length; i++) { const o = bookOutcome(i); if (o >= 0) pagesLit.add(BOOK_SPREADS[i][o]); }
  try { localStorage.setItem("p1_pages", JSON.stringify([...pagesLit])); } catch (e) {}
  if (!bookAudio) { bookAudio = new Audio(src("assets/audio/ending.mp3")); bookAudio.loop = true; bookAudio.preload = "auto"; }
  bookAudio.currentTime = 0; bookAudio.volume = 1; const pr = bookAudio.play(); if (pr && pr.catch) pr.catch(() => {});
}
function bookAllLit() { return BOOK_SPREADS.every(sp => sp.every(n => pagesLit.has(n))); }
function bookAgainStart() {
  if (bookAgainT) return; bookAgainT = millis();
  if (bookAudio && !bookAudio.paused) { const a = bookAudio; let v = a.volume; const id = setInterval(() => { v -= 0.05; if (v <= 0) { a.pause(); clearInterval(id); } else a.volume = v; }, 50); }
}
function bookPreload() { for (const sp of BOOK_SPREADS) for (const n of sp) { const k = String(n).padStart(2, "0"); loadImage(src(`assets/scenes/${k}.jpg`), img => { bookImgs[n] = img; }, () => { bookImgs[n] = null; }); } }
function bookOutcome(i) {   // 0 he wins / 1 draw / 2 she wins, from the feelings of that round; -1 = round not played
  const h = history[i]; if (!h) return -1;
  if (h.out !== undefined) return h.out;
  if (h.m === "smile" && (h.f === "cry" || h.f === "down")) return 0;
  if (h.f === "smile" && (h.m === "down" || h.m === "cry")) return 2;
  return 1;
}
function bookSeq() { const n = BOOK_SPREADS.length; const fwd = [...Array(n).keys()]; return fwd.concat(fwd.slice(0, -1).reverse()); }   // 0 1 2 3 2 1 0
function bookTotal() { const k = bookSeq().length; return k * T_BK_HOLD + (k - 1) * T_BK_FLIP; }
function bookOptionsOn() { return state === "ending" && !bookStay && !bookAgainT && (millis() - holdStart) / 1000 / FAST >= bookTotal(); }
function bookButtonRects() { const s = 60, y = contentH() - s - 34; return [{ id: "again", x: width / 2 - s - 30, y, w: s, h: s }, { id: "stay", x: width / 2 + 30, y, w: s, h: s }]; }
function bookStayChoose() { bookStay = true; bookStayT = millis(); }
function bookSkip(fromNet) {   // 11-03:翻书时点鼠标/按键 = 直接跳到两个手势(像开场和对话的跳过);联机两边一起跳
  if (state !== "ending" || bookStay || bookAgainT || bookOptionsOn()) return;
  holdStart = millis() - bookTotal() * 1000 * FAST;
  if (!fromNet && socket) socket.emit("bookskip");
}
function bookLayout() {
  const CH = contentH(), top = 34, bottom = 132;
  let pw = (width - 160) / 2, bh = min(pw * 0.96, CH - top - bottom); pw = min(pw, bh / 0.96);
  const x0 = width / 2 - pw, y0 = top + (CH - top - bottom - bh) / 2;
  return { pw, bh, x0, y0 };
}
function bookPage(side, sp, x, w, full) {   // one page: cream paper + its slots (side 0 = left: slot 0 big; side 1 = right: slots 1,2 stacked). w may be squeezed (flip)
  const L = bookLayout(), pw = L.pw, bh = L.bh, y0 = L.y0, sx = w / pw;
  noStroke(); fill(...CREAM); rect(x, y0, w, bh, 5);
  if (sp < 0 || sp >= BOOK_SPREADS.length || w < 4) return;
  const out = bookOutcome(sp), scenes = BOOK_SPREADS[sp];
  const slots = side === 0 ? [[0, pw * 0.82, y0 + bh / 2]] : [[1, pw * 0.74, y0 + bh * 0.28], [2, pw * 0.74, y0 + bh * 0.72]];
  for (const [j, sw0, cy] of slots) {
    const sw = sw0 * sx, sh = sw0 * 9 / 16, cx = x + w / 2;
    const n = scenes[j], img = bookImgs[n], filled = out === j || pagesLit.has(n);
    push(); imageMode(CENTER);
    if (filled && img) image(img, cx, cy, sw, sh);
    else if (filled) { noStroke(); fill(205, 198, 182); rect(cx - sw / 2, cy - sh / 2, sw, sh); fill(120); textAlign(CENTER, CENTER); textSize(13 * sx); text(`page ${n}`, cx, cy); }
    else { noFill(); stroke(0, 0, 0, 70); strokeWeight(1); rect(cx - sw / 2, cy - sh / 2, sw, sh); }
    pop();
  }
}
function drawBook() {
  background(0);
  const L = bookLayout(), pw = L.pw, bh = L.bh, x0 = L.x0, y0 = L.y0;
  const sec = (millis() - holdStart) / 1000 / FAST, seq = bookSeq(), step = T_BK_HOLD + T_BK_FLIP;
  let i = min(floor(sec / step), seq.length - 1), lt = sec - i * step;
  const cur = seq[i], nxt = seq[i + 1], flipping = nxt !== undefined && lt > T_BK_HOLD, k = flipping ? opEase((lt - T_BK_HOLD) / T_BK_FLIP) : 0;
  // cover
  noStroke(); fill(...COVER); rect(x0 - 16, y0 - 16, pw * 2 + 32, bh + 32, 12);
  const spineX = width / 2;
  if (!flipping) { bookPage(0, cur, x0, pw - 3, true); bookPage(1, cur, spineX + 3, pw - 3, true); }
  else {
    const fwd = nxt > cur, wq = (pw - 3) * abs(cos(k * PI));
    if (fwd) {   // right leaf lifts (front = current right page), lands on the left (back = next left page)
      bookPage(0, cur, x0, pw - 3, true); bookPage(1, nxt, spineX + 3, pw - 3, true);
      if (k < 0.5) bookPage(1, cur, spineX + 3, wq, false); else bookPage(0, nxt, spineX - 3 - wq, wq, false);
    } else {     // left leaf lifts (front = current left page), lands on the right (back = next right page)
      bookPage(0, nxt, x0, pw - 3, true); bookPage(1, cur, spineX + 3, pw - 3, true);
      if (k < 0.5) bookPage(0, cur, spineX - 3 - wq, wq, false); else bookPage(1, nxt, spineX + 3, wq, false);
    }
    noStroke(); fill(0, 45 * sin(k * PI)); rect(spineX - 3 - (fwd && k >= 0.5 ? wq : 0) - (!fwd && k < 0.5 ? wq : 0), y0, wq + 6, bh);
  }
  for (let j = 0; j < 12; j++) { const a = 55 - j * 4; noStroke(); fill(CREAM[0] - a, CREAM[1] - a, CREAM[2] - a); rect(spineX - 3 - j, y0, 1, bh); rect(spineX + 2 + j, y0, 1, bh); }
  const shown = flipping && k >= 0.5 ? nxt : cur;
  noStroke(); fill(120); textAlign(CENTER, TOP); textSize(12); text(`${shown * 2 + 1} · ${shown * 2 + 2}`, width / 2, y0 + bh + 26);
  // the two choices
  hoverBtn = -1;
  const optA = bookStay ? max(0, 1 - (millis() - bookStayT) / 1000 / FAST / T_BK_OPT) : (sec >= bookTotal() ? min(1, (sec - bookTotal()) / T_BK_OPT) : 0);
  if (optA > 0) {
    for (const [bi, b] of bookButtonRects().entries()) {
      const over = !bookStay && mouseX > b.x && mouseX < b.x + b.w && mouseY > b.y && mouseY < b.y + b.h;
      if (over) hoverBtn = bi;
      push(); imageMode(CORNER); tint(255, 255 * optA * (over ? 1 : 0.8)); image(gestures[b.id === "again" ? 5 : 1], b.x, b.y, b.w, b.h); noTint();
      if (over) { noFill(); stroke(255, 150 * optA); strokeWeight(2); rect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
      noStroke(); fill(over ? 230 : 120, 255 * optA); textAlign(CENTER, CENTER); textSize(13);
      text(b.id === "again" ? `${lines.again || "again"} · ${GESTURE_NAMES[5]}` : `${lines.leave || "leave a memory"} · ${GESTURE_NAMES[1]}`, b.x + b.w / 2, b.y + b.h + 12); pop();
    }
  }
  bandFont = FONT_CHILD;
  drawBand(this, bookAllLit() ? (lines.endingDone || "The memory is over.") : (lines.ending || ""), "");
  if (bookAgainT) {   // fade to black, hold, then home
    const k = (millis() - bookAgainT) / 1000 / FAST;
    noStroke(); fill(0, 255 * min(1, k / 0.8)); rect(0, 0, width, height);
    if (k >= T_BK_AGAIN) { bookAgainT = 0; restart(); }
  }
}


// =====================================================================
// v2 (2026-11-08, after the 5 November crit): LEAVE YOUR MEMORY
// After the book has flipped through, one page asks the player for one childhood memory of their own.
// It is sent to the server (memories.json) and will become material for the next pages of this story.
// Then: again (V / key 6 / click) = play another round, end (open hand / key 2 / click) = the end page,
// which shows the pages other people left here. The book no longer stays on screen.
// =====================================================================
let memInp = null, memSent = false, memSkipped = false, memFadeT = 0, memOthers = [], memHover = -1, leaveT = 0, memEndT = 0;
const T_LEAVE_FADE = 1.2;
function leaveReset() { memSent = false; memSkipped = false; memFadeT = 0; memEndT = 0; memHover = -1; if (memInp) memInp.hide(); }
function leaveEnter() {
  state = "leave"; leaveT = millis(); leaveReset(); gestNow = null;
  if (bookAudio && !bookAudio.paused) { const a = bookAudio; let v = a.volume; const id = setInterval(() => { v -= 0.04; if (v <= 0) { a.pause(); clearInterval(id); } else a.volume = v; }, 60); }
  if (!memInp) {
    memInp = createInput(""); memInp.attribute("maxlength", "140");
    memInp.style("font-family", FONT_CHILD); memInp.style("font-size", "18px"); memInp.style("padding", "8px 12px");
    memInp.style("border", "none"); memInp.style("border-radius", "6px"); memInp.style("outline", "none");
    memInp.style("background", `rgb(${CREAM[0]},${CREAM[1]},${CREAM[2]})`); memInp.style("color", `rgb(${COVER[0]},${COVER[1]},${COVER[2]})`);
    memInp.style("box-sizing", "border-box");
  }
  memInp.attribute("placeholder", lines.leaveHint || "one sentence is enough");
  memInp.value(""); memInp.show(); setTimeout(() => { if (state === "leave" && memInp) memInp.elt.focus(); }, 400);
  fetch("memories").then(r => r.json()).then(j => { memOthers = j.memories || []; }).catch(() => {});
}
function leaveRects() {
  const w = min(520, width * 0.6), x = width / 2 - w / 2, y = height * 0.46;
  const s = 60, by = height * 0.58;
  return { box: { x, y, w, h: 40 }, send: { x: width / 2 - 60, y: y + 60, w: 120, h: 36 }, skip: { x: width / 2 - 40, y: y + 110, w: 80, h: 24 },
           again: { x: width / 2 - s - 30, y: by, w: s, h: s }, end: { x: width / 2 + 30, y: by, w: s, h: s } };
}
const overRect = b => mouseX > b.x && mouseX < b.x + b.w && mouseY > b.y && mouseY < b.y + b.h;
function leaveSend() {
  if (memSent) return;
  const t = memInp.value().replace(/\s+/g, " ").trim(); if (!t) return;
  memSent = true; memInp.hide(); gestNow = null;
  setTimeout(() => { if (state === "leave") endEnter(); }, 2600 * FAST);
  fetch("memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, room: Q.get("room") || "", role }) }).catch(() => {});
  memOthers.unshift(t);
}
function leaveSkip() { if (memSent) return; memSent = true; memSkipped = true; memInp.hide(); gestNow = null; setTimeout(() => { if (state === "leave") endEnter(); }, 1500 * FAST); }
function leaveClick() {
  const R = leaveRects();
  if (!memSent) { if (overRect(R.send)) leaveSend(); else if (overRect(R.skip)) leaveSkip(); return; }
  if (memFadeT) return;
  if (overRect(R.again)) leaveAgain(); else if (overRect(R.end)) endEnter();
}
function leaveAgain() { if (memFadeT) return; memFadeT = millis(); if (socket) socket.emit("restart"); }
function endEnter() { state = "end"; memEndT = millis(); if (memInp) memInp.hide(); gestNow = null; }
function drawLeave() {
  background(0);
  const k = min(1, (millis() - leaveT) / 1000 / FAST / T_LEAVE_FADE), R = leaveRects();
  push(); textFont(FONT_CHILD); textAlign(CENTER, CENTER); noStroke();
  fill(235, 255 * k); textSize(max(26, min(40, width / 28))); text(lines.leaveTitle || "Leave your memory", width / 2, height * 0.2);
  fill(190, 255 * k); textSize(max(15, min(20, width / 60)));
  text(memSent ? (memSkipped ? (lines.leaveSkipped || "That's fine. Thank you for playing.") : (lines.leaveThanks || "Thank you. Your memory is kept.")) : (lines.leaveText || "Share one childhood memory of yours. We will turn it into a page of this story."), width * 0.15, height * 0.27, width * 0.7, 90);
  pop();
  if (!memSent) {
    memInp.position(R.box.x, R.box.y).size(R.box.w, R.box.h); memInp.style("opacity", String(k));
    const overS = overRect(R.send), overK = overRect(R.skip);
    noStroke(); fill(CREAM[0], CREAM[1], CREAM[2], 255 * k * (overS ? 1 : 0.85)); rect(R.send.x, R.send.y, R.send.w, R.send.h, 6);
    push(); textFont(FONT_CHILD); textAlign(CENTER, CENTER); noStroke(); fill(COVER[0], COVER[1], COVER[2], 255 * k); textSize(16); text(lines.leaveSend || "send", R.send.x + R.send.w / 2, R.send.y + R.send.h / 2);
    fill(overK ? 200 : 110, 255 * k); textSize(13); text(lines.leaveSkip || "skip", R.skip.x + R.skip.w / 2, R.skip.y + R.skip.h / 2); pop();
    cursor(overS || overK ? HAND : ARROW);
  } else if (false) {
    for (const id of ["again", "end"]) {
      const b = R[id], over = !memFadeT && overRect(b);
      push(); imageMode(CORNER); tint(255, 255 * (over ? 1 : 0.8)); image(gestures[id === "again" ? 5 : 1], b.x, b.y, b.w, b.h); noTint();
      if (over) { noFill(); stroke(255, 150); strokeWeight(2); rect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
      noStroke(); fill(over ? 230 : 120); textAlign(CENTER, CENTER); textSize(13);
      text(id === "again" ? `${lines.again || "again"} · ${GESTURE_NAMES[5]}` : `${lines.end || "end"} · ${GESTURE_NAMES[1]}`, b.x + b.w / 2, b.y + b.h + 12); pop();
    }
    cursor(overRect(R.again) || overRect(R.end) ? HAND : ARROW);
  } else cursor(ARROW);
  bandFont = FONT_CHILD; drawBand(this, memSent ? "" : (lines.leaveBand || ""), "");
  if (memFadeT) {   // again: fade to black, then back to the choosing screen
    const kk = (millis() - memFadeT) / 1000 / FAST;
    noStroke(); fill(0, 255 * min(1, kk / 0.8)); rect(0, 0, width, height);
    if (kk >= 1.6) { memFadeT = 0; restart(); }
  }
}
function drawEnd() {
  background(0); cursor(ARROW);
  const k = min(1, (millis() - memEndT) / 1000 / FAST / T_LEAVE_FADE);
  push(); textFont(FONT_CHILD); textAlign(CENTER, CENTER); noStroke();
  fill(235, 255 * k); textSize(max(26, min(40, width / 28))); text(lines.endTitle || "The end.", width / 2, height * 0.16);
  const others = memOthers.slice(0, 6);
  fill(150, 255 * k); textSize(max(14, min(18, width / 70))); text(others.length ? (lines.endOthers || "Pages other people have left here:") : (lines.endEmpty || "No one has left a page here yet."), width / 2, height * 0.26);
  const w = min(640, width * 0.72), x = width / 2 - w / 2; let y = height * 0.33;
  for (const [i, t] of others.entries()) {
    const a = 255 * k * max(0, min(1, (millis() - memEndT) / 1000 / FAST - 0.3 * i));
    noStroke(); fill(CREAM[0], CREAM[1], CREAM[2], a * 0.92); rect(x, y, w, 44, 5);
    fill(COVER[0], COVER[1], COVER[2], a); textAlign(LEFT, CENTER); textSize(16); text(t, x + 16, y + 2, w - 32, 40);
    y += 54;
  }
  fill(90, 255 * k); textAlign(CENTER, CENTER); textSize(13); text(lines.endAgain || "press R to play again", width / 2, contentH() - 30);
  pop();
  bandFont = FONT_CHILD; drawBand(this, lines.endBand || "", "");
}
