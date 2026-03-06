"""
DevPilot - AI-Powered Developer Onboarding Assistant
FastAPI Backend - Main Application
"""
import os
import uuid
import re
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from rag_pipeline import RAGPipeline
from knowledge_gap import KnowledgeGapAnalyzer
from models import (
    QueryRequest, QueryResponse, IngestRequest, IngestResponse,
    AnalyticsResponse, DeveloperStats, OnboardingStatus
)

app = FastAPI(
    title="DevPilot API",
    description="AI-Powered Intelligent Developer Onboarding Assistant",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

rag = RAGPipeline()
analyzer = KnowledgeGapAnalyzer()


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "DevPilot",
        "timestamp": datetime.utcnow().isoformat(),
        "rag_ready": rag.is_ready(),
        "docs_indexed": rag.get_doc_count()
    }


@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest, background_tasks: BackgroundTasks):
    """Core query: developer asks question, gets contextual AI answer with sources."""
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        result = await rag.query(
            question=request.question,
            developer_id=request.developer_id,
            context_filter=request.context_filter
        )
        background_tasks.add_task(
            analyzer.log_query,
            developer_id=request.developer_id,
            question=request.question,
            topics=result.get("topics", []),
            confidence=result.get("confidence", 0.0),
            answered=result.get("answered", True)
        )
        return QueryResponse(
            query_id=str(uuid.uuid4()),
            question=request.question,
            answer=result["answer"],
            sources=result.get("sources", []),
            code_references=result.get("code_references", []),
            related_topics=result.get("related_topics", []),
            confidence=result.get("confidence", 0.85),
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@app.post("/ingest", response_model=IngestResponse)
async def ingest_documents(request: IngestRequest, background_tasks: BackgroundTasks):
    """Ingest documents, READMEs, wikis, or GitHub repos into the vector store."""
    try:
        job_id = str(uuid.uuid4())
        background_tasks.add_task(
            rag.ingest_documents,
            sources=request.sources,
            source_type=request.source_type,
            project_id=request.project_id,
            job_id=job_id
        )
        return IngestResponse(
            job_id=job_id,
            status="processing",
            message=f"Ingestion started for {len(request.sources)} source(s)",
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


@app.get("/analytics/overview", response_model=AnalyticsResponse)
async def analytics_overview(days: int = 30):
    data = analyzer.get_overview(days=days)
    return AnalyticsResponse(**data)


@app.get("/analytics/developer/{developer_id}", response_model=DeveloperStats)
async def developer_stats(developer_id: str, days: int = 30):
    stats = analyzer.get_developer_stats(developer_id=developer_id, days=days)
    if not stats:
        raise HTTPException(status_code=404, detail="Developer not found")
    return DeveloperStats(**stats)


@app.get("/analytics/hot-topics")
async def hot_topics(limit: int = 10):
    return analyzer.get_hot_topics(limit=limit)


@app.get("/analytics/knowledge-gaps")
async def knowledge_gaps():
    return analyzer.get_knowledge_gaps()


@app.post("/onboarding/roadmap")
async def generate_roadmap(developer_id: str, role: str = "backend", experience: str = "mid"):
    roadmap = await rag.generate_onboarding_roadmap(
        developer_id=developer_id, role=role, experience_level=experience
    )
    return roadmap


@app.get("/onboarding/status/{developer_id}", response_model=OnboardingStatus)
async def onboarding_status(developer_id: str):
    stats = analyzer.get_developer_stats(developer_id, days=90) or {}
    progress = analyzer.calculate_onboarding_progress(developer_id)
    return OnboardingStatus(
        developer_id=developer_id,
        progress_percentage=progress,
        days_active=stats.get("days_active", 0),
        topics_explored=stats.get("unique_topics", []),
        recommended_next=stats.get("recommended_topics", []),
        queries_this_week=stats.get("queries_this_week", 0)
    )


@app.get("/search")
async def semantic_search(q: str, limit: int = 5, source_type: Optional[str] = None):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    results = await rag.semantic_search(query=q, limit=limit, source_type=source_type)
    return {"query": q, "results": results, "count": len(results)}


@app.post("/slack/events")
async def slack_events(payload: dict, background_tasks: BackgroundTasks):
    """Slack Events API handler."""
    if payload.get("type") == "url_verification":
        return {"challenge": payload["challenge"]}
    if payload.get("type") == "event_callback":
        event = payload.get("event", {})
        if event.get("type") in ("app_mention", "message"):
            background_tasks.add_task(handle_slack_message, event)
    return {"ok": True}


async def handle_slack_message(event: dict):
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'integrations'))
    from slack_client import SlackClient
    client = SlackClient()
    text = event.get("text", "").strip()
    user = event.get("user", "unknown")
    channel = event.get("channel")
    clean_text = re.sub(r"<@[A-Z0-9]+>", "", text).strip()
    if not clean_text:
        return
    result = await rag.query(question=clean_text, developer_id=user)
    await client.send_answer(channel=channel, result=result, user=user)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
