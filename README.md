# Blockbench AI MCP

通过本机 stdio MCP Server 与 Blockbench 桌面插件，操作 **Minecraft Bedrock Entity** 工程。v0.2.0 提供十个工具：工程、批量方块、骨骼层级、PNG 图集、贴图绑定、Box UV 和官方 `.bbmodel` 保存。

第二阶段按用户选择实现工作目录 PNG 导入、绑定和 Box UV；像素绘制、贴图生成、骨骼删除、动画、渲染及资源包导出仍属于后续阶段。`save_project` 保存可继续编辑的 Blockbench 工程，不生成 Bedrock 资源包。

## 当前实现与验证

- 官方 MCP TypeScript SDK v2：`@modelcontextprotocol/server@2.4.0`，客户端测试使用同版 client；版本与 lockfile 已固定。
- Blockbench 官方 API 基线 **5.2.2 桌面版**；编译类型 `blockbench-types@5.2.1`。
- 共享 Zod schema、严格 TypeScript、白名单协议、工作目录隔离、批量 Undo、超时/重连、结构化日志。
- v0.2.0 **82 项自动化测试通过**，覆盖单元、真实 WebSocket、两种 MCP 协议模式的十工具 stdio 闭环和受限模块环境中的插件 bundle。类型检查与构建通过；第二阶段真实宿主状态见[第二阶段验证记录](docs/phase-two-verification.md)。
- **2026-11-13 真实 Blockbench 5.2.2 桌面验收通过**：两批共 6 个方块、Undo/Redo、官方保存、关闭后重新打开及错误保护。见[验收记录](docs/verification.md)和[复现步骤](docs/manual-smoke-test.md)。
- **2026-11-13 Codex 原生 MCP 闭环通过**：当前聊天直接调用四个工具，新建 Bedrock 工程、一次创建 6 个方块、查询核对、保存并读取文件复核；本轮未使用 Computer Use。见[原生调用验收](docs/codex-direct-verification.md)。
- **2026-11-13 第二阶段真实闭环通过**：原生调用十工具，3 个骨骼、2 个方块、1 张 PNG 图集、Box UV 与绑定、官方保存、7 次 Undo/Redo 及关闭后重开均已核对。见[第二阶段验证记录](docs/phase-two-verification.md)。

先完成[官方 API 调研与架构](docs/architecture.md)，再逐阶段实现与验证。第二阶段先写[骨骼与贴图设计](docs/phase-two-architecture.md)，通过骨骼测试后再实现贴图；详细消息结构见[协议说明](docs/protocol.md)。第一阶段的真实桌面/原生调用记录保留，不等同于新增功能已桌面实测。

## 安装和构建

推荐 Node.js 24 LTS，开发工具链支持 `^22.12.0 || ^24.0.0 || >=26.0.0`。另需 npm、Blockbench 5.2.2+（主版本 5）桌面版。开发验证使用 Node 24.14.0。插件不支持 Blockbench Web。

```powershell
Set-Location 'D:\Desktop\BlockBenchMCP'
npm ci --include=dev
npm run check
```

`--include=dev` 确保在默认省略开发依赖的环境中也安装 TypeScript 和测试工具。npm 缓存位于项目 `.npm-cache/`，依赖位于 `node_modules/`。

产物：

```text
dist/server/index.js               stdio MCP Server（依赖项目 node_modules）
dist/plugin/blockbench_ai_mcp.js    可单独加载的桌面插件
```

## 初始化授权工作目录

选定你允许工具保存模型的目录。默认示例直接使用本项目；可选择其他**明确授权**的已有目录。

```powershell
npm run setup -- --workspace 'D:\Desktop\BlockBenchMCP'
```

初始化创建 `.blockbench-ai-mcp.json`，包含工作目录、默认端口 `30031`、15 秒请求超时和随机 256 位密钥。**不要提交、分享或复制密钥到聊天。** 已有配置不会被覆盖；不需要每次启动都运行 setup。目录移动后需停用双方、保留/移走旧配置并重新初始化，然后重新连接插件。

端口需要更换时，可在首次初始化指定 `--port 30032`；已有配置应在停用双方后手动编辑 `port`，再启动服务端并重新 Connect。不要修改固定 `host: "127.0.0.1"`。同一个端口只能运行一个服务端；只接受一个认证插件。

## 加载插件

