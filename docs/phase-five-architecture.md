# 第五阶段：指定视角与动画时刻的 PNG 渲染

2026-11-13。先调研并写本设计，再实施。基线 Blockbench 桌面 5.2.2、SDK 2.4.0。

## 官方源码依据

- [Preview](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/preview/preview.ts)：提供官方离屏 MediaPreview、resize、setProjectionMode、camera、renderer。最初尝试逐请求新建 Preview，但真实测试发现清理失败；[OrbitControls](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/preview/OrbitControls.js) 的 dispose 引用了未定义的 onContextMenu。最终复用宿主 MediaPreview，完整恢复其状态，不新建 WebGL context/控件，不调用有问题的 dispose。
- [Screencam](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/preview/screenshot.js)：screenshotPreview 调用 Canvas.withoutGizmos、Preview.render 和 PNG callback。crop:false 禁用自动裁切；指定宽高获得固定尺寸。此路径回调同步触发，未触发即视为渲染失败，不退回到截图对话框。
- [Canvas](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/preview/canvas.js)：withoutGizmos 隐藏网格和控件后恢复，但会吞掉 callback 异常，因此额外检查返回数据。高级截图会修改 shading，本阶段直接配置并恢复 MediaPreview。OrbitControls 缓存初始 up 方向，渲染期间使用 unlinked=true 与 camera.lookAt，避免顶视图被轨道控件改变。
- [Animator](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/animation_mode.js)、[BoneAnimator](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/timeline_animators.js)：showDefaultPose(true) 复位显示姿态，现有 BoneAnimator.displayFrame(1) 按 Timeline.time 使用官方数值插值。只调用现有轨道，避免 Animator.preview/stackAnimations 自动创建空轨道、执行控制器或效果；不切换模式、不 select 动画、不启动播放。

## 工具与约束

新增 `render_project`，版本 0.5.0 / bridge v5，总数 20。

- 输入：project_id、path（.png）、overwrite=false；width/height 默认 512，64–2048；camera 必填，含 position/target/up，projection 为 perspective（fov 默认 45，10–120）或 orthographic（vertical_size 必填，0.1–4096 模型单位）。坐标为 Blockbench 预览世界坐标，Y 为竖直方向。位置不得与目标重合，up 不得平行于视线。
- background 默认 transparent，或 #RRGGBB；不加载背景图片/URL。渲染时隐藏预览场景和非模型对象，保留宿主光照、材质与显示设置；不是游戏引擎或离线路径追踪器。
- 可选 animation:{animation_id,time}。time 为 0–1000 秒且不得超过片段长度；省略表示静态初始姿态。只接受纯数值、linear/step 的骨骼动画；拒绝控制器、IK、非 Cube 元素、全局旋转轨道。继承宿主材质和轨道 mute 状态。
- 仅允许当前会话托管的活动 Bedrock 工程；工作目录外资源及非内置图像拒绝。只写工作目录 PNG，继承目录、覆盖、链接检查。PNG 最大 8 MiB，尺寸和 CRC 均验证，写后逐字节核对。
- 返回 path/bytes/width/height、animation_id/time（静态为 null）、warnings；不传大图到桥接消息。不添加 Undo，不标记工程已保存。

## 状态与失败恢复

渲染在一个同步宿主调用中完成，不跨异步帧保留临时姿态。临时快照覆盖场景节点的 position/rotation/scale/visibility、场景 background、Timeline.time、动画插值缓存与 Molang context.animation。媒体视口同时保存两个相机、projection、width/height、控件 target/object/unlinked、renderer 像素比例/尺寸/clearColor/clearAlpha；finally 逐项恢复并更新矩阵。用户模式、所选动画、用户相机、播放标记、关键帧/骨骼数据和 Undo 不修改。

渲染前、完成且恢复后、写入前再次检查工程、截止时间与路径。同步 GPU 调用不能强行中断，但尺寸/场景数量有界；超时后的结果不写磁盘。渲染失败在写入前为确定失败；恢复失败需标记 outcome_unknown=true。写入后的错误继承第四阶段“磁盘可能部分改变”的语义，不自动重试。

## 分步验证

1. Schema、相机合法性和共享 PNG 写入校验。
2. 渲染控制器及官方 API 绑定，注入失败验证 finally、相机/时间/姿态恢复、超时无文件。
3. 全 20 工具 stdio/WebSocket 集成和旧功能回归。
4. 用户重载后真实静态图、不同相机、不同动画时刻、透明/纯色背景；检查 PNG 尺寸、非空像素、图像差异及数据状态一致。当前阶段未授权 Computer Use，重载由用户操作。
5. README、调用示例、验收记录齐全且真实验收完成后提交一次 Git。
