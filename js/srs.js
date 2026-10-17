// Spaced repetition (SM-2), same rules as the Python version.
// quality: 1=Again 3=Hard 4=Good 5=Easy
export const RELEARN_MINUTES = 10;
export const MASTERED_DAYS = 21;

export function newCard(ts, source = "new") {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: ts, created: ts, source, last: null };
}

// Returns a new card object; `now` is a Date.
export function schedule(card, quality, now) {
  const q = Math.max(0, Math.min(5, quality));
  const ease = Math.max(1.3, card.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const out = { ...card, ease, last: localISO(now) };

  if (q < 3) {
    out.interval = 0;
    out.reps = 0;
    out.lapses = card.lapses + 1;
    out.due = localISO(new Date(now.getTime() + RELEARN_MINUTES * 60000));
    return out;
  }
  const reps = card.reps + 1;
  let interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.max(card.interval + 1, Math.round(card.interval * ease));
  if (q === 3) interval = Math.max(1, Math.round(interval * 0.6)); // "Hard" grows slower
  out.reps = reps;
  out.interval = interval;
  out.due = localISO(new Date(now.getTime() + interval * 86400000));
  return out;
}

// --- local-time ISO helpers (no timezone suffix, sortable as strings)
const pad = (n) => String(n).padStart(2, "0");
export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function parseLocal(ts) {
  // Parse manually: older iOS Safari treats offset-less ISO strings as UTC.
  const [d, t = "00:00:00"] = ts.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm, ss] = t.split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm, ss || 0);
}
export const dayOf = (ts) => ts.slice(0, 10);
