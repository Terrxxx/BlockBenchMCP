# 第七阶段：建模反馈、逐面 UV 与工程标签

## 实例与问题

2026-11-14 检查用户提供的门模型：128 个方块中 77 个至少有一个零面积 UV 面；门骨骼枢轴与合页销轴的 Z 坐标相差 2，90° 姿态门扇与框相交。文件检查不能证明调用者传入了正确参数而桥接写错；但原接口缺少逐面 UV、一般方块修改、标签切换和质量诊断，是明确的能力缺口。原文件属于用户工作，不纳入测试夹具或自动改写。

## 官方 API 核验（Blockbench v5.2.2）

- [ModelProject](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/io/project.ts)：`ModelProject.all` 列出标签，`project.select()` 返回布尔值，锁定标签不能切换。只读列表不得为了取计数偷偷切换标签。
- [Cube / CubeFace](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js)：`Cube.extend` 更新几何，`setUVMode(false)` 切换逐面 UV，`faces[direction].extend` 更新 UV/rotation。Box UV 使用取整尺寸，亚单位边会坍缩。逐面 UV 可独立指定像素矩形，无须放大几何。
- [Bedrock 格式与导出](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock.js)：`optional_box_uv`、`uv_rotation` 均开启；官方 codec 支持逐面 `uv`、`uv_size`、`uv_rotation`。
- [动画求值](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/timeline_animators.js)：沿用第五阶段经过限制的数值骨骼 `displayFrame`，读取原生 mesh 世界顶点，不自行解释 Molang 或另写动画插值器。
- Undo 仍使用 `initEdit` / `finishEdit` / `cancelEdit(true)`。桥接与 MCP 注册机制不变，不增加任意代码接口。

## 工具与边界

1. `list_projects`：分页返回 ID、名称、格式、active、managed、locked、saved，不返回本机路径。
2. `select_project`：显式 ID，检查编辑事务、锁定、关闭、原生返回值；切换不授予编辑权，不保存或关闭标签。
3. `get_cube_uv`：按 ID 批量返回实际六面 UV、旋转、纹理绑定、物理面尺寸与像素尺寸，支持非托管工程只读检查。
4. `set_face_uv`：完整六面矩形，允许镜像矩形；旋转限 0/90/180/270。一次 Undo，整批预检越界及退化；默认拒绝零面积，明确 `allow_degenerate` 可用于纯色取样。保留纹理及未编辑属性。
5. `update_cubes`：按 ID 批量修改 name/from/to/origin/rotation，保留 UUID、父级和纹理；预检最终几何及 UV，一次 Undo，失败回滚。
6. `validate_project`：限定方块范围或当前工程，报告退化 UV、越界、无绑定、零体积；返回有界详情、总数与截断状态。警告不等于审美评分，也不禁止有意重叠或纯色 UV。
7. `check_collisions`：最多 256 方块、33 个明确动画时刻；静态用默认姿态。读取原生 mesh 包围盒八角并应用世界矩阵，凸平行六面体 SAT，接触不算穿透。默认只检查不同直接父骨骼，可显式包含同骨骼。给出 ID 对、采样时刻、分离轴最小投影重叠，不宣称物理碰撞或连续扫掠证明。限制配对工作量、结果量、deadline。

现有 create_cubes、set_cube_uv 返回退化 Box UV 警告；assign_texture 兼容逐面 UV 并预检。工具描述要求先规划图集，薄件使用逐面 UV，保存前诊断并渲染关闭/打开/中间姿态。暂不加入自动美化、自动移动避碰、未明确授权的工程接管或文件打开。

## 状态与安全

- v0.7.0 / bridge 7，版本严格匹配，旧插件必须重载。
- 所有编辑继续只允许本会话创建且当前选中的 Bedrock 工程；读取支持已打开非托管工程。
- 检查不改变模型、Undo、saved。动画采样在 finally 中恢复节点变换、时间、插值缓存和 track.group；恢复失败标记 outcome_unknown。
- 有界输出及工作量，重复 request_id、串行 dispatcher、错误恢复沿用原协议。

## 验证计划

先协议/标签，再逐面 UV 与几何更新，再诊断/动画采样。单测覆盖小铆钉退化、薄门 UV 修复、整批拒绝/回滚、锁定标签、非托管权限；SAT 覆盖接触、旋转、包含、非均匀缩放、门轴偏移案例。官方 SDK → stdio → WS 集成调用新增工具。真实宿主需新版插件连接，核查多标签、UV、Undo/Redo、采样状态恢复及官方保存重开；未执行项目必须明确记录。
