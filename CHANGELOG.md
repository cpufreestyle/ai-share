# 更新日志

本项目的所有重要变更都会记录在此文件中。
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

下列改动自 `0.3.9` 起合入，尚未发版。

### 新增

- **全局搜索 / 命令面板**：`Ctrl` / `Cmd + K` 跨集合检索资源并直达条目（`public/app.js` 的 `initPalette`）。
- **Provider / MCP 连通性自检**：新增 `lib/probe.js` 与 `POST /api/providers/:id/test`、`POST /api/mcpservers/:id/check`，列表行可直接测试连通性并返回状态码与耗时。
- **回收站与误删恢复**：删除改为墓碑记录，新增 `GET /api/:col/deleted` 与 `POST /api/:col/:id/restore`，侧边栏「回收站」页可查看并还原。
- **墓碑清理**：新增 `POST /api/maintenance/purge-tombstones`（默认保留 30 天，拒绝小于 1 天以免误清空）。
- **数据目录可视化**：新增 `GET /api/system/info`，侧边栏底部显示真实数据目录，支持用 `AI_SHARE_DATA_DIR` 覆盖。
- **MCP 桥接器**：`mcp-bridge.js`（零依赖 stdio MCP 服务端）把资源暴露为 `aishare_list` / `aishare_search` / `aishare_apply_profile` 等工具，供任意兼容 MCP 的客户端调用；服务未启动时自动拉起一次。
- **静态资源 gzip**：HTML / JS / CSS 等按 `Accept-Encoding` 协商压缩返回，ETag 加 `-gz` 后缀并带 `Vary: Accept-Encoding`。
- **健康检查端点**：新增 `GET /api/health`，返回 `{ok, name, version, uptime}`，无副作用，供 MCP 桥接器、守护脚本或容器探针判断服务存活。
- **密钥字段显隐与一键复制**：API 端点编辑表单中的 API Key 支持「显示 / 隐藏」切换与「复制」按钮，切换客户端类型重渲染后仍可用；剪贴板不可用时退化为全选提示。
- **桥接器跨集合搜索**：`aishare_search` 的 `collection` 参数改为可选——不传时跨全部集合搜索并返回 `[{collection, item}]`，方便 Agent 一次找全相关资源。
- **密钥重复加密体检 / 修复**：新增 `store.repairSecrets` 与 `POST /api/maintenance/repair-secrets`（默认只扫描，`body.apply=true` 才落盘），逐层解开历史多层密文还原成单层、报告可省下的体积，密钥不匹配的记录一律跳过不破坏数据；界面在「备份 / 迁移」页新增「数据体检」卡片。配合根因修复，真实数据里某条 `apiKey` 从 3 MB 回到几十字节。
- **列表接口不再回传密钥明文**：`GET /api/:collection` 改用 `store.listPublic`，密钥字段以 `__SET__` 占位（编辑表单走 `GET /api/:collection/:id` 仍取明文）。真实数据里单个集合的列表响应从 **1.77 MB 降到 463 字节**，MCP 桥的 `aishare_list` / `aishare_search` 也不会再把密钥交给 Agent。
- **客户端安装状态提示**：客户端列表新增「已安装 / 未安装」与「已有配置文件」徽标（来自实际探测），避免把「已登记」误当成「已装好」。
- **测试护栏**：新增 10 个测试套件（原子写、墓碑、防跨站、客户端配置原子写、同步配置、同步服务端存储、HTTP 集成、连通性探测、跨进程写锁、本地自动备份），`npm test` 现跑 13 个套件 / 281 用例。其中的并发用例会拉起 4 个子进程同时对同一集合做读改写，关掉写锁后该用例必定失败，可反向验证锁确实生效。
- **批量操作**：集合列表支持多选（`Shift` 点击整段选中，「全选」只作用于当前筛选结果），可一次删除入回收站、一次启用/停用（仅含 `enabled` 字段的集合显示该组按钮）；回收站支持多选批量恢复 / 批量彻底删除，以及一键清空。新增 `POST /api/:collection/bulk-delete`、`POST /api/:collection/bulk-enabled`、`POST /api/trash/bulk-restore`、`POST /api/trash/bulk-purge`、`POST /api/trash/purge-all` 与 `DELETE /api/:collection/:id/tombstone`；批量操作在服务端**一次加锁**完成，替代前端 N 次串行请求（单次上限 500 条）。
- **列表接口 304 协商缓存**：`GET /api/:collection` 现在返回内容哈希 `ETag`（`Cache-Control: no-cache`），浏览器重复拉取同一集合时命中 304、不再传输与解析整份 JSON；内容一变 ETag 立即变化，不会吃到旧数据。
- **前端列表 SWR 缓存**：二次进入同一集合先用内存缓存渲染（不再闪「加载中…」），随后后台静默校验，数据有变化才重绘，因而保留用户的勾选与滚动位置；增删改、导入、仓库同步、回收站恢复/彻底删除都会先失效对应缓存。
- **列表条数提示**：集合页标题旁显示「共 N 项」或「筛选 M / N 项」。

