#!/usr/bin/env python3
"""Small helper for the English coach review loop."""

from __future__ import annotations

import argparse
from collections import Counter
import copy
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = ROOT / "state" / "review-items.json"
DEFAULT_CHECKINS = ROOT / "state" / "checkins.jsonl"
DEFAULT_DAILY_PLAN = ROOT / "state" / "daily-plan.json"
DEFAULT_ROADMAP = ROOT / "state" / "roadmap.json"
DEFAULT_MOBILE_REMINDERS = ROOT / "state" / "mobile-reminders.json"
DEFAULT_NOTES_DIR = ROOT / "notes"
DEFAULT_SLOT_TEMPLATES = ROOT / "state" / "slot-templates.json"
DEFAULT_PROFILE = ROOT / "state" / "profile.json"
INTERVAL_STEPS = [1, 2, 4, 7, 14, 30]


def parse_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def parse_time(value: str) -> dt.time:
    hour, minute = value.split(":", 1)
    return dt.time(int(hour), int(minute))


def today() -> dt.date:
    return dt.date.today()


def load_items(path: Path = DEFAULT_STATE) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_daily_plan(path: Path = DEFAULT_DAILY_PLAN) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_roadmap(path: Path = DEFAULT_ROADMAP) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_mobile_reminders(path: Path = DEFAULT_MOBILE_REMINDERS) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_slot_templates(path: Path = DEFAULT_SLOT_TEMPLATES) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_profile(path: Path = DEFAULT_PROFILE) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_checkins(path: Path = DEFAULT_CHECKINS) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def save_items(items: list[dict[str, Any]], path: Path = DEFAULT_STATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(items, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def due_items(items: list[dict[str, Any]], on_date: dt.date) -> list[dict[str, Any]]:
    due = [
        item
        for item in items
        if parse_date(item["next_due"]) <= on_date and item.get("status") != "retired"
    ]
    return sorted(due, key=lambda item: (item["next_due"], item["id"]))


def milestone_for_date(roadmap: dict[str, Any], on_date: dt.date) -> dict[str, Any]:
    for milestone in roadmap.get("milestones", []):
        start = parse_date(milestone["start"])
        end = parse_date(milestone["end"])
        if start <= on_date <= end:
            return milestone
    return {}


def render_status(items: list[dict[str, Any]], roadmap: dict[str, Any], on_date: dt.date) -> str:
    milestone = milestone_for_date(roadmap, on_date)
    due_count = len(due_items(items, on_date))
    lines = [
        f"# {on_date.isoformat()} 学习状态",
        "",
        f"- 年底目标：{roadmap.get('target', '未设置')}",
        f"- 到期复习：{due_count} 项",
    ]
    if milestone:
        focus = milestone.get("focus", [])
        lines.extend(
            [
                f"- 当前阶段：{milestone.get('name', milestone.get('id', ''))}",
                f"- 阶段时间：{milestone.get('start')} 至 {milestone.get('end')}",
                f"- 本阶段重点：{', '.join(focus)}",
                f"- 阶段检查：{milestone.get('checkpoint', '')}",
            ]
        )
    else:
        lines.append("- 当前阶段：未匹配到路线，请检查 roadmap.json。")
    return "\n".join(lines)


def render_profile(profile: dict[str, Any]) -> str:
    lines = [
        "# 个性化信息",
        "",
        f"- 年底目标：{profile.get('goal', '待补充')}",
    ]
    schedule = profile.get("schedule", {})
    if schedule:
        labels = {
            "morning": "早地铁",
            "noon": "午间",
            "evening": "晚地铁",
            "night": "夜练",
        }
        lines.extend(["", "## 固定提醒"])
        for key, label in labels.items():
            if schedule.get(key):
                lines.append(f"- {label}：{schedule[key]}")

    known_constraints = profile.get("known_constraints", [])
    lines.extend(["", "## 已知约束"])
    if known_constraints:
        for item in known_constraints:
            lines.append(f"- {item}")
    else:
        lines.append("- 暂无；可以补充通勤、工作、课程和发音练习限制。")

    questions = profile.get("questions", [])
    lines.extend(["", "## 待补充问题"])
    if questions:
        for question in questions:
            lines.append(f"- {question}")
    else:
        lines.append("- 当前没有待补充问题。")
    return "\n".join(lines)


def recent_checkins(
    checkins: list[dict[str, Any]], on_date: dt.date, days: int
) -> list[dict[str, Any]]:
    start = on_date - dt.timedelta(days=days - 1)
    return [
        checkin
        for checkin in checkins
        if start <= parse_date(checkin.get("date", "0001-01-01")) <= on_date
    ]


def render_report(
    items: list[dict[str, Any]],
    checkins: list[dict[str, Any]],
    on_date: dt.date,
    days: int = 7,
) -> str:
    recent = recent_checkins(checkins, on_date, days)
    weak_counter: Counter[str] = Counter()
    completed_count = 0
    for checkin in recent:
        completed_count += len(checkin.get("completed", []))
        weak_counter.update(checkin.get("failed", []))
        weak_counter.update(checkin.get("shaky", []))
        weak_counter.update(checkin.get("blocked", []))

    due = due_items(items, on_date)
    lines = [
        f"# 最近 {days} 天学习报告",
        "",
        f"- 截止日期：{on_date.isoformat()}",
        f"- 打卡次数：{len(recent)}",
        f"- 完成记录：{completed_count} 项",
        f"- 到期复习：{len(due)} 项",
        "",
        "## 高频薄弱项",
    ]
    if weak_counter:
        for item, count in weak_counter.most_common(8):
            lines.append(f"- {item} x{count}")
    else:
        lines.append("- 暂无记录；继续按每日任务打卡。")

    lines.extend(["", "## 到期复习"])
    if due:
        for item in due[:8]:
            lines.append(f"- [{item['id']}] {item['item']} ({item['last_result']})")
    else:
        lines.append("- 暂无到期复习。")

    lines.extend(["", "## 下一步"])
    if weak_counter:
        top_items = ", ".join(item for item, _count in weak_counter.most_common(3))
        lines.append(f"- 下一次优先复习：{top_items}")
    else:
        lines.append("- 下一次按 `task` 命令继续推进当前时段任务。")
    return "\n".join(lines)


def render_quiz(items: list[dict[str, Any]], on_date: dt.date, limit: int = 8) -> str:
    due = due_items(items, on_date)[:limit]
    lines = [
        f"# {on_date.isoformat()} 复习考察",
        "",
        "做法：先遮住英文回忆，再看例句确认；最后标记会 / 不熟 / 不会。",
        "",
    ]
    if not due:
        lines.append("- 暂无到期复习。")
    else:
        for index, item in enumerate(due, start=1):
            lines.extend(
                [
                    f"## {index}. [{item['id']}]",
                    "",
                    f"- 考察项：{item['item']}",
                    f"- 例句：{item.get('example') or '用一个客户沟通场景造句。'}",
                    "- 自测：能否不看答案说出/写出这个表达，并替换到自己的工作场景？",
                    "",
                ]
            )
    lines.extend(
        [
            "## 回传格式",
            "",
            "```text",
            "时间段：",
            "来源：",
            "完成：复习考察",
            "文件总结：",
            "不熟：",
            "不会：",
            "```",
        ]
    )
    return "\n".join(lines).rstrip()


def next_interval_days(current: int, result: str) -> int:
    if result in {"fail", "shaky"}:
        return 1
    if result != "pass":
        raise ValueError("result must be one of: pass, shaky, fail")
    for step in INTERVAL_STEPS:
        if current < step:
            return step
    return INTERVAL_STEPS[-1]


def record_result(item: dict[str, Any], result: str, on_date: dt.date) -> dict[str, Any]:
    updated = copy.deepcopy(item)
    previous_interval = int(updated.get("interval_days", 1))
    interval = next_interval_days(previous_interval, result)
    next_due = on_date + dt.timedelta(days=interval)

    updated["last_result"] = result
    updated["interval_days"] = interval
    updated["next_due"] = next_due.isoformat()
    updated["status"] = "reviewing" if result == "pass" else "needs_review"
    updated.setdefault("history", []).append(
        {
            "date": on_date.isoformat(),
            "result": result,
            "previous_interval_days": previous_interval,
            "next_interval_days": interval,
            "next_due": next_due.isoformat(),
        }
    )
    return updated


def slot_for_time(value: dt.time) -> dict[str, Any]:
    minutes = value.hour * 60 + value.minute
    slots = [
        {
            "name": "早地铁",
            "start": 6 * 60,
            "end": 10 * 60 + 59,
            "duration": "25 分钟",
            "can_speak": False,
            "instruction": "无需开口：复习到期内容、A+ 预习/听力输入、客户词块默想。",
        },
        {
            "name": "午间",
            "start": 11 * 60,
            "end": 14 * 60 + 59,
            "duration": "5-10 分钟",
            "can_speak": False,
            "instruction": "无需开口：做轻量复习考察，只处理最该复习的内容。",
        },
        {
            "name": "晚地铁",
            "start": 16 * 60,
            "end": 20 * 60 + 59,
            "duration": "25 分钟",
            "can_speak": False,
            "instruction": "无需开口：准备夜练句型、客户场景问答和表达顺序。",
        },
        {
            "name": "夜练",
            "start": 21 * 60,
            "end": 23 * 60 + 59,
            "duration": "40 分钟",
            "can_speak": True,
            "instruction": "可以开口：完成 A+ 主课程、跟读发音和客户场景输出。",
        },
    ]
    for slot in slots:
        if slot["start"] <= minutes <= slot["end"]:
            return {key: value for key, value in slot.items() if key not in {"start", "end"}}
    return {
        "name": "零碎复习",
        "duration": "5 分钟",
        "can_speak": False,
        "instruction": "无需开口：只做 1-3 个到期项目的快速回忆。",
    }


def plan_for_slot(
    daily_plan: dict[str, Any] | None, on_date: dt.date, slot_name: str
) -> tuple[str, list[str]]:
    if not daily_plan:
        return "", []
    day_plan = daily_plan.get(on_date.isoformat(), {})
    theme = day_plan.get("theme", "")
    tasks = day_plan.get("slots", {}).get(slot_name, [])
    return theme, tasks


def template_for_slot(
    roadmap: dict[str, Any] | None,
    slot_templates: dict[str, Any] | None,
    on_date: dt.date,
    slot_name: str,
) -> tuple[str, list[str]]:
    milestone = milestone_for_date(roadmap or {}, on_date)
    if not milestone or not slot_templates:
        return "", []
    tasks = slot_templates.get(milestone["id"], {}).get(slot_name, [])
    return milestone.get("name", ""), tasks


def render_task(
    items: list[dict[str, Any]],
    on_date: dt.date,
    at_time: dt.time,
    daily_plan: dict[str, Any] | None = None,
    roadmap: dict[str, Any] | None = None,
    slot_templates: dict[str, Any] | None = None,
) -> str:
    slot = slot_for_time(at_time)
    due = due_items(items, on_date)
    theme, planned_tasks = plan_for_slot(daily_plan, on_date, slot["name"])
    if not planned_tasks:
        theme, planned_tasks = template_for_slot(roadmap, slot_templates, on_date, slot["name"])
    lines = [
        f"# {on_date.isoformat()} {slot['name']}任务",
        "",
        f"- 时长：{slot['duration']}",
        f"- 方式：{slot['instruction']}",
        "",
        "## 本时段任务",
    ]
    if theme:
        lines.append(f"- 今日主题：{theme}")
    if planned_tasks:
        for task in planned_tasks:
            lines.append(f"- {task}")
    else:
        lines.append("- 暂无结构化计划；完成 A+ 今日内容，并复习到期客户沟通表达。")
    lines.extend(
        [
            "",
            "## 到期复习",
        ]
    )
    if due:
        for item in due[:8]:
            lines.append(f"- [{item['id']}] {item['item']} -> {item.get('example', '')}")
    else:
        lines.append("- 暂无到期复习。")
    lines.extend(
        [
            "",
            "## 学完回传",
            "",
            "```text",
            "时间段：",
            "来源：",
            "完成：",
            "文件总结：",
            "不熟：",
            "不会：",
            "```",
        ]
    )
    return "\n".join(lines)


def update_item_result(
    items: list[dict[str, Any]], item_id: str, result: str, on_date: dt.date
) -> list[dict[str, Any]]:
    updated_items = []
    found = False
    for item in items:
        if item["id"] == item_id:
            updated_items.append(record_result(item, result, on_date))
            found = True
        else:
            updated_items.append(item)
    if not found:
        raise KeyError(f"unknown review item id: {item_id}")
    return updated_items


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return slug or "review-item"


def unique_id(base: str, existing_ids: set[str]) -> str:
    candidate = base
    counter = 2
    while candidate in existing_ids:
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


def find_item_index(items: list[dict[str, Any]], value: str) -> int | None:
    normalized = value.strip().lower()
    for index, item in enumerate(items):
        if item.get("id", "").lower() == normalized:
            return index
        if item.get("item", "").strip().lower() == normalized:
            return index
    return None


def new_review_item(value: str, result: str, on_date: dt.date, existing_ids: set[str]) -> dict[str, Any]:
    item_id = unique_id(slugify(value), existing_ids)
    next_due = on_date + dt.timedelta(days=1)
    return {
        "id": item_id,
        "item": value,
        "type": "chunk",
        "source": f"checkin {on_date.isoformat()}",
        "status": "needs_review",
        "last_result": result,
        "next_due": next_due.isoformat(),
        "interval_days": 1,
        "example": "",
        "note": "auto-added from checkin",
        "history": [
            {
                "date": on_date.isoformat(),
                "result": result,
                "previous_interval_days": 1,
                "next_interval_days": 1,
                "next_due": next_due.isoformat(),
            }
        ],
    }


def apply_checkin_to_items(
    items: list[dict[str, Any]], parsed: dict[str, Any], on_date: dt.date
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    updated = copy.deepcopy(items)
    changes = {"updated": [], "added": []}
    result_groups = [
        ("fail", parsed.get("failed", [])),
        ("shaky", parsed.get("shaky", [])),
        ("shaky", parsed.get("blocked", [])),
    ]
    existing_ids = {item["id"] for item in updated}

    for result, values in result_groups:
        for value in values:
            index = find_item_index(updated, value)
            if index is None:
                item = new_review_item(value, result, on_date, existing_ids)
                updated.append(item)
                existing_ids.add(item["id"])
                changes["added"].append(item["id"])
            else:
                item_id = updated[index]["id"]
                updated[index] = record_result(updated[index], result, on_date)
                if item_id not in changes["updated"]:
                    changes["updated"].append(item_id)
    return updated, changes


def split_items(value: str) -> list[str]:
    normalized = re.sub(r"[;；、，]", ",", value)
    return [part.strip() for part in normalized.split(",") if part.strip()]


def has_structured_checkin(fields: dict[str, Any]) -> bool:
    return bool(
        fields.get("slot")
        or fields.get("course")
        or fields.get("completed")
        or fields.get("blocked")
        or fields.get("learned")
        or fields.get("shaky")
        or fields.get("failed")
        or fields.get("source_files")
        or fields.get("file_summary")
        or fields.get("ratings")
    )


def infer_slot_from_text(text: str) -> str:
    slot_markers = [
        ("早地铁", "早地铁"),
        ("早练", "早地铁"),
        ("午间", "午间"),
        ("中午", "午间"),
        ("午休", "午间"),
        ("晚地铁", "晚地铁"),
        ("晚练", "夜练"),
        ("夜练", "夜练"),
        ("晚上", "夜练"),
    ]
    for marker, slot in slot_markers:
        if marker in text:
            return slot
    return ""


def clean_one_sentence_item(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^(早地铁|早练|午间|中午|午休|晚地铁|晚练|夜练|晚上)\s*", "", cleaned)
    cleaned = re.sub(r"^(完成|做了|学了|复习了|练了)\s*", "", cleaned)
    cleaned = re.sub(r"\s*(不熟|不稳|不会|卡住|卡住了)$", "", cleaned)
    return cleaned.strip(" ，,。.;；")


def apply_one_sentence_checkin(fields: dict[str, Any], text: str) -> dict[str, Any]:
    fields["slot"] = infer_slot_from_text(text)
    active_list = ""
    for part in split_items(text):
        item = clean_one_sentence_item(part)
        if not item:
            continue
        if re.search(r"(不会)$", part):
            fields["failed"].append(item)
            active_list = ""
        elif re.search(r"(不熟|不稳)$", part):
            fields["shaky"].append(item)
            active_list = ""
        elif re.search(r"(卡住|卡住了)$", part):
            fields["blocked"].append(item)
            active_list = ""
        elif re.search(r"(完成|做了|学了|复习了|练了)", part):
            fields["completed"].append(item)
            active_list = "completed"
        elif active_list == "completed":
            fields["completed"].append(item)
    return fields


def parse_checkin_text(text: str) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "slot": "",
        "course": "",
        "completed": [],
        "blocked": [],
        "learned": [],
        "shaky": [],
        "failed": [],
        "source_files": [],
        "file_summary": "",
        "ratings": "",
        "raw": text.strip(),
    }
    mapping = {
        "时间段": ("slot", "scalar"),
        "A+课程": ("course", "scalar"),
        "课程": ("course", "scalar"),
        "来源": ("source_files", "list"),
        "来源文件": ("source_files", "list"),
        "文件": ("source_files", "list"),
        "截图文件": ("source_files", "list"),
        "录屏文件": ("source_files", "list"),
        "完成": ("completed", "list"),
        "完成了": ("completed", "list"),
        "卡住": ("blocked", "list"),
        "卡住了": ("blocked", "list"),
        "今天新学": ("learned", "list"),
        "新学": ("learned", "list"),
        "文件总结": ("file_summary", "scalar"),
        "截图总结": ("file_summary", "scalar"),
        "录屏总结": ("file_summary", "scalar"),
        "学习文件整理": ("file_summary", "scalar"),
        "不熟": ("shaky", "list"),
        "不熟的内容": ("shaky", "list"),
        "不会": ("failed", "list"),
        "不会的内容": ("failed", "list"),
        "自评": ("ratings", "scalar"),
    }
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = re.match(r"^([^:：]+)[:：]\s*(.*)$", line)
        if not match:
            continue
        label = match.group(1).strip()
        value = match.group(2).strip()
        if label not in mapping:
            continue
        key, mode = mapping[label]
        if mode == "scalar":
            fields[key] = value
        else:
            fields[key].extend(split_items(value))
    if not has_structured_checkin(fields):
        apply_one_sentence_checkin(fields, text.strip())
    return fields


def summarize_checkin(parsed: dict[str, Any]) -> str:
    lines = ["# 本次总结", ""]
    slot = parsed.get("slot") or "未标注时间段"
    lines.append(f"- 时间段：{slot}")
    completed = parsed.get("completed", [])
    if completed:
        lines.append(f"- 已完成：{', '.join(completed)}")
    if parsed.get("source_files"):
        lines.append(f"- 来源文件：{', '.join(parsed['source_files'])}")
    if parsed.get("course"):
        lines.append(f"- A+课程：{parsed['course']}")
    if parsed.get("file_summary"):
        lines.append(f"- 文件总结：{parsed['file_summary']}")
    if parsed.get("learned"):
        lines.append(f"- 新学内容：{', '.join(parsed['learned'])}")
    if parsed.get("shaky"):
        lines.append(f"- 不熟：{', '.join(parsed['shaky'])}")
    if parsed.get("failed"):
        lines.append(f"- 不会：{', '.join(parsed['failed'])}")
    if parsed.get("blocked"):
        lines.append(f"- 卡住：{', '.join(parsed['blocked'])}")
    if parsed.get("ratings"):
        lines.append(f"- 自评：{parsed['ratings']}")

    weak_items = parsed.get("failed", []) + parsed.get("shaky", []) + parsed.get("blocked", [])
    lines.extend(["", "## 下一次优先复习"])
    if weak_items:
        for item in weak_items:
            lines.append(f"- {item}")
    else:
        lines.append("- 暂无明确薄弱项；下一次按复习队列和本周计划推进。")
    return "\n".join(lines)


def append_checkin(
    parsed: dict[str, Any], on_date: dt.date, log_path: Path = DEFAULT_CHECKINS
) -> dict[str, Any]:
    record = {
        "date": on_date.isoformat(),
        "slot": parsed.get("slot", ""),
        "course": parsed.get("course", ""),
        "completed": parsed.get("completed", []),
        "blocked": parsed.get("blocked", []),
        "learned": parsed.get("learned", []),
        "shaky": parsed.get("shaky", []),
        "failed": parsed.get("failed", []),
        "source_files": parsed.get("source_files", []),
        "file_summary": parsed.get("file_summary", ""),
        "ratings": parsed.get("ratings", ""),
        "raw": parsed.get("raw", ""),
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False))
        handle.write("\n")
    return record


def append_daily_note(
    parsed: dict[str, Any],
    summary: str,
    on_date: dt.date,
    notes_dir: Path = DEFAULT_NOTES_DIR,
) -> Path:
    notes_dir.mkdir(parents=True, exist_ok=True)
    note_path = notes_dir / f"{on_date.isoformat()}.md"
    entry_summary = summary.replace("# 本次总结", "### 本次总结", 1)
    slot = parsed.get("slot") or "未标注时间段"
    raw = parsed.get("raw", "")

    chunks = []
    if not note_path.exists():
        chunks.append(f"# {on_date.isoformat()} 学习总结\n")
    chunks.extend(
        [
            f"## {slot}",
            "",
            entry_summary,
        ]
    )
    if raw:
        chunks.extend(
            [
                "",
                "### 原始打卡",
                "",
                "```text",
                raw,
                "```",
            ]
        )
    chunks.append("")

    with note_path.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(chunks))
        handle.write("\n")
    return note_path


def render_mobile_reminders(config: dict[str, Any]) -> str:
    timezone = config.get("timezone", "Asia/Shanghai")
    lines = [
        "# 手机提醒设置",
        "",
        f"- 时区：{timezone}",
        "- 用途：把下面 4 条复制到 ChatGPT 手机 App 的任务/提醒里，或复制到手机日历/提醒事项。",
        "",
    ]
    for reminder in config.get("reminders", []):
        lines.extend(
            [
                f"## {reminder['time']} {reminder['slot']}",
                "",
                f"- 时长：{reminder.get('duration', '')}",
                "- 复制到 ChatGPT：",
                "",
                "```text",
                reminder.get("prompt", ""),
                "```",
                "",
            ]
        )
    return "\n".join(lines).rstrip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage English coach review items.")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--checkins", type=Path, default=DEFAULT_CHECKINS)
    parser.add_argument("--plan", type=Path, default=DEFAULT_DAILY_PLAN)
    parser.add_argument("--roadmap", type=Path, default=DEFAULT_ROADMAP)
    parser.add_argument("--mobile-reminders", type=Path, default=DEFAULT_MOBILE_REMINDERS)
    parser.add_argument("--notes-dir", type=Path, default=DEFAULT_NOTES_DIR)
    parser.add_argument("--slot-templates", type=Path, default=DEFAULT_SLOT_TEMPLATES)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    subparsers = parser.add_subparsers(dest="command", required=True)

    due_parser = subparsers.add_parser("due", help="show due review items")
    due_parser.add_argument("--date", default=today().isoformat())

    quiz_parser = subparsers.add_parser("quiz", help="render due review quiz")
    quiz_parser.add_argument("--date", default=today().isoformat())
    quiz_parser.add_argument("--limit", type=int, default=8)

    task_parser = subparsers.add_parser("task", help="render the current learning task")
    task_parser.add_argument("--date", default=today().isoformat())
    task_parser.add_argument("--time", default=dt.datetime.now().strftime("%H:%M"))

    status_parser = subparsers.add_parser("status", help="show roadmap phase and review status")
    status_parser.add_argument("--date", default=today().isoformat())

    report_parser = subparsers.add_parser("report", help="show recent learning report")
    report_parser.add_argument("--date", default=today().isoformat())
    report_parser.add_argument("--days", type=int, default=7)

    subparsers.add_parser("reminders", help="render mobile reminder setup prompts")
    subparsers.add_parser("profile", help="render learner profile and personalization questions")

    review_parser = subparsers.add_parser("review", help="record a review result")
    review_parser.add_argument("item_id")
    review_parser.add_argument("result", choices=["pass", "shaky", "fail"])
    review_parser.add_argument("--date", default=today().isoformat())

    checkin_parser = subparsers.add_parser("checkin", help="record a mobile learning check-in")
    checkin_parser.add_argument("--date", default=today().isoformat())
    checkin_parser.add_argument("--text", default="")
    checkin_parser.add_argument("--file", type=Path)

    slot_parser = subparsers.add_parser("slot", help="show the learning slot for a time")
    slot_parser.add_argument("--time", default=dt.datetime.now().strftime("%H:%M"))

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.command == "slot":
        print(json.dumps(slot_for_time(parse_time(args.time)), ensure_ascii=False, indent=2))
        return
    if args.command == "reminders":
        print(render_mobile_reminders(load_mobile_reminders(args.mobile_reminders)))
        return
    if args.command == "profile":
        print(render_profile(load_profile(args.profile)))
        return

    items = load_items(args.state)
    on_date = parse_date(args.date)

    if args.command == "due":
        print(json.dumps(due_items(items, on_date), ensure_ascii=False, indent=2))
    elif args.command == "quiz":
        print(render_quiz(items, on_date, args.limit))
    elif args.command == "task":
        print(
            render_task(
                items,
                on_date,
                parse_time(args.time),
                load_daily_plan(args.plan),
                load_roadmap(args.roadmap),
                load_slot_templates(args.slot_templates),
            )
        )
    elif args.command == "status":
        print(render_status(items, load_roadmap(args.roadmap), on_date))
    elif args.command == "report":
        print(render_report(items, load_checkins(args.checkins), on_date, args.days))
    elif args.command == "review":
        updated = update_item_result(items, args.item_id, args.result, on_date)
        save_items(updated, args.state)
        changed = next(item for item in updated if item["id"] == args.item_id)
        print(json.dumps(changed, ensure_ascii=False, indent=2))
    elif args.command == "checkin":
        if args.file:
            text = args.file.read_text(encoding="utf-8")
        elif args.text:
            text = args.text
        else:
            text = sys.stdin.read()
        parsed = parse_checkin_text(text)
        append_checkin(parsed, on_date, args.checkins)
        updated, changes = apply_checkin_to_items(items, parsed, on_date)
        save_items(updated, args.state)
        summary = summarize_checkin(parsed)
        append_daily_note(parsed, summary, on_date, args.notes_dir)
        print(summary)
        if changes["updated"] or changes["added"]:
            print("\n## 复习队列更新")
            if changes["updated"]:
                print(f"- 已更新：{', '.join(changes['updated'])}")
            if changes["added"]:
                print(f"- 已新增：{', '.join(changes['added'])}")


if __name__ == "__main__":
    main()
