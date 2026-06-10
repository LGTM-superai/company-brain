"""Central model configuration for the Admin Duty Agent.

Model calls go through **AWS Bedrock** by default (via LiteLLM). On Bedrock we try a
**primary** model and fall back to a **fallback** model if the primary isn't available
(e.g. Claude's Marketplace subscription is still activating).

    BRAIN_MODEL_PROVIDER=bedrock   (default)
      BRAIN_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0   (primary)
      BRAIN_BEDROCK_FALLBACK_MODEL=zai.glm-4.7                          (fallback)
      AWS_REGION_NAME / AWS credentials
    BRAIN_MODEL_PROVIDER=openai
      BRAIN_AGENT_MODEL=gpt-5 / gpt-5-mini  +  OPENAI_API_KEY
"""

from __future__ import annotations

import os

from agents import ModelSettings
from dotenv import load_dotenv

load_dotenv()

MODEL_PROVIDER = os.environ.get("BRAIN_MODEL_PROVIDER", "bedrock").lower()
_BEDROCK_PRIMARY = os.environ.get("BRAIN_BEDROCK_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
_BEDROCK_FALLBACK = os.environ.get("BRAIN_BEDROCK_FALLBACK_MODEL", "zai.glm-4.7")
_OPENAI_MODEL = os.environ.get("BRAIN_AGENT_MODEL", "gpt-5-mini")
_REGION = os.environ.get("AWS_REGION_NAME") or os.environ.get("AWS_DEFAULT_REGION", "us-west-2")

DEFAULT_MODEL_SETTINGS = ModelSettings()


def _bedrock_invokable(model_id: str) -> bool:
    """Cheap probe: can we actually invoke this Bedrock model right now?"""
    try:
        import boto3
        boto3.client("bedrock-runtime", region_name=_REGION).converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": "ping"}]}],
            inferenceConfig={"maxTokens": 1},
        )
        return True
    except Exception:
        return False


def _resolve_bedrock_model() -> str:
    """Prefer the primary model; fall back if it isn't available."""
    # Skip the network probe in tests / when there's nothing to probe with.
    if os.environ.get("BRAIN_SKIP_MODEL_PROBE"):
        return _BEDROCK_PRIMARY
    if _bedrock_invokable(_BEDROCK_PRIMARY):
        return _BEDROCK_PRIMARY
    return _BEDROCK_FALLBACK


if MODEL_PROVIDER == "openai":
    DEFAULT_MODEL_NAME = _OPENAI_MODEL
    DEFAULT_MODEL = _OPENAI_MODEL  # plain string -> SDK's OpenAI provider
else:
    _resolved = _resolve_bedrock_model()
    DEFAULT_MODEL_NAME = f"bedrock/{_resolved}"
    from agents.extensions.models.litellm_model import LitellmModel

    DEFAULT_MODEL = LitellmModel(model=DEFAULT_MODEL_NAME)
