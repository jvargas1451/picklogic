import { useState } from "react";

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
  modesRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  modeBtn: (active) => ({ padding: "8px 16px", borderRadius: 20, border: `1px solid ${active ? "#7c6aff" : "#2a2a38"}`, background: active ? "rgba(124,106,255,0.15)" : "transparent", color: active ? "#7c6aff" : "#6b6b82", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }),
  pickBox: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: "28px 24px", marginBottom: 16 },
  pickLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" },
  modeTag: { fontSize: 10, padding: "3px 8px", borderRadius: 10, background: "rgba(124,106,255,0.15)", color: "#7c6aff", border: "1px solid rgba(124,106,255,0.2)" },
  ballsRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 },
  ball: (type) => ({ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "2px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5", boxShadow: type === "pb" ? "0 0 20px rgba(232,54,74,0.3)" : type === "mm" ? "0 0 20px rgba(245,166,35,0.3)" : "none" }),
  sep: { color: "#2a2a38", fontSize: 20 },
  rationale: { fontSize: 12, color: "#6b6b82", fontStyle: "italic", lineHeight: 1.5, paddingTop: 14, borderTop: "1px solid #2a2a38" },
  emptyPick: { textAlign: "center", padding: "20px 0" },
  emptyIcon: { fontSize: 32, marginBottom: 10, opacity: 0.3 },
  emptyText: { color: "#6b6b82", fontSize: 13 },
  btnPrimary: (type) => ({ width: "100%", padding: 16, borderRadius: 14, border: "none", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", background: type === "pb" ? "#e8364a" : "#f5a623", color: type === "pb" ? "white" : "#0a0a0f", boxShadow: type === "pb" ? "0 4px 24px rgba(232,54,74,0.3)" : "0 4px 24px rgba(245,166,35,0.3)", transition: "all 0.2s" }),
  btnSecondary: { width: "100%", padding: 14, borderRadius: 14, border: "1px solid #2a2a38", background: "transparent", color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer", marginTop: 10, transition: "all 0.2s" },
  saveForm: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 20, padding: 24, marginTop: 16 },
  formLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, display: "block" },
  formInput: { width: "100%", padding: "12px 14px", background: "#1c1c26", border: "1px solid #2a2a38", borderRadius: 10, color: "#f0f0f5", fontFamily: "'DM Sans', sans-serif", fontSize: 14, outline: "none", marginBottom: 16 },
  formSplit: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 0 },
  btnSave: { width: "100%", padding: 14, borderRadius: 12, border: "none", background: "#7c6aff", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 20px rgba(124,106,255,0.3)", marginTop: 16 },
  disclaimer: { marginTop: 28, padding: 16, borderRadius: 12, border: "1px solid #2a2a38", background: "#13131a" },
  disclaimerText: { fontSize: 11, color: "#6b6b82", lineHeight: 1.6, textAlign: "center" },
  histHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  histTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 20 },
  ticketCount: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b6b82", background: "#13131a", border: "1px solid #2a2a38", padding: "4px 10px", borderRadius: 20 },
  filterRow: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  filterBtn: (active) => ({ padding: "7px 14px", borderRadius: 20, border: `1px solid ${active ? "#f0f0f5" : "#2a2a38"}`, background: active ? "#1c1c26" : "transparent", color: active ? "#f0f0f5" : "#6b6b82", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  ticketCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "18px 20px", marginBottom: 12 },
  ticketTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  ticketGame: (type) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: type === "pb" ? "#e8364a" : "#f5a623" }),
  ticketMeta: { display: "flex", alignItems: "center", gap: 10 },
  ticketDate: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b6b82" },
  statusBadge: (s) => ({ fontFamily: "'DM Mono', monospace", fontSize: 10, padding: "3px 8px", borderRadius: 10, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", background: s === "won" ? "rgba(62,207,142,0.15)" : s === "lost" ? "rgba(232,54,74,0.1)" : "rgba(107,107,130,0.2)", color: s === "won" ? "#3ecf8e" : s === "lost" ? "#e8364a" : "#6b6b82", border: `1px solid ${s === "won" ? "rgba(62,207,142,0.3)" : s === "lost" ? "rgba(232,54,74,0.2)" : "#2a2a38"}` }),
  tBallsRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tBall: (type) => ({ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, background: type === "main" ? "#1c1c26" : type === "pb" ? "#e8364a" : "#f5a623", border: type === "main" ? "1.5px solid #2a2a38" : "none", color: type === "mm" ? "#0a0a0f" : "#f0f0f5" }),
  ticketNotes: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #2a2a38", fontSize: 12, color: "#6b6b82", fontStyle: "italic" },
  emptyState: { textAlign: "center", padding: "60px 20px", color: "#6b6b82" },
  emptyStateTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#f0f0f5", marginBottom: 8 },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 },
  statCard: { background: "#13131a", border: "1px solid #2a2a38", borderRadius: 16, padding: "20px 18px" },
  statValue: (color) => ({ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28, marginBottom: 4, color: color || "#f0f0f5" }),
  statLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#6b6b82", letterSpacing: 1, textTransform: "uppercase" },
  freqTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 14, marginBottom: 14, marginTop: 24 },
  freqGrid: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  freqBall: (hot) => ({ width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, background: hot ? "rgba(232,54,74,0.2)" : "rgba(124,106,255,0.1)", color: hot ? "#e8364a" : "#7c6aff", border: `1.5px solid ${hot ? "rgba(232,54,74,0.4)" : "rgba(124,106,255,0.2)"}` }),
};

