# 帐篷实战后的 MCP 改进建议

2026-11-14。依据实际的初版 702 方块、19 骨骼和细化版 1218 方块、21 骨骼制作过程。本文原记录基于 v0.5.0 / 20 工具。随后用户指出杆件端点错位，第六阶段已实现 `create_beams` / `align_beams`（v0.6.0 / 22 工具），见[设计](phase-six-architecture.md)与[验证](phase-six-verification.md)；下列通用编辑及纹理建议仍未实现。

## 本次验证出的优点与成本

已有链路能够连续批量创建千级方块、单图集绑定、骨骼分组、官方保存/导出和同机位渲染，工作目录隔离也覆盖了新产物。内饰通过九组几何比较保留，原版工程未覆盖。

迭代的主要成本来自编辑能力缺失：不能按 ID 更新方块的位置、尺寸和旋转，不能替换已有图集，也不能临时隐藏指定骨骼进行剖视。首次镜像布局和此次侧墙/材质迭代只能重新建立工程；纹理微调又要重新创建/绑定 1218 个方块。当前剖视通过额外缩放动画实现，会给模型增加原本不需要的动画数据。

新增的可视缺陷也很具体：小于 1 模型单位的构件，在 Box UV 边界附近出现相邻材质串色；为各材质区域加 4 像素内缩留边后，收音机原先出现的黄色细条消失。现有 UV 检查只保证整张图集不越界，不能检查用户定义的材质区域、留边或零尺寸 UV 面。

## 优先级与最小范围

| 优先级 | 工具/优化（建议名称） | 本次证据 | 首个版本边界 |
| --- | --- | --- | --- |
| P0 | `update_cubes` | 倾斜/褶皱和布局修正需要重建 | 1–256 项按 cube_id 更新 name/from/to/origin/rotation；完整预检，一次 Undo，保留 ID |
| P0 | `replace_texture_png` | 细微 UV/材质修改仍需新工程 | 同尺寸工作目录 PNG，保留 texture_id、方块引用；拒绝外部图片和多个图集 |
| P1 | `transform_elements` | 镜像曾依靠配方重建，后架需要整体平移 | 先做明确 local/world 坐标的平移；之后单独研究镜像、绕指定枢轴旋转和子树重复选择 |
| P1 | `render_project.hidden_bone_ids`、相机预设/`render_views` | 剖视污染动画；7 个相同相机重复手动编排 | 临时隐藏只改变显示，finally 恢复；有界视图列表，每张返回独立结果与耗时，失败不自动重试 |
| P1 | `get_project_state` 摘要/筛选 | 一次普通读取输出了数千行，精确查找还需分页全部元素 | summary、字段投影、按 ID/骨骼筛选；分页返回一致性 revision |
| P1 | `validate_project` | 图集串色、内部边缘穿插仅在渲染后发现 | Box UV/材质区留边、退化面、层级引用、贴图尺寸、模型统计；穿插为提示而非错误 |
| P2 | 有界 `delete_cubes` / `delete_bones` | 不能删除废弃折痕或临时构件 | 默认只删明确 ID；骨骼含子项/动画引用必须指定处理方式，整批 Undo |
| P2 | `open_project` / 显式接管工作目录工程 | 插件重载后无法继续编辑已保存模型 | 官方 codec；递归审计贴图等外部引用；显式所有权交接，不能悄悄把所有打开的标签变成可写 |
| P2 | `get_connection_status` / capabilities | 本聊天没有直连工具时依靠独立 SDK；端口只能一个 Server 占用 | 连接状态、宿主/协议版本、工具能力、当前工程可写原因；不暴露密钥 |

原建议第六阶段先实现 **update_cubes + replace_texture_png + 对应读取/验证补强**。实际第六阶段先修复端点缺陷；这些后续工具会直接解决此次最大成本；渲染隐藏与多视图可下一阶段交付。复杂事务编排和资源包生成不应挤进同一轮。

## 拟议输入与事务

```json
{
  "project_id": "<active managed project>",
  "cubes": [
    {"cube_id": "<existing cube>", "from": [0, 0, 0], "to": [4, 8, 4], "origin": [0, 0, 0], "rotation": [0, 0, 8]}
  ]
}
```

update_cubes 的每项至少一个修改字段；拒绝重复 ID、缺失 ID、非有限数值、from>to。必须将 patch 与旧值合并后检查完整 Box UV，而不是只验证传入字段；中途失败恢复整个批次、UUID、父级、saved 状态。仍只接受托管活动 Bedrock 工程，不能用模糊名字匹配写入。若引入 revision，用户手动编辑也应改变 revision；旧 revision 返回冲突，不能默默覆盖。

replace_texture_png 拟议参数为 project_id/texture_id/path。先工作目录和 PNG 解码预检，再校验活动工程及期限，保留纹理 UUID；Undo 包含 textures、bitmap 和相关元素。**待实现前须验证官方已解码图像能否同步替换，以及 load 回调失败后的恢复方式**；不能因 fromDataURL 已返回就宣称加载完成。没有尺寸迁移、URL、脚本画笔或通用文件写入参数。

render_views 应是有界独立渲染集合，不承诺文件原子性。预检所有路径与重复目标，每项返回成功/失败/未执行状态及 actual camera、图像尺寸、sha256、耗时；写入后未知结果继续遵循不自动重试规则。

## 官方依据与验收门槛

- [Blockbench 5.2.2 Cube](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js)：复用已有的 extend、UV 和官方视图刷新机制，不引入任意属性反射写入。
- [Texture](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/texturing/textures.js)：fromDataURL/updateSource 会涉及图像加载与材质更新，需覆盖异步失败。
- [Undo 文档](https://www.blockbench.net/wiki/docs/undo/)：元素/图像变更必须进入对应 Undo aspects。

下一阶段至少验证：批量最后一项非法时零变更、UV 越界零变更、保持 ID、修改后 Undo/Redo、保存重开、解码期间工程切换、deadline、重复/不存在 ID、目录越界和纹理替换失败恢复。使用此次帐篷对 1000+ 方块做实际增量修改，并记录请求次数、耗时和响应体积，才能证明优化有效；当前未虚构此类性能对比数据。
