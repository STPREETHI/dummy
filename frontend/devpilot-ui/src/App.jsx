import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";

// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = typeof window !== "undefined"
  ? (window.DEVPILOT_API_URL || "http://localhost:8000")
  : "http://localhost:8000";

const USE_MOCK = true; // set false when backend is running

// ── Mock Data ────────────────────────────────────────────────────────────────
const MOCK_OVERVIEW = {
  total_queries: 847,
  unique_developers: 5,
  avg_queries_per_developer: 169.4,
  unanswered_rate: 0.11,
  avg_confidence: 0.83,
  queries_by_day: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    queries: Math.floor(20 + Math.random() * 50)
  })),
  top_knowledge_gaps: [
    { topic: "authentication", query_count: 142, avg_confidence: 0.72, gap_severity: "high" },
    { topic: "deployment",     query_count: 118, avg_confidence: 0.68, gap_severity: "high" },
    { topic: "database",       query_count: 97,  avg_confidence: 0.79, gap_severity: "medium" },
    { topic: "testing",        query_count: 83,  avg_confidence: 0.81, gap_severity: "medium" },
    { topic: "api",            query_count: 71,  avg_confidence: 0.86, gap_severity: "low" },
    { topic: "caching",        query_count: 58,  avg_confidence: 0.64, gap_severity: "high" },
  ],
  most_active_developers: [
    { developer_id: "dev_alice_001", name: "Alice Chen",    queries_total: 203, queries_this_week: 28, onboarding_progress: 78, top_topics: ["auth","api","testing"] },
    { developer_id: "dev_bob_002",   name: "Bob Martinez",  queries_total: 187, queries_this_week: 24, onboarding_progress: 65, top_topics: ["deployment","docker"] },
    { developer_id: "dev_carol_003", name: "Carol Kim",     queries_total: 164, queries_this_week: 19, onboarding_progress: 55, top_topics: ["database","orm"] },
    { developer_id: "dev_dave_004",  name: "Dave Thompson", queries_total: 149, queries_this_week: 15, onboarding_progress: 42, top_topics: ["caching","redis"] },
    { developer_id: "dev_eve_005",   name: "Eve Patel",     queries_total: 144, queries_this_week: 12, onboarding_progress: 38, top_topics: ["payment","stripe"] },
  ]
};

const MOCK_CHAT_RESPONSES = {
  auth: {
    answer: "The authentication system uses **JWT (JSON Web Tokens)** for stateless auth.\n\n**Entry point:** `/services/auth/jwt_handler.py` → `generate_token()`\n\nTokens expire in 24h. Refresh logic lives in `auth/refresh.py`. The middleware at `middleware/auth_middleware.py` protects all `/api/v1/` routes.\n\n**Quick start:** Check `docs/auth.md` for the full flow diagram.",
    sources: [{ title: "Authentication Architecture", url: "/docs/auth.md", excerpt: "JWT-based stateless authentication...", relevance_score: 0.95 }],
    code_references: [{ file_path: "/services/auth/jwt_handler.py", function_name: "generate_token", snippet: "def generate_token(user_id, role):\n    payload = {\"sub\": user_id, ...}", relevance_score: 0.92 }],
    related_topics: ["jwt", "middleware", "oauth", "session"],
    confidence: 0.94
  },
  payment: {
    answer: "Payment processing uses **Stripe** under the hood.\n\n**Flow:** `create_intent()` → `confirm_payment()` → Stripe Webhook\n\n**Key files:**\n- `/services/payment/processor.py` — main logic\n- `/services/payment/stripe_client.py` — Stripe SDK wrapper\n- `/api/webhooks/stripe.py` — webhook handler\n\nAll transactions are persisted to `payments` table via `db/payment_queries.py`.",
    sources: [{ title: "Payment Service Docs", url: "/docs/payments.md", excerpt: "Stripe-based payment processing...", relevance_score: 0.93 }],
    code_references: [{ file_path: "/services/payment/processor.py", function_name: "process_payment", snippet: "async def process_payment(amount, currency):\n    intent = stripe.PaymentIntent.create(...)", relevance_score: 0.9 }],
    related_topics: ["stripe", "webhook", "billing", "subscription"],
    confidence: 0.91
  },
  default: {
    answer: "I found relevant information in the codebase. The system is organized around a **microservices-inspired architecture** with clear separation of concerns:\n\n- `/api/` — FastAPI route handlers\n- `/services/` — Business logic layer\n- `/models/` — Data models (SQLAlchemy)\n- `/db/` — Database queries\n- `/middleware/` — Cross-cutting concerns\n\nCheck the `README.md` for a full architecture overview.",
    sources: [{ title: "Project README", url: "/README.md", excerpt: "Project overview and architecture...", relevance_score: 0.78 }],
    code_references: [],
    related_topics: ["architecture", "api", "services", "models"],
    confidence: 0.79
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
async function apiCall(path, opts = {}) {
  if (USE_MOCK) return null;
  const res = await fetch(`${API_URL}${path}`, opts);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function getMockResponse(q) {
  const lower = q.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("jwt")) return MOCK_CHAT_RESPONSES.auth;
  if (lower.includes("pay") || lower.includes("stripe") || lower.includes("bill")) return MOCK_CHAT_RESPONSES.payment;
  return MOCK_CHAT_RESPONSES.default;
}

const GAP_COLORS = { high: "#ef4444", medium: "#f97316", low: "#22c55e" };
const BAR_COLORS = ["#6366f1","#8b5cf6","#a78bfa","#c4b5fd","#e0e7ff","#ddd6fe"];

// ── Components ───────────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 56, stroke = 5, color = "#6366f1" }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e1b4b" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s ease" }} />
    </svg>
  );
}

