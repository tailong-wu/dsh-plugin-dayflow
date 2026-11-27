# dsh-plugin-dayflow

[![CI](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml/badge.svg)](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen.svg)](https://nodejs.org)

[English](README.md) | 中文

> 深入文档为英文：下文链接指向 `docs/` 下的英文页面。

把你的工作日志交给 AI。这个插件为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）
提供原生工具、技能和一个 Web 面板，数据来自开源 Mac 应用 [Dayflow](https://github.com/JerryZLiu/Dayflow)：
它把屏幕活动变成保存在本机的私有时间线，记录前台是什么、持续多久。插件读 Dayflow 的本地数据库，
也读从它一次性导入、由插件自有的日志；除非你显式开启 cloud analysis，插件不会把数据发离这台 Mac。

> “我今天做了什么？” · “这周屏幕时间都去哪了？” · “帮我写今天的 standup。”

![dsh Web GUI 中的 Dayflow 面板：月历圆环、带悬停卡片的周泳道，以及展开的一天](docs/demo.zh.gif)

> **状态：** `v0.9.2` 已在仓库打 tag，是当前最新的 GitHub Release；npm registry 仍然返回 `404`，
> 即尚未发布——D7 已授权发布，但它是在 tag 之后单独执行、需 owner 确认版本的一步。0.9.x 线加了
> 月/周目标与评分标记（`v0.9.0`）、close 历史块（`v0.9.1`），以及一个兼容性 patch（`v0.9.2`：
> 声明并构建/测试于 DSH `0.2.2-rc.5`，不改变行为、默认值、schema、路由、peer 范围或运行时依赖）。
> **0.10.0 线实现中、尚未 tag**：cloud analysis 加可选的具名分析模型列表（`analysis.models`，即 D2 的
> A 基线——B/C 形态仍待 owner 决定）；图像 admit（D11）与 `source: owned` cutover（D10）继续推迟。
> 请从源码 checkout 安装；详见
> [CHANGELOG.md](CHANGELOG.md) 与 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 它是什么

Dayflow 只看屏幕：前台是哪个应用或网站、上面有什么、持续了多久。数据就只有这些。

- 它**不知道**你人在哪、是否坐在工位前、和谁在一起，也不知道 Mac 空闲或合盖期间发生了什么。
  这里没有位置、日历或在场数据，系统提示词要求模型直说“无法回答”，而不是猜。
- 安静的一段时间记成 `Idle`，含义是**没有采集到屏幕活动**——不等于休息、开会或请假。
  某天没有活动卡片，同样可能是开了一天会、整天不在，或者录屏还在分析。
- 统计排除 `System` 分类，且只是“采集到的屏幕时长”，不是一天的总时长。一天是本地时间凌晨 4 点到
  4 点，所以凌晨的工作算在前一天；导入的自有日志也要在相同时区读取，跨午夜才精确。

## 你会得到什么

- **23 个工具**（`edits: false` 时 17 个）：12 个只读工具，加上 `journal_import`、`journal_review`、`journal_task`、
  `journal_memory`、`journal_reflection` 和 6 个编辑工具。全表 → [docs/TOOLS.md](docs/TOOLS.md)。
- **8 个技能**：`dayflow`、`onboarding`、`standup`、`weekly-review`、`review-queue`、`long-task`、`memory`、`reflection`。
- **可选 Web 面板**：月历分段圆环、周泳道、日视图，以及 **Journal insights（洞察）** 视图；只有一个头部按钮、
  一个标签页和 18 条 host Fetch 路由。月视图与周泳道也会标出用户自己设置的当日目标（day goal）与回顾标记
  （review ratings）——只读，与日视图显示的是同一份记录，不新增请求或路由。回顾队列可在面板里直接决定，
  任务 session 可直接关联或解绑，无需 agent turn。细节 → [docs/PANEL.md](docs/PANEL.md)。
- **快速记录**：三条斜杠命令（`/dayflow-task`、`/dayflow-remember`、`/dayflow-reflect`），洞察视图里的内联添加行，
  以及新建任务后的历史扫描与关联。→ [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md)。
- **共 5 条斜杠命令**：上述三条快速记录命令，加上 `/dayflow-analyze`（手动跑一次分析 tick）和
  `/dayflow-run-close`（手动触发一次日/周收盘）。
- **预算化记忆上下文**：active 长任务与最近的带日期记忆 claim 会注入，硬上限 1000 字节、60 秒缓存；
  没有值得说的内容时完全不注入。
- **原生采集（预览）**：Phase 1 把帧写入自有日志，默认关闭；0.7.1 补上 consent 门禁后的分析管线，
  0.7.2 让它跑在宿主的模型服务上，并在面板里显示状态行。0.7.4 加上纯文本自动化：日收盘在 04:00、
  周收盘在周一，失败重试、默认补收盘 2 天，并把 standup、当日反思、一条周 brief、回顾提案和任务 session
  写入自有日志（存下的 week brief 就是压缩后的周记录，没有 weekly reflection）。0.8.0 收掉 analysis
  ledger 的三个缺口——token 预算变成调用后的硬门禁、配置原因导致的 skip 可在今天/昨天内重放、04:00 边界
  补一次有界的 day-tail run。0.8.1 让已保存的 day/week briefs 可在洞察视图里阅读（见下方 Web 面板一节），
  0.8.4 是 release close：只做文档、测试与发布记录对账——不改插件源码、schema、路由、配置或默认值。这些功能随
  analysis 栈挂载，并受 `analysis.consent` 与显式的有效 provider/model 对（旧 `analysis.provider`/
  `analysis.model`，或 0.10.0 中 `analysis.models` 选中的条目）门禁。
  → [docs/NATIVE_CAPTURE.md](docs/NATIVE_CAPTURE.md)。
- **除 `dsh` 外零运行时依赖**：SQLite 来自 `node:sqlite`；Dayflow 编辑走应用的本地 Unix socket，自建日志则写自己的 SQLite 文件。

深入文档（英文）：[工具](docs/TOOLS.md) · [面板](docs/PANEL.md) · [快速记录](docs/QUICK_CAPTURE.md) ·
[配置](docs/CONFIGURATION.md) · [providers](docs/PROVIDERS.md) · [架构](docs/ARCHITECTURE.md) ·
[原生采集](docs/NATIVE_CAPTURE.md) · [原生移植计划](docs/NATIVE_PORT.md) ·
[cutover 预演](docs/CUTOVER_REHEARSAL.md) · [路线图](docs/ROADMAP.md)。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| macOS | Dayflow 是 Mac 应用，数据在 `~/Library/Application Support/Dayflow`。 |
| 已安装并正在记录的 [Dayflow](https://dayflow.so) | 插件会检测缺失并逐步引导；开启 `allowInstall` 后，经你同意可以由 agent 执行 `brew install --cask dayflow`。 |
| Node.js ≥ 22.5 | Node 22.5–22.12 与 23.0–23.3 需要 `--experimental-sqlite`；Node 22.13+ 与 23.4+（含 24）无需该参数。 |
| `dsh` ≥ 0.2.0-rc.2 | 插件声明的 peer 范围是 harness 0.2 系列。声明兼容的版本为 `0.2.0-rc.2`、`0.2.1-rc.2` 与 `0.2.2-rc.5`；当前版本构建/测试于 `0.2.2-rc.5`。只有 `dsh plugin add` 需要 `PATH` 里有 `pnpm`。 |

0.7.x 与 0.8.x 线**都没有**在声明范围之外新增 host peer：`@deepseek-ai/dsh-llm` 本来就是已声明的
peer，也是分析路径唯一调用的 host 服务；所有已交付的版本都保持 text-only，所以 `@deepseek-ai/dsh-attachment`
**不是**依赖。0.8.x 与 0.9.x 线也没有新增任何运行时依赖——0.8.0–0.8.4 各版本之间只有 package 版本号不同；
0.9.2 只改兼容性声明表、devDependencies 版本（DSH 各包升到 `0.2.2-rc.5`，`cordis` 升到 `4.1.0`）
以及一处纯类型标注，`peerDependencies` 范围保持不变。0.10.0 线（实现中）同样不新增 host peer 或运行时依赖：
`analysis.models` 只是一种配置形态，所有已交付调用仍保持 text-only。需要该附件服务的图像 admit
（image admission）在 D11 未决前继续推迟。

## 安装

npm registry 上还没有任何版本——包名返回 `404`——但本线已在本仓库打 tag 至 `v0.9.2`（`v0.8.0`、`v0.8.1`、
`v0.8.4`、`v0.9.0`、`v0.9.1`、`v0.9.2`；完整 trail 见 [CHANGELOG.md](CHANGELOG.md)）。请从源码 checkout 安装：那装的正是本文描述的开发线。等 owner 授权 npm 发布（D7）之后，再执行
`dsh plugin --profile web add dsh-plugin-dayflow`。

### Desktop App

桌面 App 使用自己的 `desktop` profile，装在 CLI 的 `web` profile 里对它无效。把 checkout 链接进
App 的 profile、记录 bundle，然后退出并重开 App：

```sh
mkdir -p ~/.dsh/profiles/desktop/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-dayflow
```

再在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里加
`"dsh-plugin-dayflow": "link:<路径>"`，在 `dsh.profile.bundles` 里加 `"dsh-plugin-dayflow"`。

### 从源码安装

```sh
git clone https://github.com/tailong-wu/dsh-plugin-dayflow.git
cd dsh-plugin-dayflow
npm install && npm run build

# 链接进 profile，并记录 bundle 选择。
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-dayflow
```

在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中加入 `"dsh-plugin-dayflow"`。
开启 HMR 的 profile（默认开启）会自动重载，否则重启 `dsh web`。改完源码后重新 `npm run build`；
卸载只需删除软链接和 bundles 条目。支持的 DSH 版本是 `0.2.0-rc.2`、`0.2.1-rc.2` 与 `0.2.2-rc.5`
（当前版本构建/测试于 `0.2.2-rc.5`）；面板自身的视图见 [docs/PANEL.md](docs/PANEL.md)。

Dayflow 应用本身另算：`dayflow_status` 会说明还缺什么，`onboarding` 技能按顺序引导。
让 agent 安装应用需要双重 opt-in（`allowInstall` + `source: dayflow`），并且仍要
`confirm: true`。完整流程见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#setting-dayflow-up)。

## 快速开始

```text
我今天完成了什么？
这周屏幕时间都花在哪了？
把昨天的记录整理成 standup。
你还记得我一般怎样安排一周吗？
```

## Web 面板

插件可以把月、周和某一天画在 dsh Web 里。面板在两层意义上都是可选的：不打开就不出现，
profile 也可以把入口整个关掉。

![dsh 右侧栏中的 Dayflow 月历](docs/panel.zh.png)

- 从对话头部的 **Dayflow** 按钮打开，头部空间不够时收成图标；所有内容都是同一个面板标签页里的视图。
- **18 条 host Fetch 路由**支撑这些视图：月、周、日、洞察、启用探测和图标，加上三条内联添加、
  历史扫描与关联、回顾决定与任务 session 的 attach/detach、采集状态与暂停，以及 analysis 与
  automation 状态行。面板自己从不直接访问数据库。
- **不会把缺失数据画成零活动**：没有录屏的日期画淡点线，有录屏但无活动的日期画浅色轨道，
  分析排队中的日期显示琥珀色脉冲，有记录的日期才画彩色弧段。
- **Journal insights（洞察）** 是第三个视图：进行中的长任务（含进度与停滞标记）、待决回顾队列、
  最近的带日期记忆 claim、已保存的反思，以及三条紧凑状态行（采集、analysis 和定时收盘）。任务、记忆和
  反思块都支持内联添加，回顾队列与任务 session 则可在面板内就地决定/解绑，不需要 agent turn。视图还能
  阅读已保存的 day/week **briefs**：折叠行展开就是正文，周 brief 的记忆健康摘要也在正文内；以及最近的
  **收盘记录**（定时日收盘、周收盘和每周检查的状态、尝试次数与错误），全部只读，仍然只有一个标签页、
  一个头部按钮和 18 条 host Fetch 路由。

![面板中展开的一天](docs/day.zh.png)

所有截图与录像都来自本项目自己一周的真实 Dayflow 数据，标题为虚构、站点映射成中性域名；
完整的视图参考与路由清单见 [docs/PANEL.md](docs/PANEL.md)，`scripts/demo/` 流程见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#demo-recordings)。

## 自有日志、记忆与洞察

插件拥有第二个可移植的 SQLite 日志（schema **v10**，自 0.7.5 起未变），Dayflow 仍是默认数据源。先用 `journal_import`
导入一次，再把 profile 切到 `source: owned`：源库只读打开、导入幂等，现有工具与面板载荷不变。

- **回顾队列**：distillation、重复出现的 loop、改进建议和 task proposal——agent 只提议，用户在面板里
  或通过工具决定。
- **长任务**带按日 session、停滞标记和可解释的 `suggest`；另有**带日期的记忆** claim、可保存的**反思**
  （按日或按周，由 agent 或你通过 `journal_reflection` 写入），以及注入系统提示词的预算化上下文。
- 洞察视图里的历史**扫描**（最近 14 天）加**关联**是同一套证据链的用户侧入口：先预览，
  只写入用户确认的日期，已关联的日期还能在面板里**解绑**（Unlink）。

存储、后端与写入路径见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；
快速记录的捷径见 [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md)。

## 原生采集（预览）

Phase 0 与 Phase 1 已落地：配置、采集状态（0.7.0 中为 schema v7）、macOS 原生 provider，以及默认关闭的
`capture.enabled` 背后的采集引擎。引擎按间隔把帧写入自有日志，跳过暂停、锁屏、空闲和暂停应用的
tick，对近似帧去重并执行保留清理。0.7.1 补上分析管线：consent 门禁、幂等的「帧 →
`activities`/`observations`」写入（schema v8 `analysis_jobs`），并已用 fake adapter 零网络验证。

0.7.2 让它真正运行并可见，**仍然是纯文本**：当 `capture.enabled` 与 `analysis.enabled` 同时开启、且宿主的
模型服务可用时，analysis worker 按 `analysis.intervalMinutes`（默认 5）tick，通过宿主调用配置的
`analysis.provider`/`analysis.model`，并把每个窗口的调用与 token 用量记进当天的预算账本。Journal insights
面板在采集行下方新增只读的 **analysis 行**：分析未启用、等待 consent、缺 provider/model、随采集暂停、
运行中、空闲或 worker 未运行，并带当天失败数、调用/token 预算和上次任务时间；
`GET /api/dayflow/analysis/status` 返回同一组数字；设置授权后，该行还会说明离开机器的内容：
只有前台 app、窗口标题和帧 hash，不含图像。`/dayflow-analyze` 用同一门禁手动跑一次 tick；面板里
没有按钮，分析仍在 profile 里开启，面板保持单入口。默认 profile 依旧不分析：`analysis.consent: 'none'`
拦下所有调用，`cloud`/`local` 授权必须显式配置 provider 与 model，且进入模型的只是 app / 窗口标题 / hash
元数据而不是图像字节。采集本身仍然默认关闭。

0.7.4 补上**纯文本自动化**：schema v9（`automation_runs` 与 `briefs`）、在 `automation.dailyAt`
（默认 04:00）收盘 Dayflow 的一天、在 `automation.weeklyOn`（默认周一）收盘一周的调度器，以及收盘后的洞察
pass：写入当天的 **standup 条目**、当日 **反思**、一条周 **brief**（存下的 week brief 就是压缩后的周记录，
没有 weekly reflection，也没有 weekly review pass）、最多三条**回顾提案**、仅在证据持久时写入
**kept 记忆 claim**，以及匹配的**任务 session**。它随 analysis 栈挂载——与 worker 相同的
`capture.enabled` + `analysis.enabled` + 宿主模型服务门禁——所以默认 profile（采集关闭）不会跑收盘
job；挂载后，收盘还需要 `cloud`/`local` consent 加上显式 provider 与 model，否则记为 `skipped`、
不调用模型。失败的收盘按两次尝试上限重试，`automation.catchUpDays`（默认 2，范围 1–30）限制下次启动
最多补收盘多少天，更早的记为 `skipped` 而不重放；同一天重复收盘通过 `automation_runs` 保持幂等。
`/dayflow-run-close` 手动触发一次收盘；Journal insights 在 analysis 行下方新增紧凑的 **close-state 行**
（`日收盘 04:00 · 上次收盘 … · 周收盘 周一 · 补收盘 2 天`）；`GET /api/dayflow/automation/status` 返回同一份
日程与最近收盘数据。schema 变更纯属新增：既有表与面板 payload 都不变。

0.7.5 把每周 **memory lint** 并入周收盘：跑一次只读 claim 检查，每个 claim 每周最多生成一条回顾提案，
绝不修改、取代或遗忘 claim，并把一段简短的记忆健康摘要写进当周 brief——schema v10 重建
`automation_runs` 以记录 `lint` job，并给 `briefs` 加上存 digest 的 `payload_json` 列，不新增路由、
命令或配置键。

0.8.0 收掉 analysis ledger 的三个缺口，仍然是纯文本，也不新增 schema、路由、命令、工具、技能或配置键。
**token 预算现在是硬门禁**：pipeline 在窗口开始前与每次调用完成后各读一次当天已记录的 input+output
token，一旦达到 `analysis.dailyTokenBudget`，本次 run 剩余窗口全部跳过、原因记为 `budget-tokens`——
越线的那次调用已经花掉、不回滚，同一天再跑会在调用前就拒绝新窗口。**调用数上限仍是调用前门禁**
（原因 `budget`），两者在账本里始终可区分。**被跳过的窗口不再一律是终态**：每次非 blocked 的 run 之后，
`src/analyse/skips.ts` 的有界重放会把今天与昨天因配置导致的 skip 重新排队——analysis 或 capture
关闭、暂停、`consent: none`、缺 provider/model/analyser，或在 `consent: local` 下 provider 不在
本地列表——attempts 不重置，旧原因写进 job 的 `payload_json` 留审计；`budget`、`budget-tokens`、
`failed` 和未知原因永不重放。**04:00 day tail** 补上边界缺口：在这次重放之后，worker 对昨天再跑一次
有界的 pipeline run（同一次 tick 内），每天只跑一次（checkpoint `analysis_tail_checked_on`），
blocked 时不写 checkpoint 以便当天重试，tail 失败不改变今天的结果。analysis status payload 新增
`tokenBudgetExhausted`，面板 analysis 行在其为真时转为琥珀状态并显示「今日 token 预算已用尽」——
仍然没有新路由、没有按钮，默认 profile 依旧不发起任何模型调用。

0.10.0（实现中、尚未 tag）让 cloud 路径可以配置**具名模型列表**，仍然是纯文本：`analysis.models` 是可选列表，
含 1–8 个 `{id, provider, model, label?}` 条目。列表缺失或为空时，旧 `analysis.provider`/`analysis.model`
这对键完全按现状工作；有列表时默认第一条生效，`analysis.model` 可改选另一个条目的 `id`，此时 `analysis.provider`
必须为空；未知/重复/空白的 id、空的 provider 或 model、以及列表与非空 provider 并存，都会在加载时以
`invalid_input` 拒绝，而不是静默回退到别的模型。选中条目的
provider/model 对会交给 frame analyser 与定时收盘，仍走同一道 consent 门禁和同一本账本；analysis 状态行与
`GET /api/dayflow/analysis/status` 只读地显示当前生效的模型——条目的 label，或有效的 provider/model。provider
路由与凭据位于宿主 profile，绝不进入本插件 → [docs/PROVIDERS.md](docs/PROVIDERS.md)。

本地验证（不碰真实数据）：

```sh
npm run native:smoke         # 只测 provider：权限、帧、尺寸
npm run native:engine-smoke  # 用临时日志和帧目录驱动引擎
```

细节与状态/暂停路由 → [docs/NATIVE_CAPTURE.md](docs/NATIVE_CAPTURE.md)；
完整授权模型、阶段与计划 → [docs/NATIVE_PORT.md](docs/NATIVE_PORT.md)。

## 配置

在 profile patch 里按插件行配置，或直接修改 `cordis.patch.yml` 中的默认值：

```yaml
- id: dayflow
  config:
    source: dayflow      # 导入后也可以选 owned
    journalPath: ''      # 默认：$DSH_HOME/dayflow/journal.sqlite
    edits: true          # 注册 6 个编辑工具
    skills: true         # 注册 8 个技能
    panel: true          # 可选的 Web 面板与头部按钮
    icons: true          # 站点图标（插件唯一的对外请求）
    memoryContext: true  # 注入预算化的长任务/记忆上下文
    allowInstall: false  # 注册 dayflow_install_dayflow（会改动本机）
    searchLimit: 50      # 单次 dayflow_search 最大结果数（1–200）
    capture:
      enabled: false     # 原生采集引擎，默认关闭
    analysis:
      consent: cloud     # 默认 none：没有它不会发起任何模型调用
      models:            # 可选；缺失/为空时走旧 provider/model 对
        - id: flash      # analysis.model 用它来选中条目
          provider: deepseek        # 宿主 profile 里注册的 route 名
          model: deepseek-flash     # 该 route 上的 model id
          label: DeepSeek Flash     # 可选
        - id: pro
          provider: deepseek
          model: deepseek-v4-pro
      model: flash       # 可选条目 id；为空则选第一条
      # provider: ''     # models 非空时必须保持为空
```

当 `databasePath` 为空时，`DAYFLOW_DB` 会覆盖 Dayflow 路径。所有键、默认值以及
capture/analysis/automation 配置块见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)；
`analysis.models` 缺失或为空时以旧 `analysis.provider`/`analysis.model` 为选择，宿主侧 provider 路由与
凭据配置见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 隐私与安全

- 数据不会通过本插件离开这台 Mac：只读一个本地 SQLite 文件、只连一个本地 Unix socket。
- 屏幕内容生成的文本（标题、摘要、长描述）是**数据**：工具描述与系统提示词都写明这一点，
  避免模型被活动标题里的文字“注入”。
- 删除活动会连带删除 observations，无法完全恢复；工具要求先确认，且只有用户本人能打开
  Dayflow 的编辑开关。
- 原生采集默认关闭，帧只写入 `$DSH_HOME/dayflow/frames/`（目录 `0700`、文件 `0600`），
  有保留清理；只有在采集与分析都开启时分析才会 tick，未设置 `cloud` 授权与显式 provider/model 对
  （旧对，或 `analysis.models` 中选中的条目）前也不会外发。
- 面板的 favicon 抓取是唯一的对外请求：每个域名一次 `favicon.ico`，不带 cookie 与 referrer，
  拒绝 loopback 与裸 IP；设 `icons: false` 可完全关闭。

## 开发

```sh
npm install
npm run build                # TypeScript → lib/，以及 client bundle
npm test                     # 构建、类型检查并运行 583 个测试
npm run typecheck            # 同时类型检查源码与测试
npm run smoke                # 读取本机真实 Dayflow 数据库
npm run native:smoke         # 只测采集 provider，不写入任何数据
npm run native:engine-smoke  # 用临时日志驱动采集引擎
npm run rehearsal            # 仅 fixture 的 Phase 4 cutover 预演（不抓屏、不联网）
npm run demo                 # 重新生成面板截图与 GIF
```

目录结构、demo 流程与测试 fixture 见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，
贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `No Dayflow database at …` | 打开 Dayflow，完成引导，记录几分钟。 |
| `Editing is off…` | Dayflow → 设置 → AI Tools → Allow edits。 |
| `Dayflow isn't running…` | 编辑需要应用在运行；读取不需要。 |
| `This Node.js (…) has no built-in SQLite` | 换 Node 22.13+/23.4+（含 24），或给 Node 22.5–22.12/23.0–23.3 加 `--experimental-sqlite`。 |
| 时间数据缺失或差几个小时 | 分析分批进行（`dayflow_status` 可见积压），且插件使用 Mac 本地时区。 |

面板问题（头部没有按钮、重启后连不上服务）见 [docs/PANEL.md](docs/PANEL.md)。

## 许可证

MIT。本项目移植了 Dayflow 的 agent 接口，与 Dayflow 项目没有隶属关系。Dayflow 采用 MIT 许可，
© 2025 Jerry Liu；改编的技能与工具契约的署名见 [LICENSE](LICENSE)。