### 修复

- **数据写坏导致整集合丢失**：`store.writeRaw` 改为「临时文件 → fsync → rename」原子落盘并保留上一份 `.bak`；读取遇损坏先隔离为 `.corrupt-<时间戳>` 再回滚，大幅降低断电/崩溃后数据不可用的概率。
- **本地 CSRF 风险**：服务无鉴权且监听回环，任意网页可触发写操作。现 `/api/*` 统一拒绝跨站来源（403）并要求写请求为 `application/json`（415）。
- **写入客户端配置会清空原文件**：`applyExport` 改为原子写，且目标文件解析失败时跳过不覆盖，不再把 JSONC / 损坏文件整体抹掉。
- **同步服务端存储不安全**：`sync-server.js` 的写入改为原子写，读取损坏时不再返回空数组（会引发权威数据被清空），而是隔离并回滚/报错；默认只监听 `127.0.0.1`，对外监听需显式设置 `SYNC_HOST`。
- **错误响应不分层**：区分客户端错误（400，回传具体原因）与服务器错误（500，脱敏为「内部错误」，细节只写日志，`AI_SHARE_DEBUG=1` 时透出）。
- **本地自动备份与一键回滚**：新增 `lib/autobackup.js`——按固定间隔把全部资源写成带时间戳的 JSON 快照，滚动保留最近 N 份（`backups/` 目录）。「备份 / 迁移」页新增卡片可开关自动快照、设置间隔与保留份数、手动创建快照，并在快照列表里回滚（回滚前自动留「安全快照」，操作可逆）或删除。新增 API：`GET/PUT /api/backup/auto`、`GET /api/backup/snapshots`、`POST /api/backup/snapshot`、`POST /api/backup/snapshots/restore`、`DELETE /api/backup/snapshots/:name`。服务启动时按配置拉起定时器，主密码启用时创建快照要求已解锁（与导出一致）。
- **多实例并发写互相覆盖**：同时跑两个服务进程时，两者的「读 → 改 → 写」序列会交错，后写完的一方会把对方的改动整体覆盖（实测 4 个进程各写 40 条，最终只剩 82 条）。新增 `lib/lockfile.js`（哨兵文件 + `wx` 独占创建的跨进程互斥锁，同进程可重入，持锁进程崩溃后按 pid / mtime 判定为陈旧锁并清理），store 的每个读改写序列都在锁内完成，另一实例持锁时最多等待 5 秒。原子写的临时文件同时带上 pid，避免多进程共用同一个 `.tmp`。
- **路径校验遇非法参数返回 500**：`/api/paths/validate` 传入非字符串元素（如 `{"paths":[123]}`）时展开函数内部抛 `TypeError`，表现为服务器内部错误；现先过滤掉非字符串项。
- **请求体按字符而非字节限制**：`readBody` 上限改为按字节计算（5 MB），原先按 UTF-16 码元计算会放过约两倍体积的请求体。
- **回收站恢复丢字段（数据丢失）**：删除时墓碑被裁剪成 `{id, _deleted, updatedAt}` 空壳，「恢复」只能拿回空记录；且 LWW 同步按 id 整体替换，空壳墓碑传到对端会把对端完整记录也替换掊。现墓碑保留完整原始记录（只打 `_deleted` 标记），恢复与多端删除传播均不再丢数据；密钥落盘本为密文，墓碑仍按 30 天保留期滚动清理。
- **GET 单条不存在返回 404**：`GET /api/:col/:id` 对不存在的记录曾返回 `200 {}`，现改为 `404 {error}`，避免调用方（含 MCP 桥接器）误把空对象当成有效数据。
- **启动脚本 Node 版本提示过时**：`start.sh` 仍检查 Node >= 16，与 `package.json` 的 `engines >= 20` 不一致，低版本 Node 会以难懂的方式报错；现统一为 >= 20。
- **WSL 下大小写敏感的安装探测**：客户端「已安装」探测在失败后逐级做大小写不敏感回退，避免在大小写敏感的文件系统上误判未安装。

### 变更

