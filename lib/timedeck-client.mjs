// DocFila TimeDeck: a small client for the public HTTP API, shared by the
// venue bridge, the Companion module and the MCP server.
//
// Canonical copy: integrations/timedeck/shared/timedeck-client.mjs. Each
// package carries a byte-for-byte copy in lib/ (next to lib/timer.mjs, a copy
// of functions/timedeck/shared/timer.mjs), made by
// `node integrations/timedeck/sync.mjs`; each package has a test that fails
// on drift. Edit the canonical copy, then run the sync.
//
// No dependencies: Node 22's fetch, AbortController, WebSocket and EventEmitter.

import { EventEmitter } from "node:events";
import { view, formatMs, parseDuration } from "./timer.mjs";

export const DEFAULT_URL = "https://timedeck.docfila.com";
export const TRANSPORT = ["start", "pause", "resume", "toggle", "reset", "restart", "end"];
const TONES = ["info", "warning", "urgent"];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DECK_RE = /^[a-z0-9]{6,32}$/;
const RECENT_CUE_MS = 60000;
const DID_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** An API error ({error: {code, message, details}}) or a local validation error (status 0). */
export class TimeDeckError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.name = "TimeDeckError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
const invalid = (message) => new TimeDeckError(0, "invalid", message);

// A bare host on the venue network (loopback, RFC 1918, link-local) is
// almost always a plain-HTTP venue host; anything else defaults to HTTPS.
// Type the scheme ("https://10.0.0.5:8443") to override either default.
const LOCAL_HOST = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|\[?::1\]?|\[fe[89ab][0-9a-f]:[0-9a-f:%.\w]*\])$/i;

/** "https://host/", "https://host/api" and "host:5185" all become "https://host" style bases ("192.168.1.20:8080" -> http). */
export function normalizeBase(url) {
  let u = String(url || DEFAULT_URL).trim();
  if (!/^https?:\/\//i.test(u)) {
    const host = u.split("/")[0].replace(/:\d+$/, "");
    u = `${LOCAL_HOST.test(host) ? "http" : "https"}://${u}`;
  }
  return u.replace(/\/+$/, "").replace(/\/api$/, "");
}

/**
 * A duration in milliseconds from what an operator types or a console sends:
 * a number is milliseconds; a string of digits is milliseconds; anything else
 * uses TimeDeck's duration syntax ("1m", "90s", "1h 30m", "1:30", "0:45").
 * Returns null when it cannot be read.
 */
export function toMs(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === "bigint") return Number(v);
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const neg = s.startsWith("-");
  const ms = parseDuration(s.replace(/^[+-]/, ""));
  return ms == null ? null : neg ? -ms : ms;
}

/**
 * Estimates the server's clock from `serverNow` on each response (NTP style:
 * the sample with the smallest round trip wins; samples age out so a laptop
 * sleep or a clock change is picked up).
 */
export class ServerClock {
  constructor(localNow = Date.now) { this.localNow = localNow; this.offset = 0; this.rtt = Infinity; this.at = 0; this.synced = false; }
  sample(serverNow, t0, t1) {
    if (!Number.isFinite(serverNow)) return;
    const rtt = Math.max(0, t1 - t0);
    const stale = t1 - this.at > 30000;
    if (!this.synced || stale || rtt <= this.rtt + 20) {
      this.offset = serverNow + rtt / 2 - t1;
      this.rtt = rtt;
      this.at = t1;
      this.synced = true;
    }
  }
  now() { return this.localNow() + this.offset; }
}

/**
 * Turns one command object into the HTTP request(s) that perform it.
 * The command vocabulary is the same everywhere (OSC, WebSocket, HTTP shim,
 * Companion, MCP):
 *   {action: start|pause|resume|toggle|reset|restart|end, timerId?, at?}
 *   {action: "add"|"sub", ms?}           ms: number or "1m"; default stepMs
 *   {action: "adjust", deltaMs}
 *   {action: "duration", ms}             also "setDuration" with durationMs
 *   {action: "activate", timerId}
 *   {action: "message", text, tone?, style?, durationMs?, audience?, canvasIds?}
 *   {action: "clearMessage"}
 *   {action: "blackout", on: true|false|"toggle"}
 *   {action: "canvas", displayId, canvasId|null}
 *   {action: "session", sessionId}       make a rundown session live and restart its timer
 * `deck` (the last known control view) is needed for blackout toggle and session.
 * Returns [{method, path, body}] with paths relative to /api/decks/:id.
 */
