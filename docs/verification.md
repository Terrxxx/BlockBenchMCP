# 第一阶段验证记录

日期：2026-11-13。工作目录：`C:\path\to\BlockBenchMCP`。Windows，Blockbench **5.2.2**，Node.js **24.14.0**，npm **11.9.0**，插件 **0.1.0**，官方 MCP SDK **2.4.0**。

## 结论

第一阶段真实桌面闭环通过。测试通过官方 MCP Client 启动真实 stdio Server，连接本机 Blockbench 插件；模型操作全部使用四个白名单工具，Undo/Redo 和重新打开文件通过桌面正常操作完成。没有使用开发者控制台或任意代码执行接口控制 Blockbench。

真实测试发现并修复了两个宿主兼容问题，随后重新构建、重载插件，在新工程上完整复测。最终 `npm run check`：严格类型检查、7 个测试文件、**48 项测试**和两端构建全部通过。

随后同日完成 **Codex 当前聊天内的原生 MCP 闭环**：直接调用四个工具，新建另一 Bedrock 工程，一次创建 6 个方块，核对内存状态，保存 3690 字节 bbmodel 并复核实际文件。本轮由用户连接桌面插件，全程未使用 Computer Use。详见[原生调用验收](codex-direct-verification.md)与原始调用记录（已从当前仓库移除）。下文 Undo/Redo、关闭重开的记录属于首次桌面验收。

## Git 与本机配置

- 已执行 `git init -b main`。私有配置、依赖、构建产物、临时数据和 bbmodel 文件均被 `.gitignore` 排除。
- 已通过 `codex mcp add blockbench_ai` 注册到本机用户的全局配置；`codex mcp get blockbench_ai --json` 确认 `enabled: true`、transport 为 stdio。
- 实际命令：`D:\Program Files\nodejs\node.exe`。
- 实际参数：`C:\path\to\BlockBenchMCP\dist\server\index.js --workspace C:\path\to\BlockBenchMCP`。均为绝对路径，不依赖 Codex 启动目录。
- 已在本机 Blockbench 的“从文件加载”中加载 `dist/plugin/blockbench_ai_mcp.js`，并给当前目录选择 **Allow once**。本次没有授予持久目录权限；重载插件或下次启动时可能再次询问。
- 首次桌面验收使用官方 SDK 独立客户端，与 Codex 配置使用相同入口和参数。当时聊天尚未加载四个工具；随后 Codex 加载 `blockbench_ai`，原生调用也已验证通过。
- 首次验收后已停止独立测试 Server，释放 `30031`。原生验收时由 Codex 启动服务端；用户通过 Tools 菜单连接同一工作目录后，四个工具调用成功。

## 两项修复

1. **原生 ID 被 RFC UUID 校验误拒绝。** 首批方块已出现在视图，但创建结果和后续状态查询返回 `INVALID_MESSAGE`。官方 [guid / isUUID 实现](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/util/math_util.js#L2) 不设置 RFC UUID 的版本位和变体位。现将工程/元素/骨骼 ID 与 request_id 分开校验，保留严格的请求 UUID 和未知字段校验。测试宿主也改为使用不符合 RFC 位约束的原生格式 ID，覆盖完整 stdio/WS 路径。
2. **Undo 撤销方块后残留 root。** 实测为 `4/1 → 0/1`。官方 [UndoSystem](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/undo.js) 的 outliner 只追踪层级，需显式登记 groups。现在在开始、结束和取消编辑时登记 groups 快照；新增回归测试覆盖 before/post 和取消时的快照保留。

## 真实桌面结果

下面的计数均为“方块数 / 骨骼数”。原始调用明细已从当前仓库移除，以下保留最终轮次的结果与验证边界。

| 检查 | 结果 |
| --- | --- |
| 初始化/列举工具 | 四个工具均出现；离线查询返回 NOT_CONNECTED，插件连接后查询成功 |
| create_project | 新建 Bedrock Entity，64×64，初始 0/0；其他测试标签保留 |
| 首批创建 | body/head/left_foot/right_foot 一次创建，4/1，视图正确；head 旋转为 `[0,15,0]` |
| 首批 Undo / Redo | **4/1 → 0/0 → 4/1**；比较全部方块 ID、父级、坐标、origin、rotation 均一致 |
| 追加批次 | 一次创建两个手臂，6/1，复用同一个 root；手臂旋转为 `[0,0,±10]` |
| 非法混合批次 | from > to 导致完整批次拒绝；合法项也未创建，没有新增 Undo 步骤 |
| 追加批次 Undo / Redo | **6/1 → 4/1 → 6/1**；原有 root 保留，全部方块数据恢复一致 |
| 官方保存 | Codecs.project.compile/write 实际写出 3687 字节 bbmodel，saved=true，未保存标记消失 |
| 覆盖保护 | 未传 overwrite 返回 FILE_EXISTS；overwrite=true 成功 |
| 目录保护 | `../escape.bbmodel` 返回 PATH_FORBIDDEN，未进入宿主保存 |
| 工程匹配 | 给另一个工程 ID 返回 PROJECT_MISMATCH，未追加方块 |
| 关闭并重新打开 | Ctrl+W 关闭已保存标签，Ctrl+O 打开同一文件；新工程 ID，6/1，格式、标识、贴图尺寸及所有方块数据一致 |
| 重开工程保护 | managed=false；尝试保存返回 PROJECT_NOT_OWNED，`must_not_write.bbmodel` 未生成 |
| 进程重启恢复 | 停止测试 Server，再运行 `npm run smoke -- --workspace ... --inspect-only --wait-seconds 30`；插件自动重连，真实状态查询成功，脚本正常退出 |

首次桌面验收的模型保存在工作目录；后续 Codex 原生验收另建了测试工程：

```text
desktop_smoke_final_20261113.bbmodel
bytes: 3687
SHA256: A2953447C03A8CF6544535B315E082013883D793B3B0A9DB5A95F696AF34C643
```

首轮未保存临时标签已丢弃；中间验证标签已关闭，其中间保存文件 `desktop_smoke_pre_undo_fix_20261113.bbmodel` 留在目录中并被 Git 忽略。

## 自动化覆盖与边界

- 严格参数/协议校验、未知命令/字段、非有限坐标、批量上限、过期请求、版本、消息大小和原生 ID。
- 保存目录边界、覆盖、设备名、ADS、junction、硬链接、外部资源及 scoped fs 缺少 lstat/realpath 的场景。
- 真实 WebSocket 鉴权、Origin、单插件限制、乱序匹配、超时不重放、断线清理、取消、重连和停止重连。
- 调度器串行、近期 ID 去重、ID 冲突、队列过期；适配器单个 Undo、批次失败回滚、格式/工程保护、codec 委托和保存失败恢复。
- 真实 stdio 子进程和官方 Client 的 legacy / `2026-07-28` 模式；受限原生模块环境中的插件 bundle 加载/连接/卸载。
- 人为磁盘写入失败、外部贴图、256 项上限和卸载菜单清理没有在真实 GUI 中逐项重演；对应自动化覆盖不等于这些项目已桌面实测。
- 官方 writer 不保证原子保存；目录校验无法防止其他本机进程在检查后替换路径。超时或断线后仍需先核对状态，不能自动重试修改。

贴图、骨骼编辑、动画、渲染和资源导出仍属于后续阶段，本轮未扩展这些工具。
