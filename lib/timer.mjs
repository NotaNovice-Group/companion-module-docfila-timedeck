// DocFila TimeDeck: the timer engine. Pure, dependency free, shared by the
// server (functions/timedeck, the authority) and every screen
// (timedeck-web/js/shared/timer.js is a byte-for-byte copy made by
// scripts/sync_timedeck_shared.mjs; a test fails when they drift).
//
// A timer never counts by accumulating ticks. Its state holds anchors on the
// server's clock: `startedAt` (when the current run began) and `accumulatedMs`
// (time already run before it). Elapsed time is always
//     accumulatedMs + (running ? now - startedAt : 0)
// so a paused tab, a minimised window or a slow frame cannot add drift: the
// next frame reads the right value from the same anchors. Screens pass the
// server's time as `now` (clock.js estimates it from the API's serverNow).
//
// Durations, absolute instants and time zones stay separate: a countdown has
// a duration; a scheduled start is an instant (epoch ms); a clock shows an
// instant in a zone. Changing a zone never touches a countdown.

export const TYPES = ["countdown", "countup", "stopwatch", "clock", "scheduled", "interval", "deadline"];
export const MAX_DURATION_MS = 100 * 3600000; // 100 hours
export const MAX_SEGMENTS = 50;
export const DEFAULT_THRESHOLDS = { warningMs: 120000, criticalMs: 30000 };
// An absolute anchor (scheduled start, deadline end) may lie at most this far
// from "now": further is a typo or an attack, never a plan.
export const ANCHOR_RANGE_MS = 7 * 86400000;

const finite = (n, d = 0) => (Number.isFinite(n) ? n : d);
const clampMs = (n) => Math.max(0, Math.min(MAX_DURATION_MS, Math.round(finite(n))));

/** A new timer state (no id: the caller names it). */
export function newTimer({ type = "countdown", durationMs = 15 * 60000, startValueMs = 0, segments = null, rounds = 1, scheduledAt = null, endAt = null, overtime = true, thresholds = null } = {}) {
  return {
    type: TYPES.includes(type) ? type : "countdown",
    durationMs: clampMs(durationMs),
    startValueMs: clampMs(startValueMs),
    // Zero-length segments are dropped; an interval with none left gets one
    // 5-minute segment, so it can never reach zero the instant it starts.
    segments: (() => {
      const list = Array.isArray(segments) ? segments.slice(0, MAX_SEGMENTS).map((s) => ({ label: String((s && s.label) || "").slice(0, 60), ms: clampMs(s && s.ms) })).filter((s) => s.ms >= 1000) : [];
      return type === "interval" && !list.length ? [{ label: "Segment 1", ms: 300000 }] : list;
    })(),
    rounds: Math.max(1, Math.min(99, Math.round(finite(rounds, 1)))),
    scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null,
    // "deadline": the instant the count reaches zero, whatever happens in
    // between (a session that must end at 10:30 sharp). Not pausable.
    endAt: Number.isFinite(endAt) ? endAt : null,
    overtime: overtime !== false,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(thresholds && typeof thresholds === "object" && !Array.isArray(thresholds) ? thresholds : {}) },
    status: "idle", // idle | running | paused | ended
    startedAt: null,
    accumulatedMs: 0,
    endedAt: null,
    lastAt: 0, // server time of the last command applied (orders replays)
  };
}

/** Elapsed run time at `now` (may be negative before a scheduled start). */
export function elapsedMs(t, now) {
  const run = t.status === "running" && t.startedAt != null ? now - t.startedAt : 0;
  return finite(t.accumulatedMs) + run;
}

const intervalTotal = (t) => t.segments.reduce((a, s) => a + s.ms, 0) * t.rounds;

/** The length a timer counts against, or null when it has none. */
export function targetMs(t) {
  if (t.type === "countdown" || t.type === "scheduled") return t.durationMs;
  if (t.type === "interval") return intervalTotal(t);
  if (t.type === "countup") return t.durationMs || null; // optional target
  if (t.type === "deadline") return t.durationMs || null; // the planned length, for progress
  return null;
}

/**
 * What a screen shows at `now`:
 *   ms        signed value to display (countdown: remaining; negative = overtime)
 *   phase     idle | running | paused | ended | waiting (scheduled, not yet started)
 *   status    normal | warning | critical | overtime   (never shown by colour alone)
 *   progress  0..1 of the target, or null
 */
