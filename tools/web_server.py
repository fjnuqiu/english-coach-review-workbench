#!/usr/bin/env python3
"""Local web server for the English coach dashboard."""

from __future__ import annotations

import argparse
import base64
import cgi
import datetime as dt
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse
import uuid


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
COACH_PATH = Path(__file__).with_name("coach.py")
COURSE_STORE_PATH = Path(__file__).with_name("course_store.py")
OCR_SCRIPT = Path(__file__).with_name("ocr_image.swift")
VIDEO_FRAME_SCRIPT = Path(__file__).with_name("extract_video_frames.swift")
UPLOAD_DIR = ROOT / "uploads"
CODEX_INBOX_DIR = ROOT / "codex-inbox"
CODEX_AUTO_LOG_DIR = ROOT / "state" / "codex-auto"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".bmp", ".heic"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v"}
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
OPENAI_DEFAULT_MODEL = "gpt-5.5"
CORE_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "but",
    "for",
    "i",
    "is",
    "it",
    "of",
    "on",
    "or",
    "so",
    "that",
    "the",
    "this",
    "to",
    "was",
    "we",
    "were",
    "you",
}

spec = importlib.util.spec_from_file_location("coach", COACH_PATH)
coach = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(coach)

course_store_spec = importlib.util.spec_from_file_location("course_store", COURSE_STORE_PATH)
course_store = importlib.util.module_from_spec(course_store_spec)
assert course_store_spec.loader is not None
course_store_spec.loader.exec_module(course_store)


class OpenAIConfigError(RuntimeError):
    """Raised when the local dashboard is missing OpenAI configuration."""


class OpenAIRequestError(RuntimeError):
    """Raised when OpenAI returns an error response or invalid payload."""


def read_local_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in (ROOT / ".env.local", ROOT / ".env"):
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key:
                values[key] = value
    return values


def config_value(name: str, default: str = "") -> str:
    return os.environ.get(name) or read_local_env().get(name, default)


def openai_api_key() -> str:
    return config_value("OPENAI_API_KEY")


def openai_learning_model() -> str:
    return (
        config_value("OPENAI_LEARNING_MODEL")
        or config_value("OPENAI_MODEL")
        or OPENAI_DEFAULT_MODEL
    )


def keep_uploads_enabled() -> bool:
    return config_value("ENGLISH_COACH_KEEP_UPLOADS").lower() in {"1", "true", "yes", "on"}


