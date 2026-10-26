import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArcSidebar } from "../src/arc-import.ts";
import {
  destination,
  floatingBounds,
  initialRuntime,
  initialState,
  matchDomainRule,
  mergeImport,
  normalizeDomainPattern,
  normalizeSettings,
  reconcileBookmarks,
  routeFor,
  selectAutoArchiveCandidates,
  settingsOf,
  splitTargets,
  validateBackup,
} from "../src/model.ts";
import type { BookmarkNode } from "../src/model.ts";
import { search } from "../src/search.ts";
import type { LiveTab, Snapshot } from "../src/types.ts";

function fixture() {
  return {
    sidebar: {
      containers: [
        {
          spaces: [
            "s",
            { title: "工作", newContainerIDs: [{ pinned: {} }, "root"] },
          ],
          items: [
            "root",
            {
              id: "root",
              data: { itemContainer: {} },
              childrenIds: ["f", "b", "sp"],
            },
            "f",
            { id: "f", title: "工程", data: { list: {} }, childrenIds: ["f2"] },
            "f2",
            {
              id: "f2",
              title: "客户端",
              data: { list: {} },
              childrenIds: ["f3"],
            },
            "f3",
            { id: "f3", title: "资料", data: { list: {} }, childrenIds: ["a"] },
            "a",
            {
              id: "a",
              data: {
                tab: {
                  savedTitle: "Chrome API",
                  savedURL: "https://developer.chrome.com/",
                },
              },
            },
            "b",
            {
              id: "b",
              data: {
                tab: {
                  savedTitle: "另一个入口",
                  savedURL: "https://developer.chrome.com/",
                },
              },
            },
            "sp",
            {
              id: "sp",
              data: {
                splitView: {
                  layoutOrientation: "horizontal",
                  itemWidthFactors: [0.5, 0.5],
                },
              },
              childrenIds: ["x", "y"],
            },
            "x",
            {
              id: "x",
              data: {
                tab: { savedTitle: "参考", savedURL: "https://example.com/a" },
              },
            },
            "y",
            {
              id: "y",
              data: {
                tab: { savedTitle: "笔记", savedURL: "https://example.com/b" },
              },
            },
          ],
        },
      ],
    },
    firebaseSyncState: {
      syncData: {
        items: [
          "cached",
          { id: "cached", data: { tab: { savedURL: "https://ignored.test" } } },
        ],
      },
    },
  };
}
test("Arc 解析保留三层目录、顺序、同网址独立入口及分屏关系", () => {
  const p = parseArcSidebar(JSON.stringify(fixture()));
  assert.equal(p.spaces.length, 1);
  assert.deepEqual(p.counts, { links: 4, folders: 3, splits: 1, skipped: 0 });
  assert.equal(p.items.find((i) => i.sourceId === "f3")?.parentId, "arc:f2");
  assert.equal(
    p.items.filter((i) => i.url === "https://developer.chrome.com/").length,
    2,
  );
  assert.deepEqual(p.items.find((i) => i.kind === "split")?.children, [
    "arc:x",
    "arc:y",
  ]);
  assert.equal(
    p.items.some((i) => i.sourceId === "cached"),
    false,
  );
});
test("坏网址、缺失引用与循环进入诊断，其他条目保留", () => {
  const d = fixture();
  const c = d.sidebar.containers[0];
  c.items.push("bad", {
    id: "bad",
    data: { tab: { savedTitle: "bad", savedURL: "javascript:alert(1)" } },
  } as never);
  (c.items[1] as { childrenIds: string[] }).childrenIds.push(
    "bad",
    "missing",
    "root",
  );
  const p = parseArcSidebar(JSON.stringify(d));
  assert.equal(p.counts.links, 4);
  assert.equal(p.counts.skipped, 3);
});
test("窗口临时容器独立呈现，固定与临时根语义保留", () => {
  const d = fixture();
  d.sidebar.containers.push({
    spaces: ["local", { newContainerIDs: [{ unpinned: {} }, "local-root"] }],
    items: [
      "local-root",
      { data: { itemContainer: {} }, childrenIds: ["t"] },
      "t",
      { data: { tab: { savedURL: "https://example.org/" } } },
    ],
  } as never);
  const p = parseArcSidebar(JSON.stringify(d));
  assert.equal(p.spaces.length, 2);
  assert.equal(p.items.find((i) => i.sourceId === "t")?.scope, "temporary");
});
test("错误格式与超大输入被拒绝", () => {
  assert.throws(() => parseArcSidebar("{}"), /sidebar/);
  assert.throws(() => parseArcSidebar("{"), SyntaxError);
  assert.throws(
    () => parseArcSidebar(" ".repeat(10 * 1024 * 1024 + 1)),
    /10 MB/,
  );
});
test("重复导入按条目身份合并", () => {
  const p = parseArcSidebar(JSON.stringify(fixture()));
  let s = mergeImport(initialState(), p);
  const n = s.items.length;
  s = mergeImport(s, p);
  assert.equal(s.items.length, n);
  assert.equal(s.spaces.length, 2);
  assert.equal(s.items.find((i) => i.sourceId === "a")?.spaceId, "work");
});
test("备份往返清除浏览器 ID，非法网址与目录循环被拒绝", () => {
  const s = mergeImport(
    initialState(),
    parseArcSidebar(JSON.stringify(fixture())),
  );
  s.items[0].bookmarkId = "34";
  const restored = validateBackup(JSON.stringify(s));
  assert.equal(restored.items.length, s.items.length);
  assert.equal(restored.items[0].bookmarkId, undefined);
  const link = restored.items.find((i) => i.kind === "link")!;
  link.url = "data:text/html,hello";
  assert.throws(() => validateBackup(JSON.stringify(restored)), /网址/);
  const loop = structuredClone(s);
  loop.items[0].parentId = loop.items[0].id;
  assert.throws(() => validateBackup(JSON.stringify(loop)), /循环/);
  const detached = structuredClone(s);
  detached.items.find((i) => i.sourceId === "f3")!.children = [];
  assert.throws(() => validateBackup(JSON.stringify(detached)), /关系不一致/);
});
test("搜索保留重复网址，优先当前窗口，命令模式过滤页面", () => {
  const state = mergeImport(
    initialState(),
    parseArcSidebar(JSON.stringify(fixture())),
  );
  const runtime = initialRuntime();
  runtime.windowSpaces["1"] = "work";
  const snapshot: Snapshot = {
    state,
    runtime,
    windowId: 1,
    tabs: [
      {
        id: 4,
        windowId: 1,
        groupId: -1,
        title: "Chrome API",
        url: "https://developer.chrome.com/",
        active: true,
        audible: false,
        pinned: false,
      },
    ],
  };
  const matches = search(snapshot, "Chrome");
  assert.equal(matches[0].id, "tab:4");
  assert.equal(matches.filter((r) => r.kind === "item").length, 2);
  assert.equal(
    search(snapshot, "developer.chrome.com").filter((r) => r.kind === "item")
      .length,
    2,
  );
  assert.equal(search(snapshot, ">固定")[0].id, "command:pin");
  assert.equal(
    search(snapshot, ">Chrome").some((r) => r.kind === "tab"),
    false,
  );
});
test("分屏组合按顺序取出有效子页面并截断", () => {
  const p = parseArcSidebar(JSON.stringify(fixture()));
  const split = p.items.find((i) => i.kind === "split")!;
  assert.deepEqual(
    splitTargets(p.items, split.id).map((i) => i.url),
    ["https://example.com/a", "https://example.com/b"],
  );
  const broken = structuredClone(p.items);
  const target = broken.find((i) => i.id === split.id)!;
  broken.find((i) => i.id === target.children[0])!.url = "javascript:alert(1)";
  assert.deepEqual(
    splitTargets(broken, split.id).map((i) => i.url),
    ["https://example.com/b"],
  );
  assert.deepEqual(splitTargets(broken, "missing"), []);
  const four = structuredClone(p.items);
  const wide = four.find((i) => i.id === split.id)!;
  for (const suffix of ["c", "d", "e"]) {
    const id = `extra-${suffix}`;
    four.push({
      id,
      spaceId: wide.spaceId,
      parentId: wide.id,
      kind: "link",
      scope: "pinned",
      title: suffix,
      url: `https://example.com/${suffix}`,
      children: [],
    });
    wide.children.push(id);
  }
  assert.equal(splitTargets(four, split.id).length, 4);
});
test("搜索包含分屏组合并给出分屏副标题", () => {
  const state = mergeImport(
    initialState(),
    parseArcSidebar(JSON.stringify(fixture())),
  );
  const snapshot: Snapshot = {
    state,
    runtime: initialRuntime(),
    windowId: 1,
    tabs: [],
  };
  const split = state.items.find((i) => i.kind === "split")!;
  const result = search(snapshot, "分屏").find((r) => r.id === `item:${split.id}`);
  assert.ok(result);
  assert.match(result.subtitle, /分屏组合 · 2 页/);
});
test("网址推断支持域名和本机服务，其他输入进入安全搜索", () => {
  assert.equal(destination("example.com/a").url, "https://example.com/a");
  assert.equal(destination("localhost:3000").url, "http://localhost:3000/");
  assert.equal(destination("javascript:alert(1)").search, true);
  assert.equal(destination("中文 问题").search, true);
  assert.throws(
    () => destination("https://user:secret@example.com/"),
    /身份信息/,
  );
});