export function view(t, now) {
  const el = elapsedMs(t, now);
  let phase = t.status;
  let ms = 0;
  let progress = null;
  let segment = null;
  const target = targetMs(t);

  if (t.type === "clock") return { type: t.type, phase: "running", ms: now, status: "normal", progress: null, elapsed: 0, remaining: null, overtime: false, segment: null };

  if (t.type === "deadline") {
    if (t.endAt == null || t.status === "idle") return { type: t.type, phase: "idle", ms: t.durationMs || 0, status: "normal", progress: null, elapsed: 0, remaining: t.durationMs || null, overtime: false, segment: null };
    const frozenAt = t.status === "running" ? now : t.endedAt ?? now;
    let ms = t.endAt - frozenAt;
    if (!t.overtime && ms < 0) ms = 0;
    const th = t.thresholds || DEFAULT_THRESHOLDS;
    const status = ms < 0 || (t.status === "ended" && ms <= 0) ? "overtime" : ms <= th.criticalMs ? "critical" : ms <= th.warningMs ? "warning" : "normal";
    const planned = t.durationMs || null;
    return { type: t.type, phase: t.status === "running" && ms <= 0 && !t.overtime ? "ended" : t.status, ms, status, progress: planned ? Math.min(1, Math.max(0, 1 - ms / planned)) : null, elapsed: planned ? Math.max(0, planned - ms) : 0, remaining: ms, overtime: ms < 0, segment: null };
  }

  if (t.type === "scheduled" && t.status === "running" && el < 0) {
    return { type: t.type, phase: "waiting", ms: -el, status: "normal", progress: 0, elapsed: 0, remaining: t.durationMs, overtime: false, startsIn: -el, segment: null };
  }

  if (t.type === "countdown" || t.type === "scheduled") {
    ms = t.durationMs - Math.max(0, el);
    if (!t.overtime && ms < 0) ms = 0;
    progress = target ? Math.min(1, Math.max(0, el) / target) : null;
  } else if (t.type === "countup" || t.type === "stopwatch") {
    ms = t.startValueMs + Math.max(0, el);
    progress = target ? Math.min(1, ms / target) : null;
  } else if (t.type === "interval") {
    const total = intervalTotal(t);
    const e = Math.max(0, el);
    const per = t.segments.reduce((a, s) => a + s.ms, 0);
    if (!per) { ms = 0; } else if (e >= total) {
      ms = -(e - total);
      segment = { index: t.segments.length - 1, round: t.rounds, label: t.segments[t.segments.length - 1].label, count: t.segments.length };
    } else {
      const round = Math.floor(e / per);
      let inRound = e - round * per;
      let i = 0;
      while (i < t.segments.length - 1 && inRound >= t.segments[i].ms) { inRound -= t.segments[i].ms; i += 1; }
      ms = t.segments[i].ms - inRound;
      segment = { index: i, round: round + 1, label: t.segments[i].label, count: t.segments.length };
    }
    progress = total ? Math.min(1, e / total) : null;
    if (!t.overtime && ms < 0) ms = 0;
  }

  const counting = t.type === "countdown" || t.type === "scheduled" || t.type === "interval";
  const remaining = counting ? ms : target ? target - ms : null;
  const overtime = counting ? ms < 0 || (t.status === "ended" && ms <= 0) : target != null && ms > target;
  let status = "normal";
  if (overtime) status = "overtime";
  else if (remaining != null && t.status !== "idle") {
    const th = t.thresholds || DEFAULT_THRESHOLDS;
    if (remaining <= th.criticalMs) status = "critical";
    else if (remaining <= th.warningMs) status = "warning";
  }
  if (counting && phase === "running" && ms <= 0 && !t.overtime) phase = "ended";
  return { type: t.type, phase, ms, status, progress, elapsed: Math.max(0, el), remaining, overtime, segment };
}

/** Error thrown for a command that does not apply (mapped to HTTP 422). */
export class TimerCommandError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/**
 * Apply one command at server time `now`. Returns a NEW state.
 * `at` (optional) is when the operator pressed the button, as estimated on
 * their device; queued offline commands replay with it. It is clamped to
 * [lastAt, now] so a replay can never rewrite time already shown.
 */
