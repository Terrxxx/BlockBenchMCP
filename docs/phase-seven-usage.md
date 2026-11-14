# 工程标签、薄件 UV 与穿模诊断

v0.7.0 新增 7 个工具，总计 29 个。桥接协议 v7，升级须同时重载插件、重启客户端 MCP 服务；若使用 `enabled_tools` 白名单，更新为 [示例配置](../examples/codex-config.toml)。

## 推荐建模流程

1. `list_projects` 找到目标 ID，`select_project` 明确选中，再查询状态。列表不会切换标签，也不暴露本机保存路径。选择标签不会授予编辑权：手动打开或插件重载前的工程仍只能读取诊断。
2. 先规划图集的材质区域与留边，再创建几何。创建/修改返回 `uv_warnings` 时不要直接宣称完成。
3. 使用 `get_cube_uv` 查看实际六面矩形、旋转、绑定和 `model_size` / `pixel_size`。Box UV 的像素尺寸来自取整几何，增加图集尺寸本身不会增加每面的像素密度。
4. 薄零件使用 `set_face_uv` 独立指定取样区域。修正尺寸或枢轴用 `update_cubes` / `update_bones`，无需重建整个模型。
5. `validate_project` 检查 UV 与体积，再按机械部件分组调用 `check_collisions`。检查关闭、完全打开、关键帧与中间时刻；增加采样只能提高覆盖率，不是连续扫掠证明。
6. 多视角渲染人工检查纹理材质、接缝、造型和运动效果，再通过官方接口保存与导出。工具执行成功不等于视觉验收合格。

## 标签与原位修改

```json
{"name":"list_projects","arguments":{"offset":0,"limit":100}}
```

返回项目 ID、名称、格式、saved、active、managed、locked 和 next_offset。操作目标须使用返回的原生 ID。

```json
{"name":"select_project","arguments":{"project_id":"<project-id>"}}
{"name":"update_cubes","arguments":{"project_id":"<project-id>","cubes":[{"cube_id":"<cube-id>","name":"door_leaf","from":[-14.75,1,7],"to":[-13.75,31,9],"origin":[-15,0,6],"rotation":[0,0,0]}]}}
```

示例 ID 为占位符，不是有效 UUID。`update_cubes` 只修改显式字段，按最终 from/to 和当前 UV 做整批预检。保留 ID、父级、贴图、逐面 UV；一批最多 256 个方块、一次 Undo。坐标是骨骼变换前的模型坐标，不会补偿子物体世界位置。

## 逐面 UV

`get_cube_uv` 参数为 `project_id` 与 `cube_ids`（1–256 个）。返回实际六面 `uv:[u1,v1,u2,v2]`、rotation、texture、enabled，以及物理面大小和对应的像素大小；90°/270° 旋转会交换像素宽高。

```json
{
  "name":"set_face_uv",
  "arguments":{
    "project_id":"<project-id>",
    "cubes":[{
      "cube_id":"<rivet-id>",
      "faces":{
        "north":{"uv":[8,8,12,12],"rotation":90},
        "east":{"uv":[8,8,12,12]},
        "south":{"uv":[8,8,12,12]},
        "west":{"uv":[8,8,12,12]},
        "up":{"uv":[8,8,12,12]},
        "down":{"uv":[8,8,12,12]}
      }
    }]
  }
}
```

这是矩形设置示例，不代表所有零件都应取同一个材质区域。必须提供完整六面，防止薄件切换模式后残留其他面的退化 UV。rotation 默认 0，支持 0/90/180/270。支持小数与反向矩形（镜像）；全批次不得越出图集。默认拒绝零面积矩形；纯色点/线取样必须明确 `allow_degenerate:true`，诊断仍会报告它。

`set_face_uv` 保留纹理绑定与禁用面状态，切换为逐面 UV 并关闭自动 UV。`assign_texture` 现在支持两种 UV 模式。`set_cube_uv` 则会切回 Box UV；细节零件不要在逐面修复后无意重新执行它。

## 诊断

```json
{"name":"validate_project","arguments":{"project_id":"<project-id>","max_issues":200}}
```

可选 `cube_ids` 限定范围。默认检查整个活动工程，最多 20000 个方块。返回 `checked_cubes`、`issue_count`、`issues`、`truncated`；输出详情最多 500 条，截断后总数仍是完整扫描计数。

| code | 含义与处理 |
| --- | --- |
| `DEGENERATE_UV` | UV 面积为零；检查是否刻意纯色取样，否则用逐面 UV |
| `UV_OUT_OF_BOUNDS` | 超出图集尺寸，修正取样矩形 |
| `UNBOUND_TEXTURE` | 没有有效显式绑定；同时核对宿主单图集回退行为 |
| `ZERO_VOLUME` | 至少一个方向为零或负尺寸；有意创建平面时自行确认 |

不分析 PNG 的美术内容，不知道一块区域代表钢材还是玻璃，也不替调用者决定哪个面应该用哪个区域。禁用的面不作 UV 告警。

## 静态与动画穿模

```json
{
  "name":"check_collisions",
  "arguments":{
    "project_id":"<project-id>",
    "cube_ids":["<frame-id>","<leaf-id>"],
    "animation":{"animation_id":"<animation-id>","times":[0,0.125,0.25,0.375]},
    "include_same_bone":false,
    "tolerance":0.0001,
    "max_results":200
  }
}
```

省略 animation 检查原生默认姿态，与当前预览时间无关。指定 animation 时只接受已有受支持的数值骨骼动画，时间不得超过动画长度。一次最多 256 个方块、33 个不重复时刻、200000 次方块对采样；输出最多 500 条。

返回相交方块对、time、`min_projection_overlap`、`sampled_times`、`checked_pairs` 和 `complete`。投影重叠是分离轴上的最小区间重叠，**不是**物理引擎的穿透深度或自动移动距离。接触或不超过 tolerance 的重叠不报告；零体积/奇异变换拒绝检查，不能伪装成“无穿模”。使用原生 mesh 的世界顶点，支持层级旋转、非均匀缩放产生的剪切。

默认略过具有相同**直接父骨骼**的方块；需要检查装饰、同骨骼零件时明确设为 true。普通合页/焊缝可能有意重叠，结果只作为候选问题。达到结果上限会返回 `complete:false`，不能当成完成检查。隐藏或禁用面的立方体仍按实体包围体检查，不分析透明贴图轮廓。

采样遵循宿主当前动画通道静音设置，检查前应确认相关通道未被静音。采样不选择动画、不改变模式，不新增 Undo；finally 恢复节点变换、可见性、时间、插值缓存和轨道缓存。恢复失败会报告 `outcome_unknown:true`，应停止自动操作并检查宿主。

## 验收命令

```powershell
npm run smoke:modeling -- --workspace (Get-Location).Path --wait-seconds 120
```

先停止占用同端口的 Codex MCP 服务，再运行命令；v0.7.0 插件连接后测试会新建两个标签，导出文件仅写入忽略的 `.tmp/`。测试结束停止其独立服务，需重启 Codex 中的 MCP 服务恢复日常调用。原生 Undo/Redo、文件重新打开按[手动测试](phase-seven-smoke-test.md)完成。
