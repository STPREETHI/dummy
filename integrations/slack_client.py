"""
DevPilot - Slack Client (importable from backend)
"""
import os
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

SLACK_BOT_TOKEN  = os.getenv("SLACK_BOT_TOKEN", "")
DASHBOARD_URL    = os.getenv("DASHBOARD_URL", "http://localhost:3000")


class SlackClient:
    def __init__(self):
        self.client = WebClient(token=SLACK_BOT_TOKEN) if SLACK_BOT_TOKEN else None

    async def send_answer(self, channel: str, result: dict, user: str):
        if not self.client:
            print(f"[DevPilot] Mock Slack → {channel}: {result.get('answer', '')[:80]}")
            return

        answer  = result.get("answer", "No answer found.")
        sources = result.get("sources", [])
        code_refs = result.get("code_references", [])
        confidence = result.get("confidence", 0.0)
        related = result.get("related_topics", [])

        conf_emoji = "🟢" if confidence >= 0.85 else "🟡" if confidence >= 0.65 else "🔴"

        blocks = [
            {
                "type": "section",
                "text": {"type": "mrkdwn",
                         "text": f"*🤖 DevPilot* {conf_emoji} _{int(confidence*100)}% confidence_"}
            },
            {"type": "divider"},
            {"type": "section", "text": {"type": "mrkdwn", "text": answer}}
        ]

        if code_refs:
            lines = [f"• `{r['file_path']}`" + (f" → `{r['function_name']}`" if r.get("function_name") else "")
                     for r in code_refs[:3]]
            blocks.append({"type": "section",
                            "text": {"type": "mrkdwn", "text": "📁 *Code:*\n" + "\n".join(lines)}})

        if sources:
            lines = [f"• <{s.get('url', '#')}|{s.get('title', 'Doc')}>" for s in sources[:3]]
            blocks.append({"type": "section",
                            "text": {"type": "mrkdwn", "text": "📚 *Sources:*\n" + "\n".join(lines)}})

        if related:
            blocks.append({"type": "section",
                            "text": {"type": "mrkdwn",
                                     "text": f"🔗 *Related:* {' • '.join(related[:4])}"}})

        try:
            self.client.chat_postMessage(channel=channel, blocks=blocks, text=answer)
        except SlackApiError as e:
            print(f"[DevPilot] Slack send error: {e}")