export default function App() {
  const [view, setView] = useState("pick");
  const [game, setGame] = useState("pb");
  const [mode, setMode] = useState("random");
  const [pick, setPick] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [tickets, setTickets] = useState(() => JSON.parse(localStorage.getItem("pl_tickets") || "[]"));
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ drawDate: "", stake: "", payout: "", notes: "" });
  const [toast, setToast] = useState("");

  const persist = (t) => { setTickets(t); localStorage.setItem("pl_tickets", JSON.stringify(t)); };

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
    setForm({ drawDate: new Date().toISOString().split("T")[0], stake: "", payout: "", notes: "" });
  };

  const saveTicket = () => {
    if (!pick) return;
    const t = { id: Date.now(), ...pick, ...form, stake: parseFloat(form.stake)||0, payout: parseFloat(form.payout)||0, status: "open", savedAt: new Date().toISOString() };
    persist([t, ...tickets]);
    setShowSave(false);
    setPick(null);
    setForm({ drawDate: "", stake: "", payout: "", notes: "" });
    showToast("✓ Ticket saved!");
  };

  const cycleStatus = (id) => {
    const states = ["open","won","lost"];
    const updated = tickets.map(t => t.id===id ? {...t, status: states[(states.indexOf(t.status)+1)%3]} : t);
    persist(updated);
    showToast("Status updated");
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

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <div style={{ background:"#0a0a0f", minHeight:"100vh" }}>
        <div style={S.app}>
          <header style={S.header}>
            <div style={S.logo}>Pick<span style={S.logoAccent}>Logic</span></div>
            <div style={S.logoBadge}>ENTERTAINMENT ONLY</div>
          </header>

          <nav style={S.nav}>
            {["pick","history","stats"].map((v,i)=>(
              <button key={v} style={S.navBtn(view===v)} onClick={()=>setView(v)}>
                {["Quick Pick","My Tickets","Stats"][i]}
              </button>
            ))}
          </nav>

          {/* PICK VIEW */}
          {view==="pick" && (
            <div>
              <div style={S.sectionLabel}>Select Game</div>
              <div style={S.gameGrid}>
                {Object.entries(GAMES).map(([key,g])=>(
                  <div key={key} style={S.gameCard(game===key,key)} onClick={()=>{setGame(key);setPick(null);setShowSave(false);}}>
                    <div style={S.gameName(key)}>{g.name}</div>
                    <div style={S.gameOdds}>{key==="pb"?"1 in 292,201,338":"1 in 302,575,350"}</div>
                    <div style={S.gameJackpot}>{key==="pb"?"$450M":"$320M"}</div>
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
                  <div style={S.formSplit}>
                    <div>
                      <label style={S.formLabel}>Stake ($)</label>
                      <input style={S.formInput} type="number" placeholder="2.00" value={form.stake} onChange={e=>setForm({...form,stake:e.target.value})} />
                    </div>
                    <div>
                      <label style={S.formLabel}>Payout ($)</label>
                      <input style={S.formInput} type="number" placeholder="0.00" value={form.payout} onChange={e=>setForm({...form,payout:e.target.value})} />
                    </div>
                  </div>
                  <label style={S.formLabel}>Notes (optional)</label>
                  <input style={S.formInput} type="text" placeholder="Friday draw..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
                  <button style={S.btnSave} onClick={saveTicket}>Save Ticket</button>
                </div>
              )}

              <div style={S.disclaimer}>
                <div style={S.disclaimerText}>PickLogic is an entertainment tool. Pick strategies are for fun — they do not improve your odds of winning. Please play responsibly.</div>
              </div>
            </div>
          )}

          {/* HISTORY VIEW */}
          {view==="history" && (
            <div>
              <div style={S.histHeader}>
                <div style={S.histTitle}>My Tickets</div>
                <div style={S.ticketCount}>{tickets.length} ticket{tickets.length!==1?"s":""}</div>
              </div>
              <div style={S.filterRow}>
                {[["all","All"],["pb","Powerball"],["mm","Mega Millions"],["open","Open"]].map(([key,label])=>(
                  <button key={key} style={S.filterBtn(filter===key)} onClick={()=>setFilter(key)}>{label}</button>
                ))}
              </div>
              {filtered.length===0 ? (
                <div style={S.emptyState}>
                  <div style={{fontSize:40,marginBottom:16,opacity:0.3}}>🎟️</div>
                  <div style={S.emptyStateTitle}>No tickets yet</div>
                  <div>Save a ticket from the Quick Pick tab</div>
                </div>
              ) : filtered.map(t=>(
                <div key={t.id} style={S.ticketCard}>
                  <div style={S.ticketTop}>
                    <div style={S.ticketGame(t.game)}>{GAMES[t.game].name}</div>
                    <div style={S.ticketMeta}>
                      <span style={S.ticketDate}>{t.drawDate ? new Date(t.drawDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"}</span>
                      <span style={S.statusBadge(t.status)} onClick={()=>cycleStatus(t.id)}>{t.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={S.tBallsRow}>
                    {t.numbers.map(n=><div key={n} style={S.tBall("main")}>{n}</div>)}
                    <div style={S.sep}>+</div>
                    <div style={S.tBall(t.game)}>{t.special}</div>
                  </div>
                  {t.notes && <div style={S.ticketNotes}>{t.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {/* STATS VIEW */}
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

        {/* Toast */}
        {toast && (
          <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#1c1c26", border:"1px solid #2a2a38", borderRadius:12, padding:"14px 24px", fontSize:13, fontWeight:500, color:"#3ecf8e", boxShadow:"0 8px 32px rgba(0,0,0,0.5)", whiteSpace:"nowrap", zIndex:100 }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}