export function toRequests(cmd, { deck = null, stepMs = 60000 } = {}) {
  if (!cmd || typeof cmd !== "object") throw invalid("A command object is required");
  const a = String(cmd.action || "");
  const timer = (o) => {
    if (cmd.timerId != null && cmd.timerId !== "") {
      if (!ID_RE.test(String(cmd.timerId))) throw invalid("timerId is not valid");
      o.timerId = String(cmd.timerId);
    }
    if (Number.isFinite(cmd.at)) o.at = cmd.at;
    return o;
  };
  const commands = (...list) => [{ method: "POST", path: "/commands", body: { commands: list } }];

  if (TRANSPORT.includes(a)) return commands(timer({ action: a }));
  switch (a) {
    case "add":
    case "sub": {
      const ms = cmd.ms === undefined || cmd.ms === null || cmd.ms === "" ? stepMs : toMs(cmd.ms);
      if (!ms) throw invalid(`${a} needs a non-zero duration such as 60000 or "1m"`);
      return commands(timer({ action: "adjust", deltaMs: a === "add" ? Math.abs(ms) : -Math.abs(ms) }));
    }
    case "adjust": {
      const d = toMs(cmd.deltaMs);
      if (!d) throw invalid("adjust needs a non-zero deltaMs");
      return commands(timer({ action: "adjust", deltaMs: d }));
    }
    case "duration":
    case "setDuration": {
      const ms = toMs(cmd.ms ?? cmd.durationMs);
      if (ms == null || ms < 0) throw invalid("duration needs a length such as 900000 or \"15m\"");
      return commands(timer({ action: "setDuration", durationMs: ms }));
    }
    case "activate": {
      if (!ID_RE.test(String(cmd.timerId || ""))) throw invalid("activate needs a timerId");
      return commands({ action: "activate", timerId: String(cmd.timerId) });
    }
    case "message": {
      const text = String(cmd.text ?? "").trim();
      if (!text) throw invalid("message needs text");
      const m = { text: text.slice(0, 280) };
      if (cmd.tone) { if (!TONES.includes(cmd.tone)) throw invalid("tone must be info, warning or urgent"); m.tone = cmd.tone; }
      if (cmd.style) { if (!["banner", "takeover"].includes(cmd.style)) throw invalid("style must be banner or takeover"); m.style = cmd.style; }
      const dur = cmd.durationMs == null || cmd.durationMs === "" || cmd.durationMs === 0 ? null : toMs(cmd.durationMs);
      if (dur != null) m.durationMs = dur;
      if (cmd.audience === true) m.audience = true;
      if (Array.isArray(cmd.canvasIds) && cmd.canvasIds.length) m.canvasIds = cmd.canvasIds.map(String);
      return [{ method: "POST", path: "/output", body: { message: m } }];
    }
    case "clearMessage":
      return [{ method: "POST", path: "/output", body: { message: null } }];
    case "blackout": {
      let on = cmd.on;
      if (on === "toggle" || on === undefined) on = !(deck && deck.output && deck.output.blackout);
      else if (typeof on !== "boolean") on = on === 1 || on === "1" || on === "true" || on === "on";
      return [{ method: "POST", path: "/output", body: { blackout: on } }];
    }
    case "canvas": {
      const did = String(cmd.displayId || "");
      if (!DID_RE.test(did)) throw invalid("displayId must be 8-40 letters, digits, - or _");
      const c = cmd.canvasId;
      const canvasId = c === null || c === undefined || c === "" || c === "none" ? null : String(c);
      return [{ method: "PATCH", path: `/displays/${encodeURIComponent(did)}`, body: { canvasId } }];
    }
    case "session": {
      const sid = String(cmd.sessionId || "");
      const s = deck && Array.isArray(deck.sessions) ? deck.sessions.find((x) => x.id === sid) : null;
      if (!s) throw invalid(`No session "${sid}" in this deck`);
      const patch = { activeSessionId: sid };
      const tid = s.timerId && deck.timers && Object.hasOwn(deck.timers, s.timerId) ? s.timerId : null;
      if (tid) patch.activeTimerId = tid;
      const out = [{ method: "PATCH", path: "", body: patch }];
      out.push({ method: "POST", path: "/commands", body: { commands: [{ action: "restart", timerId: tid || deck.activeTimerId }] } });
      return out;
    }
    default:
      throw invalid(`Unknown action "${a}"`);
  }
}