def openai_status_payload() -> dict[str, Any]:
    configured = bool(openai_api_key())
    return {
        "configured": configured,
        "mode": "openai" if configured else "missing_key",
        "model": openai_learning_model(),
        "store": False,
        "keep_uploads": keep_uploads_enabled(),
    }


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def load_state_items(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return coach.load_items(path)


def split_inline_items(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,，、;；]", value) if part.strip()]


def parse_study_note(content: str) -> dict[str, Any]:
    fields = {
        "completed": "",
        "summary": "",
        "learned": [],
        "weak": [],
        "source_files": [],
    }
    label_map = {
        "已完成": ("completed", "scalar"),
        "完成": ("completed", "scalar"),
        "文件总结": ("summary", "scalar"),
        "新学内容": ("learned", "list"),
        "今天新学": ("learned", "list"),
        "不熟": ("weak", "list"),
        "来源文件": ("source_files", "list"),
        "来源": ("source_files", "list"),
    }
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line.startswith("- "):
            continue
        match = re.match(r"^-\s*([^:：]+)[:：]\s*(.*)$", line)
        if not match:
            continue
        label = match.group(1).strip()
        value = match.group(2).strip()
        if label not in label_map:
            continue
        key, mode = label_map[label]
        if mode == "scalar":
            fields[key] = value
        else:
            fields[key].extend(split_inline_items(value))
    return fields


def useful_prompt(item: dict[str, Any]) -> str:
    for key in ("prompt", "translation", "meaning", "zh", "chinese"):
        value = str(item.get(key) or "").strip()
        if value:
            return value
    note = str(item.get("note", "")).strip()
    if note and note != "auto-added from checkin":
        return note
    return str(item.get("item", "")).strip()


def english_tokens(value: str) -> list[str]:
    return [
        token.lower().replace("'", "")
        for token in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", value)
    ]


def target_sentence(item: dict[str, Any]) -> str:
    example = str(item.get("example", "")).strip()
    return example or str(item.get("item", "")).strip()


def prompt_sentence(item: dict[str, Any]) -> str:
    return useful_prompt(item)


def review_keywords(item: dict[str, Any]) -> list[str]:
    answer_tokens = english_tokens(str(item.get("item", "")))
    keywords = [
        token
        for token in answer_tokens
        if token not in CORE_STOP_WORDS and len(token) > 1
    ]
    if keywords:
        return keywords
    return [
        token
        for token in english_tokens(target_sentence(item))
        if token not in CORE_STOP_WORDS and len(token) > 1
    ][:6]


def review_card(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "prompt": useful_prompt(item),
        "prompt_sentence": prompt_sentence(item),
        "answer": item.get("item", ""),
        "target_sentence": target_sentence(item),
        "example": item.get("example", ""),
        "accepted_answers": item.get("accepted_answers", []),
        "note": item.get("note", ""),
        "keywords": review_keywords(item),
        "mastery_score": course_store.card_mastery_score(item),
        "last_result": item.get("last_result", ""),
        "next_due": item.get("next_due", ""),
        "source": item.get("source", ""),
    }


def translation_key(value: str) -> str:
    return re.sub(r"[\s。！？!?，,；;：:、]+", "", value or "").lower()


TERM_TRANSLATIONS = {
    "即时账务": "real-time accounting",
    "实时账务": "real-time accounting",
    "账务": "accounting",
    "即时": "real-time",
    "实时": "real-time",
    "生成英文": "turn it into English",
    "翻译成英文": "translate it into English",
    "转成英文": "turn it into English",
    "中文": "Chinese",
    "英文": "English",
    "客户": "the client",
    "功能": "feature",
    "一个": "a",
    "这句话": "this sentence",
    "这个句子": "this sentence",
    "这段内容": "this content",
    "内容": "content",
    "表达": "expression",
    "暂时": "temporarily",
    "没有": "not",
    "收录": "included",
    "已经": "already",
    "完成": "finish",
    "测试账号": "test account",
    "账号": "account",
    "接口": "API",
    "草稿": "draft",
    "项目": "project",
    "进展": "progress",
    "问题": "issue",
    "处理": "handle",
    "确认": "confirm",
    "需求": "requirements",
}


FRAGMENT_TRANSLATIONS = {
    translation_key("我们已经完成了 API 草稿"): "we finished the API draft",
    translation_key("API 草稿"): "the API draft",
    translation_key("缺少测试账号"): "the missing test account",
    translation_key("需求的这一部分"): "this part of the requirement",
    translation_key("我的理解"): "my understanding",
    translation_key("在我们继续之前"): "before we move on",
    translation_key("卢浮宫的主入口"): "the main entrance of the Louvre",
    translation_key("去看它"): "to see it",
    translation_key("很拥挤"): "really crowded",
    translation_key("测试"): "the testing",
    translation_key("开发"): "the development",
    translation_key("需求"): "the requirements",
    translation_key("这个问题"): "this issue",
    translation_key("这个部分"): "this part",
    translation_key("程序入口"): "program entry point",
    translation_key("入口函数"): "entry function",
    translation_key("启动入口"): "startup entry point",
    **{translation_key(key): value for key, value in TERM_TRANSLATIONS.items()},
}


EXACT_TRANSLATIONS = {
    translation_key("明天我会更新你"): "I will update you tomorrow.",
    translation_key("我明天会更新你"): "I will update you tomorrow.",
    translation_key("我会更新你"): "I will update you.",
    translation_key("我会尽快更新你"): "I will update you as soon as possible.",
    translation_key("我需要确认一件事"): "I need to confirm one thing.",
    translation_key("我需要确认一下"): "I need to confirm one thing.",
    translation_key("我们已经完成了测试"): "We finished the testing.",
    translation_key("我们完成了测试"): "We finished the testing.",
    translation_key("我们已经完成了 API 草稿"): "We finished the API draft.",
    translation_key("程序入口"): "program entry point",
    translation_key("入口函数"): "entry function",
    translation_key("启动入口"): "startup entry point",
}


def translate_known_fragment(value: str) -> str:
    key = translation_key(value)
    if key in FRAGMENT_TRANSLATIONS:
        return FRAGMENT_TRANSLATIONS[key]
    return translate_best_effort_fragment(value)


def translate_best_effort_fragment(value: str) -> str:
    source = re.sub(r"\s+", "", value or "").strip("。！？!?，,；;：:、 ")
    if not source:
        return ""

    chunks: list[str] = []
    index = 0
    terms = sorted(TERM_TRANSLATIONS.items(), key=lambda item: len(item[0]), reverse=True)
    while index < len(source):
        remainder = source[index:]
        match = next(((term, english) for term, english in terms if remainder.startswith(term)), None)
        if match:
            term, english = match
            chunks.append(english)
            index += len(term)
            continue
        char = source[index]
        if re.match(r"[A-Za-z0-9#+._-]", char):
            chunks.append(char)
        elif char in {"的", "了", "是", "把", "请", "我", "们", "你", "您", "和"}:
            pass
        else:
            chunks.append(char)
        index += 1

    result = " ".join(part for part in chunks if part).strip()
    result = re.sub(r"\s+([A-Za-z0-9#+._-])\s+", r" \1 ", result)
    result = re.sub(r"\s+", " ", result).strip()
    return result or source


def translate_from_review_cards(text: str) -> dict[str, str] | None:
    key = translation_key(text)
    for item in load_state_items(coach.DEFAULT_STATE):
        prompt = useful_prompt(item)
        target = target_sentence(item)
        if prompt and target and translation_key(prompt) == key:
            return {
                "source_text": text,
                "translation": target,
                "source": f"本地学习词库：复习卡 {item.get('id', '')}",
            }
    return None


def translate_text(text: str) -> dict[str, str]:
    source_text = re.sub(r"\s+", " ", text or "").strip()
    if not source_text:
        return {"source_text": "", "translation": "", "source": "本地学习词库"}

    exact = EXACT_TRANSLATIONS.get(translation_key(source_text))
    if exact:
        return {
            "source_text": source_text,
            "translation": exact,
            "source": "本地学习词库：常用表达",
        }

    review_match = translate_from_review_cards(source_text)
    if review_match:
        return review_match

    cleaned = source_text.strip("。！？!? ")
    templates = [
        (r"^当前进展是(.+)$", lambda part: f"The current status is that {translate_known_fragment(part)}."),
        (r"^当前阻塞点是(.+)$", lambda part: f"The current blocker is {translate_known_fragment(part)}."),
        (r"^你能澄清一下(.+)吗$", lambda part: f"Could you clarify {translate_known_fragment(part)}?"),
        (r"^我需要确认(.+)$", lambda part: f"I need to confirm {translate_known_fragment(part)}."),
        (r"^我需要一个(.+)功能$", lambda part: f"I need a {translate_known_fragment(part)} feature."),
        (r"^我需要(.+)$", lambda part: f"I need {translate_known_fragment(part)}."),
        (r"^客户问(.+)怎么处理$", lambda part: f"The client asked how to handle {translate_known_fragment(part)}."),
        (r"^把(.+)翻译成英文$", lambda part: f"Translate {translate_known_fragment(part)} into English."),
        (r"^(.+)生成英文$", lambda part: f"Turn {translate_known_fragment(part)} into English."),
        (r"^我们需要足够的时间(.+)$", lambda part: f"We need enough time {translate_known_fragment(part)}."),
        (r"^明天我会更新(.+)$", lambda part: "I will update you tomorrow." if part.strip() in {"你", "您"} else f"I will update {translate_known_fragment(part)} tomorrow."),
        (r"^我明天会更新(.+)$", lambda part: "I will update you tomorrow." if part.strip() in {"你", "您"} else f"I will update {translate_known_fragment(part)} tomorrow."),
        (r"^我会更新(.+)$", lambda part: "I will update you." if part.strip() in {"你", "您"} else f"I will update {translate_known_fragment(part)}."),
        (r"^我们已经完成了(.+)$", lambda part: f"We finished {translate_known_fragment(part)}."),
        (r"^我们完成了(.+)$", lambda part: f"We finished {translate_known_fragment(part)}."),
    ]
    for pattern, renderer in templates:
        match = re.match(pattern, cleaned)
        if match:
            return {
                "source_text": source_text,
                "translation": renderer(match.group(1).strip()),
                "source": "本地学习词库：句型模板",
            }

    return {
        "source_text": source_text,
        "translation": translate_best_effort_fragment(source_text),
        "source": "本地学习词库：基础直译",
    }


MEDIA_PATTERNS = [
    {
        "item": "main entrance",
        "pattern": r"\bmain entrance\b",
        "prompt": "这是卢浮宫的主入口。",
        "note": "主入口",
    },
    {
        "item": "the Louvre",
        "pattern": r"\bthe louvre\b|\blouvre\b",
        "prompt": "卢浮宫。",
        "note": "卢浮宫",
    },
    {
        "item": "isn't open yet",
        "pattern": r"isn['’]?t open yet",
        "prompt": "还没有开放。",
        "note": "还没有开放",
    },
    {
        "item": "opens at nine",
        "pattern": r"opens at nine",
        "prompt": "九点开放。",
        "note": "开放时间",
    },
    {
        "item": "enough time to",
        "pattern": r"enough time to",
        "prompt": "有足够时间去做某事。",
        "note": "有足够时间去做某事",
    },
    {
        "item": "got here early",
        "pattern": r"got here early",
        "prompt": "我们早点到了这里。",
        "note": "早点到达",
    },
    {
        "item": "the Mona Lisa",
        "pattern": r"mona lisa",
        "prompt": "蒙娜丽莎。",
        "note": "蒙娜丽莎",
    },
    {
        "item": "crowded",
        "pattern": r"\bcrowded\b",
        "prompt": "很拥挤。",
        "note": "拥挤的",
    },
    {
        "item": "sculptures and paintings",
        "pattern": r"sculptures and paintings",
        "prompt": "雕塑和绘画。",
        "note": "雕塑和绘画",
    },
    {
        "item": "souvenir at the gift shop",
        "pattern": r"souvenir.+gift shop|gift shop.+souvenir",
        "prompt": "在礼品店买的纪念品。",
        "note": "礼品店里的纪念品",
    },
    {
        "item": "talk to you later",
        "pattern": r"talk to you later",
        "prompt": "回头再聊。",
        "note": "回头再聊",
    },
]


def split_english_sentences(text: str) -> list[str]:
    candidates: list[str] = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not re.search(r"[A-Za-z]", line):
            continue
        for part in re.split(r"(?<=[.!?])\s+", line):
            cleaned = part.strip()
            if re.search(r"[A-Za-z]", cleaned):
                candidates.append(cleaned)
    return candidates


def first_matching_sentence(text: str, pattern: str, fallback: str) -> str:
    for sentence in split_english_sentences(text):
        if re.search(pattern, sentence, re.IGNORECASE):
            return sentence
    return fallback


def extract_media_candidates(ocr_text: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for spec in MEDIA_PATTERNS:
        if not re.search(spec["pattern"], ocr_text, re.IGNORECASE | re.DOTALL):
            continue
        candidates.append(
            {
                "item": spec["item"],
                "example": first_matching_sentence(ocr_text, spec["pattern"], spec["item"]),
                "prompt": spec["prompt"],
                "note": spec["note"],
            }
        )
    return candidates[:8]


def media_file_summary(ocr_text: str, candidates: list[dict[str, str]]) -> str:
    if not ocr_text.strip():
        return "已保存学习文件，但没有识别到清晰文字；需要重新上传更清晰的截图或手动补充不熟内容。"
    lower_text = ocr_text.lower()
    if "louvre" in lower_text or "mona lisa" in lower_text:
        return (
            "截图内容是 Cindy 的卢浮宫听力材料，重点包括卢浮宫主入口、开放时间、"
            "提前到达、蒙娜丽莎、拥挤排队、雕塑绘画和礼品店纪念品等表达。"
        )
    if candidates:
        learned = "、".join(candidate["item"] for candidate in candidates[:5])
        return f"截图中识别到英语学习内容，重点表达包括 {learned}。"
    return "截图中识别到英语文字，但暂未匹配到稳定复习词块；已保存原文，后续可手动补充不熟内容。"


def build_media_checkin_text(
    file_names: list[str],
    ocr_text: str,
    slot: str = "今日学习",
    completed: str = "截图/录屏学习文件整理",
) -> str:
    candidates = extract_media_candidates(ocr_text)
    learned = [candidate["item"] for candidate in candidates]
    source = ", ".join(file_names) if file_names else "上传学习文件"
    return "\n".join(
        [
            f"时间段：{slot or '今日学习'}",
            f"来源：{source}",
            f"完成：{completed or '截图/录屏学习文件整理'}",
            f"文件总结：{media_file_summary(ocr_text, candidates)}",
            f"今天新学：{', '.join(learned)}",
            f"不熟：{', '.join(learned)}",
            "不会：",
        ]
    )


OPENAI_LEARNING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["courses"],
    "properties": {
        "courses": {
            "type": "array",
            "description": "从材料中识别出的实际课程或小课。",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id_hint",
                    "title",
                    "summary_zh",
                    "learned",
                    "full_content",
                    "selected_content",
                ],
                "properties": {
                    "id_hint": {
                        "type": "string",
                        "description": "简短英文课程标识，如 pet-food-safety。",
                    },
                    "title": {
                        "type": "string",
                        "description": "简短中文课程名。",
                    },
                    "summary_zh": {
                        "type": "string",
                        "description": "直观中文课程总结。",
                    },
                    "learned": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本课程新学的英文表达或完整句。",
                    },
                    "full_content": {
                        "type": "array",
                        "description": "完整内容：本课程画面中所有可确认的英文句子、对话句、定义、例句和词汇卡，不做数量截断。",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["item", "prompt", "example", "note"],
                            "properties": {
                                "item": {"type": "string"},
                                "prompt": {"type": "string"},
                                "example": {"type": "string"},
                                "note": {"type": "string"},
                            },
                        },
                    },
                    "selected_content": {
                        "type": "array",
                        "description": "精选内容：必须掌握的核心卡片，值必须与 full_content 中的 item 完全一致。",
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
}


def compact_text(value: str, max_chars: int = 60000) -> str:
    cleaned = re.sub(r"\n{3,}", "\n\n", value or "").strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].rstrip() + "\n...[已截断]"


def file_to_data_url(path: Path, content_type: str = "") -> str:
    mime = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def openai_learning_prompt(file_names: list[str], ocr_text: str) -> str:
    source = ", ".join(file_names) if file_names else "上传学习文件"
    return "\n".join(
        [
            "你是用户的英语家教老师。请根据上传的英语学习截图/录屏关键帧，以及 OCR 文本，完整采集学习内容。",
            "目标：让用户后续能在复习台看到中文意思，自己说出英文，再检查是否掌握。",
            "",
            "整理要求：",
            "- 先按实际课程拆分；一个录屏包含多节课时，必须输出多个 courses，不要压成一门总课。",
            "- 每门课程整理一个直观中文说明，但不要用摘要代替原始学习内容。",
            "- 完整保留画面中所有可确认的英文句子、对话句、定义、例句以及独立词汇或短语，不得只提炼重点，也不得限制为 10 条。",
            "- 相同内容在同一门课程内只保留一次；无法确认的 OCR 噪声不要收录。",
            "- full_content 是完整内容；每张卡的 prompt 只写完整中文意思，不要写“请用英文表达”等提示语。",
            "- full_content 每张卡的 example 写完整英文参考句，方便页面默认隐藏后检查。",
            "- selected_content 是核心必会内容，只列 full_content 中最重要、最值得主动表达的 item 原文，通常占完整内容的 20%–35%。",
            "- selected_content 的每个值必须和 full_content 中某个 item 完全一致；不得另写、改写或新增卡片。",
            "- 不确定的内容不要编造；OCR 和图片冲突时，以图片可见内容为准。",
            "",
            f"来源文件：{source}",
            "",
            "OCR 文本：",
            compact_text(ocr_text) or "未识别到清晰 OCR 文本，请优先阅读图片内容。",
        ]
    )


def openai_learning_payload(
    saved_files: list[dict[str, Any]],
    ocr_text: str,
    model: str | None = None,
) -> dict[str, Any]:
    file_names = [str(file_info.get("name", "")) for file_info in saved_files]
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": openai_learning_prompt(file_names, ocr_text),
        }
    ]
    for file_info in saved_files:
        path = Path(str(file_info.get("path", "")))
        if path.suffix.lower() not in IMAGE_SUFFIXES or not path.exists():
            continue
        content.append(
            {
                "type": "input_image",
                "image_url": file_to_data_url(path, str(file_info.get("content_type", ""))),
            }
        )
    return {
        "model": model or openai_learning_model(),
        "store": False,
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "english_learning_summary",
                "strict": True,
                "schema": OPENAI_LEARNING_SCHEMA,
            }
        },
    }