1. 在 Blockbench 打开插件管理，选择从文件加载，定位 `dist/plugin/blockbench_ai_mcp.js`。
2. 启动下一节配置的 Codex MCP，或使用下面的独立冒烟脚本。
3. 打开顶部 **Tools／工具** 菜单，选择 **Blockbench AI MCP: Connect**。在弹出的 **Blockbench AI MCP** 对话框中，将 **Workspace directory** 填为上述工作目录的绝对路径，再确认。如果 Tools 中没有该项，先回到插件管理确认插件已加载并启用。
4. Blockbench 5.2 会请求该目录的文件访问权限。插件使用官方 `requireNativeModule('fs', {scope})`，需要读取连接配置与检查保存目标。允许该目录后应出现连接成功提示。

插件只使用内置 WebSocket 连接 `127.0.0.1`，不请求 process、shell、child_process 或通用网络模块。出于宿主权限兼容性，插件不使用 Node 版 ws。服务端使用 ws 并固定监听回环地址。

Tools 菜单中的 **Disconnect** 会关闭连接并停止重连。再次手动 Connect、卸载或重载插件会开始新的管理会话；已存在的工程只能读取，不能再由新会话修改。普通网络断线自动重连不会清除管理会话。

## Codex MCP 配置

将[配置示例](examples/codex-config.toml)中的配置表加入 Codex 的 `~/.codex/config.toml`，或受信任项目的 `.codex/config.toml`。这两种位置及 `command`、`args`、`cwd`、超时设置来自 [OpenAI 官方 MCP 文档](https://developers.openai.com/codex/mcp)。`setup` 脚本只生成工作目录内的桥接配置；本机已按用户授权通过 CLI 注册 `blockbench_ai`，具体路径和验证边界见[验证记录](docs/verification.md)。

```toml
[mcp_servers.blockbench_ai]
command = "node"
args = ["D:/Desktop/BlockBenchMCP/dist/server/index.js", "--workspace", "D:/Desktop/BlockBenchMCP"]
cwd = "D:/Desktop/BlockBenchMCP"
startup_timeout_sec = 15
tool_timeout_sec = 30
enabled_tools = ["create_project", "get_project_state", "create_cubes", "save_project", "create_bones", "update_bones", "reparent_cubes", "import_texture", "assign_texture", "set_cube_uv"]
```

请根据实际安装位置调整路径。若 Codex 找不到 `node`，将 `command` 改为 `Get-Command node` 返回的完整路径。`--workspace` 必须是绝对路径；工具调用不能改变它。`tool_timeout_sec` 应大于连接配置的 `timeout_ms / 1000`。

也可使用官方 CLI 配置方法：

```powershell
codex mcp add blockbench_ai -- node 'D:\Desktop\BlockBenchMCP\dist\server\index.js' --workspace 'D:\Desktop\BlockBenchMCP'
codex mcp list
codex mcp get blockbench_ai --json
```

配置后在 Codex 中重启该 MCP Server；如果当前聊天仍看不到工具，完全退出并重新启动 Codex 桌面应用后再检查。Codex 会启动进程，不需要额外手动运行 `npm start`。避免同时启动独立 smoke/另一个 Codex 实例占用同一个端口。MCP 初始化不要求插件已连接；未连接时调用工具返回 `NOT_CONNECTED`。Codex 中启用 `blockbench_ai` 与 Blockbench 插件执行 Connect 是两个步骤；工具出现后仍需完成上述插件连接。

## 第一阶段升级到 v0.2.0

构建后重载 Blockbench 中从文件加载的插件，并重启 Codex 的 `blockbench_ai` 服务，再在 Tools 中 Connect。本地桥接协议升级到 **v2**，要求插件 **0.2.0**；旧插件与新 Server 会拒绝握手。现有工作目录配置与密钥继续使用，不需要重新 setup。若原 Codex 配置设置了四项 `enabled_tools`，更新为上面的十项；没设置此白名单时无需添加它。

插件重载会开始新的管理会话，已有标签可读取但不能修改；请用 `create_project` 新建测试工程。第二阶段[手动冒烟步骤](docs/phase-two-smoke-test.md)不需要 Computer Use。

## 四个基础工具

### 1. create_project

```json
{ "name": "mcp_demo", "model_identifier": "mcp_demo", "texture_width": 64, "texture_height": 64 }
```

返回 `project.id`（Blockbench 原生 GUID，不能假定符合 RFC UUID 版本位）。新建的是 Bedrock Entity 标签，不关闭已有工程。`model_identifier` 不带 `geometry.` 前缀；Bedrock 官方导出器后续会处理该前缀。

### 2. create_cubes

把下面的 `project_id` 替换为刚返回的 UUID：

```json
{
  "project_id": "ca16f180-e67b-4b6f-bdf7-a856f826af48",
  "cubes": [
    { "name": "body", "from": [-4, 0, -2], "to": [4, 12, 2] },
    { "name": "head", "from": [-4, 12, -4], "to": [4, 20, 4], "origin": [0, 12, 0] }
  ]
}
```

一次最多 256 个方块，完整校验后才开始修改。第一次批次同时建立 root 骨骼作为容器；同一工程后续批次复用它。使用 `Cube` / `Group`、一个 `Undo.initEdit` / `finishEdit` 和 `Canvas.updateAll`，同时登记 elements、groups 和 outliner 快照；部分失败通过 `cancelEdit(true)` 回滚。一个 Ctrl+Z 撤销整个批次，首次建立的 root 也一并撤销。

v0.2.0 可在请求顶层传 `parent_id`，把整批方块放入已有骨骼。未指定时复用/创建顶层 root。返回的历史字段 `root_group_id` 表示本批实际父骨骼 ID；骨骼编辑使用下面的专用工具。

### 3. get_project_state

```json
{ "offset": 0, "limit": 100 }
```

返回当前标签的工程摘要、方块、骨骼、贴图摘要。分别用 `offset`、`bone_offset`、`texture_offset` 分页，三类共用 `limit`（默认 100，最大 200），对应返回各自的 `next_*offset`。方块包含 Box UV、mirror_uv 和显式 texture_ids；贴图仅返回 ID、名称、尺寸和 internal。没有工程时 `project: null`。可以读取用户已打开的工程，但只有 `managed: true` 的当前工程可修改/保存；不暴露绝对路径或像素。

### 4. save_project

```json
{
  "project_id": "ca16f180-e67b-4b6f-bdf7-a856f826af48",
  "path": "models/mcp_demo.bbmodel",
  "overwrite": false
}
```

使用 `Codecs.project.compile({bitmaps:true, absolute_paths:false})` 和 `Codecs.project.write(...)`，不手写完整 bbmodel。父目录必须存在；示例 `models/` 已提供。成功返回相对路径和字节数。覆盖已有文件必须明确设置 `overwrite: true`。

官方 5.2.2 文本写入是同步的，写入异常会还原工程保存元数据。官方 writer 不提供原子替换保证；磁盘写入中途失败时目标文件可能部分改变，不能把失败当成“磁盘未变化”。本项目不调用 `saveTextures(true)`，避免另行覆盖贴图文件；工程 codec 嵌入贴图，且编译前拒绝工作目录外的磁盘资源引用。

## 骨骼与贴图工具

全部修改要求当前受管工程的 `project_id`；批量操作每次最多 256 项，每批一个 Undo 步骤。完整调用示例见 [phase-two-tool-calls.json](examples/phase-two-tool-calls.json)。

| 工具 | 用法 |
| --- | --- |
| `create_bones` | 每项含 `key`、`name`，可指定 `origin`、`rotation`。父级用已有 `parent_id` 或同批 `parent_key`，不可同时提供。批内顺序任意，名称必须唯一。返回 key → ID 映射。 |
| `update_bones` | 每项含 `bone_id`，加至少一个 name/origin/rotation/parent_id。parent_id=null 移到顶层；省略保持原父级。禁止循环和重名。 |
| `reparent_cubes` | `cube_ids` 批量移动到 `parent_id` 骨骼。 |
| `import_texture` | 从相对 `path` 导入静态 PNG，可指定 name。上限 8 MiB、每边 4096 像素，尺寸须匹配工程。仅允许工程中没有贴图时导入一个共享图集。 |
| `assign_texture` | 将 `texture_id` 绑定到 `cube_ids` 的所有启用面，保留禁用面；方块须为 Box UV 且 UV 完整落在图集中。 |
| `set_cube_uv` | 每项含 `cube_id`、`uv_offset:[u,v]`、可选 `mirror_uv`；设为 Box UV、关闭自动 UV。省略 mirror_uv 保留现值，完整预检后统一修改。 |

骨骼枢轴/层级工具保留子元素存储的坐标数值；旋转父级下的世界空间外观可能随之改变。不会自动做保持外观的坐标补偿，也不修改动画。

Bedrock Entity 是单贴图格式：本阶段只支持一张共享图集，不承诺逐方块独立材质。显式 face 绑定会写入工程，但未绑定的方块也可能使用默认图集显示。PNG 读入后成为内置贴图，不建立源文件关联/监视，不读取相邻 `.mcmeta`；官方工程保存会嵌入像素，不覆盖源 PNG。示例 [atlas-64.png](examples/atlas-64.png) 为 64×64 测试图集。

## 文件边界与错误恢复

- 保存只接受工作目录中的相对 `.bbmodel` 路径；拒绝绝对路径、`..`、Windows 设备名/ADS、软链接/junction 和硬链接目标。
- PNG 导入采用相同目录边界；两端先检查路径/大小，插件检查 PNG 签名、分块/CRC 与尺寸，再由 Blockbench 解码。加载期间不打开 Undo，最长 5 秒；提交前重新检查工程、编辑事务、尺寸、已有图集和截止时间。
- 两端都验证保存目标；插件先使用 scoped fs 获得指定目录权限，再逐级校验。不会通过 MCP 读取任意文件或执行任意代码。
- 修改必须携带当前活动工程的 UUID，切换标签会触发 `PROJECT_MISMATCH`。手动编辑中的 Undo 事务会返回 `BUSY`。
- 超时/断线/取消时，已发送的操作可能已经完成。`outcome_unknown: true` 时先读取状态、核对文件，再决定是否重试。系统不会自动重放修改。
- 错误以稳定错误码返回；完整列表和重连/缓存边界见[协议说明](docs/protocol.md)。

模型目录及配置文件需要由可信本机用户控制；校验无法阻止其他进程在检查和写入之间替换路径。宿主自带设置、最近工程和其他已安装插件属于 Blockbench 自身的运行环境。

## 测试与开发

```powershell
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

`npm run check` 串行执行类型检查、全部测试、构建。测试临时文件只写入仓库 `.tmp/`，不会使用用户模型目录。测试替身保存的 `TEST_ONLY_OFFICIAL_CODEC_STUB` 仅验证调用链，不是可打开的 bbmodel。

独立真实桌面闭环：

```powershell
npm run smoke -- --workspace 'D:\Desktop\BlockBenchMCP'
```

它启动 stdio 服务端，等待插件连接，新建测试标签、创建 body/head 方块，并保存不覆盖旧文件的 `mcp_smoke_<唯一后缀>.bbmodel`。只想检查连接可增加 `--inspect-only`。运行 smoke 前停止占用该端口的 Codex MCP。完整[桌面验收步骤](docs/manual-smoke-test.md)包括视图、Undo/Redo、重新打开文件和错误恢复。

## 项目结构

```text
src/shared/      协议、schema、错误、配置、目录策略、日志
src/server/      stdio 入口、MCP 工具、回环 WebSocket 服务端
src/plugin/      桌面生命周期、重连、调度器、工程适配器、官方 API 绑定
scripts/        构建、工作目录初始化、真实桌面 smoke 客户端
tests/unit/     协议、路径与宿主适配单测
tests/integration/  WebSocket、stdio、插件 bundle 集成测试
docs/           架构研究、协议、手动验收与验证记录
examples/       Codex 配置及工具调用示例
models/         示例模型保存目录
```

## 常见问题

| 现象 | 处理 |
| --- | --- |
| EADDRINUSE | 停止重复的 MCP/smoke 进程，或给另一工作目录选择独立端口 |
| NOT_CONNECTED | 检查 Blockbench 已加载插件、输入目录正确、服务端已启动 |
| 插件反复重连 | 检查两端是否读取同一个配置文件、端口/密钥是否一致；不要在服务端运行中修改配置 |
| 插件加载时报 API 错误 | 检查是否为桌面稳定版 5.2.2+；重新构建并从文件重载 |
| PATH_FORBIDDEN | 检查父目录是否存在，以及路径是否含链接、设备名或越界片段 |
| PROJECT_NOT_OWNED | 新建工程；当前阶段不接管重载插件前或手动打开的工程 |
| SAVE_FAILED | 检查目标目录写权限与磁盘空间；检查目标文件后再操作 |
| NOT_FOUND / NAME_CONFLICT / HIERARCHY_CYCLE | 重新查询 ID、使用唯一骨骼名，并修正最终父子层级 |
| INVALID_TEXTURE / TEXTURE_TOO_LARGE / TEXTURE_LOAD_FAILED | 使用可解码的静态 PNG，并检查尺寸/文件大小 |
| TEXTURE_SIZE_MISMATCH / TEXTURE_LIMIT | 使用匹配工程尺寸的 PNG；当前阶段只导入一个图集 |
| UV_OUT_OF_BOUNDS | 调整 UV 偏移，使完整 Box UV 展开范围落在工程图集内 |
| 终端看起来没有输出 | stdio Server 等待 MCP 客户端；日志写 stderr，stdout 专用于 MCP |

## 后续阶段

在第二阶段验收后，再分别设计贴图绘制、动画、渲染与资源导出模块；每次扩展都需要专用输入 schema、官方 API 调研、Undo 策略、目录边界与对应验证，不添加通用 `eval` 或 shell 工具。
