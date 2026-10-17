/* Data layer: an append-only event log in IndexedDB (same design as the TOEIC app).
 *
 * Nothing stores "current state". Every action is an immutable event; SRS cards,
 * streaks and stats are recomputed by replaying the log, so merging two devices
 * is a union of events by id.
 *
 * Event types:
 *   review  {card, q}                        flashcard graded (card = "deck:front")
 *   answer  {qid, choice, correct, ms, mode} question answered
 *   mock    {results, secs, passed}          mock exam submitted
 *   game    {mode, score, total, missed[]}   vocab game finished
 *   content {questions[], cards[]}           user-imported content
 */
import { schedule, newCard, localISO, parseLocal, dayOf, MASTERED_DAYS } from "./srs.js";
import { APP, SUBJECTS, SUBJECT_ORDER, DAILY_SIZE } from "./config.js";

const STORE = "events";
let db = null;
let listeners = [];

const S = {
  events: [], ids: new Set(),
  seed: { questions: [], cards: [] },
  questions: new Map(), // qid -> question
  cards: new Map(),     // card key -> card
  srs: new Map(),       // card key -> SRS state
  answers: [], reviews: [], games: [], mocks: [],
};

// ------------------------------------------------------------------ keys
export const ckey = (deck, front) => `${deck}:${String(front).trim().toLowerCase()}`;
export function qkey(q) {
  // FNV-1a over passage + stem: both devices derive the same id for the same question
  const text = `${(q.passage || "").trim()}|${String(q.stem).trim()}`;
  let h = 0x811c9dc5;
  for (const ch of text) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return "q" + h.toString(16).padStart(8, "0");
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ------------------------------------------------------------------ IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP.dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(out && out.result);
  t.onerror = () => reject(t.error);
});
const idbAll = () => tx("readonly", (s) => s.getAll());
const idbPut = (events) => (db && events.length ? tx("readwrite", (s) => events.forEach((e) => s.put(e))) : Promise.resolve());
const idbClear = () => (db ? tx("readwrite", (s) => s.clear()) : Promise.resolve());

// ------------------------------------------------------------------ content
const validQ = (q) => q && typeof q.stem === "string" && q.stem.trim() && SUBJECTS[q.subject]
  && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4;
const validC = (c) => c && (c.deck === "law" || c.deck === "english")
  && typeof c.front === "string" && c.front.trim() && typeof c.back === "string" && c.back.trim();

function addContent(payload) {
  for (const q of payload.questions || []) {
    if (!validQ(q)) continue;
    const id = qkey(q);
    if (S.questions.has(id)) continue;
    S.questions.set(id, { id, subject: q.subject, topic: q.topic || "", passage: q.passage || "", stem: q.stem.trim(),
      choices: q.choices, answer: q.answer, explanation_th: q.explanation_th || "", source: q.source || "",
      translation_th: q.translation_th || "" });
  }
  for (const c of payload.cards || []) {
    if (!validC(c)) continue;
    const key = ckey(c.deck, c.front);
    if (S.cards.has(key)) continue;
    S.cards.set(key, { key, deck: c.deck, front: c.front.trim(), back: c.back, pos: c.pos || "",
      example: c.example || "", source: c.source || "", order: S.cards.size });
  }
}

// ------------------------------------------------------------------ replay
const byTime = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1);

function apply(e) {
  switch (e.type) {
    case "content": addContent(e); break;
    case "review": {
      if (!S.cards.has(e.card)) break;
      const st = S.srs.get(e.card) || newCard(e.ts, "new");
      S.srs.set(e.card, schedule(st, e.q, parseLocal(e.ts)));
      S.reviews.push(e);
      break;
    }
    case "answer": S.answers.push(e); break;
    case "mock": S.mocks.push(e); break;
    case "game": {
      S.games.push(e);
      for (const k of e.missed || []) {           // missed words come back for review
        if (!S.cards.has(k)) continue;
        const st = S.srs.get(k);
        if (!st) S.srs.set(k, newCard(e.ts, "game"));
        else if (st.due > e.ts) st.due = e.ts;
      }
      break;
    }
  }
}

