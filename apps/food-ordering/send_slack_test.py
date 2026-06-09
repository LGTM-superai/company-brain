"""Send a test message to the Slack #general channel.

Requires SLACK_BOT_TOKEN (xoxb-...) in .env, the app installed to the workspace with
the `chat:write` scope, and the bot a member of the target channel.

    python send_slack_test.py [channel]   # default channel: general
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

load_dotenv()

from brain_agents.context import SlackService

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else "general"
MESSAGE = "✅ Test message from the Company Brain admin agent."


def main() -> None:
    result = SlackService().post(CHANNEL, MESSAGE)
    print(result)
    if result.startswith("(no SLACK_BOT_TOKEN)"):
        print("\nAdd SLACK_BOT_TOKEN=xoxb-... to .env (Slack app → OAuth & Permissions →"
              " Bot User OAuth Token), then re-run.")


if __name__ == "__main__":
    main()
