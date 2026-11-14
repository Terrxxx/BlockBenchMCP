# 野外指挥帐篷示例

仓库示例采用作者选定的 `example/` 版本：**702 个方块、19 个骨骼、一张 1024 × 2048 PNG 图集**。包含帐篷外壳、窗格、拉绳与骨架，以及工作台、双层床、储物架和完整内饰。

![帐篷模型](../../docs/images/field-tent.png)

## 仓库资源

- [基岩版模型 JSON](example/ranger_field_tent.geo.json)
- [PNG 图集](example/field_tent_atlas.png)
- [剖视展示动画 JSON](example/ranger_field_tent.animation.json)

可在 Blockbench 打开模型 JSON，并导入对应图集继续编辑。动画 `animation.field_tent.cutaway` 在 0 秒显示完整外壳，1 秒缩小外壳以展示内饰，不是布料模拟。模型和动画 JSON、PNG 尚未组装成包含 manifest、client_entity 等文件的完整游戏资源包。

可编辑 `.bbmodel`、本地预览和原始会话不纳入 Git；克隆仓库获得的是上面的三份资源。本机可编辑工程位于 `example/ranger_field_tent.bbmodel`。此前的 1218 方块版本不再作为仓库示例。

## 验证

该版本已有通过 MCP 调用官方保存、导出和渲染的成功记录。本次替换核对了源文件与复制文件的 SHA-256、方块/骨骼数量、父子引用、动画骨骼引用、图集尺寸及封面图片；模型和贴图均原样复制，没有重新建模或修改外观。

精简统计和资源哈希见 [verification.json](verification.json)。本次没有重新连接宿主，也未对该版本执行 Undo/Redo、关闭重开或游戏内测试；此前 1218 方块对齐版的测试结果仍记录于[第六阶段验证](../../docs/phase-six-verification.md)，不作为当前示例的实测结论。
