"""
DevPilot - Slack Bot Integration
Uses slack_bolt for robust event handling and interactive messages.
Run standalone: python slack_bot.py
Or mount as socket mode client alongside FastAPI.
"""
import os
import asyncio
import httpx
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from slack_sdk import WebClient

SLACK_BOT_TOKEN   = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_APP_TOKEN   = os.getenv("SLACK_APP_TOKEN", "")
DEVPILOT_API_URL  = os.getenv("DEVPILOT_API_URL", "http://localhost:8000")

app = App(token=SLACK_BOT_TOKEN)


# ─── Slack Client Helper ─────────────────────────────────────────────────────
class SlackClient:
    def __init__(self):
        self.client = WebClient(token=SLACK_BOT_TOKEN)

    async def send_answer(self, channel: str, result: dict, user: str):
        """Format and send a DevPilot answer to a Slack channel."""
        answer = result.get("answer", "I couldn't find an answer.")
        sources = result.get("sources", [])
        code_refs = result.get("code_references", [])
        confidence = result.get("confidence", 0.0)
        related = result.get("related_topics", [])

        blocks = self._build_answer_blocks(
            user=user, answer=answer, sources=sources,
            code_refs=code_refs, confidence=confidence, related=related
        )

        self.client.chat_postMessage(channel=channel, blocks=blocks, text=answer)

    def _build_answer_blocks(
        self, user, answer, sources, code_refs, confidence, related
    ):
        conf_emoji = "🟢" if confidence >= 0.85 else "🟡" if confidence >= 0.65 else "🔴"
        conf_pct = int(confidence * 100)

        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*🤖 DevPilot Answer* for <@{user}> {conf_emoji} _{conf_pct}% confidence_"
                }
            },
            {"type": "divider"},
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": answer}
            }
        ]

        if code_refs:
            ref_lines = []
            for ref in code_refs[:3]:
                func = f"`{ref.get('function_name')}`" if ref.get("function_name") else ""
                ref_lines.append(f"• `{ref['file_path']}` {func}")
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*📁 Relevant Code Files:*\n" + "\n".join(ref_lines)
                }
            })

        if sources:
            src_lines = []
            for src in sources[:3]:
                title = src.get("title", "Document")
                url = src.get("url", "")
                link = f"<{url}|{title}>" if url else f"_{title}_"
                src_lines.append(f"• {link}")
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*📚 Sources:*\n" + "\n".join(src_lines)
                }
            })

        if related:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*🔗 Related Topics:* {' • '.join(related[:4])}"
                }
            })

        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📊 View Dashboard"},
                    "url": f"{os.getenv('DASHBOARD_URL', 'http://localhost:3000')}",
                    "style": "primary"
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "👍 Helpful"},
                    "action_id": "feedback_positive",
                    "value": "positive"
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "👎 Not Helpful"},
                    "action_id": "feedback_negative",
                    "value": "negative"
                }
            ]
        })

        return blocks


# ─── Bot Mention Handler ──────────────────────────────────────────────────────
@app.event("app_mention")
def handle_mention(event, say, client):
    """Handle @devpilot mentions in any channel."""
    import re
    text = re.sub(r"<@[A-Z0-9]+>", "", event["text"]).strip()
    user = event["user"]
    channel = event["channel"]

    if not text:
        say(
            text="Hi! I'm DevPilot 🤖 Ask me anything about the codebase!",
            blocks=[{
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "Hi <@" + user + ">! I'm *DevPilot* 🤖\n\nAsk me anything about the codebase or documentation.\n\n*Examples:*\n• _How does the authentication system work?_\n• _Where is the payment service implemented?_\n• _How do I run the tests?_"
                }
            }]
        )
        return

    # Show typing indicator
    client.chat_postEphemeral(
        channel=channel, user=user,
        text="⏳ DevPilot is searching the codebase..."
    )

    try:
        response = httpx.post(
            f"{DEVPILOT_API_URL}/query",
            json={"question": text, "developer_id": user},
            timeout=30.0
        )
        result = response.json()

        slack_client = SlackClient()
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            slack_client.send_answer(channel=channel, result=result, user=user)
        )
        loop.close()
    except Exception as e:
        say(f"❌ DevPilot error: {str(e)}\nPlease try again or contact your admin.")


