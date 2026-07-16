import datetime as dt
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
COACH_PATH = ROOT / "tools" / "coach.py"
WEB_SERVER_PATH = ROOT / "tools" / "web_server.py"
COURSE_STORE_PATH = ROOT / "tools" / "course_store.py"


def load_coach():
    spec = importlib.util.spec_from_file_location("coach", COACH_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_web_server():
    spec = importlib.util.spec_from_file_location("web_server", WEB_SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_course_store():
    spec = importlib.util.spec_from_file_location("course_store", COURSE_STORE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sample_items():
    return [
        {
            "id": "confirm-understanding",
            "item": "Let me confirm my understanding.",
            "next_due": "2026-06-30",
            "interval_days": 1,
            "last_result": "pending",
            "history": [],
        },
        {
            "id": "deliver-friday",
            "item": "We can deliver it by Friday.",
            "next_due": "2026-07-04",
            "interval_days": 4,
            "last_result": "pass",
            "history": [],
        },
    ]


class CoachTests(unittest.TestCase):
    def test_group_cards_by_course_builds_due_and_completed_counts(self):
        course_store = load_course_store()
        courses = [
            {
                "id": "louvre",
                "title": "卢浮宫",
                "summary_zh": "参观卢浮宫的实用英语。",
                "card_ids": ["a", "b"],
                "selected_card_ids": ["a"],
                "learned_on": "2026-07-05",
                "source_files": ["IMG_1801.PNG"],
            }
        ]
        items = [
            {
                "id": "a",
                "course_id": "louvre",
                "item": "The museum opens at nine.",
                "next_due": "2026-07-11",
                "status": "needs_review",
                "last_result": "shaky",
                "history": [],
            },
            {
                "id": "b",
                "course_id": "louvre",
                "item": "I can't believe it.",
                "next_due": "2026-07-12",
                "status": "reviewing",
                "last_result": "pass",
                "history": [{"date": "2026-07-11", "result": "pass"}],
            },
        ]

        result = course_store.group_cards_by_course(items, courses, dt.date(2026, 7, 11))

        self.assertEqual(result[0]["due_count"], 1)
        self.assertEqual(result[0]["completed_today"], 1)
        self.assertEqual(result[0]["total_count"], 2)
        self.assertEqual(result[0]["mastered_count"], 1)
        self.assertIsInstance(result[0]["mastery_score"], float)
        self.assertIn(result[0]["mastery_label"], {"学习中", "较熟悉"})
        self.assertEqual([card["id"] for card in result[0]["cards"]], ["a", "b"])
        self.assertEqual([card["id"] for card in result[0]["selected_cards"]], ["a"])
        self.assertEqual(result[0]["selected_total_count"], 1)
        self.assertEqual(result[0]["selected_due_count"], 1)
        self.assertEqual(result[0]["priority_mastery_score"], result[0]["selected_mastery_score"])

    def test_course_mastery_score_uses_result_interval_and_history(self):
        course_store = load_course_store()
        courses = [{"id": "mixed", "title": "混合课程", "card_ids": ["new", "fail", "shaky", "pass"]}]
        items = [
            {
                "id": "new",
                "course_id": "mixed",
                "status": "new",
                "last_result": "pending",
                "interval_days": 1,
                "next_due": "2026-07-11",
                "history": [],
            },
            {
                "id": "fail",
                "course_id": "mixed",
                "status": "needs_review",
                "last_result": "fail",
                "interval_days": 1,
                "next_due": "2026-07-11",
                "history": [{"date": "2026-07-10", "result": "fail"}],
            },
            {
                "id": "shaky",
                "course_id": "mixed",
                "status": "needs_review",
                "last_result": "shaky",
                "interval_days": 1,
                "next_due": "2026-07-11",
                "history": [
                    {"date": "2026-07-09", "result": "pass"},
                    {"date": "2026-07-10", "result": "shaky"},
                ],
            },
            {
                "id": "pass",
                "course_id": "mixed",
                "status": "reviewing",
                "last_result": "pass",
                "interval_days": 30,
                "next_due": "2026-08-10",
                "history": [
                    {"date": "2026-07-01", "result": "pass"},
                    {"date": "2026-07-10", "result": "pass"},
                ],
            },
        ]

        result = course_store.group_cards_by_course(items, courses, dt.date(2026, 7, 11))[0]

        self.assertEqual(course_store.card_mastery_score(items[0]), 0.0)
        self.assertEqual(course_store.card_mastery_score(items[1]), 5.2)
        self.assertEqual(course_store.card_mastery_score(items[2]), 32.8)
        self.assertEqual(course_store.card_mastery_score(items[3]), 100.0)
        self.assertEqual(result["mastery_score"], 34.5)
        self.assertEqual(result["mastery_label"], "不熟悉")

    def test_course_state_has_no_orphan_review_cards(self):
        course_store = load_course_store()
        courses = course_store.load_courses()
        items = json.loads((ROOT / "state" / "review-items.json").read_text(encoding="utf-8"))
        course_ids = {course["id"] for course in courses}

        self.assertTrue(courses)
        self.assertTrue(all(item.get("course_id") in course_ids for item in items))

    def test_normal_video_is_split_into_six_complete_courses(self):
        courses = json.loads((ROOT / "state" / "courses.json").read_text(encoding="utf-8"))
        items = json.loads((ROOT / "state" / "review-items.json").read_text(encoding="utf-8"))
        video_courses = [
            course
            for course in courses
            if "normal_video.mp4" in course.get("source_files", [])
        ]
        video_course_ids = {course["id"] for course in video_courses}
        video_items = [item for item in items if item.get("course_id") in video_course_ids]

        self.assertEqual(len(video_courses), 6)
        self.assertEqual(len(video_items), 111)
        self.assertEqual(sum(len(course.get("selected_card_ids", [])) for course in video_courses), 24)
        self.assertEqual(
            {course["id"]: len(course.get("selected_card_ids", [])) for course in video_courses},
            {
                "pet-food-safety": 6,
                "pet-supplies": 3,
                "pet-grooming-and-attachment": 5,
                "puppy-habits": 2,
                "lets-get-a-puppy-speaking": 6,
                "pet-decision-and-care": 2,
            },
        )
        self.assertTrue(
            all(
                set(course.get("selected_card_ids", [])).issubset(course.get("card_ids", []))
                for course in video_courses
            )
        )
        self.assertTrue(all(str(item.get("prompt") or "").strip() for item in video_items))
        self.assertIn("lets-get-a-puppy-speaking", video_course_ids)
        self.assertIn(
            "A cage is a place with bars where animals are kept.",
            {item["item"] for item in video_items},
        )
        self.assertIn(
            "I can help you with the training.",
            {item["item"] for item in video_items},
        )

    def test_due_items_include_past_and_today_sorted_by_due_date(self):
        coach = load_coach()
        items = sample_items() + [
            {
                "id": "old-blocker",
                "item": "The current blocker is ...",
                "next_due": "2026-06-28",
                "interval_days": 1,
                "last_result": "fail",
                "history": [],
            }
        ]

        due = coach.due_items(items, dt.date(2026, 6, 30))

        self.assertEqual([item["id"] for item in due], ["old-blocker", "confirm-understanding"])

    def test_pass_result_extends_review_interval(self):
        coach = load_coach()
        item = sample_items()[0]

        updated = coach.record_result(item, "pass", dt.date(2026, 6, 30))

        self.assertEqual(updated["last_result"], "pass")
        self.assertEqual(updated["interval_days"], 2)
        self.assertEqual(updated["next_due"], "2026-07-02")
        self.assertEqual(updated["history"][-1]["result"], "pass")

    def test_fail_result_resets_review_interval_to_tomorrow(self):
        coach = load_coach()
        item = sample_items()[1]

        updated = coach.record_result(item, "fail", dt.date(2026, 7, 4))

        self.assertEqual(updated["last_result"], "fail")
        self.assertEqual(updated["interval_days"], 1)
        self.assertEqual(updated["next_due"], "2026-07-05")

    def test_slot_for_time_avoids_speaking_outside_night_practice(self):
        coach = load_coach()

        morning = coach.slot_for_time(dt.time(7, 50))
        night = coach.slot_for_time(dt.time(21, 30))

        self.assertFalse(morning["can_speak"])
        self.assertIn("无需开口", morning["instruction"])
        self.assertTrue(night["can_speak"])
        self.assertIn("可以开口", night["instruction"])

    def test_render_profile_lists_personalization_questions(self):
        coach = load_coach()
        profile = {
            "goal": "客户英语沟通 Level 4",
            "schedule": {"morning": "08:30", "noon": "12:30", "evening": "18:30", "night": "21:30"},
            "questions": [
                "当前流利说等级/定级结果？",
                "最常见的客户沟通场景？",
            ],
        }

        output = coach.render_profile(profile)

        self.assertIn("客户英语沟通 Level 4", output)
        self.assertIn("08:30", output)
        self.assertIn("当前流利说等级", output)
        self.assertIn("最常见的客户沟通场景", output)

    def test_profile_command_does_not_require_date(self):
        result = subprocess.run(
            ["python3", str(COACH_PATH), "profile"],
            cwd=ROOT.parent,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("个性化信息", result.stdout)

    def test_render_task_includes_structured_plan_for_current_slot(self):
        coach = load_coach()
        daily_plan = {
            "2026-06-29": {
                "theme": "建立节奏",
                "slots": {
                    "早地铁": [
                        "完成流利说 A+ 定级/入门测评，并记录当前等级。",
                        "先听今日课程第一遍，不追求全懂。",
                    ]
                },
            }
        }

        output = coach.render_task([], dt.date(2026, 6, 29), dt.time(7, 50), daily_plan)

        self.assertIn("## 本时段任务", output)
        self.assertIn("建立节奏", output)
        self.assertIn("完成流利说 A+ 定级/入门测评", output)
        self.assertIn("先听今日课程第一遍", output)

    def test_render_task_falls_back_to_stage_slot_template_after_daily_plan(self):
        coach = load_coach()
        roadmap = {
            "milestones": [
                {
                    "id": "foundation",
                    "start": "2026-06-29",
                    "end": "2026-07-31",
                    "name": "基础节奏",
                }
            ]
        }
        slot_templates = {
            "foundation": {
                "晚地铁": [
                    "准备 3 个客户需求确认问题。",
                    "默想今晚要练的 30 秒项目进展说明。",
                ]
            }
        }

        output = coach.render_task(
            [],
            dt.date(2026, 7, 8),
            dt.time(18, 30),
            daily_plan={},
            roadmap=roadmap,
            slot_templates=slot_templates,
        )

        self.assertIn("基础节奏", output)
        self.assertIn("准备 3 个客户需求确认问题", output)
        self.assertNotIn("暂无结构化计划", output)

    def test_task_command_uses_slot_template_for_dates_after_week_one(self):
        result = subprocess.run(
            ["python3", str(COACH_PATH), "task", "--date", "2026-07-08", "--time", "18:30"],
            cwd=ROOT.parent,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2026-07-08 晚地铁任务", result.stdout)
        self.assertIn("客户", result.stdout)
        self.assertNotIn("暂无结构化计划", result.stdout)

    def test_parse_checkin_text_extracts_mobile_fields(self):
        coach = load_coach()
        text = """时间段：夜练
完成：A+ 第 1 课，30 秒自我介绍
不熟：clarify-this-part, current-status
不会：current-blocker
"""

        parsed = coach.parse_checkin_text(text)

        self.assertEqual(parsed["slot"], "夜练")
        self.assertEqual(parsed["completed"], ["A+ 第 1 课", "30 秒自我介绍"])
        self.assertEqual(parsed["shaky"], ["clarify-this-part", "current-status"])
        self.assertEqual(parsed["failed"], ["current-blocker"])

    def test_parse_checkin_text_handles_one_sentence_mobile_checkin(self):
        coach = load_coach()
        text = "晚练完成 A+ 第 1 课，30 秒项目进展说明，blocker 不熟，schedule risk 不会"

        parsed = coach.parse_checkin_text(text)

        self.assertEqual(parsed["slot"], "夜练")
        self.assertEqual(parsed["completed"], ["A+ 第 1 课", "30 秒项目进展说明"])
        self.assertEqual(parsed["shaky"], ["blocker"])
        self.assertEqual(parsed["failed"], ["schedule risk"])

    def test_parse_checkin_text_keeps_structured_fields_when_present(self):
        coach = load_coach()
        text = """时间段：午间
完成：复习考察
备注：blocker 不熟
"""

        parsed = coach.parse_checkin_text(text)

        self.assertEqual(parsed["slot"], "午间")
        self.assertEqual(parsed["completed"], ["复习考察"])
        self.assertEqual(parsed["shaky"], [])

    def test_parse_checkin_text_extracts_media_sources_and_file_summary(self):
        coach = load_coach()
        text = """时间段：夜练
来源：IMG_1001.PNG, RPReplay.mov
完成：A+ 本周复盘
文件总结：截图显示学习了 deadline / estimate，录屏里 project status 停顿明显。
今天新学：deadline, estimate
不熟：project status
不会：schedule risk
"""

        parsed = coach.parse_checkin_text(text)

        self.assertEqual(parsed["slot"], "夜练")
        self.assertEqual(parsed["source_files"], ["IMG_1001.PNG", "RPReplay.mov"])
        self.assertEqual(parsed["file_summary"], "截图显示学习了 deadline / estimate，录屏里 project status 停顿明显。")
        self.assertEqual(parsed["learned"], ["deadline", "estimate"])
        self.assertEqual(parsed["shaky"], ["project status"])
        self.assertEqual(parsed["failed"], ["schedule risk"])

    def test_summarize_checkin_includes_media_sources_and_file_summary(self):
        coach = load_coach()
        parsed = {
            "slot": "夜练",
            "completed": ["A+ 本周复盘"],
            "learned": ["deadline"],
            "shaky": ["project status"],
            "failed": [],
            "blocked": [],
            "source_files": ["IMG_1001.PNG"],
            "file_summary": "截图显示 deadline 是本次重点。",
            "raw": "",
        }

        summary = coach.summarize_checkin(parsed)

        self.assertIn("来源文件：IMG_1001.PNG", summary)
        self.assertIn("文件总结：截图显示 deadline 是本次重点。", summary)
        self.assertIn("deadline", summary)

    def test_summarize_checkin_focuses_next_review_on_weak_items(self):
        coach = load_coach()
        parsed = {
            "slot": "夜练",
            "completed": ["A+ 第 1 课"],
            "shaky": ["clarify-this-part"],
            "failed": ["current-blocker"],
            "raw": "",
        }

        summary = coach.summarize_checkin(parsed)

        self.assertIn("本次总结", summary)
        self.assertIn("clarify-this-part", summary)
        self.assertIn("current-blocker", summary)
        self.assertIn("下一次优先复习", summary)

    def test_append_checkin_writes_jsonl_record(self):
        coach = load_coach()
        parsed = {
            "slot": "午间",
            "completed": ["词块复习"],
            "shaky": [],
            "failed": ["confirm-understanding"],
            "raw": "时间段：午间\n完成：词块复习\n不会：confirm-understanding",
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "checkins.jsonl"
            record = coach.append_checkin(parsed, dt.date(2026, 6, 30), log_path)

            lines = log_path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(record["date"], "2026-06-30")
        self.assertEqual(len(lines), 1)
        saved = json.loads(lines[0])
        self.assertEqual(saved["failed"], ["confirm-understanding"])

    def test_apply_checkin_updates_known_review_items(self):
        coach = load_coach()
        parsed = {
            "slot": "午间",
            "completed": [],
            "shaky": ["confirm-understanding"],
            "failed": ["deliver-friday"],
            "blocked": [],
            "raw": "",
        }

        updated, changes = coach.apply_checkin_to_items(sample_items(), parsed, dt.date(2026, 7, 4))

        by_id = {item["id"]: item for item in updated}
        self.assertEqual(by_id["confirm-understanding"]["last_result"], "shaky")
        self.assertEqual(by_id["confirm-understanding"]["next_due"], "2026-07-05")
        self.assertEqual(by_id["deliver-friday"]["last_result"], "fail")
        self.assertEqual(by_id["deliver-friday"]["interval_days"], 1)
        self.assertEqual(changes["updated"], ["deliver-friday", "confirm-understanding"])

    def test_apply_checkin_adds_unknown_weak_items_to_queue(self):
        coach = load_coach()
        parsed = {
            "slot": "夜练",
            "completed": [],
            "shaky": ["handover the task"],
            "failed": ["explain schedule risk"],
            "blocked": [],
            "raw": "",
        }

        updated, changes = coach.apply_checkin_to_items(sample_items(), parsed, dt.date(2026, 7, 4))

        by_id = {item["id"]: item for item in updated}
        self.assertIn("handover-the-task", by_id)
        self.assertIn("explain-schedule-risk", by_id)
        self.assertEqual(by_id["handover-the-task"]["last_result"], "shaky")
        self.assertEqual(by_id["handover-the-task"]["next_due"], "2026-07-05")
        self.assertEqual(by_id["explain-schedule-risk"]["last_result"], "fail")
        self.assertEqual(changes["added"], ["explain-schedule-risk", "handover-the-task"])

    def test_milestone_for_date_returns_current_phase(self):
        coach = load_coach()
        roadmap = {
            "target": "客户英语沟通 Level 4",
            "milestones": [
                {
                    "id": "foundation",
                    "start": "2026-06-29",
                    "end": "2026-07-31",
                    "name": "基础节奏",
                    "focus": ["A+ 起步", "客户词块"],
                    "checkpoint": "能完成 1 分钟项目说明。",
                }
            ],
        }

        milestone = coach.milestone_for_date(roadmap, dt.date(2026, 7, 15))

        self.assertEqual(milestone["id"], "foundation")
        self.assertEqual(milestone["name"], "基础节奏")

    def test_render_status_includes_phase_and_due_count(self):
        coach = load_coach()
        roadmap = {
            "target": "客户英语沟通 Level 4",
            "milestones": [
                {
                    "id": "foundation",
                    "start": "2026-06-29",
                    "end": "2026-07-31",
                    "name": "基础节奏",
                    "focus": ["A+ 起步", "客户词块"],
                    "checkpoint": "能完成 1 分钟项目说明。",
                }
            ],
        }

        output = coach.render_status(sample_items(), roadmap, dt.date(2026, 6, 30))

        self.assertIn("客户英语沟通 Level 4", output)
        self.assertIn("基础节奏", output)
        self.assertIn("A+ 起步", output)
        self.assertIn("到期复习：1 项", output)

    def test_render_mobile_reminders_lists_all_daily_slots(self):
        coach = load_coach()
        config = {
            "timezone": "Asia/Shanghai",
            "reminders": [
                {"time": "08:30", "slot": "早地铁", "duration": "25 分钟", "prompt": "早地铁任务"},
                {"time": "12:30", "slot": "午间", "duration": "5-10 分钟", "prompt": "午间任务"},
                {"time": "18:30", "slot": "晚地铁", "duration": "25 分钟", "prompt": "晚地铁任务"},
                {"time": "21:30", "slot": "夜练", "duration": "40 分钟", "prompt": "夜练任务"},
            ],
        }

        output = coach.render_mobile_reminders(config)

        self.assertIn("Asia/Shanghai", output)
        self.assertIn("08:30 早地铁", output)
        self.assertIn("12:30 午间", output)
        self.assertIn("18:30 晚地铁", output)
        self.assertIn("21:30 夜练", output)

    def test_render_mobile_reminders_includes_copyable_chatgpt_prompt(self):
        coach = load_coach()
        config = {
            "timezone": "Asia/Shanghai",
            "reminders": [
                {
                    "time": "21:30",
                    "slot": "夜练",
                    "duration": "40 分钟",
                    "prompt": "提醒我完成英语夜练，并按模板回传。",
                }
            ],
        }

        output = coach.render_mobile_reminders(config)

        self.assertIn("复制到 ChatGPT", output)
        self.assertIn("提醒我完成英语夜练", output)
        self.assertIn("40 分钟", output)

    def test_reminders_command_does_not_require_date(self):
        result = subprocess.run(
            ["python3", str(COACH_PATH), "reminders"],
            cwd=ROOT.parent,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("08:30 早地铁", result.stdout)

    def test_learning_page_is_course_review_workspace(self):
        html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "web" / "assets" / "app.css").read_text(encoding="utf-8")
        script = (ROOT / "web" / "assets" / "app.js").read_text(encoding="utf-8")
        server_source = WEB_SERVER_PATH.read_text(encoding="utf-8")

        self.assertIn("English Coach", html)
        self.assertIn('id="courseList"', html)
        self.assertIn('id="courseReviewWorkspace"', html)
        self.assertIn('id="courseProgress"', html)
        self.assertIn('id="importToolButton"', html)
        self.assertIn('id="translateToolButton"', html)
        self.assertIn('id="importDialog"', html)
        self.assertIn('id="translateDialog"', html)
        self.assertNotIn("tab-bar", html)
        self.assertNotIn("tabButton", html)
        self.assertNotIn("今日学习", html)
        self.assertNotIn("学习回传", html)
        self.assertNotIn("语音播放", html)

        self.assertIn("renderCourses", script)
        self.assertIn("toggleCourse", script)
        self.assertIn("startCourseReview", script)
        self.assertIn("compareReviewAnswer", script)
        self.assertIn("startReviewSpeech", script)
        self.assertIn("stopReviewSpeech", script)
        self.assertIn("recognition.continuous = true", script)
        self.assertIn("SpeechSynthesisUtterance", script)
        self.assertIn("/api/review-result", script)
        self.assertIn("/api/codex-media-inbox", script)
        self.assertIn("/api/translate", script)

        self.assertIn("max-width: 1120px", css)
        self.assertIn("@media (max-width: 720px)", css)
        self.assertNotIn("border-radius: 16px", css)
        self.assertIn('"/assets/app.css"', server_source)
        self.assertIn('"/assets/app.js"', server_source)

    def test_translate_chinese_to_customer_english(self):
        web_server = load_web_server()

        result = web_server.translate_text("当前进展是我们已经完成了 API 草稿。")

        self.assertEqual(result["source_text"], "当前进展是我们已经完成了 API 草稿。")
        self.assertEqual(result["translation"], "The current status is that we finished the API draft.")
        self.assertIn("本地学习词库", result["source"])

    def test_translate_common_chinese_without_filler_prefix(self):
        web_server = load_web_server()

        tomorrow = web_server.translate_text("明天我会更新你。")
        finished = web_server.translate_text("我们已经完成了测试。")

        self.assertEqual(tomorrow["translation"], "I will update you tomorrow.")
        self.assertEqual(finished["translation"], "We finished the testing.")
        self.assertNotIn("I want to say", tomorrow["translation"])
        self.assertNotIn("I want to say", finished["translation"])

    def test_translate_program_entry_point_and_hides_internal_fallback(self):
        web_server = load_web_server()

        entry_point = web_server.translate_text("程序入口")
        unknown = web_server.translate_text("一个暂时没有收录的表达")

        self.assertEqual(entry_point["translation"], "program entry point")
        self.assertTrue(unknown["translation"])
        self.assertNotIn("Please add this sentence", unknown["translation"])

    def test_translate_business_terms_and_never_returns_empty_for_chinese_text(self):
        web_server = load_web_server()

        term = web_server.translate_text("即时账务")
        feature = web_server.translate_text("我需要一个即时账务功能")
        mixed = web_server.translate_text("即时账务生成英文")

        self.assertEqual(term["translation"], "real-time accounting")
        self.assertEqual(feature["translation"], "I need a real-time accounting feature.")
        self.assertTrue(mixed["translation"])
        self.assertIn("real-time accounting", mixed["translation"])

    def test_build_media_checkin_text_from_ocr_creates_learning_fields(self):
        web_server = load_web_server()
        ocr_text = """It's the main entrance of the Louvre.
The museum opens at nine.
And we need enough time to see it.
The room is also really crowded, so we need to wait to see it.
And I just got this souvenir at the gift shop.
"""

        checkin_text = web_server.build_media_checkin_text(
            ["IMG_2001.PNG", "IMG_2002.PNG"],
            ocr_text,
            slot="早地铁",
            completed="听力课截图整理",
        )

        self.assertIn("时间段：早地铁", checkin_text)
        self.assertIn("来源：IMG_2001.PNG, IMG_2002.PNG", checkin_text)
        self.assertIn("完成：听力课截图整理", checkin_text)
        self.assertIn("文件总结：", checkin_text)
        self.assertIn("今天新学：main entrance", checkin_text)
        self.assertIn("enough time to", checkin_text)
        self.assertIn("crowded", checkin_text)
        self.assertIn("souvenir at the gift shop", checkin_text)

    def test_record_media_learning_from_ocr_updates_notes_and_review_cards(self):
        web_server = load_web_server()
        ocr_text = """It's the main entrance of the Louvre.
And we need enough time to see it.
The room is also really crowded, so we need to wait to see it.
"""

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            checkins_path = base / "checkins.jsonl"
            notes_dir = base / "notes"
            state_path.write_text("[]", encoding="utf-8")

            result = web_server.record_media_learning_from_ocr(
                ["IMG_2001.PNG"],
                ocr_text,
                dt.date(2026, 7, 5),
                slot="早地铁",
                completed="听力课截图整理",
                state_path=state_path,
                checkins_path=checkins_path,
                notes_dir=notes_dir,
            )

            saved_items = json.loads(state_path.read_text(encoding="utf-8"))
            note_text = (notes_dir / "2026-07-05.md").read_text(encoding="utf-8")

        by_id = {item["id"]: item for item in saved_items}
        self.assertIn("main-entrance", by_id)
        self.assertEqual(by_id["main-entrance"]["example"], "It's the main entrance of the Louvre.")
        self.assertEqual(by_id["main-entrance"]["prompt"], "这是卢浮宫的主入口。")
        self.assertIn("enough-time-to", by_id)
        self.assertIn("crowded", by_id)
        self.assertIn("IMG_2001.PNG", note_text)
        self.assertIn("听力课截图整理", note_text)
        self.assertGreaterEqual(len(result["dashboard"]["review_cards"]), 3)

    def test_openai_learning_payload_uses_store_false_and_image_inputs(self):
        web_server = load_web_server()

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "lesson.png"
            image_path.write_bytes(b"fake image bytes")
            payload = web_server.openai_learning_payload(
                [
                    {
                        "name": "lesson.png",
                        "path": str(image_path),
                        "content_type": "image/png",
                    }
                ],
                "It's the main entrance of the Louvre.",
                model="gpt-5.5",
            )

        content = payload["input"][0]["content"]
        self.assertEqual(payload["model"], "gpt-5.5")
        self.assertFalse(payload["store"])
        self.assertEqual(content[0]["type"], "input_text")
        self.assertEqual(content[1]["type"], "input_image")
        self.assertTrue(content[1]["image_url"].startswith("data:image/png;base64,"))
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertTrue(payload["text"]["format"]["strict"])
        schema = payload["text"]["format"]["schema"]
        self.assertEqual(schema["required"], ["courses"])
        course_schema = schema["properties"]["courses"]["items"]
        self.assertIn("id_hint", course_schema["properties"])
        self.assertIn("full_content", course_schema["required"])
        self.assertIn("selected_content", course_schema["required"])
        self.assertIn("先按实际课程拆分", content[0]["text"])
        self.assertIn("selected_content 的每个值必须", content[0]["text"])

    def test_record_media_learning_with_ai_analysis_uses_ai_cards(self):
        web_server = load_web_server()
        ai_analysis = {
            "title": "Cindy 的卢浮宫之旅",
            "story_summary_zh": "Cindy 八点半到卢浮宫，先看主入口，后来去看蒙娜丽莎。",
            "completed": "AI 整理听力截图：Cindy 的卢浮宫之旅",
            "learned": ["main entrance", "got here early"],
            "weak": ["main entrance"],
            "review_cards": [
                {
                    "item": "main entrance",
                    "prompt": "主入口。",
                    "example": "It's the main entrance of the Louvre.",
                    "note": "介绍地点入口",
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            checkins_path = base / "checkins.jsonl"
            notes_dir = base / "notes"
            state_path.write_text("[]", encoding="utf-8")

            result = web_server.record_media_learning_from_ocr(
                ["IMG_2001.PNG"],
                "It's the main entrance of the Louvre.",
                dt.date(2026, 7, 5),
                slot="今日学习",
                completed="截图/录屏学习文件整理",
                state_path=state_path,
                checkins_path=checkins_path,
                notes_dir=notes_dir,
                ai_analysis=ai_analysis,
            )

            saved_items = json.loads(state_path.read_text(encoding="utf-8"))
            note_text = (notes_dir / "2026-07-05.md").read_text(encoding="utf-8")

        self.assertTrue(result["ai_used"])
        self.assertIn("AI 整理听力截图", result["checkin_text"])
        self.assertEqual(saved_items[0]["prompt"], "主入口。")
        self.assertEqual(saved_items[0]["example"], "It's the main entrance of the Louvre.")
        self.assertIn("Cindy 八点半到卢浮宫", note_text)

    def test_ai_review_candidates_keeps_complete_course_without_ten_card_limit(self):
        web_server = load_web_server()
        analysis = {
            "full_content": [
                {
                    "item": f"Complete course sentence {index}.",
                    "prompt": f"完整课程句子 {index}。",
                    "example": f"Complete course sentence {index}.",
                    "note": "完整采集",
                }
                for index in range(1, 16)
            ]
        }

        candidates = web_server.ai_review_candidates(analysis)

        self.assertEqual(len(candidates), 15)

    def test_record_media_learning_creates_full_and_selected_content_without_duplicates(self):
        web_server = load_web_server()
        full_content = [
            {
                "item": f"Complete sentence {index}.",
                "prompt": f"完整句子 {index}。",
                "example": f"Complete sentence {index}.",
                "note": "完整采集",
            }
            for index in range(1, 13)
        ]
        analysis = {
            "courses": [
                {
                    "id_hint": "complete-lesson",
                    "title": "完整课程",
                    "summary_zh": "完整与精选共用同一批卡。",
                    "learned": [card["item"] for card in full_content],
                    "full_content": full_content,
                    "selected_content": [
                        full_content[1]["item"],
                        full_content[5]["item"],
                        full_content[10]["item"],
                    ],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            result = web_server.record_media_learning_from_ocr(
                ["lesson.mp4"],
                "",
                "2026-07-16",
                state_path=base / "review-items.json",
                checkins_path=base / "checkins.jsonl",
                notes_dir=base / "notes",
                courses_path=base / "courses.json",
                ai_analysis=analysis,
            )
            courses = json.loads((base / "courses.json").read_text(encoding="utf-8"))
            items = json.loads((base / "review-items.json").read_text(encoding="utf-8"))

        self.assertEqual(len(items), 12)
        self.assertEqual(len(courses[0]["card_ids"]), 12)
        self.assertEqual(len(courses[0]["selected_card_ids"]), 3)
        self.assertTrue(set(courses[0]["selected_card_ids"]).issubset(courses[0]["card_ids"]))
        course = result["dashboard"]["courses"][0]
        self.assertEqual(len(course["full_content"]), 12)
        self.assertEqual(len(course["selected_content"]), 3)

    def test_selected_content_must_reference_full_content(self):
        web_server = load_web_server()
        with self.assertRaisesRegex(ValueError, "subset of full_content"):
            web_server.analysis_selected_items(
                {"selected_content": ["Invented sentence."]},
                [{"item": "Real sentence."}],
            )

    def test_record_codex_media_job_writes_pending_manifest_and_files(self):
        web_server = load_web_server()

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            upload_path = base / "upload.png"
            upload_path.write_bytes(b"image bytes")
            inbox_dir = base / "codex-inbox"

            result = web_server.record_codex_media_job(
                [
                    {
                        "name": "upload.png",
                        "path": str(upload_path),
                        "content_type": "image/png",
                    }
                ],
                "It's the main entrance of the Louvre.",
                "2026-07-05",
                slot="今日学习",
                completed="听力课截图整理",
                inbox_dir=inbox_dir,
                job_id="job-001",
            )

            manifest_path = Path(result["manifest_path"])
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            copied_path = Path(manifest["files"][0]["path"])
            copied_exists = copied_path.exists()

        self.assertEqual(result["job_id"], "job-001")
        self.assertEqual(manifest["status"], "pending")
        self.assertEqual(manifest["date"], "2026-07-05")
        self.assertEqual(manifest["slot"], "今日学习")
        self.assertEqual(manifest["completed"], "听力课截图整理")
        self.assertIn("It's the main entrance", manifest["ocr_text"])
        self.assertIn("自动整理队列", manifest["codex_instruction"])
        self.assertTrue(copied_exists)

    def test_prepare_uploaded_media_adds_video_keyframes_for_codex(self):
        web_server = load_web_server()

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            video_path = base / "lesson.mp4"
            video_path.write_bytes(b"video bytes")
            frame_one = base / "lesson-001.jpg"
            frame_two = base / "lesson-002.jpg"
            frame_one.write_bytes(b"frame one")
            frame_two.write_bytes(b"frame two")
            saved_files = [
                {
                    "name": "lesson.mp4",
                    "path": str(video_path),
                    "content_type": "video/mp4",
                }
            ]

            with mock.patch.object(
                web_server,
                "extract_video_frames",
                return_value=[frame_one, frame_two],
            ) as extractor:
                prepared = web_server.prepare_uploaded_media(saved_files)

        extractor.assert_called_once()
        self.assertEqual([item["name"] for item in prepared], [
            "lesson.mp4",
            "lesson-frame-001.jpg",
            "lesson-frame-002.jpg",
        ])
        self.assertEqual(prepared[1]["generated_from"], "lesson.mp4")

    def test_complete_codex_media_job_writes_learning_and_marks_done(self):
        web_server = load_web_server()

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            upload_path = base / "upload.png"
            upload_path.write_bytes(b"image bytes")
            inbox_dir = base / "codex-inbox"
            state_path = base / "review-items.json"
            checkins_path = base / "checkins.jsonl"
            notes_dir = base / "notes"

            job = web_server.record_codex_media_job(
                [
                    {
                        "name": "upload.png",
                        "path": str(upload_path),
                        "content_type": "image/png",
                    }
                ],
                "It's the main entrance of the Louvre.",
                "2026-07-05",
                inbox_dir=inbox_dir,
                job_id="job-002",
            )
            pending = web_server.pending_codex_media_jobs(inbox_dir)
            analysis = {
                "title": "Cindy 的卢浮宫之旅",
                "story_summary_zh": "Cindy 早到卢浮宫，先看主入口，再去看蒙娜丽莎。",
                "completed": "听力截图整理",
                "learned": ["It's the main entrance of the Louvre."],
                "weak": ["It's the main entrance of the Louvre."],
                "review_cards": [
                    {
                        "item": "It's the main entrance of the Louvre.",
                        "prompt": "这是卢浮宫的主入口。",
                        "example": "It's the main entrance of the Louvre.",
                        "note": "介绍地点入口。",
                    }
                ],
            }

            result = web_server.complete_codex_media_job(
                Path(job["manifest_path"]),
                ai_analysis=analysis,
                state_path=state_path,
                checkins_path=checkins_path,
                notes_dir=notes_dir,
            )
            manifest = json.loads(Path(job["manifest_path"]).read_text(encoding="utf-8"))
            saved_items = json.loads(state_path.read_text(encoding="utf-8"))
            note_text = (notes_dir / "2026-07-05.md").read_text(encoding="utf-8")

        self.assertEqual([item["id"] for item in pending], ["job-002"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(manifest["status"], "completed")
        self.assertTrue(manifest["ai_used"])
        self.assertIn("note_path", manifest)
        self.assertEqual(saved_items[0]["prompt"], "这是卢浮宫的主入口。")
        self.assertIn("Cindy 早到卢浮宫", note_text)

    def test_complete_codex_job_creates_multiple_courses(self):
        web_server = load_web_server()
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            upload_path = base / "lesson.mp4"
            upload_path.write_bytes(b"video")
            job = web_server.record_codex_media_job(
                [{"name": "lesson.mp4", "path": str(upload_path), "content_type": "video/mp4"}],
                "pet food and pet supplies",
                "2026-07-11",
                inbox_dir=base / "inbox",
                job_id="multi-course-job",
            )
            analysis = {
                "courses": [
                    {
                        "id_hint": "pet-food-safety",
                        "title": "宠物饮食安全",
                        "summary_zh": "宠物不能随便吃人类食物。",
                        "learned": ["Do not feed chocolate to dogs."],
                        "review_cards": [
                            {
                                "item": "Do not feed chocolate to dogs.",
                                "prompt": "不要给狗喂巧克力。",
                                "example": "Do not feed chocolate to dogs.",
                                "note": "宠物饮食提醒。",
                            }
                        ],
                    },
                    {
                        "id_hint": "pet-supplies",
                        "title": "宠物用品",
                        "summary_zh": "询问宠物用品的购买渠道。",
                        "learned": ["Where do you get your pet supplies?"],
                        "review_cards": [
                            {
                                "item": "Where do you get your pet supplies?",
                                "prompt": "你在哪里买宠物用品？",
                                "example": "Where do you get your pet supplies?",
                                "note": "询问购买渠道。",
                            }
                        ],
                    },
                ]
            }

            result = web_server.complete_codex_media_job(
                Path(job["manifest_path"]),
                ai_analysis=analysis,
                state_path=base / "review-items.json",
                checkins_path=base / "checkins.jsonl",
                notes_dir=base / "notes",
                courses_path=base / "courses.json",
            )
            courses = json.loads((base / "courses.json").read_text(encoding="utf-8"))
            items = json.loads((base / "review-items.json").read_text(encoding="utf-8"))

        self.assertEqual(result["status"], "completed")
        self.assertEqual([course["id"] for course in courses], ["pet-food-safety", "pet-supplies"])
        self.assertEqual({item["course_id"] for item in items}, {"pet-food-safety", "pet-supplies"})
        self.assertTrue(all(item["status"] == "new" for item in items))
        self.assertTrue(all(item["last_result"] == "pending" for item in items))
        self.assertTrue(all(item["history"] == [] for item in items))

    def test_codex_media_job_command_uses_manifest_and_images(self):
        web_server = load_web_server()

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            image_path = base / "upload.png"
            image_path.write_bytes(b"image bytes")
            manifest_path = base / "job.json"
            manifest = {
                "id": "job-003",
                "files": [
                    {
                        "name": "upload.png",
                        "path": str(image_path),
                        "content_type": "image/png",
                    }
                ],
            }

            command = web_server.codex_media_job_command(
                manifest_path,
                manifest,
                codex_bin="/tmp/codex",
                output_last_path=base / "last.txt",
            )

        self.assertEqual(command[0], "/tmp/codex")
        self.assertIn("exec", command)
        self.assertIn("--ask-for-approval", command)
        self.assertIn("never", command)
        self.assertIn("-i", command)
        self.assertIn(str(image_path), command)
        self.assertIn(str(manifest_path), command[-1])
        self.assertIn("courses", command[-1])
        self.assertIn("每门课程", command[-1])

    def test_dashboard_payload_builds_sentence_review_tasks_and_completed_reviews(self):
        web_server = load_web_server()
        items = [
            {
                "id": "main-entrance",
                "item": "main entrance",
                "next_due": "2026-07-05",
                "interval_days": 1,
                "last_result": "shaky",
                "example": "It's the main entrance of the Louvre.",
                "prompt": "这是卢浮宫的主入口。",
                "note": "主入口",
                "history": [],
            },
            {
                "id": "clarify-this-part",
                "item": "Could you clarify this part?",
                "next_due": "2026-07-07",
                "interval_days": 2,
                "last_result": "pass",
                "example": "Could you clarify this part of the requirement?",
                "prompt": "你能澄清一下需求的这一部分吗？",
                "note": "追问不清楚的需求",
                "history": [
                    {
                        "date": "2026-07-05",
                        "result": "pass",
                        "next_due": "2026-07-07",
                    }
                ],
            },
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            state_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

            payload = web_server.dashboard_payload(
                dt.date(2026, 7, 5),
                state_path=state_path,
                checkins_path=base / "missing.jsonl",
                notes_dir=base / "missing-notes",
            )

        card = payload["review_cards"][0]
        self.assertEqual(card["target_sentence"], "It's the main entrance of the Louvre.")
        self.assertEqual(card["prompt_sentence"], "这是卢浮宫的主入口。")
        self.assertEqual(card["prompt"], "这是卢浮宫的主入口。")
        self.assertEqual(card["keywords"], ["main", "entrance"])
        self.assertEqual(payload["completed_reviews"][0]["id"], "clarify-this-part")
        self.assertEqual(payload["completed_reviews"][0]["prompt_sentence"], "你能澄清一下需求的这一部分吗？")
        self.assertEqual(payload["completed_reviews"][0]["last_result"], "pass")

    def test_dashboard_payload_reads_generated_notes_and_due_reviews(self):
        web_server = load_web_server()
        items = [
            {
                "id": "main-entrance",
                "item": "main entrance",
                "next_due": "2026-07-05",
                "interval_days": 1,
                "last_result": "shaky",
                "history": [],
            },
            {
                "id": "future-item",
                "item": "future item",
                "next_due": "2026-07-08",
                "interval_days": 4,
                "last_result": "pass",
                "history": [],
            },
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            checkins_path = base / "checkins.jsonl"
            notes_dir = base / "notes"
            notes_dir.mkdir()
            state_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            checkins_path.write_text(
                json.dumps({"date": "2026-07-05", "slot": "早地铁", "completed": ["听力课"]}, ensure_ascii=False)
                + "\n",
                encoding="utf-8",
            )
            (notes_dir / "2026-07-05.md").write_text("# 2026-07-05 学习总结\n\n- main entrance\n", encoding="utf-8")

            payload = web_server.dashboard_payload(
                dt.date(2026, 7, 5),
                state_path=state_path,
                checkins_path=checkins_path,
                notes_dir=notes_dir,
            )

        self.assertTrue(payload["note"]["exists"])
        self.assertIn("main entrance", payload["note"]["content"])
        self.assertEqual([item["id"] for item in payload["due_reviews"]], ["main-entrance"])
        self.assertEqual(payload["checkins"][0]["slot"], "早地铁")

    def test_dashboard_payload_groups_review_cards_by_course(self):
        web_server = load_web_server()
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            courses_path = base / "courses.json"
            cards = [
                {
                    "id": "hello-client",
                    "course_id": "client-basics",
                    "item": "Hello, thanks for joining.",
                    "prompt": "你好，感谢你参加会议。",
                    "example": "Hello, thanks for joining.",
                    "note": "会议开场",
                    "next_due": "2026-07-11",
                    "status": "needs_review",
                    "last_result": "shaky",
                    "history": [],
                },
                {
                    "id": "museum-open",
                    "course_id": "louvre",
                    "item": "The museum opens at nine.",
                    "prompt": "博物馆九点开门。",
                    "example": "The museum opens at nine.",
                    "note": "开放时间",
                    "next_due": "2026-07-12",
                    "status": "new",
                    "last_result": "pending",
                    "history": [],
                },
            ]
            courses = [
                {"id": "louvre", "title": "卢浮宫", "summary_zh": "参观场景", "card_ids": ["museum-open"], "selected_card_ids": ["museum-open"], "learned_on": "2026-07-10", "order": 2},
                {"id": "client-basics", "title": "客户沟通", "summary_zh": "会议表达", "card_ids": ["hello-client"], "learned_on": "2026-07-01", "order": 1},
            ]
            state_path.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
            courses_path.write_text(json.dumps(courses, ensure_ascii=False), encoding="utf-8")

            payload = web_server.dashboard_payload(
                "2026-07-11",
                state_path=state_path,
                checkins_path=base / "missing.jsonl",
                notes_dir=base / "notes",
                courses_path=courses_path,
            )

        self.assertEqual([course["id"] for course in payload["courses"]], ["louvre", "client-basics"])
        self.assertEqual(payload["courses"][0]["mastery_score"], 0.0)
        self.assertEqual(payload["courses"][0]["mastery_label"], "很不熟悉")
        self.assertEqual(payload["courses"][1]["due_count"], 1)
        self.assertEqual(payload["courses"][1]["today_cards"][0]["prompt_sentence"], "你好，感谢你参加会议。")
        self.assertEqual(payload["courses"][0]["all_cards"][0]["target_sentence"], "The museum opens at nine.")
        self.assertEqual(payload["courses"][0]["full_content"], payload["courses"][0]["all_cards"])
        self.assertEqual(len(payload["courses"][0]["selected_content"]), 1)
        self.assertEqual(payload["courses"][0]["selected_total_count"], 1)

    def test_dashboard_sorts_least_familiar_then_due_count_and_manual_order(self):
        web_server = load_web_server()
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            courses_path = base / "courses.json"
            courses = [
                {"id": "manual-first", "title": "手工顺序一", "card_ids": ["a"], "order": 1},
                {"id": "more-due", "title": "更多到期", "card_ids": ["b", "c"], "order": 3},
                {"id": "manual-second", "title": "手工顺序二", "card_ids": ["d"], "order": 2},
                {"id": "familiar", "title": "较熟课程", "card_ids": ["e"], "order": 0},
            ]
            cards = [
                {
                    "id": card_id,
                    "course_id": course_id,
                    "item": card_id,
                    "next_due": next_due,
                    "status": status,
                    "last_result": result,
                    "interval_days": interval,
                    "history": history,
                }
                for card_id, course_id, next_due, status, result, interval, history in [
                    ("a", "manual-first", "2026-07-12", "new", "pending", 1, []),
                    ("b", "more-due", "2026-07-11", "new", "pending", 1, []),
                    ("c", "more-due", "2026-07-10", "new", "pending", 1, []),
                    ("d", "manual-second", "2026-07-12", "new", "pending", 1, []),
                    ("e", "familiar", "2026-08-10", "reviewing", "pass", 30, [{"result": "pass"}]),
                ]
            ]
            state_path.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
            courses_path.write_text(json.dumps(courses, ensure_ascii=False), encoding="utf-8")

            payload = web_server.dashboard_payload(
                "2026-07-11",
                state_path=state_path,
                checkins_path=base / "missing.jsonl",
                notes_dir=base / "notes",
                courses_path=courses_path,
            )

        self.assertEqual(
            [course["id"] for course in payload["courses"]],
            ["more-due", "manual-first", "manual-second", "familiar"],
        )

    def test_sync_state_validates_and_saves_with_timestamped_backups(self):
        web_server = load_web_server()
        self.assertTrue(web_server.is_loopback_address("127.0.0.1"))
        self.assertTrue(web_server.is_loopback_address("::1"))
        self.assertFalse(web_server.is_loopback_address("192.168.1.10"))
        with self.assertRaisesRegex(ValueError, "unknown course_id"):
            web_server.validate_sync_state_payload(
                {
                    "courses": [{"id": "known", "card_ids": []}],
                    "review_items": [{"id": "orphan", "course_id": "missing"}],
                }
            )
        with self.assertRaisesRegex(ValueError, "selected_card_ids must be a subset"):
            web_server.validate_sync_state_payload(
                {
                    "courses": [
                        {
                            "id": "known",
                            "card_ids": ["known-card"],
                            "selected_card_ids": ["missing-card"],
                        }
                    ],
                    "review_items": [{"id": "known-card", "course_id": "known"}],
                }
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            courses_path = base / "courses.json"
            state_path = base / "review-items.json"
            old_courses = [{"id": "old", "card_ids": ["old-card"]}]
            old_items = [{"id": "old-card", "course_id": "old"}]
            new_courses = [{"id": "new", "card_ids": ["new-card"], "selected_card_ids": ["new-card"]}]
            new_items = [{"id": "new-card", "course_id": "new", "last_result": "pending"}]
            courses_path.write_text(json.dumps(old_courses), encoding="utf-8")
            state_path.write_text(json.dumps(old_items), encoding="utf-8")

            result = web_server.save_sync_state(
                {"courses": new_courses, "review_items": new_items},
                courses_path=courses_path,
                state_path=state_path,
                backups_dir=base / "backups",
                timestamp=dt.datetime(2026, 7, 15, 12, 34, 56),
            )

            backup_dir = Path(result["backup_path"])
            self.assertEqual(json.loads(courses_path.read_text(encoding="utf-8")), new_courses)
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8")), new_items)
            self.assertEqual(json.loads((backup_dir / "courses.json").read_text(encoding="utf-8")), old_courses)
            self.assertEqual(json.loads((backup_dir / "review-items.json").read_text(encoding="utf-8")), old_items)
            self.assertEqual(result["course_count"], 1)
            self.assertEqual(result["review_item_count"], 1)

    def test_dashboard_payload_parses_note_into_learning_sections_and_review_cards(self):
        web_server = load_web_server()
        items = [
            {
                "id": "main-entrance",
                "item": "main entrance",
                "next_due": "2026-07-05",
                "interval_days": 1,
                "last_result": "shaky",
                "example": "It's the main entrance of the Louvre.",
                "note": "主入口",
                "history": [],
            }
        ]
        note = """# 2026-07-05 学习总结

## 早地铁

### 本次总结

- 已完成：听力课 Cindy 的卢浮宫之旅 原文截图整理
- 文件总结：本课是 Cindy 在卢浮宫参观的听力材料。
- 新学内容：main entrance, the Louvre, enough time to
- 不熟：main entrance, enough time to
"""

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            state_path = base / "review-items.json"
            notes_dir = base / "notes"
            notes_dir.mkdir()
            state_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            (notes_dir / "2026-07-05.md").write_text(note, encoding="utf-8")

            payload = web_server.dashboard_payload(
                dt.date(2026, 7, 5),
                state_path=state_path,
                checkins_path=base / "missing.jsonl",
                notes_dir=notes_dir,
            )

        self.assertEqual(payload["study_note"]["completed"], "听力课 Cindy 的卢浮宫之旅 原文截图整理")
        self.assertIn("Cindy 在卢浮宫", payload["study_note"]["summary"])
        self.assertEqual(payload["study_note"]["learned"], ["main entrance", "the Louvre", "enough time to"])
        self.assertEqual(payload["study_note"]["weak"], ["main entrance", "enough time to"])
        self.assertEqual(payload["review_cards"][0]["prompt"], "主入口")
        self.assertEqual(payload["review_cards"][0]["answer"], "main entrance")
        self.assertIn("Louvre", payload["review_cards"][0]["example"])

    def test_record_review_result_updates_review_schedule(self):
        web_server = load_web_server()
        items = [
            {
                "id": "main-entrance",
                "item": "main entrance",
                "next_due": "2026-07-05",
                "interval_days": 1,
                "last_result": "shaky",
                "history": [],
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            state_path = Path(tmpdir) / "review-items.json"
            state_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

            result = web_server.record_review_result(
                "main-entrance",
                "pass",
                dt.date(2026, 7, 5),
                state_path=state_path,
            )
            saved = json.loads(state_path.read_text(encoding="utf-8"))

        self.assertEqual(result["item"]["last_result"], "pass")
        self.assertEqual(saved[0]["next_due"], "2026-07-07")

    def test_render_report_summarizes_checkins_and_weak_items(self):
        coach = load_coach()
        checkins = [
            {
                "date": "2026-06-29",
                "slot": "夜练",
                "completed": ["A+ 第 1 课"],
                "shaky": ["current-status"],
                "failed": ["current-blocker"],
            },
            {
                "date": "2026-06-30",
                "slot": "午间",
                "completed": ["词块复习"],
                "shaky": ["current-status"],
                "failed": [],
            },
        ]

        output = coach.render_report(
            sample_items(),
            checkins,
            dt.date(2026, 6, 30),
            days=7,
        )

        self.assertIn("最近 7 天学习报告", output)
        self.assertIn("打卡次数：2", output)
        self.assertIn("current-status x2", output)
        self.assertIn("current-blocker x1", output)
        self.assertIn("到期复习", output)

    def test_load_checkins_reads_jsonl(self):
        coach = load_coach()
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "checkins.jsonl"
            path.write_text(
                '{"date":"2026-06-29","slot":"夜练","completed":["A+ 第 1 课"]}\n'
                '{"date":"2026-06-30","slot":"午间","failed":["current-status"]}\n',
                encoding="utf-8",
            )

            checkins = coach.load_checkins(path)

        self.assertEqual(len(checkins), 2)
        self.assertEqual(checkins[1]["failed"], ["current-status"])

    def test_render_quiz_uses_only_due_review_items(self):
        coach = load_coach()

        output = coach.render_quiz(sample_items(), dt.date(2026, 6, 30), limit=5)

        self.assertIn("2026-06-30 复习考察", output)
        self.assertIn("[confirm-understanding]", output)
        self.assertIn("Let me confirm my understanding.", output)
        self.assertNotIn("deliver-friday", output)
        self.assertIn("回传格式", output)

    def test_quiz_command_renders_due_items(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_path = Path(tmpdir) / "review-items.json"
            state_path.write_text(json.dumps(sample_items(), ensure_ascii=False), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(COACH_PATH),
                    "--state",
                    str(state_path),
                    "quiz",
                    "--date",
                    "2026-06-30",
                ],
                cwd=ROOT.parent,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("复习考察", result.stdout)
        self.assertIn("confirm-understanding", result.stdout)

    def test_append_daily_note_writes_markdown_summary(self):
        coach = load_coach()
        parsed = {
            "slot": "夜练",
            "completed": ["A+ 第 2 课"],
            "shaky": ["current-status"],
            "failed": ["current-blocker"],
            "raw": "时间段：夜练\n完成：A+ 第 2 课",
        }
        summary = coach.summarize_checkin(parsed)

        with tempfile.TemporaryDirectory() as tmpdir:
            note_path = coach.append_daily_note(parsed, summary, dt.date(2026, 6, 30), Path(tmpdir))
            note_text = note_path.read_text(encoding="utf-8")

        self.assertEqual(note_path.name, "2026-06-30.md")
        self.assertIn("# 2026-06-30 学习总结", note_text)
        self.assertIn("## 夜练", note_text)
        self.assertIn("current-status", note_text)
        self.assertIn("current-blocker", note_text)

    def test_checkin_command_writes_daily_note(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            state_path = tmp_path / "state.json"
            checkins_path = tmp_path / "checkins.jsonl"
            notes_dir = tmp_path / "notes"
            state_path.write_text(json.dumps(sample_items()), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(COACH_PATH),
                    "--state",
                    str(state_path),
                    "--checkins",
                    str(checkins_path),
                    "--notes-dir",
                    str(notes_dir),
                    "checkin",
                    "--date",
                    "2026-06-30",
                    "--text",
                    "时间段：午间\n完成：复习考察\n不熟：confirm-understanding",
                ],
                cwd=ROOT.parent,
                text=True,
                capture_output=True,
                check=False,
            )

            note_text = (notes_dir / "2026-06-30.md").read_text(encoding="utf-8")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("午间", note_text)
        self.assertIn("confirm-understanding", note_text)

    def test_checkin_command_accepts_one_sentence_mobile_checkin(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            state_path = tmp_path / "state.json"
            checkins_path = tmp_path / "checkins.jsonl"
            notes_dir = tmp_path / "notes"
            state_path.write_text(json.dumps(sample_items()), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(COACH_PATH),
                    "--state",
                    str(state_path),
                    "--checkins",
                    str(checkins_path),
                    "--notes-dir",
                    str(notes_dir),
                    "checkin",
                    "--date",
                    "2026-06-30",
                    "--text",
                    "晚练完成 A+ 第 1 课，30 秒项目进展说明，blocker 不熟，schedule risk 不会",
                ],
                cwd=ROOT.parent,
                text=True,
                capture_output=True,
                check=False,
            )

            saved_items = json.loads(state_path.read_text(encoding="utf-8"))
            note_text = (notes_dir / "2026-06-30.md").read_text(encoding="utf-8")

        self.assertEqual(result.returncode, 0, result.stderr)
        by_id = {item["id"]: item for item in saved_items}
        self.assertEqual(by_id["blocker"]["last_result"], "shaky")
        self.assertEqual(by_id["schedule-risk"]["last_result"], "fail")
        self.assertIn("A+ 第 1 课", note_text)
        self.assertIn("schedule risk", note_text)


if __name__ == "__main__":
    unittest.main()
