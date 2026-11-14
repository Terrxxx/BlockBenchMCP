# Blockbench AI MCP

通过本机 stdio MCP Server 与 Blockbench 桌面插件，操作 **Minecraft Bedrock Entity** 工程。v0.6.0 提供二十二个工具：工程、批量方块、骨骼层级、PNG 图集、Box UV、骨骼动画、官方 `.bbmodel` 保存、Bedrock 资源文件导出及离屏 PNG 渲染。

第三阶段加入数值骨骼动画，第四阶段加入资源文件导出，第五阶段加入指定相机和动画时刻的 PNG 渲染。像素绘制、贴图生成、骨骼删除、Molang、动画控制器及完整资源包组装仍属于后续阶段。`save_project` 保存可继续编辑的 Blockbench 工程，不生成 Bedrock 资源包。

## 当前实现与验证

- 实际建模案例：[参考图野外指挥帐篷](models/field_tent/README.md)，初版 702 方块；[细化版](models/field_tent/REFINEMENT.md) 1218 方块、21 骨骼，保留 440 个原有内饰/地板构件，七组同机位渲染对比。由此形成[下一阶段 MCP 改进建议](docs/mcp-modeling-retrospective.md)，其中两点杆件与原位端点对齐已于[第六阶段](docs/phase-six-architecture.md)实现；[修复版帐篷](models/field_tent/ALIGNMENT.md)完成 79 根杆件对齐，其他建议工具仍待实现。