# ─── Direct Message Handler ───────────────────────────────────────────────────
@app.event("message")
def handle_dm(event, say, client):
    """Handle direct messages to DevPilot bot."""
    if event.get("channel_type") != "im":
        return
    if event.get("bot_id"):
        return

    text = event.get("text", "").strip()
    if not text:
        return

    user = event["user"]
    channel = event["channel"]

    try:
        response = httpx.post(
            f"{DEVPILOT_API_URL}/query",
            json={"question": text, "developer_id": user},
            timeout=30.0
        )
        result = response.json()

        slack_client = SlackClient()
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            slack_client.send_answer(channel=channel, result=result, user=user)
        )
        loop.close()
    except Exception as e:
        say(f"❌ Error: {str(e)}")


# ─── Slash Commands ───────────────────────────────────────────────────────────
@app.command("/ask")
def slash_ask(ack, command, say, client):
    """
    /ask <question> — Ask DevPilot a question via slash command
    """
    ack()
    text = command.get("text", "").strip()
    user = command["user_id"]
    channel = command["channel_id"]

    if not text:
        say("Usage: `/ask How does the auth system work?`")
        return

    try:
        response = httpx.post(
            f"{DEVPILOT_API_URL}/query",
            json={"question": text, "developer_id": user},
            timeout=30.0
        )
        result = response.json()
        slack_client = SlackClient()
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            slack_client.send_answer(channel=channel, result=result, user=user)
        )
        loop.close()
    except Exception as e:
        say(f"❌ Error: {str(e)}")


@app.command("/devpilot-status")
def slash_status(ack, command, say):
    """
    /devpilot-status — Show DevPilot system status and your onboarding progress
    """
    ack()
    user = command["user_id"]

    try:
        status_resp = httpx.get(f"{DEVPILOT_API_URL}/health", timeout=10.0)
        status = status_resp.json()
        onboard_resp = httpx.get(f"{DEVPILOT_API_URL}/onboarding/status/{user}", timeout=10.0)
        onboard = onboard_resp.json() if onboard_resp.status_code == 200 else {}

        progress = onboard.get("progress_percentage", 0)
        progress_bar = ("█" * int(progress // 10)).ljust(10, "░")

        say(blocks=[
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*DevPilot Status* ✅ `{status['status']}`\n"
                        f"Documents indexed: *{status.get('docs_indexed', 0)}*\n\n"
                        f"*Your Onboarding Progress:*\n"
                        f"`{progress_bar}` {progress:.0f}%\n"
                        f"Days active: *{onboard.get('days_active', 0)}*\n"
                        f"Queries this week: *{onboard.get('queries_this_week', 0)}*"
                    )
                }
            }
        ])
    except Exception as e:
        say(f"❌ Status check failed: {str(e)}")


# ─── Feedback Actions ─────────────────────────────────────────────────────────
@app.action("feedback_positive")
def feedback_positive(ack, body, client):
    ack()
    client.chat_postEphemeral(
        channel=body["channel"]["id"],
        user=body["user"]["id"],
        text="✅ Thanks for the feedback! This helps DevPilot improve."
    )


@app.action("feedback_negative")
def feedback_negative(ack, body, client):
    ack()
    client.chat_postEphemeral(
        channel=body["channel"]["id"],
        user=body["user"]["id"],
        text="🔁 Sorry about that! We've logged this for improvement. Try rephrasing your question."
    )


# ─── Entry Point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not SLACK_BOT_TOKEN or not SLACK_APP_TOKEN:
        print("❌ Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN environment variables.")
        exit(1)
    print("🚀 Starting DevPilot Slack Bot (Socket Mode)...")
    handler = SocketModeHandler(app, SLACK_APP_TOKEN)
    handler.start()
