<<<<<<< HEAD
# 🚀 DevPilot — AI-Powered Developer Onboarding Assistant

> *"Understand any codebase in hours, not months."*

**Team:** The Avengers | **Theme:** Intelligent Systems / Developer Productivity

---

## What Is DevPilot?

DevPilot is an AI Engineering Mentor that helps new developers understand complex codebases instantly. Unlike generic documentation tools, DevPilot provides **contextual engineering guidance** with actual code references, adaptive learning insights, and Slack integration — directly in developers' workflows.

**Problem it solves:** New engineers spend 1–3 months becoming productive because knowledge is scattered across code, wikis, and senior engineers' heads.

**DevPilot's answer:** RAG-powered AI that understands your codebase + Knowledge Gap Analytics + Slack bot = measurable onboarding acceleration.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        DevPilot System                           │
│                                                                  │
│  ┌──────────┐   /ask    ┌─────────────────────────────────────┐ │
│  │  Slack   │──────────▶│         FastAPI Backend             │ │
│  │   Bot    │           │                                     │ │
│  └──────────┘           │  ┌───────────┐  ┌───────────────┐  │ │
│                         │  │  /query   │  │  /analytics   │  │ │
│  ┌──────────┐           │  └─────┬─────┘  └───────┬───────┘  │ │
│  │  React   │◀──────────│        │                │           │ │
│  │Dashboard │           │  ┌─────▼──────────────────────┐    │ │
│  └──────────┘           │  │      RAG Pipeline           │    │ │
│                         │  │  LangChain + FAISS + GPT-4  │    │ │
│  ┌──────────┐           │  └─────┬──────────────────┬────┘    │ │
│  │  GitHub  │──ingest──▶│        │                  │         │ │
│  │   Repo   │           │  ┌─────▼────┐  ┌──────────▼──────┐ │ │
│  └──────────┘           │  │  Vector  │  │  Knowledge Gap  │ │ │
│                         │  │  Store   │  │    Analyzer     │ │ │
│  ┌──────────┐           │  │  (FAISS) │  │   (SQLite DB)   │ │ │
│  │  Docs /  │──ingest──▶│  └──────────┘  └─────────────────┘ │ │
│  │  Wikis   │           └─────────────────────────────────────┘ │
│  └──────────┘                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
devpilot/
├── backend/
│   ├── main.py            # FastAPI app — all API endpoints
│   ├── rag_pipeline.py    # LangChain + FAISS RAG engine
│   ├── knowledge_gap.py   # Analytics engine (SQLite)
│   ├── models.py          # Pydantic request/response models
│   ├── requirements.txt
│   └── Dockerfile
│
├── integrations/
│   ├── slack_bot.py       # Full Slack bot (socket mode)
│   ├── slack_client.py    # Reusable Slack client
│   └── Dockerfile
│
├── data_ingestion/
│   ├── ingest.py          # CLI ingestion pipeline
│   └── github_loader.py   # Deep GitHub repo analyzer
│
├── frontend/
│   ├── DevPilotDashboard.jsx   # React dashboard component
│   └── Dockerfile
│
├── .env.example           # Copy to .env and fill in keys
├── docker-compose.yml
├── setup.ps1              # Windows full setup (PowerShell)
├── start.bat              # Windows quick-start (double-click)
└── README.md
```

---

## ⚡ Quick Start — Windows

### Option A: PowerShell Setup (recommended)

```powershell
# 1. Allow PowerShell scripts (one-time)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 2. Run setup
.\setup.ps1

# Flags:
.\setup.ps1 -SkipIngest   # No OpenAI key? Skip ingestion, still works in mock mode
.\setup.ps1 -NoStart      # Install only, don't auto-start the server
```

### Option B: Double-click `start.bat`

Just double-click `start.bat` in File Explorer. It handles everything.

### Option C: Manual (Command Prompt / PowerShell)

```cmd
cd devpilot
copy .env.example .env
:: Edit .env and add your OPENAI_API_KEY

python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt

:: Optional: ingest demo docs (needs OPENAI_API_KEY)
cd data_ingestion && python ingest.py --demo && cd ..

:: Start API
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## ⚡ Quick Start — Docker

```bash
copy .env.example .env   # Windows
# or: cp .env.example .env  (Linux/Mac)
# Edit .env and add OPENAI_API_KEY

docker-compose up -d
# API:       http://localhost:8000
# Dashboard: http://localhost:3000

# With Slack bot:
docker-compose --profile slack up -d
```

---

## Environment Variables

Edit `.env` (copied from `.env.example`):