def extract_response_output_text(payload: dict[str, Any]) -> str:
    output_text = str(payload.get("output_text") or "").strip()
    if output_text:
        return output_text
    for output in payload.get("output", []):
        if output.get("type") != "message":
            continue
        for content in output.get("content", []):
            if content.get("type") in {"output_text", "text"}:
                text = str(content.get("text") or "").strip()
                if text:
                    return text
    return ""


def call_openai_learning_analysis(
    saved_files: list[dict[str, Any]],
    ocr_text: str,
    api_key: str | None = None,
    model: str | None = None,
    request_func: Any | None = None,
) -> dict[str, Any]:
    key = api_key or openai_api_key()
    if not key:
        raise OpenAIConfigError("OPENAI_API_KEY is not configured")
    request_payload = openai_learning_payload(saved_files, ocr_text, model=model)
    if request_func:
        response_payload = request_func(request_payload, key)
    else:
        request = urllib.request.Request(
            OPENAI_RESPONSES_URL,
            data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise OpenAIRequestError(detail[:1200]) from error
        except (OSError, json.JSONDecodeError) as error:
            raise OpenAIRequestError(str(error)) from error
    text = extract_response_output_text(response_payload)
    if not text:
        raise OpenAIRequestError("OpenAI response did not contain output text")
    try:
        analysis = json.loads(text)
    except json.JSONDecodeError as error:
        raise OpenAIRequestError(f"OpenAI response was not valid JSON: {text[:500]}") from error
    if not isinstance(analysis, dict):
        raise OpenAIRequestError("OpenAI response JSON must be an object")
    return analysis


def analysis_full_content(ai_analysis: dict[str, Any]) -> list[Any]:
    """Return the complete card list while accepting the legacy field name."""

    if "full_content" in ai_analysis:
        value = ai_analysis.get("full_content", [])
    else:
        value = ai_analysis.get("review_cards", [])
    return value if isinstance(value, list) else []


def ai_review_candidates(ai_analysis: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for raw_card in analysis_full_content(ai_analysis):
        if not isinstance(raw_card, dict):
            continue
        item = str(raw_card.get("item") or raw_card.get("example") or "").strip()
        example = str(raw_card.get("example") or item).strip()
        prompt = str(raw_card.get("prompt") or "").strip()
        note = str(raw_card.get("note") or "").strip()
        if not item or not prompt:
            continue
        candidates.append(
            {
                "item": item,
                "example": example or item,
                "prompt": prompt,
                "note": note or prompt,
                "accepted_answers": [
                    str(answer).strip()
                    for answer in raw_card.get("accepted_answers", [])
                    if str(answer).strip()
                ] if isinstance(raw_card.get("accepted_answers", []), list) else [],
            }
        )
    return candidates


def analysis_selected_items(
    ai_analysis: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> list[str]:
    """Validate and return selected item references in their requested order.

    Legacy analyses did not distinguish a curated subset, so all imported cards
    remain selected until that course is curated explicitly.
    """

    if "selected_content" not in ai_analysis:
        return [candidate["item"] for candidate in candidates]
    selected = ai_analysis.get("selected_content", [])
    if not isinstance(selected, list) or any(not isinstance(item, str) for item in selected):
        raise ValueError("selected_content must be an array of full_content item strings")
    candidate_items = {candidate["item"] for candidate in candidates}
    cleaned = list(dict.fromkeys(item.strip() for item in selected if item.strip()))
    missing = [item for item in cleaned if item not in candidate_items]
    if missing:
        raise ValueError(
            "selected_content must be a subset of full_content; unknown item: "
            + missing[0]
        )
    return cleaned


def normalize_analysis_courses(ai_analysis: dict[str, Any]) -> list[dict[str, Any]]:
    raw_courses = ai_analysis.get("courses", [])
    if isinstance(raw_courses, list) and raw_courses:
        return [course for course in raw_courses if isinstance(course, dict)]
    return [
        {
            "id_hint": "",
            "title": str(ai_analysis.get("title") or "学习材料").strip(),
            "summary_zh": str(ai_analysis.get("story_summary_zh") or "").strip(),
            "completed": str(ai_analysis.get("completed") or "").strip(),
            "learned": ai_analysis.get("learned", []),
            "full_content": analysis_full_content(ai_analysis),
            **(
                {"selected_content": ai_analysis.get("selected_content", [])}
                if "selected_content" in ai_analysis
                else {}
            ),
        }
    ]


def analysis_course_id(course: dict[str, Any], on_date: Any, index: int) -> str:
    hint = coach.slugify(str(course.get("id_hint") or ""))
    if hint:
        return hint
    title_slug = coach.slugify(str(course.get("title") or ""))
    return title_slug or f"course-{on_date.isoformat()}-{index + 1}"


def combined_course_analysis(courses: list[dict[str, Any]]) -> dict[str, Any]:
    titles = [str(course.get("title") or "").strip() for course in courses]
    summaries = [str(course.get("summary_zh") or "").strip() for course in courses]
    completed_values = [str(course.get("completed") or course.get("title") or "").strip() for course in courses]
    learned = [
        str(item).strip()
        for course in courses
        for item in course.get("learned", [])
        if str(item).strip()
    ]
    cards = [
        card
        for course in courses
        for card in analysis_full_content(course)
        if isinstance(card, dict)
    ]
    title = "、".join(title for title in titles if title) or "学习材料整理"
    return {
        "title": title,
        "story_summary_zh": " ".join(summary for summary in summaries if summary),
        "completed": "、".join(value for value in completed_values if value) or title,
        "learned": learned,
        "weak": [],
        "review_cards": cards,
    }


def build_ai_media_checkin_text(
    file_names: list[str],
    ai_analysis: dict[str, Any],
    slot: str = "今日学习",
    completed: str = "截图/录屏学习文件整理",
) -> str:
    source = ", ".join(file_names) if file_names else "上传学习文件"
    learned = [str(item).strip() for item in ai_analysis.get("learned", []) if str(item).strip()]
    weak = [str(item).strip() for item in ai_analysis.get("weak", []) if str(item).strip()]
    candidates = ai_review_candidates(ai_analysis)
    if not learned:
        learned = [candidate["item"] for candidate in candidates]
    summary = str(ai_analysis.get("story_summary_zh") or "").strip()
    completed_text = str(ai_analysis.get("completed") or completed or "截图/录屏学习文件整理").strip()
    return "\n".join(
        [
            f"时间段：{slot or '今日学习'}",
            f"来源：{source}",
            f"完成：{completed_text}",
            f"文件总结：{summary or 'Codex 已整理学习文件，但未返回明确中文总结。'}",
            f"今天新学：{', '.join(learned)}",
            f"不熟：{', '.join(weak)}",
            "不会：",
        ]
    )


def upsert_media_review_candidates(
    items: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    on_date: Any,
    course_id: str = "",
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    updated = [dict(item) for item in items]
    changes = {"updated": [], "added": []}
    existing_ids = {item["id"] for item in updated}
    for candidate in candidates:
        index = coach.find_item_index(updated, candidate["item"])
        if index is None:
            item = coach.new_review_item(candidate["item"], "shaky", on_date, existing_ids)
            item["status"] = "new"
            item["last_result"] = "pending"
            item["history"] = []
            existing_ids.add(item["id"])
            changes["added"].append(item["id"])
        else:
            item = dict(updated[index])
            changes["updated"].append(item["id"])
        item["example"] = candidate["example"]
        item["prompt"] = candidate["prompt"]
        item["note"] = candidate["note"]
        if candidate.get("accepted_answers"):
            item["accepted_answers"] = candidate["accepted_answers"]
        item["source"] = f"media upload {on_date.isoformat()}"
        if course_id:
            item["course_id"] = course_id
        if index is None:
            updated.append(item)
        else:
            updated[index] = item
    return updated, changes


def upsert_course_record(
    courses: list[dict[str, Any]],
    course_id: str,
    analysis: dict[str, Any],
    file_names: list[str],
    on_date: Any,
    card_ids: list[str],
    selected_card_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    updated = [dict(course) for course in courses]
    existing = next((course for course in updated if course.get("id") == course_id), None)
    if existing is None:
        existing = {
            "id": course_id,
            "title": str(analysis.get("title") or "学习课程").strip(),
            "summary_zh": str(analysis.get("summary_zh") or "").strip(),
            "source_files": [],
            "learned_on": on_date.isoformat(),
            "card_ids": [],
            "order": len(updated) + 1,
        }
        updated.append(existing)
    else:
        if str(analysis.get("title") or "").strip():
            existing["title"] = str(analysis["title"]).strip()
        if str(analysis.get("summary_zh") or "").strip():
            existing["summary_zh"] = str(analysis["summary_zh"]).strip()
    existing["source_files"] = list(
        dict.fromkeys([*existing.get("source_files", []), *file_names])
    )
    existing["card_ids"] = list(dict.fromkeys([*existing.get("card_ids", []), *card_ids]))
    if selected_card_ids is not None:
        existing["selected_card_ids"] = list(dict.fromkeys(selected_card_ids))
    return updated


def record_media_learning_from_ocr(
    file_names: list[str],
    ocr_text: str,
    on_date: str | Any,
    slot: str = "今日学习",
    completed: str = "截图/录屏学习文件整理",
    state_path: Path = coach.DEFAULT_STATE,
    checkins_path: Path = coach.DEFAULT_CHECKINS,
    notes_dir: Path = coach.DEFAULT_NOTES_DIR,
    ai_analysis: dict[str, Any] | None = None,
    courses_path: Path | None = None,
) -> dict[str, Any]:
    if isinstance(on_date, str):
        date_value = coach.parse_date(on_date)
    else:
        date_value = on_date
    items = load_state_items(state_path)
    resolved_courses_path = courses_path or state_path.with_name("courses.json")
    courses = course_store.load_courses(resolved_courses_path)
    if ai_analysis:
        analysis_courses = normalize_analysis_courses(ai_analysis)
        combined_analysis = combined_course_analysis(analysis_courses)
        checkin_text = build_ai_media_checkin_text(file_names, combined_analysis, slot, completed)
    else:
        candidates = extract_media_candidates(ocr_text)
        analysis_courses = [
            {
                "id_hint": "",
                "title": completed or "学习材料",
                "summary_zh": media_file_summary(ocr_text, candidates),
                "completed": completed,
                "learned": [candidate["item"] for candidate in candidates],
                "review_cards": candidates,
            }
        ]
        checkin_text = build_media_checkin_text(file_names, ocr_text, slot, completed)
    parsed = coach.parse_checkin_text(checkin_text)
    coach.append_checkin(parsed, date_value, checkins_path)
    updated = items
    changes = {"updated": [], "added": []}
    for index, course_analysis in enumerate(analysis_courses):
        course_id = analysis_course_id(course_analysis, date_value, index)
        candidates = ai_review_candidates(course_analysis)
        selected_items = analysis_selected_items(course_analysis, candidates)
        updated, course_changes = upsert_media_review_candidates(
            updated,
            candidates,
            date_value,
            course_id=course_id,
        )
        changes["updated"].extend(course_changes["updated"])
        changes["added"].extend(course_changes["added"])
        card_ids = []
        for candidate in candidates:
            item_index = coach.find_item_index(updated, candidate["item"])
            if item_index is not None:
                card_ids.append(updated[item_index]["id"])
        selected_card_ids = []
        for selected_item in selected_items:
            item_index = coach.find_item_index(updated, selected_item)
            if item_index is not None:
                selected_card_ids.append(updated[item_index]["id"])
        courses = upsert_course_record(
            courses,
            course_id,
            course_analysis,
            file_names,
            date_value,
            card_ids,
            selected_card_ids,
        )
    coach.save_items(updated, state_path)
    course_store.save_courses(courses, resolved_courses_path)
    summary = coach.summarize_checkin(parsed)
    note_path = coach.append_daily_note(parsed, summary, date_value, notes_dir)
    return {
        "summary": summary,
        "changes": changes,
        "note_path": str(note_path),
        "checkin_text": checkin_text,
        "ocr_text": ocr_text,
        "ai_used": bool(ai_analysis),
        "ai_analysis": ai_analysis or {},
        "dashboard": dashboard_payload(
            date_value,
            state_path,
            checkins_path,
            notes_dir,
            courses_path=resolved_courses_path,
        ),
    }


def iso_datetime_now() -> str:
    return dt.datetime.now().replace(microsecond=0).isoformat()


def new_codex_job_id(date_text: str) -> str:
    return f"{date_text}-{uuid.uuid4().hex[:8]}"


def record_codex_media_job(
    saved_files: list[dict[str, Any]],
    ocr_text: str,
    on_date: str | Any,
    slot: str = "今日学习",
    completed: str = "截图/录屏学习文件整理",
    inbox_dir: Path = CODEX_INBOX_DIR,
    job_id: str | None = None,
) -> dict[str, Any]:
    if isinstance(on_date, str):
        date_text = on_date
    else:
        date_text = on_date.isoformat()
    job_id = job_id or new_codex_job_id(date_text)
    job_dir = inbox_dir / date_text / job_id
    files_dir = job_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    copied_files: list[dict[str, Any]] = []
    for file_info in saved_files:
        source_path = Path(str(file_info.get("path", "")))
        file_name = safe_upload_name(str(file_info.get("name") or source_path.name))
        target_path = files_dir / file_name
        counter = 2
        while target_path.exists():
            target_path = files_dir / f"{target_path.stem}-{counter}{target_path.suffix}"
            counter += 1
        shutil.copy2(source_path, target_path)
        copied_files.append(
            {
                "name": file_name,
                "path": str(target_path),
                "content_type": file_info.get("content_type", ""),
                "generated_from": file_info.get("generated_from", ""),
            }
        )
    manifest = {
        "id": job_id,
        "status": "pending",
        "created_at": iso_datetime_now(),
        "date": date_text,
        "slot": slot or "今日学习",
        "completed": completed or "截图/录屏学习文件整理",
        "files": copied_files,
        "ocr_available": bool(ocr_text.strip()),
        "ocr_text": ocr_text,
        "codex_instruction": "已进入 Codex 自动整理队列，等待自动整理器处理。",
    }
    manifest_path = job_dir / "job.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    index_path = inbox_dir / "index.jsonl"
    with index_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"id": job_id, "date": date_text, "manifest_path": str(manifest_path)}, ensure_ascii=False))
        handle.write("\n")
    return {
        "job_id": job_id,
        "job_dir": str(job_dir),
        "manifest_path": str(manifest_path),
        "files": copied_files,
        "ocr_available": bool(ocr_text.strip()),
        "codex_instruction": manifest["codex_instruction"],
    }


def read_codex_media_manifest(manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["manifest_path"] = str(manifest_path)
    manifest["job_dir"] = str(manifest_path.parent)
    return manifest


def pending_codex_media_jobs(inbox_dir: Path = CODEX_INBOX_DIR) -> list[dict[str, Any]]:
    if not inbox_dir.exists():
        return []
    pending: list[dict[str, Any]] = []
    for manifest_path in inbox_dir.glob("*/**/job.json"):
        try:
            manifest = read_codex_media_manifest(manifest_path)
        except (json.JSONDecodeError, OSError):
            continue
        if manifest.get("status") == "pending":
            pending.append(manifest)
    return sorted(pending, key=lambda item: str(item.get("created_at") or ""))


def complete_codex_media_job(
    manifest_path: Path,
    ai_analysis: dict[str, Any] | None = None,
    state_path: Path = coach.DEFAULT_STATE,
    checkins_path: Path = coach.DEFAULT_CHECKINS,
    notes_dir: Path = coach.DEFAULT_NOTES_DIR,
    courses_path: Path | None = None,
) -> dict[str, Any]:
    manifest = read_codex_media_manifest(manifest_path)
    if manifest.get("status") != "pending":
        return {
            "job_id": manifest.get("id", ""),
            "status": manifest.get("status", ""),
            "manifest_path": str(manifest_path),
            "skipped": True,
        }
    files = manifest.get("files", [])
    file_names = [
        str(file_info.get("name") or Path(str(file_info.get("path", ""))).name)
        for file_info in files
        if not file_info.get("generated_from")
    ]
    result = record_media_learning_from_ocr(
        file_names,
        str(manifest.get("ocr_text") or ""),
        str(manifest.get("date") or dt.date.today().isoformat()),
        slot=str(manifest.get("slot") or "今日学习"),
        completed=str(manifest.get("completed") or "截图/录屏学习文件整理"),
        state_path=state_path,
        checkins_path=checkins_path,
        notes_dir=notes_dir,
        ai_analysis=ai_analysis,
        courses_path=courses_path,
    )
    manifest.update(
        {
            "status": "completed",
            "completed_at": iso_datetime_now(),
            "note_path": result["note_path"],
            "summary": result["summary"],
            "changes": result["changes"],
            "ai_used": bool(ai_analysis),
            "ai_analysis": ai_analysis or {},
        }
    )
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "job_id": manifest.get("id", ""),
        "status": "completed",
        "manifest_path": str(manifest_path),
        "note_path": result["note_path"],
        "changes": result["changes"],
        "ai_used": bool(ai_analysis),
    }


def find_codex_media_job(job_id: str, inbox_dir: Path = CODEX_INBOX_DIR) -> dict[str, Any] | None:
    safe_job_id = safe_upload_name(job_id)
    if not safe_job_id or not inbox_dir.exists():
        return None
    for manifest_path in inbox_dir.glob(f"*/{safe_job_id}/job.json"):
        try:
            return read_codex_media_manifest(manifest_path)
        except (json.JSONDecodeError, OSError):
            return None
    return None


def codex_cli_path() -> str:
    configured = config_value("ENGLISH_COACH_CODEX_BIN")
    candidates = [
        configured,
        shutil.which("codex") or "",
        "/Users/y/.local/bin/codex",
    ]
    for candidate in candidates:
        if candidate and os.access(candidate, os.X_OK):
            return candidate
    return ""


def codex_media_job_prompt(manifest_path: Path) -> str:
    return "\n".join(
        [
            "你是用户英语学习平台的上传整理器。只处理下面这个英语学习截图 job。",
            f"manifest_path: {manifest_path}",
            "",
            "工作要求：",
            "1. 读取 job.json，结合 OCR 文本和随本次 prompt 附带的图片理解学习内容。",
            "2. 生成一个 JSON 对象，顶层字段必须是 courses。",
            "3. 先按实际课程拆分；录屏包含多节课时，必须输出多个课程，不要压成一门总课。",
            "4. courses 每条包含 id_hint、title、summary_zh、learned、full_content、selected_content。",
            "5. 每门课程的 full_content 是完整内容：保留所有可确认的英文句子、对话句、定义、例句和独立词汇，不要提炼重点，不要限制为 10 条。",
            "6. full_content 每条包含 item、prompt、example、note；prompt 只能是完整中文意思；example 是默认隐藏的英文参考句；不确定不要编造。",
            "7. selected_content 是核心必会内容，通常选 full_content 的 20%–35%；每个值必须与 full_content 的某个 item 完全一致，不得新增或改写。",
            "8. 用 stdin 调用：python3 tools/codex_inbox.py complete --manifest \"<manifest_path>\" --analysis -",
            "9. 不要修改无关文件，不要启动 Web 服务。完成后最终回复一句话说明 note_path、完整卡数量和精选卡数量。",
        ]
    )


def codex_media_job_command(
    manifest_path: Path,
    manifest: dict[str, Any],
    codex_bin: str | None = None,
    output_last_path: Path | None = None,
) -> list[str]:
    command = [
        codex_bin or codex_cli_path(),
        "exec",
        "--skip-git-repo-check",
        "-C",
        str(ROOT),
        "--sandbox",
        "danger-full-access",
        "--ask-for-approval",
        "never",
    ]
    if output_last_path:
        command.extend(["--output-last-message", str(output_last_path)])
    for file_info in manifest.get("files", []):
        path = Path(str(file_info.get("path", "")))
        if path.exists() and path.suffix.lower() in IMAGE_SUFFIXES:
            command.extend(["-i", str(path)])
    command.append(codex_media_job_prompt(manifest_path))
    return command


def spawn_codex_media_processor(manifest_path: Path) -> dict[str, Any]:
    manifest = read_codex_media_manifest(manifest_path)
    codex_bin = codex_cli_path()
    if not codex_bin:
        return {
            "started": False,
            "mode": "codex_exec",
            "error": "codex CLI not found",
        }
    CODEX_AUTO_LOG_DIR.mkdir(parents=True, exist_ok=True)
    job_id = str(manifest.get("id") or manifest_path.parent.name)
    out_path = CODEX_AUTO_LOG_DIR / f"{job_id}.out.log"
    err_path = CODEX_AUTO_LOG_DIR / f"{job_id}.err.log"
    last_path = CODEX_AUTO_LOG_DIR / f"{job_id}.last.txt"
    command = codex_media_job_command(manifest_path, manifest, codex_bin=codex_bin, output_last_path=last_path)
    env = {
        **os.environ,
        "PATH": f"{Path(codex_bin).parent}:{os.environ.get('PATH', '')}",
    }
    with out_path.open("ab") as stdout, err_path.open("ab") as stderr:
        process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            env=env,
            start_new_session=True,
        )
    manifest["processor"] = {
        "mode": "codex_exec",
        "started": True,
        "started_at": iso_datetime_now(),
        "pid": process.pid,
        "stdout": str(out_path),
        "stderr": str(err_path),
        "last_message": str(last_path),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest["processor"]


def safe_upload_name(filename: str) -> str:
    name = Path(filename or "upload").name
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._")
    return safe or "upload"


def multipart_value(form: cgi.FieldStorage, key: str, default: str = "") -> str:
    if key not in form:
        return default
    value = form[key]
    if isinstance(value, list):
        value = value[0]
    return str(value.value or "").strip()


def multipart_files(form: cgi.FieldStorage, key: str = "files") -> list[cgi.FieldStorage]:
    if key not in form:
        return []
    value = form[key]
    values = value if isinstance(value, list) else [value]
    return [item for item in values if getattr(item, "filename", None)]


def read_multipart_form(handler: BaseHTTPRequestHandler) -> cgi.FieldStorage:
    return cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": handler.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": handler.headers.get("Content-Length", "0"),
        },
    )


