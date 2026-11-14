# 第六阶段：两点杆件与端点对齐

2026-11-14。先调研、设计，再实施。用户指出帐篷细杆两端没有落到连接点；不把有意倾斜的侧墙改为垂直。

## 官方依据与根因

[Cube](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js) 的 preview controller 使用 `Format.euler_order`，几何顶点是 from/to 减去 origin，再应用节点变换。[ModelFormat](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/io/format.ts) 默认 euler_order 为 ZYX；Bedrock 不覆写它。旧配方使用 XYZ 的两点公式，向下并跨 X/Z 的杆件发生明显偏移。

修复采用 ZYX（Rz Ry Rx），局部 +Y 为杆轴，Y 角为 0：令 d=end-start，L=|d|，X=atan2(dz,hypot(dx,dy))，Z=atan2(-dx,dy)。绕中点旋转，局部 Y 长 L；这样 Rz Rx [0,1,0]=d/L。正反向、轴向、近极点、平移与镜像必须独立验证，而非比较实现输出自身。

## 白名单 API

v0.6.0 / bridge v6 / 22 工具。新增：

- `create_beams(project_id,parent_id,beams[])`：每项 name/start/end/thickness/uv_offset/mirror_uv，1–256 个，指定父骨骼。生成方块，在一笔 Undo 内完成。
- `align_beams(project_id,beams[])`：每项 cube_id/start/end，可选 thickness；省略时保留原 X/Z 截面。只修改 from/to/origin/rotation，保留 UUID、父级、名字、贴图与 UV。整批预检再一笔 Undo。

start/end 表示**杆件两端面的中心**，不是包围盒角点。坐标与 Cube.from/to 一致，是父骨骼旋转前的建模坐标；骨骼之后的变换会同时作用于两个点，不混称为动画世界坐标。首版只支持 ZYX、标准无 inflate/stretch/rescale 方块；不增加任意属性设置或执行接口。

最短长度 0.01、最长 4096，截面 0.01–256，输入与生成坐标都限制 ±32768。重复 ID、缺失 ID、零长度、非有限值和 UV 越界拒绝。每批生成结果全预检；修改后刷新原生节点，通过原生 THREE 节点矩阵核验两端，误差大于 1e-6 则回滚。不因超时或断线自动重试。

## 宿主事务与验收

复用 `Cube.extend`、`Cube.init/addTo` 和 Canvas.updateAll；按[官方 Undo](https://www.blockbench.net/wiki/docs/undo/) 注册 elements，创建还记录 outliner/groups。恢复沿用 edit()，不手写 bbmodel。

先跑数学矩阵测试（单独逐轴旋转，不复用解算式）、原配方失败回归、全批预检/回滚/UUID/贴图保留，再做 22 工具 stdio + WebSocket 测试。用户重载新版插件后，复制原帐篷参数到新托管工程，使用 align_beams 修复杆件，保存/导出、同机位前后渲染、实测端点误差；原工程不覆盖。插件重载导致旧标签不可写，不绕过会话所有权。真实 Undo/Redo 需用户操作，未经本次授权不使用 Computer Use。
