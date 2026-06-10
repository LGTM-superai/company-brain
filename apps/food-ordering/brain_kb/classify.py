"""AI document classification — derive title/summary/domain/doc_types/tags/sensitivity
from a document's text, using a Bedrock model.

Used on upload so files are auto-tagged and auto-tiered.
"""

from __future__ import annotations

import json
import os

import boto3

CLASSIFY_MODEL = os.environ.get("BRAIN_CLASSIFY_MODEL", "openai.gpt-oss-120b-1:0")
REGION = os.environ.get("AWS_REGION_NAME") or os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
SENSITIVITIES = ("public", "internal", "confidential", "restricted")

_PROMPT = """You are a document classifier for a company knowledge base.
Read the document and return ONLY a JSON object (no prose, no markdown fences) with keys:
- "title": short descriptive title
- "summary": one or two sentence summary
- "domain": one of engineering, product, people, business, company, operations, security
- "doc_types": array of 1-3 labels from: api-documentation, meeting-minutes, requirements,
  non-functional-requirements, timeline, policy, runbook, personnel, finance, budget,
  contract, report, onboarding, incident, overview
- "tags": array of 3-6 lowercase topic tags
- "sensitivity": one of public, internal, confidential, restricted
  (restricted = personnel/PII/compensation; confidential = finance/legal/strategy;
   internal = most company docs; public = marketing/overview)

Document:
\"\"\"
{text}
\"\"\"
Return only the JSON object."""


def _extract_json(s: str) -> dict:
    i, j = s.find("{"), s.rfind("}")
    if 0 <= i < j:
        try:
            return json.loads(s[i:j + 1])
        except json.JSONDecodeError:
            pass
    return {}


def classify(text: str, filename: str | None = None) -> dict:
    rt = boto3.client("bedrock-runtime", region_name=REGION)
    r = rt.converse(
        modelId=CLASSIFY_MODEL,
        messages=[{"role": "user", "content": [{"text": _PROMPT.format(text=text[:6000])}]}],
        inferenceConfig={"maxTokens": 600, "temperature": 0},
    )
    blocks = r["output"]["message"]["content"]
    raw = " ".join(b["text"] for b in blocks if "text" in b)
    d = _extract_json(raw)

    sens = str(d.get("sensitivity", "internal")).lower()
    if sens not in SENSITIVITIES:
        sens = "internal"
    return {
        "title": d.get("title") or (filename or "Untitled"),
        "summary": d.get("summary", ""),
        "domain": str(d.get("domain") or "general").lower(),
        "doc_types": d.get("doc_types") or [],
        "tags": d.get("tags") or [],
        "sensitivity": sens,
    }
