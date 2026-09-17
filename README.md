# AI Share · 共享 AI 资源管理器

一个**零依赖**的本地 Web 应用，用于集中管理所有可共享的 AI 资源，并在切换不同 Agent 客户端（Claude Desktop / Cursor / VS Code / CodeBuddy 等）时，一键共享、套用同一套配置。

## 解决的问题

平时使用多个 AI 客户端，每个都要各自配置 API 端点、MCP 服务器、提示词。换客户端时配置无法复用。AI Share 把这些资源**统一管理、按需组合成「方案」，再导出写入各客户端**，实现跨客户端共享调用。

## 管理的资源

- **API 端点**：各厂商 / 本地模型的 base_url、api_key、模型列表（OpenAI / Anthropic / Ollama…）
- **提示词**：系统提示、角色设定、模板库，可打标签分类
- **MCP 服务器**：stdio / sse / http 三类连接配置，统一维护
- **Skill 仓库**：git 或本地 skill 目录，**被「共享配置（方案）」直接引用**，是已登记的 Skill 来源
- **资源仓库（repos）**：通用「仓库同步导入器」，**主要登记“生成的软件项目目录”（位于 `d:\ai share\repo\` 下的本地目录）**，可选登记 git 远程仓库；每个项目可同时含 Skill/MCP/提示词，故「同步到」为多选，一键把里面的资源**同步到对应的目标集合**（`skillrepos` / `mcpservers` / `prompts`）。二者区别：Skill 仓库是"来源/引用对象"，资源仓库是"同步通道/导入动作"
- **Agent 客户端**：各客户端的配置文件写入路径（支持 `{APPDATA}` / `{USERPROFILE}` 占位符）
- **共享配置（方案）**：把以上资源打包成一套组合，切换客户端时直接套用

## 快速开始

### 方式一：下载可执行文件（无需安装 Node）

前往 [Releases](https://github.com/cpufreestyle/ai-share/releases) 下载对应平台的文件，双击或在终端运行：

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `ai-share-windows-x64.exe` |
| Linux x64 | `ai-share-linux-x64` |
| macOS Intel | `ai-share-macos-x64` |
| macOS Apple Silicon | `ai-share-macos-arm64` |

Linux / macOS 首次运行需赋予执行权限：

```bash
chmod +x ai-share-linux-x64
./ai-share-linux-x64
```

> macOS 提示「无法验证开发者」时：右键点按文件选「打开」，或执行
> `xattr -d com.apple.quarantine ai-share-macos-arm64`（产物未做签名公证）。

### 方式二：用源码运行（需 Node.js ≥ 20，无需 `npm install`）

```bash
# Windows
start.bat

# Linux / macOS
./start.sh          # 前台运行
./start.sh -d       # 后台运行，日志写入 server.log

