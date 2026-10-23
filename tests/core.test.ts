import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArcSidebar } from "../src/arc-import.ts";
import {
  destination,
  initialRuntime,
  initialState,
  mergeImport,
  validateBackup,
} from "../src/model.ts";
import { search } from "../src/search.ts";
import type { Snapshot } from "../src/types.ts";

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
  assert.equal(s.spaces.length, 3);
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