/**
 * HTTP client for one deck. `token` is the control token, or the moderator
 * token for a console that only sends messages and blackout (every other
 * write then answers 403 forbidden). `passcode` is sent as X-Deck-Passcode
 * with the token: needed only when the operator protected the viewer or
 * audience link and this client follows the deck with that link's token.
 * `clientId` (8-40 letters, digits, - or _) is sent as X-Deck-Client: the
 * server counts wrong passcodes per device, so give each machine its own.
 */
export class TimeDeckClient {
  constructor({ url = DEFAULT_URL, deck = "", token = "", passcode = "", clientId = "", fetch: f = globalThis.fetch, timeoutMs = 10000, userAgent = "timedeck-integration" } = {}) {
    this.base = normalizeBase(url);
    this.deck = String(deck || "").trim();
    this.token = String(token || "").trim();
    this.passcode = String(passcode || "").trim();
    this.clientId = /^[A-Za-z0-9_-]{8,40}$/.test(String(clientId || "")) ? String(clientId) : "";
    this.fetch = f;
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.clock = new ServerClock();
    // Set when the server marks its answers with X-TimeDeck-Socket: 1 (the
    // venue host, the dev server; never the cloud): DeckFollower then
    // follows over GET /api/decks/:id/socket and sends commands on it.
    this.socketOffered = false;
    this.socket = null; // {ready(), cmd(commands)}: the follower's open socket
  }

  /** Throws a TimeDeckError unless url, deck and token look usable. */
  check() {
    if (!DECK_RE.test(this.deck)) throw invalid("Deck id is missing or not valid (6-32 lowercase letters and digits)");
    if (!this.token) throw invalid("Token is missing (the control or moderator token)");
  }

  async request(method, path, { body, token = this.token, timeoutMs = this.timeoutMs, signal, sampleClock = true } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new TimeDeckError(0, "timeout", `No answer from ${this.base} within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    const headers = { Accept: "application/json", "User-Agent": this.userAgent };
    if (token) headers["X-Deck-Token"] = token;
    if (token && this.passcode) headers["X-Deck-Passcode"] = this.passcode;
    if (token && this.clientId) headers["X-Deck-Client"] = this.clientId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const t0 = Date.now();
    let res, text;
    try {
      // redirect: "error": the control token must never follow a redirect to
      // another origin (a captive portal, a hijacked DNS name).
      res = await this.fetch(this.base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal, redirect: "error" });
      text = await res.text();
    } catch (e) {
      if (ctrl.signal.aborted && ctrl.signal.reason instanceof TimeDeckError) throw ctrl.signal.reason;
      if (signal && signal.aborted) throw e;
      throw new TimeDeckError(0, "network", `Cannot reach ${this.base}: ${e.cause?.code || e.message}`);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    if (res.headers && typeof res.headers.get === "function" && res.headers.get("x-timedeck-socket") === "1") this.socketOffered = true;
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (sampleClock && json && Number.isFinite(json.serverNow)) this.clock.sample(json.serverNow, t0, Date.now());
    if (!res.ok) {
      const e = json && json.error;
      throw new TimeDeckError(res.status, (e && e.code) || `http_${res.status}`, (e && e.message) || `HTTP ${res.status}`, e && e.details);
    }
    return json || {};
  }

  path(suffix = "") { return `/api/decks/${encodeURIComponent(this.deck)}${suffix}`; }

  /** The control view, or {unchanged, rev} when `rev` is current. */
  getDeck(rev, opts = {}) { return this.request("GET", this.path(Number.isFinite(rev) ? `?rev=${rev}` : ""), opts); }
  /** Long-poll: holds up to 25 s, returns the view or {unchanged} (with retryMs when the server is busy). 404 where the server has no /wait. */
  waitDeck(rev, { holdMs, ...opts } = {}) {
    const t = Number.isFinite(holdMs) ? `&t=${Math.round(holdMs)}` : "";
    return this.request("GET", this.path(`/wait?rev=${rev}${t}`), { timeoutMs: 40000, sampleClock: false, ...opts });
  }
  /** POST /commands, over the follower's socket when one is open (same answer). */
  commands(list) {
    if (this.socket && this.socket.ready()) return this.socket.cmd(list);
    return this.request("POST", this.path("/commands"), { body: { commands: list } });
  }
  output(body) { return this.request("POST", this.path("/output"), { body }); }
  publish(body) { return this.request("PATCH", this.path(""), { body }); }
  displays() { return this.request("GET", this.path("/displays")); }
  time() { return this.request("GET", "/api/time", { token: "" }); }

  /** Run one command object (see toRequests). Returns the last response. */
  async run(cmd, { deck = null, stepMs } = {}) {
    this.check();
    const reqs = toRequests(cmd, { deck, stepMs });
    let last = null;
    for (const r of reqs) last = r.path === "/commands" ? await this.commands(r.body.commands) : await this.request(r.method, this.path(r.path), { body: r.body });
    return last;
  }

  /** Create a deck (no token needed). Returns {id, controlToken, viewToken, audienceToken, deck}. */
  static create(url, body, { fetch: f } = {}) {
    const c = new TimeDeckClient({ url, fetch: f });
    return c.request("POST", "/api/decks", { body, token: "" });
  }
}

/** The shareable links of a deck, as the web app builds them. */
export function deckLinks(base, { id, controlToken, viewToken, audienceToken, moderatorToken }) {
  const b = normalizeBase(base);
  const e = encodeURIComponent;
  return {
    operator: controlToken ? `${b}/timer#join=${id}.${e(controlToken)}` : null,
    moderator: moderatorToken ? `${b}/timer#mod=${id}.${e(moderatorToken)}` : null,
    viewer: viewToken ? `${b}/v/${id}#k=${e(viewToken)}` : null,
    audience: audienceToken ? `${b}/a/${id}#k=${e(audienceToken)}` : null,
  };
}

function clockText(now, zone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: zone || "UTC" }).format(new Date(now));
  } catch { return new Date(now).toISOString().slice(11, 19); }
}