- 界面整体刷新：层次与阴影、焦点可见、自定义滚动条、浅色主题与响应式布局。动画只使用 `opacity`，不使用 `transform`（部分 WebView 内核读取几何信息时对 transform 敏感）。
- CI 由仅 Ubuntu 改为 Ubuntu + Windows 双平台矩阵（`fail-fast: false`）。
- 运行环境要求由 Node ≥ 16 提升至 ≥ 20，与 CI 及打包目标（node22）保持一致。
- 原子写能力抽到 `lib/fsutil.js`，`store.js` / `export.js` / `sync.js` 共用。
- **单条删除提示与实际行为不符**：删除早已改为写入「墓碑」（可在回收站恢复），但确认弹窗仍写「删除后不可恢复」，现更正为「移入回收站（可在回收站恢复或彻底删除）」。

- **密钥被反复重复加密导致数据膨胀（严重）**：`store.writeRaw` 每次写盘都会把整个集合 `seal` 一遍，而 `update` / `remove` / `restore`、跨端同步与备份导入等路径合并的是**已加密**的原始记录，于是每保存一次就给已有密文再套一层——没有密钥也读不出来，编辑表单里拿到的其实是密文。实测某条 `apiKey` 被套了 **35 层、膨胀到 3 MB**（单次列表响应因此达到 1.77 MB），且每改一次名字就再涨约 37%。现由 `crypto.isSealed` 保证 `seal` 幂等（已是密文则不再加密），一次性修复 `update` / `remove` / `restore` / 批量操作 / 同步 / `restoreAll` 等全部写路径，并补 `test/store-secret.test.js` 做回归。

## [0.3.9] - 2026-08-15

### 修复

- **「锁定保险库」实际不生效**：`POST /api/vault/lock` 仅返回成功，未调用 `vault.clearKey()`，主密码派生密钥仍留在内存中，且状态接口随即回显「已解锁」，界面提示与真实状态不符。现锁定时真正清除内存密钥，锁定后读取密钥需重新解锁。
- **服务默认监听 `0.0.0.0` 暴露到局域网**：本应用无任何鉴权，且 `/api/backup/export` 会返回明文 API Key，绑定全部网卡意味着同网段任意设备可直接取走全部密钥。现默认只监听 `127.0.0.1`，确需跨设备访问时显式设置 `HOST=0.0.0.0`（或指定网卡 IP），启动日志会给出风险提示。
- **静态文件路径前缀校验缺分隔符**：`serveStatic` 用 `startsWith(PUBLIC)` 判断路径归属，同级目录（如 `public-evil/`）可凭字符串前缀碰撞绕过；改为 `startsWith(PUBLIC + path.sep)`。

### 新增

- **macOS / Linux 客户端探测与采集支持**：`{APPDATA}` / `{LOCALAPPDATA}` 占位符在非 Windows 平台补默认映射（macOS → `~/Library/Application Support`，Linux 遵循 XDG：`~/.config` / `~/.local/share`），使客户端配置扫描、Skill / 提示词采集、一键采集在 macOS / Linux 上开箱可用；「已安装」探测补充 macOS `/Applications` 与 Linux 常见 bin 路径。
- **种子数据路径跨平台**：首次运行的示例数据不再硬编码 `d:/ai share`（Windows 保持不变），其他平台落在用户主目录 `~/ai share` 下，避免生成永远不存在的 `d:\` 盘路径。

### 变更

- Skill 扫描（客户端扫描与仓库同步）不再对同一 `SKILL.md` 重复读取两次，frontmatter 解析与内容指纹共用一次读取结果。

## [0.3.8] - 2026-08-14

### 修复

- **生产可执行文件访问首页返回 404**：`@yao-pkg/pkg` 将 `public/` 打包进 snapshot（项目根），而 `server.js` 此前在 pkg 模式下用 `path.dirname(execPath)`（即 `dist/`）拼接静态资源目录，`dist/public` 并不存在。现改为读取资源基于 `__dirname`（pkg 下指向 snapshot 根，含 `public/`），数据 / 盐文件仍写入 exe 所在目录。该问题同样影响用户下载的 exe 打开网页，现已一并修复。
- **CI 冒烟测试超时误判**：pkg 打出的 exe 在 CI runner 上首次解包 + 启动实测可达 121\~304 秒，远超原有等待窗口。冒烟测试新增「预热」步骤（首次启动完成解包后结束进程，二次启动复用解包缓存秒级拉起），正式探测窗口放宽至 300 秒。
- **Windows 冒烟脚本报错**：预热步骤将两个标准流重定向到同一目标 `NUL` 被 PowerShell 拒绝，改为重定向到不同临时文件。

### 变更

- 打包目标运行时由 Node 20 升级至 Node 22，pkg 由 6.6.0 升级至 6.22.0，矩阵 target 统一为 `node22-*`。

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
