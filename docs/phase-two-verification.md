# 第二阶段验证记录

日期：2026-11-13。版本 0.2.0，桥接协议 v2，宿主基线 Blockbench 5.2.2，SDK 2.4.0。

- 官方调研与[架构文档](phase-two-architecture.md)已先于运行代码更新完成。
- 用户已确认 PNG 导入、方块绑定、Box UV 范围。
- 骨骼阶段：`npm run typecheck` 通过；`npm run test:unit` **5 个文件、46 项测试通过**。覆盖无序批量层级、重名/循环/缺失引用拒绝、部分创建和修改失败回滚、指定父级与分页。
- 贴图阶段：类型检查与 **61 项单元测试通过**，包含 PNG CRC/大小/尺寸、目录边界、加载期间工程/尺寸/编辑状态变化、图集限制、UV 范围及回滚。
- 最终 `npm run check`：**11 个测试文件、82 项测试通过**，严格类型检查、Server 与插件构建通过。覆盖原生图片事件成功/失败/超时清理、bitmap Undo 快照，以及 legacy / `2026-07-28` 两种 SDK 协议模式下全部十工具的真实 stdio + WebSocket 闭环。
- 已生成 `examples/atlas-64.png`：64×64、250 字节，供真实宿主验收；不是对外新增的贴图生成工具。
- 用户重载插件与 Codex 后，当前聊天出现全部十个原生工具，成功连接真实 Blockbench；十工具闭环、7 次 Undo/Redo 和重新打开工程 **全部实测通过**。
- 曾遇到旧进程未重启导致版本不匹配：旧 MCP 于 13:25 启动，新产物于 14:12 构建（America/Chicago）。用户重启后已解决；配置无需变更，没有更换密钥或扩大目录授权。
- 本轮不使用 Computer Use。

构建插件 SHA256：`35E38B39A61C66634449DBD7D0E4D02A17D56B138B78EB1AFE2E6B8D455F3EA1`。

新增工具：create_bones、update_bones、reparent_cubes、import_texture、assign_texture、set_cube_uv。`create_cubes` 支持指定父骨骼，`get_project_state` 支持骨骼/贴图分页与 UV/绑定摘要。

## Codex 原生真实宿主验收

测试时间：2026-11-13 14:30 起（America/Chicago）。工程 ID：`ccbddb9d-c393-f89d-4b73-8dd06e0a09b2`。全部模型修改通过当前聊天的原生 MCP 工具执行；Undo/Redo 由用户按键，结果通过 MCP 查询核对。[结构化证据](phase-two-live-evidence.json) 保留调用输入、返回和检查结果。

| 检查 | 结果 |
| --- | --- |
| 新建工程 | Bedrock，64×64，managed=true，初始为空 |
| 批量骨骼 | 无序输入 head/torso/root，创建后为 root → torso → head，共 3 个骨骼 |
| 方块与层级 | 一批 2 个方块放入 torso；head 换至 head 骨骼，坐标保持一致 |
| 骨骼修改 | head 枢轴 `[0,12,0]`，旋转 `[0,15,0]`，查询一致 |
| PNG 导入 | 实际解码 `examples/atlas-64.png`，64×64、internal=true；只存在 1 张图集 |
| UV 与绑定 | body `[0,0]`，head `[0,24]` 且 mirror_uv=true；两个方块全部启用面关联同一个贴图 ID |
| 官方保存与读回 | 3741 字节；骨骼、方块、outliner、UV、镜像和面贴图索引逐项一致 |
| 内置像素 | 保存文件中的 PNG 与源 PNG 的 SHA256 完全相同；源文件未改写 |
| 错误保护 | HIERARCHY_CYCLE、NAME_CONFLICT、TEXTURE_LIMIT、PATH_FORBIDDEN、UV_OUT_OF_BOUNDS、NOT_FOUND、FILE_EXISTS 均符合预期；拒绝后状态完全未变 |
| 用户撤销 7 次 | 返回 0 个骨骼、0 个方块、0 张贴图，无残留 |
| 用户重做 7 次 | 恢复 3 个骨骼、2 个方块、1 张贴图；所有 ID、父级、坐标、旋转、UV 和绑定与原状态一致 |
| 重做后再保存 | 官方 overwrite=true 保存本轮生成文件，3741 字节，文件 SHA256 与首次保存一致 |
| 重新打开 | 用户关闭并重开同一文件；所有骨骼、方块、贴图、UV 和绑定完全一致，新工程 ID，managed=false |

重开后的工程 ID：`4e2bb05d-1533-4f4c-f57d-602eb9921633`。工程名称、Bedrock 格式、模型标识及 64×64 尺寸保持一致。第二阶段验收完成；本轮真实验证未发现需要修改运行代码的新问题。

```text
models/phase2_smoke_20261113t203037z.bbmodel
bytes: 3741
SHA256: 8B215824C27237D6D03D0FA934866FC3C04E1FA597E268A5778A3673CE238E15

examples/atlas-64.png
bytes: 250
SHA256: D852B07075BA1B6D249098E41BBD3AAB58029721A888775E08773B493F2B9C12
```

PNG 损坏/超大文件、加载中切换工程、超时清理等项目由自动化测试覆盖，未在本次真实宿主逐项重演。没有据此声称它们全部经过桌面实测。

## 阶段提交约定

用户要求每完成一个阶段提交一次 Git，已记录到根目录 `AGENTS.md`。仓库此前没有任何提交，因此本次首次阶段提交包含第一阶段基础及第二阶段成果；不伪造第一阶段的历史提交。密钥、构建产物、临时数据和生成的 bbmodel 均排除在提交之外。
