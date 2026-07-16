#!/usr/bin/env python3
"""Import the complete English content from normal_video.mp4 by course."""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import importlib.util
import json
from pathlib import Path
import re
import shutil
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WEB_SERVER_PATH = Path(__file__).with_name("web_server.py")
STATE_PATH = ROOT / "state" / "review-items.json"
COURSES_PATH = ROOT / "state" / "courses.json"
CHECKINS_PATH = ROOT / "state" / "checkins.jsonl"
NOTES_DIR = ROOT / "notes"
OCR_PATH = Path("/tmp/english-coach-video-full/ocr.jsonl")
IMPORT_DATE = dt.date(2026, 7, 11)


def card(item: str, prompt: str, note: str = "") -> dict[str, str]:
    return {
        "item": item,
        "prompt": prompt,
        "example": item,
        "note": note or "按中文意思完整复述英文，参考答案默认隐藏。",
    }


COURSES: list[dict[str, Any]] = [
    {
        "id_hint": "pet-food-safety",
        "title": "语法课：a/an/the 的用法（宠物饮食）",
        "summary_zh": "围绕宠物饮食安全学习冠词语境，说明猫、狗不能随意食用的人类食物。",
        "selected_content": [
            "The food that you like is not always the best food for your pet.",
            "Do not feed chocolate to dogs.",
            "For example, kittens can't drink cow's milk.",
            "Chocolate is another dangerous food.",
            "It's an excellent idea to check on the internet before you give human food to pets.",
            "It might not be safe.",
        ],
        "review_cards": [
            card("Are you a pet owner?", "你是宠物主人吗？"),
            card("If you have a pet, there is something that you should know.", "如果你养了宠物，有些事情你应该知道。"),
            card("The food that you like is not always the best food for your pet.", "你喜欢的食物并不总是最适合你宠物的食物。"),
            card("For example, kittens can't drink cow's milk.", "例如，小猫不能喝牛奶。"),
            card("Another kind of milk is a better choice — goat's milk!", "另一种奶是更好的选择——羊奶！"),
            card("Chocolate is another dangerous food.", "巧克力是另一种危险的食物。"),
            card("Do not feed chocolate to dogs.", "不要给狗喂巧克力。"),
            card("It can cause them health problems.", "这会给它们造成健康问题。"),
            card("It's an excellent idea to check on the internet before you give human food to pets.", "在给宠物喂人类食物之前，上网查询是个很好的主意。"),
            card("It might not be safe.", "它可能并不安全。"),
        ],
    },
    {
        "id_hint": "pet-supplies",
        "title": "词汇课：宠物用品",
        "summary_zh": "学习 supplies、collar、litter box、parrot 和 cage，并用完整句询问和描述宠物用品。",
        "selected_content": [
            "Where do you usually get your pet supplies, online or in store?",
            "Should my dog always wear a collar when I take it out for a walk?",
            "An automatic litter box saves time and is easy to clean up.",
        ],
        "review_cards": [
            card("Getting a pet is exciting, and to get ready, you need a lot of supplies.", "养宠物令人兴奋，而为了做好准备，你需要很多用品。"),
            card("Supplies are items or materials that people need to do a task.", "用品是人们完成一项任务所需要的物品或材料。"),
            card("Where do you usually get your pet supplies, online or in store?", "你通常在哪里购买宠物用品，是网上还是实体店？"),
            card("That village is running low on medical supplies.", "那个村庄的医疗物资快用完了。"),
            card("Check online for tips on choosing the perfect dog collar or getting the best litter box for your kitten.", "上网查找如何挑选合适狗项圈或为小猫购买最佳猫砂盆的建议。"),
            card("Should my dog always wear a collar when I take it out for a walk?", "我带狗出去散步时，它应该一直戴着项圈吗？"),
            card("An automatic litter box saves time and is easy to clean up.", "自动猫砂盆可以节省时间，而且很容易清理。"),
            card("It is important to make sure your pet feels comfortable.", "确保你的宠物感觉舒适很重要。"),
            card("For example, if you get a parrot, you need to pick a cage that is big enough for it to move around.", "例如，如果你养了一只鹦鹉，你需要选择一个足够大、能让它活动的笼子。"),
            card("A parrot is a bright-colored bird that can be trained to repeat what you say.", "鹦鹉是一种色彩鲜艳、可以训练来重复你所说话语的鸟。"),
            card("In that movie, he has a parrot on his shoulder wherever he goes.", "在那部电影里，无论他走到哪里，肩膀上都站着一只鹦鹉。"),
            card("A cage is a place with bars where animals are kept.", "笼子是一个带有栏杆、用来关动物的地方。"),
            card("Do you think it's right for a zoo to keep all animals in cages?", "你认为动物园把所有动物都关在笼子里是正确的吗？"),
            card("supplies", "用品；物资", "词汇卡：supplies。"),
            card("collar", "项圈", "词汇卡：collar。"),
            card("litter", "猫砂", "词汇卡：litter。"),
            card("litter box", "猫砂盆", "词汇卡：litter box。"),
            card("a parrot", "一只鹦鹉", "词汇卡：parrot，结合课程语境保留冠词。"),
            card("cage", "笼子", "词汇卡：cage。"),
        ],
    },
    {
        "id_hint": "pet-grooming-and-attachment",
        "title": "词汇课：迎接新宠物",
        "summary_zh": "学习 accompany、company、scratch、groom、grow attached 和 reliable，覆盖新宠物到家后的训练、护理与情感连接。",
        "selected_content": [
            "Grooming not only makes your pet pretty, but also keeps it healthy.",
            "Once you win your pet's love and trust, it will become your most reliable friend.",
            "If you groom an animal, you wash and clean it to make it look better.",
            "To grow attached to means to start loving something or someone a lot.",
            "He is very reliable. If he says he will do something, he will do it.",
        ],
        "review_cards": [
            card("The excitement of having a new member of the family is usually accompanied by worries and confusion.", "家里有新成员的兴奋通常伴随着担忧和困惑。"),
            card("To accompany means to happen at the same time.", "accompany 的意思是同时发生。"),
            card("Her letter was accompanied by two photos.", "她的信里附有两张照片。"),
            card("To accompany can also mean to go someplace with somebody.", "accompany 也可以表示陪某人去某个地方。"),
            card("The lamb accompanies the little girl everywhere.", "这只小羊无论到哪里都陪着小女孩。"),
            card("To be one's company means to be with someone so they don't feel lonely.", "陪伴某人意味着和对方在一起，让对方不感到孤单。"),
            card("Her parents bought her a lamb for company.", "她的父母给她买了一只小羊陪伴她。"),
            card("After you bring home a new cat, show it where the litter box is and train it not to scratch your furniture.", "把新猫带回家后，要告诉它猫砂盆在哪里，并训练它不要抓家具。"),
            card("Kittens like to scratch.", "小猫喜欢抓挠。"),
            card("The puppy scratched at the door because he couldn't wait to go out for a walk.", "小狗抓着门，因为它等不及要出去散步了。"),
            card("Make sure you groom your cats or dogs regularly and take them to the vet for health checks.", "一定要定期给猫或狗做清洁护理，并带它们去兽医那里做健康检查。"),
            card("If you groom an animal, you wash and clean it to make it look better.", "如果你给动物做清洁护理，就是给它洗澡和清洁，让它看起来更好。"),
            card("Grooming not only makes your pet pretty, but also keeps it healthy.", "清洁护理不仅让宠物更漂亮，也能让它保持健康。"),
            card("Kittens and puppies can grow attached to you in two or three days.", "小猫和小狗可能在两三天内就开始依恋你。"),
            card("To grow attached to means to start loving something or someone a lot.", "grow attached to 的意思是开始非常喜爱某物或某人。"),
            card("The little girl grew attached to her babysitter after three months.", "三个月后，小女孩开始非常依恋她的保姆。"),
            card("Once you win your pet's love and trust, it will become your most reliable friend.", "一旦赢得宠物的爱与信任，它就会成为你最可靠的朋友。"),
            card("People or things that are reliable can be believed to work well.", "可靠的人或事物是可以相信其会好好运作的。"),
            card("He is very reliable. If he says he will do something, he will do it.", "他非常可靠。如果他说会做某件事，他就会做到。"),
        ],
    },
    {
        "id_hint": "puppy-habits",
        "title": "听力课：小狗狗也是宝宝",
        "summary_zh": "比较婴儿与幼犬在声音、睡眠和依恋方面的相似之处，练习完整听力原文。",
        "selected_content": [
            "Puppies spend about 14 hours of the day sleeping.",
            "While it takes a lot of time to care for a puppy, puppies give a lot of love back to their owners.",
        ],
        "review_cards": [
            card("Babies and puppies are actually quite similar when it comes to sounds, sleeping, and loving their parents and owners.", "说到声音、睡眠以及爱自己的父母和主人，婴儿和小狗其实非常相似。"),
            card("While adult dogs might not like human \"baby talk\", puppies do!", "成年狗可能不喜欢人类的“婴儿语”，但小狗喜欢！"),
            card("Many parents use a similar style of baby talk when speaking to their newborns.", "许多父母和新生儿说话时会使用类似的婴儿语方式。"),
            card("Both puppies and babies need and love their sleep!", "小狗和婴儿都需要睡眠，也都喜欢睡觉！"),
            card("Puppies spend about 14 hours of the day sleeping.", "小狗一天大约有十四个小时在睡觉。"),
            card("Compare that to newborn babies who spend 16 to 17 hours per day sleeping.", "相比之下，新生儿每天要睡十六到十七个小时。"),
            card("Puppies, just like babies with their parents, often grow attached to their owners.", "小狗就像依恋父母的婴儿一样，经常会依恋自己的主人。"),
            card("While it takes a lot of time to care for a puppy, puppies give a lot of love back to their owners.", "虽然照顾小狗需要很多时间，但小狗也会回馈给主人很多爱。"),
            card("It's no wonder why so many humans fall in love with their puppies.", "难怪这么多人会爱上自己的小狗。"),
        ],
    },
    {
        "id_hint": "lets-get-a-puppy-speaking",
        "title": "口语课：我们养只小狗吧",
        "summary_zh": "Jane 和 Brandon 讨论是否养小狗、照顾责任以及改养鹦鹉的建议，并配套核心词汇。",
        "selected_content": [
            "Well, you have to walk the dog every day, take him to the vet when he's sick, and feed him when he's hungry.",
            "You also have to train him, which is a lot of work!",
            "I'm going to get us a pet!",
            "Brandon, I don't think buying a pet is a good decision.",
            "You don't know how to take care of a dog.",
            "Why don't you get an animal that's easier to take care of?",
        ],
        "review_cards": [
            card("Hi, Jane.", "嗨，Jane。"),
            card("Guess what?", "你猜怎么着？"),
            card("I'm going to get us a pet!", "我准备给我们养一只宠物！"),
            card("Really?", "真的吗？"),
            card("Brandon, I don't think buying a pet is a good decision.", "Brandon，我觉得买宠物不是一个好决定。"),
            card("Why not?", "为什么不呢？"),
            card("I've always wanted a puppy.", "我一直想养一只小狗。"),
            card("You don't know how to take care of a dog.", "你不知道该怎么照顾狗。"),
            card("It can't be that hard.", "这不可能有那么难。"),
            card("Lots of people have puppies.", "很多人都养小狗。"),
            card("Well, you have to walk the dog every day, take him to the vet when he's sick, and feed him when he's hungry.", "你必须每天遛狗，它生病时带它去看兽医，它饿时给它喂食。"),
            card("You also have to train him, which is a lot of work!", "你还必须训练它，这可是很多工作！"),
            card("You're right.", "你说得对。"),
            card("That does sound like a lot of things to do.", "听起来确实有很多事情要做。"),
            card("Why don't you get an animal that's easier to take care of?", "你为什么不养一种更容易照顾的动物呢？"),
            card("Like what?", "比如什么？"),
            card("Like a parrot.", "比如鹦鹉。"),
            card("Parrots are much easier than dogs to take care of.", "鹦鹉比狗容易照顾得多。"),
            card("That's a really good idea!", "这真是个好主意！"),
            card("walk", "遛；步行", "词汇卡：walk，课程中指遛狗。"),
            card("feed", "喂养", "词汇卡：feed。"),
            card("parrot", "鹦鹉", "词汇卡：parrot。"),
            card("decision", "决定", "词汇卡：decision。"),
            card("train", "训练", "词汇卡：train。"),
            card("take care of somebody or something", "照顾某人或某物", "词组卡：take care of somebody or something。"),
            card("puppy", "小狗；幼犬", "词汇卡：puppy。"),
        ],
    },
    {
        "id_hint": "pet-decision-and-care",
        "title": "综合课：宠物",
        "summary_zh": "Christina 和 Steve 讨论养宠决定、度假期间的照顾安排、选择斗牛犬、训练和兽医信息。",
        "selected_content": [
            "Well, I wanted to ask you for your advice.",
            "What do you do with them when you go on vacation?",
        ],
        "review_cards": [
            card("I have great news, Steve!", "Steve，我有一个好消息！"),
            card("What is it, Christina?", "什么消息，Christina？"),
            card("I have decided to get a pet!", "我已经决定养一只宠物了！"),
            card("Wow, that's a big decision.", "哇，那可是个重大的决定。"),
            card("Are you sure?", "你确定吗？"),
            card("Yes, I'm sure!", "是的，我确定！"),
            card("I have always wanted a pet.", "我一直都想养一只宠物。"),
            card("Who'll take care of your pet when you go on vacation?", "你去度假时，谁来照顾你的宠物？"),
            card("Well, I wanted to ask you for your advice.", "嗯，我正想向你征求建议。"),
            card("You have cats and dogs.", "你养了猫和狗。"),
            card("What do you do with them when you go on vacation?", "你去度假时会怎么安置它们？"),
            card("I take them to my parents' house.", "我会把它们送到我父母家。"),
            card("Okay, maybe my sister can help watch my pet.", "好吧，也许我姐姐可以帮我照看宠物。"),
            card("What kind of pet are you going to get?", "你准备养什么宠物？"),
            card("I really want a bulldog.", "我真的很想养一只斗牛犬。"),
            card("I love the way bulldogs look and I can't wait to cuddle him.", "我喜欢斗牛犬的样子，而且已经等不及要抱抱它了。"),
            card("Him?", "它是公的吗？"),
            card("Yes! I'm going to get a male puppy and call him Buddy.", "是的！我要养一只公的小狗，并给它取名 Buddy。"),
            card("I'm happy for you, but remember that you also need to train Buddy.", "我为你高兴，但要记得你还需要训练 Buddy。"),
            card("I can help you with the training.", "我可以帮你训练它。"),
            card("Thanks, Steve.", "谢谢你，Steve。"),
            card("Oh, I'll also give you my vet's contact information.", "对了，我还会把我的兽医联系方式给你。"),
            card("He is the best vet!", "他是最好的兽医！"),
            card("Awesome! I'll make a great pet parent one day.", "太棒了！总有一天我会成为一名很棒的宠物主人。"),
            card("Of course you will!", "你当然会！"),
            card("When you make a decision, you choose what should be done.", "当你作出决定时，你是在选择应该做什么。"),
            card("Christina has decided to get a pet.", "Christina 已经决定养一只宠物。"),
            card("It's a big decision.", "这是一个重大的决定。"),
        ],
    },
]


