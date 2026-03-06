import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, AreaChart, Area
} from "recharts";

// ── CONFIG — values loaded from .env file ────────────────────────────────────
// Create .env in devpilot-ui/ folder (same level as package.json)
// All React env vars must start with REACT_APP_
const GROK_API_KEY = process.env.REACT_APP_GROK_API_KEY || "";
const GROK_API_URL = process.env.REACT_APP_GROK_API_URL || "https://api.x.ai/v1/chat/completions";
const BACKEND_URL  = process.env.REACT_APP_API_URL      || "http://localhost:8000";

// DevPilot project context fed to Grok so it understands the codebase
const PROJECT_CONTEXT = `
You are DevPilot, an AI engineering mentor embedded in a developer onboarding dashboard.
You help new developers understand the DevPilot codebase and any codebase they work with.

## DevPilot Project Structure
- backend/main.py — FastAPI app with endpoints: /query, /ingest, /analytics/*, /onboarding/*, /search, /slack/events
- backend/rag_pipeline.py — LangChain + FAISS RAG engine using OpenAI GPT-4 embeddings
- backend/knowledge_gap.py — SQLite analytics engine tracking developer queries and knowledge gaps
- backend/models.py — Pydantic models: QueryRequest, QueryResponse, IngestRequest, AnalyticsResponse, DeveloperStats, OnboardingStatus
- integrations/slack_bot.py — Slack bot with socket mode, handles @mentions, DMs, /ask and /devpilot-status slash commands
- integrations/slack_client.py — Reusable Slack WebClient wrapper with rich block formatting
- data_ingestion/ingest.py — CLI pipeline to index local dirs, GitHub repos, or URLs into FAISS vector store
- data_ingestion/github_loader.py — Deep GitHub repo analyzer using Python AST for function/class extraction

## Key Technical Details
- Vector store: FAISS (local), can swap to Pinecone for production
- LLM: GPT-4 via LangChain (mock mode works without OpenAI key)
- Database: SQLite for analytics (swap to Postgres for production)
- Auth: No auth on API currently (add API key middleware for production)
- Frontend: React with Recharts for data visualization
- Docker: docker-compose with api, slack_bot, frontend, redis, nginx services

## Running the project
- Backend: cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
- Frontend: cd frontend/devpilot-ui && npm start
- Ingest demo data: cd data_ingestion && python ingest.py --demo
- Slack bot: cd integrations && python slack_bot.py

## API Endpoints
POST /query — ask a question, get AI answer with sources and code refs
POST /ingest — index documents into vector store
GET /analytics/overview — team-wide analytics
GET /analytics/developer/{id} — individual developer stats
GET /analytics/knowledge-gaps — gaps needing documentation
GET /onboarding/status/{id} — developer onboarding progress
POST /onboarding/roadmap — generate personalized learning roadmap
GET /search?q= — semantic search

When answering questions:
1. Be specific about file paths and function names from the project structure above
2. Explain WHY not just WHAT — design decisions matter
3. If asked about something outside the project, answer generally as a helpful engineering mentor
4. Format responses with markdown (bold, code blocks, bullet points)
5. Always suggest next steps or related topics to explore
`;

// ── Mock Data ─────────────────────────────────────────────────────────────────
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

const GAP_COLORS = { high: "#f43f5e", medium: "#fb923c", low: "#34d399" };

