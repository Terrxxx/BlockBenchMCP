# 第三阶段：基岩版实体动画

调研日期：2026-11-13。实现依据宿主 Blockbench 5.2.2 官方源码及已安装的 blockbench-types 5.2.1；沿用已验证的 MCP SDK 2.4.0。

## 官方 API 调研

- [Animation](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/animation.js)：`new BBAnimation(options).add(false)` 创建片段，`extend` 修改属性，`getBoneAnimator(group)` 获取骨骼轨道。运行时公开 BBAnimation 别名避免 DOM Animation 冲突。`setLength` 会把长度提升至最后关键帧，所以输入先检查，禁止静默改变请求。
- [GeneralAnimator / BoneAnimator](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/timeline_animators.js)：`addKeyframe` 使用精确时间；`createKeyframe` 会按当前时间线吸附并自动替换相邻帧，本阶段避免这个隐含行为。
- [Keyframe](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/keyframe.js)：`extend` 更新，`remove` 删除。输入只开放 position / rotation / scale 数值向量及 linear / step 插值，不开放脚本、Molang、效果轨道、路径或任意 API 名称。
- [Undo](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/undo.js)：片段元数据使用 animations 快照；关键帧同时登记 animations 和 keyframes 快照，必须先选择目标动画并把目标轨道加入 Timeline，再捕获 before。动画快照保证撤销片段创建后重做时先重建轨道；关键帧快照负责删除/恢复 UUID。单独 keyframes 恢复会跳过不存在的 animator。整动画 extend 不会清除快照里不存在的新轨道，所以目标轨道必须在 before 前准备完整。
- [Timeline](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/timeline.js) 与 [Animator](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/animation_mode.js)：暂停、选择 Animate 模式、setTime、preview 做定点预览，不启动持续播放。Timeline.setTime 限制到 1000 秒，因此本阶段长度和时间也上限 1000 秒。预览不进入 Undo。Canvas.updateAll 会恢复静态姿态，故在数值动画的 Animate 模式下刷新后再调用 Animator.preview；遇到表达式或动画控制器则不自动预览。
- [官方工程 codec](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bbmodel.js)：继续沿用官方工程编译与保存，动画随 bbmodel 保存，不引入外部动画文件写入。

## 范围与协议

新增六个工具：create_animation、update_animation、set_keyframes、delete_keyframes、get_animation_state、preview_animation。前五项中查询只读；其余修改继续要求活动的本会话托管 Bedrock 工程。预览也要求托管工程，避免执行未知工程的表达式或效果。

- 片段名为 `animation.<namespace>.<name>` 形式的 ASCII 标识，长度 (0, 1000] 秒；loop 为 once/loop/hold，snapping 10–500。
- 批量关键帧 1–256 项，以骨骼 ID + channel + 精确 time 定位。相同槽位更新并保留 UUID；不存在则新增。重复槽位、模糊的既有重复时间、超出片段长度、未知骨骼都在事务前拒绝。
- 每片段最多 4096 帧、每工程最多 128 片段，限制 Undo 快照与消息负载。读取分页至多 200 帧，返回原始数值或有界文本，不计算表达式。非数值/效果片段可查询但不通过本阶段工具编辑或预览。
- 批量删除按 UUID，整批检查后执行，一次 Undo。元数据更新不得缩短到最后一帧之前。
- 版本升至 v0.3.0 / bridge v3；旧插件与服务器明确拒绝互连，需同时重载。超时不自动重试，查询两个 state 工具核对。

## 模块与验证顺序

1. 此文档先行；新增共享 schema、动画控制器、窄类型宿主动画适配层。
2. 验证边界、原子性、回滚、UUID 稳定性与所有权；运行严格类型及旧测试。
3. 扩展真实 stdio → WebSocket 通信测试；确认 legacy / modern MCP 模式均支持新增工具。
4. 用户本阶段已授权 Computer Use，允许正常 GUI 重载既有本地插件、Undo/Redo、预览与重新打开测试文件。若权限窗口不能自动处理则如实记录阻塞，不绕过权限机制。
5. 真实宿主验证骨骼三通道、更新/删除、拒绝无效批次、Undo/Redo、官方保存/重新打开；更新 README、证据、验证记录后提交一次 Git。
