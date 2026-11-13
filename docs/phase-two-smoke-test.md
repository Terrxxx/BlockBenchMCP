# 第二阶段真实宿主冒烟步骤

本说明由人操作 Blockbench 的插件管理、Undo/Redo 和打开文件；模型修改通过白名单 MCP 工具执行，不需要 Computer Use 或开发者控制台。

## 载入 v0.2.0

1. `npm run check` 成功后，在 Blockbench 插件管理中重载 `dist/plugin/blockbench_ai_mcp.js`，确认版本 0.2.0。
2. 重启 Codex 的 `blockbench_ai` MCP，使其加载新 `dist/server/index.js`。若配置中 `enabled_tools` 仅四项，按 README 更新；如果聊天仍无新工具，完全退出并重启 Codex。
3. 在 Blockbench 顶部 Tools 菜单执行 **Blockbench AI MCP: Connect**，Workspace directory 为 `D:\Desktop\BlockBenchMCP`。若需要目录权限，选择 Allow once。确认出现 connected 提示。
4. 原生调用 `get_project_state` 验证连接；返回应有 bones、textures、texture_count 等新字段。旧协议/插件组合会拒绝握手，不应继续执行修改。

## 新工程闭环

按 [phase-two-tool-calls.json](../examples/phase-two-tool-calls.json) 顺序调用并保存返回的 ID。每次测试使用新的工程名与文件名。

1. 新建 64×64 Bedrock 工程。
2. `create_bones` 无序提供 head、torso、root，确认返回 3 个 ID，最终层级 root → torso → head。
3. **可选人工 Undo/Redo**：此时 Ctrl+Z 后查询骨骼数 0；Ctrl+Y 后恢复 3，核对骨骼 ID、枢轴、父级一致。
4. `create_cubes` 指定 torso 为父级，一次创建 body/head 两方块；`update_bones` 设置 head 枢轴/旋转；`reparent_cubes` 将 head 方块移到 head 骨骼。查询层级和坐标，方块数仍为 2，骨骼数仍为 3。
5. 使用 `import_texture` 导入仓库自带 `examples/atlas-64.png`。确认 64×64、internal=true、texture_count=1，且原 PNG 未被改写。
6. **可选人工 Undo/Redo**：导入后立刻 Ctrl+Z，查询贴图数 0；Ctrl+Y 后恢复 1，同一个贴图 ID。旧/new 贴图实例由官方 Undo 管理，MCP 应继续按 ID 工作。
7. `set_cube_uv` 分别使用 `[0,0]` 和 `[0,24]`，head mirror_uv=true；`assign_texture` 一次绑定两个方块。查询所有方块的显式 texture_ids 和 UV。
8. **可选人工 Undo/Redo**：绑定/UV 各为独立一步；逐次撤销和重做，用状态回读确认绑定与 UV 恢复，骨骼和坐标不受影响。
9. `save_project` 保存到新的 `models/*.bbmodel`，确认 saved=true、字节数非零。读取文件复核 3 个 groups、2 个 cube、1 张包含 data URL 的内置贴图、完整 outliner、UV 与镜像。
10. **可选人工重开**：关闭已保存标签再打开同一 bbmodel；查询模型、骨骼、UV、贴图均一致，工程 ID 改变且 managed=false。当前阶段不接管重开的工程。

## 错误恢复

在另一个新建受管测试工程上操作，失败后始终查询状态核对：

- 骨骼 parent 指向自身/子孙：HIERARCHY_CYCLE；同批合法项也不提交，不增加 Undo。
- 同名骨骼、重复批内 key/ID、找不到的父级或方块：拒绝整批，不静默改名。
- `../outside.png`、绝对路径、软链接、硬链接：PATH_FORBIDDEN；损坏 PNG：INVALID_TEXTURE 或 TEXTURE_LOAD_FAILED。
- PNG 尺寸与工程不一致：TEXTURE_SIZE_MISMATCH；第二张图集：TEXTURE_LIMIT。
- UV 完整展开超出 64×64：UV_OUT_OF_BOUNDS；同批其他项也保持不变。
- 加载过程中切换工程/开始手动编辑：提交前拒绝，原工程与当前工程不应新增贴图；超时后先查询，不自动重试。
- 保存存在路径而未传 overwrite=true：FILE_EXISTS；磁盘中源 PNG 始终保持原样。

逐项记录“实际执行/未执行”和工具结果。自动化替身覆盖不能替代图片在真实宿主中加载、官方 Undo 和重开后的确认。
