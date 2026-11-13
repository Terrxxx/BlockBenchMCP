# 本地桥接协议 v2

外层为官方 SDK 提供的 MCP JSON-RPC/stdio；本文件描述 stdio Server 与 Blockbench 插件之间的私有 WebSocket 消息。它不是通用代码执行通道。

v0.2.0 使用桥接协议 v2，服务端和插件必须同步重载。工作目录配置文件的 version 仍是 1；无需更换密钥或重新 setup。新旧插件/服务端混用会拒绝握手。

## 握手

Server 固定绑定 `127.0.0.1`。插件连接 `ws://127.0.0.1:<port>`，3 秒内发送：

```json
{
  "version": 2,
  "type": "hello",
  "workspace": "D:\\Desktop\\BlockBenchMCP",
  "token": "<初始化生成的64位十六进制随机密钥>",
  "plugin_version": "0.2.0",
  "blockbench_version": "5.2.2"
}
```

常量时间比较密钥、匹配工作目录与版本后，Server 回复 `{"version":2,"type":"ready"}`。握手失败关闭连接（1008）；未完成握手的连接 3 秒后终止。握手期间不接受工具请求。最多 4 个未关闭连接、1 个认证插件。无 Origin / `file://` / `null` 只为桌面运行时兼容，均仍需密钥。

WebSocket 文本帧最大 1 MiB，关闭压缩，不接受二进制帧。每 10 秒协议级 ping/pong 检测失联；插件使用 0.5、1、2、4、8、10 秒上限退避重连。插件卸载或手动断开后停止重连。

## 请求和响应

```json
{
  "version": 2,
  "type": "request",
  "request_id": "ca16f180-e67b-4b6f-bdf7-a856f826af48",
  "deadline_ms": 1794595500000,
  "command": "get_project_state",
  "params": { "offset": 0, "limit": 100 }
}
```

`request_id` 为 UUID；`deadline_ms` 是同一台机器上的 Unix 毫秒时间。示例截止时间仅展示结构，实际由服务端计算。请求以及各工具参数是严格对象，不允许额外字段。