/**
 * Everything a production tool shows, for one timer (the active one unless
 * `timerId` names another) at server time `now`. Plain JSON, no functions.
 */
export function snapshot(deck, now, { timerId = null } = {}) {
  if (!deck || !deck.timers) return { connected: false, time: "--:--", remainingMs: null, status: "normal", phase: "idle", timerName: "", timerId: null };
  const has = (id) => id != null && Object.hasOwn(deck.timers, id);
  const tid = timerId && has(timerId) ? timerId : deck.activeTimerId;
  const t = has(tid) ? deck.timers[tid] : null;
  const v = t ? view(t, now) : null;
  const sessions = Array.isArray(deck.sessions) ? deck.sessions : [];
  const i = sessions.findIndex((s) => s.id === deck.activeSessionId);
  const next = i >= 0 ? sessions[i + 1] : sessions.find((s) => s.status === "planned");
  const out = deck.output || {};
  const msg = out.message && (out.message.until == null || out.message.until > now) ? out.message : null;
  const zone = deck.event && deck.event.referenceZone;
  return {
    connected: true,
    deckId: deck.id,
    rev: deck.rev,
    timerId: tid || null,
    timerName: t ? t.name || "" : "",
    timerType: t ? t.type : null,
    phase: v ? v.phase : "idle",
    status: v ? v.status : "normal",
    time: !v ? "--:--" : t.type === "clock" ? clockText(now, zone) : formatMs(v.ms),
    ms: v ? Math.round(v.ms) : 0,
    remainingMs: v && v.remaining != null ? Math.round(v.remaining) : null,
    elapsedMs: v ? Math.round(v.elapsed) : 0,
    durationMs: t ? t.durationMs : 0,
    progress: v && v.progress != null ? Math.round(v.progress * 1000) / 1000 : null,
    overtime: v ? !!v.overtime : false,
    running: !!v && (v.phase === "running" || v.phase === "waiting"),
    eventName: deck.event ? deck.event.name || "" : "",
    sessionId: i >= 0 ? sessions[i].id : null,
    sessionTitle: i >= 0 ? sessions[i].title || "" : "",
    nextSession: next ? next.title || "" : "",
    blackout: !!out.blackout,
    message: msg ? msg.text : null,
    messageTone: msg ? msg.tone : null,
    serverNow: now,
  };
}

