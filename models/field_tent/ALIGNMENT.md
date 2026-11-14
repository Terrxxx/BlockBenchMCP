# 帐篷杆件端点修复

2026-11-14，使用 Blockbench AI MCP v0.6.0。修复 79 根外壳杆件与拉绳，保持 1218 个方块、21 个骨骼、完整内饰和原有贴图。其余 1139 个方块完全未改；原初版和细化版文件保留。

旧两点公式使用 XYZ 旋转假设，而 Bedrock 预览使用 ZYX，导致向下斜杆偏离锚点。新增 `create_beams` / `align_beams` 接受端面中心坐标，由插件计算姿态并以原生矩阵复核。两端是连接点，不要求杆件竖直；侧墙原有内倾保留。

本机交付位于 `aligned/`：

- `ranger_field_tent_aligned.bbmodel`：官方保存的可编辑工程。
- `ranger_field_tent_aligned.geo.json`、`ranger_field_tent_aligned.animation.json`、`field_tent_atlas.png`：资源文件，尚未组装资源包或游戏内验收。
- `comparison.html`：5 组同相机修复前后 PNG 对照；原始渲染未进行图像编辑。
- 上级 `ranger_field_tent_aligned.zip`：本机交付包（不提交）。

实测最大原生端点误差约 1.42e-14；官方保存后的数字舍入使最大端点误差约 5.25e-6 模型单位。用户一次 Undo/Redo 已验证 79 项整批撤销和重做，保留 ID/UV/贴图；重做后已再次保存。本阶段未做 GUI 重开或游戏内测试。

验证证据见 [alignment-verification.json](alignment-verification.json)，完整 API 记录见[第六阶段验证](../../docs/phase-six-verification.md)。`repair-beams.mjs` 需要本机保留的细化版中间文件，且拒绝覆盖已有交付文件；`verify-alignment.mjs` 生成精简证据和对比页。原始模型生成配方也已改用共享 ZYX 解算函数，避免后续生成再次引入同一错误；历史导出资源未改写。
