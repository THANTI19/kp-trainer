/* ก.พ. Trainer — client-only PWA. All data lives on the device (see store.js). */
import * as store from "./store.js";
import * as sync from "./sync.js";
import { APP, SUBJECTS, SUBJECT_ORDER, TOPICS, DECKS, LETTERS, DAILY_SIZE, MOCK_MINUTES } from "./config.js";

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $streak = document.getElementById("streak");
const $sync = document.getElementById("syncdot");

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9;
  speechSynthesis.speak(u);
}
function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

let timers = [];
let gen = 0; // bumped on every navigation so stale callbacks can bail out
const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
function render(html, title) {
  $view.innerHTML = html;
  if (title) $title.textContent = title;
  window.scrollTo(0, 0);
}
const on = (sel, ev, fn) => $view.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
const goLinks = () => on("[data-go]", "click", (e) => (location.hash = e.currentTarget.dataset.go));

const prefs = {
  get: (k) => { try { return localStorage.getItem(APP.lsPrefix + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(APP.lsPrefix + k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(APP.lsPrefix + k); } catch { /* ignore */ } },
};
const DAY = 86400000;

function refreshStreak() {
  const s = store.stats();
  $streak.textContent = `🔥 ${s.streak}`;
  return s;
}
function setSyncState(state, title = "") { $sync.dataset.state = state; $sync.title = title; }

const fmtTime = (secs) => `${Math.floor(secs / 60)}:${String(Math.max(0, secs) % 60).padStart(2, "0")}`;
const choiceBtn = (c, k) => `<button class="btn choice" data-k="${k}"><span class="letter">${LETTERS[k]}.</span> ${esc(c)}</button>`;

function questionHTML(q) {
  return `${q.passage ? `<div class="passage">${esc(q.passage)}</div>` : ""}
    <div class="q-stem">${esc(q.stem)}</div>`;
}
function solutionHTML(q, r, choice) {
  return `
    <div class="feedback ${r.correct ? "ok" : "no"}">
      <b>${r.correct ? "ถูกต้อง ✓" : choice == null ? `ไม่ได้ตอบ · เฉลย ${LETTERS[r.answer]}` : `ยังไม่ถูก ✗ (ตอบ ${LETTERS[choice]}, เฉลย ${LETTERS[r.answer]})`}</b>
      <p>${esc(r.explanation_th)}</p>
      ${r.translation_th ? `<p class="muted">คำแปล: ${esc(r.translation_th)}</p>` : ""}
      ${r.source ? `<p class="source">📖 ${esc(r.source)}</p>` : ""}
    </div>`;
}

// ------------------------------------------------------------------ install / backup helpers
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const inLine = / Line\//i.test(ua);
const inOtherIOSBrowser = isIOS && /CriOS|FxiOS|EdgiOS/.test(ua);
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });

