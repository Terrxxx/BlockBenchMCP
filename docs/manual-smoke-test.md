# 桌面手动冒烟测试

**2026-11-13 已在真实 Blockbench 5.2.2 上通过核心闭环。** 本次测试使用两批共六个方块，结果见[验证记录](verification.md)。原始调用记录已从当前仓库移除，以下步骤供后续构建复验。

## 前置条件

1. 使用 Blockbench **5.2.2** 桌面版、Node.js 24 LTS，在仓库执行 `npm ci --include=dev`、`npm run check`。
2. 首次执行 `npm run setup -- --workspace "C:\path\to\BlockBenchMCP"`。已有配置不要重复初始化。
3. 在 Blockbench 插件管理选择“从文件加载”，选中 `dist/plugin/blockbench_ai_mcp.js`。更新代码后先构建，再在该插件详情页点“重新加载”。
4. 按 README 配置并启动 Codex MCP。在 Tools 菜单点击 **Blockbench AI MCP: Connect**，输入同一绝对工作目录；官方权限弹窗选择 **Allow once** 即可完成本次验收。
5. 使用专用新测试标签。全程仅通过四个 MCP 工具修改模型，通过正常桌面快捷键 Undo/Redo 和重新打开。

独立快速检查也可执行：

```powershell
npm run smoke -- --workspace 'C:\path\to\BlockBenchMCP'
```

它使用官方 Client 启动独立 Server，创建 body/head 两个方块并保存唯一文件名，然后退出。加 `--inspect-only` 时只查询当前状态。与 Codex MCP 二选一运行，避免端口冲突。下面的完整验收需要保持 MCP 会话，以便每次桌面操作后查询状态。

## 完整闭环

1. `create_project`：使用唯一名称和 model_identifier，64×64。记录返回的 `project.id`，并确认 format=bedrock、managed=true、计数 0/0。
2. `create_cubes`：单次创建四个方块，记录 ID 和 root_group_id。可复用证据文件中第一批 body/head/left_foot/right_foot 的参数。
3. `get_project_state`：保存基线，核对视图和 4 个方块、1 个 root。
4. 在桌面按 **Ctrl+Z 一次**，再查询状态：应为 **0 方块、0 骨骼**，视图为空。
5. 按 **Ctrl+Y 一次**，再查询状态：恢复 **4/1**。逐项比较 ID、parent_id、from、to、origin 和 rotation。
6. 再通过一次 `create_cubes` 添加两个手臂，应为 **6/1** 且复用原 root。
7. 提交混合非法批次（一项合法、一项 from > to），应整批失败；状态保持 6/1。Ctrl+Z 应直接撤销上一批手臂，得到 **4/1**；Ctrl+Y 恢复 **6/1**。这样同时检查失败未插入 Undo 步骤。
8. `save_project` 使用工作目录内的新相对 `.bbmodel` 路径。应返回 saved=true 和正字节数；再次查询 saved=true，标签未保存标记消失。
9. **Ctrl+W 关闭该标签**，然后 **Ctrl+O 打开刚保存的文件**。不要仅切换标签作为重开验证。查看视图并查询状态：工程 ID 可改变，格式、标识、贴图尺寸、方块坐标/旋转和层级应保持一致。
10. 重开后的 managed=false；对新 ID 调用 save_project 应返回 PROJECT_NOT_OWNED。第一阶段不会通过 MCP 接管已有或重开的工程。

## 错误和恢复检查

| 操作 | 预期 | 本次真实桌面结果 |
| --- | --- | --- |
| 错误活动工程 ID | PROJECT_MISMATCH，无修改 | 通过 |
| 路径 `../escape.bbmodel` | PATH_FORBIDDEN | 通过 |
| 同名文件未传 overwrite | FILE_EXISTS | 通过 |
| 同名文件 overwrite=true | 官方 codec 覆盖，saved=true | 通过 |
| 重开工程尝试保存 | PROJECT_NOT_OWNED，不产生目标文件 | 通过 |
| 停止 Server，再启动同端口 Server | 插件自动重连，状态查询恢复 | 通过 |
| 插件重载并手动 Connect | 新管理会话，旧标签 managed=false | 通过 |
| 点击 Disconnect 后查询 | NOT_CONNECTED，不阻塞 MCP | 自动化覆盖；本次未单独手点 |
| 卸载/禁用插件 | 菜单消失、连接关闭、停止重连 | 自动化覆盖；本次保留插件供使用 |
| 外部磁盘贴图、绝对路径、ADS、链接、磁盘失败 | 相应错误，遵守保存边界 | 自动化覆盖；本次未逐项桌面重演 |

超时、错误 token、重复 ID、乱序响应和部分批次回滚由自动化测试覆盖；无需通过任意代码执行接口制造桌面故障。

## 结束和记录

关闭本轮临时标签，保留已保存的验收模型；停止独立测试 Server，让 Codex 使用该端口。插件可保持自动重连。

```text
日期 / 系统 / Blockbench / Node / 插件版本：
MCP 客户端来源（Codex 或官方 SDK Client）：
批量创建及 root 复用：
首批 Undo/Redo 计数：
追加批次 Undo/Redo 计数：
保存路径 / 字节数 / SHA256：
关闭后重新打开的数据比较：
错误保护与重连：
问题、修复和复测：
```
