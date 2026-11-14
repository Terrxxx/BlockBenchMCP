# 野外指挥帐篷

按用户提供的营地参考图制作，已确认范围为**帐篷主体与完整内饰**。基岩版实体格式，约长 10 × 宽 7 × 高 5 格（每格 16 模型单位，绳扣略超出名义边界）。这是可编辑的像素风建模版本；参考图的电影光照、布料褶皱及环境没有逐像素复刻。

## 交付

- `final/ranger_field_tent.bbmodel`：官方接口保存，内置 PNG，可直接用 Blockbench 打开。本地交付文件，按仓库约定不提交 Git。
- `final/ranger_field_tent.geo.json`：官方导出的 Bedrock 几何，标识符 `geometry.ranger_field_tent`。
- `final/field_tent_atlas.png`：1024 × 2048 的 16 材质像素图集，帆布、木板、金属、绳索、床品、地图与灯笼配色。
- `final/ranger_field_tent.animation.json`：可选剖视展示动画 `animation.field_tent.cutaway`；0 秒为完整外壳，1 秒将外壳缩小到 0.001，展示内部。不是营地动作或布料模拟。
- `final/exterior.png`、`interior.png`、`cutaway.png`、`front.png`、`back.png`：MCP 原生渲染的 1200 × 900 PNG。
- `ranger_field_tent_delivery.zip`：本地交付包，包含工程、资源、五张预览及本说明，不包含连接配置、日志或密钥。

## 分组与内容

共 **702 个方块、19 个骨骼节点**，包含 root 和外壳父节点。门帘、前后墙、两侧墙、屋顶、拉绳、支架、地板、地毯和各家具区域独立分组。

入口视角中左侧是带地图屏、键盘、无线电、抽屉和文件的工作台及公告板；右侧两组双层床，共四铺，带床梯、枕头和储物箱；后方三组物资架带罐头、手册与急救箱。另有折叠凳、三盏灯笼、屋顶金属骨架、窗格、识别条带及简化翼形标志。

编辑内饰时可以在大纲中隐藏 `outer_shell`，或预览剖视动画的 1 秒。恢复完整外观时重新显示该分组或停止动画预览。灯笼为亮黄色材质，未配置游戏引擎发光或动态灯光。资源 JSON/PNG 不是完整可安装资源包，尚未添加 client_entity、render_controller、manifest 等游戏接入文件，未做游戏内验收。

## 制作与验证

`build.mjs` 是此次资产的制作配方，使用已有 MCP 的官方 SDK 客户端，依次调用新建工程、骨骼、分批方块、导入/绑定贴图、动画、官方保存、资源导出、渲染及分页查询。宿主侧只执行现有白名单工具，不使用 DevTools、任意代码接口或 Computer Use；不改变 MCP Server 实现。

图集由本地确定性像素算法生成后通过 `import_texture` 导入。所有方块参数先通过项目 schema 校验，Box UV 不跨越材质区域；每批最多 128 个方块。创建、贴图与动画沿用 MCP 的 Undo 事务。

初稿的家具左右布局与参考入口视角相反，最终版镜像 X 坐标并相应变换枢轴/旋转；重新建立 final 工程和官方导出。初稿保留在上一级目录，交付以 **final** 为准。

已在 Blockbench 5.2.2 中实际创建、保存和渲染。分页查询核对全部 702 个方块、贴图绑定、工程 UUID 和 saved=true；读取官方文件复核数量，并人工查看外观、内饰及剖视 PNG。此次没有重复执行 GUI Undo/Redo、关闭重开或游戏内测试。验证数据见 `verification.json`。

复现命令（需先停止占用同端口的 MCP，并保持插件自动重连）：

```powershell
node --import tsx models/field_tent/build.mjs
```

配方仅在当前授权工作目录运行，目标为 `models/field_tent/final`，父目录需存在。为避免覆盖交付，已有图集或配方数据时会在任何宿主修改前拒绝执行；复现应先在脚本中选用工作目录内的全新目标目录。