工程、方块、骨骼 ID 使用 Blockbench 原生的 `8-4-4-4-12` 小写十六进制格式，不要求 RFC UUID 的版本位或变体位；桥接 `request_id` 仍校验 RFC UUID。依据：[Blockbench v5.2.2 的 guid / isUUID 实现](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/util/math_util.js#L2)。

```json
{
  "version": 2,
  "type": "response",
  "request_id": "ca16f180-e67b-4b6f-bdf7-a856f826af48",
  "ok": true,
  "result": {
    "project": null, "cubes": [], "offset": 0, "next_offset": null,
    "bones": [], "bone_offset": 0, "next_bone_offset": null,
    "textures": [], "texture_offset": 0, "next_texture_offset": null
  }
}
```

```json
{
  "version": 2,
  "type": "response",
  "request_id": "ca16f180-e67b-4b6f-bdf7-a856f826af48",
  "ok": false,
  "error": { "code": "PROJECT_MISMATCH", "message": "The active project changed; select the intended project and inspect its state.", "outcome_unknown": false }
}
```

MCP 工具成功同时返回 `content` 和 `structuredContent`。业务错误返回 `isError: true` 与 `structuredContent.error`。MCP 参数不符合工具 schema 时，官方 SDK 也可能直接产生协议参数错误（`-32602`）；桥接收到无效工具参数时使用 `INVALID_PARAMS`。无法提取合法 request_id 的消息无法安全关联，关闭连接。

## 工具参数

| 工具 | 输入 | 结果要点 |
| --- | --- | --- |
| create_project | `name`、`model_identifier`；可选 `texture_width` / `texture_height`，默认 64，1–4096 整数 | `project.id`、`format: bedrock`、`managed: true` 等摘要 |
| get_project_state | `offset` 默认 0，`limit` 默认 100、最大 200 | `project` 可空、`cubes`、`next_offset`；不读取模型文件 |
| create_cubes | `project_id`、`cubes`（1–256） | 方块 UUID 列表、数量、root 骨骼 UUID |
| save_project | `project_id`、相对 `path`、`overwrite` 默认 false | 相对路径、字节数、`saved: true` |

`model_identifier` 不含 `geometry.` 前缀，允许小写英文字母、数字、下划线、点、短横线；名称最长 128 字符。Cube 必须有 `name`、`from`、`to`；坐标为三个有限数，范围 ±32768，逐轴 `from <= to`（允许平面）。可选 `origin`、`rotation`、`uv_offset`、`mirror_uv`，分别默认 `[0,0,0]`、`[0,0,0]`、`[0,0]`、false；旋转各轴 ±360 度，UV offset 为 0–4096 整数。使用 Blockbench 编辑器坐标，不直接生成 Bedrock 导出坐标。

## 错误和恢复

| 错误码 | 恢复动作 |
| --- | --- |
| INVALID_PARAMS / INVALID_MESSAGE / UNSUPPORTED_VERSION | 修正参数或检查两端是否来自同一构建 |
| AUTH_FAILED | 保留用于鉴权错误；当前握手拒绝通过关闭码 1008 表示，核对配置文件与目录 |
| NOT_CONNECTED | 加载插件、启动服务端并在插件中连接目录 |
| DISCONNECTED / TIMEOUT / CANCELLED | 若 `outcome_unknown=true`，先读取工程状态、检查目标文件；不要自动重放修改 |
| BUSY | 完成当前手动编辑，或等待队列处理后重试 |
| DUPLICATE_REQUEST | 相同 ID 被用于不同内容；客户端应为新操作生成新 ID |
| NO_PROJECT / PROJECT_MISMATCH | 打开或选中预期标签，再读取状态 |
| PROJECT_NOT_OWNED | 本轮仅支持当前插件连接会话创建的工程；不会接管已有/重新打开的工程 |
| UNSUPPORTED_FORMAT / UNSUPPORTED_HOST | 使用 Bedrock Entity 与 Blockbench 桌面 5.2.2+（主版本 5） |
| PATH_FORBIDDEN / RESOURCE_OUTSIDE_WORKSPACE | 使用授权目录中的普通文件和预先存在的父目录，移除外部资源引用 |
| FILE_EXISTS | 改用新文件名，或明确设置 `overwrite: true` |
| SAVE_FAILED | 检查写权限、磁盘空间及目标；元数据已恢复，部分落盘仍可能发生 |
| NOT_FOUND / NAME_CONFLICT / HIERARCHY_CYCLE | 查询当前 ID，修正骨骼重名和最终层级循环；完整批次在 Undo 前拒绝 |
| INVALID_TEXTURE / TEXTURE_TOO_LARGE / TEXTURE_LOAD_FAILED | 使用结构完整、可解码的静态 PNG，最多 8 MiB、每边 4096 像素 |
| TEXTURE_SIZE_MISMATCH / TEXTURE_LIMIT | PNG 尺寸须匹配工程；本阶段仅支持一个共享图集 |
| UV_OUT_OF_BOUNDS | 完整 Box UV 范围必须位于工程图集内 |
| INTERNAL_ERROR | 检查 Blockbench 控制台；回滚无法确认时会标记结果不确定 |

## 超时和幂等边界

请求默认 15 秒，配置允许 1–60 秒。MCP 等待超时必须更长。服务端待处理请求与插件队列各最多 32 个。插件在排队后、执行前再次检查截止时间及连接；已经进入同步 Blockbench 操作的请求不能强行中止。取消只结束服务端等待，执行与否须重新核对。

`import_texture` 在未加入工程的官方 Texture 实例上等待图片解码，最长 5 秒且不超过请求剩余时间。解码后再次检查工程 UUID/所有权、编辑状态、贴图尺寸、图集数量与截止时间，再开始同步 Undo 事务；失败会清理尚未提交的纹理资源。PNG 数据只在插件内存中流转，WebSocket 请求只有相对路径，响应只有摘要。

命令白名单：create_project、get_project_state、create_cubes、save_project、create_bones、update_bones、reparent_cubes、import_texture、assign_texture、set_cube_uv。每类修改最多 256 项；状态每类最多返回 200 项，骨骼/贴图使用独立分页偏移。完整 schema 位于 `src/shared/protocol.ts` 与 `src/shared/schemas/`。

插件缓存最近 256 个接受的 request_id 和结果，相同 ID、相同内容共享一次执行；不同内容返回冲突。缓存不跨插件重新连接操作/重载持久化；自然网络重连保留当前 dispatcher。不保证崩溃后的 exactly-once。服务端永不自动重发修改。

日志只含事件、命令名、request_id、耗时、错误码，不记录密钥或完整模型/参数。Server 日志只写 stderr。工作目录、密钥文件及已安装的其他 Blockbench 插件必须可信；本协议不构成本机恶意进程之间的操作系统沙箱。
