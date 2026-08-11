# 更新日志

本项目的所有重要变更都会记录在此文件中。
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.1] - 2026-08-11

### 说明

本版本内容与 `0.3.0` 一致，用于首次通过 CI 产出四平台可执行文件。此前 `v0.3.0` 的 tag 由 API 创建，指向了跨平台改动之前的提交，故另发新版而非强改已发布的 tag。

### 新增

- **跨平台可执行文件**：Release 现提供 Windows x64、Linux x64、macOS Intel、macOS Apple Silicon 四个平台的单文件可执行程序，无需安装 Node.js 即可运行。
- **跨平台启动脚本**：新增 `start.sh` / `stop.sh`（Linux / macOS），与既有 `start.bat` / `stop.bat` 行为对齐，支持自动释放被占端口；`./start.sh -d` 可后台启动并写日志到 `server.log`。
- **多平台自动发布**：`.github/workflows/release.yml` 改为四平台原生 runner 矩阵构建，用 `@yao-pkg/pkg` 打包，每个产物均执行启动冒烟测试后才上传 Release；保留 tag 与 `package.json` 版本一致性校验及 CHANGELOG 发布说明提取，并支持手动触发。

### 修复

- **Linux 下无法自动打开浏览器**：此前非 Windows 平台一律调用 macOS 专有的 `open` 命令，在 Linux 上静默失败；现按平台分发至 `xdg-open`。

### 变更

- 打包工具由已停止维护的 `pkg` 切换为活跃维护的 `@yao-pkg/pkg`，目标运行时由 Node 18 升至 Node 20。
- 新增 `.gitattributes`，固定 `*.sh` 为 LF、`*.bat` / `*.ps1` 为 CRLF，避免换行符转换破坏脚本。

## [0.3.0] - 2026-08-10

### 新增

- **跨平台可执行文件**：Release 现提供 Windows x64、Linux x64、macOS Intel、macOS Apple Silicon 四个平台的单文件可执行程序，无需安装 Node.js 即可运行。
- **跨平台启动脚本**：新增 `start.sh` / `stop.sh`（Linux / macOS），与既有 `start.bat` / `stop.bat` 行为对齐，支持自动释放被占端口；`./start.sh -d` 可后台启动并写日志到 `server.log`。
- **多平台自动发布**：`.github/workflows/release.yml` 改为四平台原生 runner 矩阵构建，用 `@yao-pkg/pkg` 打包，每个产物均执行启动冒烟测试后才上传 Release；保留 tag 与 `package.json` 版本一致性校验及 CHANGELOG 发布说明提取，并支持手动触发。

### 修复

- **Linux 下无法自动打开浏览器**：此前非 Windows 平台一律调用 macOS 专有的 `open` 命令，在 Linux 上静默失败；现按平台分发至 `xdg-open`。

### 变更

- 打包工具由已停止维护的 `pkg` 切换为活跃维护的 `@yao-pkg/pkg`，目标运行时由 Node 18 升至 Node 20。
- 新增 `.gitattributes`，固定 `*.sh` 为 LF、`*.bat` / `*.ps1` 为 CRLF，避免换行符转换破坏脚本。

## [0.2.0] - 2026-08-06

### 新增

- **网络双向同步**：可与自建同步服务端双向同步全部资源，多台机器自动保持一致。
  - 新增自建同步服务端 `sync-server.js`（零依赖），通过 `npm run sync-server` 启动，支持 `SYNC_PORT` / `SYNC_TOKEN` / `SYNC_DATA_DIR` 配置。
  - 冲突采用 LWW（Last-Write-Wins）策略：同一条资源两端都修改时，以 `updatedAt` 较新的一方为准。
  - 支持定时自动同步，服务重启后按已保存配置自动恢复。
  - `apiKey` 等密钥字段在上传前用「同步密钥」二次加密（AES-256-GCM），服务端仅存密文；同步密钥不一致时丢弃该字段而非写入密文。
  - 新增接口 `GET/PUT /api/sync/config`、`POST /api/sync/now`；配置接口以 `__SET__` 占位，不回传密钥明文。
  - 新增前端「网络同步」页，可配置服务端地址、令牌、同步密钥、自动同步开关与间隔，并展示同步状态。
- **资源仓库管理（repos）**：集中登记 git 远程仓库或本地目录，一键同步其中的 Skill / MCP / 提示词到对应集合。
  - git 仓库同步时自动 `clone` / `pull` 到本地缓存目录 `data/.repos-cache/<id>`，并写回 `lastSyncAt`。
  - 新增接口 `POST /api/repos/:id/sync`，前端支持单条同步与「同步全部启用仓库」。
- **git 同步代理支持**：按 `AI_SHARE_PROXY` → `HTTPS_PROXY` / `HTTP_PROXY` → `data/proxy.json` 优先级读取代理，以 `git -c` 形式临时注入，不修改用户全局 git 配置。

### 变更

- 资源记录新增 `updatedAt` 字段，作为双向同步的版本判定依据。
- 删除操作改为写入「墓碑」记录（`_deleted`），使删除可跨设备传播；墓碑对界面与导出均不可见。
- `store` 新增 `listRaw()` 用于读取含墓碑的完整数据，仅供同步模块使用。

### 修复

- 修复 git 子进程继承空值或过期的 `*_PROXY` 环境变量，覆盖显式代理配置并导致 `schannel: failed to receive handshake` 握手失败的问题。
- 修复「Agent 客户端」表单中「自动探测」按钮的两处空指针：`closest('.field')` 返回 `null` 时未判空，以及点击回调中直接解引用可能已被重新渲染的 `#f_type` / `#f_configPath` 元素。
- 前端新增全局 `error` / `unhandledrejection` 兜底处理，便于定位运行时报错。

## [0.1.0]

### 新增

- 零依赖本地 Web 应用，集中管理 API 端点、提示词、MCP 服务器、Skill 仓库与 Agent 客户端。
- 共享配置（方案）：将资源打包成组合，一键写入各客户端配置文件。
- 一键采集本机资源，从各客户端反向导入 MCP 配置、Skill 与提示词/规则。
- 客户端配置路径自动探测，支持 `{APPDATA}` / `{USERPROFILE}` 占位符。
- 密钥 AES-256-GCM 加密存储，支持主密码保险库。
- 备份 / 迁移：全量资源导出与导入（合并 / 覆盖两种模式）。
