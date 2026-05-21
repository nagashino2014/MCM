"""Optional LLM reviewer for ambiguous KSIC matches."""
from __future__ import annotations

import functools
import json
import os
from typing import Any, Dict, Optional

import httpx

from .integrated_permit_industries import TARGET_INDUSTRIES
from .ksic_lookup import get_canonical_by_code


def _enabled() -> bool:
    return os.environ.get("IEPS_KSIC_LLM_ENABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _candidate_payload() -> list[dict[str, Any]]:
    return [
        {
            "label": item["label"],
            "aliases": item.get("aliases") or [],
            "exactCodes": item.get("exactCodes") or [],
            "prefixCodes": item.get("prefixCodes") or [],
        }
        for item in TARGET_INDUSTRIES
    ]


def _allowed_codes() -> tuple[set[str], set[str]]:
    exact: set[str] = set()
    prefix: set[str] = set()
    for item in TARGET_INDUSTRIES:
        exact.update(item.get("exactCodes") or [])
        prefix.update(item.get("prefixCodes") or [])
    return exact, prefix


@functools.lru_cache(maxsize=2048)
def review_ksic_with_llm(raw_industry: str, products_key: str = "") -> Optional[Dict[str, Any]]:
    """Ask the LLM to select one candidate only when deterministic matching fails."""
    if not _enabled():
        return None
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    raw_industry = (raw_industry or "").strip()
    if not raw_industry:
        return None

    model = os.environ.get("IEPS_KSIC_LLM_MODEL", "gpt-5.5-medium")
    max_candidates = int(os.environ.get("IEPS_KSIC_LLM_MAX_CANDIDATES", "40"))
    candidates = _candidate_payload()[:max_candidates]
    exact_codes, prefix_codes = _allowed_codes()

    system = (
        "You classify Korean integrated environmental permit industry text into one of the "
        "provided KSIC candidates. Return strict JSON only. Do not invent codes."
    )
    user = {
        "rawIndustry": raw_industry,
        "products": products_key,
        "candidates": candidates,
        "schema": {
            "matched_code": "5 digit KSIC code from exactCodes, or null",
            "matched_prefix": "3 or 4 digit KSIC prefix from prefixCodes, or null",
            "matched_name": "candidate label or canonical KSIC name",
            "confidence": "number from 0 to 1",
            "reason": "short Korean reason",
            "needs_human_review": "boolean",
        },
    }

    try:
        response = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                ],
                "response_format": {"type": "json_object"},
            },
            timeout=20.0,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except Exception:
        return None

    confidence = float(parsed.get("confidence") or 0.0)
    if confidence < 0.75 or parsed.get("needs_human_review"):
        return None

    matched_code = str(parsed.get("matched_code") or "").strip() or None
    matched_prefix = str(parsed.get("matched_prefix") or "").strip() or None
    if matched_code and matched_code not in exact_codes:
        return None
    if matched_prefix and matched_prefix not in prefix_codes:
        return None
    if not matched_code and not matched_prefix:
        return None

    return {
        "code": matched_code,
        "prefixCode": matched_prefix if not matched_code else None,
        "name": get_canonical_by_code(matched_code) if matched_code else parsed.get("matched_name"),
        "products": [],
        "matchSource": "llm_ksic_review",
        "llmConfidence": confidence,
        "llmReason": parsed.get("reason"),
    }
