# 第四阶段冒烟测试

1. `npm run check`；Blockbench 插件管理重载 `dist/plugin/blockbench_ai_mcp.js`。v0.4.0 使用 bridge v4，必须同时更新 Server。
2. 选择 Codex 直连或独立脚本，不要同时运行两个同端口 Server。Codex 重启后应列出 19 个工具；若配置有 enabled_tools，更新为 README 中的列表。
3. 独立脚本：先停止 Codex MCP，再运行 `npm run smoke:exports -- --workspace 'C:\path\to\BlockBenchMCP'`；通过 Blockbench Tools → Connect 连接目录。默认等待 120 秒，可用 `--wait-seconds` 修改。脚本只对 NOT_CONNECTED 轮询，不重试写操作。
4. 脚本创建新工程、root/arm、一个有非零坐标的方块、内置 atlas 和两个动画；先保存 bbmodel 再导出 geometry、选定两动画和 PNG。
5. 检查 geometry 的 identifier、图集尺寸、父级与 pivot、方块 origin/size/UV；动画检查官方 X/Y 符号转换、hold_on_last_frame、step pre/post、scale；PNG 与输入内置图像字节完全一致。
6. 拒绝隐式覆盖、越界路径、混入不存在 ID；显式覆盖应成功。导出前后的工程 saved、骨骼/方块/贴图以及关键帧状态完全一致。
7. 添加 0.1 与 0.1001 秒两个合法但会吸附到同一槽位的帧，再导出：应返回 KEYFRAME_CONFLICT，目标不创建、源帧不改变。
8. 所有检查通过后脚本输出文件、字节数、SHA-256、证据路径并退出。产生的 models/mcp_export_* 被 Git 忽略，测试工程留在桌面便于检查。

在 Codex 中手动执行时可使用[示例](../examples/phase-four-tool-calls.json)，用实际 UUID 替换占位符。保存 `.bbmodel` 与导出资源是两个动作，导出不会把工程标记为已保存。此阶段没有游戏内资源包安装/加载验收，不能把 JSON/PNG 导出通过写成游戏内验证通过。

Computer Use 须按项目规则取得本阶段授权；没有授权时由用户负责插件重载和界面操作。测试过程不通过 DevTools 或任意代码接口操作 Blockbench。
