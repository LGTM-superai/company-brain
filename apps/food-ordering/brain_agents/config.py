"""Central model configuration for the Admin Duty Agent.

Model calls go through **AWS Bedrock** by default (via LiteLLM). Switch providers
with the `BRAIN_MODEL_PROVIDER` env var; all settings come from the environment /
`.env`, so nothing secret lives in source.

    BRAIN_MODEL_PROVIDER=bedrock   (default)
      BRAIN_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
      AWS_REGION_NAME / AWS credentials (profile, env, or instance role)
    BRAIN_MODEL_PROVIDER=openai
      BRAIN_AGENT_MODEL=gpt-5-mini  +  OPENAI_API_KEY
"""

from __future__ import annotations

import os

from agents import ModelSettings
from dotenv import load_dotenv

# Load .env as early as possible so the env reads below see it.
load_dotenv()

MODEL_PROVIDER = os.environ.get("BRAIN_MODEL_PROVIDER", "bedrock").lower()
_BEDROCK_MODEL = os.environ.get("BRAIN_BEDROCK_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
_OPENAI_MODEL = os.environ.get("BRAIN_AGENT_MODEL", "gpt-5-mini")

# Kept empty: reasoning models reject some sampling params. Add per-agent overrides
# where you need them.
DEFAULT_MODEL_SETTINGS = ModelSettings()


def _build_model():
    """Return the value to pass to `Agent(model=...)` for the active provider."""
    if MODEL_PROVIDER == "openai":
        return _OPENAI_MODEL  # a plain string -> SDK's default OpenAI provider
    # Default: AWS Bedrock through LiteLLM.
    from agents.extensions.models.litellm_model import LitellmModel

    return LitellmModel(model=f"bedrock/{_BEDROCK_MODEL}")


# Human-readable name for display/logging (the model object isn't print-friendly).
DEFAULT_MODEL_NAME = _OPENAI_MODEL if MODEL_PROVIDER == "openai" else f"bedrock/{_BEDROCK_MODEL}"

# The actual model handed to every agent.
DEFAULT_MODEL = _build_model()
