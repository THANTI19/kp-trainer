/* Sync between devices through one secret GitHub Gist, plus file backup.
 *
 * Algorithm (safe to run on any device, any time, in any order):
 *   1. download the event list stored in the gist
 *   2. merge it into the local log (union by event id)
 *   3. if the gist is missing any of our events, upload the merged list
 * Because events are never edited or deleted, two devices always converge.
 * Even if both upload at the same moment and one upload "wins", the other
 * device still holds its events and pushes them again on its next sync.
 */
import * as store from "./store.js";
import { localISO } from "./srs.js";
import { APP } from "./config.js";

const API = "https://api.github.com";
const FILE = APP.gistFile;
const DESCRIPTION = APP.gistDescription;
const FORMAT = `${APP.dbName}-events`;
const K = { token: APP.lsPrefix + "gh_token", gist: APP.lsPrefix + "gh_gist", last: APP.lsPrefix + "last_sync" };

// localStorage can throw (private mode); never let that break the app
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const config = () => ({ token: ls.get(K.token), gist: ls.get(K.gist), last: ls.get(K.last) });
export const isConfigured = () => !!(ls.get(K.token) && ls.get(K.gist));

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${ls.get(K.token)}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error("Token ไม่ถูกต้องหรือหมดอายุ");
  if (res.status === 403) throw new Error("Token ไม่มีสิทธิ์ gist หรือใช้ API เกินโควตา");
  if (res.status === 404) throw new Error("ไม่พบ Gist (อาจถูกลบ)");
  if (!res.ok) throw new Error(`GitHub ตอบกลับ ${res.status}`);
  return res.json();
}

const payload = () => JSON.stringify({ format: FORMAT, version: 1, updated: localISO(), events: store.allEvents() });

/** First-time setup on a device: find this app's gist or create it. */
export async function connect(token) {
  ls.set(K.token, token.trim());
  try {
    const user = await gh("/user");
    // look for an existing sync gist (the second device finds the one the first device made)
    let found = null;
    for (let page = 1; page <= 5 && !found; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      found = list.find((g) => g.description === DESCRIPTION && g.files && g.files[FILE]);
      if (list.length < 100) break;
    }
    const created = !found;
    if (!found) {
      found = await gh("/gists", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: payload() } } }) });
    }
    ls.set(K.gist, found.id);
    const result = await syncNow();
    return { user: user.login, gist: found.id, created, ...result };
  } catch (err) {
    ls.del(K.token); ls.del(K.gist);
    throw err;
  }
}

export function disconnect() { ls.del(K.token); ls.del(K.gist); ls.del(K.last); }

let running = null;
export function syncNow() {
  if (!isConfigured()) return Promise.reject(new Error("ยังไม่ได้ตั้งค่า sync"));
  if (running) return running; // never run two syncs at once
  running = (async () => {
    const gist = await gh(`/gists/${ls.get(K.gist)}`);
    const file = gist.files[FILE];
    let remote = [];
    if (file) {
      const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
      try {
        const data = JSON.parse(text);
        if (data.format && data.format !== FORMAT) throw new Error("ไฟล์ใน Gist เป็นของแอปอื่น");
        remote = data.events || [];
      } catch (err) { if (err.message.startsWith("ไฟล์")) throw err; remote = []; }
    }
    const pulled = await store.mergeEvents(remote);
    const remoteIds = new Set(remote.map((e) => e.id));
    const pushed = store.allEvents().filter((e) => !remoteIds.has(e.id)).length;
    if (pushed > 0) {
      await gh(`/gists/${ls.get(K.gist)}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: { [FILE]: { content: payload() } } }) });
    }
    ls.set(K.last, localISO());
    return { pulled, pushed };
  })().finally(() => { running = null; });
  return running;
}

// Quietly sync a little after activity, and when the app goes to the background.
let timer = null;
export function scheduleSync(delayMs = 15000, onDone) {
  if (!isConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => quiet(onDone), delayMs);
}
export function quiet(onDone) {
  if (!isConfigured() || !navigator.onLine) return;
  syncNow().then((r) => onDone && onDone(null, r)).catch((err) => onDone && onDone(err));
}

// ------------------------------------------------------------------ file backup
export async function exportBackup() {
  const name = `kp-backup-${localISO().slice(0, 10)}.json`;
  const blob = new Blob([payload()], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  // iPhone: open the share sheet (AirDrop, LINE, Save to Files)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return "shared"; }
    catch (err) { if (err.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return "downloaded";
}

/** Accepts either this app's backup file ({format, events}) or a content file ({questions, cards}). */
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (Array.isArray(data.events)) {
    // a TOEIC backup must never be merged into the ก.พ. history (and vice versa)
    if (data.format !== FORMAT) throw new Error("นี่เป็นไฟล์สำรองของแอปอื่น (เช่น TOEIC) ใช้กับแอปนี้ไม่ได้");
    return { kind: "backup", added: await store.mergeEvents(data.events) };
  }
  if (Array.isArray(data.questions) || Array.isArray(data.cards)) return { kind: "content", ...(await store.importContent(data)) };
  throw new Error("ไม่รู้จักรูปแบบไฟล์นี้");
}