function ChatMessage({ msg }) {
  const isBot = msg.role === "assistant";
  const formatAnswer = (text) =>
    text.split("\n").map((line, i) => {
      const bold = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      return <p key={i} dangerouslySetInnerHTML={{ __html: bold }}
        style={{ margin: "2px 0", lineHeight: 1.6 }} />;
    });

  return (
    <div style={{
      display: "flex", gap: 10, marginBottom: 16,
      flexDirection: isBot ? "row" : "row-reverse",
      alignItems: "flex-start"
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        background: isBot ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "linear-gradient(135deg,#0ea5e9,#06b6d4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 700, color: "#fff"
      }}>
        {isBot ? "D" : msg.author?.[0] || "U"}
      </div>
      <div style={{ maxWidth: "75%" }}>
        <div style={{
          background: isBot ? "rgba(99,102,241,0.08)" : "rgba(14,165,233,0.1)",
          border: `1px solid ${isBot ? "rgba(99,102,241,0.2)" : "rgba(14,165,233,0.2)"}`,
          borderRadius: isBot ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
          padding: "10px 14px", fontSize: 13, color: "#e2e8f0"
        }}>
          {formatAnswer(msg.content)}
        </div>
        {isBot && msg.sources?.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {msg.sources.map((s, i) => (
              <span key={i} style={{
                fontSize: 10, padding: "2px 8px",
                background: "rgba(99,102,241,0.15)", borderRadius: 99,
                color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)"
              }}>📄 {s.title}</span>
            ))}
          </div>
        )}
        {isBot && msg.code_references?.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {msg.code_references.map((c, i) => (
              <span key={i} style={{
                fontSize: 10, padding: "2px 8px",
                background: "rgba(16,185,129,0.1)", borderRadius: 99,
                color: "#34d399", border: "1px solid rgba(16,185,129,0.3)",
                fontFamily: "monospace"
              }}>⚡ {c.file_path.split("/").pop()}{c.function_name ? ` → ${c.function_name}` : ""}</span>
            ))}
          </div>
        )}
        {isBot && (
          <div style={{ marginTop: 4, fontSize: 10, color: "#475569" }}>
            {msg.confidence ? `${Math.round(msg.confidence * 100)}% confidence` : ""}
            {" · "}{new Date(msg.ts).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function DevPilotDashboard() {
  const [tab, setTab] = useState("dashboard");
  const [overview, setOverview] = useState(MOCK_OVERVIEW);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant", content: "Hi! I'm **DevPilot** 🤖 — your AI engineering mentor.\n\nAsk me anything about the codebase — architecture, authentication, payments, deployment, or any technical question.",
      ts: Date.now(), sources: [], code_references: [], confidence: 1
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDev, setSelectedDev] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!USE_MOCK) {
      apiCall("/analytics/overview").then(d => d && setOverview(d)).catch(() => {});
    }
  }, []);

  async function sendMessage() {
    const q = inputValue.trim();
    if (!q || isLoading) return;
    setInputValue("");

    setChatMessages(prev => [...prev, { role: "user", content: q, ts: Date.now() }]);
    setIsLoading(true);

    try {
      let result;
      if (USE_MOCK) {
        await new Promise(r => setTimeout(r, 900 + Math.random() * 600));
        result = getMockResponse(q);
      } else {
        const data = await apiCall("/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, developer_id: "dev_dashboard" })
        });
        result = data;
      }
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: result.answer,
        sources: result.sources || [],
        code_references: result.code_references || [],
        related_topics: result.related_topics || [],
        confidence: result.confidence,
        ts: Date.now()
      }]);
    } catch {
      setChatMessages(prev => [...prev, {
        role: "assistant", content: "Connection error. Make sure the DevPilot API is running.",
        ts: Date.now(), sources: [], code_references: [], confidence: 0
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const s = {
    root: {
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      background: "#080b14",
      minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column"
    },
    header: {
      background: "rgba(8,11,20,0.95)",
      borderBottom: "1px solid rgba(99,102,241,0.2)",
      padding: "0 24px",
      display: "flex", alignItems: "center", gap: 20, height: 56,
      backdropFilter: "blur(12px)",
      position: "sticky", top: 0, zIndex: 100
    },
    logo: {
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 18, fontWeight: 800,
      background: "linear-gradient(135deg, #818cf8, #a78bfa)",
      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
    },
    nav: { display: "flex", gap: 4, marginLeft: "auto" },
    navBtn: (active) => ({
      padding: "6px 16px", borderRadius: 8, border: "none",
      background: active ? "rgba(99,102,241,0.2)" : "transparent",
      color: active ? "#818cf8" : "#64748b",
      cursor: "pointer", fontSize: 13, fontWeight: 500,
      transition: "all 0.15s"
    }),
    main: { flex: 1, padding: "24px", maxWidth: 1400, margin: "0 auto", width: "100%" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 },
    card: {
      background: "rgba(15,20,35,0.8)",
      border: "1px solid rgba(99,102,241,0.15)",
      borderRadius: 14, padding: 20,
      backdropFilter: "blur(8px)"
    },
    statNum: { fontSize: 32, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 },
    statLabel: { fontSize: 11, color: "#64748b", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.08em" },
    statDelta: (pos) => ({
      fontSize: 11, color: pos ? "#22c55e" : "#ef4444", marginTop: 6
    }),
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 },
    twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 },
    threeCol: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 },
    badge: (sev) => ({
      fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600,
      background: sev === "high" ? "rgba(239,68,68,0.15)" : sev === "medium" ? "rgba(249,115,22,0.15)" : "rgba(34,197,94,0.15)",
      color: GAP_COLORS[sev] || "#94a3b8",
      border: `1px solid ${sev === "high" ? "rgba(239,68,68,0.3)" : sev === "medium" ? "rgba(249,115,22,0.3)" : "rgba(34,197,94,0.3)"}`
    }),
    chatContainer: {
      height: "calc(100vh - 200px)", display: "flex", flexDirection: "column",
      background: "rgba(15,20,35,0.8)",
      border: "1px solid rgba(99,102,241,0.15)", borderRadius: 16,
      overflow: "hidden"
    },
    chatHeader: {
      padding: "14px 20px", borderBottom: "1px solid rgba(99,102,241,0.15)",
      display: "flex", alignItems: "center", gap: 10
    },
    chatMessages: { flex: 1, overflow: "auto", padding: "16px 20px" },
    chatInput: {
      padding: "12px 16px", borderTop: "1px solid rgba(99,102,241,0.15)",
      display: "flex", gap: 10
    },
    input: {
      flex: 1, background: "rgba(99,102,241,0.06)",
      border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10,
      color: "#e2e8f0", padding: "10px 14px", fontSize: 13, outline: "none",
      fontFamily: "inherit"
    },
    sendBtn: {
      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
      border: "none", borderRadius: 10, color: "#fff",
      padding: "10px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600,
      transition: "opacity 0.15s"
    },
    devCard: (selected) => ({
      background: selected ? "rgba(99,102,241,0.12)" : "rgba(15,20,35,0.8)",
      border: `1px solid ${selected ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.15)"}`,
      borderRadius: 12, padding: "14px 16px", cursor: "pointer",
      transition: "all 0.15s", marginBottom: 8,
      display: "flex", alignItems: "center", gap: 12
    }),
    avatar: (seed) => {
      const colors = [
        ["#6366f1","#a78bfa"], ["#0ea5e9","#06b6d4"], ["#10b981","#34d399"],
        ["#f59e0b","#fbbf24"], ["#ef4444","#f87171"]
      ];
      const c = colors[seed % colors.length];
      return {
        width: 38, height: 38, borderRadius: "50%",
        background: `linear-gradient(135deg, ${c[0]}, ${c[1]})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0
      };
    }
  };

  // ── Dashboard Tab ─────────────────────────────────────────────────────────
  const DashboardTab = () => (
    <div>
      {/* KPI Cards */}
      <div style={s.grid}>
        {[
          { label: "Total Queries", val: overview.total_queries.toLocaleString(), delta: "+23% vs last month", pos: true, icon: "💬" },
          { label: "Active Developers", val: overview.unique_developers, delta: "Onboarding now", pos: true, icon: "👩‍💻" },
          { label: "Avg Confidence", val: `${Math.round(overview.avg_confidence * 100)}%`, delta: "AI answer quality", pos: true, icon: "🎯" },
          { label: "Unanswered Rate", val: `${Math.round(overview.unanswered_rate * 100)}%`, delta: "↓ 4% improvement", pos: true, icon: "❓" },
        ].map((kpi, i) => (
          <div key={i} style={s.card}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{kpi.icon}</div>
            <div style={s.statNum}>{kpi.val}</div>
            <div style={s.statLabel}>{kpi.label}</div>
            <div style={s.statDelta(kpi.pos)}>{kpi.delta}</div>
          </div>
        ))}
      </div>

      <div style={s.twoCol}>
        {/* Query Activity Chart */}
        <div style={s.card}>
          <div style={s.sectionTitle}>Query Activity — Last 14 Days</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={overview.queries_by_day}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#475569" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#475569" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="queries" stroke="#6366f1" strokeWidth={2}
                dot={false} activeDot={{ r: 4, fill: "#818cf8" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Knowledge Gap Heatmap */}
        <div style={s.card}>
          <div style={s.sectionTitle}>Knowledge Gap Analysis</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={overview.top_knowledge_gaps} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#475569" }} tickLine={false} />
              <YAxis dataKey="topic" type="category" tick={{ fontSize: 11, fill: "#94a3b8" }} width={90} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="query_count" radius={[0, 4, 4, 0]}>
                {overview.top_knowledge_gaps.map((g, i) => (
                  <Cell key={i} fill={GAP_COLORS[g.gap_severity]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Developer Progress */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Developer Onboarding Progress</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 12 }}>
          {overview.most_active_developers.map((dev, i) => (
            <div key={dev.developer_id}
              onClick={() => { setSelectedDev(dev); setTab("developers"); }}
              style={{
                background: "rgba(99,102,241,0.05)", borderRadius: 10, padding: "12px 16px",
                border: "1px solid rgba(99,102,241,0.12)", cursor: "pointer",
                transition: "all 0.15s"
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={s.avatar(i)}>
                  {(dev.name || dev.developer_id)[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{dev.name || dev.developer_id}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{dev.queries_this_week} queries this week</div>
                </div>
                <div style={{ marginLeft: "auto", position: "relative" }}>
                  <ProgressRing pct={dev.onboarding_progress} />
                  <div style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%,-50%)",
                    fontSize: 9, fontWeight: 700, color: "#818cf8"
                  }}>{Math.round(dev.onboarding_progress)}%</div>
                </div>
              </div>
              <div style={{ height: 4, background: "rgba(99,102,241,0.1)", borderRadius: 99 }}>
                <div style={{
                  height: "100%", borderRadius: 99,
                  background: "linear-gradient(90deg,#6366f1,#a78bfa)",
                  width: `${dev.onboarding_progress}%`,
                  transition: "width 0.8s ease"
                }} />
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {dev.top_topics.map(t => (
                  <span key={t} style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: 99,
                    background: "rgba(99,102,241,0.1)", color: "#a5b4fc",
                    border: "1px solid rgba(99,102,241,0.2)"
                  }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Ask DevPilot Tab ──────────────────────────────────────────────────────
  const AskTab = () => (
    <div style={s.chatContainer}>
      <div style={s.chatHeader}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700
        }}>D</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>DevPilot AI Mentor</div>
          <div style={{ fontSize: 11, color: "#22c55e" }}>● Online · RAG-powered</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {["How does auth work?", "Where is payment logic?", "How to run tests?"].map(q => (
            <button key={q}
              onClick={() => { setInputValue(q); }}
              style={{
                fontSize: 10, padding: "4px 10px", borderRadius: 99,
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.2)",
                color: "#a5b4fc", cursor: "pointer"
              }}>{q}</button>
          ))}
        </div>
      </div>

      <div style={s.chatMessages}>
        {chatMessages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
        {isLoading && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ ...s.avatar(0), width: 32, height: 32, fontSize: 14 }}>D</div>
            <div style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: "4px 16px 16px 16px",
              padding: "12px 16px"
            }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "#6366f1",
                    animation: "bounce 1s infinite",
                    animationDelay: `${i * 0.15}s`
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={s.chatInput}>
        <input
          style={s.input}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Ask anything about the codebase, architecture, or workflows..."
        />
        <button style={{ ...s.sendBtn, opacity: isLoading ? 0.5 : 1 }}
          onClick={sendMessage} disabled={isLoading}>
          {isLoading ? "..." : "Ask →"}
        </button>
      </div>
    </div>
  );

  // ── Knowledge Gaps Tab ───────────────────────────────────────────────────
  const GapsTab = () => {
    const radarData = overview.top_knowledge_gaps.map(g => ({
      topic: g.topic.charAt(0).toUpperCase() + g.topic.slice(1),
      gap: Math.round((1 - g.avg_confidence) * 100),
      queries: g.query_count
    }));

    return (
      <div>
        <div style={s.twoCol}>
          <div style={s.card}>
            <div style={s.sectionTitle}>Gap Radar — Team Coverage</div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(99,102,241,0.2)" />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <PolarRadiusAxis angle={30} domain={[0, 50]} tick={{ fontSize: 9, fill: "#475569" }} />
                <Radar name="Knowledge Gap %" dataKey="gap" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div style={s.card}>
            <div style={s.sectionTitle}>Gap Severity Index</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              {overview.top_knowledge_gaps.map((g, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{g.topic}</span>
                      <span style={s.badge(g.gap_severity)}>{g.gap_severity}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{g.query_count} queries</span>
                  </div>
                  <div style={{ height: 6, background: "rgba(99,102,241,0.1)", borderRadius: 99 }}>
                    <div style={{
                      height: "100%", borderRadius: 99,
                      background: GAP_COLORS[g.gap_severity],
                      width: `${g.query_count / overview.top_knowledge_gaps[0].query_count * 100}%`,
                      opacity: 0.75,
                      transition: "width 0.8s ease"
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                    Avg AI confidence: {Math.round(g.avg_confidence * 100)}% — {
                      g.gap_severity === "high"
                        ? "📝 Documentation needed urgently"
                        : g.gap_severity === "medium"
                        ? "⚡ Consider updating docs"
                        : "✅ Well covered"
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.sectionTitle}>AI Recommendations — Documentation Actions</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))", gap: 12 }}>
            {[
              { topic: "authentication", action: "Create step-by-step JWT implementation guide", priority: "P0", est: "2h" },
              { topic: "deployment",     action: "Add Kubernetes deployment walkthrough with examples", priority: "P0", est: "3h" },
              { topic: "caching",        action: "Document Redis caching patterns and TTL strategies", priority: "P1", est: "1.5h" },
              { topic: "database",       action: "Expand migration guide with rollback procedures", priority: "P1", est: "2h" },
            ].map((r, i) => (
              <div key={i} style={{
                background: "rgba(99,102,241,0.04)",
                border: "1px solid rgba(99,102,241,0.12)",
                borderRadius: 10, padding: "12px 16px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    background: r.priority === "P0" ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.15)",
                    color: r.priority === "P0" ? "#ef4444" : "#f97316",
                    border: `1px solid ${r.priority === "P0" ? "rgba(239,68,68,0.3)" : "rgba(249,115,22,0.3)"}`
                  }}>{r.priority}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>~{r.est}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                  {r.action}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Topic: {r.topic}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Developers Tab ───────────────────────────────────────────────────────
  const DevelopersTab = () => {
    const dev = selectedDev || overview.most_active_developers[0];
    const timelineData = Array.from({ length: 14 }, (_, i) => ({
      day: `Day ${i + 1}`,
      queries: Math.floor(2 + Math.random() * 12)
    }));

    return (
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
        <div>
          <div style={{ ...s.card, padding: "12px" }}>
            <div style={s.sectionTitle}>Team Members</div>
            {overview.most_active_developers.map((d, i) => (
              <div key={d.developer_id}
                onClick={() => setSelectedDev(d)}
                style={s.devCard(dev.developer_id === d.developer_id)}>
                <div style={s.avatar(i)}>{(d.name || d.developer_id)[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.name || d.developer_id}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{d.queries_total} queries total</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8" }}>
                  {Math.round(d.onboarding_progress)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...s.card, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={s.avatar(overview.most_active_developers.findIndex(d => d.developer_id === dev.developer_id))}>
                {(dev.name || dev.developer_id)[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{dev.name || dev.developer_id}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Onboarding developer · {dev.queries_this_week} queries this week</div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "center" }}>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <ProgressRing pct={dev.onboarding_progress} size={72} stroke={6} />
                  <div style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%,-50%)",
                    fontSize: 13, fontWeight: 800, color: "#818cf8"
                  }}>{Math.round(dev.onboarding_progress)}%</div>
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Onboard Progress</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {[
                { label: "Total Queries", val: dev.queries_total },
                { label: "This Week",     val: dev.queries_this_week },
                { label: "Topics Explored", val: dev.top_topics.length + 3 }
              ].map((s2, i) => (
                <div key={i} style={{
                  background: "rgba(99,102,241,0.06)",
                  borderRadius: 8, padding: "10px 14px",
                  border: "1px solid rgba(99,102,241,0.1)"
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{s2.val}</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{s2.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={s.twoCol}>
            <div style={s.card}>
              <div style={s.sectionTitle}>Query Activity</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#475569" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#475569" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="queries" fill="#6366f1" fillOpacity={0.8} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={s.card}>
              <div style={s.sectionTitle}>Recommended Learning Path</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {["deployment", "kubernetes", "monitoring", "caching"].map((t, i) => (
                  <div key={t} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", borderRadius: 8,
                    background: "rgba(99,102,241,0.05)",
                    border: "1px solid rgba(99,102,241,0.1)"
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: "rgba(99,102,241,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#818cf8", flexShrink: 0
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 12 }}>Learn <strong>{t}</strong></span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#64748b" }}>📖</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { id: "dashboard",   label: "📊 Dashboard" },
    { id: "ask",         label: "🤖 Ask DevPilot" },
    { id: "gaps",        label: "🔍 Knowledge Gaps" },
    { id: "developers",  label: "👩‍💻 Developers" },
  ];

  return (
    <div style={s.root}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 99px; }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        button:hover { opacity: 0.85; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <span style={{ fontSize: 22 }}>🚀</span>
          <span>DevPilot</span>
          <span style={{
            fontSize: 9, fontWeight: 500, padding: "2px 6px",
            background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 4, color: "#818cf8",
            WebkitTextFillColor: "#818cf8"
          }}>MVP</span>
        </div>

        <div style={s.nav}>
          {tabs.map(t => (
            <button key={t.id} style={s.navBtn(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {USE_MOCK ? "Demo Mode" : "Live"}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div style={s.main}>
        {tab === "dashboard"  && <DashboardTab />}
        {tab === "ask"        && <AskTab />}
        {tab === "gaps"       && <GapsTab />}
        {tab === "developers" && <DevelopersTab />}
      </div>
    </div>
  );
}
