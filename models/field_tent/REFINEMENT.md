# 帐篷细化版交付与验证

2026-11-14，Blockbench 5.2.2 / MCP v0.5.0。目标为更接近用户参考图的帆布外观，同时保留完整内饰。

## 文件

仓库中的本地目录：`models/field_tent/refined-final/`。

- `ranger_field_tent.bbmodel`：可编辑工程，由 MCP 调用官方保存接口生成，内置贴图。
- `ranger_field_tent.geo.json`：官方 Bedrock 几何导出，标识符 `geometry.ranger_field_tent_refined`。
- `ranger_field_tent.animation.json`：可选剖视展示动画；0 秒完整外观，1 秒缩小外壳以查看内饰。
- `field_tent_atlas.png`：2048×2048，24 个材质区，4 像素内缩留边。
- `comparison.html`：浏览器打开即可，切换七个视角并拖动滑块对比；引用同目录中的原始渲染 PNG，不修图。
- `exterior/interior/cutaway/front/back/side/entrance_detail.png`：细化版原生渲染。`before_` 前缀为初版同机位渲染。

工作目录还有 `ranger_field_tent_refined_delivery.zip`：展开后打开 `comparison.html` 或 `.bbmodel`。工程、预览、ZIP、会话日志按仓库规则留在本地；制作配方、材质、资源 JSON 与验证清单进入 Git。

## 外观调整

| 项目 | 初版 | 细化版 |
| --- | --- | --- |
| 方块 / 骨骼 | 702 / 19 | 1218 / 21 |
| 侧墙 | 垂直 | 内倾约 7.28°，底部外展，保留室内空间 |
| 帆布 | 平整板面、均匀噪点 | 屋顶浅波纹、侧墙折痕、针脚、压边、补丁、底部脏污 |
| 侧面识别 | 三扇大窗，标志挤在条带附近 | 两扇小窗，中部完整帆布与翼形标志 |
| 门口 | 方形开口，支架不突出 | 梯形开口、成对斜撑、金属套箍和螺栓、多层卷帘 |
| 贴图 | 材质区紧贴 UV 起点 | 方向性纤维、褶皱明暗、区域内缩留边，修复细构件串色 |

设计控制名义长宽高约 10×7×5 格；拉绳锚点宽度约 7.4 格，比原版略宽。帆布为小幅方块分段近似，不是三角网格布料模拟；没有电影光照、真实阴影或游戏发光配置。为了 Bedrock 方块建模兼容性，外轮廓和褶皱保持像素风。

## 内饰保留

九组共 **440 个原有构件**：地板 100、地毯 32、工作台 84、灯具 25、公告板 21、前后双层床各 38、后部物资架 92、散放物资 10。按构件名（忽略生成序号）、from/to/origin/rotation 逐项比较。

物资架整组向中间平移 3.5 单位，避免原边缘穿出侧墙；物品、尺寸和相互关系未删减。其余八组几何保持一致。添加 2 块地板边条连接外展侧墙。图集重新排布，因此 UV 和像素颜色允许改变。新建工程的 UUID 与原版不同，未声称保留原工程 ID。

## 真实验证

提交前 `npm run check` 通过：严格类型检查、18 个测试文件共 152 项测试、构建；三个资产脚本的语法检查通过。

- 通过官方 SDK → stdio → 回环 WebSocket → 桌面插件构建，未使用 Computer Use 或宿主任意代码接口。
- 全批次 schema 和材质区范围预检；真实分页查询核对 1218 方块、贴图绑定及 saved=true。
- 读取官方 bbmodel 逐一核对几何/UV、21 骨骼和侧墙旋转。官方保存会舍入小数，比较容差为 0.00001 模型单位/度；不是将精度差异误报为编辑丢失。
- Bedrock 几何计数一致；PNG 结构/CRC/尺寸检查通过。
- 7 组前后渲染均为 1200×900，相机参数、背景和剖视时间匹配。初版在第一轮细化前由真实 MCP 重新渲染，第二轮复用这些文件，核对记录与相机；没有把历史不同机位图片混入比较。
- 实际查看外观、正面、侧面、门口局部、内饰和剖视。首轮发现收音机等细构件串色与条带被褶皱遮断，增加 4px 材质留边、调整条带厚度后重新构建与渲染，确认改善。
- 原版交付的九个文件 SHA-256 全部未改变；验证数据见 `refinement-verification.json`。
- 本次未操作 GUI Undo/Redo、关闭重开，也未进游戏测试。现有 MCP 服务端未修改，新增工具建议见 `docs/mcp-modeling-retrospective.md`，不混写为已经实现。

## 配方与复核

`build-refined.mjs` 负责材质、保留内饰和 MCP 编排；`refined-shell.mjs` 只生成外壳参数。需保留本地初版 `final/recipe.json`、`final/result.json`，构建目标目录须存在且没有同名产物。原版活动工程必须仍属于插件会话，才可重新渲染比较。若仅复用此次已记录的原版对比图，可使用 `--reuse-baseline`；它要求本地 `refined/` 的首次记录和图像，并检查相机一致。

```powershell
node --import tsx models/field_tent/build-refined.mjs --reuse-baseline
node --import tsx models/field_tent/verify-refined.mjs
```

构建使用排他写入保护现有交付，不能直接覆盖运行；需要复现时先改为工作目录内的新目标目录。验证脚本可重复运行，不操控宿主，输出清单与比较页。