# 或直接调用
node server.js
```

停止服务：Windows 用 `stop.bat`，Linux / macOS 用 `./stop.sh`。

打开浏览器访问 http://localhost:4737（启动脚本会自动打开）

> 可用环境变量改端口：`PORT=8080 node server.js`
> 设置 `AI_SHARE_NO_OPEN=1` 可禁止自动打开浏览器。
> 默认仅监听本机 `127.0.0.1`（服务无鉴权，且备份接口可导出明文密钥，不应直接暴露到局域网）；如确需从其他设备访问：`HOST=0.0.0.0 node server.js`。

## 开发与测试

项目零依赖，无需 `npm install`。

```bash
npm start        # 启动服务（等价 node server.js）
npm run lint     # 批量语法检查 server.js / lib/*.js / public/app.js
npm test         # 运行全部隔离测试（12 个套件 / 201 项，见 package.json 的 test 清单）
```

- **单测隔离**：`npm test` 通过环境变量 `AI_SHARE_DATA_DIR` 把数据目录指向临时目录，**不会触碰真实 `data/`**，测试结束自动清理。
- **覆盖范围**：扫描（Skill / 提示词 / MCP）、内容指纹去重、大文件跳过、客户端登记与「一键采集」端到端；多进程并发写入与跨进程写锁；存储原子写与损坏回滚、墓碑清理、本地防跨站调用、客户端配置文件原子写入、同步配置读写、同步服务端存储安全、Provider / MCP 连通性探测，以及真实起服务的 HTTP 集成用例（跨站 403、非 JSON 415、静态资源 gzip）。
- **注意**：`test` 脚本是**显式罗列**的用例清单而非 glob，新增测试文件后必须手动把它加进 `package.json` 的 `test` 脚本，否则本地与 CI 都不会执行它。
- **CI**：`.github/workflows/ci.yml` 在 `push` / `pull_request` 时自动运行 `npm run lint` 与 `npm test`（Ubuntu + Windows 双平台矩阵，Node 20），跨平台差异（路径、大小写敏感度、换行）由同一套用例覆盖。
- **发布**：`.github/workflows/release.yml` 在推送 `v*` tag 时，于 Windows / Linux / macOS(Intel + ARM) 四个原生 runner 上用 [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) 分别打包，逐个做启动冒烟测试后自动上传到 GitHub Release。也可在 Actions 页手动触发（`workflow_dispatch`）。
- **忽略项**：`data/`（含 `proxy.json`、`sync.json`、`.repos-cache/`）、`sync-data/`、`node_modules/`、`server.log`、`server.err`、`*.key` 已在 `.gitignore` 中，请勿提交运行时数据与密钥。

## 使用流程

1. 在左侧维护 API 端点、提示词、MCP 服务器、Skill 仓库、客户端。
2. 进入「共享配置」新建一个**方案**，勾选要共享的资源与目标客户端。
3. 进入「共享 / 导出」：
   - 预览将写入每个客户端的 `mcp.json` 内容；
   - 复制 / 下载，或直接「写入客户端」把配置写到对应配置文件（如 `claude_desktop_config.json`、`.cursor/mcp.json`）。

切换客户端时，只需换一个方案或勾选不同客户端，再点「全部写入」即可完成共享。

## 目录结构

```
ai share/
├── server.js         # 零依赖 Node HTTP 服务 + REST API
├── sync-server.js    # 自建同步服务端（多端双向同步的中转与权威存储）
├── lib/
│   ├── store.js      # JSON 文件持久化 + 种子数据
│   ├── export.js     # 按客户端类型生成 / 写入配置 + 反向扫描导入 + 仓库同步
│   ├── sync.js       # 网络双向同步：LWW 合并、传输加密、定时任务
│   ├── crypto.js     # AES-256-GCM 加密与主密码保险库
│   ├── probe.js      # Provider / MCP 连通性探测（零依赖）
│   ├── security.js   # 本地 API 的跨站（CSRF）与 Content-Type 判定
│   └── fsutil.js     # 原子写 / JSON 原子写（临时文件 + fsync + rename）
├── mcp-bridge.js     # MCP 桥接器：把本系统资源暴露给任意兼容 MCP 的 Agent
├── public/           # 前端静态页面（原生 JS，无构建）
└── data/             # 运行时数据（自动生成，可用 AI_SHARE_DATA_DIR 改位置）
```

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST/PUT/DELETE | `/api/:collection(/:id)` | 对 providers/prompts/mcpservers/skillrepos/clients/profiles/repos 增删改查 |
| GET | `/api/export/:profileId` | 预览某方案对各客户端的导出配置 |
| POST | `/api/export/:profileId/apply` | 将配置写入各客户端配置文件 |
| GET | `/api/detect/clients` | 扫描各客户端的真实安装位置与已有配置文件，返回建议路径 |
| GET | `/api/clients/:type/scan` | 读取某客户端真实配置文件，解析其中已有的 MCP 服务器（预览） |
| POST | `/api/clients/:type/import` | 将上述扫描结果导入本系统（body.selected 可指定只导入部分，按名称合并） |
| POST | `/api/collect` | 一键采集：扫描本机所有已识别客户端，自动登记并导入其 MCP 服务器、Skill 与提示词/规则（分别按名称/路径合并） |
| POST | `/api/repos/:id/sync` | 同步某仓库到其 `resourceType` 对应集合（local 目录直接扫描导入；git 仓库自动 clone/pull 到 `data/.repos-cache/<id>` 后扫描；写回 `lastSyncAt`） |
| GET | `/api/clients/:type/skills` | 扫描某客户端本地 skill 目录，逐个解析每个 skill 文件夹的 `SKILL.md` 并预览 |
| POST | `/api/clients/:type/skills/import` | 将上述扫描到的 Skill 导入「Skill 仓库」（body.selected 可指定只导入部分，按路径合并） |
| GET | `/api/clients/:type/prompts` | 扫描某客户端的提示词/规则文件（如 `CLAUDE.md`、`.cursor/rules/*.mdc`、`copilot-instructions.md`）并预览 |
| POST | `/api/clients/:type/prompts/import` | 将上述扫描到的提示词/规则导入「提示词」资源（body.selected 可指定只导入部分，按路径合并） |
| GET | `/api/sync/config` | 读取网络同步配置（`token`/`secret` 以 `__SET__` 占位，不回传明文） |
| PUT | `/api/sync/config` | 更新同步配置并按新设置重建定时器（传 `__SET__` 表示保持原值不变） |
| POST | `/api/sync/now` | 立即执行一次双向同步，返回各集合的拉取/推送数量 |
| GET | `/api/backup/export` | 导出全部资源为单文件备份（明文，便于迁移） |
| POST | `/api/backup/import` | 导入备份，mode=`merge`(按 id 合并) 或 `replace`(覆盖) |
| GET | `/api/profiles/:id/export` | 导出单个方案为单文件（含其引用的全部资源） |
| POST | `/api/profiles/import` | 导入方案包，资源按 id 合并，方案新建 |
| GET | `/api/vault/status` | 查询密钥保险库状态（是否启用/锁定） |
| POST | `/api/vault/set` | 设置主密码，以主密码派生密钥重加密密钥 |
| POST | `/api/vault/unlock` | 用主密码解锁（内存中保持密钥，重启需重输） |
| POST | `/api/vault/lock` | 锁定保险库（清空内存密钥） |
| GET | `/api/system/info` | 服务端信息：数据目录真实路径、平台、Node 版本、是否打包运行 |
| GET | `/api/health` | 健康检查：返回 `{ok, name, version, uptime}`，无副作用，供桥接器/守护脚本/容器探针使用 |
| POST | `/api/paths/validate` | 校验路径是否存在、是否可写（写入客户端配置前自检） |
| POST | `/api/providers/:id/test` | 连通性测试：用该端点的 baseUrl + key 请求 `/models`，失败再试根路径，返回状态码与耗时 |
| POST | `/api/mcpservers/:id/check` | MCP 可用性检查：stdio 校验命令文件是否存在（相对命令依赖 PATH 不做静态判断），sse/http 直接探测 URL |
| GET | `/api/:collection/deleted` | 回收站：列出被软删除的资源（墓碑） |
| POST | `/api/:collection/:id/restore` | 从回收站恢复该资源 |
| POST | `/api/maintenance/purge-tombstones` | 清理 N 天前的墓碑记录（body.days，默认 30，最小 1） |

## 进阶能力

- **全局搜索 / 命令面板**：任意页面按 `Ctrl` / `Cmd + K` 唤出，输入关键字即跨集合匹配（API 端点 / 提示词 / MCP / Skill 仓库 / 客户端 / 资源仓库），命中名称、描述与内容片段，回车直达该条目。
- **Provider / MCP 连通性自检**：列表行的「测试」（API 端点）与「检查」（MCP 服务器）会发起一次真实探测并返回状态码与耗时，用于区分「配置写错」「本机没装该命令」与「网络 / 远端不可用」。API 端点依次尝试 `/models` 与根路径（带 Bearer 鉴权）；MCP 的 stdio 只做静态校验（绝对路径检查文件是否存在，相对命令依赖 PATH 不做静态判断），sse / http 则请求该 URL。探测有 5 秒超时，只读不落盘。
- **回收站与误删恢复**：删除以「墓碑」形式记录，侧边栏「回收站」可查看并逐条还原。墓碑同时承担多端同步中的删除传播职责（避免被对端重新推回），对列表界面与导出均不可见；超过保留期的记录可用「清理」按钮或 `POST /api/maintenance/purge-tombstones` 清掉（默认保留 30 天）。
- **原子写入与损坏自愈**：所有 JSON 写入统一走「写临时文件 → fsync → rename」，写入过程中崩溃不会留下半截文件；读取时发现 JSON 损坏会先把坏文件隔离为 `.corrupt-<时间戳>`，自动回滚到上一份完好的 `.bak`，仍失败才退回种子数据。写入客户端配置文件同样原子，且目标文件解析失败时**跳过不覆盖**，避免把带注释（JSONC）或已损坏的配置整体清空。
同时跑两个实例（例如忘了关旧窗口又开一个）也不会互相覆盖：每个集合的「读 → 改 → 写」都在跨进程写锁内完成（`lib/lockfile.js`），另一实例持锁时最多等待 5 秒。
- **本地接口防跨站调用**：服务无鉴权且监听回环，浏览器里的任意网页都能向它发起请求，同源策略挡得住「读响应」却挡不住「触发副作用」。现已在 `/api/*` 统一校验：跨站来源（`Origin` 与 `Host` 不同源、`Sec-Fetch-Site: cross-site`）直接 403；写请求要求 `Content-Type: application/json`，强制跨站请求先过预检。浏览器 UI 与 MCP 桥接器（发 JSON、不带 Origin）不受影响。
- **静态资源压缩**：HTML / JS / CSS 等按 `Accept-Encoding` 协商 gzip 返回（并带 `Vary: Accept-Encoding`），界面首屏体积明显下降；请求体按字节限制为 5 MB。
- **本地自动备份与一键回滚**：在「备份 / 迁移」页可开启定时快照（默认每 12 小时、保留 10 份），也能随时手动快照。误删、改坏配置或导入错备份后，可在快照列表里回滚到任一时间点——回滚前会自动存一份当前状态作为「安全快照」，因此回滚本身也是可逆的（`lib/autobackup.js`）。快照是明文，落在数据目录下的 `backups/`，请勿随仓库分发。
- **密钥加密存储**：`providers.apiKey` 在落盘时以 AES-256-GCM 加密（密钥存于 `data/.key`，已加入 `.gitignore`）。磁盘上是密文，应用内读取/编辑时自动解密。备份文件中密钥为明文以便迁移，请妥善保管。
- **客户端路径自动探测**：在「Agent 客户端」编辑表单中点击「自动探测」，会**实际扫描**该客户端是否已安装（检查常见可执行文件位置，Windows 检查安装目录，macOS 检查 `/Applications`，Linux 检查常见 bin 路径）以及是否已有配置文件，并自动填回对应的默认配置文件路径（含 `{APPDATA}`/`{USERPROFILE}` 占位符）。占位符跨平台可用：Windows 展开为对应系统目录，macOS 的 `{APPDATA}`/`{LOCALAPPDATA}` 映射到 `~/Library/Application Support`，Linux 遵循 XDG 惯例（`~/.config` / `~/.local/share`）。
- **从客户端反向导入 MCP 配置**：在「MCP 服务器」页点击「从客户端导入」，选择某个已安装客户端，工具会**直接读取该客户端电脑上的真实配置文件**（如 `claude_desktop_config.json`、`.cursor/mcp.json`），解析其中的 `mcpServers` 并清单预览、可勾选，确认后一键搬入本系统统一管理。同名服务器自动更新、不同名则新增，方便把散落在各客户端的 MCP 配置集中收口。
- **从客户端汇总 Skill 到仓库**：在「Skill 仓库」页点击「从客户端导入」，选择客户端后工具会**逐个扫描其本地 skill 目录**（如 `~/.codebuddy/skills`、`~/.claude/skills`），解析每个 skill 文件夹中的 `SKILL.md`（读取 `name` / `description` frontmatter），预览并勾选后一键登记进「Skill 仓库」（以本地仓库形式，路径即 skill 文件夹）。按文件夹路径合并，避免重复。
- **从客户端汇总提示词/规则到资源**：在「提示词」页点击「从客户端导入」，选择客户端后工具会**逐个扫描其提示词/规则文件**——Claude 的 `~/.claude/CLAUDE.md` 与 `rules/`，Cursor 的 `~/.cursor/rules/*.mdc`，VS Code 的 `copilot-instructions.md`，CodeBuddy 的 `rules/` 与 `CODEBUDDY.md` 等，读取内容并预览、可勾选，确认后一键登记进「提示词」资源（以文件路径去重，重复导入则更新内容并合并来源标签）。
- **客户端 Skill / 提示词扫描路径可自定义**：在「Agent 客户端」编辑表单中可填写 `Skill 扫描路径` 与 `提示词扫描路径`（每行一个目录或文件，支持 `{APPDATA}` / `{USERPROFILE}` 占位符）。留空则使用各客户端内置默认路径；填写后优先使用你指定的路径，便于客户端把 Skill / 规则放在非默认位置时仍能正确采集。
- **方案级单文件导出/导入**：在「共享配置」页，每条方案可「导出方案」为 `ai-share-profile.json`（打包该方案引用的 API、提示词、MCP、Skill、客户端）；也可「导入方案文件」把他人方案一键搬过来（资源按 id 合并，方案新建，避免重复）。
- **密钥主密码保护（保险库）**：侧边栏底部可「启用主密码」。启用后，密钥以主密码派生的密钥（PBKDF2 + AES-256-GCM）加密；**重启服务后需先在侧边栏输入主密码解锁**才能读取/编辑密钥。未启用时退化为本地 key 文件加密。锁定状态下密钥在 API 中返回密文，界面显示需解锁。
- **备份 / 迁移**：左侧「备份 / 迁移」可一键导出全部资源为 `ai-share-backup.json`，或导入他人的备份，支持合并/覆盖两种模式，方便在多台机器间共享同一套 AI 资源配置。
- **网络双向同步**：左侧「网络同步」可与自建同步服务端**双向同步全部资源**，多台机器自动保持一致。
  - **启动服务端**：在任意一台可被其他机器访问的机器上运行 `npm run sync-server`（默认端口 `4738`，数据存于 `sync-data/`）。可用环境变量 `SYNC_PORT` 改端口、`SYNC_TOKEN` 启用鉴权、`SYNC_DATA_DIR` 改数据目录。
  - **客户端配置**：在「网络同步」页填写服务端地址（如 `http://192.168.1.10:4738`）、访问令牌（对应 `SYNC_TOKEN`，未启用可留空）与**同步密钥**，勾选「启用定时自动同步」并设置间隔即可。也可随时点「立即同步」。
  - **冲突策略**：同一条资源两端都修改时，按 `updatedAt` **以修改时间较新的一方为准**（LWW）。
  - **删除传播**：删除会以「墓碑」记录同步到其他设备，避免被对端重新推回；墓碑对界面与导出均不可见。
  - **密钥安全**：`apiKey` 等字段在上传前用「同步密钥」二次加密（AES-256-GCM），**服务端只能看到密文**。因此所有设备必须填写<b>相同的同步密钥</b>；密钥不一致时该字段会被丢弃而非写入乱码。服务端地址建议使用内网地址或 HTTPS。
- **仓库管理（repos）**：左侧「资源仓库(同步)」是通用「仓库同步导入器」，**主要登记“生成的软件项目目录”**（位于 `d:\ai share\repo\` 下的本地目录），也可选登记 **git 远程仓库**（填 Git 地址，同步时自动 `git clone`/`pull` 到本地缓存目录 `data/.repos-cache/<id>`）。每个生成的软件项目可能同时包含 Skill/MCP/提示词，因此「同步到」为**多选**（Skill 仓库 / MCP 服务器 / 提示词），同步时会按各类型分别扫描并导入（Skill 按 `SKILL.md`、提示词按 `.md/.mdc/.txt`、MCP 按 `mcp.json`），按内容指纹/路径合并，并写回「上次同步」时间，方便把生成的代码仓库里的资源持续收口到本系统。**与「Skill 仓库」的关系**：Skill 仓库是被方案直接引用的 Skill 来源；资源仓库是其之上的"导入通道"，把 `d:\ai share\repo\` 等生成的软件项目目录里的资源同步进来，应尽量避免把同一个 Skill 来源同时在两处登记。
- **git 同步走代理**：若访问 GitHub 等需要代理，按以下优先级取值，命中即用（要求形如 `scheme://host`）：
  1. 环境变量 `AI_SHARE_PROXY`；
  2. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY`；
  3. 配置文件 `data/proxy.json`，内容如 `{ "enabled": true, "url": "http://127.0.0.1:7897" }`。

  代理以 `git -c http.proxy=...` 形式**临时注入**，不会修改你的全局 git 配置；同时会清除子进程继承的 `*_PROXY` 变量，避免空值或过期值覆盖上述配置（该情况会导致 `schannel: failed to receive handshake` 之类的握手失败）。注意 `data/` 已被 `.gitignore` 忽略，`proxy.json` 不会随项目分发，换机器需重新配置或改用环境变量。

## 数据存储

所有数据以 JSON 文件保存（首次运行自动创建，默认为 `data/`）。侧边栏底部会显示**当前真实数据目录**，如需改到别处，启动时设置环境变量 `AI_SHARE_DATA_DIR`：

```bash
AI_SHARE_DATA_DIR=~/ai-share-data node server.js   # 相对路径会自动解析为绝对路径
```

打包版（exe）的数据落在 exe 所在目录下的 `data/`，不会写进程序安装目录。API Key 字段在磁盘上为加密密文；但**备份文件为明文**，仅限可信环境使用，勿提交到版本库。

## 作为 MCP 服务接入 Agent 客户端

`mcp-bridge.js` 是一个零依赖的 MCP 服务端（stdio 传输），把本系统里的资源暴露为 MCP 工具，供**任意兼容 MCP 的客户端**（Claude Desktop / Claude Code、Cursor、CodeBuddy、VS Code Copilot、Cline 等）直接调用：

```bash
node mcp-bridge.js                                  # 前置：ai-share 已在运行
AI_SHARE_URL=http://127.0.0.1:4737 node mcp-bridge.js   # 端口/地址不同时
```

在客户端的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "ai-share": {
      "command": "node",
      "args": ["C:/ai share/repo/ai share/mcp-bridge.js"],
      "env": { "AI_SHARE_URL": "http://127.0.0.1:4737" }
    }
  }
}
```

| 工具 | 说明 |
| --- | --- |
| `aishare_collections` | 列出可用集合 |
| `aishare_list` | 列出某集合的全部条目 |
| `aishare_get` | 按 id 取集合中单条资源 |
| `aishare_search` | 按关键字搜索：不给 `collection` 时跨全部集合搜索，返回 `{collection, item}` 列表；给了则在单集合内过滤 |
| `aishare_apply_profile` | 把一个「共享配置（方案）」写入其目标客户端配置文件 |
| `aishare_detect_clients` | 探测本机已安装的 AI 客户端及其配置文件路径 |

桥接器只与本机 REST API 通信（默认 `127.0.0.1:4737`），不会把数据发往外部。服务未启动时它会自动拉起一次（需 `start.sh`，即 Linux / macOS / WSL 环境）。