function rebuild() {
  S.questions.clear(); S.cards.clear(); S.srs.clear();
  S.answers = []; S.reviews = []; S.games = []; S.mocks = [];
  addContent(S.seed);
  const sorted = [...S.events].sort(byTime);
  sorted.filter((e) => e.type === "content").forEach(apply);
  sorted.filter((e) => e.type !== "content").forEach(apply);
}

// ------------------------------------------------------------------ lifecycle
export async function init(base = "data/") {
  const [questions, cards] = await Promise.all([
    fetch(base + "questions.json").then((r) => r.json()),
    fetch(base + "cards.json").then((r) => r.json()),
  ]);
  S.seed = { questions, cards };
  try { db = await openDB(); S.events = await idbAll(); }
  catch (err) { console.warn("IndexedDB unavailable, memory only", err); db = null; S.events = []; }
  S.ids = new Set(S.events.map((e) => e.id));
  rebuild();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
export const onChange = (fn) => listeners.push(fn);

async function recordMany(list) {
  const events = list.map((d, i) => ({ id: uuid(), ts: localISO(), seq: i, ...d }));
  await idbPut(events);
  events.forEach((e) => { S.events.push(e); S.ids.add(e.id); apply(e); });
  listeners.forEach((fn) => fn(events));
  return events;
}
const record = async (d) => (await recordMany([d]))[0];

export async function mergeEvents(list) {
  const fresh = (list || []).filter((e) => e && typeof e.id === "string" && typeof e.ts === "string"
    && typeof e.type === "string" && !S.ids.has(e.id));
  if (!fresh.length) return 0;
  await idbPut(fresh);
  fresh.forEach((e) => { S.events.push(e); S.ids.add(e.id); });
  rebuild();
  return fresh.length;
}
export const allEvents = () => S.events.slice();
export const eventCount = () => S.events.length;
export const isPersistent = () => !!db;
export async function clearAll() { await idbClear(); S.events = []; S.ids = new Set(); rebuild(); }

export async function importContent(payload) {
  const questions = (payload.questions || []).filter(validQ).filter((q) => !S.questions.has(qkey(q)));
  const cards = (payload.cards || []).filter(validC).filter((c) => !S.cards.has(ckey(c.deck, c.front)));
  const total = (payload.questions || []).length + (payload.cards || []).length;
  if (questions.length || cards.length) await record({ type: "content", questions, cards });
  return { questions: questions.length, cards: cards.length, skipped: total - questions.length - cards.length };
}
export function contentSize() {
  const count = (pred) => [...S.questions.values()].filter(pred).length;
  return { law: count((q) => q.subject === "law"), english: count((q) => q.subject === "english"),
    cards: S.cards.size, lawCards: [...S.cards.values()].filter((c) => c.deck === "law").length };
}

// ------------------------------------------------------------------ helpers
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function lastAnswerByQ() {
  const m = new Map();
  [...S.answers].sort(byTime).forEach((a) => m.set(a.qid, a));
  return m;
}
const publicQ = (q) => ({ id: q.id, subject: q.subject, topic: q.topic, passage: q.passage, stem: q.stem, choices: q.choices });
// keep questions that share a reading passage next to each other
const groupPassages = (list) => {
  const order = new Map();
  list.forEach((q, i) => { if (!order.has(q.passage || q.id)) order.set(q.passage || q.id, i); });
  return list.slice().sort((a, b) => order.get(a.passage || a.id) - order.get(b.passage || b.id));
};

// ------------------------------------------------------------------ flashcards
export function dueCards(deck = null, n = 15, newLimit = 10) {
  const now = localISO(), today = dayOf(now);
  const inDeck = (k) => !deck || S.cards.get(k)?.deck === deck;
  const due = [...S.srs.entries()].filter(([k, c]) => c.due <= now && inDeck(k) && S.cards.has(k))
    .sort((a, b) => (a[1].due < b[1].due ? -1 : 1)).slice(0, n)
    .map(([k, c]) => ({ ...S.cards.get(k), is_new: false, interval: c.interval }));
  const newToday = [...S.srs.entries()].filter(([k, c]) => c.source === "new" && dayOf(c.created) === today && inDeck(k)).length;
  const allow = Math.max(0, Math.min(n - due.length, newLimit - newToday));
  const fresh = [...S.cards.values()].filter((c) => !S.srs.has(c.key) && (!deck || c.deck === deck))
    .sort((a, b) => a.order - b.order).slice(0, allow).map((c) => ({ ...c, is_new: true, interval: 0 }));
  return [...due, ...fresh];
}
export const review = (cardKey, q) => record({ type: "review", card: cardKey, q });
export function dueCount(deck = null) {
  const now = localISO();
  return [...S.srs.entries()].filter(([k, c]) => c.due <= now && S.cards.has(k) && (!deck || S.cards.get(k).deck === deck)).length;
}

// ------------------------------------------------------------------ questions
/** mode: mix | unseen | review(last answer wrong) ; subject/topic optional filters */
export function quiz({ subject = null, topic = null, mode = "mix", n = 10 } = {}) {
  const last = lastAnswerByQ();
  let pool = [...S.questions.values()].filter((q) => (!subject || q.subject === subject) && (!topic || q.topic === topic));
  if (mode === "review") pool = pool.filter((q) => last.has(q.id) && !last.get(q.id).correct);
  if (mode === "unseen") pool = pool.filter((q) => !last.has(q.id));
  return groupPassages(shuffle(pool).slice(0, n)).map(publicQ);
}

/** Daily set: half per subject; previously-wrong first, then unseen, then the rest. */
export function dailySet(n = DAILY_SIZE) {
  const last = lastAnswerByQ();
  const rank = (q) => (last.has(q.id) ? (last.get(q.id).correct ? 2 : 0) : 1);
  const pick = (subject, k) => {
    const pool = shuffle([...S.questions.values()].filter((q) => q.subject === subject));
    return pool.sort((a, b) => rank(a) - rank(b)).slice(0, k);
  };
  const half = Math.ceil(n / 2);
  return [...groupPassages(pick("english", n - half)), ...pick("law", half)].map(publicQ);
}

export function mockSet() {
  return SUBJECT_ORDER.flatMap((s) =>
    groupPassages(shuffle([...S.questions.values()].filter((q) => q.subject === s)).slice(0, SUBJECTS[s].mock))).map(publicQ);
}

function reveal(q, choice) {
  return { correct: choice === q.answer, answer: q.answer, explanation_th: q.explanation_th,
    source: q.source, translation_th: q.translation_th };
}
export async function answer(qid, choice, ms, mode = "practice") {
  const q = S.questions.get(qid);
  if (!q) throw new Error("question not found");
  const r = reveal(q, choice);
  await record({ type: "answer", qid, choice, correct: r.correct, ms, mode });
  return r;
}
export const solution = (qid, choice) => reveal(S.questions.get(qid), choice);

/** answers: [{qid, choice|null, ms}] — unanswered (null) counts as wrong, like the real exam */
export async function submitMock(answers, secs) {
  const results = {};
  for (const s of SUBJECT_ORDER) results[s] = { n: 0, ok: 0 };
  const events = [];
  for (const a of answers) {
    const q = S.questions.get(a.qid);
    if (!q) continue;
    const correct = a.choice === q.answer;
    results[q.subject].n++; if (correct) results[q.subject].ok++;
    if (a.choice !== null) events.push({ type: "answer", qid: a.qid, choice: a.choice, correct, ms: a.ms, mode: "mock" });
  }
  const passed = SUBJECT_ORDER.every((s) => results[s].n === 0 || (100 * results[s].ok) / results[s].n >= SUBJECTS[s].pass);
  events.push({ type: "mock", results, secs, passed });
  await recordMany(events);
  return { results, passed };
}

// ------------------------------------------------------------------ games (English vocabulary)
function distractors(target, k, field) {
  const pool = [...S.cards.values()].filter((c) => c.deck === target.deck && c.key !== target.key);
  const same = shuffle(pool.filter((c) => c.pos && c.pos === target.pos));
  const other = shuffle(pool.filter((c) => !c.pos || c.pos !== target.pos));
  return [...same, ...other].slice(0, k).map((c) => c[field]);
}
function blank(example, word) {
  const stem = word.endsWith("e") && !word.includes(" ") ? word.slice(0, -1) : word;
  const re = new RegExp("\\b" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[a-z]*\\b", "i");
  return re.test(example) ? example.replace(re, "_____") : null;
}
export function game(mode, n = 10) {
  const picks = shuffle([...S.cards.values()].filter((c) => c.deck === "english")).slice(0, n);
  if (mode === "match") return { pairs: picks.slice(0, Math.min(n, 8)).map((c) => ({ key: c.key, word: c.front, meaning_th: c.back })) };
  const items = [];
  for (const c of picks) {
    let prompt, ans;
    if (mode === "speed") { prompt = c.front; ans = c.back; }
    else { prompt = blank(c.example, c.front); ans = c.front; if (!prompt) continue; }
    const choices = shuffle([...distractors(c, 3, mode === "speed" ? "back" : "front"), ans]);
    items.push({ key: c.key, word: c.front, pos: c.pos, meaning_th: c.back, prompt, choices, answer: choices.indexOf(ans) });
  }
  return { items };
}
export async function saveGame(mode, score, total, missedKeys) {
  const prev = S.games.filter((g) => g.mode === mode).map((g) => g.score);
  const best = prev.length ? Math.max(...prev) : null;
  const missed = [...new Set(missedKeys)].filter((k) => S.cards.has(k));
  await record({ type: "game", mode, score, total, missed });
  return { new_best: best === null || score > best, previous_best: best, added_to_review: missed.length };
}

// ------------------------------------------------------------------ stats
export function stats() {
  const now = new Date(), nowISO = localISO(now), today = dayOf(nowISO);
  const activity = [...S.answers, ...S.reviews, ...S.games];
  const days = new Set(activity.map((e) => dayOf(e.ts)));

  const subj = {}, topics = new Map();
  for (const s of SUBJECT_ORDER) subj[s] = { n: 0, ok: 0, recentN: 0, recentOk: 0 };
  const sorted = [...S.answers].sort(byTime);
  for (const a of sorted) {
    const q = S.questions.get(a.qid);
    if (!q) continue;
    subj[q.subject].n++; if (a.correct) subj[q.subject].ok++;
    const t = topics.get(q.topic) || { topic: q.topic, subject: q.subject, n: 0, ok: 0 };
    t.n++; if (a.correct) t.ok++; topics.set(q.topic, t);
  }
  // recent accuracy: last 50 answers per subject, closer to "how would I do today"
  for (const s of SUBJECT_ORDER) {
    const recent = sorted.filter((a) => S.questions.get(a.qid)?.subject === s).slice(-50);
    subj[s].recentN = recent.length; subj[s].recentOk = recent.filter((a) => a.correct).length;
  }
  const pct = (ok, n) => (n ? Math.round((1000 * ok) / n) / 10 : null);

  const counts = new Map();
  activity.forEach((e) => counts.set(dayOf(e.ts), (counts.get(dayOf(e.ts)) || 0) + 1));
  const act14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayOf(localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12)));
    act14.push({ date: d, count: counts.get(d) || 0 });
  }
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days.has(today) ? 0 : 1), 12);
  while (days.has(dayOf(localISO(cursor)))) { streak++; cursor.setDate(cursor.getDate() - 1); }

  const cards = [...S.srs.entries()].filter(([k]) => S.cards.has(k)).map(([, c]) => c);
  const best = {};
  S.games.forEach((g) => { best[g.mode] = Math.max(best[g.mode] ?? -Infinity, g.score); });

  return {
    streak, studied_today: days.has(today),
    answered_today: S.answers.filter((a) => dayOf(a.ts) === today).length,
    subjects: Object.fromEntries(SUBJECT_ORDER.map((s) => [s, { ...subj[s], pct: pct(subj[s].ok, subj[s].n),
      recentPct: pct(subj[s].recentOk, subj[s].recentN), pass: SUBJECTS[s].pass }])),
    topics: [...topics.values()].map((t) => ({ ...t, pct: pct(t.ok, t.n) })).sort((a, b) => a.pct - b.pct),
    cards: { total: S.cards.size, learning: cards.filter((c) => c.interval < MASTERED_DAYS).length,
      mastered: cards.filter((c) => c.interval >= MASTERED_DAYS).length, due: dueCount() },
    mocks: [...S.mocks].sort(byTime).slice(-5).reverse(),
    games_best: best, activity_14d: act14,
  };
}
