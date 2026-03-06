"""
DevPilot - Data Ingestion Pipeline
Standalone script to index documents, GitHub repos, and wikis into FAISS vector store.

Usage:
  python ingest.py --source ./docs/              # Local directory
  python ingest.py --source https://github.com/org/repo --type github
  python ingest.py --source ./README.md          # Single file
  python ingest.py --demo                        # Generate demo data
"""
import os
import sys
import json
import argparse
import hashlib
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime

from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.text_splitter import RecursiveCharacterTextSplitter, Language
from langchain.schema import Document
from langchain_community.document_loaders import (
    TextLoader, DirectoryLoader, GitLoader,
    UnstructuredMarkdownLoader, UnstructuredURLLoader
)

GROK_API_KEY = os.getenv("GROK_API_KEY", "")
VECTOR_STORE_PATH = os.getenv("VECTOR_STORE_PATH", "./vector_store")

# File extensions to ingest per type
CODE_EXTENSIONS   = {".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs", ".rb", ".cpp", ".cs"}
DOC_EXTENSIONS    = {".md", ".txt", ".rst", ".html", ".mdx"}
CONFIG_EXTENSIONS = {".yaml", ".yml", ".json", ".toml", ".env.example"}


# ─── Splitters ────────────────────────────────────────────────────────────────
def get_splitter(source_type: str) -> RecursiveCharacterTextSplitter:
    if source_type == "code":
        return RecursiveCharacterTextSplitter.from_language(
            language=Language.PYTHON, chunk_size=800, chunk_overlap=100
        )
    return RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)


# ─── Loaders ─────────────────────────────────────────────────────────────────
def load_local_directory(path: str) -> List[Document]:
    """Load all supported files from a local directory."""
    docs = []
    base = Path(path)
    all_exts = CODE_EXTENSIONS | DOC_EXTENSIONS | CONFIG_EXTENSIONS
    glob_patterns = [f"**/*{ext}" for ext in all_exts]

    for pattern in glob_patterns:
        for fp in base.glob(pattern):
            if any(p in str(fp) for p in ["node_modules", ".git", "__pycache__", ".venv"]):
                continue
            try:
                loader = TextLoader(str(fp), encoding="utf-8")
                file_docs = loader.load()
                for doc in file_docs:
                    ext = fp.suffix.lower()
                    doc.metadata["source_type"] = "code" if ext in CODE_EXTENSIONS else "documentation"
                    doc.metadata["file_type"] = ext
                    doc.metadata["title"] = fp.name
                docs.extend(file_docs)
            except Exception as e:
                print(f"  ⚠  Skipping {fp}: {e}")

    return docs


def load_github_repo(repo_url: str, branch: str = "main") -> List[Document]:
    """Clone and load a GitHub repository."""
    repo_name = repo_url.rstrip("/").split("/")[-1]
    clone_path = f"/tmp/devpilot_repos/{repo_name}"

    print(f"  📥 Cloning {repo_url} → {clone_path}")
    try:
        loader = GitLoader(
            clone_url=repo_url,
            repo_path=clone_path,
            branch=branch,
            file_filter=lambda x: (
                any(x.endswith(ext) for ext in CODE_EXTENSIONS | DOC_EXTENSIONS)
                and not any(p in x for p in ["node_modules", "__pycache__", ".git", "dist", "build"])
            )
        )
        docs = loader.load()
        for doc in docs:
            ext = Path(doc.metadata.get("source", "")).suffix.lower()
            doc.metadata["source_type"] = "code" if ext in CODE_EXTENSIONS else "documentation"
            doc.metadata["repo"] = repo_url
        return docs
    except Exception as e:
        print(f"  ❌ GitHub load failed: {e}")
        return []


def load_urls(urls: List[str]) -> List[Document]:
    """Load and parse web pages."""
    try:
        loader = UnstructuredURLLoader(urls=urls)
        docs = loader.load()
        for doc in docs:
            doc.metadata["source_type"] = "documentation"
        return docs
    except Exception as e:
        print(f"  ❌ URL load failed: {e}")
        return []


