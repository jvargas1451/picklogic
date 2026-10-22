import { useState, useEffect, useCallback } from "react";
import config from "./config";
import { supabase } from "./supabase";

// Mega Millions rules changed with the 2025-04-08 draw: Mega Ball 1-25 became 1-24,
// $5 per play with a built-in 2X to 10X multiplier, new prize table (see PRIZES).
// Every range check, input min/max and validation message reads from here.
const GAMES = {
  pb: { name: "Powerball", main: [1, 69], special: [1, 26], mainCount: 5, class: "pb", odds: "1 in 292,201,338" },
  mm: { name: "Mega Millions", main: [1, 70], special: [1, 24], mainCount: 5, class: "mm", odds: "1 in 290,472,336" },
};

const MODES = {
  random: { label: "Random", rationale: "Five unique numbers drawn at random — no bias, no system." },
  balanced: { label: "Balanced", rationale: "Distributed across low, mid, and high ranges for variety." },
  hot: { label: "Hot Numbers", rationale: "Weighted toward your most-played numbers from saved tickets." },
  cold: { label: "Cold Numbers", rationale: "Weighted toward numbers you've played least often." },
};
// Logged-out visitors get the modes that need no ticket history.
const GUEST_MODES = ["random", "balanced"];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Dates ─────────────────────────────────────────────────────
// Format a Date as YYYY-MM-DD using its LOCAL calendar components.
//
// Never use toISOString() for this. toISOString() converts to UTC first, so in
// any negative-offset timezone an evening date rolls forward a day — e.g. 8pm
// PT on Aug 5 serialises as "2026-08-06". That is how a quick-pick saved the
// evening before a draw could land on the wrong draw_date and never settle.
// This is the same UTC-mixing bug class already fixed once in getDrawReminders.
function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Parse a YYYY-MM-DD string into a LOCAL Date, or null if it isn't a real date.
//
// Do NOT use `new Date("2026-08-08")` here: JS parses a bare date string as UTC
// midnight, so .getDay() returns the wrong weekday in any negative-offset
// timezone. Building from components keeps it local, and the weekday of a draw
// date is a property of the date itself — this gives the same answer anywhere.
function parseLocalDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  // Reject values that silently roll over, e.g. "2026-02-31" -> Mar 3.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

// ── Draw-date rules ───────────────────────────────────────────
// Draw weekdays, 0=Sun. Single source of truth: used by validation, the
// non-draw-day warning, and getDrawReminders. Do not re-declare these inline.
const DRAW_DAYS = { pb: [1, 3, 6], mm: [2, 5] };
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Hard bounds. MIN is the first Mega Millions draw under the current rules
// (2025-04-08); earlier tickets would be checked against the wrong prize table.
// Applies to both games (draw history starts 2026-06-03 anyway). Beyond
// MAX_DAYS_AHEAD is past any real advance-play window.
const MIN_DRAW_DATE = "2025-04-08";
const MAX_DRAW_DATE_DAYS_AHEAD = 35;

function maxDrawDate() {
  const n = new Date();
  return toLocalDateString(new Date(n.getFullYear(), n.getMonth(), n.getDate() + MAX_DRAW_DATE_DAYS_AHEAD));
}

// Returns an error string to block the save, or null if the date is acceptable.
function validateDrawDate(str) {
  if (!str) return "Enter a draw date";
  if (!parseLocalDate(str)) return "Enter a valid draw date";
  // Safe as a string compare: the format is already validated and zero-padded.
  if (str < MIN_DRAW_DATE) return `Draw date can't be before ${MIN_DRAW_DATE}`;
  if (str > maxDrawDate()) return `Draw date can't be more than ${MAX_DRAW_DATE_DAYS_AHEAD} days out`;
  return null;
}

// Token identifying what the user was warned about. Keyed on game AND date, so
// changing either one re-arms the warning rather than leaving it armed.
function warnKey(game, str) {
  return `${game}|${str}`;
}

// Returns warning copy if the date isn't a draw night for this game, else null.
// This is a SOFT check — it warns and allows the save; it never blocks.
function nonDrawDayWarning(game, str) {
  const dt = parseLocalDate(str);
  if (!dt) return null;
  if ((DRAW_DAYS[game] || []).includes(dt.getDay())) return null;
  return `Heads up — ${GAMES[game].name} doesn't draw on ${WEEKDAY_NAMES[dt.getDay()]}. Save anyway?`;
}

// "Powerball draws Mon, Wed and Sat". Used as the HARD error when checking a
// non-draw day (no result can exist). Saving keeps the soft warning above.
function drawDaysLabel(game) {
  const names = (DRAW_DAYS[game] || []).map(d => WEEKDAY_NAMES[d].slice(0, 3));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
  return `${GAMES[game].name} draws ${list}`;
}

// "Wed, Oct 21" for a YYYY-MM-DD draw date, or the raw string if unparseable.
function formatDrawDate(str) {
  const dt = parseLocalDate(str);
  return dt ? dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : str;
}

// ── Next draw ─────────────────────────────────────────────────
// Two anchors, on purpose. Do not collapse them into one.
//   WHICH draw is next  -> America/New_York. Draws are Eastern-time events
//     (Powerball 10:59pm ET, Mega Millions 11:00pm ET) and the official draw
//     DATE is the ET calendar date. Intl handles DST; no hand-rolled offsets.
//   WHETHER to say "Tonight" -> the viewer's local calendar day. At Mon 9pm
//     Pacific it is already Tue in ET, but a Pacific viewer's Tuesday draw is
//     tomorrow night, not tonight.
// Other anchors in the app (check-in = Los Angeles, getDrawReminders and ticket
// draw dates = viewer local, cron = UTC) are separate rules. Leave them alone.
const DRAW_TZ = "America/New_York";
const DRAW_CUTOFF_HOUR_ET = 23; // at/after 23:00 ET today's draw is over