export function apply(t, cmd, now) {
  if (!cmd || typeof cmd !== "object") throw new TimerCommandError("invalid", "A command is required");
  // `at` may be at most a day old even for a timer that never ran: a replay
  // from further back could only be a bug or an attack.
  // Whole milliseconds: anchors become task ids and JSON keys downstream.
  const at = Math.round(Number.isFinite(cmd.at) ? Math.min(now, Math.max(t.lastAt || 0, now - 86400000, cmd.at)) : now);
  const s = { ...t, segments: t.segments.slice(), thresholds: { ...t.thresholds }, lastAt: Math.max(t.lastAt || 0, at) };
  const freeze = () => { if (s.status === "running") { s.accumulatedMs = elapsedMs(s, at); s.startedAt = null; } };

  switch (cmd.action) {
    case "start": {
      if (s.type === "clock") return s;
      if (s.status === "running") return s;
      if (s.type === "deadline") {
        // Without an end instant, the planned length from now becomes the end.
        if (s.endAt == null || s.status === "ended") s.endAt = at + (s.durationMs || 0);
        s.startedAt = at; s.accumulatedMs = 0; s.endedAt = null; s.status = "running";
        return s;
      }
      if (s.status === "ended") { s.accumulatedMs = 0; s.endedAt = null; }
      if (s.type === "scheduled" && Number.isFinite(cmd.startAt ?? s.scheduledAt) && s.status === "idle") {
        if (Number.isFinite(cmd.startAt) && Math.abs(cmd.startAt - at) > ANCHOR_RANGE_MS) throw new TimerCommandError("invalid", "startAt must be within a week");
        s.scheduledAt = Number.isFinite(cmd.startAt) ? Math.round(cmd.startAt) : s.scheduledAt;
        s.startedAt = s.scheduledAt;
        s.accumulatedMs = 0;
      } else s.startedAt = at;
      s.status = "running";
      return s;
    }
    case "pause":
      if (s.status !== "running") return s;
      if (s.type === "deadline") return s; // the deadline does not move for a pause
      // A scheduled timer that has not reached its start has nothing to
      // pause: it starts at `scheduledAt` regardless. Reset it instead.
      if (s.type === "scheduled" && elapsedMs(s, at) < 0) return s;
      freeze();
      s.status = "paused";
      return s;
    case "resume":
      if (s.status !== "paused") return s;
      s.status = "running";
      s.startedAt = at;
      return s;
    case "toggle":
      return apply(t, { ...cmd, action: t.status === "running" ? "pause" : t.status === "paused" ? "resume" : "start" }, now);
    case "reset":
      s.status = "idle"; s.startedAt = null; s.accumulatedMs = 0; s.endedAt = null;
      return s;
    case "restart":
      if (s.type === "deadline") s.endAt = at + (s.durationMs || 0);
      s.status = "running"; s.startedAt = at; s.accumulatedMs = 0; s.endedAt = null;
      return s;
    case "end":
      freeze();
      s.status = "ended";
      s.endedAt = at;
      return s;
    case "adjust": {
      const d = Math.round(finite(cmd.deltaMs));
      if (!d || Math.abs(d) > MAX_DURATION_MS) throw new TimerCommandError("invalid", "deltaMs must be a non-zero number of milliseconds");
      if (s.type === "countdown" || s.type === "scheduled") s.durationMs = clampMs(s.durationMs + d);
      else if (s.type === "deadline") {
        if (s.endAt != null) { if (Math.abs(s.endAt + d - at) > ANCHOR_RANGE_MS) throw new TimerCommandError("invalid", "The end time must stay within a week"); s.endAt += d; }
        else s.durationMs = clampMs(s.durationMs + d);
      }
      else if (s.type === "countup" || s.type === "stopwatch") {
        // Count-ups move the elapsed value; never below zero shown.
        const shown = s.startValueMs + Math.max(0, elapsedMs(s, at));
        const next = Math.max(0, shown + d);
        s.accumulatedMs += next - shown;
      } else if (s.type === "interval") {
        // Lengthen or shorten the run by moving elapsed time the other way.
        s.accumulatedMs -= d;
      }
      return s;
    }
    case "setDuration": {
      const ms = Math.round(finite(cmd.durationMs, -1));
      if (ms < 0 || ms > MAX_DURATION_MS) throw new TimerCommandError("invalid", "durationMs is out of range");
      s.durationMs = ms;
      if (s.type === "deadline" && s.status === "running") s.endAt = at + ms; // "finish in N from now"
      return s;
    }
    case "configure": {
      // Changing what the timer is resets it, except thresholds/overtime.
      const c = cmd.config || {};
      const typeChange = c.type && c.type !== s.type;
      const fresh = newTimer({
        type: c.type || s.type,
        durationMs: c.durationMs ?? s.durationMs,
        startValueMs: c.startValueMs ?? s.startValueMs,
        segments: c.segments ?? s.segments,
        rounds: c.rounds ?? s.rounds,
        scheduledAt: c.scheduledAt !== undefined ? c.scheduledAt : s.scheduledAt,
        endAt: c.endAt !== undefined ? c.endAt : s.endAt,
        overtime: c.overtime ?? s.overtime,
        thresholds: c.thresholds ?? s.thresholds,
      });
      const structural = typeChange || c.segments || c.rounds != null || c.startValueMs != null || c.scheduledAt !== undefined || c.endAt !== undefined;
      if (!structural) {
        return { ...s, durationMs: fresh.durationMs, overtime: fresh.overtime, thresholds: fresh.thresholds };
      }
      return { ...fresh, lastAt: s.lastAt };
    }
    default:
      throw new TimerCommandError("invalid", `Unknown action: ${cmd.action}`);
  }
}

