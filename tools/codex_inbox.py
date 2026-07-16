#!/usr/bin/env python3
"""Manage Codex media inbox jobs for the English coach dashboard."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WEB_SERVER_PATH = Path(__file__).with_name("web_server.py")

spec = importlib.util.spec_from_file_location("web_server", WEB_SERVER_PATH)
web_server = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(web_server)


def json_dump(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def load_analysis(raw_path: str) -> dict[str, Any]:
    if not raw_path:
        return {}
    if raw_path == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(raw_path).read_text(encoding="utf-8")
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise SystemExit("analysis JSON must be an object")
    return payload


def cmd_pending(args: argparse.Namespace) -> None:
    jobs = web_server.pending_codex_media_jobs(Path(args.inbox_dir))
    if args.limit:
        jobs = jobs[: args.limit]
    json_dump(
        [
            {
                "id": job.get("id", ""),
                "created_at": job.get("created_at", ""),
                "date": job.get("date", ""),
                "slot": job.get("slot", ""),
                "completed": job.get("completed", ""),
                "manifest_path": job.get("manifest_path", ""),
                "job_dir": job.get("job_dir", ""),
                "files": job.get("files", []),
                "ocr_available": job.get("ocr_available", False),
                "ocr_text": job.get("ocr_text", ""),
            }
            for job in jobs
        ]
    )


def cmd_complete(args: argparse.Namespace) -> None:
    analysis = load_analysis(args.analysis)
    result = web_server.complete_codex_media_job(
        Path(args.manifest),
        ai_analysis=analysis or None,
    )
    json_dump(result)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage English Coach Codex inbox jobs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    pending = subparsers.add_parser("pending", help="List pending Codex media jobs.")
    pending.add_argument("--inbox-dir", default=str(web_server.CODEX_INBOX_DIR))
    pending.add_argument("--limit", type=int, default=0)
    pending.set_defaults(func=cmd_pending)

    complete = subparsers.add_parser("complete", help="Complete a Codex media job.")
    complete.add_argument("--manifest", required=True)
    complete.add_argument("--analysis", default="", help="Path to Codex-generated analysis JSON, or '-' for stdin.")
    complete.set_defaults(func=cmd_complete)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
