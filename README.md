# English Coach System

目标：到 2026 年底，把英语提升到可以和客户进行正常、流畅、不卡顿沟通的水平，并以流利说 A+ 作为主教材。

## Web 工作台与账号同步

- 本地工作台运行在 `python3 tools/web_server.py --port 8765`，保留截图/录屏导入、Codex 整理和中译英。
- 公网版本通过 GitHub Pages 发布，使用 Supabase 邮箱/密码账号同步课程、复习内容和熟练度。
- 课程默认按熟练度从低到高排列；同分时，待复习更多的课程排在前面。
- 个人学习数据、上传文件、笔记和环境变量都由 `.gitignore` 排除，不进入公开 GitHub 仓库。

首次上线时，在 Supabase SQL Editor 执行 `supabase/english_coach.sql`，并为 GitHub Actions 配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。本机也可把同名变量放进 `.env.local`，登录后会把现有课程迁移到账号。

验证命令：

```bash
python3 -m unittest tests.test_coach -v
pnpm test
pnpm build:pages
```

## 每日固定节奏

| 时间 | 场景 | 时长 | 训练重点 | 是否开口 |
| --- | --- | ---: | --- | --- |
| 08:30 | 早地铁 | 25 分钟 | 复习到期内容、A+ 预习、听力输入、客户词块默想 | 否 |
| 12:30 | 午间 | 5-10 分钟 | 轻量复习考察，优先处理未掌握内容 | 否 |
| 18:30 | 晚地铁 | 25 分钟 | 晚上口语训练预热、句型组织、场景问答默想 | 否 |
| 21:30 | 夜练 | 40 分钟 | A+ 主课程、跟读发音、客户场景输出 | 是 |

## 每次提醒时我会做什么

1. 根据当前时间，只安排当下要完成的任务。
2. 优先读取你上次的打卡结果和复习队列。
3. 对没掌握的内容安排再次考察。
4. 给出很短的任务清单，让你不用重新规划。
5. 学完后提醒你用模板回传结果。

## 复习调度规则

| 本次结果 | 下一次复习 | 后续规则 |
| --- | --- | --- |
| 不会 | 明天 | 连续不会就继续隔天考，并改成更简单例句 |
| 不熟 | 明天 | 通过后进入 2 天复查 |
| 会 | 2 天后 | 连续通过后拉长到 4、7、14、30 天 |
| 复查失败 | 明天 | 间隔缩短，重新进入强化复习 |

复习内容不只记单词，重点记录可以直接和客户沟通的词块和句子，例如：

- Could you clarify what you mean by ...
- Let me confirm my understanding.
- The current blocker is ...
- We can deliver it by Friday if ...

结构化复习队列保存在 `state/review-items.json`，第一周时段计划保存在 `state/daily-plan.json`，阶段时段模板保存在 `state/slot-templates.json`，年底路线保存在 `state/roadmap.json`，个人档案保存在 `state/profile.json`，手机提醒文案保存在 `state/mobile-reminders.json`，本地脚本在 `tools/coach.py`。

日常使用优先打开学习页面：`web/index.html`。页面里有当前时段学习内容、客户沟通词块、复习考察和学习回传生成。

常用命令：

```bash
python3 english-coach/tools/coach.py task --date 2026-06-29 --time 08:30
python3 english-coach/tools/coach.py quiz --date 2026-06-30
python3 english-coach/tools/coach.py status --date 2026-06-29
python3 english-coach/tools/coach.py report --date 2026-07-05 --days 7
python3 english-coach/tools/coach.py reminders
python3 english-coach/tools/coach.py profile
python3 english-coach/tools/coach.py due --date 2026-06-30
python3 english-coach/tools/coach.py checkin --date 2026-06-30 --text "时间段：午间
完成：词块复习
不熟：clarify-this-part
不会：current-blocker"
python3 english-coach/tools/coach.py review confirm-understanding pass --date 2026-06-30
python3 english-coach/tools/coach.py review clarify-this-part shaky --date 2026-06-30
python3 english-coach/tools/coach.py review current-status fail --date 2026-06-30
```

`task` 命令会同时输出：

- 本时段任务：来自 `state/daily-plan.json`。
- 阶段兜底任务：如果当天没有每日计划，则根据 `state/roadmap.json` 的当前阶段和 `state/slot-templates.json` 的时段模板生成。
- 到期复习：来自 `state/review-items.json`。
- 学完回传模板：方便手机上直接照着发。

`quiz` 命令会把到期复习项变成可直接做的考察题：先遮住英文回忆，再看例句确认，最后标记 `会 / 不熟 / 不会`。

`status` 命令会输出当前阶段、阶段重点、阶段检查标准和到期复习数量，用于周复盘或月复盘。