// Official date (YYYY-MM-DD, ET calendar) of the next draw for a game.
function nextDrawDate(game, now = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: DRAW_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).forEach(p => { parts[p.type] = p.value; });
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  const hour = Number(parts.hour);
  const days = DRAW_DAYS[game] || [];
  // Walk forward from the ET calendar date. Pure UTC arithmetic on a bare
  // calendar date, so there is no DST involved in the day stepping.
  for (let i = 0; i <= 7; i++) {
    const c = new Date(Date.UTC(y, m - 1, d + i));
    if (!days.includes(c.getUTCDay())) continue;
    if (i === 0 && hour >= DRAW_CUTOFF_HOUR_ET) continue;
    return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, "0")}-${String(c.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

// Card label: "Tonight" if the draw date is the viewer's local today, else
// "Wed, Oct 21". viewerToday is injectable (YYYY-MM-DD) for tests; by default
// it is the device's local date via toLocalDateString, never toISOString.
function nextDrawLabel(game, now = new Date(), viewerToday = toLocalDateString(now)) {
  const str = nextDrawDate(game, now);
  const dt = parseLocalDate(str);
  if (!dt) return "";
  if (str === viewerToday) return "Tonight";
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ── Email typo guard ──────────────────────────────────────────
// Common misspellings of major mail domains. Email confirmation is off, so a
// mistyped address would silently break password recovery. Single source of
// truth for the typo guard; do not re-declare inline.
const EMAIL_DOMAIN_TYPOS = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
};

// Returns warning copy if the email's domain looks like a known typo, else null.
// This is a SOFT check — same arm/confirm shape as nonDrawDayWarning; it never blocks.
function emailTypoWarning(email) {
  const str = (email || "").trim();
  const at = str.lastIndexOf("@");
  if (at < 0) return null;
  const domain = str.slice(at + 1).toLowerCase();
  const fix = EMAIL_DOMAIN_TYPOS[domain];
  if (!fix) return null;
  return `Did you mean ${str.slice(0, at)}@${fix}?`;
}

function pickUnique(count, min, max, weights) {
  const nums = [];
  if (weights) {
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    for (let i = 0; i < count; i++) {
      const remaining = pool.filter((n) => !nums.includes(n));
      const w = remaining.map((n) => weights[n] || 1);
      const total = w.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, cum = 0;
      let picked = false;
      for (let j = 0; j < remaining.length; j++) {
        cum += w[j];
        if (r <= cum) { nums.push(remaining[j]); picked = true; break; }
      }
      if (!picked) nums.push(remaining[remaining.length - 1]);
    }
  } else {
    while (nums.length < count) {
      const n = randInt(min, max);
      if (!nums.includes(n)) nums.push(n);
    }
  }
  return nums.sort((a, b) => a - b);
}

// ── Prize tables ──────────────────────────────────────────────
// Single source of truth for prize labels. Keyed by game, then tier key
// "<main matched>+<special matched 0/1>". A tier present here means a winning
// ticket: exactly "special matched OR 3+ main", the same rule bright-api uses
// to settle won/lost. Changing tiers still falls under the three-place SYNC NOTE.
//
// mm `base` is the 1X figure and is never actually paid: every $5 play carries
// a built-in 2X to 10X multiplier, so mm labels show the range only.
// Source: megamillions.com How to Play (2X to 10X table), verified 2026-10-21.
// pb `base` is the real prize without the optional Power Play.
const MM_MULTIPLIER = { type: "built-in", values: [2, 3, 4, 5, 10] };
const PB_POWER_PLAY = { type: "optional", name: "Power Play", match5Cap: 2000000 };
const JACKPOT_TIER = { base: null, multiplier: null };

const PRIZES = {
  pb: {
    "5+1": JACKPOT_TIER,
    "5+0": { base: 1000000, multiplier: PB_POWER_PLAY },
    "4+1": { base: 50000, multiplier: PB_POWER_PLAY },
    "4+0": { base: 100, multiplier: PB_POWER_PLAY },
    "3+1": { base: 100, multiplier: PB_POWER_PLAY },
    "3+0": { base: 7, multiplier: PB_POWER_PLAY },
    "2+1": { base: 7, multiplier: PB_POWER_PLAY },
    "1+1": { base: 4, multiplier: PB_POWER_PLAY },
    "0+1": { base: 4, multiplier: PB_POWER_PLAY },
  },
  mm: {
    "5+1": JACKPOT_TIER,
    "5+0": { base: 1000000, multiplier: MM_MULTIPLIER },
    "4+1": { base: 10000, multiplier: MM_MULTIPLIER },
    "4+0": { base: 500, multiplier: MM_MULTIPLIER },
    "3+1": { base: 200, multiplier: MM_MULTIPLIER },
    "3+0": { base: 10, multiplier: MM_MULTIPLIER },
    "2+1": { base: 10, multiplier: MM_MULTIPLIER },
    "1+1": { base: 7, multiplier: MM_MULTIPLIER },
    "0+1": { base: 5, multiplier: MM_MULTIPLIER },
  },
};

const SPECIAL_ABBR = { pb: "PB", mm: "MB" };
const SPECIAL_NAME = { pb: "Powerball", mm: "Mega Ball" };

function prizeTierKey(matchedMain, matchedSpecial) {
  return `${matchedMain}+${matchedSpecial ? 1 : 0}`;
}

// $1M / $10M for whole millions, otherwise $50,000 style.
function formatPrize(n) {
  if (n >= 1000000 && n % 1000000 === 0) return `$${n / 1000000}M`;
  return `$${n.toLocaleString("en-US")}`;
}

// Label for a non-jackpot winning tier. Kept short to fit one line on a 375px card.
// `multiplier` (optional, mm only): the ticket's printed multiplier. When given,
// the label shows the exact amount ("$1,000 at 5X") instead of the range.
function prizeLabel(game, key, multiplier) {
  const tier = PRIZES[game][key];
  const [main, special] = key.split("+").map(Number);
  const abbr = SPECIAL_ABBR[game];
  const name = main === 0 ? `Matched ${abbr}`
    : special ? `Matched ${main} + ${abbr}` : `Matched ${main}`;
  const m = tier.multiplier;
  if (m.type === "built-in") {
    if (multiplier && m.values.includes(multiplier)) {
      return `${name} · ${formatPrize(tier.base * multiplier)} at ${multiplier}X`;
    }
    const lo = Math.min(...m.values), hi = Math.max(...m.values);
    return `${name} · ${formatPrize(tier.base * lo)} to ${formatPrize(tier.base * hi)}`;
  }
  if (key === "5+0" && m.match5Cap) {
    return `${name} · ${formatPrize(tier.base)} base (${formatPrize(m.match5Cap)} w/ PP)`;
  }
  return `${name} · ${formatPrize(tier.base)} base`;
}

// ── Result checking ───────────────────────────────────────────
const RESULT_STYLE = {
  jackpot: { color: "#f5a623", bg: "rgba(245,166,35,0.15)", border: "rgba(245,166,35,0.4)" },
  win: { color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" },
  none: { color: "#6b6b82", bg: "rgba(107,107,130,0.1)", border: "#2a2a38" },
};

function findDraw(draws, game, drawDate) {
  return draws.find(d => d.game === game && d.draw_date === drawDate) || null;
}

// The ONLY place in App.js that decides win/lose (via PRIZES). See SYNC NOTE.
// `multiplier` only changes the label wording, never the outcome.
function checkResult(ticket, draws, multiplier) {
  const draw = findDraw(draws, ticket.game, ticket.draw_date);
  if (!draw) return null;
  const table = PRIZES[ticket.game];
  if (!table) return null;

  const matchedMain = ticket.numbers.filter(n => draw.numbers.includes(n)).length;
  const matchedSpecial = ticket.special === draw.special;
  const key = prizeTierKey(matchedMain, matchedSpecial);
  const tier = table[key];

  if (!tier) return { tier: "none", label: "No match", ...RESULT_STYLE.none };
  if (tier.base === null) return { tier: "jackpot", label: "🏆 JACKPOT", ...RESULT_STYLE.jackpot };
  return { tier: "win", label: prizeLabel(ticket.game, key, multiplier), ...RESULT_STYLE.win };
}

// ── Ticket checker ────────────────────────────────────────────
// One form for checking a ticket and (logged in) saving it. Numbers are kept as
// strings while typing; validateTicketForm turns them into a ticket object.
// pickMode: "manual" for typed tickets; a generated pick keeps its mode until a number is edited.
const EMPTY_TICKET_FORM = { game: "pb", numbers: ["", "", "", "", ""], special: "", drawDate: "", multiplier: "", notes: "", pickMode: "manual" };

// Most recent draw date on file for a game (YYYY-MM-DD), or "" if none loaded.
function latestDrawDate(draws, game) {
  return draws.filter(d => d.game === game).reduce((max, d) => (d.draw_date > max ? d.draw_date : max), "");
}

// Digits only, at most 2. min/max on an input do not restrict typing.
function cleanNumberInput(value) {
  return String(value).replace(/\D/g, "").slice(0, 2);
}

// Returns { error } or { ticket: { game, numbers, special, draw_date } }.
// Range rules read GAMES; date rules are validateDrawDate. Shared by Check and Save.
function validateTicketForm(form) {
  const g = GAMES[form.game];
  const specialName = SPECIAL_NAME[form.game];
  const nums = form.numbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  const special = parseInt(form.special, 10);
  if (nums.length !== g.mainCount) return { error: `Enter all ${g.mainCount} main numbers` };
  if (isNaN(special)) return { error: `Enter the ${specialName}` };
  if (nums.some(n => n < g.main[0] || n > g.main[1])) return { error: `Main numbers must be ${g.main[0]} to ${g.main[1]}` };
  if (new Set(nums).size !== nums.length) return { error: "Numbers must be unique" };
  if (special < g.special[0] || special > g.special[1]) return { error: `${specialName} must be ${g.special[0]} to ${g.special[1]}` };
  const dateError = validateDrawDate(form.drawDate);
  if (dateError) return { error: dateError };
  return { ticket: { game: form.game, numbers: [...nums].sort((a, b) => a - b), special, draw_date: form.drawDate } };
}

// What a Check shows. Fields that change WHICH ticket is checked; the multiplier
// and notes are left out on purpose so changing them keeps the result on screen.
function checkKey(form) {
  return JSON.stringify([form.game, form.numbers, form.special, form.drawDate]);
}

// Outcome for a validated ticket. Win/lose comes only from checkResult.
// No row: on/after the latest draw on file = not in yet; earlier = a gap we can't fill.
function checkTicketOutcome(ticket, draws, multiplier) {
  const result = checkResult(ticket, draws, multiplier);
  if (result) return { kind: "result", result, draw: findDraw(draws, ticket.game, ticket.draw_date) };
  const latest = latestDrawDate(draws, ticket.game);
  if (!latest || ticket.draw_date >= latest) {
    return { kind: "pending", msg: `Results for ${formatDrawDate(ticket.draw_date)} aren't in yet. We add new results every morning.` };
  }
  return { kind: "missing", msg: `We don't have results for this draw. Check the official ${GAMES[ticket.game].name} site.` };
}

// ── Type scale ────────────────────────────────────────────────
// Single source of truth for text size. Every text fontSize references a token;
// do not use bare pixel numbers for text, in S or inline.
const T = {
  micro: 11,   // labels, badges, tags
  small: 13,   // secondary text, hints, small buttons
  body: 15,    // default text, nav, buttons
  strong: 17,  // emphasis, game names, ball numerals
  title: 22,   // section titles, logo, jackpot
  display: 30, // stat values, auth logo
};

// iOS Safari auto-zooms any focused input under 16px. This is a floor applied
// on top of the scale, not a scale token: inputs use Math.max(token, INPUT_FONT_MIN).
const INPUT_FONT_MIN = 16;

// Decorative emoji/icon glyphs. Not text, so kept out of T.
// Gap between an input and the helper line directly under it. The hint then
// carries the field's normal bottom margin (S.formInput.marginBottom).
const FORM_HINT_GAP = 6;

// Checker number circles: up to 44px, shrinking to share one row. At 375px the
// card's inner width is 287px, so each circle lands at about 40px.
const CHECKER_BALL_SIZE = 44;

const ICON_SIZE = {
  banner: 16,    // draw-reminder ticket glyph
  empty: 32,     // S.emptyIcon
  emptyHero: 40, // My Tickets / Leaderboard empty states
};

const S = {
  app: { maxWidth: 600, margin: "0 auto", padding: "0 20px 100px", position: "relative", zIndex: 1 },
  header: { padding: "32px 0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: T.title, letterSpacing: -0.5 },
  logoAccent: { color: "#7c6aff" },
  logoBadge: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", border: "1px solid #2a2a38", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.5 },
  nav: { display: "flex", gap: 4, background: "#13131a", border: "1px solid #2a2a38", borderRadius: 14, padding: 5, marginBottom: 28 },
  navBtn: (active) => ({ flex: 1, padding: "10px 4px", border: "none", background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: `clamp(${T.small}px, 3.6vw, ${T.body}px)`, fontWeight: 500, borderRadius: 10, cursor: "pointer", transition: "all 0.2s" }),
  sectionLabel: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 },
  gameGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 },
  checkinBtn: (claimed) => ({ width: "100%", padding: 14, borderRadius: 14, border: `1px solid ${claimed ? "#2a2a38" : "rgba(124,106,255,0.4)"}`, background: claimed ? "transparent" : "rgba(124,106,255,0.15)", color: claimed ? "#6b6b82" : "#7c6aff", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: T.body, cursor: claimed ? "default" : "pointer", marginBottom: 20, transition: "all 0.2s" }),
  usernameRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#13131a", border: "1px solid #2a2a38", borderRadius: 14, padding: "12px 16px", marginBottom: 12 },
  usernameText: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, color: "#f0f0f5" },
  usernameEditLink: { fontSize: T.small, color: "#6b6b82", background: "transparent", border: "1px solid #2a2a38", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  usernameSetRow: { display: "flex", gap: 8, marginBottom: 12 },
  usernameInput: { flex: 1, padding: "10px 12px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 10, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: Math.max(T.body, INPUT_FONT_MIN), outline: "none" },
  usernameSaveBtn: { padding: "10px 16px", borderRadius: 10, border: "none", background: "#7c6aff", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.small, cursor: "pointer" },
  usernameCancelBtn: { padding: "10px 14px", borderRadius: 10, border: "1px solid #2a2a38", background: "transparent", color: "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: T.small, cursor: "pointer" },
  leaderboardRow: (highlight) => ({ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, border: `1px solid ${highlight ? "rgba(124,106,255,0.4)" : "#2a2a38"}`, background: highlight ? "rgba(124,106,255,0.1)" : "#13131a", marginBottom: 8 }),
  leaderboardRank: { fontFamily: "'DM Mono', monospace", fontSize: T.small, color: "#6b6b82", width: 32 },
  leaderboardUsername: { flex: 1, fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: T.body, color: "#f0f0f5" },
  leaderboardPoints: { fontFamily: "'DM Mono', monospace", fontSize: T.small, color: "#7c6aff", fontWeight: 600 },
  gameCard: (active, type) => ({ padding: "18px 16px", borderRadius: 16, border: `2px solid ${active ? (type === "pb" ? "#e8364a" : "#f5a623") : "#2a2a38"}`, background: "#13131a", cursor: "pointer", transition: "all 0.2s", boxShadow: active ? `0 0 24px ${type === "pb" ? "rgba(232,54,74,0.15)" : "rgba(245,166,35,0.15)"}` : "none" }),
  gameName: (type) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.strong, color: type === "pb" ? "#e8364a" : "#f5a623", marginBottom: 4 }),
  gameOdds: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82" },
  gameJackpot: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: T.title, marginTop: 8, color: "#f0f0f5" },
  gameNextDraw: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", marginTop: 4 },
  modesRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  modeBtn: (active) => ({ padding: "8px 16px", borderRadius: 20, border: `1px solid ${active ? "#7c6aff" : "#2a2a38"}`, background: active ? "rgba(124,106,255,0.15)" : "transparent", color: active ? "#7c6aff" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: T.small, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }),
  pickBox: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: "28px 24px", marginBottom: 16 },
  pickLabel: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" },
  modeTag: { fontSize: T.micro, padding: "3px 8px", borderRadius: 10, background: "rgba(124,106,255,0.15)", color: "#7c6aff", border: "1px solid rgba(124,106,255,0.2)" },
  ballsRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 },
  ball: (type) => ({ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.strong, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "2px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5", boxShadow: type === "pb" ? "0 0 20px rgba(232,54,74,0.3)" : type === "mm" ? "0 0 20px rgba(245,166,35,0.3)" : "none" }),
  sep: { color: "#6b6b82", fontSize: T.title },
  rationale: { fontSize: T.small, color: "#6b6b82", fontStyle: "italic", lineHeight: 1.5, paddingTop: 14, borderTop: "1px solid #2a2a38" },
  emptyPick: { textAlign: "center", padding: "20px 0" },
  emptyIcon: { fontSize: ICON_SIZE.empty, marginBottom: 10, opacity: 0.3 },
  emptyText: { color: "#6b6b82", fontSize: T.body },
  btnPrimary: (type) => ({ width: "100%", padding: 16, borderRadius: 14, border: "none", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.strong, cursor: "pointer", background: type === "pb" ? "#e8364a" : "#f5a623", color: type === "pb" ? "white" : "#0a0a0f", boxShadow: type === "pb" ? "0 4px 24px rgba(232,54,74,0.3)" : "0 4px 24px rgba(245,166,35,0.3)", transition: "all 0.2s" }),
  btnSecondary: { width: "100%", padding: 14, borderRadius: 14, border: "1px solid #2a2a38", background: "transparent", color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: T.body, cursor: "pointer", marginTop: 10, transition: "all 0.2s" },
  checkerGameRow: { display: "flex", gap: 8, marginBottom: 16 },
  checkerGameBtn: (active, key) => ({ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${active ? (key === "pb" ? "#e8364a" : "#f5a623") : "#2a2a38"}`, background: active ? "#1c1c26" : "transparent", color: active ? (key === "pb" ? "#e8364a" : "#f5a623") : "#6b6b82", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, cursor: "pointer" }),
  checkerNumLabels: { display: "flex", justifyContent: "space-between", fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 },
  checkerBallsRow: { display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap", marginBottom: 16 },
  // appearance/padding/boxSizing reset is the iOS oval fix: Safari's default
  // input padding and appearance stretched the fixed-size circle.
  checkerBall: (type) => ({ flex: "1 1 0", minWidth: 0, maxWidth: CHECKER_BALL_SIZE, aspectRatio: "1 / 1", height: "auto", boxSizing: "border-box", padding: 0, margin: 0, borderRadius: "50%", WebkitAppearance: "none", MozAppearance: "textfield", appearance: "none", background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "1.5px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : type === "pb" ? "white" : "#f0f0f5", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: Math.max(T.body, INPUT_FONT_MIN), textAlign: "center", outline: "none" }),
  checkerResult: { marginTop: 20, paddingTop: 16, borderTop: "1px solid #2a2a38" },
  checkerNote: { fontSize: T.small, color: "#6b6b82", lineHeight: 1.5, marginTop: 10 },
  tBallHit: { boxShadow: "0 0 0 2px #3ecf8e" },
  carryCard: { background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.4)", borderRadius: 16, padding: "16px 18px", marginBottom: 16 },
  carryTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, color: "#f0f0f5", marginBottom: 4 },
  carryActions: { display: "flex", gap: 8, alignItems: "center", marginTop: 14 },
  checkerDrawRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" },
  saveForm: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: 24, marginTop: 16 },
  formLabel: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, display: "block" },
  formInput: { width: "100%", boxSizing: "border-box", padding: "12px 14px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 10, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: Math.max(T.body, INPUT_FONT_MIN), outline: "none", marginBottom: 16 },
  btnSave: { width: "100%", padding: 14, borderRadius: 12, border: "none", background: "#7c6aff", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, cursor: "pointer", boxShadow: "0 4px 20px rgba(124,106,255,0.3)", marginTop: 16 },
  formHint: { fontSize: T.small, color: "#6b6b82", lineHeight: 1.4 },
  formError: { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(232,54,74,0.45)", background: "rgba(232,54,74,0.12)", color: "#ff6b7a", fontSize: T.small, lineHeight: 1.5, marginTop: 4 },
  drawDayWarning: { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(245,166,35,0.4)", background: "rgba(245,166,35,0.12)", color: "#f5a623", fontSize: T.small, lineHeight: 1.5, marginTop: 4 },
  disclaimer: { marginTop: 28, padding: 16, borderRadius: 12, border: "1px solid #2a2a38", background: "#13131a" },
  disclaimerText: { fontSize: T.small, color: "#6b6b82", lineHeight: 1.6, textAlign: "center" },
  legalNote: { fontSize: T.small, color: "#6b6b82", lineHeight: 1.5, textAlign: "center", marginTop: 14 },
  legalLink: { color: "#7c6aff", textDecoration: "underline" },
  histHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  histTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.title, color: "#f0f0f5" },
  ticketCount: { fontFamily: "'DM Mono', monospace", fontSize: T.small, color: "#6b6b82", background: "#13131a", border: "1px solid #2a2a38", padding: "4px 10px", borderRadius: 20 },
  filterRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  filterBtn: (active) => ({ padding: "7px 14px", borderRadius: 20, border: `1px solid ${active ? "#f0f0f5" : "#2a2a38"}`, background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontSize: T.small, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  ticketCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "18px 20px", marginBottom: 12 },
  ticketTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  ticketGame: (type) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, color: type === "pb" ? "#e8364a" : "#f5a623" }),
  ticketMeta: { display: "flex", alignItems: "center", gap: 10 },
  ticketDate: { fontFamily: "'DM Mono', monospace", fontSize: T.small, color: "#6b6b82" },
  statusBadge: (s) => ({ fontFamily: "'DM Mono', monospace", fontSize: T.micro, padding: "3px 8px", borderRadius: 10, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", background: s === "won" ? "rgba(62,207,142,0.15)" : s === "lost" ? "rgba(232,54,74,0.1)" : "rgba(107,107,130,0.2)", color: s === "won" ? "#3ecf8e" : s === "lost" ? "#e8364a" : "#6b6b82", border: `1px solid ${s === "won" ? "rgba(62,207,142,0.3)" : s === "lost" ? "rgba(232,54,74,0.2)" : "#2a2a38"}` }),
  resultBadge: (r) => ({ display: "inline-block", fontFamily: "'DM Mono', monospace", fontSize: T.micro, padding: "4px 10px", borderRadius: 10, letterSpacing: 0.5, marginTop: 10, background: r.bg, color: r.color, border: `1px solid ${r.border}` }),
  pointsBadge: { display: "inline-block", fontFamily: "'DM Mono', monospace", fontSize: T.micro, padding: "4px 10px", borderRadius: 10, letterSpacing: 0.5, marginTop: 10, marginLeft: 8, background: "rgba(124,106,255,0.15)", color: "#7c6aff", border: "1px solid rgba(124,106,255,0.3)" },
  tBallsRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tBall: (type) => ({ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "1.5px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5" }),
  ticketNotes: { marginTop: 10, fontSize: T.small, color: "#6b6b82", fontStyle: "italic" },
  ticketEditRow: { display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid #2a2a38", alignItems: "center", flexWrap: "wrap" },
  ticketEditInput: { flex: 1, minWidth: 80, padding: "8px 10px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 8, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: Math.max(T.small, INPUT_FONT_MIN), outline: "none" },
  ticketEditLabel: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4, display: "block" },
  emptyState: { textAlign: "center", padding: "60px 20px", color: "#6b6b82" },
  emptyStateTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: T.strong, color: "#f0f0f5", marginBottom: 8 },
  emptyStateText: { color: "#6b6b82", fontSize: T.body },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 },
  statCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "20px 18px", minWidth: 0 },
  statValue: (color) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: `clamp(${T.title}px, 6.5vw, ${T.display}px)`, marginBottom: 4, color: color || "#f0f0f5" }),
  statLabel: { fontFamily: "'DM Mono', monospace", fontSize: T.micro, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase" },
  freqTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: T.body, marginBottom: 14, marginTop: 24, color: "#f0f0f5" },
  freqGrid: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  freqBall: (hot) => ({ width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: T.body, background: hot ? "rgba(232,54,74,0.2)" : "rgba(124,106,255,0.1)", color: hot ? "#e8364a" : "#7c6aff", border: `1.5px solid ${hot ? "rgba(232,54,74,0.4)" : "rgba(124,106,255,0.2)"}` }),
  authBox: { width: "100%", boxSizing: "border-box", maxWidth: 400, margin: "0 auto", background: "#13131a", border: "1px solid #2a2a38", borderRadius: 24, padding: 32 },
  guestIntro: { fontSize: T.body, color: "#6b6b82", lineHeight: 1.5, marginBottom: 4 },
  authSubtitle: { fontFamily: "'DM Mono', monospace", fontSize: T.small, color: "#6b6b82", textAlign: "center", marginBottom: 32, letterSpacing: 0.5 },
  authTabs: { display: "flex", gap: 4, background: "#0a0a0f", borderRadius: 10, padding: 4, marginBottom: 28 },
  authTab: (active) => ({ flex: 1, padding: "9px 0", border: "none", background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: T.body, fontWeight: 500, borderRadius: 8, cursor: "pointer" }),
  authError: { background: "rgba(232,54,74,0.1)", border: "1px solid rgba(232,54,74,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: T.small, color: "#e8364a", marginBottom: 16 },
  authSuccess: { background: "rgba(62,207,142,0.1)", border: "1px solid rgba(62,207,142,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: T.small, color: "#3ecf8e", marginBottom: 16 },
  signOutBtn: { background: "transparent", border: "1px solid #2a2a38", color: "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: T.small, padding: "5px 12px", borderRadius: 8, cursor: "pointer" },
};

// ── Ticket Checker ───────────────────────────────────────────
// Controlled: the parent owns `form` so it can outlive this component (the
// logged-out signup carry-through needs that). `onSave(ticket, form)` returns an
// error string or null. Check never writes anything.
// `guest` (logged out): no Notes field, and Save only appears after a Check, as
// "Sign up to save it". The parent's onSave opens signup; nothing is written.
function TicketChecker({ form, setForm, draws, onSave, guest = false }) {
  // Error stores the form object it was raised against: any edit clears it.
  const [error, setError] = useState(null);
  // Checked result, keyed by checkKey so the multiplier can change underneath it.
  const [checked, setChecked] = useState(null);
  const [warned, setWarned] = useState(null);
  const [saving, setSaving] = useState(false);

  const update = (patch) => setForm({ ...form, ...patch });
  const fail = (msg) => setError({ msg, form });

  const selectGame = (key) => {
    if (key === form.game) return;
    // The date follows the game while it is still the default (latest on file).
    const userDate = form.drawDate && form.drawDate !== latestDrawDate(draws, form.game);
    update({ game: key, multiplier: "", drawDate: userDate ? form.drawDate : latestDrawDate(draws, key) });
  };

  const check = () => {
    const v = validateTicketForm(form);
    if (v.error) { fail(v.error); return; }
    if (nonDrawDayWarning(form.game, form.drawDate)) { fail(drawDaysLabel(form.game)); return; }
    setChecked({ key: checkKey(form), ticket: v.ticket });
  };

  const save = async () => {
    const v = validateTicketForm(form);
    if (v.error) { fail(v.error); return; }
    // Soft warning: first click arms it, second click through saves.
    const wk = warnKey(form.game, form.drawDate);
    if (nonDrawDayWarning(form.game, form.drawDate) && warned !== wk) { setWarned(wk); return; }
    setSaving(true);
    const err = await onSave(v.ticket, form);
    setSaving(false);
    if (err) fail(err);
  };

  const warning = nonDrawDayWarning(form.game, form.drawDate);
  const warnArmed = !!warning && warned === warnKey(form.game, form.drawDate);
  const showError = error && error.form === form;
  const multiplier = form.game === "mm" ? Number(form.multiplier) || null : null;
  const outcome = checked && checked.key === checkKey(form)
    ? checkTicketOutcome(checked.ticket, draws, multiplier) : null;
  const ballInput = { type: "text", inputMode: "numeric", pattern: "[0-9]*", maxLength: 2, autoComplete: "off", placeholder: "—" };

  return (
    <div style={S.saveForm}>
      <div style={S.sectionLabel}>Game</div>
      <div style={S.checkerGameRow}>
        {Object.keys(GAMES).map(key => (
          <button key={key} style={S.checkerGameBtn(form.game === key, key)} onClick={() => selectGame(key)}>{GAMES[key].name}</button>
        ))}
      </div>
      <div style={S.checkerNumLabels}><span>Main numbers</span><span>{SPECIAL_NAME[form.game]}</span></div>
      <div style={S.checkerBallsRow}>
        {form.numbers.map((n, i) => (
          <input key={i} {...ballInput} style={S.checkerBall("main")} aria-label={`Main number ${i + 1}`} value={n}
            onChange={e => { const nums = [...form.numbers]; nums[i] = cleanNumberInput(e.target.value); update({ numbers: nums, pickMode: "manual" }); }} />
        ))}
        <div style={S.sep}>+</div>
        <input {...ballInput} style={S.checkerBall(form.game)} aria-label={SPECIAL_NAME[form.game]} value={form.special}
          onChange={e => update({ special: cleanNumberInput(e.target.value), pickMode: "manual" })} />
      </div>
      <label style={S.formLabel}>Draw Date</label>
      <input style={S.formInput} type="date" value={form.drawDate} min={MIN_DRAW_DATE} max={maxDrawDate()} onChange={e => update({ drawDate: e.target.value })} />
      {form.game === "mm" && (
        <>
          <label style={S.formLabel}>Multiplier (optional)</label>
          <select style={S.formInput} value={form.multiplier} onChange={e => update({ multiplier: e.target.value })}>
            <option value="">Not sure</option>
            {MM_MULTIPLIER.values.map(m => <option key={m} value={m}>{m}X</option>)}
          </select>
        </>
      )}
      {!guest && (
        <>
          <label style={S.formLabel}>Notes (optional)</label>
          <input style={S.formInput} type="text" placeholder="e.g. corner store ticket..." value={form.notes} onChange={e => update({ notes: e.target.value })} />
        </>
      )}
      {showError && <div role="alert" style={S.formError}>{error.msg}</div>}
      {warnArmed && <div style={S.drawDayWarning}>{warning}</div>}
      <button style={{ ...S.btnPrimary(form.game), marginTop: 16 }} onClick={check}>Check Ticket</button>
      {!guest && (
        <button style={S.btnSecondary} onClick={save} disabled={saving}>
          {saving ? "Saving..." : warnArmed ? "Save anyway" : "Save Ticket"}
        </button>
      )}
      {outcome && (
        <div style={S.checkerResult} role="status">
          {outcome.kind === "result" ? (
            <>
              <div style={S.sectionLabel}>Winning numbers · {formatDrawDate(outcome.draw.draw_date)}</div>
              <div style={S.checkerDrawRow}>
                {outcome.draw.numbers.map(n => (
                  <div key={n} style={{ ...S.tBall("main"), ...(checked.ticket.numbers.includes(n) ? S.tBallHit : null) }}>{n}</div>
                ))}
                <div style={S.sep}>+</div>
                <div style={{ ...S.tBall(outcome.draw.game), ...(checked.ticket.special === outcome.draw.special ? S.tBallHit : null) }}>{outcome.draw.special}</div>
              </div>
              <div style={S.resultBadge(outcome.result)}>{outcome.result.label}</div>
              {outcome.result.tier === "win" && outcome.draw.game === "mm" && !multiplier && (
                <div style={S.checkerNote}>Choose the multiplier printed on your ticket to see the exact amount.</div>
              )}
              {outcome.result.tier === "win" && outcome.draw.game === "pb" && (
                <div style={S.checkerNote}>Power Play can multiply non-jackpot prizes.</div>
              )}
              <div style={S.checkerNote}>Always confirm results with the official lottery.</div>
            </>
          ) : (
            <div style={S.checkerNote}>{outcome.msg}</div>
          )}
        </div>
      )}
      {guest && outcome && (
        <button style={S.btnSave} onClick={save}>Sign up to save it</button>
      )}
    </div>
  );
}

// Disclaimer + helpline + legal links. One copy for every screen that needs it.
function LegalFooter() {
  return (
    <div style={S.disclaimer}>
      <div style={S.disclaimerText}>PickLogic is an entertainment tool. Pick strategies are for fun — they do not improve your odds of winning. Please play responsibly. Problem gambling help: 1-800-547-6133.</div>
      <div style={{ ...S.disclaimerText, marginTop: 8 }}>
        <a href="/terms.html" style={S.legalLink}>Terms</a> · <a href="/privacy.html" style={S.legalLink}>Privacy</a>
      </div>
    </div>
  );
}

// ── Auth Screen ──────────────────────────────────────────────
// Renders inside the app shell (not a whole-screen replacement), so App state
// such as the checker form survives a login or signup.
function AuthScreen({ initialTab = "login" }) {
  const [tab, setTab] = useState(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Email typo confirmation. Holds the exact email string the user was warned
  // about; editing the address no longer matches, so the warning re-arms.
  const [warnedEmail, setWarnedEmail] = useState(null);

  const typoWarning = tab === "signup" ? emailTypoWarning(email) : null;
  const typoWarnArmed = !!typoWarning && warnedEmail === email;

  const handleSubmit = async () => {
    if (typoWarning && warnedEmail !== email) {
      setWarnedEmail(email);
      return;
    }
    setError(""); setSuccess(""); setLoading(true);
    if (tab === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div>
      <div>
        <div style={S.authBox}>
          <div style={S.authSubtitle}>POWERBALL · MEGA MILLIONS</div>
          <div style={S.authTabs}>
            <button style={S.authTab(tab === "login")} onClick={() => { setTab("login"); setError(""); setSuccess(""); }}>Log In</button>
            <button style={S.authTab(tab === "signup")} onClick={() => { setTab("signup"); setError(""); setSuccess(""); }}>Sign Up</button>
          </div>
          {error && <div style={S.authError}>{error}</div>}
          {success && <div style={S.authSuccess}>{success}</div>}
          <label style={S.formLabel}>Email</label>
          <input style={tab === "signup" ? { ...S.formInput, marginBottom: FORM_HINT_GAP } : S.formInput} type="email" placeholder="you@email.com" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          {tab === "signup" && <div style={{ ...S.formHint, marginBottom: S.formInput.marginBottom }}>Used for password recovery.</div>}
          <label style={S.formLabel}>Password</label>
          <input style={S.formInput} type="password" placeholder="••••••••" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          {typoWarnArmed && <div style={S.drawDayWarning}>{typoWarning}</div>}
          <button style={S.btnSave} onClick={handleSubmit} disabled={loading}>
            {loading ? "Please wait..." : tab === "login" ? "Log In" : typoWarnArmed ? "Create account anyway" : "Create Account"}
          </button>
          {tab === "signup" && (
            <div style={S.legalNote}>
              By creating an account, you agree to the <a href="/terms.html" style={S.legalLink}>Terms of Service</a> and <a href="/privacy.html" style={S.legalLink}>Privacy Policy</a>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("pick");
  const [game, setGame] = useState("pb");
  const [mode, setMode] = useState("random");
  const [pick, setPick] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [draws, setDraws] = useState([]);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ drawDate: "", notes: "" });
  // Non-draw-day confirmation. Holds the date string the user was warned about,
  // so editing the date re-arms the warning instead of silently staying armed.
  const [warnedDate, setWarnedDate] = useState(null);
  // Quick Pick save error, shown inline. Stores the form object it was raised
  // against; any edit (or a new Generate) replaces form, so it clears itself.
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState("");
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showChecker, setShowChecker] = useState(false);
  // Checker form lives here, not in TicketChecker, so it can outlive the component.
  const [checkerForm, setCheckerForm] = useState(EMPTY_TICKET_FORM);
  // Logged-out front door: which tab ("check" | "picks"), and the auth view
  // ("login" | "signup" | null) shown inside the shell instead of the checker.
  const [guestTab, setGuestTab] = useState("check");
  const [authView, setAuthView] = useState(null);
  // Signup carry-through: the ticket a logged-out visitor asked to save, held
  // in memory only (no localStorage, no DB write) until they sign up or log in.
  // Then it is offered with a one-tap Save; never saved automatically.
  const [carried, setCarried] = useState(null); // { ticket, pickMode }
  const [carryError, setCarryError] = useState("");
  const [carrySaving, setCarrySaving] = useState(false);
  const [checkinClaimed, setCheckinClaimed] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [matchPoints, setMatchPoints] = useState({});
  const [username, setUsername] = useState(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    loadDraws();
    return () => subscription.unsubscribe();
  }, []);

  const loadTickets = useCallback(async () => {
    const { data, error } = await supabase
      .from("tickets").select("*").order("created_at", { ascending: false });
    if (!error) setTickets(data || []);

    const { data: pointsData, error: pointsError } = await supabase
      .from("point_events").select("ref_id, event_type, points")
      .in("event_type", ["match_any", "match_3plus", "jackpot"]);
    if (!pointsError) {
      const lookup = {};
      (pointsData || []).forEach(p => { lookup[String(p.ref_id)] = p.points; });
      setMatchPoints(lookup);
    }
  }, []);

  const loadCheckinStatus = useCallback(async () => {
    const todayLA = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const { data, error } = await supabase
      .from("point_events").select("id")
      .eq("event_type", "checkin").eq("ref_id", todayLA).limit(1);
    if (!error) setCheckinClaimed((data || []).length > 0);
  }, []);

  const loadProfile = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles").select("username").eq("id", session.user.id).single();
    if (!error) setUsername(data?.username || null);
  }, [session]);

  useEffect(() => {
    if (session) { loadTickets(); loadCheckinStatus(); loadProfile(); setAuthView(null); }
    else { setTickets([]); setCheckinClaimed(false); setMatchPoints({}); setUsername(null); }
  }, [session, loadTickets, loadCheckinStatus, loadProfile]);

  const saveUsername = async () => {
    const trimmed = usernameInput.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(trimmed)) {
      showToast("Username must be 3-20 letters, numbers, or underscores");
      return;
    }
    setUsernameSaving(true);
    const { error } = await supabase.from("profiles").update({ username: trimmed }).eq("id", session.user.id);
    setUsernameSaving(false);
    if (error) {
      if (error.code === "23505") showToast("That username is taken");
      else if (error.code === "23514") showToast("Username must be 3-20 letters, numbers, or underscores");
      else showToast("Error saving username");
      return;
    }
    setUsername(trimmed);
    setEditingUsername(false);
    setUsernameInput("");
    showToast("Username saved!");
  };

  const loadLeaderboard = useCallback(async () => {
    const { data, error } = await supabase.from("leaderboard").select("*").limit(25);
    const rows = error ? [] : (data || []);
    setLeaderboard(rows);
    if (username && !rows.some(r => r.username === username)) {
      const { data: mine, error: mineError } = await supabase
        .from("leaderboard").select("*").eq("username", username).single();
      setMyRank(!mineError && mine ? mine : null);
    } else {
      setMyRank(null);
    }
  }, [username]);

  useEffect(() => {
    if (view === "leaderboard" && session) loadLeaderboard();
  }, [view, session, loadLeaderboard]);

  const handleCheckIn = async () => {
    setCheckinLoading(true);
    const { data, error } = await supabase.rpc("daily_checkin");
    setCheckinLoading(false);
    if (error) { showToast(error.message || "Error checking in"); return; }
    setCheckinClaimed(true);
    if (data && data.awarded) showToast("+10 points!");
  };

  const loadDraws = async () => {
    const { data, error } = await supabase
      .from("draws").select("*").order("draw_date", { ascending: false });
    if (!error) {
      setDraws(data || []);
      // Fill the checker's default date once draws arrive (latest on file).
      setCheckerForm(f => (f.drawDate ? f : { ...f, drawDate: latestDrawDate(data || [], f.game) }));
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  // Reset logged-out state so the next visitor on this device starts clean.
  const signOut = () => {
    setCheckerForm({ ...EMPTY_TICKET_FORM, drawDate: latestDrawDate(draws, EMPTY_TICKET_FORM.game) });
    setShowChecker(false);
    setGuestTab("check");
    setMode("random");
    setPick(null);
    setCarried(null);
    setView("pick");
    supabase.auth.signOut();
  };

  // Generate -> checker: the pick is for the next draw, not the latest on file.
  const usePickInChecker = () => {
    if (!pick) return;
    setCheckerForm({ ...EMPTY_TICKET_FORM, game: pick.game, numbers: pick.numbers.map(String), special: String(pick.special), drawDate: nextDrawDate(pick.game), pickMode: pick.mode });
    setGuestTab("check");
  };

  // Logged out, Save opens signup. The form stays in App state; nothing is written.
  const guestSave = async (ticket, form) => {
    setCarried({ ticket, pickMode: form.pickMode || "manual" });
    setCarryError("");
    setAuthView("signup");
    return null;
  };
  const leaveAuth = () => { setAuthView(null); setCarried(null); };

  const generate = () => {
    const g = GAMES[game];
    let nums, rationale;
    if (mode === "balanced") {
      const [lo, hi] = g.main;
      const third = Math.floor((hi - lo + 1) / 3);
      nums = [];
      [[lo, lo+third-1],[lo+third, lo+third*2-1],[lo+third*2, hi]].forEach(([a,b]) => {
        let n; do { n = randInt(a,b); } while (nums.includes(n)); nums.push(n);
      });
      while (nums.length < g.mainCount) { const n = randInt(lo,hi); if (!nums.includes(n)) nums.push(n); }
      nums.sort((a,b)=>a-b);
      rationale = "Numbers spread across low, mid, and high ranges for maximum variety.";
    } else if (mode === "hot" || mode === "cold") {
      const freq = {};
      tickets.filter(t=>t.game===game).forEach(t=>t.numbers.forEach(n=>{freq[n]=(freq[n]||0)+1;}));
      if (Object.keys(freq).length < 5) {
        nums = pickUnique(g.mainCount, g.main[0], g.main[1]);
        rationale = "Not enough ticket history — using random pick as fallback.";
      } else {
        const weights = {};
        for (let i = g.main[0]; i <= g.main[1]; i++) { const f = freq[i]||0; weights[i] = mode==="hot"?(f+1)*3:Math.max(1,10-f); }
        nums = pickUnique(g.mainCount, g.main[0], g.main[1], weights);
        rationale = mode === "hot" ? "Weighted toward your most-played numbers." : "Weighted toward your least-played numbers.";
      }
    } else {
      nums = pickUnique(g.mainCount, g.main[0], g.main[1]);
      rationale = "Five unique numbers drawn at random — no bias, no system.";
    }
    const special = randInt(g.special[0], g.special[1]);
    setPick({ game, numbers: nums, special, mode, rationale });
    setShowSave(false);
    // Next official draw (ET), not today's date: after a draw starts, today is over.
    setForm({ drawDate: nextDrawDate(game), notes: "" });
  };

  const saveTicket = async () => {
    if (!pick || !session) return;
    const dateError = validateDrawDate(form.drawDate);
    if (dateError) { setSaveError({ msg: dateError, form }); return; }
    // Soft warning: first click arms it, second click through saves.
    if (nonDrawDayWarning(pick.game, form.drawDate) && warnedDate !== warnKey(pick.game, form.drawDate)) {
      setWarnedDate(warnKey(pick.game, form.drawDate));
      return;
    }
    const { data, error } = await supabase.from("tickets").insert({
      user_id: session.user.id,
      game: pick.game,
      numbers: pick.numbers,
      special: pick.special,
      pick_mode: pick.mode,
      draw_date: form.drawDate || null,
      notes: form.notes || null,
      stake: 0, payout: 0, status: "open",
    }).select().single();
    if (error) { setSaveError({ msg: "Error saving ticket. Please try again.", form }); return; }
    setTickets([data, ...tickets]);
    setShowSave(false);
    setPick(null);
    setForm({ drawDate: "", notes: "" });
    setWarnedDate(null);
    showToast("✓ Ticket saved!");
  };

    const saveTicketEdit = async (id) => {
    const vals = editValues[id] || {};
    const ticket = tickets.find(t => t.id === id);
    const parseOrKeep = (val, fallback) => {
      if (val === undefined) return fallback;
      const parsed = parseFloat(val);
      return isNaN(parsed) ? fallback : parsed;
    };
    const updates = {
      stake: parseOrKeep(vals.stake, ticket.stake || 0),
      payout: parseOrKeep(vals.payout, ticket.payout || 0),
      notes: vals.notes !== undefined ? vals.notes : ticket.notes,
    };
    const { error } = await supabase.from("tickets").update(updates).eq("id", id);
    if (!error) {
      setTickets(tickets.map(t => t.id===id ? {...t, ...updates} : t));
      setExpandedTicket(null);
      setEditValues({});
      showToast("Ticket updated");
    }
  };
  // TicketChecker has already validated the ticket and handled the soft warning.
  // Returns an error string for the checker to show inline, or null on success.
  const insertTicket = (ticket, pickMode, notes) => supabase.from("tickets").insert({
    user_id: session.user.id,
    game: ticket.game,
    numbers: ticket.numbers,
    special: ticket.special,
    pick_mode: pickMode,
    draw_date: ticket.draw_date,
    notes: notes || null,
    stake: 0, payout: 0, status: "open",
  }).select().single();

  const saveCheckedTicket = async (ticket, form) => {
    const { data, error } = await insertTicket(ticket, form.pickMode || "manual", form.notes);
    if (error) return "Error saving ticket. Please try again.";
    setTickets([data, ...tickets]);
    setShowChecker(false);
    setCheckerForm(EMPTY_TICKET_FORM);
    showToast("✓ Ticket saved!");
    return null;
  };

  // One-tap Save for the ticket carried through signup.
  const saveCarried = async () => {
    if (!carried || !session || carrySaving) return;
    setCarrySaving(true);
    const { data, error } = await insertTicket(carried.ticket, carried.pickMode, null);
    setCarrySaving(false);
    if (error) { setCarryError("Error saving ticket. Please try again."); return; }
    setTickets(prev => [data, ...prev]);
    setCarried(null);
    setCarryError("");
    showToast("✓ Ticket saved!");
  };
  const dismissCarried = () => { setCarried(null); setCarryError(""); };
    const getDrawReminders = () => {
    const now = new Date();
    const day = now.getDay();
    const today = toLocalDateString(now);
    const yesterday = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const reminders = [];

    // No ticket yet — draw is tonight
    if (DRAW_DAYS.pb.includes(day) && !tickets.some(t => t.game === "pb" && t.draw_date === today)) {
      reminders.push({ game: "pb", label: "Powerball draws tonight at 10:59pm ET — you don't have a ticket yet", color: "#e8364a" });
    }
    if (DRAW_DAYS.mm.includes(day) && !tickets.some(t => t.game === "mm" && t.draw_date === today)) {
      reminders.push({ game: "mm", label: "Mega Millions draws tonight at 11:00pm ET — you don't have a ticket yet", color: "#f5a623" });
    }

    // Open ticket from yesterday's draw — nudge to check results
    if (tickets.some(t => t.game === "pb" && t.draw_date === yesterday && t.status === "open")) {
      reminders.push({ game: "pb", label: "Powerball drew last night — check your tickets", color: "#e8364a" });
    }
    if (tickets.some(t => t.game === "mm" && t.draw_date === yesterday && t.status === "open")) {
      reminders.push({ game: "mm", label: "Mega Millions drew last night — check your tickets", color: "#f5a623" });
    }

    return reminders;
  };
  // Non-draw-day warning state, derived per render. "Armed" means the user has
  // already clicked Save once and been shown the warning; a second click saves.
  const saveWarning = pick ? nonDrawDayWarning(pick.game, form.drawDate) : null;
  const saveWarnArmed = !!saveWarning && warnedDate === warnKey(pick?.game, form.drawDate);

  const filtered = tickets.filter(t => filter==="all" || t.game===filter || (filter==="open" && t.status==="open"));

  const stats = {
    total: tickets.length,
    wins: tickets.filter(t=>t.status==="won").length,
    spent: tickets.reduce((s,t)=>s+(t.stake||0),0),
    net: tickets.reduce((s,t)=>s+(t.payout||0),0) - tickets.reduce((s,t)=>s+(t.stake||0),0),
  };

  const freq = {};
  tickets.forEach(t=>t.numbers.forEach(n=>{freq[n]=(freq[n]||0)+1;}));
  const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);

  // Shared by the logged-in Quick Pick view and the logged-out "Get picks" tab.
  const renderGameGrid = () => (
    <>
              <div style={S.sectionLabel}>Select Game</div>
              <div style={S.gameGrid}>
                {Object.entries(GAMES).map(([key,g])=>(
                  <div key={key} style={S.gameCard(game===key,key)} onClick={()=>{setGame(key);setPick(null);setShowSave(false);}}>
                    <div style={S.gameName(key)}>{g.name}</div>
                    <div style={S.gameOdds}>{g.odds}</div>
                    <div style={S.gameJackpot}>{config.jackpots[key]}</div>
                    <div style={S.gameNextDraw}>Next: {nextDrawLabel(key)}</div>
                  </div>
                ))}
              </div>
    </>
  );
  const renderPicker = (modeKeys) => (
    <>
              <div style={S.sectionLabel}>Pick Strategy</div>
              <div style={S.modesRow}>
                {modeKeys.map(key=>(
                  <button key={key} style={S.modeBtn(mode===key)} onClick={()=>setMode(key)}>{MODES[key].label}</button>
                ))}
              </div>
              <div style={S.pickBox}>
                {pick ? (
                  <>
                    <div style={S.pickLabel}>
                      <span>YOUR NUMBERS</span>
                      <span style={S.modeTag}>{MODES[pick.mode].label}</span>
                    </div>
                    <div style={S.ballsRow}>
                      {pick.numbers.map(n=><div key={n} style={S.ball("main")}>{n}</div>)}
                      <div style={S.sep}>+</div>
                      <div style={S.ball(pick.game)}>{pick.special}</div>
                    </div>
                    <div style={S.rationale}>{pick.rationale}</div>
                  </>
                ) : (
                  <div style={S.emptyPick}>
                    <div style={S.emptyIcon}>🎱</div>
                    <div style={S.emptyText}>Tap Generate to get your numbers</div>
                  </div>
                )}
              </div>
              <button style={S.btnPrimary(game)} onClick={generate}>Generate Numbers</button>
    </>
  );

  if (authLoading) return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@800&display=swap" rel="stylesheet" />
      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: T.title, color: "#f0f0f5" }}>Pick<span style={{ color: "#7c6aff" }}>Logic</span></div>
    </div>
  );

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <div style={{ background:"#0a0a0f", minHeight:"100vh" }}>
        <div style={S.app}>
          <header style={S.header}>
            <div style={S.logo}><span style={{color:"#f0f0f5"}}>Pick</span><span style={S.logoAccent}>Logic</span></div>
            {session ? (
              <button style={S.signOutBtn} onClick={signOut}>Sign out</button>
            ) : authView ? (
              <button style={S.signOutBtn} onClick={leaveAuth}>Back</button>
            ) : (
              <button style={S.signOutBtn} onClick={() => setAuthView("login")}>Log in</button>
            )}
          </header>
          {!session && authView && <AuthScreen key={authView} initialTab={authView} />}
          {!session && !authView && (
            <div>
              <nav style={S.nav}>
                {[["check", "Check a ticket"], ["picks", "Get picks"]].map(([v, label]) => (
                  <button key={v} style={S.navBtn(guestTab === v)} onClick={() => setGuestTab(v)}>{label}</button>
                ))}
              </nav>
              {guestTab === "check" && (
                <>
                  <div style={S.guestIntro}>Check your numbers. No account needed.</div>
                  <TicketChecker guest form={checkerForm} setForm={setCheckerForm} draws={draws} onSave={guestSave} />
                </>
              )}
              {guestTab === "picks" && (
                <>
                  {renderGameGrid()}
                  {renderPicker(GUEST_MODES)}
                  {pick && <button style={S.btnSecondary} onClick={usePickInChecker}>Use these numbers</button>}
                </>
              )}
              <LegalFooter />
            </div>
          )}
          {session && (<>
          {carried && (
            <div style={S.carryCard}>
              <div style={S.carryTitle}>Save the ticket you checked?</div>
              <div style={{ ...S.formHint, marginBottom: 12 }}>{GAMES[carried.ticket.game].name} · {formatDrawDate(carried.ticket.draw_date)}</div>
              <div style={S.checkerDrawRow}>
                {carried.ticket.numbers.map(n => <div key={n} style={S.tBall("main")}>{n}</div>)}
                <div style={S.sep}>+</div>
                <div style={S.tBall(carried.ticket.game)}>{carried.ticket.special}</div>
              </div>
              {carryError && <div role="alert" style={{ ...S.formError, marginTop: 12 }}>{carryError}</div>}
              <div style={S.carryActions}>
                <button style={{ ...S.btnSave, marginTop: 0, flex: 1 }} onClick={saveCarried} disabled={carrySaving}>{carrySaving ? "Saving..." : "Save this ticket"}</button>
                <button style={S.usernameCancelBtn} onClick={dismissCarried}>Not now</button>
              </div>
            </div>
          )}
          {getDrawReminders().map(r => (
  <div key={r.game} style={{ background: `rgba(${r.game==="pb"?"232,54,74":"245,166,35"},0.1)`, border: `1px solid rgba(${r.game==="pb"?"232,54,74":"245,166,35"},0.3)`, borderRadius: 12, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ fontSize: ICON_SIZE.banner }}>🎟️</span>
    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: T.body, color: r.color, fontWeight: 500 }}>{r.label}</span>
  </div>
))}
          <nav style={S.nav}>
            {["pick","history","stats","leaderboard"].map((v,i)=>(
              <button key={v} style={S.navBtn(view===v)} onClick={()=>setView(v)}>
                {["Quick Pick","My Tickets","Stats","Leaders"][i]}
              </button>
            ))}
          </nav>

          {view==="pick" && (
            <div>
              {renderGameGrid()}
              {username && !editingUsername && (
                <div style={S.usernameRow}>
                  <div style={S.usernameText}>@{username}</div>
                  <button style={S.usernameEditLink} onClick={()=>{setEditingUsername(true);setUsernameInput(username);}}>Edit</button>
                </div>
              )}
              {(!username || editingUsername) && (
                <div style={S.usernameSetRow}>
                  <input style={S.usernameInput} type="text" placeholder="Set a username" value={usernameInput}
                    onChange={e=>setUsernameInput(e.target.value)}
                    onKeyDown={e=>e.key==="Enter" && saveUsername()} />
                  <button style={S.usernameSaveBtn} onClick={saveUsername} disabled={usernameSaving}>Save</button>
                  {editingUsername && (
                    <button style={S.usernameCancelBtn} onClick={()=>{setEditingUsername(false);setUsernameInput("");}}>Cancel</button>
                  )}
                </div>
              )}
              <button style={S.checkinBtn(checkinClaimed)} disabled={checkinClaimed || checkinLoading} onClick={handleCheckIn}>
                {checkinClaimed ? "Checked in today ✓" : "Check in · +10 pts"}
              </button>
              {renderPicker(Object.keys(MODES))}
              {pick && (
                <button style={S.btnSecondary} onClick={()=>setShowSave(!showSave)}>
                  {showSave ? "Cancel" : "+ Save This Ticket"}
                </button>
              )}
              {showSave && (
                <div style={S.saveForm}>
                  <label style={S.formLabel}>Draw Date</label>
                  <input style={S.formInput} type="date" value={form.drawDate} min={MIN_DRAW_DATE} max={maxDrawDate()} onChange={e=>setForm({...form,drawDate:e.target.value})} />
                  <label style={S.formLabel}>Notes (optional)</label>
                  <input style={S.formInput} type="text" placeholder="e.g. Friday lucky pick..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
                  <div style={{ fontSize:T.small, color:"#6b6b82", marginBottom:12 }}>Tip: add stake and payout after the draw from My Tickets</div>
                  {saveError && saveError.form === form && <div role="alert" style={S.formError}>{saveError.msg}</div>}
                  {saveWarnArmed && <div style={S.drawDayWarning}>{saveWarning}</div>}
                  <button style={S.btnSave} onClick={saveTicket}>
                    {saveWarnArmed ? "Save anyway" : "Save Ticket"}
                  </button>
                </div>
              )}
              <LegalFooter />
            </div>
          )}

          {view==="history" && (
            <div>
              <div style={S.histHeader}>
  <div style={S.histTitle}>My Tickets</div>
  <div style={S.ticketCount}>{tickets.length} ticket{tickets.length!==1?"s":""}</div>
</div>
<button style={{...S.btnSecondary, marginBottom: 16}} onClick={() => {
  if (!showChecker) setCheckerForm({ ...EMPTY_TICKET_FORM, drawDate: latestDrawDate(draws, EMPTY_TICKET_FORM.game) });
  setShowChecker(!showChecker);
}}>
  {showChecker ? "Cancel" : "+ Check or Add a Ticket"}
</button>
{showChecker && (
  <div style={{ marginBottom: 16 }}>
    <TicketChecker form={checkerForm} setForm={setCheckerForm} draws={draws} onSave={saveCheckedTicket} />
  </div>
)}
              <div style={S.filterRow}>
                {[["all","All"],["pb","Powerball"],["mm","Mega Millions"],["open","Open"]].map(([key,label])=>(
                  <button key={key} style={S.filterBtn(filter===key)} onClick={()=>setFilter(key)}>{label}</button>
                ))}
              </div>
              {filtered.length===0 ? (
                <div style={S.emptyState}>
                  <div style={{fontSize:ICON_SIZE.emptyHero,marginBottom:16,opacity:0.3}}>🎟️</div>
                  <div style={S.emptyStateTitle}>No tickets yet</div>
                  <div style={S.emptyStateText}>Save a ticket from the Quick Pick tab</div>
                </div>
              ) : filtered.map(t => {
                const result = checkResult(t, draws);
                return (
                  <div key={t.id} style={S.ticketCard}>
                    <div style={S.ticketTop}>
                      <div style={S.ticketGame(t.game)}>{GAMES[t.game].name}</div>
                      <div style={S.ticketMeta}>
                        <span style={S.ticketDate}>{t.draw_date ? new Date(t.draw_date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"}</span>
                                              </div>
                    </div>
                    <div style={S.tBallsRow}>
                      {t.numbers.map(n=><div key={n} style={S.tBall("main")}>{n}</div>)}
                      <div style={S.sep}>+</div>
                      <div style={S.tBall(t.game)}>{t.special}</div>
                    </div>
                    {result && <div style={S.resultBadge(result)}>{result.label}</div>}
                    {matchPoints[String(t.id)] !== undefined && <div style={S.pointsBadge}>+{matchPoints[String(t.id)]} pts</div>}
                    {t.notes && <div style={S.ticketNotes}>{t.notes}</div>}
                    {expandedTicket === t.id ? (
                      <div style={S.ticketEditRow}>
                        <div style={{flex:1,minWidth:80}}>
                          <label style={S.ticketEditLabel}>Stake ($)</label>
                          <input style={S.ticketEditInput} type="number" placeholder={t.stake||"0.00"}
                            onChange={e=>setEditValues({...editValues,[t.id]:{...(editValues[t.id]||{}),stake:e.target.value}})} />
                        </div>
                        <div style={{flex:1,minWidth:80}}>
                          <label style={S.ticketEditLabel}>Payout ($)</label>
                          <input style={S.ticketEditInput} type="number" placeholder={t.payout||"0.00"}
                            onChange={e=>setEditValues({...editValues,[t.id]:{...(editValues[t.id]||{}),payout:e.target.value}})} />
                        </div>
                        <div style={{flex:2,minWidth:120}}>
                          <label style={S.ticketEditLabel}>Notes</label>
                          <input style={S.ticketEditInput} type="text" defaultValue={t.notes||""}
                            onChange={e=>setEditValues({...editValues,[t.id]:{...(editValues[t.id]||{}),notes:e.target.value}})} />
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:4,alignSelf:"flex-end"}}>
                          <button onClick={()=>saveTicketEdit(t.id)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:"#7c6aff",color:"white",fontSize:T.small,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Save</button>
                          <button onClick={()=>{setExpandedTicket(null);setEditValues({});}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #2a2a38",background:"transparent",color:"#6b6b82",fontSize:T.small,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:T.small,color:"#6b6b82",fontFamily:"'DM Mono',monospace"}}>
                          {t.stake > 0 ? `$${t.stake.toFixed(2)} wagered${t.payout > 0 ? ` · $${t.payout.toFixed(2)} won` : ""}` : ""}
                        </div>
                        <button onClick={()=>{setExpandedTicket(t.id);setEditValues({[t.id]:{stake:t.stake,payout:t.payout,notes:t.notes||""}});}}
                          style={{fontSize:T.small,color:"#6b6b82",background:"transparent",border:"1px solid #2a2a38",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view==="stats" && (
            <div>
              <div style={S.histHeader}>
                <div style={S.histTitle}>Your Stats</div>
              </div>
              <div style={S.statsGrid}>
                <div style={S.statCard}><div style={S.statValue()}>{stats.total}</div><div style={S.statLabel}>Tickets Played</div></div>
                <div style={S.statCard}><div style={S.statValue("#3ecf8e")}>{stats.wins}</div><div style={S.statLabel}>Wins</div></div>
                <div style={S.statCard}><div style={S.statValue()}>${stats.spent.toFixed(2)}</div><div style={S.statLabel}>Total Spent</div></div>
                <div style={S.statCard}><div style={S.statValue(stats.net>=0?"#3ecf8e":"#e8364a")}>{stats.net>=0?"+":""}{stats.net.toFixed(2)}</div><div style={S.statLabel}>Net</div></div>
              </div>
              <div style={S.freqTitle}>🔥 Most Picked Numbers</div>
              <div style={S.freqGrid}>{sorted.length===0?<span style={{color:"#6b6b82",fontSize:T.small}}>No data yet</span>:sorted.slice(0,8).map(([n])=><div key={n} style={S.freqBall(true)}>{n}</div>)}</div>
              <div style={S.freqTitle}>❄️ Least Picked Numbers</div>
              <div style={S.freqGrid}>{sorted.length===0?<span style={{color:"#6b6b82",fontSize:T.small}}>No data yet</span>:sorted.slice(-8).reverse().map(([n])=><div key={n} style={S.freqBall(false)}>{n}</div>)}</div>
              <div style={{...S.disclaimer, marginTop:32}}>
                <div style={S.disclaimerText}>Stats are based on your saved tickets only. Frequency tracking is for personal interest — it does not affect future lottery draws.</div>
              </div>
            </div>
          )}

          {view==="leaderboard" && (
            <div>
              <div style={S.histHeader}>
                <div style={S.histTitle}>Leaderboard</div>
              </div>
              {leaderboard.length===0 ? (
                <div style={S.emptyState}>
                  <div style={{fontSize:ICON_SIZE.emptyHero,marginBottom:16,opacity:0.3}}>🏆</div>
                  <div style={S.emptyStateTitle}>No players yet — set a username to be first.</div>
                </div>
              ) : (
                <>
                  {leaderboard.map(row => (
                    <div key={row.username} style={S.leaderboardRow(row.username === username)}>
                      <div style={S.leaderboardRank}>#{row.rank}</div>
                      <div style={S.leaderboardUsername}>{row.username}</div>
                      <div style={S.leaderboardPoints}>{row.points} pts</div>
                    </div>
                  ))}
                  {myRank && (
                    <div style={{...S.leaderboardRow(true), marginTop:16}}>
                      <div style={S.leaderboardRank}>#{myRank.rank}</div>
                      <div style={S.leaderboardUsername}>Your rank: {myRank.username}</div>
                      <div style={S.leaderboardPoints}>{myRank.points} pts</div>
                    </div>
                  )}
                  {!username && (
                    <div style={{...S.disclaimer, marginTop:20}}>
                      <div style={S.disclaimerText}>Set a username to join the leaderboard.</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          </>)}
        </div>

        {toast && (
          <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#1c1c26", border:"1px solid #2a2a38", borderRadius:12, padding:"14px 24px", fontSize:T.body, fontWeight:500, color:"#3ecf8e", boxShadow:"0 8px 32px rgba(0,0,0,0.5)", whiteSpace:"nowrap", zIndex:100 }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}