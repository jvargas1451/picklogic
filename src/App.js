import { useState, useEffect } from "react";
import config from "./config";
import { supabase } from "./supabase";

const GAMES = {
  pb: { name: "Powerball", main: [1, 69], special: [1, 26], mainCount: 5, class: "pb" },
  mm: { name: "Mega Millions", main: [1, 70], special: [1, 25], mainCount: 5, class: "mm" },
};

const MODES = {
  random: { label: "Random", rationale: "Five unique numbers drawn at random — no bias, no system." },
  balanced: { label: "Balanced", rationale: "Distributed across low, mid, and high ranges for variety." },
  hot: { label: "Hot Numbers", rationale: "Weighted toward your most-played numbers from saved tickets." },
  cold: { label: "Cold Numbers", rationale: "Weighted toward numbers you've played least often." },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
      for (let j = 0; j < remaining.length; j++) {
        cum += w[j];
        if (r <= cum) { nums.push(remaining[j]); break; }
      }
    }
  } else {
    while (nums.length < count) {
      const n = randInt(min, max);
      if (!nums.includes(n)) nums.push(n);
    }
  }
  return nums.sort((a, b) => a - b);
}

// ── Result checking ───────────────────────────────────────────
function checkResult(ticket, draws) {
  const draw = draws.find(d => d.game === ticket.game && d.draw_date === ticket.draw_date);
  if (!draw) return null;

  const matchedMain = ticket.numbers.filter(n => draw.numbers.includes(n)).length;
  const matchedSpecial = ticket.special === draw.special;

  if (ticket.game === "pb") {
    if (matchedMain === 5 && matchedSpecial) return { label: "🏆 JACKPOT", color: "#f5a623", bg: "rgba(245,166,35,0.15)", border: "rgba(245,166,35,0.4)" };
    if (matchedMain === 5) return { label: "Matched 5 — $1,000,000", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 4 && matchedSpecial) return { label: "Matched 4 + PB — $50,000", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 4) return { label: "Matched 4 — $100", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 3 && matchedSpecial) return { label: "Matched 3 + PB — $100", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 3) return { label: "Matched 3 — $7", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 2 && matchedSpecial) return { label: "Matched 2 + PB — $7", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 1 && matchedSpecial) return { label: "Matched 1 + PB — $4", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedSpecial) return { label: "Matched PB — $4", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    return { label: "No match", color: "#6b6b82", bg: "rgba(107,107,130,0.1)", border: "#2a2a38" };
  }

  if (ticket.game === "mm") {
    if (matchedMain === 5 && matchedSpecial) return { label: "🏆 JACKPOT", color: "#f5a623", bg: "rgba(245,166,35,0.15)", border: "rgba(245,166,35,0.4)" };
    if (matchedMain === 5) return { label: "Matched 5 — $1,000,000", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 4 && matchedSpecial) return { label: "Matched 4 + MB — $10,000", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 4) return { label: "Matched 4 — $500", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 3 && matchedSpecial) return { label: "Matched 3 + MB — $200", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 3) return { label: "Matched 3 — $10", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 2 && matchedSpecial) return { label: "Matched 2 + MB — $10", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedMain === 1 && matchedSpecial) return { label: "Matched 1 + MB — $4", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    if (matchedSpecial) return { label: "Matched MB — $2", color: "#3ecf8e", bg: "rgba(62,207,142,0.15)", border: "rgba(62,207,142,0.3)" };
    return { label: "No match", color: "#6b6b82", bg: "rgba(107,107,130,0.1)", border: "#2a2a38" };
  }

  return null;
}

const S = {
  app: { maxWidth: 480, margin: "0 auto", padding: "0 20px 100px", position: "relative", zIndex: 1 },
  header: { padding: "32px 0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: -0.5 },
  logoAccent: { color: "#7c6aff" },
  logoBadge: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", border: "1px solid #2a2a38", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.5 },
  nav: { display: "flex", gap: 4, background: "#13131a", border: "1px solid #2a2a38", borderRadius: 14, padding: 5, marginBottom: 28 },
  navBtn: (active) => ({ flex: 1, padding: 10, border: "none", background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, borderRadius: 10, cursor: "pointer", transition: "all 0.2s" }),
  sectionLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 },
  gameGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 },
  gameCard: (active, type) => ({ padding: "18px 16px", borderRadius: 16, border: `2px solid ${active ? (type === "pb" ? "#e8364a" : "#f5a623") : "#2a2a38"}`, background: "#13131a", cursor: "pointer", transition: "all 0.2s", boxShadow: active ? `0 0 24px ${type === "pb" ? "rgba(232,54,74,0.15)" : "rgba(245,166,35,0.15)"}` : "none" }),
  gameName: (type) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: type === "pb" ? "#e8364a" : "#f5a623", marginBottom: 4 }),
  gameOdds: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82" },
  gameJackpot: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 20, marginTop: 8, color: "#f0f0f5" },
  gameNextDraw: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", marginTop: 4 },
  modesRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  modeBtn: (active) => ({ padding: "8px 16px", borderRadius: 20, border: `1px solid ${active ? "#7c6aff" : "#2a2a38"}`, background: active ? "rgba(124,106,255,0.15)" : "transparent", color: active ? "#7c6aff" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }),
  pickBox: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: "28px 24px", marginBottom: 16 },
  pickLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" },
  modeTag: { fontSize: 10, padding: "3px 8px", borderRadius: 10, background: "rgba(124,106,255,0.15)", color: "#7c6aff", border: "1px solid rgba(124,106,255,0.2)" },
  ballsRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 },
  ball: (type) => ({ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "2px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5", boxShadow: type === "pb" ? "0 0 20px rgba(232,54,74,0.3)" : type === "mm" ? "0 0 20px rgba(245,166,35,0.3)" : "none" }),
  sep: { color: "#6b6b82", fontSize: 20 },
  rationale: { fontSize: 12, color: "#6b6b82", fontStyle: "italic", lineHeight: 1.5, paddingTop: 14, borderTop: "1px solid #2a2a38" },
  emptyPick: { textAlign: "center", padding: "20px 0" },
  emptyIcon: { fontSize: 32, marginBottom: 10, opacity: 0.3 },
  emptyText: { color: "#6b6b82", fontSize: 13 },
  btnPrimary: (type) => ({ width: "100%", padding: 16, borderRadius: 14, border: "none", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", background: type === "pb" ? "#e8364a" : "#f5a623", color: type === "pb" ? "white" : "#0a0a0f", boxShadow: type === "pb" ? "0 4px 24px rgba(232,54,74,0.3)" : "0 4px 24px rgba(245,166,35,0.3)", transition: "all 0.2s" }),
  btnSecondary: { width: "100%", padding: 14, borderRadius: 14, border: "1px solid #2a2a38", background: "transparent", color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer", marginTop: 10, transition: "all 0.2s" },
  saveForm: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: 24, marginTop: 16 },
  formLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, display: "block" },
  formInput: { width: "100%", padding: "12px 14px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 10, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: 14, outline: "none", marginBottom: 16 },
  btnSave: { width: "100%", padding: 14, borderRadius: 12, border: "none", background: "#7c6aff", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 20px rgba(124,106,255,0.3)", marginTop: 16 },
  disclaimer: { marginTop: 28, padding: 16, borderRadius: 12, border: "1px solid #2a2a38", background: "#13131a" },
  disclaimerText: { fontSize: 11, color: "#6b6b82", lineHeight: 1.6, textAlign: "center" },
  histHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  histTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 20, color: "#f0f0f5" },
  ticketCount: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b6b82", background: "#13131a", border: "1px solid #2a2a38", padding: "4px 10px", borderRadius: 20 },
  filterRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  filterBtn: (active) => ({ padding: "7px 14px", borderRadius: 20, border: `1px solid ${active ? "#f0f0f5" : "#2a2a38"}`, background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  ticketCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "18px 20px", marginBottom: 12 },
  ticketTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  ticketGame: (type) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: type === "pb" ? "#e8364a" : "#f5a623" }),
  ticketMeta: { display: "flex", alignItems: "center", gap: 10 },
  ticketDate: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b6b82" },
  statusBadge: (s) => ({ fontFamily: "'DM Mono', monospace", fontSize: 10, padding: "3px 8px", borderRadius: 10, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", background: s === "won" ? "rgba(62,207,142,0.15)" : s === "lost" ? "rgba(232,54,74,0.1)" : "rgba(107,107,130,0.2)", color: s === "won" ? "#3ecf8e" : s === "lost" ? "#e8364a" : "#6b6b82", border: `1px solid ${s === "won" ? "rgba(62,207,142,0.3)" : s === "lost" ? "rgba(232,54,74,0.2)" : "#2a2a38"}` }),
  resultBadge: (r) => ({ display: "inline-block", fontFamily: "'DM Mono', monospace", fontSize: 10, padding: "4px 10px", borderRadius: 10, letterSpacing: 0.5, marginTop: 10, background: r.bg, color: r.color, border: `1px solid ${r.border}` }),
  tBallsRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tBall: (type) => ({ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "1.5px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5" }),
  ticketNotes: { marginTop: 10, fontSize: 12, color: "#6b6b82", fontStyle: "italic" },
  ticketEditRow: { display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid #2a2a38", alignItems: "center", flexWrap: "wrap" },
  ticketEditInput: { flex: 1, minWidth: 80, padding: "8px 10px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 8, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: 12, outline: "none" },
  ticketEditLabel: { fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4, display: "block" },
  emptyState: { textAlign: "center", padding: "60px 20px", color: "#6b6b82" },
  emptyStateTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#f0f0f5", marginBottom: 8 },
  emptyStateText: { color: "#6b6b82", fontSize: 13 },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 },
  statCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "20px 18px" },
  statValue: (color) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28, marginBottom: 4, color: color || "#f0f0f5" }),
  statLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase" },
  freqTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 14, marginBottom: 14, marginTop: 24, color: "#f0f0f5" },
  freqGrid: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  freqBall: (hot) => ({ width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, background: hot ? "rgba(232,54,74,0.2)" : "rgba(124,106,255,0.1)", color: hot ? "#e8364a" : "#7c6aff", border: `1.5px solid ${hot ? "rgba(232,54,74,0.4)" : "rgba(124,106,255,0.2)"}` }),
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" },
  authBox: { width: "100%", maxWidth: 400, background: "#13131a", border: "1px solid #2a2a38", borderRadius: 24, padding: 32 },
  authLogo: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28, textAlign: "center", marginBottom: 8 },
  authSubtitle: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b6b82", textAlign: "center", marginBottom: 32, letterSpacing: 0.5 },
  authTabs: { display: "flex", gap: 4, background: "#0a0a0f", borderRadius: 10, padding: 4, marginBottom: 28 },
  authTab: (active) => ({ flex: 1, padding: "9px 0", border: "none", background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: "pointer" }),
  authError: { background: "rgba(232,54,74,0.1)", border: "1px solid rgba(232,54,74,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#e8364a", marginBottom: 16 },
  authSuccess: { background: "rgba(62,207,142,0.1)", border: "1px solid rgba(62,207,142,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#3ecf8e", marginBottom: 16 },
  signOutBtn: { background: "transparent", border: "1px solid #2a2a38", color: "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: "pointer" },
};