`report` 命令会读取 `state/checkins.jsonl` 和 `state/review-items.json`，输出最近几天的打卡次数、高频薄弱项、到期复习和下一步建议。

`profile` 命令会输出你的年底目标、固定提醒时间、已知学习约束和仍需补充的问题。后续如果你告诉我当前流利说等级、客户沟通场景、工作行业或最卡的能力项，我会优先同步到 `state/profile.json`。

`checkin` 命令会同时写入结构化日志和每日 Markdown 笔记：

- `state/checkins.jsonl`：机器可读，用于复习调度和报告。
- `notes/YYYY-MM-DD.md`：人可读，用于回看每次学习总结。

`reminders` 命令会输出适合复制到 ChatGPT 手机 App、手机日历或提醒事项的 4 段每日提醒文案。手机端具体设置步骤见 `mobile-setup.md`。

## 年底路线

| 阶段 | 时间 | 重点 | 检查标准 |
| --- | --- | --- | --- |
| 基础节奏和客户词块 | 2026-06-29 至 2026-07-31 | 每日节奏、A+ 起步、确认理解/追问/进度词块 | 能完成 1 分钟自我介绍和 1 分钟项目进度说明 |
| 客户问答和需求确认 | 2026-08-01 至 2026-08-31 | 需求变化、追问、复述确认 | 能围绕一个需求做 5 轮英文问答 |
| 会议表达和项目汇报 | 2026-09-01 至 2026-09-30 | daily update、会议插话、总结 | 能做 3 分钟项目汇报并回答 3 个追问 |
| 问题、风险和时间协商 | 2026-10-01 至 2026-10-31 | blocker、issue、risk、延期说明 | 能说明一个延期或阻塞并给出下一步 |
| 流畅度和真实场景迁移 | 2026-11-01 至 2026-11-30 | 减少卡顿、真实工作话题迁移 | 能连续 8-10 分钟客户场景模拟 |
| Level 4 冲刺和客户模拟 | 2026-12-01 至 2026-12-31 | 高频客户模拟、听说联动、临场补救 | 完成至少 4 次 10 分钟客户模拟对话 |

结果含义：

- `pass`：会用，进入更长间隔。
- `shaky`：不熟，明天继续。
- `fail`：不会，明天继续，并需要换更简单例句。

打卡同步规则：

- `不熟` 里的已有复习项会自动记录为 `shaky`，明天复习。
- `不会` 里的已有复习项会自动记录为 `fail`，明天复习。
- `不熟` / `不会` 里出现的新表达会自动加入复习队列，明天开始考察。
- 如果想明确更新某个旧项目，优先写复习项 id，例如 `clarify-this-part`。

## 手机同步方式

推荐直接打开 GitHub Pages 网站并登录同一账号，课程和复习进度会自动同步。需要从截图或录屏创建新课程时，仍在 Mac 本地工作台导入；整理完成后会同步到手机。

Codex 打卡流程仍可作为补充：

1. 手机收到提醒。
2. 按提醒完成当次任务。
3. 在手机上把学习情况发回这个 Codex 线程，或先发给 ChatGPT 再粘贴同步。
4. 我用 `coach.py checkin` 把这次学习记录进 `state/checkins.jsonl`。
5. 我把本次总结追加到 `notes/YYYY-MM-DD.md`。
6. 我把薄弱项整理进复习队列，并安排下一次任务。

已经在 Codex 中配置了一个每日家教提醒，默认北京时间：

- 08:30
- 12:30
- 18:30
- 21:30

如果需要手机系统推送，建议在 ChatGPT 手机 App 里额外创建相同时间的 Scheduled Tasks，并开启 App 通知权限。Codex 负责长期学习档案和复习调度，ChatGPT 手机 App 负责更稳的手机通知。

详细设置见 `mobile-setup.md`。可复制的提醒文案由：

```bash
python3 english-coach/tools/coach.py reminders
```

生成。

## 你只需要回传的最小格式

```text
时间段：
A+课程：
完成了：
卡住了：
今天新学：
自评：听力__/3，表达__/3，发音__/3，词块__/3
```

很忙时可以只发一句：

```text
晚练完成 A+ 第 1 课，30 秒项目进展说明，blocker 不熟，schedule risk 不会
```

一句话回传会保守识别明确的 `完成`、`不熟`、`不稳`、`不会`、`卡住` 标记；没有这些标记的内容只会作为普通描述保留在原始记录里。

如果按字段发，我能自动提取更多信息：

```text
时间段：夜练
完成：A+ 第 1 课，30 秒自我介绍
不熟：clarify-this-part, current-status
不会：current-blocker
```

如果你学到了新的薄弱表达，也可以直接写：

```text
时间段：夜练
完成：A+ 第 2 课
不熟：handover the task
不会：explain schedule risk
```

这两个新表达会自动加入复习队列，并从明天开始复习。
