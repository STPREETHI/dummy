"""
DevPilot - Knowledge Gap Analyzer
Tracks developer queries, identifies knowledge gaps, provides analytics insights.
Uses SQLite for persistence (swap for Postgres in production).
"""
import os
import json
import sqlite3
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import Counter, defaultdict

DB_PATH = os.getenv("DB_PATH", "./devpilot.db")


class KnowledgeGapAnalyzer:
    def __init__(self):
        self.db_path = DB_PATH
        self._init_db()

    def _init_db(self):
        """Initialize SQLite database schema."""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = self._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS queries (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                query_id     TEXT UNIQUE,
                developer_id TEXT NOT NULL,
                question     TEXT NOT NULL,
                topics       TEXT,           -- JSON array
                confidence   REAL DEFAULT 0,
                answered     INTEGER DEFAULT 1,
                created_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS developers (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                developer_id TEXT UNIQUE NOT NULL,
                name         TEXT,
                role         TEXT DEFAULT 'engineer',
                team         TEXT,
                joined_at    TEXT NOT NULL,
                last_seen    TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_queries_dev ON queries(developer_id);
            CREATE INDEX IF NOT EXISTS idx_queries_date ON queries(created_at);
            CREATE INDEX IF NOT EXISTS idx_queries_topics ON queries(topics);
        """)
        conn.commit()
        conn.close()
        self._seed_demo_data()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _seed_demo_data(self):
        """Seed realistic demo data for dashboard showcase."""
        conn = self._conn()
        count = conn.execute("SELECT COUNT(*) FROM queries").fetchone()[0]
        if count > 0:
            conn.close()
            return

        developers = [
            ("dev_alice_001", "Alice Chen",     "backend",  "Platform"),
            ("dev_bob_002",   "Bob Martinez",   "frontend", "Consumer"),
            ("dev_carol_003", "Carol Kim",      "fullstack","Platform"),
            ("dev_dave_004",  "Dave Thompson",  "backend",  "Infra"),
            ("dev_eve_005",   "Eve Patel",      "frontend", "Consumer"),
        ]

        now = datetime.utcnow()
        for dev_id, name, role, team in developers:
            try:
                conn.execute(
                    "INSERT INTO developers (developer_id, name, role, team, joined_at, last_seen) VALUES (?,?,?,?,?,?)",
                    (dev_id, name, role, team, (now - timedelta(days=45)).isoformat(), now.isoformat())
                )
            except sqlite3.IntegrityError:
                pass

        topic_pool = [
            (["authentication", "jwt", "security"],    "How does authentication work?"),
            (["database", "orm", "migration"],         "How do I run database migrations?"),
            (["payment", "stripe", "billing"],         "Where is the payment integration?"),
            (["deployment", "docker", "kubernetes"],   "How is the app deployed?"),
            (["testing", "unit test", "mocking"],      "How do I write unit tests here?"),
            (["api", "rest", "endpoint"],              "How are API endpoints structured?"),
            (["caching", "redis", "performance"],      "How is caching implemented?"),
            (["logging", "monitoring", "debugging"],   "How do I debug production issues?"),
            (["authorization", "rbac", "permissions"], "How does role-based access work?"),
            (["notification", "email", "webhook"],     "How are notifications sent?"),
        ]

        import random
        random.seed(42)
        rows = []
        for dev_id, _, _, _ in developers:
            for day_offset in range(45):
                date = now - timedelta(days=day_offset)
                n_queries = random.randint(0, 5)
                for _ in range(n_queries):
                    topics, q = random.choice(topic_pool)
                    rows.append((
                        hashlib.md5(f"{dev_id}{day_offset}{q}{len(rows)}".encode()).hexdigest(),
                        dev_id, q, json.dumps(topics),
                        round(random.uniform(0.6, 0.98), 2),
                        1 if random.random() > 0.12 else 0,
                        date.isoformat()
                    ))

        conn.executemany(
            "INSERT OR IGNORE INTO queries (query_id, developer_id, question, topics, confidence, answered, created_at) VALUES (?,?,?,?,?,?,?)",
            rows
        )
        conn.commit()
        conn.close()

    # ─── Logging ─────────────────────────────────────────────────────────────
    def log_query(
        self,
        developer_id: str,
        question: str,
        topics: List[str],
        confidence: float,
        answered: bool
    ):
        import uuid
        conn = self._conn()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO queries (query_id, developer_id, question, topics, confidence, answered, created_at) VALUES (?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()), developer_id, question,
                    json.dumps(topics), confidence,
                    1 if answered else 0,
                    datetime.utcnow().isoformat()
                )
            )
            conn.execute(
                """INSERT INTO developers (developer_id, joined_at, last_seen)
                   VALUES (?, ?, ?)
                   ON CONFLICT(developer_id) DO UPDATE SET last_seen=excluded.last_seen""",
                (developer_id, datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
            )
            conn.commit()
        finally:
            conn.close()

    # ─── Overview Analytics ───────────────────────────────────────────────────
    def get_overview(self, days: int = 30) -> Dict[str, Any]:
        conn = self._conn()
        since = (datetime.utcnow() - timedelta(days=days)).isoformat()

        rows = conn.execute(
            "SELECT developer_id, topics, confidence, answered, created_at FROM queries WHERE created_at >= ?",
            (since,)
        ).fetchall()

        total_queries = len(rows)
        unique_devs = len(set(r["developer_id"] for r in rows))
        unanswered = sum(1 for r in rows if not r["answered"])
        confidences = [r["confidence"] for r in rows if r["confidence"]]

        # Topic frequency
        topic_counter: Counter = Counter()
        topic_dev_map: Dict[str, set] = defaultdict(set)
        topic_conf_map: Dict[str, list] = defaultdict(list)

        for row in rows:
            topics = json.loads(row["topics"] or "[]")
            for t in topics:
                topic_counter[t] += 1
                topic_dev_map[t].add(row["developer_id"])
                topic_conf_map[t].append(row["confidence"])

        top_gaps = []
        for topic, count in topic_counter.most_common(8):
            avg_conf = sum(topic_conf_map[topic]) / len(topic_conf_map[topic])
            gap_severity = "high" if avg_conf < 0.7 else "medium" if avg_conf < 0.85 else "low"
            top_gaps.append({
                "topic": topic, "query_count": count,
                "unique_developers": len(topic_dev_map[topic]),
                "avg_confidence": round(avg_conf, 2),
                "gap_severity": gap_severity
            })

        # Developer activity
        dev_counts = Counter(r["developer_id"] for r in rows)
        dev_week_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
        dev_week = Counter(
            r["developer_id"] for r in rows if r["created_at"] >= dev_week_cutoff
        )

        most_active = []
        for dev_id, count in dev_counts.most_common(5):
            dev_topics = []
            for row in rows:
                if row["developer_id"] == dev_id:
                    dev_topics.extend(json.loads(row["topics"] or "[]"))
            top_topics = [t for t, _ in Counter(dev_topics).most_common(3)]
            most_active.append({
                "developer_id": dev_id,
                "queries_total": count,
                "queries_this_week": dev_week.get(dev_id, 0),
                "days_active": min(days, count // 2 + 1),
                "top_topics": top_topics,
                "onboarding_progress": min(100.0, count * 2.5)
            })

        # Queries by day (last 14 days)
        day_map = Counter()
        for row in rows:
            day = row["created_at"][:10]
            day_map[day] += 1
        queries_by_day = [
            {"date": (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d"),
             "queries": day_map.get((datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d"), 0)}
            for i in range(13, -1, -1)
        ]

        conn.close()
        return {
            "period_days": days,
            "total_queries": total_queries,
            "unique_developers": unique_devs,
            "avg_queries_per_developer": round(total_queries / max(unique_devs, 1), 1),
            "top_knowledge_gaps": top_gaps,
            "most_active_developers": most_active,
            "unanswered_rate": round(unanswered / max(total_queries, 1), 3),
            "avg_confidence": round(sum(confidences) / max(len(confidences), 1), 2),
            "queries_by_day": queries_by_day
        }

    # ─── Developer Stats ──────────────────────────────────────────────────────
    def get_developer_stats(self, developer_id: str, days: int = 30) -> Optional[Dict]:
        conn = self._conn()
        since = (datetime.utcnow() - timedelta(days=days)).isoformat()

        rows = conn.execute(
            "SELECT topics, confidence, answered, created_at FROM queries WHERE developer_id=? AND created_at>=?",
            (developer_id, since)
        ).fetchall()

        if not rows:
            conn.close()
            return None

        all_topics: List[str] = []
        for row in rows:
            all_topics.extend(json.loads(row["topics"] or "[]"))

        topic_counts = Counter(all_topics)
        unique_topics = list(topic_counts.keys())

        week_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
        queries_this_week = sum(1 for r in rows if r["created_at"] >= week_cutoff)

        dates = sorted(set(r["created_at"][:10] for r in rows))
        days_active = len(dates)

        # Knowledge gaps: low confidence topics
        topic_conf: Dict[str, list] = defaultdict(list)
        for row in rows:
            for t in json.loads(row["topics"] or "[]"):
                topic_conf[t].append(row["confidence"])

        gaps = [t for t, confs in topic_conf.items()
                if sum(confs) / len(confs) < 0.75 or topic_counts[t] >= 3]

        strongest = [t for t, confs in topic_conf.items()
                     if sum(confs) / len(confs) >= 0.9]

        # Recommend topics not yet explored
        all_system_topics = [
            "authentication", "authorization", "database", "api", "testing",
            "deployment", "caching", "monitoring", "payment", "notification"
        ]
        recommended = [t for t in all_system_topics if t not in unique_topics][:3]

        timeline = [
            {"date": d, "queries": sum(1 for r in rows if r["created_at"][:10] == d)}
            for d in dates[-14:]
        ]

        conn.close()
        return {
            "developer_id": developer_id,
            "total_queries": len(rows),
            "queries_this_week": queries_this_week,
            "days_active": days_active,
            "unique_topics": unique_topics,
            "knowledge_gaps": gaps[:5],
            "recommended_topics": recommended,
            "onboarding_progress": min(100.0, len(unique_topics) * 10.0),
            "strongest_areas": strongest[:3],
            "weakest_areas": gaps[:3],
            "timeline": timeline
        }

    # ─── Hot Topics ───────────────────────────────────────────────────────────
    def get_hot_topics(self, limit: int = 10) -> Dict:
        conn = self._conn()
        week_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
        rows = conn.execute(
            "SELECT topics, confidence FROM queries WHERE created_at >= ?",
            (week_cutoff,)
        ).fetchall()
        conn.close()

        topic_data: Dict[str, Dict] = defaultdict(lambda: {"count": 0, "confidences": []})
        for row in rows:
            for t in json.loads(row["topics"] or "[]"):
                topic_data[t]["count"] += 1
                topic_data[t]["confidences"].append(row["confidence"])

        result = []
        for topic, data in sorted(topic_data.items(), key=lambda x: x[1]["count"], reverse=True)[:limit]:
            avg_conf = sum(data["confidences"]) / len(data["confidences"])
            result.append({
                "topic": topic, "query_count": data["count"],
                "avg_confidence": round(avg_conf, 2),
                "trend": "rising" if data["count"] > 5 else "stable"
            })
        return {"period": "7 days", "topics": result}

    # ─── Knowledge Gaps ───────────────────────────────────────────────────────
    def get_knowledge_gaps(self) -> Dict:
        conn = self._conn()
        month_cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
        rows = conn.execute(
            "SELECT topics, confidence, answered FROM queries WHERE created_at >= ?",
            (month_cutoff,)
        ).fetchall()
        conn.close()

        topic_data: Dict[str, Dict] = defaultdict(
            lambda: {"count": 0, "confidences": [], "unanswered": 0}
        )
        for row in rows:
            for t in json.loads(row["topics"] or "[]"):
                topic_data[t]["count"] += 1
                topic_data[t]["confidences"].append(row["confidence"])
                if not row["answered"]:
                    topic_data[t]["unanswered"] += 1

        gaps = []
        for topic, data in topic_data.items():
            avg_conf = sum(data["confidences"]) / len(data["confidences"])
            unanswered_rate = data["unanswered"] / data["count"]
            severity_score = (1 - avg_conf) * 0.6 + unanswered_rate * 0.4
            if severity_score > 0.15 or data["count"] >= 5:
                gaps.append({
                    "topic": topic,
                    "query_count": data["count"],
                    "avg_confidence": round(avg_conf, 2),
                    "unanswered_rate": round(unanswered_rate, 2),
                    "severity": "high" if severity_score > 0.35 else "medium" if severity_score > 0.2 else "low",
                    "recommendation": f"Add documentation for '{topic}' — {data['count']} queries in 30 days"
                })

        gaps.sort(key=lambda x: x["query_count"], reverse=True)
        return {"gaps": gaps, "total_gaps_detected": len(gaps)}

    # ─── Onboarding Progress ─────────────────────────────────────────────────
    def calculate_onboarding_progress(self, developer_id: str) -> float:
        stats = self.get_developer_stats(developer_id, days=90)
        if not stats:
            return 0.0
        explored = len(stats.get("unique_topics", []))
        days_active = stats.get("days_active", 0)
        queries = stats.get("total_queries", 0)
        score = min(100.0, (explored * 8) + (min(days_active, 30) * 1.5) + (min(queries, 50) * 0.3))
        return round(score, 1)
