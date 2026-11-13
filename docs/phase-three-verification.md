# 第三阶段验证记录

日期：2026-11-13；版本：0.3.0，bridge v3。环境：Windows、Node.js 24.14.0、Blockbench 桌面 5.2.2、MCP SDK 2.4.0。

## 自动化检查

`npm run check` 通过严格 TypeScript 检查、13 个测试文件中的 **105 项测试**及服务器/独立插件构建。

覆盖片段创建与更新、三通道批量关键帧、精确时间与稳定 UUID、批量删除、分页、所有权、表达式限制、非法批次预检、失败回滚及动画 Undo 快照；回环 WebSocket 和真实 stdio 测试覆盖全部 16 个工具。动画查询的超时、取消、异常结果及断线均保持 `outcome_unknown:false`，修改超时仍标为未知且不重放。

## 真实桌面验收

使用官方 SDK 客户端 → stdio Server → 本地 WebSocket → 实际 Blockbench 插件。正常 GUI 用于插件重载、Undo/Redo、关闭和重新打开；未通过 DevTools、任意代码接口或手写 bbmodel 操控宿主。

当前聊天缓存的是此前十个工具，因此本记录明确属于独立 SDK 的真实宿主验收，不宣称当前聊天已直接调用六个新工具。验收后独立客户端和服务器已退出，需重启 Codex 加载最新工具列表。

| 检查 | 结果 |
| --- | --- |
| 新建工程、父子骨骼、方块 | 2 骨骼、2 方块，层级与 UUID 正确 |
| 创建片段 | `animation.phase3.wave`，2 秒、loop、snapping 20 |
| 批量关键帧 | 一次 9 帧，rotation / position / scale，linear / step |
| 定点预览 | time=1，时间线暂停，姿态可见 |
| 更新片段 | `animation.phase3.wave_checked`，2.5 秒、hold、snapping 30 |
| 混合 upsert | 现有旋转帧改为 -65 度且 UUID 保留；新增 0.12345 秒位移帧，无吸附 |
| 批量删除 | 删除新增位移帧及末尾缩放帧，剩余 8 帧 |
| 原生 Undo/Redo | 连续 5 次 Undo 恢复零动画；5 次 Redo 与基线完全一致，包括全部 UUID、数值、插值和片段属性 |
| 无效请求保护 | 7 例失败后完整状态不变 |
| 官方保存 | 通过工程 codec 保存，磁盘内容与查询基线一致 |
| 关闭后重开 | 工程 UUID 改变；骨骼、方块、动画及关键帧 UUID 和数据保留；新工程只读 |
| 超时恢复 | 打开系统文件窗口期间一次只读查询超时；关闭窗口后查询恢复，没有重试修改 |

7 个负例：批次第二帧超过片段长度、缩短长度至现有帧之前、重复片段名、未知删除 ID、表达式输入、越界预览、与现有帧相差小于 1e-7 秒。表达式在 SDK 输入 schema 层拒绝，未到达插件，也没有伪造桥接错误码。

实际发现并修复两项原生宿主问题：

1. `Canvas.updateAll` 会恢复静态姿态。数值动画的 Animate 模式下刷新后重新 `Animator.preview`，测试确认更新关键帧后姿态保持。
2. 单独登记 keyframes 时，撤销片段创建再重做会缺少 animator，导致关键帧恢复失败。先准备轨道，再同时登记 animations/keyframes 前后快照；真实 5 次 Undo/Redo 已验证完整恢复。

最后补充只读错误分类后，重新构建、重载最终插件、连接并读取已重开的工程，再次与完整动画基线深比较通过。该补丁未改变原生动画编辑实现。

## 留存证据

- [完整调用与断言记录](phase-three-live-evidence.json)：28 次最终闭环调用及最终构建重载查询。
- 工程：`models/phase3_smoke_20261113t2114z.bbmodel`，4051 字节，8 帧；本机保留，Git 忽略生成模型。
- 工程 SHA-256：`98016461557d6b4a10954c6956e312a50dbd3ddc83886a1a7fafe92191ccfcc8`。
- 最终插件 SHA-256：`980cb6e1fd843604289538b279bde64aa3f3ad7b52e18d85923dbd3a3a2d3288`。
- [手动复现步骤](phase-three-smoke-test.md)、[工具调用示例](../examples/phase-three-tool-calls.json)。

本阶段不包含 Molang、效果轨道、动画控制器、外部 animation JSON 或资源包导出；bbmodel 内嵌动画已验证。其他 Blockbench 版本尚未真实验收。