```env
OPENAI_API_KEY=sk-...        # Required for full RAG; mock mode works without it
SLACK_BOT_TOKEN=xoxb-...     # Optional: Slack bot
SLACK_APP_TOKEN=xapp-...     # Optional: Slack socket mode
GITHUB_TOKEN=ghp_...         # Optional: private GitHub repos

# Defaults work for local dev — no need to change these
VECTOR_STORE_PATH=./vector_store
DB_PATH=./devpilot.db
```

> **No OpenAI key?** The API runs in **mock mode** with realistic pre-built answers for auth, payments, deployment, etc. Perfect for demos.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | System health + doc count |
| `POST` | `/query` | Ask a question, get AI answer with sources |
| `POST` | `/ingest` | Index documents/repos into vector store |
| `GET`  | `/ingest/status/{job_id}` | Ingestion job status |
| `GET`  | `/search?q=...` | Semantic search across all docs |
| `GET`  | `/analytics/overview` | Team-wide knowledge gap analytics |
| `GET`  | `/analytics/developer/{id}` | Individual dev stats |
| `GET`  | `/analytics/hot-topics` | Topics generating most questions |
| `GET`  | `/analytics/knowledge-gaps` | Areas needing better docs |
| `POST` | `/onboarding/roadmap` | Generate personalized roadmap |
| `GET`  | `/onboarding/status/{id}` | Dev's onboarding progress |
| `POST` | `/slack/events` | Slack Events API webhook |

**Swagger UI (browser):** http://localhost:8000/docs

### Example Query

```powershell
# PowerShell
Invoke-RestMethod -Uri http://localhost:8000/query -Method POST `
  -ContentType "application/json" `
  -Body '{"question":"How does auth work?","developer_id":"dev_alice"}'

# curl (Git Bash / WSL)
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"question":"How does auth work?","developer_id":"dev_alice"}'
```

---

## Ingesting Your Codebase

```powershell
.venv\Scripts\activate
cd data_ingestion

# Local folder
python ingest.py --source C:\path\to\your-project

# GitHub repo
python ingest.py --source https://github.com/your-org/repo --type github

# Demo data (no real project needed)
python ingest.py --demo
```

---

## React Dashboard

```powershell
npx create-react-app devpilot-ui
cd devpilot-ui
npm install recharts
copy ..\frontend\DevPilotDashboard.jsx src\App.jsx
npm start
# Opens http://localhost:3000
```

---

## Slack Bot

1. Create app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable Socket Mode → get `SLACK_APP_TOKEN`
3. Add Bot Scopes: `app_mentions:read`, `chat:write`, `commands`, `im:history`
4. Add slash commands: `/ask`, `/devpilot-status`
5. Install to workspace → get `SLACK_BOT_TOKEN`
6. Add both tokens to `.env`

```powershell
.venv\Scripts\activate
cd integrations
python slack_bot.py
```

**Usage:**
```
@devpilot How does the payment system work?
/ask Where is the auth middleware?
/devpilot-status
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `setup.ps1` is blocked | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| `python` not found | Install from python.org — check "Add to PATH" |
| `ModuleNotFoundError` | Activate venv: `.venv\Scripts\activate`, then reinstall deps |
| Port 8000 in use | `netstat -ano \| findstr :8000` → `taskkill /PID <pid> /F` |
| Running in mock mode | Set `OPENAI_API_KEY` in `.env` and restart |
| FAISS install fails | `pip install faiss-cpu --prefer-binary` |

---

## Hackathon Demo Script

1. Start API (`.\setup.ps1 -SkipIngest` for instant start)
2. Open `http://localhost:8000/docs` → POST `/query` → "How does auth work?"
3. Show the response: JWT explanation + file paths + confidence score
4. GET `/analytics/knowledge-gaps` → "Authentication is the #1 pain point"
5. GET `/analytics/developer/dev_alice_001` → individual progress + recommendations
6. POST `/onboarding/roadmap?developer_id=alice&role=backend` → personalized plan
7. Close: "DevPilot cuts onboarding from 3 months to 3 weeks"

---

## Impact Metrics

| Metric | Before DevPilot | With DevPilot |
|--------|----------------|---------------|
| Time to first PR | 3–4 weeks | 1–2 weeks |
| Senior eng interruptions/day | 8–12 | 2–4 |
| Documentation gaps | Unknown | Measured & prioritized |
| Onboarding progress visibility | None | Real-time dashboard |

---

*Built with ❤️ by The Avengers — Hackathon 2024*
=======
# the-avengers
>>>>>>> 2d976fd1e6c007d6e9cba6d76eab5bc5284dc3b6
#   d u m m y  
 #   d u m m y  
 