/**
 * Cue firings in `next` that `seq` (the newest firing already seen) does not
 * cover: the deck's `automation.state.log` (show automation, server side),
 * oldest first. Each entry: {seq, cueId, name, at, event, test, actions,
 * osc: [{address, args}], sound: [{sound, volume}]}.
 */
export function newCueFirings(next, seq) {
  const log = next && next.automation && next.automation.state && Array.isArray(next.automation.state.log) ? next.automation.state.log : [];
  return log.filter((e) => e && Number.isFinite(e.seq) && e.seq > seq).sort((a, b) => a.seq - b.seq);
}

const SOCKET_PING_MS = 3000;
const SOCKET_RETRY_MS = 60000;

/**
 * Follows one deck: a full read first, then the long-poll
 * (GET /wait?rev=N) when the server has it, else polling every `pollMs` with
 * the rev short-circuit. Where the server offers the WebSocket transport (the
 * venue host; `socket: false` turns it off) the follower moves to it after
 * the first long-poll answer: views are pushed, commands (client.commands,
 * client.run) ride it with POST's answers, and a ping every few seconds
 * keeps the clock. When it drops, the follower reconnects with its rev (the
 * server catches it up); when it cannot open, the long-poll carries on and
 * the socket is tried again after a minute. Survives network loss: retries with backoff and logs
 * one line when the link drops and one when it returns.
 *
 * Events: "deck" (deck), "online", "offline" (error), "log" (level, text),
 * "cue" (firing): a cue the server fired after this follower started (see
 * newCueFirings); firings from before the first read are not replayed.
 */
export class DeckFollower extends EventEmitter {
  constructor(client, { pollMs = 1000, longPoll = true, maxBackoffMs = 10000, stepMs = 60000, socket = true } = {}) {
    super();
    this.client = client;
    this.socketOn = socket !== false && longPoll;
    this.socketAfter = 0;
    this.ws = null;
    this.pollMs = pollMs;
    this.mode = longPoll ? "probe" : "poll"; // probe | long | poll
    this.maxBackoffMs = maxBackoffMs;
    this.stepMs = stepMs;
    this.deck = null;
    this.cueSeq = null; // the newest cue firing seen (null until the first read)
    this.online = null; // unknown until the first answer
    this.lastError = null;
    this.running = false;
    this.ctrl = null;
    this.lastTimeSync = 0;
    this.instantUnchanged = 0; // consecutive {unchanged} answers that came at once
    this._wake = null;
  }

  log(level, text) { this.emit("log", level, text); }
  now() { return this.client.clock.now(); }
  snapshot(opts) { return snapshot(this.deck, this.now(), opts); }

  start() {
    if (this.running) return this;
    this.running = true;
    this.ctrl = new AbortController();
    this._loop().catch((e) => this.log("error", `follower stopped: ${e.message}`));
    return this;
  }

  stop() {
    this.running = false;
    if (this.ctrl) this.ctrl.abort();
    if (this.ws) { try { this.ws.close(); } catch { /* closed */ } }
    if (this._wake) this._wake();
  }

  /** The mode the deck is followed in: probe, long, poll, or socket while one is open. */
  get transport() { return this.client.socket && this.client.socket.ready() ? "socket" : this.mode; }