def save_media_uploads(
    form: cgi.FieldStorage,
    date_text: str,
    upload_dir: Path = UPLOAD_DIR,
) -> list[dict[str, Any]]:
    target_dir = upload_dir / date_text
    target_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    for file_field in multipart_files(form):
        original_name = safe_upload_name(file_field.filename)
        target_path = target_dir / original_name
        counter = 2
        while target_path.exists():
            target_path = target_dir / f"{target_path.stem}-{counter}{target_path.suffix}"
            counter += 1
        with target_path.open("wb") as handle:
            shutil.copyfileobj(file_field.file, handle)
        saved.append(
            {
                "name": original_name,
                "path": str(target_path),
                "content_type": getattr(file_field, "type", "") or "",
            }
        )
    return saved


def extract_video_frames(path: Path, frame_count: int = 12) -> list[Path]:
    if path.suffix.lower() not in VIDEO_SUFFIXES or not VIDEO_FRAME_SCRIPT.exists():
        return []
    output_dir = path.parent / f".{path.stem}-frames-{uuid.uuid4().hex[:8]}"
    try:
        result = subprocess.run(
            ["swift", str(VIDEO_FRAME_SCRIPT), str(path), str(output_dir), str(frame_count)],
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        shutil.rmtree(output_dir, ignore_errors=True)
        return []
    if result.returncode != 0:
        shutil.rmtree(output_dir, ignore_errors=True)
        return []
    frames = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
    return [frame for frame in frames if frame.exists() and frame.suffix.lower() in IMAGE_SUFFIXES]


def prepare_uploaded_media(saved_files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared = [dict(file_info) for file_info in saved_files]
    for file_info in saved_files:
        source_path = Path(str(file_info.get("path", "")))
        if source_path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        frames = extract_video_frames(source_path)
        for index, frame_path in enumerate(frames, start=1):
            prepared.append(
                {
                    "name": f"{source_path.stem}-frame-{index:03d}.jpg",
                    "path": str(frame_path),
                    "content_type": "image/jpeg",
                    "generated_from": str(file_info.get("name") or source_path.name),
                }
            )
    return prepared


def ocr_image_file(path: Path) -> str:
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        return ""
    if not OCR_SCRIPT.exists():
        return ""
    try:
        result = subprocess.run(
            ["swift", str(OCR_SCRIPT), str(path)],
            text=True,
            capture_output=True,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def ocr_uploaded_files(saved_files: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for file_info in saved_files:
        text = ocr_image_file(Path(file_info["path"]))
        if text:
            chunks.append(f"## {file_info['name']}\n{text}")
    return "\n\n".join(chunks)


def cleanup_saved_files(saved_files: list[dict[str, Any]]) -> None:
    if keep_uploads_enabled():
        return
    for file_info in saved_files:
        path = Path(str(file_info.get("path", "")))
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        if file_info.get("generated_from"):
            try:
                path.parent.rmdir()
            except OSError:
                pass


def dashboard_review_cards(items: list[dict[str, Any]], date_value: Any, study_note: dict[str, Any]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    priority_terms = {
        value.strip().lower()
        for value in study_note.get("weak", []) + study_note.get("learned", [])
        if value.strip()
    }
    for item in coach.due_items(items, date_value):
        item_id = item.get("id", "")
        if item_id:
            cards.append(review_card(item))
            seen.add(item_id)
    for item in items:
        item_id = item.get("id", "")
        item_text = str(item.get("item", "")).strip().lower()
        if item_id in seen or item_text not in priority_terms:
            continue
        cards.append(review_card(item))
        seen.add(item_id)
    return cards


def completed_review_cards(items: list[dict[str, Any]], date_value: Any) -> list[dict[str, Any]]:
    completed = []
    date_text = date_value.isoformat()
    for item in items:
        today_history = [
            entry
            for entry in item.get("history", [])
            if entry.get("date") == date_text
        ]
        if not today_history:
            continue
        card = review_card(item)
        card["completed_result"] = today_history[-1].get("result", item.get("last_result", ""))
        completed.append(card)
    return sorted(completed, key=lambda card: (card.get("completed_result", ""), card.get("id", "")))


def dashboard_payload(
    on_date: str | Any,
    state_path: Path = coach.DEFAULT_STATE,
    checkins_path: Path = coach.DEFAULT_CHECKINS,
    notes_dir: Path = coach.DEFAULT_NOTES_DIR,
    courses_path: Path = course_store.DEFAULT_COURSES,
) -> dict[str, Any]:
    if isinstance(on_date, str):
        date_value = coach.parse_date(on_date)
    else:
        date_value = on_date

    items = load_state_items(state_path)
    checkins = [
        record
        for record in coach.load_checkins(checkins_path)
        if record.get("date") == date_value.isoformat()
    ]
    note_path = notes_dir / f"{date_value.isoformat()}.md"
    note_content = note_path.read_text(encoding="utf-8") if note_path.exists() else ""
    study_note = parse_study_note(note_content)
    course_aggregates = course_store.group_cards_by_course(
        items,
        course_store.load_courses(courses_path),
        date_value,
    )
    course_payloads = []
    for course in course_aggregates:
        payload = {
            key: value
            for key, value in course.items()
            if key not in {
                "cards",
                "due_cards",
                "selected_cards",
                "selected_due_cards",
            }
        }
        payload["all_cards"] = [review_card(item) for item in course["cards"]]
        payload["full_content"] = payload["all_cards"]
        payload["today_cards"] = [review_card(item) for item in course["due_cards"]]
        payload["selected_cards"] = [
            review_card(item) for item in course["selected_cards"]
        ]
        payload["selected_content"] = payload["selected_cards"]
        payload["selected_today_cards"] = [
            review_card(item) for item in course["selected_due_cards"]
        ]
        course_payloads.append(payload)
    course_payloads.sort(
        key=lambda course: (
            float(course.get("priority_mastery_score", course.get("mastery_score", 0))),
            -int(course.get("due_count", 0)),
            int(course.get("order", 9999)),
            str(course.get("title", "")),
        )
    )
    recent_notes = []
    if notes_dir.exists():
        for path in sorted(notes_dir.glob("*.md"), reverse=True)[:14]:
            recent_notes.append(
                {
                    "date": path.stem,
                    "path": str(path),
                    "has_note": path.stat().st_size > 0,
                }
            )

    return {
        "date": date_value.isoformat(),
        "note": {
            "exists": note_path.exists(),
            "path": str(note_path),
            "content": note_content,
        },
        "study_note": study_note,
        "courses": course_payloads,
        "due_reviews": coach.due_items(items, date_value),
        "review_cards": dashboard_review_cards(items, date_value, study_note),
        "completed_reviews": completed_review_cards(items, date_value),
        "checkins": checkins,
        "recent_notes": recent_notes,
    }


def is_loopback_address(address: str) -> bool:
    try:
        return ipaddress.ip_address(str(address).split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def sync_state_payload(
    courses_path: Path = course_store.DEFAULT_COURSES,
    state_path: Path = coach.DEFAULT_STATE,
) -> dict[str, Any]:
    return {
        "courses": course_store.load_courses(courses_path),
        "review_items": load_state_items(state_path),
    }


def validate_sync_state_payload(payload: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise ValueError("sync state must be a JSON object")
    courses = payload.get("courses")
    review_items = payload.get("review_items")
    if not isinstance(courses, list) or not isinstance(review_items, list):
        raise ValueError("courses and review_items must be arrays")
    if not all(isinstance(course, dict) for course in courses):
        raise ValueError("every course must be an object")
    if not all(isinstance(item, dict) for item in review_items):
        raise ValueError("every review item must be an object")

    course_ids = [str(course.get("id") or "").strip() for course in courses]
    if any(not course_id for course_id in course_ids):
        raise ValueError("every course must have a non-empty id")
    if len(set(course_ids)) != len(course_ids):
        raise ValueError("course ids must be unique")

    item_ids = [str(item.get("id") or "").strip() for item in review_items]
    if any(not item_id for item_id in item_ids):
        raise ValueError("every review item must have a non-empty id")
    if len(set(item_ids)) != len(item_ids):
        raise ValueError("review item ids must be unique")

    known_course_ids = set(course_ids)
    for item in review_items:
        course_id = str(item.get("course_id") or "").strip()
        if not course_id or course_id not in known_course_ids:
            raise ValueError(f"review item {item.get('id', '')} has an unknown course_id")
    for course in courses:
        card_ids = course.get("card_ids", [])
        if not isinstance(card_ids, list) or any(
            not isinstance(card_id, str) or not card_id.strip()
            for card_id in card_ids
        ):
            raise ValueError(f"course {course.get('id', '')} card_ids must be an array of ids")
        if "selected_card_ids" in course:
            selected_ids = course.get("selected_card_ids", [])
            if not isinstance(selected_ids, list) or any(
                not isinstance(card_id, str) or not card_id.strip()
                for card_id in selected_ids
            ):
                raise ValueError(
                    f"course {course.get('id', '')} selected_card_ids must be an array of ids"
                )
            unknown_selected_ids = [card_id for card_id in selected_ids if card_id not in card_ids]
            if unknown_selected_ids:
                raise ValueError(
                    f"course {course.get('id', '')} selected_card_ids must be a subset of card_ids"
                )

    return courses, review_items


def save_sync_state(
    payload: Any,
    courses_path: Path = course_store.DEFAULT_COURSES,
    state_path: Path = coach.DEFAULT_STATE,
    backups_dir: Path | None = None,
    timestamp: dt.datetime | None = None,
) -> dict[str, Any]:
    courses, review_items = validate_sync_state_payload(payload)
    resolved_backups_dir = backups_dir or state_path.parent / "backups"
    timestamp_value = timestamp or dt.datetime.now()
    backup_dir = resolved_backups_dir / f"sync-state-{timestamp_value.strftime('%Y%m%d-%H%M%S-%f')}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    if courses_path.exists():
        shutil.copy2(courses_path, backup_dir / "courses.json")
    if state_path.exists():
        shutil.copy2(state_path, backup_dir / "review-items.json")
    course_store.save_courses(courses, courses_path)
    coach.save_items(review_items, state_path)
    return {
        "saved": True,
        "course_count": len(courses),
        "review_item_count": len(review_items),
        "backup_path": str(backup_dir),
    }


def record_checkin_text(
    text: str,
    on_date: str | Any,
    state_path: Path = coach.DEFAULT_STATE,
    checkins_path: Path = coach.DEFAULT_CHECKINS,
    notes_dir: Path = coach.DEFAULT_NOTES_DIR,
) -> dict[str, Any]:
    if isinstance(on_date, str):
        date_value = coach.parse_date(on_date)
    else:
        date_value = on_date

    items = load_state_items(state_path)
    parsed = coach.parse_checkin_text(text)
    coach.append_checkin(parsed, date_value, checkins_path)
    updated, changes = coach.apply_checkin_to_items(items, parsed, date_value)
    coach.save_items(updated, state_path)
    summary = coach.summarize_checkin(parsed)
    note_path = coach.append_daily_note(parsed, summary, date_value, notes_dir)
    return {
        "summary": summary,
        "changes": changes,
        "note_path": str(note_path),
        "dashboard": dashboard_payload(date_value, state_path, checkins_path, notes_dir),
    }


def record_review_result(
    item_id: str,
    result: str,
    on_date: str | Any,
    state_path: Path = coach.DEFAULT_STATE,
) -> dict[str, Any]:
    if isinstance(on_date, str):
        date_value = coach.parse_date(on_date)
    else:
        date_value = on_date
    items = load_state_items(state_path)
    updated = coach.update_item_result(items, item_id, result, date_value)
    coach.save_items(updated, state_path)
    changed = next(item for item in updated if item["id"] == item_id)
    return {"item": changed, "card": review_card(changed)}


class CoachRequestHandler(BaseHTTPRequestHandler):
    server_version = "EnglishCoachDashboard/1.0"

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(
        self, body: str, content_type: str, status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
            runtime_config = json.dumps(
                {
                    "supabaseUrl": config_value("VITE_SUPABASE_URL"),
                    "supabasePublishableKey": config_value("VITE_SUPABASE_PUBLISHABLE_KEY"),
                },
                ensure_ascii=False,
            ).replace("<", "\\u003c")
            html = html.replace(
                "</head>",
                f"<script>window.ENGLISH_COACH_CONFIG = Object.freeze({runtime_config});</script>\n</head>",
                1,
            )
            self.send_text(html, "text/html; charset=utf-8")
            return
        if parsed.path == "/assets/app.css":
            self.send_text(
                (WEB_DIR / "assets" / "app.css").read_text(encoding="utf-8"),
                "text/css; charset=utf-8",
            )
            return
        if parsed.path == "/assets/app.js":
            self.send_text(
                (WEB_DIR / "assets" / "app.js").read_text(encoding="utf-8"),
                "application/javascript; charset=utf-8",
            )
            return
        if parsed.path in {"/assets/workspace-core.js", "/assets/cloud-sync.js"}:
            asset_path = WEB_DIR / "assets" / Path(parsed.path).name
            self.send_text(
                asset_path.read_text(encoding="utf-8"),
                "application/javascript; charset=utf-8",
            )
            return
        if parsed.path == "/api/sync-state":
            if not is_loopback_address(self.client_address[0]):
                self.send_json({"error": "loopback access required"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(sync_state_payload())
            return
        if parsed.path == "/api/dashboard":
            query = parse_qs(parsed.query)
            date_value = query.get("date", [coach.today().isoformat()])[0]
            self.send_json(dashboard_payload(date_value))
            return
        if parsed.path == "/api/codex-job-status":
            query = parse_qs(parsed.query)
            job_id = query.get("id", [""])[0]
            if not job_id:
                self.send_json({"error": "id is required"}, HTTPStatus.BAD_REQUEST)
                return
            manifest = find_codex_media_job(job_id)
            if not manifest:
                self.send_json({"error": "job not found"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json(
                {
                    "job_id": manifest.get("id", ""),
                    "status": manifest.get("status", ""),
                    "created_at": manifest.get("created_at", ""),
                    "completed_at": manifest.get("completed_at", ""),
                    "note_path": manifest.get("note_path", ""),
                    "summary": manifest.get("summary", {}),
                    "changes": manifest.get("changes", {}),
                    "processor": manifest.get("processor", {}),
                }
            )
            return
        self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/sync-state":
            if not is_loopback_address(self.client_address[0]):
                self.send_json({"error": "loopback access required"}, HTTPStatus.FORBIDDEN)
                return
            try:
                self.send_json(save_sync_state(read_json_body(self)))
            except (json.JSONDecodeError, ValueError) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/checkin":
            body = read_json_body(self)
            text = str(body.get("text", "")).strip()
            date_value = str(body.get("date") or coach.today().isoformat())
            if not text:
                self.send_json({"error": "text is required"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json(record_checkin_text(text, date_value))
            return
        if parsed.path == "/api/review-result":
            body = read_json_body(self)
            item_id = str(body.get("item_id", "")).strip()
            result = str(body.get("result", "")).strip()
            date_value = str(body.get("date") or coach.today().isoformat())
            if not item_id or result not in {"pass", "shaky", "fail"}:
                self.send_json({"error": "item_id and valid result are required"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json(record_review_result(item_id, result, date_value))
            return
        if parsed.path == "/api/media-checkin":
            self.send_json(
                {
                    "error": "media_checkin_disabled",
                    "message": "旧文件整理接口已停用，请使用 /api/codex-media-inbox。",
                },
                HTTPStatus.GONE,
            )
            return
        if parsed.path == "/api/codex-media-inbox":
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data"):
                self.send_json({"error": "multipart/form-data is required"}, HTTPStatus.BAD_REQUEST)
                return
            form = read_multipart_form(self)
            date_value = multipart_value(form, "date", coach.today().isoformat())
            slot = multipart_value(form, "slot", "今日学习")
            completed = multipart_value(form, "completed", "截图/录屏学习文件整理")
            saved_files = save_media_uploads(form, date_value)
            if not saved_files:
                self.send_json({"error": "files are required"}, HTTPStatus.BAD_REQUEST)
                return
            prepared_files = prepare_uploaded_media(saved_files)
            try:
                ocr_text = ocr_uploaded_files(prepared_files)
                result = record_codex_media_job(
                    prepared_files,
                    ocr_text,
                    date_value,
                    slot=slot,
                    completed=completed,
                )
                result["processor"] = spawn_codex_media_processor(Path(result["manifest_path"]))
                self.send_json(result)
            finally:
                cleanup_saved_files(prepared_files)
            return
        if parsed.path == "/api/translate":
            body = read_json_body(self)
            text = str(body.get("text", "")).strip()
            if not text:
                self.send_json({"error": "text is required"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json(translate_text(text))
            return
        self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the English coach dashboard.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    server = ThreadingHTTPServer((args.host, args.port), CoachRequestHandler)
    print(f"English Coach dashboard: http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