// ── Auth Screen ──────────────────────────────────────────────
function AuthScreen() {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async () => {
    setError(""); setSuccess(""); setLoading(true);
    if (tab === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setSuccess("Account created! Check your email to confirm, then log in.");
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <div style={S.authWrap}>
        <div style={S.authBox}>
          <div style={S.authLogo}><span style={{ color: "#f0f0f5" }}>Pick</span><span style={S.logoAccent}>Logic</span></div>
          <div style={S.authSubtitle}>POWERBALL · MEGA MILLIONS</div>
          <div style={S.authTabs}>
            <button style={S.authTab(tab === "login")} onClick={() => { setTab("login"); setError(""); setSuccess(""); }}>Log In</button>
            <button style={S.authTab(tab === "signup")} onClick={() => { setTab("signup"); setError(""); setSuccess(""); }}>Sign Up</button>
          </div>
          {error && <div style={S.authError}>{error}</div>}
          {success && <div style={S.authSuccess}>{success}</div>}
          <label style={S.formLabel}>Email</label>
          <input style={S.formInput} type="email" placeholder="you@email.com" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          <label style={S.formLabel}>Password</label>
          <input style={S.formInput} type="password" placeholder="••••••••" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          <button style={S.btnSave} onClick={handleSubmit} disabled={loading}>
            {loading ? "Please wait..." : tab === "login" ? "Log In" : "Create Account"}
          </button>
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
  const [toast, setToast] = useState("");
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualForm, setManualForm] = useState({ game: "pb", numbers: ["","","","",""], special: "", drawDate: "", notes: "" });

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

  useEffect(() => {
    if (session) loadTickets();
    else setTickets([]);
  }, [session]);

  const loadTickets = async () => {
    const { data, error } = await supabase
      .from("tickets").select("*").order("created_at", { ascending: false });
    if (!error) setTickets(data || []);
  };

  const loadDraws = async () => {
    const { data, error } = await supabase
      .from("draws").select("*").order("draw_date", { ascending: false });
    if (!error) setDraws(data || []);
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

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
    setForm({ drawDate: new Date().toISOString().split("T")[0], notes: "" });
  };

  const saveTicket = async () => {
    if (!pick || !session) return;
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
    if (error) { showToast("Error saving ticket"); return; }
    setTickets([data, ...tickets]);
    setShowSave(false);
    setPick(null);
    setForm({ drawDate: "", notes: "" });
    showToast("✓ Ticket saved!");
  };

    const saveTicketEdit = async (id) => {
    const vals = editValues[id] || {};
    const ticket = tickets.find(t => t.id === id);
    const updates = {
      stake: parseFloat(vals.stake) || ticket.stake || 0,
      payout: parseFloat(vals.payout) || ticket.payout || 0,
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
    const saveManualTicket = async () => {
    const nums = manualForm.numbers.map(n => parseInt(n)).filter(n => !isNaN(n));
    const special = parseInt(manualForm.special);
    const g = GAMES[manualForm.game];
    if (nums.length !== 5) { showToast("Enter all 5 main numbers"); return; }
    if (isNaN(special)) { showToast("Enter the " + (manualForm.game === "pb" ? "Powerball" : "Mega Ball")); return; }
    if (nums.some(n => n < g.main[0] || n > g.main[1])) { showToast("Main numbers out of range"); return; }
    if (new Set(nums).size !== 5) { showToast("Numbers must be unique"); return; }
    if (special < g.special[0] || special > g.special[1]) { showToast("Special ball out of range"); return; }
    const { data, error } = await supabase.from("tickets").insert({
      user_id: session.user.id,
      game: manualForm.game,
      numbers: nums.sort((a,b) => a-b),
      special,
      pick_mode: "manual",
      draw_date: manualForm.drawDate || null,
      notes: manualForm.notes || null,
      stake: 0, payout: 0, status: "open",
    }).select().single();
    if (error) { showToast("Error saving ticket"); return; }
    setTickets([data, ...tickets]);
    setShowManualEntry(false);
    setManualForm({ game: "pb", numbers: ["","","","",""], special: "", drawDate: "", notes: "" });
    showToast("✓ Ticket saved!");
  };
    const getDrawReminders = () => {
    const now = new Date();
    const day = 1;
    const today = now.toISOString().split("T")[0];
    const yesterday = new Date(now - 86400000).toISOString().split("T")[0];
    const reminders = [];
    const pbDays = [1, 3, 6];
    const mmDays = [2, 5];

    // No ticket yet — draw is tonight
    if (pbDays.includes(day) && !tickets.some(t => t.game === "pb" && t.draw_date === today)) {
      reminders.push({ game: "pb", label: "Powerball draws tonight at 10:59pm ET — you don't have a ticket yet", color: "#e8364a" });
    }
    if (mmDays.includes(day) && !tickets.some(t => t.game === "mm" && t.draw_date === today)) {
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
  const filtered = tickets.filter(t => filter==="all" || t.game===filter || (filter==="open" && t.status==="open"));

  const stats = {
    total: tickets.length,
    wins: tickets.filter(t=>t.status==="won").length,
    spent: tickets.reduce((s,t)=>s+(t.stake||0),0),
    net: tickets.filter(t=>t.status==="won").reduce((s,t)=>s+(t.payout||0),0) - tickets.reduce((s,t)=>s+(t.stake||0),0),
  };

  const freq = {};
  tickets.forEach(t=>t.numbers.forEach(n=>{freq[n]=(freq[n]||0)+1;}));
  const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);

  if (authLoading) return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@800&display=swap" rel="stylesheet" />
      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: "#f0f0f5" }}>Pick<span style={{ color: "#7c6aff" }}>Logic</span></div>
    </div>
  );

  if (!session) return <AuthScreen />;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <div style={{ background:"#0a0a0f", minHeight:"100vh" }}>
        <div style={S.app}>
          <header style={S.header}>
            <div style={S.logo}><span style={{color:"#f0f0f5"}}>Pick</span><span style={S.logoAccent}>Logic</span></div>
            <button style={S.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </header>
          {getDrawReminders().map(r => (
  <div key={r.game} style={{ background: `rgba(${r.game==="pb"?"232,54,74":"245,166,35"},0.1)`, border: `1px solid rgba(${r.game==="pb"?"232,54,74":"245,166,35"},0.3)`, borderRadius: 12, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ fontSize: 16 }}>🎟️</span>
    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: r.color, fontWeight: 500 }}>{r.label}</span>
  </div>
))}
          <nav style={S.nav}>
            {["pick","history","stats"].map((v,i)=>(
              <button key={v} style={S.navBtn(view===v)} onClick={()=>setView(v)}>
                {["Quick Pick","My Tickets","Stats"][i]}
              </button>
            ))}
          </nav>

          {view==="pick" && (
            <div>
              <div style={S.sectionLabel}>Select Game</div>
              <div style={S.gameGrid}>
                {Object.entries(GAMES).map(([key,g])=>(
                  <div key={key} style={S.gameCard(game===key,key)} onClick={()=>{setGame(key);setPick(null);setShowSave(false);}}>
                    <div style={S.gameName(key)}>{g.name}</div>
                    <div style={S.gameOdds}>{key==="pb"?"1 in 292,201,338":"1 in 302,575,350"}</div>
                    <div style={S.gameJackpot}>{config.jackpots[key]}</div>
                    <div style={S.gameNextDraw}>Next: {config.nextDraw[key]}</div>
                  </div>
                ))}
              </div>
              <div style={S.sectionLabel}>Pick Strategy</div>
              <div style={S.modesRow}>
                {Object.entries(MODES).map(([key,m])=>(
                  <button key={key} style={S.modeBtn(mode===key)} onClick={()=>setMode(key)}>{m.label}</button>
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
              {pick && (
                <button style={S.btnSecondary} onClick={()=>setShowSave(!showSave)}>
                  {showSave ? "Cancel" : "+ Save This Ticket"}
                </button>
              )}
              {showSave && (
                <div style={S.saveForm}>
                  <label style={S.formLabel}>Draw Date</label>
                  <input style={S.formInput} type="date" value={form.drawDate} onChange={e=>setForm({...form,drawDate:e.target.value})} />
                  <label style={S.formLabel}>Notes (optional)</label>
                  <input style={S.formInput} type="text" placeholder="e.g. Friday lucky pick..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
                  <div style={{ fontSize:11, color:"#6b6b82", marginBottom:12 }}>Tip: add stake and payout after the draw from My Tickets</div>
                  <button style={S.btnSave} onClick={saveTicket}>Save Ticket</button>
                </div>
              )}
              <div style={S.disclaimer}>
                <div style={S.disclaimerText}>PickLogic is an entertainment tool. Pick strategies are for fun — they do not improve your odds of winning. Please play responsibly.</div>
              </div>
            </div>
          )}

          {view==="history" && (
            <div>
              <div style={S.histHeader}>
  <div style={S.histTitle}>My Tickets</div>
  <div style={S.ticketCount}>{tickets.length} ticket{tickets.length!==1?"s":""}</div>
</div>
<button style={{...S.btnSecondary, marginBottom: 16}} onClick={() => setShowManualEntry(!showManualEntry)}>
  {showManualEntry ? "Cancel" : "+ Enter Ticket Manually"}
</button>
{showManualEntry && (
  <div style={S.saveForm}>
    <div style={S.sectionLabel}>Game</div>
    <div style={{display:"flex", gap:8, marginBottom:16}}>
      {["pb","mm"].map(key => (
        <button key={key} style={{flex:1, padding:"10px 0", borderRadius:10, border:`1px solid ${manualForm.game===key?(key==="pb"?"#e8364a":"#f5a623"):"#2a2a38"}`, background: manualForm.game===key?"#1c1c26":"transparent", color: manualForm.game===key?(key==="pb"?"#e8364a":"#f5a623"):"#6b6b82", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, cursor:"pointer"}}
          onClick={() => setManualForm({...manualForm, game: key})}>
          {GAMES[key].name}
        </button>
      ))}
    </div>
    <div style={S.sectionLabel}>Main Numbers (pick 5)</div>
    <div style={{display:"flex", gap:8, marginBottom:16}}>
      {manualForm.numbers.map((n, i) => (
        <input key={i} style={{width:48, height:48, borderRadius:"50%", background:"#1c1c26", border:"1.5px solid #2a2a38", color:"#f0f0f5", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, textAlign:"center", outline:"none"}}
         type="number" placeholder="—" value={n} min={1} max={manualForm.game === "pb" ? 69 : 70}
          onChange={e => { const nums = [...manualForm.numbers]; nums[i] = e.target.value; setManualForm({...manualForm, numbers: nums}); }} />
      ))}
    </div>
    <div style={S.sectionLabel}>{manualForm.game === "pb" ? "Powerball" : "Mega Ball"}</div>
    <div style={{marginBottom:16}}>
      <input style={{width:48, height:48, borderRadius:"50%", background: manualForm.game==="pb"?"#e8364a":"#f5a623", border:"none", color: manualForm.game==="pb"?"white":"#0a0a0f", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, textAlign:"center", outline:"none"}}
        type="number" placeholder="—" value={manualForm.special} min={1} max={manualForm.game === "pb" ? 26 : 25}
        onChange={e => setManualForm({...manualForm, special: e.target.value})} />
    </div>
    <label style={S.formLabel}>Draw Date</label>
    <input style={S.formInput} type="date" value={manualForm.drawDate} min="2020-01-01" max="2030-12-31" onChange={e => setManualForm({...manualForm, drawDate: e.target.value})} />
    <label style={S.formLabel}>Notes (optional)</label>
    <input style={S.formInput} type="text" placeholder="e.g. corner store ticket..." value={manualForm.notes} onChange={e => setManualForm({...manualForm, notes: e.target.value})} />
    <button style={S.btnSave} onClick={saveManualTicket}>Save Ticket</button>
  </div>
)}
              <div style={S.filterRow}>
                {[["all","All"],["pb","Powerball"],["mm","Mega Millions"],["open","Open"]].map(([key,label])=>(
                  <button key={key} style={S.filterBtn(filter===key)} onClick={()=>setFilter(key)}>{label}</button>
                ))}
              </div>
              {filtered.length===0 ? (
                <div style={S.emptyState}>
                  <div style={{fontSize:40,marginBottom:16,opacity:0.3}}>🎟️</div>
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
                        <div style={{display:"flex",flexDirection:"column",gap:4,paddingTop:14}}>
                          <button onClick={()=>saveTicketEdit(t.id)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:"#7c6aff",color:"white",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Save</button>
                          <button onClick={()=>{setExpandedTicket(null);setEditValues({});}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #2a2a38",background:"transparent",color:"#6b6b82",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:11,color:"#6b6b82",fontFamily:"'DM Mono',monospace"}}>
                          {t.stake > 0 ? `$${t.stake.toFixed(2)} wagered${t.payout > 0 ? ` · $${t.payout.toFixed(2)} won` : ""}` : ""}
                        </div>
                        <button onClick={()=>{setExpandedTicket(t.id);setEditValues({[t.id]:{stake:t.stake,payout:t.payout,notes:t.notes||""}});}}
                          style={{fontSize:11,color:"#6b6b82",background:"transparent",border:"1px solid #2a2a38",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
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
              <div style={S.freqGrid}>{sorted.length===0?<span style={{color:"#6b6b82",fontSize:12}}>No data yet</span>:sorted.slice(0,8).map(([n])=><div key={n} style={S.freqBall(true)}>{n}</div>)}</div>
              <div style={S.freqTitle}>❄️ Least Picked Numbers</div>
              <div style={S.freqGrid}>{sorted.length===0?<span style={{color:"#6b6b82",fontSize:12}}>No data yet</span>:sorted.slice(-8).reverse().map(([n])=><div key={n} style={S.freqBall(false)}>{n}</div>)}</div>
              <div style={{...S.disclaimer, marginTop:32}}>
                <div style={S.disclaimerText}>Stats are based on your saved tickets only. Frequency tracking is for personal interest — it does not affect future lottery draws.</div>
              </div>
            </div>
          )}
        </div>

        {toast && (
          <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#1c1c26", border:"1px solid #2a2a38", borderRadius:12, padding:"14px 24px", fontSize:13, fontWeight:500, color:"#3ecf8e", boxShadow:"0 8px 32px rgba(0,0,0,0.5)", whiteSpace:"nowrap", zIndex:100 }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}