# ─── Demo Data Generator ──────────────────────────────────────────────────────
def generate_demo_data() -> List[Document]:
    """Generate realistic demo documents for hackathon showcase."""
    demo_docs = [
        {
            "content": """# Authentication System

## Overview
The DevPilot authentication system uses stateless JWT (JSON Web Tokens) for all API endpoints.
Tokens are issued on successful login and expire after 24 hours.

## Implementation
- Entry point: `/services/auth/jwt_handler.py`
- Middleware: `/middleware/auth_middleware.py`
- User model: `/models/user.py`

## Token Generation
```python
def generate_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=24),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")
```

## Refresh Tokens
Refresh tokens (30-day expiry) are stored in Redis and allow silent token refresh.
See `/services/auth/refresh.py` for the refresh flow.

## Protected Routes
All routes under `/api/v1/` require a valid Bearer token.
Public routes: `/api/auth/login`, `/api/auth/register`, `/health`
""",
            "metadata": {"source": "/docs/auth.md", "source_type": "documentation",
                         "title": "Authentication System", "url": "/docs/auth.md"}
        },
        {
            "content": """# Payment Processing

## Overview
Payments are handled via Stripe. The payment service supports one-time payments,
subscriptions, and refunds.

## Architecture
```
User → /api/v1/payments/intent → PaymentService → Stripe API
                                        ↓
                               Stripe Webhook → /api/webhooks/stripe
                                        ↓
                               PaymentRecord saved to DB
```

## Key Files
- Service: `/services/payment/processor.py`
- Stripe client: `/services/payment/stripe_client.py`
- Webhook handler: `/api/webhooks/stripe.py`
- DB queries: `/db/payment_queries.py`

## Creating a Payment
```python
from services.payment.processor import PaymentProcessor

processor = PaymentProcessor()
intent = await processor.create_intent(
    amount=2999,  # in cents
    currency="usd",
    user_id=user.id,
    metadata={"order_id": order.id}
)
```

## Webhook Events Handled
- `payment_intent.succeeded` → mark order as paid
- `payment_intent.failed` → notify user, log failure
- `customer.subscription.deleted` → downgrade plan
""",
            "metadata": {"source": "/docs/payments.md", "source_type": "documentation",
                         "title": "Payment Processing", "url": "/docs/payments.md"}
        },
        {
            "content": """# Database Architecture

## Stack
- PostgreSQL 15 (primary)
- Redis 7 (cache + sessions)
- SQLAlchemy ORM with Alembic migrations

## Connection
Database connection is managed via SQLAlchemy async engine in `/db/connection.py`.

## Running Migrations
```bash
# Apply all pending migrations
alembic upgrade head

# Create a new migration
alembic revision --autogenerate -m "Add user_preferences table"

# Rollback one step
alembic downgrade -1
```

## Key Models
- `/models/user.py` — User, Profile, Settings
- `/models/payment.py` — Payment, Subscription, Invoice
- `/models/product.py` — Product, Category, Inventory

## Query Patterns
All raw queries live in `/db/` prefixed by domain (e.g. `auth_queries.py`, `payment_queries.py`).
Use async sessions: `async with get_db() as db:`
""",
            "metadata": {"source": "/docs/database.md", "source_type": "documentation",
                         "title": "Database Architecture", "url": "/docs/database.md"}
        },
        {
            "content": """# Deployment & Infrastructure

## Stack
- Docker + Docker Compose (local/dev)
- Kubernetes (GKE) for production
- GitHub Actions CI/CD pipeline

## Local Development
```bash
# Start all services
docker-compose up -d

# Services started:
# - app:8000 (FastAPI backend)
# - postgres:5432
# - redis:6379
# - nginx:80
```

## CI/CD Pipeline
`.github/workflows/deploy.yml`:
1. Run tests (pytest + coverage)
2. Build Docker image
3. Push to Google Container Registry
4. Deploy to GKE via kubectl

## Environment Variables
Copy `.env.example` to `.env` and fill in values.
Secret management via HashiCorp Vault in production.

## Health Checks
- API: `GET /health`
- Database: `GET /health/db`
- Redis: `GET /health/cache`
""",
            "metadata": {"source": "/docs/deployment.md", "source_type": "documentation",
                         "title": "Deployment Guide", "url": "/docs/deployment.md"}
        },
        {
            "content": """# API Structure & Conventions

## Base URL
All API endpoints are prefixed: `/api/v1/`

## Authentication
Include JWT in Authorization header:
```
Authorization: Bearer <token>
```

## Response Format
All responses follow this structure:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "...", "version": "1.0" }
}
```
Errors:
```json
{
  "success": false,
  "error": { "code": "AUTH_REQUIRED", "message": "..." }
}
```

## Rate Limiting
- Authenticated users: 1000 req/hour
- Unauthenticated: 100 req/hour
- Payment endpoints: 50 req/hour

## Versioning
Breaking changes get a new version prefix (v2, v3).
Old versions are supported for 6 months after deprecation notice.
""",
            "metadata": {"source": "/docs/api.md", "source_type": "documentation",
                         "title": "API Conventions", "url": "/docs/api.md"}
        },
        {
            "content": """# Testing Guide

## Testing Stack
- pytest + pytest-asyncio
- Factory Boy for fixtures
- httpx for async API tests

## Running Tests
```bash
# All tests
pytest

# With coverage
pytest --cov=app --cov-report=html

# Single test file
pytest tests/test_auth.py -v

# Only unit tests (fast)
pytest tests/unit/ -v
```

## Test Structure
```
tests/
  unit/          — fast, isolated, no DB
  integration/   — uses test DB + Redis
  e2e/           — full stack, Playwright
  fixtures/      — shared factories
  conftest.py    — pytest config
```

## Writing a Test
```python
@pytest.mark.asyncio
async def test_create_user(client, db):
    resp = await client.post("/api/v1/users/", json={
        "email": "test@example.com",
        "password": "SecurePass123!"
    })
    assert resp.status_code == 201
    assert resp.json()["data"]["email"] == "test@example.com"
```
""",
            "metadata": {"source": "/docs/testing.md", "source_type": "documentation",
                         "title": "Testing Guide", "url": "/docs/testing.md"}
        },
    ]

    documents = []
    for item in demo_docs:
        doc = Document(page_content=item["content"], metadata=item["metadata"])
        documents.append(doc)

    return documents


