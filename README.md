# Arc Plugin

在 Chrome 原生竖向标签栏上恢复 Arc 的工作习惯：空间切换、固定入口、统一搜索、归档、分屏组合、Little Arc / Peek、自动归档、域名分流和本地迁移

详细资料见 [调研](docs/RESEARCH.md)、[设计 Plan](docs/PLAN.md) 和 [验证记录](docs/VALIDATION.md)

## 使用

```sh
npm ci --cache .cache/npm
npm run check
```

打开 `chrome://extensions`，启用开发者模式，加载项目里的 `dist` 文件夹，Chrome 竖向标签栏沿用现有设置

工具栏图标打开搜索与空间面板，`⌘⇧K` 在普通网页唤起居中命令面板，`arc` 加空格或 Tab 在原生地址栏搜索，`⌘T` 打开定制新标签页

搜索结果中 `⌘/Ctrl+Enter` 在 Little Arc 小窗打开，`⌥+Enter` 在 Peek 中预览；设置页可选择新标签页聚焦地址栏或搜索面板

可选能力默认不改变原有行为：书签双向同步默认开启且只读外部变化，自动归档默认关闭（7 天、临时页面、每次最多 20 条），域名规则默认为空

固定入口、目录与外部新增书签双向同步，外部删除或移出目录的条目显示“书签已失联”，可重新创建书签而不丢数据

Chrome 的新标签页优先聚焦地址栏，`⌘T` 仍由 Chrome 管理，完整的 Arc 弹层与焦点行为尚需原生键盘验证，配置入口位于 `chrome://extensions/shortcuts`

`npm run dev` 打开演示预览，演示与真实扩展有明确标识，扩展数据保存在当前 Chrome 配置中

扩展只申请 tabs、tabGroups、storage、bookmarks、activeTab、scripting 和 alarms，不申请 host_permissions，页面注入仅由用户快捷键触发并走 activeTab 临时授权

## 数据

空间与收藏由本机扩展存储保存，固定链接与目录同时写入专属 Chrome 书签目录，已有书签和分组通过显式操作接入

在设置页选择 `StorableSidebar.json` 预览 Arc 结构，确认后导入，导入前生成恢复快照，重复网址保持独立条目，保存的链接在点击后打开

密码、Cookie、通行密钥和其他扩展的私有数据走各自的浏览器迁移流程，源 Arc 文件保留在原位置

## 验证

`npm test` 覆盖目录解析、重复条目、异常输入、搜索排序、书签对账、自动归档候选、浮窗尺寸与域名路由，浏览器验证使用项目内的独立配置

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npm exec playwright install chromium
npm run test:browser
```

当前自动化包含 16 项核心测试和 37 项隔离浏览器断言；原生按键、activeTab 授权链、Chrome 155 桌面分屏、浮窗焦点与 alarm 真实周期仍需手动验收，自动化范围和已知边界见验证记录

研究结论、未覆盖场景与验收结果持续记录在 [Plan](docs/PLAN.md) 中

## 继续增加能力

搜索与命令入口在 `src/search.ts`，浏览器操作在 `src/native.ts` 的 `execute` 分支，页面事件在 `src/worker.ts`，新增能力可以先增加明确的命令处理函数，再接入搜索和界面

空间、条目和归档继续使用 `src/types.ts` 的模型，持久写入通过 `src/state.ts` 协调，目录解析与搜索等纯逻辑可在 `tests/core.test.ts` 增加有实际区分度的用例，Chrome 行为在隔离浏览器中验证
