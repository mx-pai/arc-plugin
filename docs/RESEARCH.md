# Arc → Chrome 扩展调研

调研日期：2026-10-23，目标平台：macOS，目标浏览器：Chrome 155

## 用户目标与观察依据

用户准备迁出 Arc，喜欢它的键盘入口、空间切换、持久固定标签和目录组织，已使用 Chrome 原生竖向标签栏，明确选择增强原生侧栏的方案，未来按个人需要增加能力

本轮读取应用元数据确认 Arc 1.168.0、Chrome 155.0.8059.85，Arc 本地侧栏采用 JSON，三个命名空间为工作、OKR、个人，前序快照包含 706 条空间内标签记录、66 个文件夹、10 组分屏，文件夹最深三层，分屏包含三页和四页组合，运行过程中临时标签数量会变化

本地标准 Chromium 书签文件含 0 条网址，侧栏数据需要单独解析，`sidebar.containers`、窗口本地容器和同步缓存具有不同职责，解析依据侧栏容器的可达关系，同步缓存不参与数量合并

本机 Arc 截图采集返回 ScreenCaptureKit 捕捉错误，视觉规划使用官方功能说明与公开界面资料，项目文件不保存真实 URL、密码或同步密钥

Arc 官方公告说明桌面版将在 2026-12-22 停止使用，新版设置提供 Export Data，具体导出格式需取得样本后增加适配，当前可验证输入为本地 `StorableSidebar.json`

来源：[Arc 官方公告](https://arc.net/)

## 能力与扩展点

| 用户概念     | Chrome 入口                    | 本项目实现入口                                 | 约束                                               |
| ------------ | ------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| 原生竖向标签 | Chrome 外观设置                | 保留现状                                       | 公开扩展 API 缺少原生标签栏布局插槽                |
| Space        | tabs.group、tabGroups.update   | src/native.ts: switchSpace                     | 分组呈平面结构，关闭后空间元数据继续存在           |
| 持久固定入口 | bookmarks.create、tabs.create  | src/native.ts: pinCurrent、openItem            | 原始网址与当前页面分别保存                         |
| ⌘T           | chrome_url_overrides.newtab    | src/app.tsx 的 newtab 入口                     | 默认焦点优先给地址栏                               |
| 居中命令面板 | commands、activeTab、scripting | src/worker.ts: openPalette → src/spotlight.tsx | 用户触发后注入，系统页和商店页使用工具栏回退       |
| 地址栏搜索   | omnibox.keyword                | src/worker.ts: omnibox 监听                    | 使用 arc 关键字进入扩展搜索                        |
| 分屏         | tabs.createSplit               | src/native.ts: splitCurrent                    | 155+，两个相邻标签且窗口、固定状态、分组一致       |
| 归档         | tabs.remove、tabs.create       | src/native.ts: archiveCurrent、restoreArchive  | 持久保存网址与空间，页面内部状态由浏览器与站点决定 |
| Arc 迁移     | 本地文件选择                   | src/arc-import.ts: parseArcSidebar             | Swift 字典交错数组与树引用需要还原                 |

### ⌘T 的真实范围

官方新标签页覆盖机制可替换 `chrome://newtab`，文档明确说明新标签优先聚焦地址栏，不能依赖页面输入框自动取得焦点，`commands` 文档同时说明部分浏览器及操作系统快捷键具有更高优先级

据此，首版保留 Chrome 的 ⌘T 行为并提供 Arc 风格的新标签页，另以 ⌘⇧K 唤起不创建空标签的命令面板，地址栏提供 `arc` 关键字，直接 Cmd+T 接管属于待验证的完整性要求，不能由新标签页替换推导为完成

研究阶段不采用模拟按键、持续抢焦点或修改个人系统快捷键的实现，这些路径会改变系统行为，后续如需要原生辅助程序，应另立范围

来源：[覆盖 Chrome 页面](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)、[Commands](https://developer.chrome.com/docs/extensions/reference/api/commands)、[Omnibox](https://developer.chrome.com/docs/extensions/reference/api/omnibox)

### 原生侧栏增强的组织方式

扩展可以管理标签和分组，原生分组支持命名、颜色、折叠和移动，分组 ID 的有效范围是浏览器会话，因此 Space 使用独立稳定 ID，当前窗口到原生分组的映射使用会话存储

文件夹层级保存在专属 Chrome 书签目录中，用户通过原生书签界面、工具栏搜索和设置页访问，嵌套标签树需要自绘侧栏，当前产品方向保留原生栏

Chrome Side Panel API 可创建独立面板，它与原生竖向标签栏属于不同界面，本项目首版界面由工具栏弹窗、新标签页、按需网页命令面板和设置页组成

来源：[Tab Groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)、[Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)、[Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

### 权限与运行生命周期

当前权限为 tabs、tabGroups、storage、bookmarks、activeTab、scripting、alarms，标签 URL 与标题用于本机搜索，书签权限用于专属目录，页面注入在用户调用命令后使用临时授权，归档采用独立记录，自动归档使用 alarms 周期任务，后续如接入浏览器最近关闭会话再增加 sessions

MV3 后台可能因闲置终止，持久数据保存到 storage.local，会话映射保存到 storage.session，模块中的队列协调当前后台的写入，重启后依据保存状态与当前浏览器重建视图

首次版本不启用云端上传、远端脚本、网页全文抓取和自动归档，归档恢复涵盖网址与空间归属，网页表单、滚动位置等状态取决于 Chrome 与站点

来源：[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[后台生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[Sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions)

## 现有实现与取舍

[Arcify](https://github.com/nisargkolhe/arcify) 提供独立侧面板、Spaces 和书签集成，仓库标注 GPL-3.0，当前 README 说明嵌套目录有两层限制，参考其公开能力边界与会话 ID 问题，本项目代码从零编写，界面围绕 Chrome 原生栏组织

[Arc Tab StorableSidebar Exporter](https://github.com/Spshulem/Arc-Tab-StorableSidebar-Exporter) 的 Python 脚本输出 CSV，包含 parentID 与网址字段，适合平面清单，本项目需要显式还原目录顺序、根容器、临时区和分屏关系

## 研究后的决定

先交付可以加载的扩展与可核验的本地迁移预览，Cmd+T 原生焦点作为单独的技术证据项，功能模块共用 Space、Item、Archive 和浏览器适配逻辑，未来新增能力沿已有命令入口扩展

独立原生辅助程序、完整 Arc 窗口外观、跨账号隔离、云同步和多页嵌入式 Peek 属于后续研究范围

## 实现后的证据

本轮实现已经通过类型检查、纯逻辑测试和隔离浏览器验证，正式 manifest 可加载，工具栏、新标签页和网页命令面板均已渲染检查

对 Chromium 156.0.8078.4 的快捷键探针显示 `probe-cmd-t` 的注册 shortcut 为空，正式命令面板使用 Cmd+Shift+K，物理 Cmd+T 触发与地址栏焦点仍保留为桌面手动验收项，详细证据见 VALIDATION.md

只读解析当前本地 Arc 快照时，得到 3 个命名空间、2 个窗口临时空间、727 条可打开链接、66 个文件夹和 10 组分屏，1 条不支持的网址形成诊断，原始数据保留在 Arc，项目保存聚合结果
