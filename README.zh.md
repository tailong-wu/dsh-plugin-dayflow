# dsh-plugin-dayflow

[![CI](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml/badge.svg)](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen.svg)](https://nodejs.org)

[English](README.md) | 中文

> 深入文档为英文：下文链接指向 `docs/` 下的英文页面。

把你的工作日志交给 AI。这个插件为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）
提供原生工具、技能和一个 Web 面板，数据来自开源 Mac 应用 [Dayflow](https://github.com/JerryZLiu/Dayflow)：
它把屏幕活动变成保存在本机的私有时间线，记录前台是什么、持续多久。插件读 Dayflow 的本地数据库，
也读从它一次性导入、由插件自有的日志；数据不离开这台 Mac。

> “我今天做了什么？” · “这周屏幕时间都去哪了？” · “帮我写今天的 standup。”

![dsh Web GUI 中的 Dayflow 面板：月历圆环、带悬停卡片的周泳道，以及展开的一天](docs/demo.zh.gif)

> **状态：** `v0.7.2` 已在仓库打 tag，但尚未发布到 npm registry；`main` 是本文描述的 `0.7.x` patch 线
> ——请从源码 checkout 安装；详见 [CHANGELOG.md](CHANGELOG.md) 与 [docs/ROADMAP.md](docs/ROADMAP.md)。

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
  一个标签页和 14 条 host Fetch 路由。细节 → [docs/PANEL.md](docs/PANEL.md)。
- **快速记录**：三条斜杠命令（`/dayflow-task`、`/dayflow-remember`、`/dayflow-reflect`），洞察视图里的内联添加行，
  以及新建任务后的历史扫描与关联。→ [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md)。
- **预算化记忆上下文**：active 长任务与最近的带日期记忆 claim 会注入，硬上限 1000 字节、60 秒缓存；
  没有值得说的内容时完全不注入。
- **原生采集（预览）**：Phase 1 把帧写入自有日志，默认关闭；0.7.1 补上 consent 门禁后的分析管线，
  0.7.2 让它跑在宿主的模型服务上，并在面板里显示状态行——默认 profile 仍然不会分析。
  → [docs/NATIVE_CAPTURE.md](docs/NATIVE_CAPTURE.md)。
- **除 `dsh` 外零运行时依赖**：SQLite 来自 `node:sqlite`；Dayflow 编辑走应用的本地 Unix socket，自建日志则写自己的 SQLite 文件。

深入文档（英文）：[工具](docs/TOOLS.md) · [面板](docs/PANEL.md) · [快速记录](docs/QUICK_CAPTURE.md) ·
[配置](docs/CONFIGURATION.md) · [架构](docs/ARCHITECTURE.md) · [原生采集](docs/NATIVE_CAPTURE.md) ·
[原生移植计划](docs/NATIVE_PORT.md) · [路线图](docs/ROADMAP.md)。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| macOS | Dayflow 是 Mac 应用，数据在 `~/Library/Application Support/Dayflow`。 |
| 已安装并正在记录的 [Dayflow](https://dayflow.so) | 插件会检测缺失并逐步引导；开启 `allowInstall` 后，经你同意可以由 agent 执行 `brew install --cask dayflow`。 |
| Node.js ≥ 22.5 | Node 22.5–22.12 与 23.0–23.3 需要 `--experimental-sqlite`；Node 22.13+ 与 23.4+（含 24）无需该参数。 |
| `dsh` ≥ 0.2.0-rc.2 | 插件声明的 peer 范围是 harness 0.2 系列；只有 `dsh plugin add` 需要 `PATH` 里有 `pnpm`。 |

## 安装

`0.7.0` 还没有发布到 registry。在那之前请从源码 checkout 安装——那装的正是本文描述的开发线；
发布之后执行 `dsh plugin --profile web add dsh-plugin-dayflow` 即可。

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
卸载只需删除软链接和 bundles 条目。支持的 DSH 版本是 `0.2.0-rc.2` 与 `0.2.1-rc.2`；
面板自身的视图见 [docs/PANEL.md](docs/PANEL.md)。

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
- **13 条 host Fetch 路由**支撑这些视图：月、周、日、洞察、启用探测和图标，加上三条内联添加、
  历史扫描与关联、采集状态与暂停。面板自己从不直接访问数据库。
- **不会把缺失数据画成零活动**：没有录屏的日期画淡点线，有录屏但无活动的日期画浅色轨道，
  分析排队中的日期显示琥珀色脉冲，有记录的日期才画彩色弧段。
- **Journal insights（洞察）** 是第三个视图：进行中的长任务（含进度与停滞标记）、待决回顾队列、
  最近的带日期记忆 claim、已保存的反思，以及一条紧凑的采集状态行；除内联添加外它是只读的。

![面板中展开的一天](docs/day.zh.png)

所有截图与录像都来自本项目自己一周的真实 Dayflow 数据，标题为虚构、站点映射成中性域名；
完整的视图参考与路由清单见 [docs/PANEL.md](docs/PANEL.md)，`scripts/demo/` 流程见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#demo-recordings)。

## 自有日志、记忆与洞察

插件拥有第二个可移植的 SQLite 日志（0.7.1 线为 schema **v8**），Dayflow 仍是默认数据源。先用 `journal_import`
导入一次，再把 profile 切到 `source: owned`：源库只读打开、导入幂等，现有工具与面板载荷不变。

- **回顾队列**：distillation、重复出现的 loop、改进建议和 task proposal——agent 只提议，用户决定。
- **长任务**带按日 session、停滞标记和可解释的 `suggest`；另有**带日期的记忆** claim、日/周**反思**，
  以及注入系统提示词的预算化上下文。
- 洞察视图里的历史**扫描**（最近 14 天）加**关联**是同一套证据链的用户侧入口：先预览，
  只写入用户确认的日期。

存储、后端与写入路径见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；
快速记录的捷径见 [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md)。

## 原生采集（预览）

Phase 0 与 Phase 1 已落地：配置、采集状态（0.7.1 之前为 schema v7）、macOS 原生 provider，以及默认关闭的
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
```

当 `databasePath` 为空时，`DAYFLOW_DB` 会覆盖 Dayflow 路径。所有键、默认值以及
capture/analysis/automation 配置块见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

## 隐私与安全

- 数据不会通过本插件离开这台 Mac：只读一个本地 SQLite 文件、只连一个本地 Unix socket。
- 屏幕内容生成的文本（标题、摘要、长描述）是**数据**：工具描述与系统提示词都写明这一点，
  避免模型被活动标题里的文字“注入”。
- 删除活动会连带删除 observations，无法完全恢复；工具要求先确认，且只有用户本人能打开
  Dayflow 的编辑开关。
- 原生采集默认关闭，帧只写入 `$DSH_HOME/dayflow/frames/`（目录 `0700`、文件 `0600`），
  有保留清理；只有在采集与分析都开启时分析才会 tick，未设置 `cloud` 授权与 provider/model 前也不会外发。
- 面板的 favicon 抓取是唯一的对外请求：每个域名一次 `favicon.ico`，不带 cookie 与 referrer，
  拒绝 loopback 与裸 IP；设 `icons: false` 可完全关闭。

## 开发

```sh
npm install
npm run build                # TypeScript → lib/，以及 client bundle
npm test                     # 构建、类型检查并运行测试套件
npm run typecheck            # 同时类型检查源码与测试
npm run smoke                # 读取本机真实 Dayflow 数据库
npm run native:smoke         # 只测采集 provider，不写入任何数据
npm run native:engine-smoke  # 用临时日志驱动采集引擎
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
