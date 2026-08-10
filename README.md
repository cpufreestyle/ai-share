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

### 方式二：用源码运行（需 Node.js ≥ 16，无需 `npm install`）

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

## 开发与测试

项目零依赖，无需 `npm install`。

```bash
npm start        # 启动服务（等价 node server.js）
npm run lint     # 批量语法检查 server.js / lib/*.js / public/app.js
npm test         # 运行隔离单测（test/collect.test.js）
```

- **单测隔离**：`npm test` 通过环境变量 `AI_SHARE_DATA_DIR` 把数据目录指向临时目录，**不会触碰真实 `data/`**，测试结束自动清理。覆盖扫描（Skill / 提示词 / MCP）、内容指纹去重、大文件跳过、客户端登记与「一键采集」端到端等场景。
- **CI**：`.github/workflows/ci.yml` 在 `push` / `pull_request` 时自动运行 `npm run lint` 与 `npm test`（Ubuntu + Node 20）。
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
│   └── crypto.js     # AES-256-GCM 加密与主密码保险库
├── public/           # 前端静态页面（原生 JS，无构建）
└── data/             # 运行时数据（自动生成）
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

## 进阶能力

- **密钥加密存储**：`providers.apiKey` 在落盘时以 AES-256-GCM 加密（密钥存于 `data/.key`，已加入 `.gitignore`）。磁盘上是密文，应用内读取/编辑时自动解密。备份文件中密钥为明文以便迁移，请妥善保管。
- **客户端路径自动探测**：在「Agent 客户端」编辑表单中点击「自动探测」，会**实际扫描**该客户端是否已安装（检查常见可执行文件位置）以及是否已有配置文件，并自动填回对应的默认配置文件路径（含 `{APPDATA}`/`{USERPROFILE}` 占位符）。
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

所有数据以 JSON 文件保存在本项目的 `data/` 目录（首次运行自动创建）。API Key 字段在磁盘上为加密密文；但**备份文件为明文**，仅限可信环境使用，勿提交到版本库。
