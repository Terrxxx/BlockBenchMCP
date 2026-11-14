# 第四阶段：Bedrock 资源文件导出

2026-11-13。用户选定模型 JSON、动画 JSON、PNG。先完成本设计，再分步实现；沿用 Blockbench 5.2.2 与 MCP SDK 2.4.0。

## 官方 API 调研

- [Bedrock 模型 codec](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock.js)：`Codecs.bedrock.compile({raw:true, visible_box:false})` 生成 geometry 对象，保留官方坐标转换、UV、骨骼层级与格式版本逻辑。关闭自动 visible bounds，因为 `calculateVisibleBox` 依赖当前 mesh 姿态并修改 `Project.visible_box`。本阶段不输出可见边界，可后续添加显式参数。
- [Bedrock 动画 codec](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock_animation.js)：`AnimationCodec.codecs.bedrock.compileFile(animations)` 生成指定片段集合；不用已弃用的 Animator.buildFile，也不用会读旧文件、合并和改路径的 save/exportFile。
- [关键帧](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/keyframe.js)：`getTimecodeString` 会按 snapping 吸附；调用同一官方方法预检时间槽冲突。输出提醒时间吸附与片段长度四位小数规则，拒绝吸附后超出导出长度的帧。官方处理 step 的 pre/post 以及坐标符号。
- [Animation.sampleIK](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/animations/animation.js)：编译会调用 IK 采样，可能预览和计算表达式。因此只导出第三阶段支持的数值骨骼动画；排除 IK、控制器、非骨骼轨道及未支持的插值。选中片段按 ID 一次预检、一次编译，避免部分集合被输出。
- [Texture](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/texturing/textures.js)：`getDataURL()` 读取内置图像；只接受静态 PNG 内置图集，验证实际签名/CRC/尺寸/大小，不执行会修改路径、写 mcmeta 的 Texture.save。
- [Filesystem.writeFile](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/file_system.ts)：`Blockbench.writeFile(path,{content})` 同步写文本；PNG 使用 `savetype:'image'` 且 content 必须为经过验证的 PNG data URL，绝不允许路径形式，防止官方 image 分支复制其他文件。不用 codec.write/afterSave，避免改变工程保存状态或混合旧目标内容。

## 工具与边界

新增三个专用工具，总数 19；版本 0.4.0，bridge v4。

| 工具 | 参数 | 结果 |
| --- | --- | --- |
| export_bedrock_model | project_id、path（.geo.json）、overwrite=false | 相对路径、字节数、资源类型、警告 |
| export_bedrock_animations | 上述字段，path 为 .animation.json；animation_ids 为 1–128 个不同 ID | 同上，选定动画一次编译进单个文件 |
| export_texture_png | project_id、texture_id、path（.png）、overwrite=false | 同上 |

保持会话所有权限制：只导出当前会话新建的活动 Bedrock 工程；重开工程仍只读。导出写文件，因此非 readOnly、非幂等；覆盖为整文件替换，必须显式 overwrite=true。无目录创建、通用路径扩展名、资源包 manifest、client_entity、ZIP、控制器导出。

两端使用同一输出路径策略，继承父目录存在、链接/硬链接/设备名/ADS/越界拒绝规则。编译前后都检查工程、目录边界、截止时间；写入后读取目标并逐字节核对。JSON 上限 8 MiB，PNG 沿用 8 MiB/4096 像素限制。响应不携带文件内容，保持桥接消息有界。

JSON 由官方 codec 生成对象，插件仅序列化，不自建完整 geometry/animation 格式。bbmodel 的现有官方保存链不变。导出不进入 Undo，不设置工程/贴图/动画为已保存；失败在落盘前返回确定失败，开始写入后失败标记 outcome_unknown=true，不声称磁盘回滚。三个独立文件没有跨文件事务，需分别检查每次结果。

## 模块及实施顺序

1. 共享 exports schema 与受限 exportTarget；路径及参数测试。
2. 导出控制器和窄 ExportHost 接口；官方 API 独立绑定；覆盖编译/写失败、宿主切换、时限与元数据保护测试。
3. MCP 注册、bridge 版本、全 19 工具 stdio 通信验证；旧工具回归。
4. 构建后手动重载插件（本阶段尚未授权 Computer Use），独立 SDK 或新会话直连真实宿主导出；验证 JSON 语义、PNG 像素、覆盖保护与工程状态不变。
5. 更新 README、示例、手动步骤与真实验证记录；阶段验收完成后提交一次 Git。