/** True when a countdown-like timer has crossed zero between two instants. */
export function crossedZero(t, fromNow, toNow) {
  if (t.status !== "running") return false;
  const a = view(t, fromNow), b = view(t, toNow);
  if (b.remaining == null || a.remaining == null) return false;
  return a.remaining > 0 && b.remaining <= 0;
}

/** Server instant at which the timer reaches zero, or null. */
export function zeroAt(t) {
  if (t.type === "deadline") return t.status === "running" && t.endAt != null ? t.endAt : null;
  if (t.status !== "running" || t.startedAt == null) return null;
  const target = targetMs(t);
  if (target == null || !(t.type === "countdown" || t.type === "scheduled" || t.type === "interval")) return null;
  return t.startedAt + (target - t.accumulatedMs);
}

/**
 * Format a millisecond value for a timer face.
 *   hours: "auto" (only when needed) | "always" | "never" (minutes grow past 59)
 *   seconds, leadingZeros, millis (tenths/hundredths: 0 | 1 | 2)
 * Negative values (overtime) get a leading sign "+" (time past zero) when
 * `overtimeSign` is true.
 */
/** Remaining time rounds up (0.4 s left still reads 00:01); elapsed time (count-up, stopwatch) rounds down. */
export const roundsUp = (t) => !(t && (t.type === "countup" || t.type === "stopwatch"));

export function formatMs(ms, { hours = "auto", seconds = true, leadingZeros = true, millis = 0, overtimeSign = true, roundUp = true } = {}) {
  const neg = ms < 0;
  let a = Math.abs(ms);
  // Countdowns round UP so "0:00" appears only at zero, never a second early.
  const unit = seconds ? 1000 : 60000;
  const whole = millis ? Math.floor(a / unit) : (roundUp && !neg ? Math.ceil(a / unit - 1e-9) : Math.floor(a / unit));
  const totalSec = seconds ? whole : whole * 60;
  let h = Math.floor(totalSec / 3600);
  let m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (hours === "never" || (hours === "auto" && h === 0)) { m += h * 60; h = 0; }
  const pad = (n) => String(n).padStart(2, "0");
  let out;
  const showHours = hours === "always" || (hours === "auto" && h > 0);
  if (showHours) out = `${leadingZeros ? pad(h) : h}:${pad(m)}${seconds ? `:${pad(s)}` : ""}`;
  else out = seconds ? `${leadingZeros ? pad(m) : m}:${pad(s)}` : `${leadingZeros ? pad(m) : m}`;
  if (millis) {
    const frac = Math.floor((a % 1000) / (millis === 1 ? 100 : 10));
    out += `.${String(frac).padStart(millis, "0")}`;
  }
  return neg && overtimeSign ? `+${out}` : out;
}

/** Parse "1:30:00", "90", "90m", "1h 30m", "45s" into milliseconds, or null. */
export function parseDuration(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const p = s.split(":").map(Number);
    if (p.slice(1).some((n) => n > 59)) return null;
    const [h, m, sec] = p.length === 3 ? p : [0, p[0], p[1]];
    return ((h * 60 + m) * 60 + sec) * 1000;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60000); // bare number = minutes
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g;
  let total = 0, any = false, consumed = "";
  for (let m; (m = re.exec(s));) {
    any = true; consumed += m[0];
    const n = parseFloat(m[1]);
    total += m[2][0] === "h" ? n * 3600000 : m[2][0] === "m" ? n * 60000 : n * 1000;
  }
  if (!any || consumed.replace(/\s/g, "").length !== s.replace(/\s/g, "").length) return null;
  return Math.round(total);
}