def normalize(value: str) -> str:
    value = value.lower().replace("’", "'").replace("—", "-")
    value = re.sub(r"\bfourteen\b", "14", value)
    value = re.sub(r"\bcannot\b", "can't", value)
    value = re.sub(r"\bdo not\b", "don't", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def load_web_server():
    spec = importlib.util.spec_from_file_location("web_server", WEB_SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def canonical_cards() -> list[tuple[str, dict[str, str]]]:
    return [
        (course["id_hint"], review_card)
        for course in COURSES
        for review_card in course["review_cards"]
    ]


def fuzzy_migrations(items: list[dict[str, Any]]) -> list[tuple[str, str, float]]:
    canonical = canonical_cards()
    canonical_norms = {normalize(review_card["item"]) for _, review_card in canonical}
    video_course_ids = {course["id_hint"] for course in COURSES}
    migrations: list[tuple[str, str, float]] = []
    for item in items:
        if item.get("course_id") not in video_course_ids:
            continue
        old_norm = normalize(str(item.get("item") or ""))
        if old_norm in canonical_norms:
            continue
        best_course, best_card = max(
            canonical,
            key=lambda pair: difflib.SequenceMatcher(None, old_norm, normalize(pair[1]["item"])).ratio(),
        )
        score = difflib.SequenceMatcher(None, old_norm, normalize(best_card["item"])).ratio()
        if score >= 0.68:
            migrations.append((item["id"], best_card["item"], score))
    return migrations


def apply_import(dry_run: bool = False) -> dict[str, Any]:
    items = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    migrations = fuzzy_migrations(items)
    print("Fuzzy migrations:")
    for item_id, target, score in migrations:
        old = next(item["item"] for item in items if item["id"] == item_id)
        print(f"  {score:.2f}  {old} -> {target}")
    if dry_run:
        return {"dry_run": True, "migrations": len(migrations)}

    backup_dir = ROOT / "state" / "backups" / "normal-video-full-2026-07-11"
    backup_dir.mkdir(parents=True, exist_ok=True)
    review_backup = backup_dir / "review-items.json"
    courses_backup = backup_dir / "courses.json"
    if not review_backup.exists():
        shutil.copy2(STATE_PATH, review_backup)
    if not courses_backup.exists():
        shutil.copy2(COURSES_PATH, courses_backup)

    target_by_id = {item_id: target for item_id, target, _ in migrations}
    for item in items:
        if item.get("id") in target_by_id:
            item["item"] = target_by_id[item["id"]]
            item["example"] = target_by_id[item["id"]]
    STATE_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    ocr_text = OCR_PATH.read_text(encoding="utf-8") if OCR_PATH.exists() else ""
    analysis = {
        "courses": [
            {
                **{key: value for key, value in course.items() if key != "review_cards"},
                "full_content": course["review_cards"],
                "learned": [review_card["item"] for review_card in course["review_cards"]],
            }
            for course in COURSES
        ]
    }
    web_server = load_web_server()
    result = web_server.record_media_learning_from_ocr(
        ["normal_video.mp4"],
        ocr_text,
        IMPORT_DATE,
        slot="完整课程导入",
        completed="逐帧整理 normal_video.mp4 的全部英语课程内容",
        state_path=STATE_PATH,
        checkins_path=CHECKINS_PATH,
        notes_dir=NOTES_DIR,
        ai_analysis=analysis,
        courses_path=COURSES_PATH,
    )

    updated_items = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    card_lookup = {
        normalize(review_card["item"]): (course["id_hint"], review_card)
        for course in COURSES
        for review_card in course["review_cards"]
    }
    seen: dict[str, dict[str, Any]] = {}
    cleaned: list[dict[str, Any]] = []
    for item in updated_items:
        key = normalize(str(item.get("item") or ""))
        if key not in card_lookup:
            cleaned.append(item)
            continue
        course_id, review_card = card_lookup[key]
        item["course_id"] = course_id
        item["item"] = review_card["item"]
        item["example"] = review_card["example"]
        item["prompt"] = review_card["prompt"]
        item["note"] = review_card["note"]
        if key in seen:
            keeper = seen[key]
            history = [*keeper.get("history", []), *item.get("history", [])]
            keeper["history"] = list({json.dumps(entry, ensure_ascii=False, sort_keys=True): entry for entry in history}.values())
            continue
        seen[key] = item
        cleaned.append(item)

    added_ids = set(result.get("changes", {}).get("added", []))
    item_by_key = {normalize(str(item.get("item") or "")): item for item in cleaned}
    pending_in_course_order = [
        item_by_key[normalize(review_card["item"])]
        for course in COURSES
        for review_card in course["review_cards"]
        if normalize(review_card["item"]) in item_by_key
        and not item_by_key[normalize(review_card["item"])].get("history")
        and item_by_key[normalize(review_card["item"])].get("last_result") == "pending"
    ]
    for index, item in enumerate(pending_in_course_order):
        due = IMPORT_DATE + dt.timedelta(days=1 + index // 10)
        item["next_due"] = due.isoformat()
        item["interval_days"] = max(1, (due - IMPORT_DATE).days)
    STATE_PATH.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    courses = json.loads(COURSES_PATH.read_text(encoding="utf-8"))
    course_by_id = {course["id"]: course for course in courses}
    for order, source in enumerate(COURSES, start=4):
        target = course_by_id[source["id_hint"]]
        selected_keys = {normalize(item) for item in source["selected_content"]}
        target.update(
            {
                "title": source["title"],
                "summary_zh": source["summary_zh"],
                "source_files": ["normal_video.mp4"],
                "learned_on": IMPORT_DATE.isoformat(),
                "order": order,
                "card_ids": [
                    item["id"]
                    for review_card in source["review_cards"]
                    for item in cleaned
                    if normalize(item.get("item", "")) == normalize(review_card["item"])
                ],
                "selected_card_ids": [
                    item["id"]
                    for selected_item in source["selected_content"]
                    for item in cleaned
                    if normalize(item.get("item", "")) == normalize(selected_item)
                    and normalize(item.get("item", "")) in selected_keys
                ],
            }
        )
    COURSES_PATH.write_text(json.dumps(courses, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    archive_path = ROOT / "imports" / "2026-07-11-normal-video-full.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "courses": len(COURSES),
        "cards": sum(len(course["review_cards"]) for course in COURSES),
        "selected_cards": sum(len(course["selected_content"]) for course in COURSES),
        "added": len(added_ids),
        "migrations": len(migrations),
        "note_path": result.get("note_path", ""),
        "archive_path": str(archive_path),
        "backup_dir": str(backup_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(apply_import(args.dry_run), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