function needsBackup() {
  if (sync.isConfigured() || store.eventCount() < 30) return false;
  return Date.now() - Number(prefs.get("last_backup") || 0) > 14 * DAY
    && Date.now() - Number(prefs.get("backup_snooze") || 0) > 3 * DAY;
}
async function doExport() {
  const r = await sync.exportBackup();
  if (r === "cancelled") return false;
  prefs.set("last_backup", String(Date.now()));
  toast(r === "downloaded" ? "บันทึกไฟล์สำรองแล้ว" : "สำรองข้อมูลแล้ว");
  return true;
}
function shareLink() {
  const url = new URL(location.href);
  url.hash = ""; url.search = "?openExternalBrowser=1"; // LINE: open in the real browser
  return url.toString();
}
async function shareApp() {
  const url = shareLink();
  const text = "แอปฝึกข้อสอบ ก.พ. ภาค ก (อังกฤษ + ข้าราชการที่ดี) ทำได้วันละนิดบนมือถือ ไม่ต้องสมัครสมาชิก";
  if (navigator.share) {
    try { await navigator.share({ title: APP.name, text, url }); return; }
    catch (err) { if (err.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("คัดลอกลิงก์แล้ว นำไปวางใน LINE ได้เลย"); }
  catch { prompt("คัดลอกลิงก์นี้:", url); }
}
function installSteps() {
  if (isStandalone()) return `<p>✅ ติดตั้งเรียบร้อยแล้ว เปิดจากไอคอนบนหน้าจอได้เลย</p>`;
  if (inLine) return `<p><b>ตอนนี้เปิดอยู่ในแอป LINE</b> ซึ่งติดตั้งไม่ได้</p>
    <ol class="steps"><li>กดปุ่ม <b>⋮</b> หรือ <b>⋯</b> มุมขวาบน</li><li>เลือก <b>เปิดในเบราว์เซอร์</b> (Open in browser / Safari)</li>
    <li>แล้วทำตามขั้นตอนติดตั้งที่ขึ้นมาอีกครั้ง</li></ol>`;
  if (inOtherIOSBrowser) return `<p>บน iPhone ต้องติดตั้งผ่าน <b>Safari</b></p>
    <ol class="steps"><li>คัดลอกลิงก์ของหน้านี้</li><li>เปิดแอป <b>Safari</b> แล้ววางลิงก์</li><li>ทำตามขั้นตอนติดตั้งที่ขึ้นมา</li></ol>`;
  if (isIOS) return `<ol class="steps">
      <li>กดปุ่ม <b>แชร์</b> <span class="kbd">⬆︎</span> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่แถบล่างของ Safari</li>
      <li>เลื่อนลงหา <b>เพิ่มไปยังหน้าจอโฮม</b> (Add to Home Screen)</li>
      <li>กด <b>เพิ่ม</b> ที่มุมขวาบน</li>
      <li>ปิด Safari แล้ว <b>เปิดจากไอคอน ก.พ. บนหน้าจอ</b> ตั้งแต่นี้ไปใช้จากไอคอนเท่านั้น</li></ol>
    <p class="muted">ถ้าเปิดสลับกันระหว่าง Safari กับไอคอน ข้อมูลจะแยกกันคนละชุด</p>`;
  if (isAndroid) return installEvt ? `<button class="btn primary" id="install">ติดตั้งแอป</button>`
    : `<ol class="steps"><li>กดปุ่ม <b>⋮</b> มุมขวาบนของ Chrome</li><li>เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></li><li>เปิดจากไอคอน ก.พ. บนหน้าจอ</li></ol>`;
  return installEvt ? `<button class="btn primary" id="install">ติดตั้งแอปบนคอมพิวเตอร์</button>`
    : `<p>ใช้ Chrome หรือ Edge แล้วกดไอคอน <b>ติดตั้ง</b> ด้านขวาของช่องที่อยู่เว็บ หรือใช้งานในเบราว์เซอร์ต่อเลยก็ได้</p>`;
}
function wireInstall(after) {
  $view.querySelector("#install")?.addEventListener("click", async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    installEvt = null; after();
  });
}

// ------------------------------------------------------------------ welcome
function viewWelcome(sub) {
  const slides = [
    { icon: "👋", title: "ฝึกข้อสอบ ก.พ. ภาค ก", body: `
      <p>ทำข้อสอบได้ทุกที่ ทุกเวลาว่าง แค่หยิบมือถือขึ้นมา</p>
      <ul class="plain"><li>📝 <b>ชุดประจำวัน</b> ${DAILY_SIZE} ข้อ ใช้เวลาไม่กี่นาที</li>
      <li>⚖️ <b>ความรู้และลักษณะการเป็นข้าราชการที่ดี</b> ทุกข้ออ้างอิงมาตราจริง</li>
      <li>🇬🇧 <b>ภาษาอังกฤษ</b> สนทนา คำศัพท์ ไวยากรณ์ การอ่าน</li>
      <li>⏱️ <b>จำลองสอบ</b> จับเวลา ตัดสินผ่าน/ไม่ผ่านตามเกณฑ์รายวิชา</li></ul>` },
    { icon: "🔒", title: "ข้อมูลอยู่ในมือถือคุณ", body: `
      <p>ไม่ต้องสมัครสมาชิก ไม่มีใครเห็นคะแนนของคุณ</p>
      <p class="muted">ถ้าจะเปลี่ยนมือถือ ให้กด <b>สำรองข้อมูล</b> ในหน้าตั้งค่าก่อน แล้วนำไฟล์ไปกู้คืนในเครื่องใหม่</p>
      <p class="muted">ข้อสอบในแอปเขียนขึ้นใหม่ตามรูปแบบข้อสอบจริง ส่วนกฎหมายอ้างอิงจากตัวบท ไม่ได้นำข้อสอบเก่าที่มีลิขสิทธิ์มาใช้</p>` },
    { icon: "📲", title: "ติดตั้งลงหน้าจอ", body: installSteps() },
  ];
  const last = isStandalone() ? 1 : 2;
  let i = sub === "install" ? 2 : 0;
  function show() {
    const s = slides[i];
    const lastSlide = i >= last;
    render(`
      <div class="card welcome"><div class="welcome-icon">${s.icon}</div><h2>${s.title}</h2>${s.body}</div>
      <div class="dots">${slides.slice(0, last + 1).map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      <button class="btn primary" id="next">${lastSlide ? "เริ่มใช้งาน" : "ถัดไป"}</button>
      ${i > 0 ? `<button class="btn center" id="back">ย้อนกลับ</button>` : ""}`, "วิธีใช้");
    wireInstall(show);
    $view.querySelector("#next").addEventListener("click", () => {
      if (!lastSlide) { i++; return show(); }
      prefs.set("onboarded", "1");
      location.hash = "#home";
    });
    $view.querySelector("#back")?.addEventListener("click", () => { i--; show(); });
  }
  show();
}

// ------------------------------------------------------------------ home
function passBar(sub, s) {
  const p = s.recentPct;
  const color = p == null ? "var(--line)" : p >= sub.pass ? "var(--good)" : "var(--bad)";
  return `
    <div class="subj">
      <div class="row between"><span>${sub.icon} ${esc(sub.short)}</span>
        <span class="muted">${p == null ? "ยังไม่มีข้อมูล" : `${p}%`} · เกณฑ์ ${sub.pass}%</span></div>
      <div class="bar passbar"><i style="width:${p ?? 0}%;background:${color}"></i><b style="left:${sub.pass}%"></b></div>
    </div>`;
}

function viewHome() {
  const s = refreshStreak();
  let notice = "";
  if (!isStandalone()) {
    notice = `<div class="card notice"><b>📲 ติดตั้งลงหน้าจอก่อนใช้งาน</b>
      <p class="muted" style="margin:4px 0 8px">จะได้เปิดง่ายเหมือนแอปทั่วไป และข้อมูลการเรียนไม่หาย</p>
      <button class="btn small primary" data-go="#welcome/install">ดูวิธีติดตั้ง</button></div>`;
  } else if (needsBackup()) {
    notice = `<div class="card notice"><b>💾 สำรองข้อมูลหน่อยไหม?</b>
      <p class="muted" style="margin:4px 0 8px">ข้อมูลอยู่ในมือถือเครื่องนี้เท่านั้น ถ้าเปลี่ยนเครื่องหรือลบแอป จะกู้คืนได้จากไฟล์สำรอง</p>
      <div class="grid2"><button class="btn small primary" id="backup">สำรองตอนนี้</button><button class="btn small" id="later">ไว้ทีหลัง</button></div></div>`;
  }
  const resume = loadMockProgress();
  render(`
    ${notice}
    ${resume ? `<div class="card notice"><b>⏱️ มีการจำลองสอบค้างอยู่</b>
      <p class="muted" style="margin:4px 0 8px">เหลือเวลา ${fmtTime(Math.round((resume.deadline - Date.now()) / 1000))} นาที</p>
      <button class="btn small primary" data-go="#mock">ทำต่อ</button></div>` : ""}
    <div class="card hero">
      <h2>${s.answered_today ? `วันนี้ทำไปแล้ว ${s.answered_today} ข้อ 👍` : "วันนี้ลองสัก 10 ข้อไหม?"}</h2>
      <p class="muted">${s.streak ? `ฝึกต่อเนื่องมา ${s.streak} วัน` : "เริ่มนับ streak วันแรกได้เลย"}</p>
      <button class="btn primary" data-go="#quiz/daily">📝 ชุดประจำวัน ${DAILY_SIZE} ข้อ</button>
    </div>
    <div class="card">
      <h3>ความพร้อม (50 ข้อล่าสุดต่อวิชา)</h3>
      ${SUBJECT_ORDER.map((k) => passBar(SUBJECTS[k], s.subjects[k])).join("")}
    </div>
    <div class="grid2">
      <button class="btn tile" data-go="#cards"><b>${s.cards.due}</b><span>การ์ดรอทบทวน</span></button>
      <button class="btn tile" data-go="#mock"><b>⏱️</b><span>จำลองสอบ 50 ข้อ</span></button>
    </div>`, APP.name);
  goLinks();
  $view.querySelector("#backup")?.addEventListener("click", async () => { if (await doExport()) viewHome(); });
  $view.querySelector("#later")?.addEventListener("click", () => { prefs.set("backup_snooze", String(Date.now())); viewHome(); });
}

// ------------------------------------------------------------------ practice menu
function viewPractice() {
  const size = store.contentSize();
  const s = store.stats();
  const topicStat = new Map(s.topics.map((t) => [t.topic, t]));
  const topicRow = (t) => {
    const st = topicStat.get(t);
    return `<button class="btn topic" data-go="#quiz/topic/${t}"><span>${esc(TOPICS[t])}</span>
      <span class="muted">${st ? `${st.pct}%` : "ใหม่"}</span></button>`;
  };
  const topicsOf = (subject) => Object.keys(TOPICS).filter((t) =>
    ["admin_state", "good_gov", "admin_proc", "tort", "ethics", "criminal"].includes(t) === (subject === "law"));
  render(SUBJECT_ORDER.map((k) => `
    <div class="card">
      <h3>${SUBJECTS[k].icon} ${esc(SUBJECTS[k].name)}</h3>
      <p class="muted">${size[k]} ข้อ · เกณฑ์ผ่าน ${SUBJECTS[k].pass}%</p>
      <div class="grid3">
        <button class="btn small primary" data-go="#quiz/${k}/mix">สุ่ม 10</button>
        <button class="btn small" data-go="#quiz/${k}/unseen">ยังไม่เคยทำ</button>
        <button class="btn small" data-go="#quiz/${k}/review">เคยผิด</button>
      </div>
      <details class="topics"><summary>เลือกตามหัวข้อ</summary>${topicsOf(k).map(topicRow).join("")}</details>
    </div>`).join(""), "ฝึกทำข้อสอบ");
  goLinks();
}

// ------------------------------------------------------------------ practice runner (instant feedback)
function viewQuiz(parts) {
  let qs, label;
  if (parts[0] === "daily") { qs = store.dailySet(); label = "ชุดประจำวัน"; }
  else if (parts[0] === "topic") { qs = store.quiz({ topic: parts[1], n: 10 }); label = TOPICS[parts[1]] || "ฝึก"; }
  else { qs = store.quiz({ subject: parts[0], mode: parts[1] || "mix", n: 10 }); label = SUBJECTS[parts[0]]?.short || "ฝึก"; }

  if (!qs.length) {
    render(`<div class="card"><h2>ไม่มีข้อในโหมดนี้</h2><p class="muted">${parts[1] === "review" ? "ยังไม่มีข้อที่เคยตอบผิด เยี่ยมมาก" : "ทำครบทุกข้อแล้ว"}</p></div>
      <button class="btn primary" data-go="#practice">กลับไปเลือกชุดอื่น</button>`, label);
    return goLinks();
  }
  let i = 0, score = 0;
  const wrong = [];

  function show() {
    clearTimers();
    if (i >= qs.length) return finish();
    const q = qs[i];
    const start = Date.now();
    render(`
      <div class="progress"><i style="width:${(100 * i) / qs.length}%"></i></div>
      <div class="row between"><span class="muted">ข้อ ${i + 1} / ${qs.length} · ${esc(TOPICS[q.topic] || "")}</span><span class="timer" id="t">0s</span></div>
      <div class="card">${questionHTML(q)}${q.choices.map(choiceBtn).join("")}<div id="fb"></div></div>`, label);
    const $t = $view.querySelector("#t");
    timers.push(setInterval(() => ($t.textContent = `${Math.floor((Date.now() - start) / 1000)}s`), 500));

    on("[data-k]", "click", async (e) => {
      const btn = e.currentTarget; // read before any await
      const choice = Number(btn.dataset.k);
      const ms = Date.now() - start;
      clearTimers();
      $view.querySelectorAll("[data-k]").forEach((b) => (b.disabled = true));
      const r = await store.answer(q.id, choice, ms, parts[0] === "daily" ? "daily" : "practice");
      if (r.correct) score++; else wrong.push({ q, r, choice });
      $view.querySelector(`[data-k="${r.answer}"]`).classList.add("correct");
      if (!r.correct) btn.classList.add("wrong");
      $view.querySelector("#fb").innerHTML = `${solutionHTML(q, r, choice)}
        <button class="btn primary" id="next" style="margin-top:12px">${i + 1 < qs.length ? "ข้อถัดไป" : "ดูผล"}</button>`;
      $view.querySelector("#next").addEventListener("click", () => { i++; show(); });
      $view.querySelector("#next").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function finish() {
    refreshStreak();
    render(`
      <div class="card"><div class="big-score">${score}/${qs.length}</div>
        <p class="muted" style="text-align:center">${score === qs.length ? "ถูกทุกข้อ ยอดเยี่ยม!" : "ข้อที่ผิดจะกลับมาให้ทำซ้ำในชุดประจำวัน"}</p></div>
      <button class="btn primary" id="again">ทำอีกชุด</button>
      ${wrong.length ? `<button class="btn" data-go="#cards/law">ทบทวนการ์ดกฎหมาย</button>` : ""}
      <button class="btn" data-go="#home">กลับหน้าแรก</button>`, label);
    $view.querySelector("#again").addEventListener("click", () => viewQuiz(parts));
    goLinks();
  }
  show();
}

// ------------------------------------------------------------------ mock exam
// Progress is kept in localStorage so an iPhone that unloads the app mid-exam can resume.
function loadMockProgress() {
  try {
    const p = JSON.parse(prefs.get("mock_progress") || "null");
    if (!p || !Array.isArray(p.qids) || p.deadline < Date.now() - 5 * 60000) return null;
    return p;
  } catch { return null; }
}
const saveMockProgress = (p) => prefs.set("mock_progress", JSON.stringify(p));
const clearMockProgress = () => prefs.del("mock_progress");

function viewMockIntro() {
  const resume = loadMockProgress();
  const size = store.contentSize();
  render(`
    <div class="card">
      <h2>⏱️ จำลองสอบภาค ก</h2>
      <ul class="plain">
        ${SUBJECT_ORDER.map((k) => `<li>${SUBJECTS[k].icon} ${esc(SUBJECTS[k].name)} <b>${Math.min(SUBJECTS[k].mock, size[k])} ข้อ</b> · ผ่าน ${SUBJECTS[k].pass}%</li>`).join("")}
        <li>⏳ เวลาฝึก <b>${MOCK_MINUTES} นาที</b> <span class="muted">(ใช้ฝึกจังหวะ ไม่ใช่เวลาสอบจริง)</span></li>
      </ul>
      <p class="muted">ไม่เฉลยระหว่างทำ เหมือนห้องสอบจริง · ต้องผ่าน <b>ทุกวิชา</b> จึงจะนับว่าผ่าน · ปิดแอปกลางคันแล้วกลับมาทำต่อได้</p>
    </div>
    ${resume ? `<button class="btn primary" id="resume">ทำต่อจากเดิม (ข้อ ${resume.idx + 1})</button>
      <button class="btn" id="fresh">เริ่มชุดใหม่ (ทิ้งชุดเดิม)</button>`
      : `<button class="btn primary" id="fresh">เริ่มทำข้อสอบ</button>`}
    ${lastMocksHTML()}`, "จำลองสอบ");
  $view.querySelector("#resume")?.addEventListener("click", () => runMock(resume));
  $view.querySelector("#fresh").addEventListener("click", () => {
    if (resume && !confirm("ทิ้งชุดที่ทำค้างไว้แล้วเริ่มใหม่?")) return;
    const qs = store.mockSet();
    const p = { qids: qs.map((q) => q.id), answers: qs.map(() => null), ms: qs.map(() => 0),
      idx: 0, started: Date.now(), deadline: Date.now() + MOCK_MINUTES * 60000 };
    saveMockProgress(p);
    runMock(p);
  });
}

function lastMocksHTML() {
  const m = store.stats().mocks;
  if (!m.length) return "";
  return `<div class="card"><h3>ผลจำลองสอบล่าสุด</h3>${m.map((x) => `
    <div class="row between mockrow"><span>${esc(x.ts.slice(0, 10))}</span>
      <span>${SUBJECT_ORDER.map((k) => `${SUBJECTS[k].icon} ${x.results[k].ok}/${x.results[k].n}`).join(" · ")}</span>
      <b class="${x.passed ? "pass" : "fail"}">${x.passed ? "ผ่าน" : "ไม่ผ่าน"}</b></div>`).join("")}</div>`;
}

function runMock(p) {
  const byId = new Map(store.quiz({ n: 100000 }).map((q) => [q.id, q]));
  const qs = p.qids.map((id) => byId.get(id)).filter(Boolean);
  if (qs.length !== p.qids.length) { clearMockProgress(); toast("ชุดข้อสอบเปลี่ยนไป เริ่มชุดใหม่"); return viewMockIntro(); }
  document.body.classList.add("exam");
  const my = gen;
  let shownAt = Date.now();

  const persist = () => saveMockProgress(p);
  const leaveQuestion = () => { p.ms[p.idx] += Date.now() - shownAt; shownAt = Date.now(); };

  function tick() {
    const left = Math.round((p.deadline - Date.now()) / 1000);
    const $t = $view.querySelector("#t");
    if ($t) { $t.textContent = fmtTime(left); $t.classList.toggle("low", left <= 300); }
    if (left <= 0) { toast("หมดเวลา ส่งคำตอบอัตโนมัติ", 3000); submit(); }
  }

  function show() {
    if (my !== gen) return;
    const q = qs[p.idx];
    const subjectStart = SUBJECT_ORDER.find((k) => qs.findIndex((x) => x.subject === k) === p.idx);
    render(`
      <div class="row between examhead">
        <button class="btn small ghost" id="quit">ออก</button>
        <span class="timer" id="t"></span>
        <button class="btn small ghost" id="grid">ข้อ ${p.idx + 1}/${qs.length} ▾</button>
      </div>
      <div class="palette" id="palette" hidden>${qs.map((x, k) => `<button class="pal ${p.answers[k] !== null ? "done" : ""} ${k === p.idx ? "cur" : ""}" data-j="${k}">${k + 1}</button>`).join("")}</div>
      ${subjectStart ? `<div class="subject-banner">${SUBJECTS[q.subject].icon} ${esc(SUBJECTS[q.subject].name)}</div>` : ""}
      <div class="card">${questionHTML(q)}
        ${q.choices.map((c, k) => `<button class="btn choice ${p.answers[p.idx] === k ? "picked" : ""}" data-k="${k}"><span class="letter">${LETTERS[k]}.</span> ${esc(c)}</button>`).join("")}
      </div>
      <div class="grid2">
        <button class="btn center" id="prev" ${p.idx === 0 ? "disabled" : ""}>‹ ก่อนหน้า</button>
        ${p.idx + 1 < qs.length ? `<button class="btn primary" id="nextq">ถัดไป ›</button>` : `<button class="btn primary" id="submit">ส่งคำตอบ</button>`}
      </div>
      <p class="muted center-text">ตอบแล้ว ${p.answers.filter((a) => a !== null).length}/${qs.length}</p>`, "จำลองสอบ");
    tick();

    on("[data-k]", "click", (e) => {
      const k = Number(e.currentTarget.dataset.k);
      p.answers[p.idx] = p.answers[p.idx] === k ? null : k; // tap again to clear
      persist();
      $view.querySelectorAll("[data-k]").forEach((b) => b.classList.toggle("picked", Number(b.dataset.k) === p.answers[p.idx]));
      $view.querySelector(".center-text").textContent = `ตอบแล้ว ${p.answers.filter((a) => a !== null).length}/${qs.length}`;
    });
    const go = (j) => { leaveQuestion(); p.idx = j; persist(); show(); };
    $view.querySelector("#prev").addEventListener("click", () => go(p.idx - 1));
    $view.querySelector("#nextq")?.addEventListener("click", () => go(p.idx + 1));
    $view.querySelector("#submit")?.addEventListener("click", () => {
      const blank = p.answers.filter((a) => a === null).length;
      if (confirm(blank ? `ยังไม่ได้ตอบ ${blank} ข้อ (นับเป็นผิด) ส่งเลยไหม?` : "ส่งคำตอบ?")) submit();
    });
    $view.querySelector("#grid").addEventListener("click", () => { const pal = $view.querySelector("#palette"); pal.hidden = !pal.hidden; });
    on("[data-j]", "click", (e) => go(Number(e.currentTarget.dataset.j)));
    $view.querySelector("#quit").addEventListener("click", () => {
      leaveQuestion(); persist();
      document.body.classList.remove("exam");
      location.hash = "#home";
      toast("บันทึกไว้แล้ว กลับมาทำต่อได้ที่ จำลองสอบ");
    });
  }

  let submitted = false;
  async function submit() {
    if (submitted) return;
    submitted = true;
    clearTimers();
    leaveQuestion();
    const secs = Math.round((Math.min(Date.now(), p.deadline) - p.started) / 1000);
    const answers = qs.map((q, k) => ({ qid: q.id, choice: p.answers[k], ms: p.ms[k] }));
    const { results, passed } = await store.submitMock(answers, secs);
    clearMockProgress();
    document.body.classList.remove("exam");
    refreshStreak();
    const review = qs.map((q, k) => ({ q, choice: p.answers[k], r: store.solution(q.id, p.answers[k]) })).filter((x) => !x.r.correct);
    render(`
      <div class="card result ${passed ? "pass" : "fail"}">
        <div class="verdict">${passed ? "🎉 ผ่าน" : "ยังไม่ผ่าน"}</div>
        ${SUBJECT_ORDER.map((k) => {
          const r = results[k]; const pct = r.n ? Math.round((100 * r.ok) / r.n) : 0; const ok = pct >= SUBJECTS[k].pass;
          return `<div class="row between resrow"><span>${SUBJECTS[k].icon} ${esc(SUBJECTS[k].short)}</span>
            <span>${r.ok}/${r.n} (${pct}%) <b class="${ok ? "pass" : "fail"}">${ok ? "ผ่าน" : `ต้อง ${SUBJECTS[k].pass}%`}</b></span></div>`;
        }).join("")}
        <p class="muted">ใช้เวลา ${fmtTime(secs)} นาที</p>
      </div>
      ${review.length ? `<div class="card"><h3>ทบทวนข้อที่ผิด (${review.length})</h3>${review.map((x) => `
        <details class="rev"><summary>${esc((x.q.passage ? "[Reading] " : "") + x.q.stem.split("\n")[0])}</summary>
          ${questionHTML(x.q)}
          <p><b>เฉลย ${LETTERS[x.r.answer]}.</b> ${esc(x.q.choices[x.r.answer])}</p>
          ${solutionHTML(x.q, x.r, x.choice)}
        </details>`).join("")}</div>` : ""}
      <button class="btn primary" data-go="#mock">กลับหน้าจำลองสอบ</button>
      <button class="btn" data-go="#home">หน้าแรก</button>`, "ผลการสอบ");
    goLinks();
  }

  timers.push(setInterval(tick, 1000));
  show();
}

// ------------------------------------------------------------------ flashcards
function viewCardsMenu() {
  const s = store.stats();
  render(`
    ${Object.entries(DECKS).map(([k, d]) => `
      <button class="btn deck" data-go="#cards/${k}"><span>${d.icon} <b>${esc(d.name)}</b></span>
        <span class="badge">${store.dueCount(k)} รอทบทวน</span></button>`).join("")}
    <p class="muted">ทุกวันมีการ์ดใหม่ให้วันละ 10 ใบต่อชุด ส่วนการ์ดที่จำได้แล้วจะเว้นระยะห่างขึ้นเรื่อย ๆ</p>
    <div class="card"><h3>🎮 เกมคำศัพท์อังกฤษ</h3>
      <button class="btn" data-go="#games/speed"><b>⚡ Speed Quiz</b> <span class="muted">· 60 วินาที</span></button>
      <button class="btn" data-go="#games/match"><b>🧩 Match</b> <span class="muted">· จับคู่คำกับความหมาย</span></button>
      <button class="btn" data-go="#games/cloze"><b>✍️ Fill the Gap</b> <span class="muted">· เติมคำในประโยค</span></button>
      <p class="muted">สถิติสูงสุด ⚡ ${s.games_best.speed ?? "–"} · 🧩 ${s.games_best.match ?? "–"} · ✍️ ${s.games_best.cloze ?? "–"}</p>
    </div>`, "การ์ดทบทวน");
  goLinks();
}

function viewCards(deck) {
  const cards = store.dueCards(deck, 15);
  let i = 0, done = 0;
  const name = DECKS[deck]?.name || "การ์ด";
  if (!cards.length) {
    render(`<div class="card"><h2>ไม่มีการ์ดค้างทบทวน 🎉</h2><p class="muted">การ์ดใหม่วันนี้ครบโควตาแล้ว กลับมาใหม่พรุ่งนี้</p></div>
      <button class="btn primary" data-go="#quiz/daily">ทำชุดประจำวันแทน</button>`, name);
    return goLinks();
  }
  function show() {
    if (i >= cards.length) return finish();
    const c = cards[i];
    const en = c.deck === "english";
    let flipped = false;
    render(`
      <div class="progress"><i style="width:${(100 * i) / cards.length}%"></i></div>
      <p class="muted">${i + 1} / ${cards.length} · <span class="badge">${c.is_new ? "ใหม่" : "ทบทวน"}</span></p>
      <div class="card flash ${en ? "" : "law"}" id="flash">
        <div class="front">${esc(c.front)} ${en ? `<button class="speak" id="say" aria-label="ฟังเสียง">🔊</button>` : ""}</div>
        ${c.pos ? `<div class="pos">${esc(c.pos)}</div>` : ""}
        <div id="back" hidden>
          <div class="meaning">${esc(c.back)}</div>
          ${c.example ? `<div class="ex">“${esc(c.example)}”</div>` : ""}
          ${c.source ? `<div class="source">📖 ${esc(c.source)}</div>` : ""}
        </div>
        <p class="muted" id="hint">แตะเพื่อดูคำตอบ</p>
      </div>
      <div class="grid4" id="grades" hidden>
        <button class="btn small wrong" data-q="1">ไม่ได้</button>
        <button class="btn small" data-q="3">ยาก</button>
        <button class="btn small" data-q="4">ดี</button>
        <button class="btn small correct" data-q="5">ง่าย</button>
      </div>`, name);
    if (en) {
      speak(c.front);
      $view.querySelector("#say").addEventListener("click", (e) => { e.stopPropagation(); speak(c.front); });
    }
    $view.querySelector("#flash").addEventListener("click", () => {
      if (flipped) return;
      flipped = true;
      $view.querySelector("#back").hidden = false;
      $view.querySelector("#hint").hidden = true;
      $view.querySelector("#grades").hidden = false;
    });
    on("[data-q]", "click", async (e) => {
      const q = Number(e.currentTarget.dataset.q);
      $view.querySelectorAll("[data-q]").forEach((b) => (b.disabled = true));
      await store.review(c.key, q);
      if (q < 3) cards.push(c); else done++;
      i++; show();
    });
  }
  function finish() {
    refreshStreak();
    render(`<div class="card stat"><h2>เสร็จรอบนี้แล้ว</h2><b>${done}</b><span class="muted">ใบที่ทบทวน</span></div>
      <button class="btn primary" id="more">ทบทวนต่อ</button><button class="btn" data-go="#cards">เลือกชุดอื่น</button>`, name);
    $view.querySelector("#more").addEventListener("click", () => viewCards(deck));
    goLinks();
  }
  show();
}

// ------------------------------------------------------------------ games (English vocabulary)
async function finishGame(mode, score, total, missed, extra = "") {
  clearTimers();
  const r = await store.saveGame(mode, score, total, missed.map((m) => m.key));
  refreshStreak();
  const list = missed.map((m) => `<li><b>${esc(m.word)}</b> — ${esc(m.meaning_th)}</li>`).join("");
  render(`
    <div class="card"><div class="big-score">${score}</div>
      <p class="muted" style="text-align:center">${r.new_best ? "🏆 สถิติใหม่!" : `สถิติเดิม ${r.previous_best}`} ${extra}</p></div>
    ${list ? `<div class="card"><h3>คำที่พลาด (เพิ่มเข้าการ์ดทบทวนแล้ว)</h3><ul>${list}</ul></div>` : ""}
    <button class="btn primary" id="again">เล่นอีกครั้ง</button><button class="btn" data-go="#cards">กลับ</button>`, "เกม");
  $view.querySelector("#again").addEventListener("click", () => route());
  goLinks();
}

function gameSpeed() {
  const { items } = store.game("speed", 40);
  let i = 0, score = 0, left = 60, ended = false;
  const missed = [], my = gen;
  const end = () => { if (!ended && my === gen) { ended = true; finishGame("speed", score, i, missed); } };
  function show() {
    if (ended || my !== gen) return;
    if (i >= items.length || left <= 0) return end();
    const it = items[i];
    render(`
      <div class="row between"><span>คะแนน <b>${score}</b></span><span class="timer" id="t">${left}s</span></div>
      <div class="card flash" style="min-height:140px"><div class="front">${esc(it.prompt)}</div><div class="pos">${esc(it.pos)}</div></div>
      ${it.choices.map((c, k) => `<button class="btn" data-k="${k}">${esc(c)}</button>`).join("")}`, "Speed Quiz");
    on("[data-k]", "click", (e) => {
      const btn = e.currentTarget, k = Number(btn.dataset.k);
      $view.querySelectorAll("[data-k]").forEach((b) => (b.disabled = true));
      $view.querySelector(`[data-k="${it.answer}"]`).classList.add("correct");
      if (k === it.answer) score++; else { btn.classList.add("wrong"); missed.push(it); }
      i++;
      setTimeout(show, k === it.answer ? 250 : 700);
    });
  }
  timers.push(setInterval(() => {
    left--;
    const $t = $view.querySelector("#t");
    if ($t) { $t.textContent = `${left}s`; if (left <= 10) $t.style.color = "var(--bad)"; }
    if (left <= 0) end();
  }, 1000));
  show();
}

function gameMatch() {
  const { pairs } = store.game("match", 6);
  const words = [...pairs].sort(() => Math.random() - 0.5);
  const means = [...pairs].sort(() => Math.random() - 0.5);
  const start = Date.now();
  let selW = null, selM = null, matched = 0, mistakes = 0;
  const missed = new Map();
  render(`
    <div class="row between"><span>ผิด <b id="mis">0</b></span><span class="timer" id="t">0s</span></div>
    <p class="muted">แตะคำภาษาอังกฤษ แล้วแตะความหมายที่ตรงกัน</p>
    <div class="match-grid">
      <div>${words.map((p) => `<button class="btn" data-w="${esc(p.key)}">${esc(p.word)}</button>`).join("")}</div>
      <div>${means.map((p) => `<button class="btn" data-m="${esc(p.key)}">${esc(p.meaning_th)}</button>`).join("")}</div>
    </div>`, "Match");
  const $t = $view.querySelector("#t");
  timers.push(setInterval(() => ($t.textContent = `${Math.floor((Date.now() - start) / 1000)}s`), 250));
  const sel = (attr, key) => [...$view.querySelectorAll(`[${attr}]`)].find((b) => b.getAttribute(attr) === key);
  function check() {
    if (selW == null || selM == null) return;
    const bw = sel("data-w", selW), bm = sel("data-m", selM);
    if (selW === selM) {
      speak(pairs.find((p) => p.key === selW).word);
      bw.classList.add("done"); bm.classList.add("done");
      if (++matched === pairs.length) {
        const secs = Math.round((Date.now() - start) / 1000);
        return finishGame("match", Math.max(10, 120 - secs - 10 * mistakes), 120, [...missed.values()], `· ${secs} วินาที ผิด ${mistakes} ครั้ง`);
      }
    } else {
      mistakes++;
      $view.querySelector("#mis").textContent = mistakes;
      const p = pairs.find((x) => x.key === selW);
      missed.set(p.key, p);
      bw.classList.add("wrong"); bm.classList.add("wrong");
      setTimeout(() => { bw.classList.remove("wrong"); bm.classList.remove("wrong"); }, 400);
    }
    bw.classList.remove("sel"); bm.classList.remove("sel");
    selW = selM = null;
  }
  on("[data-w]", "click", (e) => {
    $view.querySelectorAll("[data-w]").forEach((b) => b.classList.remove("sel"));
    e.currentTarget.classList.add("sel"); selW = e.currentTarget.dataset.w; check();
  });
  on("[data-m]", "click", (e) => {
    $view.querySelectorAll("[data-m]").forEach((b) => b.classList.remove("sel"));
    e.currentTarget.classList.add("sel"); selM = e.currentTarget.dataset.m; check();
  });
}

function gameCloze() {
  const { items } = store.game("cloze", 10);
  let i = 0, score = 0;
  const missed = [];
  function show() {
    if (i >= items.length) return finishGame("cloze", score, items.length, missed);
    const it = items[i];
    render(`
      <div class="progress"><i style="width:${(100 * i) / items.length}%"></i></div>
      <div class="card"><div class="q-stem">${esc(it.prompt)}</div>${it.choices.map(choiceBtn).join("")}<div id="fb"></div></div>`, "Fill the Gap");
    on("[data-k]", "click", (e) => {
      const btn = e.currentTarget, k = Number(btn.dataset.k);
      $view.querySelectorAll("[data-k]").forEach((b) => (b.disabled = true));
      $view.querySelector(`[data-k="${it.answer}"]`).classList.add("correct");
      const ok = k === it.answer;
      if (ok) score++; else { btn.classList.add("wrong"); missed.push(it); }
      speak(it.prompt.replace("_____", it.word));
      $view.querySelector("#fb").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}"><b>${esc(it.word)}</b> (${esc(it.pos)}) — ${esc(it.meaning_th)}</div>
        <button class="btn primary" id="next" style="margin-top:12px">ถัดไป</button>`;
      $view.querySelector("#next").addEventListener("click", () => { i++; show(); });
    });
  }
  show();
}

// ------------------------------------------------------------------ stats
function viewStats() {
  const s = refreshStreak();
  const max = Math.max(1, ...s.activity_14d.map((a) => a.count));
  const topicRows = s.topics.map((t) => {
    const pass = SUBJECTS[t.subject].pass;
    const color = t.pct >= pass ? "var(--good)" : t.pct >= pass - 15 ? "var(--warn)" : "var(--bad)";
    return `<div class="tagrow"><div class="row between"><span>${esc(TOPICS[t.topic] || t.topic)}</span>
      <span class="muted">${t.pct}% · ${t.n} ข้อ</span></div>
      <div class="bar"><i style="width:${t.pct}%;background:${color}"></i></div></div>`;
  }).join("");
  render(`
    <div class="grid2">
      <div class="card stat"><b>${s.streak}</b><span class="muted">วันติดต่อกัน</span></div>
      <div class="card stat"><b>${s.cards.mastered}</b><span class="muted">การ์ดที่จำได้แล้ว</span></div>
    </div>
    <div class="card"><h3>ความพร้อมรายวิชา (50 ข้อล่าสุด)</h3>
      ${SUBJECT_ORDER.map((k) => passBar(SUBJECTS[k], s.subjects[k])).join("")}
      <p class="muted">ทั้งหมด: ${SUBJECT_ORDER.map((k) => `${SUBJECTS[k].short} ${s.subjects[k].ok}/${s.subjects[k].n}`).join(" · ")}</p>
    </div>
    <div class="card"><h3>กิจกรรม 14 วันล่าสุด</h3>
      <div class="activity">${s.activity_14d.map((a) => `<i class="${a.count ? "" : "zero"}" style="height:${(100 * a.count) / max}%" title="${a.date}: ${a.count}"></i>`).join("")}</div>
    </div>
    <div class="card"><h3>จุดอ่อนรายหัวข้อ</h3>${topicRows || `<p class="muted">ยังไม่มีข้อมูล ลองทำชุดประจำวันสักชุด</p>`}</div>
    ${lastMocksHTML()}`, "สถิติ");
}

// ------------------------------------------------------------------ settings
function viewSettings() {
  const c = sync.config();
  const size = store.contentSize();
  const last = Number(prefs.get("last_backup") || 0);
  const lastTxt = last ? new Date(last).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "ยังไม่เคย";
  render(`
    ${isStandalone() ? "" : `<div class="card notice"><b>📲 ยังไม่ได้ติดตั้งลงหน้าจอ</b>
      <button class="btn small primary" data-go="#welcome/install" style="margin-top:8px">ดูวิธีติดตั้ง</button></div>`}
    <div class="card"><h3>💾 สำรองข้อมูล</h3>
      <p class="muted">สำรองล่าสุด: ${lastTxt}</p>
      <button class="btn primary" id="export">สำรองข้อมูลตอนนี้</button>
      <p class="muted">ระบบจะเปิดเมนูแชร์ เลือก <b>บันทึกไปยังแอปไฟล์</b> หรือส่งเข้า LINE ของตัวเองเก็บไว้</p>
      <label class="btn center" for="file">กู้คืนจากไฟล์สำรอง</label>
      <p class="muted">ข้อมูลจากไฟล์จะรวมกับของเดิม ไม่ลบอะไรทิ้ง</p></div>
    <div class="card"><h3>📱 ย้ายไปมือถือเครื่องใหม่</h3>
      <ol class="steps"><li>เครื่องเก่า: กด <b>สำรองข้อมูลตอนนี้</b> แล้วส่งไฟล์เข้า LINE ของตัวเอง</li>
      <li>เครื่องใหม่: ติดตั้งแอป แล้วบันทึกไฟล์จาก LINE ลง <b>แอปไฟล์</b></li>
      <li>เปิดแอป → ตั้งค่า → <b>กู้คืนจากไฟล์สำรอง</b> → เลือกไฟล์นั้น</li></ol></div>
    <div class="card"><h3>🤝 ชวนเพื่อนมาฝึก</h3>
      <p class="muted">แต่ละคนมีข้อมูลของตัวเอง ไม่เห็นคะแนนของกันและกัน</p>
      <button class="btn" id="share">แชร์ลิงก์แอป</button>
      <button class="btn" data-go="#welcome">ดูวิธีใช้อีกครั้ง</button></div>
    <details class="card advanced"><summary><b>⚙️ ขั้นสูง</b> <span class="muted">(สำหรับคนที่ใช้ GitHub)</span></summary>
      <h3 style="margin-top:14px">🔄 Sync หลายเครื่องผ่าน GitHub Gist</h3>
      ${sync.isConfigured() ? `<p class="muted">เชื่อมต่อแล้ว · sync ล่าสุด ${esc(c.last ? c.last.replace("T", " ") : "–")}</p>
        <button class="btn primary" id="syncnow">Sync ตอนนี้</button><button class="btn" id="disconnect">ยกเลิกการเชื่อมต่อ</button>`
      : `<p class="muted">วาง GitHub token (classic) ที่มีสิทธิ์ <b>gist</b> อย่างเดียว ใช้ token เดียวกับแอป TOEIC ได้ ข้อมูลจะเก็บแยกไฟล์กัน</p>
        <input id="token" class="input" type="password" autocomplete="off" placeholder="ghp_...">
        <button class="btn primary" id="connect" style="margin-top:8px">เชื่อมต่อ</button>`}
      <h3 style="margin-top:18px">📚 เนื้อหาในแอป</h3>
      <p class="muted">ข้าราชการที่ดี ${size.law} ข้อ · อังกฤษ ${size.english} ข้อ · การ์ด ${size.cards} ใบ · ประวัติ ${store.eventCount()} รายการ<br>
      เพิ่มข้อสอบด้วยไฟล์ JSON ผ่านปุ่ม "กู้คืนจากไฟล์สำรอง" ระบบแยกประเภทไฟล์ให้เอง</p>
      <h3 style="margin-top:18px">🗑️ ล้างข้อมูลในเครื่อง</h3>
      <button class="btn small wrong" id="wipe">ล้างข้อมูล</button></details>
    ${store.isPersistent() ? "" : `<div class="card notice"><b style="color:var(--bad)">⚠️ เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล</b><p class="muted">อาจเป็นโหมดส่วนตัว ข้อมูลจะหายเมื่อปิดแอป</p></div>`}
    <input id="file" type="file" accept="application/json,.json" hidden>`, "ตั้งค่า");
  goLinks();
  const busy = (btn, text) => { btn.disabled = true; btn.textContent = text; };
  const reopen = () => { viewSettings(); const d = $view.querySelector("details.advanced"); if (d) d.open = true; };

  $view.querySelector("#export").addEventListener("click", async () => { if (await doExport()) viewSettings(); });
  $view.querySelector("#share").addEventListener("click", shareApp);
  $view.querySelector("#file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const r = await sync.importFile(f);
      toast(r.kind === "backup" ? `กู้คืนแล้ว · เพิ่ม ${r.added} รายการ`
        : `เพิ่มข้อสอบ ${r.questions} · การ์ด ${r.cards}${r.skipped ? ` · ข้าม ${r.skipped}` : ""}`, 3500);
      sync.scheduleSync(1000, onSyncDone);
      viewSettings();
    } catch (err) {
      toast(err.message.includes("แอปอื่น") ? err.message : "ไฟล์นี้ใช้ไม่ได้ ลองเลือกไฟล์สำรองที่ได้จากแอปนี้", 4000);
    }
  });
  $view.querySelector("#connect")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const token = $view.querySelector("#token").value.trim();
    if (!token) return toast("กรุณาวาง token");
    busy(btn, "กำลังเชื่อมต่อ..."); setSyncState("busy");
    try {
      const r = await sync.connect(token);
      setSyncState("ok");
      toast(`${r.created ? "สร้าง Gist ใหม่แล้ว" : "พบ Gist เดิม"} · รับ ${r.pulled} · ส่ง ${r.pushed} รายการ`, 3500);
      reopen();
    } catch (err) {
      setSyncState("err", err.message); toast(err.message, 3500);
      btn.disabled = false; btn.textContent = "เชื่อมต่อ";
    }
  });
  $view.querySelector("#syncnow")?.addEventListener("click", async (e) => { busy(e.currentTarget, "กำลัง sync..."); await runSync(true); reopen(); });
  $view.querySelector("#disconnect")?.addEventListener("click", () => {
    if (!confirm("ยกเลิกการเชื่อมต่อ sync บนเครื่องนี้?")) return;
    sync.disconnect(); setSyncState("off"); reopen();
  });
  $view.querySelector("#wipe").addEventListener("click", async () => {
    if (!confirm("ลบประวัติการเรียนทั้งหมดในเครื่องนี้?")) return;
    if (!confirm("ยืนยันอีกครั้ง: ลบแล้วกู้คืนไม่ได้ ถ้าไม่มีไฟล์สำรอง")) return;
    await store.clearAll(); clearMockProgress(); refreshStreak(); viewSettings();
  });
}

// ------------------------------------------------------------------ sync wiring
function onSyncDone(err, r) {
  if (err) return setSyncState("err", err.message);
  setSyncState("ok", `sync ล่าสุด ${sync.config().last}`);
  if (r && r.pulled) {
    refreshStreak();
    const tab = (location.hash.slice(1) || "home").split("/")[0];
    if (["home", "stats", "settings"].includes(tab)) route(); // never interrupt an active session
  }
}
async function runSync(loud) {
  setSyncState("busy");
  try {
    const r = await sync.syncNow();
    onSyncDone(null, r);
    if (loud) toast(`Sync สำเร็จ · รับ ${r.pulled} · ส่ง ${r.pushed} รายการ`);
  } catch (err) { onSyncDone(err); if (loud) toast(err.message, 3500); }
}

// ------------------------------------------------------------------ router
function route() {
  gen++;
  clearTimers();
  document.body.classList.remove("exam");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  const [tab, ...rest] = (location.hash.slice(1) || "home").split("/");
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab
    || (tab === "quiz" && a.dataset.tab === "practice") || (tab === "games" && a.dataset.tab === "cards")));
  document.body.classList.toggle("onboarding", tab === "welcome");
  const views = {
    home: viewHome,
    practice: viewPractice,
    quiz: () => viewQuiz(rest.length ? rest : ["daily"]),
    mock: viewMockIntro,
    cards: () => (rest[0] ? viewCards(rest[0]) : viewCardsMenu()),
    games: () => ({ speed: gameSpeed, match: gameMatch, cloze: gameCloze }[rest[0]] || viewCardsMenu)(),
    stats: viewStats,
    settings: viewSettings,
    welcome: () => viewWelcome(rest[0]),
  };
  Promise.resolve().then(() => (views[tab] || viewHome)()).catch((err) => {
    console.error(err);
    render(`<div class="card"><h2>เกิดข้อผิดพลาด</h2><p class="muted">${esc(err.message)}</p></div>`);
  });
}

async function main() {
  window.__appStarted = true;
  await store.init("data/");
  setSyncState(sync.isConfigured() ? "ok" : "off");
  store.onChange(() => sync.scheduleSync(15000, onSyncDone));
  window.addEventListener("hashchange", route);
  if (!prefs.get("onboarded") && !location.hash.startsWith("#welcome")) history.replaceState(null, "", "#welcome");
  if (inLine) document.getElementById("linebar").hidden = false;
  route();
  if (sync.isConfigured()) runSync(false);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sync.quiet(onSyncDone);
    else if (sync.isConfigured()) runSync(false);
  });
  window.addEventListener("online", () => sync.quiet(onSyncDone));
}

main().catch((err) => {
  console.error(err);
  render(`<div class="card"><h2>เปิดแอปไม่สำเร็จ</h2><p class="muted">${esc(err.message)}</p></div>`);
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
