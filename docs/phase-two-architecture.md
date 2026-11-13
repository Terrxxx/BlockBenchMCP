# 第二阶段：Bedrock 骨骼与贴图

调研日期：2026-11-13。实施前设计。用户确认本阶段贴图范围为：**工作目录 PNG 导入、绑定方块、Box UV 设置**。不增加像素绘制、纹理生成、动画或资源包导出工具。整个实施与验证过程不使用 Computer Use。

## 官方 API 核实

GitHub 官方 releases API 核实当前稳定版仍为 [v5.2.2](https://github.com/JannisX11/blockbench/releases/tag/v5.2.2)，继续使用已验证的宿主基线及固定 SDK 版本。

| 官方来源 | 核实结果与决定 |
| --- | --- |
| [group.js](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/group.js)、[outliner_node.ts](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/abstract/outliner_node.ts) | 使用 `new Group`、`Group.extend`、`addTo`、`init`。`addTo` 本身不检查循环，服务端/插件 schema 与适配器必须完整预检。骨骼名称只接受宿主允许的字母、数字、下划线、点和短横线，并保证唯一。 |
| [group.js 的 transferOrigin](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/group.js#L316) | `transferOrigin` 会补偿子元素坐标。本阶段修改 origin 直接更新枢轴数值；调整父级保留模型中的坐标/旋转数值，不保证在旋转父级下保持世界空间外观。工具描述明确此语义。 |
| [bedrock.js](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock.js#L1573) | `bedrock` 为 `single_texture: true`，具有骨骼和 Box UV。本阶段只允许一个共享图集；不将逐方块 face 引用误称为多个独立材质。已有贴图时拒绝再次导入。 |
| [textures.js](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/texturing/textures.js) | `Texture.fromPath` 涉及文件关联和监视，不用于本阶段。插件用受限 fs 读取已经验证的 PNG，再通过官方 `Texture.fromDataURL` 解码为内置贴图；`Texture.add(false)` 在我们自己的 Undo 事务中加入工程。 |
| [textures.js 的图片加载](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/texturing/textures.js#L99) | 官方 `load_callback` 只在贴图属于工程且该工程激活后运行，不能用它等待尚未加入工程的贴图。在脱离工程的 Texture.img 上监听 load/error，保留宿主处理器，成功解码后再次确认当前工程和截止时间，再开始同步 Undo 事务。失败/超时清理监听器和临时贴图资源。 |
| [cube.js](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js#L672) | 用 `Cube.applyTexture(texture, true)` 绑定启用的面，保留禁用面；`setUVMode(true)`、`extend` 设置 `uv_offset`、`mirror_uv`、`autouv:0`，刷新交给宿主。 |
| [cube.js Box UV](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js#L1302) | Bedrock Box UV 使用 `floor(size + 1e-7)`，图集占用范围为 `2*(width+depth)` × `(height+depth)`。绑定及设置 UV 时检查完整范围，防止一半批次才失败。允许多个方块共用同一区域。 |
| [Undo 文档](https://www.blockbench.net/wiki/docs/undo/) 与 [undo.js](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/undo.js) | 骨骼事务记录 groups/outliner；方块调整记录受影响 elements；贴图新增记录 textures/bitmap。所有批次预检后只产生一个 Undo，失败更新 aspects 并 `cancelEdit(true)` 回滚。沿用第一阶段已修复的 groups 快照策略。 |

## 工具与状态

保留第一阶段四工具，增加以下六工具；命令仍为固定白名单：

| 工具 | 输入与行为 |
| --- | --- |
| `create_bones` | project_id + 最多 256 个骨骼；每项提供批内 key、唯一 name、origin/rotation，可用 parent_id 指向现有骨骼或 parent_key 指向同批骨骼。允许无序输入，先校验整棵图再按父级顺序创建。 |
| `update_bones` | 最多 256 个 `{bone_id, name?, origin?, rotation?, parent_id?}`；parent_id=null 表示顶层，省略表示不变。检查最终完整层级无环、无重名；先解除发生变化的父级再按最终层级恢复，支持合法的祖先关系调整。 |
| `reparent_cubes` | project_id、cube_ids、parent_id；将已有方块批量放入指定骨骼，保留方块坐标及旋转数值。 |
| `import_texture` | project_id、工作目录相对 PNG 路径、可选 name；最多 8 MiB、每边 4096 像素、静态 PNG，尺寸必须与工程贴图尺寸相同。只返回摘要，不通过 MCP 传输像素。 |
| `assign_texture` | project_id、texture_id、cube_ids；要求当前工程唯一图集，批量绑定所有启用面，预检 Box UV 范围。 |
| `set_cube_uv` | project_id、最多 256 个 `{cube_id, uv_offset, mirror_uv?}`；切换为 Box UV 并设置图集坐标，未提供 mirror_uv 时保留原值。 |

`create_cubes` 增加可选 parent_id，指定整批方块的父骨骼；省略时保留默认 root 行为，并复用用户通过骨骼工具创建的顶层 root。历史输出 root_group_id 继续表示该批父骨骼 ID。

`get_project_state` 增加骨骼及贴图摘要与分页偏移，方块增加 box_uv、uv_offset、mirror_uv 和显式 texture_ids；工程增加 texture_count。不返回贴图绝对路径或像素。Bedrock 的有效显示图集来自工程唯一贴图，未显式绑定的方块也可能显示它。

## 文件与异步边界

- 服务端先验证相对 PNG 路径、扩展名、普通文件与大小；插件重复路径检查，读取后验证 PNG 签名、IHDR、分块长度/CRC、IEND 和 APNG 排除，再交宿主解码。沿用软链接/junction/硬链接及目录越界保护。
- PNG 以内部 data URL 留在工程；不建立文件监视，不读取相邻 `.mcmeta`，不关联外部路径。保存继续使用官方工程 codec 嵌入贴图，不写回源 PNG。
- 解码发生在 Undo 事务之前，最长 5 秒且受请求剩余截止时间限制。等待期间若用户切换工程、打开其他编辑事务、导入另一贴图，提交前检查会拒绝，不自动重试。
- 连接协议及插件版本升级以拒绝旧插件/新服务端混用。现有 token、stdio、127.0.0.1、串行调度、request_id、超时和错误恢复策略保留。

## 分步实施与验证门槛

1. **调研与设计**：完成本文；确认纹理范围。完成后才修改运行代码。
2. **骨骼**：协议、层级规划、Host 接口和适配器；单元测试验证无序创建、循环/重名/缺失 ID、批量回滚、指定父级、分页，类型检查通过后继续。
3. **贴图与 UV**：PNG 目录读取、解析、原生异步解码、单贴图约束、绑定/UV Undo；测试损坏图片、尺寸/大小/路径越界、切换工程/截止时间、回滚及保存委托。
4. **通信与交付**：两个 MCP 协议模式均走真实 stdio + WebSocket，验证十工具；插件 bundle 受限模块测试；完整 check、README、配置示例及手动冒烟步骤。
5. **真实宿主**：构建完成后请用户重载插件并刷新 Codex MCP；在新工程上通过原生工具验证层级/PNG/UV/保存。Undo/Redo 与重开若要桌面复核，由用户手动操作并用状态回读验证。明确区分自动化替身与真实宿主结果，不使用 Computer Use。

实现进度和实际结果另记于 `phase-two-verification.md`。
