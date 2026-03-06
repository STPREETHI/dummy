"""
DevPilot - RAG Pipeline
LangChain + FAISS + OpenAI GPT-4 powered Retrieval-Augmented Generation
"""
import os
import json
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path

import httpx
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document
from langchain_community.document_loaders import (
    TextLoader, DirectoryLoader, GitLoader,
    UnstructuredMarkdownLoader, UnstructuredURLLoader
)

GROK_API_KEY = os.getenv("GROK_API_KEY", "")
VECTOR_STORE_PATH = os.getenv("VECTOR_STORE_PATH", "./vector_store")
INGESTION_STATUS: Dict[str, Dict] = {}


# ─── System Prompt ────────────────────────────────────────────────────────────
DEVPILOT_SYSTEM_PROMPT = """You are DevPilot, an expert AI engineering mentor for software developer onboarding.
You help new developers understand complex codebases, architecture, and workflows.

When answering questions:
1. Be specific and reference actual code files, functions, or documentation when available
2. Explain "why" not just "what" — provide context about design decisions
3. Point developers to the right files and modules in the codebase
4. Suggest next steps for deeper understanding
5. If you're uncertain, say so and suggest who to ask

Context from the codebase and documentation:
{context}

Developer Question: {question}

Provide a clear, actionable answer. Include:
- Direct answer to the question
- Relevant file paths and function names
- Any important caveats or gotchas
- Suggested next steps to learn more

Answer:"""


ROADMAP_PROMPT = """You are DevPilot generating a personalized developer onboarding roadmap.

Developer Profile:
- Role: {role}
- Experience Level: {experience_level}
- Available documentation topics: {available_topics}
- Detected knowledge gaps: {knowledge_gaps}

Generate a detailed {total_weeks}-week onboarding roadmap in JSON format:
{{
  "items": [
    {{
      "week": 1,
      "title": "Week title",
      "description": "What to focus on",
      "resources": ["resource 1", "resource 2"],
      "estimated_hours": 10,
      "topics": ["topic1", "topic2"]
    }}
  ]
}}

Return ONLY valid JSON, no other text."""