- 官方 MCP TypeScript SDK v2：`@modelcontextprotocol/server@2.4.0`，客户端测试使用同版 client；版本与 lockfile 已固定。
- Blockbench 官方 API 基线 **5.2.2 桌面版**；编译类型 `blockbench-types@5.2.1`。
- 共享 Zod schema、严格 TypeScript、白名单协议、工作目录隔离、批量 Undo、超时/重连、结构化日志。
- v0.6.0 **174 项自动化测试通过**，覆盖单元、真实 WebSocket、两种 MCP 协议模式的二十二工具 stdio 闭环和插件 bundle。严格类型检查与构建通过。
- **第六阶段真实 Blockbench 5.2.2 端点验收通过**：9 个方向原生矩阵探针、79 根杆件原位对齐、一次 Undo/Redo、官方保存与五组同机位渲染；见[验证记录](docs/phase-six-verification.md)。
- **第五阶段真实 Blockbench 5.2.2 渲染验收通过**：透视/正交侧视/顶视、动画 0/1 秒、透明/纯色背景、重复渲染一致及错误保护；见[第五阶段验证记录](docs/phase-five-verification.md)。
- **第四阶段真实 Blockbench 5.2.2 导出验收通过**：模型 JSON、批量动画 JSON、PNG、覆盖与路径保护、吸附冲突拒绝、工程状态保持均已核对；见[第四阶段验证记录](docs/phase-four-verification.md)。
- **第三阶段真实 Blockbench 5.2.2 验收通过**：官方 SDK 客户端调用六个动画工具，三通道关键帧、5 次 Undo/Redo、保存与重开一致；修复动画刷新和重建轨道的 Redo 问题。见[第三阶段验证记录](docs/phase-three-verification.md)。
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
enabled_tools = ["create_project", "get_project_state", "create_cubes", "save_project", "create_bones", "update_bones", "reparent_cubes", "import_texture", "assign_texture", "set_cube_uv", "create_animation", "update_animation", "set_keyframes", "delete_keyframes", "get_animation_state", "preview_animation", "export_bedrock_model", "export_bedrock_animations", "export_texture_png", "render_project", "create_beams", "align_beams"]
```

请根据实际安装位置调整路径。若 Codex 找不到 `node`，将 `command` 改为 `Get-Command node` 返回的完整路径。`--workspace` 必须是绝对路径；工具调用不能改变它。`tool_timeout_sec` 应大于连接配置的 `timeout_ms / 1000`。

也可使用官方 CLI 配置方法：

```powershell
codex mcp add blockbench_ai -- node 'D:\Desktop\BlockBenchMCP\dist\server\index.js' --workspace 'D:\Desktop\BlockBenchMCP'
codex mcp list
codex mcp get blockbench_ai --json
```

配置后在 Codex 中重启该 MCP Server；如果当前聊天仍看不到工具，完全退出并重新启动 Codex 桌面应用后再检查。Codex 会启动进程，不需要额外手动运行 `npm start`。避免同时启动独立 smoke/另一个 Codex 实例占用同一个端口。MCP 初始化不要求插件已连接；未连接时调用工具返回 `NOT_CONNECTED`。Codex 中启用 `blockbench_ai` 与 Blockbench 插件执行 Connect 是两个步骤；工具出现后仍需完成上述插件连接。

## 升级到 v0.6.0

构建后重载 Blockbench 中从文件加载的插件，并重启 Codex 的 `blockbench_ai` 服务，再在 Tools 中 Connect。本地桥接协议升级到 **v6**，要求插件 **0.6.0**；旧插件与新 Server 会拒绝握手。现有工作目录配置与密钥继续使用，不需要重新 setup。若原 Codex 配置设置了旧版 `enabled_tools`，更新为上面的二十二项；没设置此白名单时无需添加它。

插件重载会开始新的管理会话，已有标签可读取但不能修改；请用 `create_project` 新建测试工程。第三阶段[手动冒烟步骤](docs/phase-three-smoke-test.md)覆盖完整动画闭环。第三阶段曾按用户授权使用正常 GUI 自动化验收；第六阶段未使用 Computer Use，原生 Undo/Redo 由用户操作后通过 MCP 查询验证。新增工具列表由客户端缓存时，需要完全重启 Codex；独立 SDK 验收不代表当前聊天已经热加载新工具。

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

## 两点杆件与端点对齐

v0.6.0 新增以下工具，解决手算 Euler 角造成的杆件偏离连接点问题。示例见 [phase-six-tool-calls.json](examples/phase-six-tool-calls.json)。

| 工具 | 参数与行为 |
| --- | --- |
| `create_beams` | `project_id,parent_id,beams:[{name,start,end,thickness,uv_offset?,mirror_uv?}]`；在指定骨骼下批量创建杆件方块 |
| `align_beams` | `project_id,beams:[{cube_id,start,end,thickness?}]`；原位对齐已有方块，省略 thickness 时保持 X/Z 截面尺寸，保留 ID、名称、父级、贴图、UV |

`start/end` 是两端面的中心，使用与 Cube.from/to 一致的、父骨骼旋转前的建模坐标。长度 0.01–4096，截面 0.01–256；每批最多 256 根，一个 Undo 步骤。两端必须不同；输入和生成坐标均限制 ±32768。支持 Bedrock ZYX 旋转、Box UV，无 inflate/stretch/rescale。改变长度后仍须保证完整 Box UV 位于图集中。

工具先校验整批，修改后刷新原生视图，再用原生节点矩阵测量两端；误差超过 1e-6 则整批回滚。结果逐根返回实际 `start,end,length,endpoint_error,cube_id`。这项误差是内存中的几何精度，官方保存的数值舍入会产生额外误差，实际记录见[第六阶段验证](docs/phase-six-verification.md)。

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

## 动画工具

详见[官方 API 与动画架构](docs/phase-three-architecture.md)、[参数示例](examples/phase-three-tool-calls.json)。所有时间单位为秒，旋转为度，位移为 Blockbench 模型单位，缩放为倍率。

| 工具 | 参数与行为 |
| --- | --- |
| `create_animation` | `project_id,name,length`；可选 `loop`（once/loop/hold）、`snapping`（10–500，默认 20） |
| `update_animation` | `project_id,animation_id` 与至少一个 name/length/loop/snapping；禁止缩短到最后一帧之前 |
| `set_keyframes` | `keyframes:[{bone_id,channel,time,value:[x,y,z],interpolation?}]`；三通道 rotation/position/scale；linear 默认或 step |
| `delete_keyframes` | `keyframe_ids` 批量删除，整批检查后修改 |
| `get_animation_state` | `project_id` 必填；未指定 `animation_id` 时分页片段，指定时分页该片段骨骼关键帧；offset/limit，返回 total/next_offset |
| `preview_animation` | `project_id,animation_id,time`；暂停时间线并显示指定姿态，切换 Animate 模式，不添加 Undo |

片段长度 (0,1000] 秒，每工程最多 128 个片段；每片段最多 4096 个关键帧。关键帧每批 1–256 项，查询每页最多 200 项。以“骨骼 ID＋通道＋精确时间”定位：已有帧更新并保留 UUID，新位置创建；不按 snapping 自动吸附。小于 1e-7 秒的近邻冲突直接报错。数值向量分量范围 [-32768,32768]，不接受表达式。

设置/删除关键帧会选择目标片段并把所需轨道放入时间线。每批使用一个原生 Undo；先准备轨道再共同登记 animations/keyframes，确保从零动画重做时也能恢复。定点预览的 `playing:false` 表示时间线暂停，动画列表的播放标记表示该片段参与当前姿态计算。

读取不计算 Molang，原生数值字符串原样返回；`editable:false` 表示包含本阶段不支持的表达式、效果或插值。预览/关键帧操作要求整个工程没有动画控制器和含表达式或效果的片段，因为暂停与选择动作也会触发宿主预览。重开的工程可以查询，不能直接修改。动画随官方 bbmodel 保存，v0.4.0 可通过下方专用工具导出 Bedrock animation JSON；界面中的 “Unsaved” 动画文件分组不代表 bbmodel 没有保存。

## Bedrock 资源导出

v0.4.0 新增三个文件导出工具，设计依据见[第四阶段架构](docs/phase-four-architecture.md)，[验收状态](docs/phase-four-verification.md)与[复现步骤](docs/phase-four-smoke-test.md)单独记录。

| 工具 | 参数与行为 |
| --- | --- |
| `export_bedrock_model` | `project_id,path,overwrite?`；path 必须以 `.geo.json` 结尾，调用官方 Bedrock codec |
| `export_bedrock_animations` | 上述参数及 `animation_ids`（1–128 个不同 ID）；path 以 `.animation.json` 结尾；选定数值动画编译到同一文件 |
| `export_texture_png` | `project_id,texture_id,path,overwrite?`；path 以 `.png` 结尾，导出内置静态 PNG |

全部要求本会话托管的活动 Bedrock 工程；只写授权工作目录，父目录须存在，默认不覆盖，`overwrite:true` 表示替换整个目标文件。每个资源最大 8 MiB；PNG 最大 4096×4096。返回相对 path、bytes、kind、warnings，写入后核对实际内容，不传回大段文件内容。

导出不添加 Undo、不设置工程、动画或贴图为已保存，也不修改源资源路径。`save_project` 仍负责 `.bbmodel` 保存。这三个工具产生可供资源包使用的文件，尚不生成 manifest/client_entity 或可安装资源包。

模型沿用官方 export 标志及“导出空骨骼”设置；省略可见边界以避免当前动画姿态影响导出并改变工程。动画沿用官方坐标转换、step pre/post 表示、snapping 时间吸附及长度四位小数规则；吸附冲突或越界会在写入前拒绝。第三阶段存储的精确时间保持不变。暂不支持表达式、IK、控制器和效果轨道。

三个工具分别写一个文件，没有跨文件事务。写入异常返回 `EXPORT_FAILED`；`outcome_unknown:true` 时目标可能部分写入，须先核对文件，不能自动重试。编译或预检失败不会开始写入。覆盖不会合并原 JSON 中的其他模型或动画。

独立真实验收（先停止同端口 Codex MCP）：

```powershell
npm run smoke:exports -- --workspace 'D:\Desktop\BlockBenchMCP'
```

脚本等待插件连接，新建测试工程、导出三种文件，核对坐标、UV、动画插值、PNG 内容、覆盖保护和导出前后状态。生成文件仅留在 `models/mcp_export_*`，被 Git 忽略。不自动重试修改；失败时保留现场。

## 指定相机与动画时刻渲染

`render_project` 从官方离屏媒体视口输出 PNG，输入如下（替换实际 project_id，选择未占用的路径）：

```json
{
  "project_id": "<project_id>",
  "path": "models/render.png",
  "width": 512,
  "height": 512,
  "camera": {
    "projection": "perspective",
    "position": [40, 28, 48],
    "target": [0, 8, 0],
    "fov": 40
  },
  "background": "transparent"
}
```

可增加 `animation:{"animation_id":"<animation_id>","time":0.5}` 指定姿态；省略则渲染静态初始姿态。时间不按 snapping 吸附，使用官方插值，须在片段长度内。支持第三阶段纯数值、linear/step 骨骼动画；不支持控制器、IK、全局旋转轨道或非方块元素。

相机使用 Blockbench 预览世界坐标，`up` 默认 `[0,1,0]`。正交相机使用 `projection:"orthographic"` 和 `vertical_size`（竖直可见范围，0.1–4096 模型单位）；透视相机 fov 为 10–120 度，默认 45。顶视图可用 position `[0,64,0]`、target `[0,8,0]`、up `[0,0,-1]`。位置不得与目标重合，up 不得与视线平行。

尺寸每边 64–2048，默认 512×512，PNG 上限 8 MiB。背景为 transparent 或 #RRGGBB；输出不自动裁切，模型可能因相机参数位于画面外。保留宿主材质、灯光、抗锯齿及通道 mute 设置；隐藏网格、控件及预览场景，不加载外部背景。仅允许会话托管工程与内置贴图，路径/覆盖限制同第四阶段。

调用不切换用户模式、所选动画或用户相机，不添加 Undo，不把工程标记为已保存。临时模型姿态、时间、插值缓存和媒体相机/尺寸/背景会在写入前恢复。同步 GPU 渲染不能强制中断；超过请求截止时间则不再写文件。`RENDER_FAILED` 且 outcome_unknown=true 表示恢复失败或写入结果不确定，应先检查现场。

完整[架构](docs/phase-five-architecture.md)、[示例](examples/phase-five-tool-calls.json)和[手动冒烟说明](docs/phase-five-smoke-test.md)。独立真实验收需先停止同端口 Codex MCP：

```powershell
npm run smoke:render -- --workspace 'D:\Desktop\BlockBenchMCP'
```

脚本等待插件连接并生成七张 PNG，解码像素验证视角/动画差异、透明背景、纯色角像素、重复静态一致性及工程数据不变。文件和证据位于 Git 忽略的 `models/mcp_render_*`。

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
| KEYFRAME_OUT_OF_BOUNDS / KEYFRAME_CONFLICT | 检查片段长度、重复或过近的时间槽位 |
| UNSUPPORTED_ANIMATION / ANIMATION_LIMIT | 使用本阶段支持的纯数值动画并检查片段/关键帧数量上限 |
| 终端看起来没有输出 | stdio Server 等待 MCP 客户端；日志写 stderr，stdout 专用于 MCP |

## 后续阶段

第五阶段完成 PNG 渲染后，再分别设计贴图绘制、高级动画、批量帧渲染与完整资源包组装模块；每次扩展都需要专用输入 schema、官方 API 调研、Undo 策略、目录边界与对应验证，不添加通用 `eval` 或 shell 工具。
