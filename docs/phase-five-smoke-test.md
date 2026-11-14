# 第五阶段渲染冒烟测试

1. `npm run check`。重载本地 v0.5.0 插件，服务端与插件必须同为 bridge v5。若使用 Codex，更新 enabled_tools 或移除旧白名单并重启服务，确认 20 工具。
2. 独立脚本运行前停止同端口 Codex MCP；执行 `npm run smoke:render -- --workspace 'D:\Desktop\BlockBenchMCP'`。通过 Blockbench Tools → Connect 连接目录，默认等待 120 秒，可用 --wait-seconds 调整。
3. 脚本新建 root/arm 两骨骼、body/arm 两方块，导入示例内置图集，建立 0–1 秒手臂旋转并保存 bbmodel。不改变已有用户标签。
4. 顺序渲染静态透视、动画 0 秒、动画 1 秒、正交侧视、正交顶视、#102030 纯色背景、重复静态共七张 256×256 PNG。
5. 自动读取 PNG 像素：尺寸正确、可见像素大于 100；透明背景存在透明像素；0 秒与静态相同，1 秒不同；侧视与顶视不同；纯色背景角像素为 [16,32,48,255] 且无透明像素；重复静态与首次像素 hash 一致。
6. 隐式覆盖返回 FILE_EXISTS；越界路径返回 PATH_FORBIDDEN；超出动画长度返回 KEYFRAME_OUT_OF_BOUNDS 且不创建文件。显式覆盖成功。最后工程及动画查询与渲染前完全一致。
7. 脚本输出 passed:true、文件 hash、像素统计和证据路径后退出，释放服务端端口。失败时记录 `.failure.json` 并保留现场；不要盲目重试修改，应先 get_project_state/get_animation_state。
8. 人工查看静态、动画 1 秒与顶视 PNG，确认模型、贴图和姿态方向。还可在 Blockbench 确认用户相机/模式/时间线与测试前一致；只有实际检查后才在记录中写“GUI 状态验收通过”。

生成文件位于忽略的 models/mcp_render_*，不提交图片或生成工程。调用示例见[JSON](../examples/phase-five-tool-calls.json)。本阶段只渲染单张，不提供视频、GIF、帧序列、路径追踪、外部场景或贴图生成。视觉结果受宿主材质、显示和灯光设置影响。