// ── Grok AI Call ──────────────────────────────────────────────────────────────
async function askGrok(messages) {
  const hasRealKey = GROK_API_KEY && GROK_API_KEY && GROK_API_KEY.length > 10;

  if (!hasRealKey) {
    // Fallback: try the DevPilot backend
    try {
      const last = messages[messages.length - 1].content;
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: last, developer_id: "dev_dashboard" })
      });
      if (res.ok) {
        const data = await res.json();
        return { answer: data.answer, sources: data.sources || [], code_refs: data.code_references || [], confidence: data.confidence, from: "backend" };
      }
    } catch {}
    // Final fallback: mock
    await new Promise(r => setTimeout(r, 800));
    return { answer: getMockAnswer(messages[messages.length - 1].content), sources: [], code_refs: [], confidence: 0.75, from: "mock" };
  }

  const res = await fetch(GROK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROK_API_KEY}`
    },
    body: JSON.stringify({
      model: "grok-3",
      messages: [
        { role: "system", content: PROJECT_CONTEXT },
        ...messages
      ],
      max_tokens: 1500,
      temperature: 0.3,
      stream: false
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content || "No response from Grok.";
  return { answer, sources: [], code_refs: [], confidence: 0.96, from: "grok" };
}

function getMockAnswer(q) {
  const lower = q.toLowerCase();
  if (lower.includes("auth") || lower.includes("jwt") || lower.includes("login"))
    return "**Authentication** in DevPilot uses JWT tokens.\n\nEntry point: `backend/rag_pipeline.py` handles auth questions via RAG.\n\nIn a real project, check:\n- `services/auth/jwt_handler.py` → `generate_token()`\n- `middleware/auth_middleware.py` → protects `/api/v1/` routes\n- Tokens expire in 24h, refresh logic in `auth/refresh.py`\n\n**Next steps:** Read `docs/auth.md` for the full flow diagram.";
  if (lower.includes("ingest") || lower.includes("document") || lower.includes("vector"))
    return "**Document Ingestion** flows through `data_ingestion/ingest.py`.\n\nRun it:\n```bash\npython ingest.py --demo          # demo data\npython ingest.py --source ./docs  # local folder\npython ingest.py --source https://github.com/org/repo --type github\n```\n\nInternally it uses **LangChain + FAISS** to chunk, embed, and store documents. The vector store is saved to `./vector_store/` and loaded automatically on API startup.";
  if (lower.includes("slack"))
    return "**Slack Integration** lives in `integrations/slack_bot.py`.\n\nIt supports:\n- `@devpilot <question>` — mentions in any channel\n- Direct messages to the bot\n- `/ask <question>` slash command\n- `/devpilot-status` for your onboarding progress\n\nRun it: `cd integrations && python slack_bot.py`\n\nRequires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in your `.env` file.";
  if (lower.includes("deploy") || lower.includes("docker") || lower.includes("run"))
    return "**Running DevPilot:**\n\n```bash\n# Backend API\ncd backend\nuvicorn main:app --host 0.0.0.0 --port 8000 --reload\n\n# Frontend\ncd frontend/devpilot-ui\nnpm start\n\n# Or with Docker (everything at once)\ndocker-compose up -d\n```\n\nAPI runs at `http://localhost:8000`\nSwagger UI at `http://localhost:8000/docs`\nDashboard at `http://localhost:3000`";
  return "I'm DevPilot, your AI engineering mentor. I can help you understand:\n\n- **Architecture** — how the RAG pipeline, vector store, and analytics work\n- **API endpoints** — what each route does and how to call it\n- **Slack integration** — setup and usage\n- **Data ingestion** — indexing your own codebase\n- **Running locally** — step by step setup\n\nWhat would you like to explore?\n\n> *Add your Grok API key in `App.js` for full AI power.*";
}