# ─── Main Ingestion Function ──────────────────────────────────────────────────
def ingest(
    source: str,
    source_type: str = "auto",
    project_id: str = "default",
    demo_mode: bool = False
) -> int:
    print(f"\n🚀 DevPilot Data Ingestion Pipeline")
    print(f"   Source     : {source if not demo_mode else 'Demo Data'}")
    print(f"   Project    : {project_id}")
    print(f"   Vector DB  : {VECTOR_STORE_PATH}\n")

    # No API key needed - using free local HuggingFace embeddings
    pass

    # Load documents
    if demo_mode:
        print("📄 Generating demo documents...")
        raw_docs = generate_demo_data()
    elif source.startswith("https://github.com"):
        print(f"📥 Loading GitHub repo: {source}")
        raw_docs = load_github_repo(source)
    elif source.startswith("http"):
        print(f"🌐 Loading URL: {source}")
        raw_docs = load_urls([source])
    elif Path(source).is_dir():
        print(f"📁 Loading directory: {source}")
        raw_docs = load_local_directory(source)
    elif Path(source).is_file():
        print(f"📄 Loading file: {source}")
        loader = TextLoader(source, encoding="utf-8")
        raw_docs = loader.load()
    else:
        print(f"❌ Invalid source: {source}")
        sys.exit(1)

    print(f"✅ Loaded {len(raw_docs)} raw documents")

    # Split documents
    print("✂️  Splitting into chunks...")
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.split_documents(raw_docs)
    for chunk in chunks:
        chunk.metadata["project_id"] = project_id
        chunk.metadata.setdefault("ingested_at", datetime.utcnow().isoformat())

    print(f"✅ Created {len(chunks)} chunks")

    # Create embeddings
    print("🧠 Generating embeddings (this may take a moment)...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2", model_kwargs={"device": "cpu"})

    # Build or update FAISS index
    store_path = Path(VECTOR_STORE_PATH)
    if (store_path / "index.faiss").exists():
        print(f"📦 Loading existing vector store from {VECTOR_STORE_PATH}")
        vectorstore = FAISS.load_local(
            VECTOR_STORE_PATH, embeddings, allow_dangerous_deserialization=True
        )
        vectorstore.add_documents(chunks)
        print(f"➕ Added {len(chunks)} chunks to existing store")
    else:
        print("🆕 Creating new vector store...")
        vectorstore = FAISS.from_documents(chunks, embeddings)

    store_path.mkdir(parents=True, exist_ok=True)
    vectorstore.save_local(VECTOR_STORE_PATH)
    total = vectorstore.index.ntotal

    print(f"\n✅ Ingestion complete!")
    print(f"   Total vectors in store: {total}")
    print(f"   Saved to: {VECTOR_STORE_PATH}")

    return len(chunks)


# ─── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DevPilot Data Ingestion Pipeline")
    parser.add_argument("--source",   type=str, help="Path, URL, or GitHub repo to ingest")
    parser.add_argument("--type",     type=str, default="auto", help="documentation|code|github")
    parser.add_argument("--project",  type=str, default="default", help="Project namespace")
    parser.add_argument("--demo",     action="store_true", help="Load demo data for testing")

    args = parser.parse_args()

    if not args.source and not args.demo:
        parser.print_help()
        sys.exit(1)

    ingest(
        source=args.source or "demo",
        source_type=args.type,
        project_id=args.project,
        demo_mode=args.demo
    )