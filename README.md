# Arc Plugin

在 Chrome 原生竖向标签栏上恢复 Arc 的工作习惯：空间切换、固定入口、统一搜索、归档和本地迁移

详细资料见 [调研](docs/RESEARCH.md)、[设计 Plan](docs/PLAN.md) 和 [验证记录](docs/VALIDATION.md)

## 使用

```sh
npm ci --cache .cache/npm
npm run check
```

打开 `chrome://extensions`，启用开发者模式，加载项目里的 `dist` 文件夹，Chrome 竖向标签栏沿用现有设置

工具栏图标打开搜索与空间面板，`⌘⇧K` 在普通网页唤起居中命令面板，`arc` 加空格或 Tab 在原生地址栏搜索，`⌘T` 打开定制新标签页

Chrome 的新标签页优先聚焦地址栏，`⌘T` 仍由 Chrome 管理，完整的 Arc 弹层与焦点行为尚需原生键盘验证，配置入口位于 `chrome://extensions/shortcuts`

`npm run dev` 打开演示预览，演示与真实扩展有明确标识，扩展数据保存在当前 Chrome 配置中

## 数据

空间与收藏由本机扩展存储保存，固定链接与目录同时写入专属 Chrome 书签目录，已有书签和分组通过显式操作接入

在设置页选择 `StorableSidebar.json` 预览 Arc 结构，确认后导入，导入前生成恢复快照，重复网址保持独立条目，保存的链接在点击后打开

密码、Cookie、通行密钥和其他扩展的私有数据走各自的浏览器迁移流程，源 Arc 文件保留在原位置

## 验证

`npm test` 覆盖目录解析、重复条目、异常输入与搜索排序，浏览器验证使用项目内的独立配置

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npm exec playwright install chromium
npm run test:browser
```

原生按键、activeTab 授权链和 Chrome 155 的桌面分屏仍需手动验收，自动化范围和已知边界见验证记录

研究结论、未覆盖场景与验收结果持续记录在 [Plan](docs/PLAN.md) 中

## 继续增加能力

搜索与命令入口在 `src/search.ts`，浏览器操作在 `src/native.ts` 的 `execute` 分支，页面事件在 `src/worker.ts`，新增能力可以先增加明确的命令处理函数，再接入搜索和界面

空间、条目和归档继续使用 `src/types.ts` 的模型，持久写入通过 `src/state.ts` 协调，目录解析与搜索等纯逻辑可在 `tests/core.test.ts` 增加有实际区分度的用例，Chrome 行为在隔离浏览器中验证
