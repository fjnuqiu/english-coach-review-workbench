#!/usr/bin/env python3
"""Course metadata and review-card grouping for English Coach."""

from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COURSES = ROOT / "state" / "courses.json"

RESULT_MASTERY_WEIGHTS = {
    "pending": (0.0, 0.0, 0.0),
    "fail": (5.0, 5.0, 10.0),
    "shaky": (25.0, 10.0, 15.0),
    "pass": (55.0, 25.0, 20.0),
}
MAX_REVIEW_INTERVAL_DAYS = 30.0


def load_courses(path: Path = DEFAULT_COURSES) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError("courses state must be a JSON array")
    return payload


def save_courses(courses: list[dict[str, Any]], path: Path = DEFAULT_COURSES) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(courses, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _card_sort_key(course: dict[str, Any], item: dict[str, Any]) -> tuple[int, str]:
    order = {card_id: index for index, card_id in enumerate(course.get("card_ids", []))}
    return (order.get(item.get("id", ""), len(order)), str(item.get("id", "")))


def _effective_result(item: dict[str, Any]) -> str:
    result = str(item.get("last_result") or "").strip().lower()
    if result in RESULT_MASTERY_WEIGHTS:
        return result
    return {
        "new": "pending",
        "needs_review": "shaky",
        "reviewing": "pass",
    }.get(str(item.get("status") or "").strip().lower(), "pending")


def _interval_ratio(item: dict[str, Any]) -> float:
    try:
        interval_days = float(item.get("interval_days") or 0)
    except (TypeError, ValueError):
        interval_days = 0.0
    return min(max(interval_days, 0.0), MAX_REVIEW_INTERVAL_DAYS) / MAX_REVIEW_INTERVAL_DAYS


def _history_pass_ratio(item: dict[str, Any]) -> float:
    results = [
        str(entry.get("result") or "").strip().lower()
        for entry in item.get("history", [])
        if isinstance(entry, dict)
        and str(entry.get("result") or "").strip().lower() in {"pass", "shaky", "fail"}
    ]
    if not results:
        return 0.0
    return results.count("pass") / len(results)


def card_mastery_score(item: dict[str, Any]) -> float:
    """Return a stable 0-100 score while keeping the latest result dominant.

    The base score separates pending, failed, shaky, and passed cards. The
    current review interval and historical pass ratio then add confidence
    within that result band, so a recently passed card does not score like a
    repeatedly passed card at the 30-day interval.
    """

    result = _effective_result(item)
    base, interval_weight, history_weight = RESULT_MASTERY_WEIGHTS[result]
    score = (
        base
        + (_interval_ratio(item) * interval_weight)
        + (_history_pass_ratio(item) * history_weight)
    )
    return round(min(max(score, 0.0), 100.0), 1)


def mastery_label(score: float, has_cards: bool = True) -> str:
    if not has_cards:
        return "未开始"
    if score < 20:
        return "很不熟悉"
    if score < 45:
        return "不熟悉"
    if score < 70:
        return "学习中"
    if score < 90:
        return "较熟悉"
    return "已掌握"


def group_cards_by_course(
    items: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    on_date: dt.date,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {course["id"]: [] for course in courses}
    for item in items:
        course_id = str(item.get("course_id") or "")
        if course_id in grouped:
            grouped[course_id].append(item)

    date_text = on_date.isoformat()
    aggregates: list[dict[str, Any]] = []
    for course in courses:
        cards = sorted(grouped[course["id"]], key=lambda item: _card_sort_key(course, item))
        active_cards = [item for item in cards if item.get("status") != "retired"]
        due_cards = [
            item
            for item in active_cards
            if str(item.get("next_due") or "9999-12-31") <= date_text
        ]
        completed_today = sum(
            1
            for item in cards
            if any(entry.get("date") == date_text for entry in item.get("history", []))
        )
        mastered_count = sum(
            1
            for item in active_cards
            if item.get("last_result") == "pass"
        )
        mastery_score = round(
            sum(card_mastery_score(item) for item in active_cards) / len(active_cards),
            1,
        ) if active_cards else 0.0
        aggregate = copy.deepcopy(course)
        aggregate.update(
            {
                "cards": cards,
                "due_cards": due_cards,
                "due_count": len(due_cards),
                "completed_today": completed_today,
                "total_count": len(cards),
                "mastered_count": mastered_count,
                "mastery_score": mastery_score,
                "mastery_label": mastery_label(mastery_score, bool(active_cards)),
            }
        )
        aggregates.append(aggregate)
    return aggregates