// ── Format Markdown ───────────────────────────────────────────────────────────
function MarkdownText({ text }) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} style={{
          background: "rgba(0,0,0,0.4)", border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: 8, padding: "10px 14px", fontSize: 12,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          overflowX: "auto", margin: "6px 0", color: "#a5f3fc",
          lineHeight: 1.6
        }}>
          {lang && <div style={{ color: "#6366f1", fontSize: 10, marginBottom: 4 }}>{lang}</div>}
          {codeLines.join("\n")}
        </pre>
      );
    } else if (line.startsWith("## ")) {
      elements.push(<div key={i} style={{ fontWeight: 800, fontSize: 14, color: "#f1f5f9", margin: "10px 0 4px" }}>{line.slice(3)}</div>);
    } else if (line.startsWith("# ")) {
      elements.push(<div key={i} style={{ fontWeight: 800, fontSize: 16, color: "#f1f5f9", margin: "10px 0 4px" }}>{line.slice(2)}</div>);
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      const content = line.slice(2);
      elements.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "2px 0" }}>
          <span style={{ color: "#6366f1", flexShrink: 0 }}>▸</span>
          <span style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{
            __html: content
              .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
              .replace(/`(.*?)`/g, '<code style="background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px;color:#a5b4fc">$1</code>')
          }} />
        </div>
      );
    } else if (line.startsWith("> ")) {
      elements.push(
        <div key={i} style={{
          borderLeft: "3px solid #6366f1", paddingLeft: 10, margin: "6px 0",
          color: "#94a3b8", fontSize: 12, fontStyle: "italic"
        }}>{line.slice(2)}</div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 6 }} />);
    } else {
      elements.push(
        <div key={i} style={{ fontSize: 13, lineHeight: 1.7, margin: "2px 0" }}
          dangerouslySetInnerHTML={{
            __html: line
              .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
              .replace(/`(.*?)`/g, '<code style="background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px;color:#a5b4fc">$1</code>')
              .replace(/\*(.*?)\*/g, '<em style="color:#94a3b8">$1</em>')
          }}
        />
      );
    }
    i++;
  }
  return <div>{elements}</div>;
}

// ── Progress Ring ──────────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 56, stroke = 5, color = "#6366f1" }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(99,102,241,0.1)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round" style={{ transition: "stroke-dasharray 1s ease" }} />
    </svg>
  );
}

const AVATAR_GRADIENTS = [
  ["#6366f1","#a78bfa"], ["#0ea5e9","#06b6d4"], ["#10b981","#34d399"],
  ["#f59e0b","#fbbf24"], ["#f43f5e","#fb7185"]
];

