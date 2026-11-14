# 第四阶段验证记录

日期：2026-11-13。版本 0.4.0，bridge v4；官方 API 基线 Blockbench 5.2.2。

## 已执行

- 严格 TypeScript 检查通过。
- 15 个测试文件、125 项测试通过；插件及 stdio Server 构建通过。
- 覆盖三种导出输入/路径/链接边界、覆盖保护、完整选择预检、编译后重新检查、截止时间、失败结果确定性、逐字节校验、PNG 内容与尺寸、官方 API 参数、动画吸附碰撞及越界、IK 拒绝。
- 真实 stdio 与回环 WebSocket 的 legacy/modern 两种 MCP 协议模式均覆盖全部 19 工具；宿主使用可控替身，此项不等于真实 Blockbench 导出。
- 新增 `npm run smoke:exports` 可复现真实宿主验收并生成调用/文件 hash 记录。

插件 bundle 测试发现不支持的 node:buffer 导入，已用 Uint8Array、TextEncoder、atob 替代，回归通过。

## 真实宿主验收状态

**真实 Blockbench 5.2.2 验收通过**。用户重载插件后，运行 `npm run smoke:exports -- --workspace 'D:\Desktop\BlockBenchMCP' --wait-seconds 120`，脚本退出码 0，`passed:true`。本地时间 2026-11-13 22:50（America/Chicago），证据使用 UTC 时间 2026-11-14T04:50:36Z。

本轮未使用 Computer Use。当前聊天没有暴露 Blockbench MCP 工具，因此使用官方 SDK 独立客户端 → 真实 stdio Server → 127.0.0.1 WebSocket → 实际桌面插件。客户端确认全部 19 工具，验收后正常退出并释放端口；不宣称本轮由 Codex 当前聊天直接调用导出工具。

| 检查 | 结果 |
| --- | --- |
| 新建与官方工程保存 | 2 骨骼、1 方块、1 张内置 64×64 PNG、2 动画；先保存 bbmodel，再测试导出 |
| 模型 JSON | identifier、图集尺寸、arm 父级 root、pivot 的 X 符号、方块 origin/size/Box UV 全部符合预期 |
| 动画 JSON | 两个指定片段；旋转 X/Y 与位移 X 符号转换正确，hold_on_last_frame、step 的 pre/post、scale 正确 |
| PNG | 250 字节，与输入内置图集逐字节相同 |
| 覆盖保护 | 未显式授权返回 FILE_EXISTS，原文件不变；overwrite:true 成功 |
| 路径和选择保护 | 工作目录外路径返回 PATH_FORBIDDEN；混入未知动画 ID 返回 NOT_FOUND |
| 工程状态 | 三种导出及覆盖前后的工程、骨骼、方块、贴图与原动画关键帧完整查询结果相等，saved 保持 true |
| 吸附冲突 | 0.1 与 0.1001 秒合法源帧在官方导出时会合并，返回 KEYFRAME_CONFLICT；目标未创建，源帧完整不变 |

## 文件与证据

- [调用和文件 hash 记录](phase-four-live-evidence.json)。
- 本机产物前缀：`models/mcp_export_mwfxgj4o_c4b4f047`，生成文件已由 Git 忽略。

| 文件后缀 | 字节数 | SHA-256 |
| --- | --- | --- |
| .geo.json | 863 | `89d601e524b1df59f3abba1e965f30e39e0bbaed8de6f7c7ef64893d6184aa83` |
| .animation.json | 925 | `49c53842877df7a0c46af447fbeab19817a724553f87ba67b7ab32ac8b4e7ebb` |
| .png | 250 | `d852b07075ba1b6d249098e41bbd3aab58029721a888775e08773b493f2b9c12` |

验收插件 SHA-256：`4f3a11347cf4825975ad915f236c20b5f9f15c8b475c1784857edc222a5ce561`。

最后的冲突保护测试主动新增了两帧，桌面测试标签因此留有未保存更改；已保存的 bbmodel 与成功导出的文件对应冲突测试前的数据。该未保存状态不是导出造成的。

完整步骤见[第四阶段冒烟说明](phase-four-smoke-test.md)。本阶段未做 Minecraft 游戏内资源加载、完整资源包组装或其他 Blockbench 版本验收。