# ─── RAG Pipeline Class ───────────────────────────────────────────────────────
class RAGPipeline:
    def __init__(self):
        self.embeddings = None
        self.vectorstore = None
        self.llm = None
        self.qa_chain = None
        self._doc_count = 0
        self._ready = False
        self._init()

    def _init(self):
        if not GROK_API_KEY:
            print("[DevPilot] Warning: GROK_API_KEY not set. Running in mock mode.")
            return
        try:
            # Use free local embeddings (no API key needed)
            self.embeddings = HuggingFaceEmbeddings(
                model_name="all-MiniLM-L6-v2",
                model_kwargs={"device": "cpu"}
            )
            # Load existing vector store if available
            if Path(f"{VECTOR_STORE_PATH}/index.faiss").exists():
                self.vectorstore = FAISS.load_local(
                    VECTOR_STORE_PATH, self.embeddings, allow_dangerous_deserialization=True
                )
                self._doc_count = self.vectorstore.index.ntotal
                self._ready = True
                print(f"[DevPilot] Loaded vector store with {self._doc_count} documents")
            else:
                print("[DevPilot] No vector store found. Run /ingest to index documents.")
        except Exception as e:
            print(f"[DevPilot] Init error: {e}")

    def is_ready(self) -> bool:
        return self._ready or not GROK_API_KEY  # mock mode always ready

    def get_doc_count(self) -> int:
        return self._doc_count

    def _build_qa_chain(self):
        pass  # Grok is called directly via HTTP

    # ─── Query ───────────────────────────────────────────────────────────────
    async def query(
        self,
        question: str,
        developer_id: str = "anonymous",
        context_filter: Optional[str] = None
    ) -> Dict[str, Any]:
        # If no API key or no vectorstore, return mock response
        if not GROK_API_KEY or not self.vectorstore:
            return self._mock_response(question)

        try:
            # Get relevant docs from vector store
            source_docs = []
            if self.vectorstore:
                loop = asyncio.get_event_loop()
                docs_with_scores = await loop.run_in_executor(
                    None, lambda: self.vectorstore.similarity_search_with_score(question, k=5)
                )
                source_docs = [doc for doc, score in docs_with_scores]

            # Build context from retrieved docs
            context = "\n\n".join([d.page_content[:600] for d in source_docs]) or "No documents indexed yet."

            # Call Grok API directly
            prompt = DEVPILOT_SYSTEM_PROMPT.format(context=context, question=question)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
                    json={"model": "grok-3", "messages": [{"role": "user", "content": prompt}], "max_tokens": 1000, "temperature": 0.2}
                )
                resp.raise_for_status()
                answer = resp.json()["choices"][0]["message"]["content"]

            sources = []
            code_refs = []

            for doc in source_docs:
                meta = doc.metadata
                source_type = meta.get("source_type", "documentation")
                if source_type == "code":
                    code_refs.append({
                        "file_path": meta.get("source", "unknown"),
                        "function_name": meta.get("function_name"),
                        "snippet": doc.page_content[:300],
                        "relevance_score": meta.get("score", 0.8)
                    })
                else:
                    sources.append({
                        "title": meta.get("title", Path(meta.get("source", "doc")).stem),
                        "url": meta.get("url"),
                        "excerpt": doc.page_content[:200],
                        "source_type": source_type,
                        "relevance_score": meta.get("score", 0.8)
                    })

            topics = self._extract_topics(question, answer)

            return {
                "answer": answer,
                "sources": sources,
                "code_references": code_refs,
                "related_topics": topics,
                "confidence": 0.88 if source_docs else 0.5,
                "answered": True,
                "topics": topics
            }
        except Exception as e:
            return {
                "answer": f"I encountered an error processing your question: {str(e)}",
                "sources": [], "code_references": [],
                "related_topics": [], "confidence": 0.0,
                "answered": False, "topics": []
            }

    # ─── Semantic Search ─────────────────────────────────────────────────────
    async def semantic_search(
        self,
        query: str,
        limit: int = 5,
        source_type: Optional[str] = None
    ) -> List[Dict]:
        if not self.vectorstore:
            return self._mock_search_results(query)
        loop = asyncio.get_event_loop()
        docs = await loop.run_in_executor(
            None,
            lambda: self.vectorstore.similarity_search_with_score(query, k=limit)
        )
        results = []
        for doc, score in docs:
            if source_type and doc.metadata.get("source_type") != source_type:
                continue
            results.append({
                "content": doc.page_content[:500],
                "metadata": doc.metadata,
                "relevance_score": float(1 - score)
            })
        return results

    # ─── Ingestion ───────────────────────────────────────────────────────────
    async def ingest_documents(
        self,
        sources: List[str],
        source_type: str = "documentation",
        project_id: str = "default",
        job_id: str = "unknown"
    ):
        INGESTION_STATUS[job_id] = {"status": "processing", "progress": 0, "total": len(sources)}

        all_docs = []
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

        for i, source in enumerate(sources):
            try:
                docs = []
                if source.startswith("https://github.com"):
                    docs = self._load_github(source)
                elif source.startswith("http"):
                    loader = UnstructuredURLLoader(urls=[source])
                    docs = loader.load()
                elif Path(source).is_dir():
                    loader = DirectoryLoader(
                        source,
                        glob="**/*.{md,txt,py,js,ts,java,go,rs}",
                        loader_cls=TextLoader,
                        silent_errors=True
                    )
                    docs = loader.load()
                elif Path(source).is_file():
                    loader = TextLoader(source, encoding="utf-8")
                    docs = loader.load()

                # Tag metadata
                for doc in docs:
                    doc.metadata["source_type"] = source_type
                    doc.metadata["project_id"] = project_id
                    if source.endswith((".py", ".js", ".ts", ".java", ".go", ".rs")):
                        doc.metadata["source_type"] = "code"

                chunks = splitter.split_documents(docs)
                all_docs.extend(chunks)
                INGESTION_STATUS[job_id]["progress"] = int((i + 1) / len(sources) * 100)

            except Exception as e:
                print(f"[DevPilot] Error loading {source}: {e}")

        if all_docs and self.embeddings:
            if self.vectorstore:
                self.vectorstore.add_documents(all_docs)
            else:
                self.vectorstore = FAISS.from_documents(all_docs, self.embeddings)
                self._build_qa_chain()
                self._ready = True

            Path(VECTOR_STORE_PATH).mkdir(parents=True, exist_ok=True)
            self.vectorstore.save_local(VECTOR_STORE_PATH)
            self._doc_count = self.vectorstore.index.ntotal

        INGESTION_STATUS[job_id] = {
            "status": "completed",
            "progress": 100,
            "documents_processed": len(all_docs),
            "total": len(sources)
        }
        print(f"[DevPilot] Ingested {len(all_docs)} chunks from {len(sources)} sources")

    def _load_github(self, repo_url: str) -> List[Document]:
        """Load documents from a GitHub repository."""
        try:
            repo_path = f"/tmp/{repo_url.split('/')[-1]}"
            loader = GitLoader(
                clone_url=repo_url,
                repo_path=repo_path,
                file_filter=lambda x: x.endswith((".md", ".py", ".js", ".ts", ".txt", ".rst"))
            )
            return loader.load()
        except Exception as e:
            print(f"[DevPilot] GitHub load error for {repo_url}: {e}")
            return []

    def get_ingestion_status(self, job_id: str) -> Dict:
        return INGESTION_STATUS.get(job_id, {"status": "not_found"})

    # ─── Roadmap Generation ───────────────────────────────────────────────────
    async def generate_onboarding_roadmap(
        self,
        developer_id: str,
        role: str = "backend",
        experience_level: str = "mid"
    ) -> Dict:
        from knowledge_gap import KnowledgeGapAnalyzer
        analyzer = KnowledgeGapAnalyzer()
        gaps = analyzer.get_knowledge_gaps()
        gap_topics = [g["topic"] for g in gaps.get("gaps", [])]
        available_topics = self._get_available_topics()

        total_weeks = 4 if experience_level == "senior" else 6 if experience_level == "mid" else 8

        if not GROK_API_KEY:
            return self._mock_roadmap(developer_id, role, experience_level, total_weeks)

        prompt = ROADMAP_PROMPT.format(
            role=role,
            experience_level=experience_level,
            available_topics=", ".join(available_topics[:20]),
            knowledge_gaps=", ".join(gap_topics[:10]),
            total_weeks=total_weeks
        )

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
                json={"model": "grok-3", "messages": [{"role": "user", "content": prompt}], "max_tokens": 2000, "temperature": 0.3}
            )
            resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            import re
            m = re.search(r'\{.*\}', raw, re.DOTALL)
            data = json.loads(m.group()) if m else {"items": []}

        return {
            "developer_id": developer_id,
            "role": role,
            "experience_level": experience_level,
            "total_weeks": total_weeks,
            "items": data.get("items", []),
            "generated_at": __import__("datetime").datetime.utcnow().isoformat()
        }

    def _get_available_topics(self) -> List[str]:
        if not self.vectorstore:
            return ["authentication", "database", "API", "deployment", "testing"]
        return ["authentication", "payments", "notifications", "database", "API", "caching", "deployment"]

    # ─── Topic Extraction ────────────────────────────────────────────────────
    def _extract_topics(self, question: str, answer: str) -> List[str]:
        keywords = [
            "authentication", "authorization", "jwt", "oauth", "session",
            "database", "sql", "orm", "migration", "query",
            "api", "rest", "graphql", "endpoint", "middleware",
            "payment", "billing", "subscription", "stripe",
            "deployment", "docker", "kubernetes", "ci/cd", "pipeline",
            "caching", "redis", "memcache", "performance",
            "testing", "unit test", "integration", "mocking",
            "notification", "email", "webhook", "event",
            "security", "encryption", "hashing", "ssl",
            "logging", "monitoring", "error handling", "debugging"
        ]
        combined = (question + " " + answer).lower()
        return [kw for kw in keywords if kw in combined][:5]

    # ─── Mock Responses (no API key mode) ────────────────────────────────────
    def _mock_response(self, question: str) -> Dict:
        q = question.lower()
        if "auth" in q:
            answer = (
                "The authentication system uses JWT (JSON Web Tokens) for stateless auth. "
                "Entry point is `/services/auth/jwt_handler.py` → `generate_token()`. "
                "Tokens expire in 24h; refresh logic is in `auth/refresh.py`. "
                "Middleware applied in `middleware/auth_middleware.py` protects all `/api/v1/` routes. "
                "Related: `models/user.py` for the User schema, `db/auth_queries.py` for DB lookups."
            )
            sources = [{
                "title": "Authentication Architecture",
                "url": "/docs/auth.md",
                "excerpt": "JWT-based stateless authentication with 24-hour expiry...",
                "source_type": "documentation",
                "relevance_score": 0.95
            }]
            code_refs = [{
                "file_path": "/services/auth/jwt_handler.py",
                "function_name": "generate_token",
                "snippet": "def generate_token(user_id: str, expires_delta=None):\n    payload = {\"sub\": user_id, ...}",
                "relevance_score": 0.92
            }]
            topics = ["authentication", "jwt", "middleware", "security"]
        elif "payment" in q:
            answer = (
                "Payment processing lives in `/services/payment/processor.py`. "
                "It uses Stripe under the hood — `StripeClient` is initialized in `payment/client.py`. "
                "Flow: `create_intent()` → `confirm_payment()` → webhook in `api/webhooks/stripe.py`. "
                "All transactions are logged to the `payments` table via `db/payment_queries.py`."
            )
            sources = [{"title": "Payment Service Docs", "url": "/docs/payments.md",
                        "excerpt": "Stripe-based payment processing with webhook support...",
                        "source_type": "documentation", "relevance_score": 0.93}]
            code_refs = [{"file_path": "/services/payment/processor.py",
                          "function_name": "process_payment",
                          "snippet": "async def process_payment(amount, currency, user_id):\n    intent = stripe.PaymentIntent.create(...)",
                          "relevance_score": 0.9}]
            topics = ["payment", "stripe", "webhook", "billing"]
        else:
            answer = (
                f"I found relevant information about '{question}'. "
                "This topic is covered in the main documentation. "
                "Key files to explore: `/services/`, `/models/`, `/api/`. "
                "Check the README.md for a high-level overview. "
                "(Demo mode: connect OpenAI API key for full RAG-powered answers.)"
            )
            sources = [{"title": "Project README", "url": "/README.md",
                        "excerpt": "High-level project overview and getting started guide...",
                        "source_type": "documentation", "relevance_score": 0.75}]
            code_refs = []
            topics = ["architecture", "documentation"]

        return {
            "answer": answer, "sources": sources,
            "code_references": code_refs, "related_topics": topics,
            "confidence": 0.88, "answered": True, "topics": topics
        }

    def _mock_search_results(self, query: str) -> List[Dict]:
        return [
            {"content": f"Documentation about {query}...", "metadata": {"source": "README.md"}, "relevance_score": 0.85},
            {"content": f"Code implementation for {query}...", "metadata": {"source": "/services/core.py"}, "relevance_score": 0.78}
        ]

    def _mock_roadmap(self, developer_id, role, experience_level, total_weeks) -> Dict:
        items = []
        topics_by_week = [
            ("Project Overview & Local Setup", ["setup", "tooling", "git workflow"], 10),
            ("Core Architecture & Data Models", ["database", "ORM", "schema"], 12),
            ("API Design & Authentication", ["REST", "JWT", "middleware"], 14),
            ("Business Logic & Services", ["services", "domain logic", "patterns"], 12),
            ("Testing & Quality Assurance", ["unit tests", "integration", "CI/CD"], 10),
            ("Deployment & Monitoring", ["docker", "k8s", "observability"], 8),
        ]
        for i in range(min(total_weeks, len(topics_by_week))):
            title, topics, hours = topics_by_week[i]
            items.append({
                "week": i + 1, "title": title,
                "description": f"Focus on understanding {', '.join(topics)} in the context of this project.",
                "resources": [f"docs/{t.replace(' ', '_')}.md" for t in topics],
                "estimated_hours": hours, "topics": topics
            })
        return {
            "developer_id": developer_id, "role": role,
            "experience_level": experience_level, "total_weeks": total_weeks,
            "items": items, "generated_at": __import__("datetime").datetime.utcnow().isoformat()
        }