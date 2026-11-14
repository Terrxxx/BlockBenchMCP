# 第六阶段验证：杆件端点修复

2026-11-14，America/Chicago。v0.6.0 / bridge v6，Blockbench 5.2.2，Node 24.14.0。先研究官方旋转顺序并记录[架构](phase-six-architecture.md)，再实现和验收。

## 自动化

`npm run check`：严格 TypeScript、174 项测试（19 个文件）与 server/plugin 构建通过。新增覆盖：正负轴、向下跨 X/Z、反向端点、近极点、500 个固定种子的随机方向/平移、原帐篷错误公式回归；零长度、过大长度、非法截面、生成坐标越界、重复/缺失 ID、最后一项 UV 非法、所有权与 BUSY；整批预检、部分写入失败回滚、原生测量失败回滚、保存状态及 UUID/父级/贴图/UV 保留。stdio 集成验证 22 工具及两点创建/原位对齐；WebSocket 与 bundle 检查一并通过。

数学验证使用独立逐轴矩阵旋转，不复用解算函数验证自身。先前配方比对只能证明存储参数一致，未能发现它在宿主旋转顺序下方向错误；现在每次原生修改后都测量实际节点矩阵，误差超过 1e-6 则回滚。

初版与细化版配方已统一使用共享 ZYX 解算，分别在临时目录生成 702 / 1218 项参数，schema 与内饰保留检查通过。初版补齐 `--prepare-only` 开关；比对数值归一化处理负零与 1e-8 以下浮点差异。首次检查发现初版缺少开关，实际额外创建了独立测试标签并保存至 `.tmp/`；未覆盖修复版或历史资产，后续参数复核不再连接宿主。

## 真实宿主

用户重载 v0.6.0 后，官方 SDK 客户端启动 stdio Server，插件自动连接。没有使用 Computer Use、DevTools 或通用代码执行。本聊天没有热加载的 Blockbench 原生工具；以下是独立官方 SDK 直接调用真实插件的验收，不冒称聊天原生调用。

1. 创建测试工程，在非零枢轴 `[7,11,-9]`、旋转 `[20,30,40]` 的父骨骼下创建 9 个方向杆件，再原位对齐新端点，原生矩阵检查通过且 UUID 保持。
2. 由于重载清除旧工程管理权，按原细化版参数新建完整托管工程；1218 方块、21 骨骼、1 张 2048² 图集和原剖视动画保留。原文件未覆盖。
3. 一次 `align_beams` 修复 79 根外壳杆件、拉绳、门架与绑带；最大原生端点误差 **1.4210854715202004e-14** 模型单位。1139 个非目标方块完全一致；目标 ID、名字、父级、UV、贴图保持；骨骼和贴图状态完全一致。
4. 官方接口保存 `.bbmodel`，导出 `.geo.json` 与 `.animation.json`；5 组同相机 PNG 对比（外观、侧面、正面、门口、内饰），人工检查外观、侧面和门口渲染，确认杆件连接锚点。
5. 用户执行一次 Ctrl+Z，SDK 分页查询全部 1218 方块，与修复前逐项完全一致；用户一次 Ctrl+Y 后与修复后完全一致，骨骼和贴图也一致。随后官方保存覆盖本次修复版。
6. 独立读取官方保存文件，以逐轴旋转重算 79 根杆件端点，最大误差 **0.000005249303572378007**，低于保存校验阈值 1e-4。差异来自官方数字序列化精度；内存 1e-6 阈值不应直接套用序列化文件。原细化版文件 SHA-256 全部未变化。

精简可提交证据：[alignment-verification.json](../models/field_tent/alignment-verification.json)。原始模型、调用会话和 PNG 在 `models/field_tent/aligned/`，不提交生成工程及原始日志。

## 复现与边界

全新工程可按[调用示例](../examples/phase-six-tool-calls.json)新建骨骼与向下杆件，检查 endpoint_error，修改端点、手动一次 Undo/Redo、查询并保存。每批失败应先查询状态，不自动重试修改。

本机已有旧细化版 recipe/result/bbmodel 的情况下，可运行 `node --import tsx models/field_tent/repair-beams.mjs` 重建修复验收；目标目录必须没有同名文件，脚本拒绝覆盖。先停止同端口 Codex MCP。脚本输出后按提示人工 Undo/Redo，分别运行 `node --import tsx models/field_tent/verify-alignment-history.mjs undo` / `redo`。最后运行 `node --import tsx models/field_tent/verify-alignment.mjs` 检查文件及生成对比页。上述旧 recipe/result/bbmodel 属于本机保留资产，不是 Git checkout 自带文件。

**未执行**：本阶段 GUI 关闭重开、Minecraft 游戏内导入；没有把文件解析检查写成真实重开通过。`create_beams` 的真实创建/对齐经过探针，真实手动 Undo/Redo 本次覆盖的是 79 项 `align_beams`。非 ZYX、非 Box UV、inflate/stretch/rescale 不在首版支持范围；不支持动画世界坐标或自动搜索任意网格顶点。