function Avatar({ index, letter, size = 36 }) {
  const [a, b] = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, ${a}, ${b})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#fff"
    }}>{letter}</div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function DevPilotDashboard() {
  const [tab, setTab]                   = useState("ask");
  const [overview]                      = useState(MOCK_OVERVIEW);
  const [selectedDev, setSelectedDev]   = useState(null);
  const [inputValue, setInputValue]     = useState("");
  const [isLoading, setIsLoading]       = useState(false);
  const [agentStatus, setAgentStatus]   = useState("idle"); // idle | thinking | streaming | done
  const [conversationHistory, setConversationHistory] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hey! I'm **DevPilot** 🚀 — your AI engineering mentor powered by Grok.\n\nI know the entire DevPilot codebase inside-out. Ask me anything:\n\n- How does the RAG pipeline work?\n- How do I ingest my own GitHub repo?\n- How does the Slack bot handle mentions?\n- How do I add a new API endpoint?\n- How does the knowledge gap analyzer work?\n\nOr ask me anything about software engineering in general!",
      ts: Date.now(),
      sources: [],
      code_refs: [],
      confidence: 1,
      from: "system"
    }
  ]);
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = useCallback(async () => {
    const q = inputValue.trim();
    if (!q || isLoading) return;
    setInputValue("");

    const userMsg = { role: "user", content: q, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setAgentStatus("thinking");

    const newHistory = [...conversationHistory, { role: "user", content: q }];

    try {
      const result = await askGrok(newHistory);
      setConversationHistory([...newHistory, { role: "assistant", content: result.answer }]);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: result.answer,
        sources: result.sources || [],
        code_refs: result.code_refs || [],
        confidence: result.confidence,
        from: result.from,
        ts: Date.now()
      }]);
      setAgentStatus("done");
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `**Connection error:** ${err.message}\n\nMake sure your Grok API key is set correctly in \`App.js\`, or start the DevPilot backend at \`http://localhost:8000\`.`,
        ts: Date.now(), sources: [], code_refs: [], confidence: 0, from: "error"
      }]);
      setAgentStatus("idle");
    } finally {
      setIsLoading(false);
      setTimeout(() => setAgentStatus("idle"), 2000);
    }
  }, [inputValue, isLoading, conversationHistory]);

  const clearChat = () => {
    setMessages([messages[0]]);
    setConversationHistory([]);
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const C = {
    bg: "#07090f",
    surface: "rgba(13,17,28,0.9)",
    border: "rgba(99,102,241,0.18)",
    borderHover: "rgba(99,102,241,0.4)",
    accent: "#6366f1",
    accentSoft: "rgba(99,102,241,0.12)",
    text: "#e2e8f0",
    muted: "#64748b",
    green: "#34d399",
    red: "#f43f5e",
    orange: "#fb923c",
  };

  const card = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: 20,
    backdropFilter: "blur(12px)",
  };

  const SUGGESTED = [
    "How does the RAG pipeline work?",
    "How do I ingest my GitHub repo?",
    "Explain the knowledge gap analyzer",
    "How does Slack bot handle /ask command?",
    "How to add a new API endpoint?",
    "What happens when I run ingest.py --demo?",
  ];

  // ── Chat Message ──────────────────────────────────────────────────────────
  const ChatMessage = ({ msg, index }) => {
    const isBot = msg.role === "assistant";
    const fromLabel = { grok: "Grok-3", backend: "DevPilot API", mock: "Demo", system: "DevPilot", error: "Error" };
    const fromColor = { grok: "#818cf8", backend: "#34d399", mock: "#f59e0b", system: "#818cf8", error: "#f43f5e" };

    return (
      <div style={{
        display: "flex", gap: 12, marginBottom: 20,
        flexDirection: isBot ? "row" : "row-reverse",
        alignItems: "flex-start",
        animation: "fadeSlideIn 0.3s ease",
        animationFillMode: "both",
        animationDelay: `${index * 0.05}s`
      }}>
        {isBot ? (
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, boxShadow: "0 0 16px rgba(99,102,241,0.3)"
          }}>🚀</div>
        ) : (
          <Avatar index={0} letter="U" size={34} />
        )}

        <div style={{ maxWidth: "78%", minWidth: 0 }}>
          {isBot && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#c7d2fe" }}>DevPilot</span>
              {msg.from && msg.from !== "system" && (
                <span style={{
                  fontSize: 9, padding: "1px 6px", borderRadius: 99,
                  background: "rgba(99,102,241,0.15)", color: fromColor[msg.from] || "#818cf8",
                  border: `1px solid ${fromColor[msg.from] || "#818cf8"}40`,
                  fontWeight: 700, letterSpacing: "0.05em"
                }}>via {fromLabel[msg.from] || msg.from}</span>
              )}
              {msg.confidence > 0 && msg.confidence < 1 && (
                <span style={{ fontSize: 9, color: C.muted }}>
                  {Math.round(msg.confidence * 100)}% confidence
                </span>
              )}
            </div>
          )}
          <div style={{
            background: isBot
              ? "linear-gradient(135deg, rgba(13,17,35,0.95), rgba(20,15,45,0.9))"
              : "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(99,102,241,0.1))",
            border: `1px solid ${isBot ? "rgba(99,102,241,0.2)" : "rgba(14,165,233,0.25)"}`,
            borderRadius: isBot ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
            padding: "12px 16px",
            color: C.text,
            boxShadow: isBot ? "0 4px 24px rgba(0,0,0,0.3)" : "none"
          }}>
            <MarkdownText text={msg.content} />
          </div>

          {isBot && msg.sources?.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {msg.sources.map((s, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 99,
                  background: "rgba(99,102,241,0.1)", color: "#a5b4fc",
                  border: "1px solid rgba(99,102,241,0.25)"
                }}>📄 {s.title}</span>
              ))}
            </div>
          )}
          {isBot && msg.code_refs?.length > 0 && (
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {msg.code_refs.map((c, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 99,
                  background: "rgba(16,185,129,0.08)", color: "#34d399",
                  border: "1px solid rgba(16,185,129,0.25)", fontFamily: "monospace"
                }}>⚡ {c.file_path?.split("/").pop()}{c.function_name ? ` → ${c.function_name}` : ""}</span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 10, color: "#334155" }}>
            {new Date(msg.ts).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  };

  // ── Ask Tab ───────────────────────────────────────────────────────────────
  const AskTab = () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, height: "calc(100vh - 120px)" }}>
      {/* Chat panel */}
      <div style={{ ...card, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
        {/* Chat header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 12
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 0 20px rgba(99,102,241,0.4)"
          }}>🚀</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#f1f5f9" }}>DevPilot AI Agent</div>
            <div style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: agentStatus === "thinking" ? "#f59e0b" : "#34d399",
                display: "inline-block",
                boxShadow: `0 0 6px ${agentStatus === "thinking" ? "#f59e0b" : "#34d399"}`
              }} />
              <span style={{ color: C.muted }}>
                {agentStatus === "thinking" ? "Thinking..." : agentStatus === "done" ? "✓ Done" : "Ready · Grok-3 powered"}
              </span>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <div style={{
              fontSize: 10, padding: "3px 10px", borderRadius: 99,
              background: GROK_API_KEY && GROK_API_KEY.length > 10
                ? "rgba(99,102,241,0.15)" : "rgba(251,146,60,0.15)",
              color: GROK_API_KEY && GROK_API_KEY.length > 10 ? "#818cf8" : "#fb923c",
              border: `1px solid ${GROK_API_KEY && GROK_API_KEY.length > 10 ? "rgba(99,102,241,0.3)" : "rgba(251,146,60,0.3)"}`,
              fontWeight: 700
            }}>
              {GROK_API_KEY && GROK_API_KEY.length > 10 ? "⚡ Grok Live" : "⚠ Add API Key"}
            </div>
            <button onClick={clearChat} style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 99,
              background: "rgba(99,102,241,0.08)", border: `1px solid ${C.border}`,
              color: C.muted, cursor: "pointer"
            }}>Clear</button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
          {messages.map((msg, i) => <ChatMessage key={i} msg={msg} index={i} />)}
          {isLoading && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16
              }}>🚀</div>
              <div style={{
                background: "rgba(13,17,35,0.95)", border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: "4px 16px 16px 16px", padding: "14px 18px"
              }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: 7, height: 7, borderRadius: "50%", background: "#6366f1",
                      animation: "pulse 1.2s ease-in-out infinite",
                      animationDelay: `${i * 0.2}s`
                    }} />
                  ))}
                  <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>
                    DevPilot is thinking...
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ask anything about the codebase, architecture, integrations..."
              style={{
                flex: 1, background: "rgba(99,102,241,0.06)",
                border: `1px solid ${C.border}`, borderRadius: 12,
                color: C.text, padding: "11px 16px", fontSize: 13,
                outline: "none", fontFamily: "inherit",
                transition: "border-color 0.2s"
              }}
              onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !inputValue.trim()}
              style={{
                background: isLoading || !inputValue.trim()
                  ? "rgba(99,102,241,0.2)"
                  : "linear-gradient(135deg, #6366f1, #7c3aed)",
                border: "none", borderRadius: 12, color: "#fff",
                padding: "11px 20px", cursor: isLoading ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700, transition: "all 0.2s",
                boxShadow: isLoading ? "none" : "0 0 20px rgba(99,102,241,0.4)"
              }}
            >
              {isLoading ? "..." : "Send ↗"}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        {/* Suggested questions */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Quick Questions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {SUGGESTED.map((q, i) => (
              <button key={i} onClick={() => { setInputValue(q); inputRef.current?.focus(); }} style={{
                textAlign: "left", background: "rgba(99,102,241,0.05)",
                border: `1px solid ${C.border}`, borderRadius: 10,
                color: "#a5b4fc", padding: "8px 12px", cursor: "pointer",
                fontSize: 12, lineHeight: 1.4, transition: "all 0.15s"
              }}
              onMouseOver={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = C.borderHover; }}
              onMouseOut={e => { e.target.style.background = "rgba(99,102,241,0.05)"; e.target.style.borderColor = C.border; }}>
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Project files quick reference */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Project Files
          </div>
          {[
            { file: "backend/main.py", desc: "API routes", color: "#818cf8" },
            { file: "rag_pipeline.py", desc: "RAG engine", color: "#34d399" },
            { file: "knowledge_gap.py", desc: "Analytics", color: "#f59e0b" },
            { file: "slack_bot.py", desc: "Slack integration", color: "#fb923c" },
            { file: "ingest.py", desc: "Data pipeline", color: "#06b6d4" },
          ].map((f, i) => (
            <button key={i}
              onClick={() => { setInputValue(`Explain what ${f.file} does and how it works`); inputRef.current?.focus(); }}
              style={{
                width: "100%", textAlign: "left", background: "transparent",
                border: "none", cursor: "pointer", padding: "5px 0",
                borderBottom: i < 4 ? `1px solid rgba(99,102,241,0.08)` : "none"
              }}>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: f.color }}>{f.file}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{f.desc}</div>
            </button>
          ))}
        </div>

        {/* API key status */}
        <div style={{ ...card, padding: 16, background: GROK_API_KEY && GROK_API_KEY.length > 10 ? "rgba(99,102,241,0.05)" : "rgba(251,146,60,0.05)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            AI Engine
          </div>
          {GROK_API_KEY && GROK_API_KEY.length > 10 ? (
            <div style={{ fontSize: 12, color: C.green }}>✓ Grok-3 connected<br/><span style={{ color: C.muted, fontSize: 11 }}>Full AI mode active</span></div>
          ) : (
            <div style={{ fontSize: 12, color: C.orange }}>
              ⚠ Demo mode active<br/>
              <span style={{ color: C.muted, fontSize: 11 }}>
                Open <code style={{ fontSize: 10 }}>src/App.js</code>, find<br/>
                <code style={{ fontSize: 10 }}>GROK_API_KEY</code> and paste your key.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Dashboard Tab ──────────────────────────────────────────────────────────
  const DashboardTab = () => (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Total Queries", val: overview.total_queries.toLocaleString(), sub: "+23% this month", icon: "💬", color: "#818cf8" },
          { label: "Active Developers", val: overview.unique_developers, sub: "Onboarding now", icon: "👩‍💻", color: "#34d399" },
          { label: "Avg Confidence", val: `${Math.round(overview.avg_confidence * 100)}%`, sub: "AI answer quality", icon: "🎯", color: "#f59e0b" },
          { label: "Unanswered Rate", val: `${Math.round(overview.unanswered_rate * 100)}%`, sub: "↓ 4% improvement", icon: "❓", color: "#f43f5e" },
        ].map((kpi, i) => (
          <div key={i} style={card}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>{kpi.icon}</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: kpi.color, lineHeight: 1 }}>{kpi.val}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{kpi.label}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Query Volume — 14 Days</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={overview.queries_by_day}>
              <defs>
                <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#475569" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#475569" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="queries" stroke="#6366f1" strokeWidth={2} fill="url(#qGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Knowledge Gap Heatmap</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={overview.top_knowledge_gaps} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" horizontal={false} />
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

      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>Developer Onboarding Progress</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {overview.most_active_developers.map((dev, i) => (
            <div key={dev.developer_id}
              onClick={() => { setSelectedDev(dev); setTab("developers"); }}
              style={{
                background: "rgba(99,102,241,0.04)", borderRadius: 12, padding: "14px 16px",
                border: `1px solid ${C.border}`, cursor: "pointer", transition: "all 0.2s"
              }}
              onMouseOver={e => { e.currentTarget.style.background = "rgba(99,102,241,0.09)"; e.currentTarget.style.borderColor = C.borderHover; }}
              onMouseOut={e => { e.currentTarget.style.background = "rgba(99,102,241,0.04)"; e.currentTarget.style.borderColor = C.border; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Avatar index={i} letter={(dev.name || dev.developer_id)[0].toUpperCase()} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{dev.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{dev.queries_this_week} queries this week</div>
                </div>
                <div style={{ marginLeft: "auto", position: "relative" }}>
                  <ProgressRing pct={dev.onboarding_progress} />
                  <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 9, fontWeight: 800, color: "#818cf8" }}>
                    {Math.round(dev.onboarding_progress)}%
                  </div>
                </div>
              </div>
              <div style={{ height: 4, background: "rgba(99,102,241,0.1)", borderRadius: 99 }}>
                <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#6366f1,#a78bfa)", width: `${dev.onboarding_progress}%`, transition: "width 1s ease" }} />
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {dev.top_topics.map(t => (
                  <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(99,102,241,0.1)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)" }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Gaps Tab ──────────────────────────────────────────────────────────────
  const GapsTab = () => {
    const radarData = overview.top_knowledge_gaps.map(g => ({
      topic: g.topic.charAt(0).toUpperCase() + g.topic.slice(1),
      gap: Math.round((1 - g.avg_confidence) * 100),
    }));
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Gap Radar</div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(99,102,241,0.15)" />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <PolarRadiusAxis angle={30} domain={[0, 50]} tick={{ fontSize: 9, fill: "#475569" }} />
                <Radar name="Gap %" dataKey="gap" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Severity Index</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {overview.top_knowledge_gaps.map((g, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{g.topic}</span>
                      <span style={{
                        fontSize: 9, padding: "1px 7px", borderRadius: 99, fontWeight: 700,
                        background: `${GAP_COLORS[g.gap_severity]}18`,
                        color: GAP_COLORS[g.gap_severity],
                        border: `1px solid ${GAP_COLORS[g.gap_severity]}40`
                      }}>{g.gap_severity}</span>
                    </div>
                    <span style={{ fontSize: 11, color: C.muted }}>{g.query_count} queries</span>
                  </div>
                  <div style={{ height: 5, background: "rgba(99,102,241,0.08)", borderRadius: 99 }}>
                    <div style={{
                      height: "100%", borderRadius: 99, background: GAP_COLORS[g.gap_severity],
                      width: `${g.query_count / overview.top_knowledge_gaps[0].query_count * 100}%`,
                      opacity: 0.75, transition: "width 1s ease"
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>
                    {Math.round(g.avg_confidence * 100)}% avg confidence
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>AI Recommendations</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 12 }}>
            {[
              { topic: "authentication", action: "Create step-by-step JWT implementation guide", priority: "P0", est: "2h" },
              { topic: "deployment", action: "Add Kubernetes walkthrough with YAML examples", priority: "P0", est: "3h" },
              { topic: "caching", action: "Document Redis caching patterns and TTL strategies", priority: "P1", est: "1.5h" },
              { topic: "database", action: "Expand migration guide with rollback procedures", priority: "P1", est: "2h" },
            ].map((r, i) => (
              <div key={i} style={{ background: "rgba(99,102,241,0.04)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    background: r.priority === "P0" ? "rgba(244,63,94,0.15)" : "rgba(251,146,60,0.15)",
                    color: r.priority === "P0" ? "#f43f5e" : "#fb923c",
                    border: `1px solid ${r.priority === "P0" ? "rgba(244,63,94,0.3)" : "rgba(251,146,60,0.3)"}`
                  }}>{r.priority}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>~{r.est}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.action}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Topic: {r.topic}</div>
                <button
                  onClick={() => { setInputValue(`Help me write documentation for the ${r.topic} topic in this project`); setTab("ask"); }}
                  style={{
                    marginTop: 10, fontSize: 11, padding: "4px 12px", borderRadius: 8,
                    background: "rgba(99,102,241,0.1)", border: `1px solid ${C.border}`,
                    color: "#818cf8", cursor: "pointer"
                  }}>Ask DevPilot to help →</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Developers Tab ─────────────────────────────────────────────────────────
  const DevelopersTab = () => {
    const dev = selectedDev || overview.most_active_developers[0];
    const timelineData = Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`, queries: Math.floor(2 + Math.random() * 12)
    }));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
        <div style={{ ...card, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Team</div>
          {overview.most_active_developers.map((d, i) => (
            <div key={d.developer_id} onClick={() => setSelectedDev(d)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 4,
              background: dev.developer_id === d.developer_id ? "rgba(99,102,241,0.12)" : "transparent",
              border: `1px solid ${dev.developer_id === d.developer_id ? "rgba(99,102,241,0.4)" : "transparent"}`,
              transition: "all 0.15s"
            }}>
              <Avatar index={i} letter={(d.name || d.developer_id)[0].toUpperCase()} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{d.queries_total} queries</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#818cf8" }}>{Math.round(d.onboarding_progress)}%</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <Avatar index={overview.most_active_developers.findIndex(d => d.developer_id === dev.developer_id)} letter={(dev.name || dev.developer_id)[0].toUpperCase()} size={48} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{dev.name}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{dev.queries_this_week} queries this week</div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "center" }}>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <ProgressRing pct={dev.onboarding_progress} size={72} stroke={6} />
                  <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 13, fontWeight: 900, color: "#818cf8" }}>{Math.round(dev.onboarding_progress)}%</div>
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Progress</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {[
                { label: "Total Queries", val: dev.queries_total },
                { label: "This Week", val: dev.queries_this_week },
                { label: "Topics", val: dev.top_topics.length + 3 }
              ].map((s, i) => (
                <div key={i} style={{ background: "rgba(99,102,241,0.06)", borderRadius: 10, padding: "10px 14px", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 24, fontWeight: 900 }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Activity</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#475569" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#475569" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="queries" fill="#6366f1" fillOpacity={0.8} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Learning Path</div>
              {["deployment","kubernetes","monitoring","caching"].map((t, i) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < 3 ? `1px solid rgba(99,102,241,0.06)` : "none" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#818cf8", flexShrink: 0 }}>{i+1}</span>
                  <span style={{ fontSize: 12 }}>Learn <strong>{t}</strong></span>
                  <button onClick={() => { setInputValue(`Create a learning guide for ${t} for a new developer`); setTab("ask"); }}
                    style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(99,102,241,0.08)", border: `1px solid ${C.border}`, color: "#818cf8", cursor: "pointer" }}>Ask AI</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const TABS = [
    { id: "ask", label: "🤖 AI Agent" },
    { id: "dashboard", label: "📊 Dashboard" },
    { id: "gaps", label: "🔍 Gaps" },
    { id: "developers", label: "👩‍💻 Developers" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 99px; }
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { transform: scale(1); opacity:0.5; } 50% { transform: scale(1.4); opacity:1; } }
        button { font-family: inherit; }
      `}</style>

      {/* Header */}
      <div style={{
        background: "rgba(7,9,15,0.95)", borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", alignItems: "center", gap: 20,
        height: 54, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(16px)"
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 900,
          background: "linear-gradient(135deg, #818cf8, #a78bfa, #c084fc)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>
          <span>🚀</span> DevPilot
          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 4, color: "#818cf8", WebkitTextFillColor: "#818cf8" }}>AI</span>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "5px 14px", borderRadius: 8, border: "none",
              background: tab === t.id ? "rgba(99,102,241,0.18)" : "transparent",
              color: tab === t.id ? "#818cf8" : C.muted,
              cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s"
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 8px #34d399" }} />
          <span style={{ fontSize: 11, color: C.muted }}>
            {GROK_API_KEY && GROK_API_KEY.length > 10 ? "Grok-3 Live" : "Demo Mode"}
          </span>
        </div>
      </div>

      {/* Main */}
      <div style={{ padding: "20px 24px", maxWidth: 1440, margin: "0 auto" }}>
        {tab === "ask"        && <AskTab />}
        {tab === "dashboard"  && <DashboardTab />}
        {tab === "gaps"       && <GapsTab />}
        {tab === "developers" && <DevelopersTab />}
      </div>
    </div>
  );
}