  /**
   * One socket session: resolves when it ends, with whether it got as far as
   * "ready". Throws the server's final answer (401 / 403 / 404, a passcode
   * code) as a TimeDeckError, as the long-poll would.
   */
  _socketSession() {
    const c = this.client;
    const url = `${c.base.replace(/^http/, "ws")}${c.path("/socket")}`;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch { resolve(false); return; }
      this.ws = ws;
      let ready = false, final = null, seq = 0, pingTimer = null, heard = Date.now();
      const answers = new Map(), pings = new Map();
      const send = (o) => { try { ws.send(JSON.stringify(o)); return true; } catch { return false; } };
      const ping = () => { const n = ++seq; if (pings.size > 50) pings.clear(); pings.set(n, Date.now()); send({ t: "ping", n }); };
      const handle = {
        ready: () => ready && ws.readyState === 1,
        cmd: (commands) => new Promise((ok, fail) => {
          const n = ++seq;
          const timer = setTimeout(() => { answers.delete(n); fail(new TimeDeckError(0, "timeout", `No answer from ${c.base} within ${Math.round(c.timeoutMs / 1000)} s`)); }, c.timeoutMs);
          answers.set(n, { ok, fail, timer });
          if (!send({ t: "cmd", n, commands })) { clearTimeout(timer); answers.delete(n); fail(new TimeDeckError(0, "network", `Cannot reach ${c.base}`)); }
        }),
      };
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(pingTimer);
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try { ws.close(); } catch { /* closed */ }
        if (this.ws === ws) this.ws = null;
        if (c.socket === handle) c.socket = null;
        // A command whose answer never came: the caller sees a network error (resend with the same ids).
        for (const a of answers.values()) { clearTimeout(a.timer); a.fail(new TimeDeckError(0, "network", `Lost the connection to ${c.base}`)); }
        answers.clear();
        if (final) reject(final); else resolve(ready);
      };
      ws.onopen = () => send({ t: "hello", token: c.token, rev: this.deck ? this.deck.rev : null, ...(c.passcode ? { passcode: c.passcode } : {}), ...(c.clientId ? { client: c.clientId } : {}) });
      ws.onmessage = (e) => {
        const at = Date.now();
        heard = at;
        let m;
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === "view") { if (m.data && !(this.deck && m.data.rev <= this.deck.rev)) this._apply(m.data); }
        else if (m.t === "pong") { const t0 = pings.get(m.n); pings.delete(m.n); if (t0 != null) c.clock.sample(m.serverNow, t0, at); }
        else if (m.t === "ans") {
          const a = answers.get(m.n);
          if (!a) return;
          answers.delete(m.n);
          clearTimeout(a.timer);
          if (m.status >= 200 && m.status < 300) a.ok(m.body || {});
          else { const er = m.body && m.body.error; a.fail(new TimeDeckError(m.status, (er && er.code) || `http_${m.status}`, (er && er.message) || `HTTP ${m.status}`, er && er.details)); }
        } else if (m.t === "ready") {
          ready = true;
          c.socket = handle;
          this._up();
          this.log("info", "following the deck over the venue socket");
          ping();
          pingTimer = setInterval(() => { if (Date.now() - heard > 2 * SOCKET_PING_MS + 2000) end(); else ping(); }, SOCKET_PING_MS);
        } else if (m.t === "error") {
          const er = new TimeDeckError(m.status, m.code || `http_${m.status}`, m.message || `HTTP ${m.status}`, m.details);
          if (m.status === 401 || m.status === 403 || m.status === 404 || String(m.code).startsWith("passcode_")) final = er;
        }
      };
      ws.onclose = end;
      ws.onerror = end;
    });
  }

  _sleep(ms) {
    return new Promise((r) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); r(); }
      this._wake = done;
    });
  }

  _apply(r) {
    if (!r || r.unchanged) return;
    if (!r.timers) return;
    this.deck = r;
    const st = r.automation && r.automation.state;
    const top = st && Number.isFinite(st.seq) ? st.seq : 0;
    if (this.cueSeq === null || top < this.cueSeq) this.cueSeq = top; // first read, or a new deck
    else {
      // After an outage the log holds what fired meanwhile; a burst of old
      // "go"s to a console would be wrong, so only recent firings are emitted.
      const ref = Number.isFinite(r.serverNow) ? r.serverNow : Date.now();
      for (const f of newCueFirings(r, this.cueSeq)) if (!Number.isFinite(f.at) || ref - f.at <= RECENT_CUE_MS) this.emit("cue", f);
      this.cueSeq = top;
    }
    this.emit("deck", r);
  }

  _up() {
    if (this.online !== true) {
      if (this.online === false) this.socketAfter = 0; // back from an outage: try the socket again now
      if (this.online === false) this.log("info", `reconnected to ${this.client.base} (deck ${this.client.deck}, rev ${this.deck ? this.deck.rev : "?"})`);
      this.online = true;
      this.lastError = null;
      this.emit("online");
    }
  }

  _down(e) {
    const first = this.online !== false || (this.lastError && this.lastError.code !== e.code);
    this.online = false;
    this.lastError = e;
    if (first) {
      const hint = String(e.code).startsWith("passcode_") ? " (this link has a passcode: set the current one in the connection settings)" : e.status === 401 || e.code === "revoked" ? " (check the token; it may have been replaced)" : e.status === 404 ? " (check the deck id; the deck may have been deleted)" : "; retrying quietly";
      this.log("warn", `lost TimeDeck: ${e.message}${hint}`);
      this.emit("offline", e);
    }
  }

  async _loop() {
    let backoff = 1000;
    const signal = this.ctrl.signal;
    while (this.running) {
      try {
        this.client.check();
        const c0 = this.client;
        if (!this.deck) {
          this._apply(await this.client.getDeck(undefined, { signal }));
        } else if (this.mode === "long" && this.socketOn && c0.socketOffered && typeof WebSocket === "function" && Date.now() >= this.socketAfter) {
          // The socket session runs until it ends; then the loop goes on
          // (straight back to the socket after a drop, else the long-poll).
          const wasReady = await this._socketSession();
          const t = Date.now();
          this.socketDrops = (this.socketDrops || []).filter((x) => t - x < 60000);
          if (wasReady) this.socketDrops.push(t);
          // Never opened, or dropped three times in a minute: the long-poll for a while.
          if (!wasReady || this.socketDrops.length >= 3) this.socketAfter = t + SOCKET_RETRY_MS;
          continue;
        } else if (this.mode === "probe" || this.mode === "long") {
          let r;
          const t0 = Date.now();
          // The probe and the first call after an outage hold only briefly
          // (t=500), so support is detected and "online" reported at once.
          const holdMs = this.mode === "probe" || this.online !== true ? 500 : undefined;
          try { r = await this.client.waitDeck(this.deck.rev, { signal, holdMs }); }
          catch (e) {
            if (!(e instanceof TimeDeckError) || e.status !== 404) throw e;
            // 404 from /wait: either no long-poll on this server or no deck.
            const plain = await this.client.getDeck(this.deck.rev, { signal });
            if (this.mode === "probe") this.log("info", "long-poll not available on this server; polling every second");
            this.mode = "poll";
            r = plain;
          }
          if (this.mode === "probe") { this.mode = "long"; if (!(this.socketOn && c0.socketOffered)) this.log("info", "following the deck with long-poll"); }
          this._apply(r);
          // Over the server's per-address cap of held waits the answer comes
          // at once with retryMs: wait that long (the hall degrades to
          // polling). Any other instant answer, again and again, would spin:
          // keep at least 100 ms between calls, doubling to 1 s while the
          // instant answers say {unchanged} (a proxy that ends held requests
          // at once); a real change resets it.
          const instant = Date.now() - t0 < 100;
          if (r && r.timers) this.instantUnchanged = 0;
          if (r && Number.isFinite(r.retryMs)) await this._sleep(Math.min(30000, Math.max(100, r.retryMs)));
          else if (instant && r && r.unchanged) await this._sleep(Math.min(1000, 100 * 2 ** Math.min(4, this.instantUnchanged++)));
          else if (instant) await this._sleep(100);
          if (this.mode === "long" && Date.now() - this.lastTimeSync > 30000) {
            this.lastTimeSync = Date.now();
            await this.client.time().catch(() => {});
          }
        } else {
          this._apply(await this.client.getDeck(this.deck.rev, { signal }));
        }
        this._up();
        backoff = 1000;
        if (this.mode === "poll") await this._sleep(this.pollMs);
      } catch (e) {
        if (!this.running) break;
        const err = e instanceof TimeDeckError ? e : new TimeDeckError(0, "network", e.message);
        this._down(err);
        // Auth and missing-deck errors will not fix themselves quickly.
        const wait = err.status === 401 || err.status === 403 || err.status === 404 || String(err.code).startsWith("passcode_") ? 15000 : Math.min(backoff, this.maxBackoffMs);
        backoff = Math.min(this.maxBackoffMs, backoff * 2);
        await this._sleep(wait);
      }
    }
  }

  /** Run a command, fold the answer into the local deck at once, return the answer. */
  async exec(cmd) {
    const r = await this.client.run(cmd, { deck: this.deck, stepMs: this.stepMs });
    // Fold the answer in for an instant update, but keep the old rev so the
    // next poll still fetches anything else that changed in between.
    if (this.deck && r) {
      if (r.timers) this.deck = { ...this.deck, timers: r.timers, activeTimerId: r.activeTimerId || this.deck.activeTimerId };
      else if (r.output) this.deck = { ...this.deck, output: r.output };
      this.emit("deck", this.deck);
    }
    this._up();
    if (this._wake && this.mode === "poll") this._wake();
    return r;
  }
}
