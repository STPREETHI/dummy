"""
DevPilot - Pydantic Data Models
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ─── Request Models ──────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str = Field(..., description="Developer's natural language question")
    developer_id: str = Field(default="anonymous", description="Unique developer identifier")
    context_filter: Optional[str] = Field(
        None, description="Filter results by context: 'auth', 'payment', 'api', etc."
    )

    class Config:
        json_schema_extra = {
            "example": {
                "question": "How does the authentication system work?",
                "developer_id": "dev_alice_001",
                "context_filter": "auth"
            }
        }


class IngestRequest(BaseModel):
    sources: List[str] = Field(..., description="List of file paths, URLs, or GitHub repos")
    source_type: str = Field(
        default="documentation",
        description="Type: 'documentation', 'github', 'confluence', 'notion', 'wiki'"
    )
    project_id: str = Field(default="default", description="Project namespace for isolation")

    class Config:
        json_schema_extra = {
            "example": {
                "sources": ["https://github.com/org/repo", "./docs/", "./README.md"],
                "source_type": "github",
                "project_id": "my-project"
            }
        }


# ─── Response Models ─────────────────────────────────────────────────────────

class CodeReference(BaseModel):
    file_path: str
    function_name: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    snippet: Optional[str] = None
    relevance_score: float = 0.0


class DocumentSource(BaseModel):
    title: str
    url: Optional[str] = None
    excerpt: str
    source_type: str = "documentation"
    relevance_score: float = 0.0


class QueryResponse(BaseModel):
    query_id: str
    question: str
    answer: str
    sources: List[DocumentSource] = []
    code_references: List[CodeReference] = []
    related_topics: List[str] = []
    confidence: float = Field(ge=0.0, le=1.0)
    timestamp: str

    class Config:
        json_schema_extra = {
            "example": {
                "query_id": "abc-123",
                "question": "How does the authentication system work?",
                "answer": "The authentication system uses JWT tokens...",
                "sources": [],
                "code_references": [],
                "related_topics": ["JWT", "middleware", "session management"],
                "confidence": 0.92,
                "timestamp": "2024-01-01T12:00:00"
            }
        }


class IngestResponse(BaseModel):
    job_id: str
    status: str
    message: str
    documents_processed: int = 0
    timestamp: str


class TopicStat(BaseModel):
    topic: str
    query_count: int
    unique_developers: int
    avg_confidence: float
    gap_severity: str = Field(description="low | medium | high")


class DeveloperActivity(BaseModel):
    developer_id: str
    name: Optional[str] = None
    queries_total: int
    queries_this_week: int
    days_active: int
    top_topics: List[str]
    onboarding_progress: float


class AnalyticsResponse(BaseModel):
    period_days: int
    total_queries: int
    unique_developers: int
    avg_queries_per_developer: float
    top_knowledge_gaps: List[TopicStat]
    most_active_developers: List[DeveloperActivity]
    unanswered_rate: float
    avg_confidence: float
    queries_by_day: List[Dict[str, Any]]


class DeveloperStats(BaseModel):
    developer_id: str
    total_queries: int
    queries_this_week: int
    days_active: int
    unique_topics: List[str]
    knowledge_gaps: List[str]
    recommended_topics: List[str]
    onboarding_progress: float
    strongest_areas: List[str]
    weakest_areas: List[str]
    timeline: List[Dict[str, Any]]


class OnboardingStatus(BaseModel):
    developer_id: str
    progress_percentage: float
    days_active: int
    topics_explored: List[str]
    recommended_next: List[str]
    queries_this_week: int


class RoadmapItem(BaseModel):
    week: int
    title: str
    description: str
    resources: List[str]
    estimated_hours: int
    topics: List[str]


class OnboardingRoadmap(BaseModel):
    developer_id: str
    role: str
    experience_level: str
    total_weeks: int
    items: List[RoadmapItem]
    generated_at: str
