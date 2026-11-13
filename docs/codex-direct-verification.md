# Codex 原生 MCP 闭环验收

日期：2026-11-13，约 13:40（America/Chicago，UTC−06:00）。工作目录：`D:\Desktop\BlockBenchMCP`。

## 结论

**通过。** 当前 Codex 聊天已加载 `blockbench_ai`，直接通过 `mcp__blockbench_ai` 调用全部四个工具，完成真实 Blockbench 工程的新建、批量建模、状态查询和官方保存。本轮没有使用 Computer Use，也没有通过任意代码执行接口控制 Blockbench。

插件连接前，原生 `get_project_state` 返回 `NOT_CONNECTED`。用户在 Blockbench 顶部 Tools 菜单执行 **Blockbench AI MCP: Connect** 并连接工作目录后，查询成功。随后开始下面的新工程测试。

## 实际调用与核对

工程名称：`codex_direct_smoke_20261113t194018z`。名称后缀使用 UTC 时间以避免文件重名。

工程 ID：`253fcf8f-3349-b9cd-c865-b38f6566f927`。

| 操作 | 实际结果 |
| --- | --- |
| 连接后查询 | 读取已有工程成功；原工程为 6 个方块、1 个骨骼、`managed=false` |
| `create_project` | 新建 Bedrock Entity，64×64，0 个方块、0 个骨骼，`managed=true` |
| `create_cubes` | 单次请求创建 body、head、left_foot、right_foot、left_arm、right_arm 共 6 个方块，返回 6 个原生 ID 和一个 root ID |
| `get_project_state` | 6 个方块、1 个骨骼；逐项比较名称、ID、from、to、origin、rotation、parent_id 全部一致，`next_offset=null` |
| `save_project` | 相对路径保存，`overwrite=false`，返回 `saved=true`、3690 字节 |
| 保存后查询 | 工程 `saved=true`，方块数据与保存前完全一致 |
| 文件读取复核 | 实际字节数一致；模型格式、名称、标识、64×64 分辨率、6 个元素的 ID/坐标/旋转、root 与 outliner 子级均符合预期 |

所有 12 项程序化比较均通过，包含非零头部/手臂旋转和小数坐标。官方 codec 会省略零旋转字段，读取复核时将缺省值按 `[0,0,0]` 比较。

完整输入、工具返回与比较结果见 [codex-direct-smoke-evidence.json](codex-direct-smoke-evidence.json)。证据记录 6 次成功原生调用；连接前的诊断失败未混入成功调用记录。

## 保存产物

```text
models/codex_direct_smoke_20261113t194018z.bbmodel
bytes: 3690
SHA256: 15A853BE7D059FC1803E43FE94BF647DBE7E1EBB06A196617F7B215DB77C6915
```

模型由插件调用官方 `Codecs.project.compile` / `Codecs.project.write` 生成。文件复核只读取该已保存文件，没有手写或改写 bbmodel。已保存的新工程留在 Blockbench 中，Codex MCP 服务继续运行。

## 验证范围

本轮验证 Codex 原生四工具闭环，没有重新执行 Undo/Redo 或关闭重开操作；这两项已有此前真实桌面验收的[独立记录](verification.md)。本轮没有更改运行代码；原有 48 项自动化测试的结果仍属于此前 `npm run check`。