function bookmarkFixture() {
  const state = initialState();
  const sid = state.spaces[0].id;
  state.bookmarkRootId = "root";
  state.spaces[0].bookmarkId = "s-work";
  state.items = [
    {
      id: "a",
      spaceId: sid,
      parentId: null,
      kind: "link",
      scope: "pinned",
      title: "A",
      url: "https://a.test/",
      children: [],
      bookmarkId: "b-a",
    },
    {
      id: "f",
      spaceId: sid,
      parentId: null,
      kind: "folder",
      scope: "pinned",
      title: "F",
      children: ["b"],
      bookmarkId: "b-f",
    },
    {
      id: "b",
      spaceId: sid,
      parentId: "f",
      kind: "link",
      scope: "pinned",
      title: "B",
      url: "https://b.test/",
      children: [],
      bookmarkId: "b-b",
    },
  ];
  return state;
}
function bookmarkRoots(children: BookmarkNode[]): BookmarkNode[] {
  return [
    {
      id: "0",
      title: "",
      children: [
        {
          id: "root",
          title: "Arc Plugin",
          children,
        },
      ],
    },
  ];
}
test("书签对账同步外部修改、删除、移动并保持条目", () => {
  const state = bookmarkFixture();
  const roots = bookmarkRoots([
    {
      id: "s-work",
      title: "工作",
      children: [
        { id: "b-a", title: "A 新标题", url: "https://a.test/new" },
        {
          id: "b-f",
          title: "F",
          children: [{ id: "b-b", title: "B", url: "https://b.test/" }],
        },
      ],
    },
  ]);
  const updated = reconcileBookmarks(state, roots, 1000);
  assert.equal(updated.changed, true);
  assert.equal(
    updated.state.items.find((i) => i.id === "a")?.title,
    "A 新标题",
  );
  assert.equal(
    updated.state.items.find((i) => i.id === "a")?.url,
    "https://a.test/new",
  );
  const removed = reconcileBookmarks(
    updated.state,
    bookmarkRoots([
      { id: "s-work", title: "工作", children: [{ id: "b-a", title: "A", url: "https://a.test/" }] },
    ]),
    2000,
  );
  assert.equal(
    removed.state.items.find((i) => i.id === "b")?.missing?.reason,
    "deleted",
  );
  const moved = reconcileBookmarks(
    state,
    [
      ...bookmarkRoots([
        { id: "s-work", title: "工作", children: [] },
      ]),
      {
        id: "outside",
        title: "其他收藏",
        children: [{ id: "b-a", title: "A", url: "https://a.test/" }],
      },
    ],
    3000,
  );
  assert.equal(
    moved.state.items.find((i) => i.id === "a")?.missing?.reason,
    "moved",
  );
  const restored = reconcileBookmarks(
    removed.state,
    bookmarkRoots([
      {
        id: "s-work",
        title: "工作",
        children: [
          { id: "b-a", title: "A", url: "https://a.test/" },
          {
            id: "b-f",
            title: "F",
            children: [{ id: "b-b", title: "B", url: "https://b.test/" }],
          },
        ],
      },
    ]),
    4000,
  );
  assert.equal(restored.state.items.find((i) => i.id === "b")?.missing, undefined);
  assert.equal(restored.restored >= 1, true);
});
test("书签对账采纳外部新增且二次对账幂等", () => {
  const state = bookmarkFixture();
  const roots = bookmarkRoots([
    {
      id: "s-work",
      title: "工作",
      children: [
        { id: "b-a", title: "A", url: "https://a.test/" },
        {
          id: "b-f",
          title: "F",
          children: [{ id: "b-b", title: "B", url: "https://b.test/" }],
        },
        { id: "b-new", title: "新增", url: "https://new.test/" },
        {
          id: "b-dir",
          title: "外部目录",
          children: [{ id: "b-child", title: "子项", url: "https://child.test/" }],
        },
      ],
    },
    { id: "b-root", title: "跨空间", url: "https://root.test/" },
  ]);
  const first = reconcileBookmarks(state, roots, 1000);
  assert.equal(first.adopted, 4);
  const adding = first.state.items.find((i) => i.bookmarkId === "b-new")!;
  assert.equal(adding.scope, "pinned");
  assert.equal(adding.spaceId, state.spaces[0].id);
  const folder = first.state.items.find((i) => i.bookmarkId === "b-dir")!;
  assert.equal(folder.kind, "folder");
  assert.equal(folder.parentId, null);
  const child = first.state.items.find((i) => i.bookmarkId === "b-child")!;
  assert.equal(child.parentId, folder.id);
  assert.deepEqual(folder.children, [child.id]);
  const rootItem = first.state.items.find((i) => i.bookmarkId === "b-root")!;
  assert.equal(rootItem.spaceId, null);
  assert.equal(rootItem.scope, "favorite");
  const second = reconcileBookmarks(first.state, roots, 2000);
  assert.equal(second.changed, false);
  assert.equal(second.adopted, 0);
});
test("备份往返清除失联标记并保留设置", () => {
  const state = bookmarkFixture();
  state.items[0].missing = { at: 1, reason: "deleted" };
  state.settings = normalizeSettings({
    autoArchive: { enabled: true, afterDays: 3, maxPerRun: 5 },
  });
  const restored = validateBackup(JSON.stringify(state));
  assert.equal(restored.items.find((i) => i.id === "a")?.missing, undefined);
  assert.equal(settingsOf(restored).autoArchive.enabled, true);
  assert.equal(settingsOf(restored).autoArchive.afterDays, 3);
  assert.equal(settingsOf(restored).autoArchive.maxPerRun, 5);
  assert.equal(settingsOf({}).autoArchive.enabled, false);
  assert.equal(settingsOf({}).newtabFocus, "omnibox");
  assert.equal(
    normalizeSettings({ autoArchive: { afterDays: -5, maxPerRun: 999 } })
      .autoArchive.afterDays,
    0,
  );
  assert.equal(
    normalizeSettings({ autoArchive: { maxPerRun: 999 } }).autoArchive
      .maxPerRun,
    100,
  );
  assert.equal(
    normalizeSettings({ autoArchive: { scope: "bogus" } }).autoArchive.scope,
    "temporary",
  );
});
test("自动归档只选择超时且未被排除的托管页面", () => {
  const now = 10_000_000_000;
  const old = now - 8 * 86400000;
  const state = initialState();
  const archSid = state.spaces[0].id;
  state.settings = normalizeSettings({
    autoArchive: { enabled: true, afterDays: 7, maxPerRun: 20 },
  });
  const runtime = initialRuntime();
  runtime.bindings = [{ spaceId: archSid, windowId: 1, groupId: 10 }];
  runtime.lastAccessed["6"] = old;
  runtime.itemTabs["1:pinned-item"] = "8";
  state.items = [
    {
      id: "pinned-item",
      spaceId: archSid,
      parentId: null,
      kind: "link",
      scope: "pinned",
      title: "固定",
      url: "https://pinned.test/",
      children: [],
    },
  ];
  const tab = (id: number, extra: Partial<LiveTab> = {}): LiveTab => ({
    id,
    windowId: 1,
    groupId: 10,
    title: `tab ${id}`,
    url: `https://t${id}.test/`,
    active: false,
    audible: false,
    pinned: false,
    lastAccessed: old,
    ...extra,
  });
  const tabs: LiveTab[] = [
    tab(1),
    tab(2, { active: true }),
    tab(3, { pinned: true }),
    tab(4, { audible: true }),
    tab(5, { splitViewId: 9 }),
    tab(6, { lastAccessed: 0 }),
    tab(7, { lastAccessed: now }),
    tab(8, { url: "https://pinned.test/", itemId: "pinned-item" }),
    tab(9, { groupId: -1 }),
  ];
  assert.deepEqual(
    selectAutoArchiveCandidates(tabs, state, runtime, now).map((c) => c.tabId),
    [1, 6],
  );
  state.settings = normalizeSettings({
    autoArchive: { enabled: false, afterDays: 7 },
  });
  assert.deepEqual(
    selectAutoArchiveCandidates(tabs, state, runtime, now),
    [],
  );
  state.settings = normalizeSettings({
    autoArchive: {
      enabled: true,
      afterDays: 7,
      scope: "spaces",
      spaceIds: ["personal"],
    },
  });
  assert.deepEqual(
    selectAutoArchiveCandidates(tabs, state, runtime, now),
    [],
  );
  state.settings = normalizeSettings({
    autoArchive: { enabled: true, afterDays: 7, maxPerRun: 1 },
  });
  assert.equal(selectAutoArchiveCandidates(tabs, state, runtime, now).length, 1);
});
test("浮窗尺寸按模式与父窗口收敛", () => {
  assert.deepEqual(floatingBounds(undefined, "little-arc"), {
    width: 720,
    height: 760,
  });
  assert.deepEqual(floatingBounds(undefined, "peek"), {
    width: 520,
    height: 640,
  });
  const tiny = floatingBounds({ left: 0, top: 0, width: 400, height: 300 }, "little-arc");
  assert.deepEqual(tiny, { width: 400, height: 300, left: 0, top: 24 });
  const normal = floatingBounds(
    { left: 100, top: 50, width: 1600, height: 900 },
    "peek",
  );
  assert.deepEqual(normal, {
    width: 520,
    height: 640,
    left: 1156,
    top: 74,
  });
});
test("域名规则规范化、最长匹配与路由", () => {
  assert.equal(normalizeDomainPattern("Example.COM"), "example.com");
  assert.equal(normalizeDomainPattern("*.Example.com"), "*.example.com");
  assert.equal(normalizeDomainPattern("https://Example.com/path"), "example.com");
  assert.equal(normalizeDomainPattern("javascript:alert(1)"), undefined);
  assert.equal(normalizeDomainPattern(""), undefined);
  const rules = normalizeSettings({
    routing: {
      rules: [
        { id: "exact", pattern: "example.com", spaceId: "work" },
        { id: "wild", pattern: "*.example.com", spaceId: "personal" },
        { id: "dup", pattern: "example.com", spaceId: "okr" },
        { id: "bad", pattern: "javascript:alert(1)" },
      ],
    },
  }).routing.rules;
  assert.equal(rules.length, 2);
  const spaces = [
    ...initialState().spaces,
    { id: "work", name: "工作", color: "blue" as const },
    { id: "personal", name: "个人", color: "green" as const },
    { id: "okr", name: "OKR", color: "orange" as const },
  ];
  assert.equal(
    matchDomainRule("https://example.com/x", rules, spaces)?.id,
    "exact",
  );
  assert.equal(
    matchDomainRule("https://a.example.com/x", rules, spaces)?.id,
    "wild",
  );
  assert.equal(matchDomainRule("https://other.test/", rules, spaces), undefined);
  assert.deepEqual(
    routeFor("https://a.example.com/x", { ...settingsOf({}), routing: { rules } }, spaces, "work"),
    { spaceId: "personal", openIn: "current" },
  );
  const unknown = [
    { id: "x", pattern: "unknown.test", spaceId: "missing", openIn: "current" as const },
  ];
  assert.equal(matchDomainRule("https://unknown.test/", unknown, spaces), undefined);
  const portRules = normalizeSettings({
    routing: {
      rules: [
        { id: "port", pattern: "127.0.0.1:8080", spaceId: "work" },
        { id: "plain", pattern: "127.0.0.1", spaceId: "personal" },
      ],
    },
  }).routing.rules;
  assert.equal(
    matchDomainRule("http://127.0.0.1:8080/x", portRules, spaces)?.id,
    "port",
  );
  assert.equal(
    matchDomainRule("http://127.0.0.1:9090/x", portRules, spaces)?.id,
    "plain",
  );
  assert.equal(
    matchDomainRule("http://127.0.0.1/x", portRules, spaces)?.id,
    "plain",
  );
});
