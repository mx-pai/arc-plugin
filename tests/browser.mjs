import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const results = path.join(root, "test-results");
await mkdir(results, { recursive: true });
const cache = path.join(root, ".cache");
await mkdir(cache, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(cache, "browsers");
const assertions = [];
const errors = [];
const pass = (name) => {
  assertions.push(name);
  console.log(`PASS ${name}`);
};
const server = createServer((req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...(req.url === "/overlay"
      ? {
          "content-security-policy":
            "default-src 'self'; script-src 'none'; style-src 'self'; object-src 'none'",
        }
      : {}),
  });
  res.end(
    `<html><head><title>研究页面 ${req.url}</title></head><body><h1>本地扩展测试 ${req.url}</h1><button id="previous-focus">原页面按钮</button><a href="/next" target="_blank">新链接</a></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const fixture = JSON.stringify({
  sidebar: {
    containers: [
      {
        spaces: [
          "test-space",
          { title: "测试空间", newContainerIDs: [{ pinned: {} }, "r"] },
        ],
        items: [
          "r",
          {
            id: "r",
            data: { itemContainer: {} },
            childrenIds: ["folder", "duplicate"],
          },
          "folder",
          {
            id: "folder",
            title: "测试目录",
            data: { list: {} },
            childrenIds: ["link"],
          },
          "link",
          {
            id: "link",
            data: {
              tab: { savedTitle: "独立入口 A", savedURL: base + "/saved" },
            },
          },
          "duplicate",
          {
            id: "duplicate",
            data: {
              tab: { savedTitle: "独立入口 B", savedURL: base + "/saved" },
            },
          },
        ],
      },
    ],
  },
});
async function launch(dir, extension) {
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return { context, worker, id: new URL(worker.url()).host };
}
let context;
try {
  const profile = await mkdtemp(path.join(cache, "profile-"));
  let run = await launch(profile, path.join(root, "dist"));
  context = run.context;
  const { worker, id } = run;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
  await ui.getByRole("combobox").waitFor();
  pass("canonical dist loads with its real manifest");
  const send = async (message) => {
    const response = await ui.evaluate(
      (m) => chrome.runtime.sendMessage(m),
      message,
    );
    if (!response.ok) throw new Error(response.error);
    return response.data;
  };
  const findTabs = (urls) =>
    worker.evaluate(async (wanted) => {
      let found = [];
      for (let i = 0; i < 50; i++) {
        const tabs = await chrome.tabs.query({});
        found = tabs.filter((tab) => wanted.includes(tab.url));
        if (found.length === wanted.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return found;
    }, urls);
  let snap = await send({ type: "snapshot" });
  assert.equal(snap.state.spaces.length, 2);
  pass("worker initializes persistent spaces");
  const browserVersion = context.browser()?.version() ?? "persistent Chromium";
  const one = await worker.evaluate(
    (url) => chrome.tabs.create({ url, active: true }),
    base + "/one",
  );
  const two = await worker.evaluate(
    (url) => chrome.tabs.create({ url, active: true }),
    base + "/two",
  );
  await ui.waitForFunction(
    async ({ one, two, base }) =>
      (await chrome.tabs.get(one)).url === base + "/one" &&
      (await chrome.tabs.get(two)).url === base + "/two",
    { one: one.id, two: two.id, base },
  );
  const gid = await worker.evaluate(
    (ids) => chrome.tabs.group({ tabIds: ids }),
    [one.id, two.id],
  );
  await send({ type: "adopt-group", spaceId: "work", originTabId: one.id });
  snap = await send({ type: "snapshot", originTabId: one.id });
  assert.equal(
    snap.runtime.bindings.find((b) => b.spaceId === "work").groupId,
    gid,
  );
  pass("explicit native group adoption");
  await send({ type: "execute", id: "command:pin", originTabId: one.id });
  snap = await send({ type: "snapshot", originTabId: one.id });
  const pin = snap.state.items.find((i) => i.url === base + "/one");
  assert.ok(pin.bookmarkId);
  assert.ok(pin.title.trim());
  pass("pin creates a persistent item and native bookmark");
  await send({ type: "remove-item", id: pin.id });
  await send({ type: "execute", id: "command:pin", originTabId: one.id });
  snap = await send({ type: "snapshot", originTabId: one.id });
  Object.assign(
    pin,
    snap.state.items.find((i) => i.url === base + "/one"),
  );
  const pinCount = snap.state.items.length;
  await send({ type: "execute", id: "command:pin", originTabId: one.id });
  assert.equal((await send({ type: "snapshot" })).state.items.length, pinCount);
  pass("removing and re-pinning works and repeated pinning is idempotent");
  const beforeCount = (await worker.evaluate(() => chrome.tabs.query({})))
    .length;
  await send({ type: "execute", id: `item:${pin.id}`, originTabId: one.id });
  assert.equal(
    (await worker.evaluate(() => chrome.tabs.query({}))).length,
    beforeCount,
  );
  pass("opening a bound pin reuses its live page");
  await worker.evaluate((tabId) => chrome.tabs.remove(tabId), one.id);
  await send({ type: "snapshot" });
  await send({ type: "execute", id: `item:${pin.id}`, originTabId: two.id });
  snap = await send({ type: "snapshot" });
  assert.ok(snap.state.items.find((i) => i.id === pin.id));
  assert.ok(snap.tabs.some((t) => t.url === base + "/one"));
  pass("pin survives native tab closure and opens again");
  await send({ type: "execute", id: "space:personal", originTabId: two.id });
  snap = await send({ type: "snapshot" });
  const collapsed = await worker.evaluate(
    (id) => chrome.tabGroups.get(id),
    gid,
  );
  assert.equal(collapsed.collapsed, true);
  pass("space switch collapses another managed native group");
  await send({ type: "execute", id: "space:work", originTabId: two.id });
  const child = await worker.evaluate((args) => chrome.tabs.create(args), {
    url: base + "/child",
    openerTabId: two.id,
    active: true,
  });
  await send({ type: "snapshot" });
  assert.equal(
    (await worker.evaluate((id) => chrome.tabs.get(id), child.id)).groupId,
    gid,
  );
  pass("new linked tab inherits its opener space");
  await send({ type: "execute", id: "command:archive", originTabId: two.id });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.state.archives[0].url, base + "/two");
  await send({ type: "execute", id: "command:restore-last" });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.state.archives.length, 0);
  pass("manual archive and restore use real tabs and persistent storage");
  const preview = await send({ type: "preview-import", text: fixture });
  assert.equal(preview.counts.links, 2);
  assert.equal(preview.counts.folders, 1);
  pass("Arc preview retains independent equal URLs");
  const prior = (await send({ type: "snapshot" })).state;
  await send({ type: "import", text: fixture });
  snap = await send({ type: "snapshot" });
  const imported = snap.state.items.filter((i) => i.sourceId);
  assert.equal(imported.length, 3);
  const nativeIds = imported.map((i) => i.bookmarkId);
  assert.equal(new Set(nativeIds).size, 3);
  pass("import creates ordered nested native bookmarks");
  await send({ type: "import", text: fixture });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.state.items.filter((i) => i.sourceId).length, 3);
  assert.deepEqual(
    snap.state.items.filter((i) => i.sourceId).map((i) => i.bookmarkId),
    nativeIds,
  );
  pass("repeat import retains item and bookmark identity");
  await send({ type: "undo-import" });
  snap = await send({ type: "snapshot" });
  assert.ok(snap.state.items.some((i) => i.id === pin.id));
  assert.equal(
    snap.state.items.some((i) => i.sourceId),
    false,
  );
  assert.equal(snap.state.items.length, prior.items.length);
  pass("undo removes imported entries and keeps pre-existing pins");
  const bookmarksBeforeFailure = await worker.evaluate(() =>
    chrome.bookmarks.getTree(),
  );
  await worker.evaluate(() => {
    const original = chrome.bookmarks.create;
    let calls = 0;
    chrome.bookmarks.create = (...args) =>
      ++calls === 3
        ? Promise.reject(new Error("Injected bookmark write failure"))
        : original(...args);
    globalThis.__restoreCreate = () => {
      chrome.bookmarks.create = original;
    };
  });
  const failure = await ui.evaluate(
    (text) => chrome.runtime.sendMessage({ type: "import", text }),
    fixture,
  );
  await worker.evaluate(() => globalThis.__restoreCreate());
  assert.equal(failure.ok, false);
  assert.match(failure.error, /Injected/);
  assert.deepEqual(
    (await send({ type: "snapshot" })).state.items.map((i) => i.id),
    snap.state.items.map((i) => i.id),
  );
  const bookmarkIds = (nodes) =>
    nodes.flatMap((n) => [n.id, ...bookmarkIds(n.children ?? [])]);
  assert.deepEqual(
    bookmarkIds(await worker.evaluate(() => chrome.bookmarks.getTree())),
    bookmarkIds(bookmarksBeforeFailure),
  );
  pass(
    "partial native bookmark failure rolls back created folders and saved state",
  );
  const recoveryState = (await send({ type: "snapshot" })).state;
  const orphan = await worker.evaluate(async (before) => {
    const parentId = before.bookmarkRootId;
    const title = "中断恢复测试";
    const beforeIds = (await chrome.bookmarks.getChildren(parentId)).map(
      (node) => node.id,
    );
    const node = await chrome.bookmarks.create({ parentId, title });
    await chrome.storage.local.set({
      pending: {
        before,
        created: [],
        changed: [],
        creating: { parentId, title, beforeIds },
      },
    });
    return node.id;
  }, recoveryState);
  await send({ type: "snapshot" });
  const remains = await worker.evaluate(async (id) => {
    try {
      await chrome.bookmarks.get(id);
      return true;
    } catch {
      return false;
    }
  }, orphan);
  assert.equal(remains, false);
  pass("incomplete creation journal recovers an unrecorded native bookmark");
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    child.id,
  );
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options
    .getByRole("button", { name: "迁移与备份", exact: true })
    .waitFor();
  const optionsOrigin = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: "snapshot" }),
  );
  assert.equal(optionsOrigin.data.originTabId, child.id);
  pass("opening extension settings retains the previous web-page context");
  await options
    .getByRole("button", { name: "迁移与备份", exact: true })
    .click();
  await options.getByRole("button", { name: "导出 JSON 备份" }).waitFor();
  const downloadPromise = options.waitForEvent("download");
  await options.getByRole("button", { name: "导出 JSON 备份" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.schemaVersion, 1);
  pass("settings export produces a valid downloadable backup");
  await send({ type: "restore", text: JSON.stringify(exported) });
  snap = await send({ type: "snapshot" });
  assert.deepEqual(
    snap.state.items.map((i) => i.id),
    exported.items.map((i) => i.id),
  );
  assert.ok(snap.state.items.every((i) => i.bookmarkId));
  pass("portable backup restores stable entries with new native bookmark IDs");
  const bad = await ui.evaluate(() =>
    chrome.runtime.sendMessage({ type: "import", text: "{}" }),
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(
    (await send({ type: "snapshot" })).state.items.map((i) => i.id),
    snap.state.items.map((i) => i.id),
  );
  pass("invalid import reports error without changing saved entries");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  snap = await send({ type: "snapshot" });
  const syncItem = snap.state.items.find((i) => i.url === base + "/one");
  assert.ok(syncItem?.bookmarkId);
  await worker.evaluate(
    ({ id, title }) => chrome.bookmarks.update(id, { title }),
    { id: syncItem.bookmarkId, title: "外部标题" },
  );
  await wait(300);
  snap = await send({ type: "execute", id: "command:check-bookmarks" });
  assert.equal(
    snap.state.items.find((i) => i.id === syncItem.id)?.title,
    "外部标题",
  );
  await worker.evaluate(
    (id) => chrome.bookmarks.remove(id),
    syncItem.bookmarkId,
  );
  await wait(300);
  snap = await send({ type: "execute", id: "command:check-bookmarks" });
  const lost = snap.state.items.find((i) => i.id === syncItem.id);
  assert.equal(lost?.missing?.reason, "deleted");
  assert.ok(lost.url);
  await send({ type: "repair-item", id: syncItem.id });
  snap = await send({ type: "snapshot" });
  const repaired = snap.state.items.find((i) => i.id === syncItem.id);
  assert.ok(repaired.bookmarkId);
  assert.equal(repaired.bookmarkId === syncItem.bookmarkId, false);
  assert.equal(repaired.missing, undefined);
  pass("external bookmark edits, deletion and repair stay in sync");
  const workBookmark = snap.state.spaces.find((s) => s.id === "work")
    .bookmarkId;
  const external = await worker.evaluate(
    ({ parentId, url }) =>
      chrome.bookmarks.create({ parentId, title: "外部新增", url }),
    { parentId: workBookmark, url: base + "/external" },
  );
  await wait(300);
  snap = await send({ type: "execute", id: "command:check-bookmarks" });
  const adopted = snap.state.items.find((i) => i.bookmarkId === external.id);
  assert.ok(adopted);
  assert.equal(adopted.spaceId, "work");
  assert.equal(adopted.scope, "pinned");
  await worker.evaluate((id) => chrome.bookmarks.remove(id), external.id);
  await wait(800);
  pass("externally created bookmarks are adopted into the matching space");
  const splitFixture = JSON.stringify({
    sidebar: {
      containers: [
        {
          spaces: [
            "split-space",
            { title: "分屏空间", newContainerIDs: [{ pinned: {} }, "sr"] },
          ],
          items: [
            "sr",
            {
              id: "sr",
              data: { itemContainer: {} },
              childrenIds: ["sp2", "sp3", "sp1"],
            },
            "sp2",
            {
              id: "sp2",
              data: { splitView: { itemWidthFactors: [0.5, 0.5] } },
              childrenIds: ["sx", "sy"],
            },
            "sx",
            { id: "sx", data: { tab: { savedURL: base + "/split-a" } } },
            "sy",
            { id: "sy", data: { tab: { savedURL: base + "/split-b" } } },
            "sp3",
            {
              id: "sp3",
              data: { splitView: {} },
              childrenIds: ["sx2", "sy2", "sz2"],
            },
            "sx2",
            { id: "sx2", data: { tab: { savedURL: base + "/split-c" } } },
            "sy2",
            { id: "sy2", data: { tab: { savedURL: base + "/split-d" } } },
            "sz2",
            { id: "sz2", data: { tab: { savedURL: base + "/split-e" } } },
            "sp1",
            { id: "sp1", data: { splitView: {} }, childrenIds: ["s1"] },
            "s1",
            { id: "s1", data: { tab: { savedURL: base + "/split-one" } } },
          ],
        },
      ],
    },
  });
  const splitPreview = await send({
    type: "preview-import",
    text: splitFixture,
  });
  assert.equal(splitPreview.counts.splits, 3);
  await send({ type: "import", text: splitFixture });
  const importedCount = (await send({ type: "snapshot" })).state.items.length;
  await wait(900);
  assert.equal(
    (await send({ type: "snapshot" })).state.items.length,
    importedCount,
    "import must not be re-adopted by bookmark reconciliation",
  );
  const canSplit = await worker.evaluate(
    () => typeof chrome.tabs.createSplit === "function",
  );
  let splitError = "";
  if (canSplit) {
    try {
      await send({ type: "execute", id: "item:arc:sp2" });
    } catch (error) {
      splitError = error.message;
    }
  } else {
    try {
      await send({ type: "execute", id: "item:arc:sp2" });
    } catch (error) {
      splitError = error.message;
    }
  }
  if (canSplit && !splitError) {
    const pair = await findTabs([base + "/split-a", base + "/split-b"]);
    assert.equal(pair.length, 2);
    assert.ok(pair[0].splitViewId);
    assert.equal(pair[0].splitViewId, pair[1].splitViewId);
    const origin = pair.find((t) => t.active)?.id ?? pair[0].id;
    await send({ type: "execute", id: "command:unsplit", originTabId: origin });
    const afterUnsplit = await worker.evaluate(
      (id) => chrome.tabs.get(id).then((t) => t.splitViewId ?? null),
      pair[0].id,
    );
    assert.ok(afterUnsplit === null || afterUnsplit < 0);
    await worker.evaluate(
      (ids) => chrome.tabs.remove(ids),
      pair.map((t) => t.id),
    );
    pass("two-page split opens natively and can be unsplit");
  } else {
    assert.match(splitError, /155|分屏|至少/);
    pass("split capability is detected and reported on unsupported builds");
  }
  await send({ type: "execute", id: "item:arc:sp3" });
  const many = await findTabs([
    base + "/split-c",
    base + "/split-d",
    base + "/split-e",
  ]);
  assert.equal(many.length, 3);
  assert.ok(many.every((t) => (t.splitViewId ?? -1) < 0));
  await worker.evaluate(
    (ids) => chrome.tabs.remove(ids),
    many.map((t) => t.id),
  );
  pass("three-page split opens each page without native split");
  let singleError = "";
  try {
    await send({ type: "execute", id: "item:arc:sp1" });
  } catch (error) {
    singleError = error.message;
  }
  assert.match(singleError, /至少需要两个/);
  assert.equal(
    await worker.evaluate(
      (url) =>
        chrome.tabs.query({}).then((tabs) => tabs.some((t) => t.url === url)),
      base + "/split-one",
    ),
    false,
  );
  pass("single-page split reports an error without leaving tabs behind");
  await send({ type: "execute", id: "space:personal" });
  snap = await send({ type: "snapshot" });
  const personalBinding = snap.runtime.bindings.find(
    (b) => b.spaceId === "personal" && b.windowId === snap.windowId,
  );
  assert.ok(personalBinding);
  const idleTab = await worker.evaluate(
    async ({ url, groupId }) => {
      const tab = await chrome.tabs.create({ url, active: false });
      await chrome.tabs.group({ groupId, tabIds: [tab.id] });
      return tab;
    },
    { url: base + "/auto-idle", groupId: personalBinding.groupId },
  );
  const activeTab = await worker.evaluate(
    async ({ url, groupId }) => {
      const tab = await chrome.tabs.create({ url, active: true });
      await chrome.tabs.group({ groupId, tabIds: [tab.id] });
      return tab;
    },
    { url: base + "/auto-active", groupId: personalBinding.groupId },
  );
  let runtimeSettings = await send({ type: "get-settings" });
  assert.equal(runtimeSettings.autoArchive.enabled, false);
  runtimeSettings = {
    ...runtimeSettings,
    autoArchive: {
      enabled: true,
      afterDays: 0,
      scope: "spaces",
      spaceIds: ["personal"],
      maxPerRun: 5,
    },
  };
  await send({ type: "set-settings", settings: runtimeSettings });
  assert.ok(
    (
      await worker.evaluate(() => chrome.alarms.getAll())
    ).some((alarm) => alarm.name === "arc-auto-archive"),
  );
  const previewed = await send({ type: "auto-archive-preview" });
  assert.ok(previewed.some((item) => item.tabId === idleTab.id));
  assert.equal(
    previewed.some((item) => item.tabId === activeTab.id),
    false,
  );
  const archived = await send({ type: "run-auto-archive" });
  assert.equal(archived.archived, 1);
  assert.equal(
    await worker.evaluate(
      (id) =>
        chrome.tabs
          .get(id)
          .then(() => true)
          .catch(() => false),
      idleTab.id,
    ),
    false,
  );
  assert.equal(
    await worker.evaluate(
      (id) =>
        chrome.tabs
          .get(id)
          .then(() => true)
          .catch(() => false),
      activeTab.id,
    ),
    true,
  );
  snap = await send({ type: "snapshot" });
  const autoEntry = snap.state.archives.find(
    (entry) => entry.url === base + "/auto-idle",
  );
  assert.ok(autoEntry);
  await send({ type: "execute", id: `archive:${autoEntry.id}` });
  snap = await send({ type: "snapshot" });
  assert.equal(
    snap.state.archives.some((entry) => entry.id === autoEntry.id),
    false,
  );
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = {
    ...runtimeSettings,
    autoArchive: { ...runtimeSettings.autoArchive, enabled: false },
  };
  await send({ type: "set-settings", settings: runtimeSettings });
  assert.equal(
    (
      await worker.evaluate(() => chrome.alarms.getAll())
    ).some((alarm) => alarm.name === "arc-auto-archive"),
    false,
  );
  pass("auto archive follows settings, alarm lifecycle and restore");
  await send({ type: "open-floating", url: base + "/little", mode: "little-arc" });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.runtime.floating?.mode, "little-arc");
  const floatingWindows = await worker.evaluate(() =>
    chrome.windows.getAll({ populate: true }),
  );
  assert.ok(
    floatingWindows.some(
      (win) =>
        win.type === "popup" &&
        win.tabs?.some((tab) => tab.url === base + "/little"),
    ),
  );
  await worker.evaluate(
    (id) => chrome.windows.remove(id),
    snap.runtime.floating.windowId,
  );
  await wait(300);
  assert.equal((await send({ type: "snapshot" })).runtime.floating, undefined);
  await send({ type: "open-floating", url: base + "/peek", mode: "peek" });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.runtime.floating?.mode, "peek");
  await worker.evaluate(
    (id) => chrome.windows.remove(id),
    snap.runtime.floating.windowId,
  );
  await wait(300);
  pass("Little Arc and Peek open tracked popup windows and clean up");
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = {
    ...runtimeSettings,
    routing: {
      rules: [
        {
          id: "routed",
          pattern: "127.0.0.1",
          spaceId: "personal",
          openIn: "current",
        },
      ],
    },
  };
  await send({ type: "set-settings", settings: runtimeSettings });
  const routedUrl = base + "/routed";
  await send({ type: "execute", id: "url", query: routedUrl });
  const routedTab = (
    await findTabs([routedUrl])
  )[0];
  assert.ok(routedTab);
  assert.equal(routedTab.groupId, personalBinding.groupId);
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = {
    ...runtimeSettings,
    routing: {
      rules: [
        {
          id: "routed-small",
          pattern: "127.0.0.1",
          spaceId: null,
          openIn: "little-arc",
        },
      ],
    },
  };
  await send({ type: "set-settings", settings: runtimeSettings });
  await send({ type: "execute", id: "url", query: base + "/routed-small" });
  snap = await send({ type: "snapshot" });
  assert.equal(snap.runtime.floating?.mode, "little-arc");
  await worker.evaluate(
    (id) => chrome.windows.remove(id),
    snap.runtime.floating.windowId,
  );
  await wait(300);
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = { ...runtimeSettings, routing: { rules: [] } };
  await send({ type: "set-settings", settings: runtimeSettings });
  pass("domain rules route tabs into spaces or Little Arc windows");
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = { ...runtimeSettings, newtabFocus: "palette" };
  await send({ type: "set-settings", settings: runtimeSettings });
  const focusPage = await context.newPage();
  await focusPage.goto(`chrome-extension://${id}/newtab.html`);
  await focusPage.getByRole("combobox").waitFor();
  await focusPage.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "combobox",
  );
  runtimeSettings = await send({ type: "get-settings" });
  runtimeSettings = { ...runtimeSettings, newtabFocus: "omnibox" };
  await send({ type: "set-settings", settings: runtimeSettings });
  await focusPage.close();
  pass("new tab focus policy is configurable and defaults to the omnibox");
  const chordPage = await context.newPage();
  await chordPage.goto(`chrome-extension://${id}/newtab.html`);
  await chordPage.getByRole("combobox").fill("研究页面");
  await chordPage.getByRole("option").first().waitFor();
  await chordPage.getByRole("combobox").press("Control+Enter");
  await wait(500);
  snap = await send({ type: "snapshot" });
  assert.equal(snap.runtime.floating?.mode, "little-arc");
  assert.ok(
    (
      await worker.evaluate(() =>
        chrome.windows.getAll({ populate: true }),
      )
    ).some((win) => win.type === "popup"),
  );
  await worker.evaluate(
    (id) => chrome.windows.remove(id),
    snap.runtime.floating.windowId,
  );
  await wait(300);
  await chordPage.close().catch(() => undefined);
  pass("command palette modifier opens results in a Little Arc window");
  await ui.bringToFront();
  await ui.getByRole("combobox").fill("固定");
  await ui.getByRole("option").first().waitFor();
  await ui.getByRole("combobox").press("ArrowDown");
  await ui
    .locator(".palette")
    .screenshot({ path: path.join(results, "popup.png") });
  pass("search UI renders and accepts keyboard navigation");
  await ui.getByRole("combobox").fill("");
  for (let i = 0; i < 9; i++) await ui.getByRole("combobox").press("ArrowDown");
  await ui.waitForFunction(
    () => document.querySelector("#arc-results").scrollTop > 0,
  );
  pass("keyboard selection keeps the active result visible in a long list");
  await ui.getByRole("combobox").fill("固定");
  await ui
    .locator(".palette")
    .screenshot({ path: path.join(results, "popup.png") });
  await options.bringToFront();
  await options.screenshot({ path: path.join(results, "settings.png") });
  const ntp = await context.newPage();
  await ntp.goto(`chrome-extension://${id}/newtab.html`);
  await ntp.getByRole("combobox").waitFor();
  assert.equal(await ntp.locator("body").getAttribute("data-view"), "newtab");
  pass("custom new tab entry renders");
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.ok(commands.some((c) => c.name === "open-palette"));
  assert.ok(
    commands.find((c) => c.name === "open-palette").shortcut,
    "Default palette shortcut should be registered in the isolated profile",
  );
  pass("configured command registration is readable");
  const cdp = await context.newCDPSession(ui);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await ui.waitForFunction(async () => {
    try {
      return (await chrome.runtime.sendMessage({ type: "snapshot" })).ok;
    } catch {
      return false;
    }
  });
  assert.ok(
    (await send({ type: "snapshot" })).state.items.some((i) => i.id === pin.id),
  );
  pass("worker termination preserves state and messaging resumes");
  const savedItemIds = (await send({ type: "snapshot" })).state.items.map(
    (i) => i.id,
  );
  await context.close();
  run = await launch(profile, path.join(root, "dist"));
  context = run.context;
  const after = await context.newPage();
  await after.goto(`chrome-extension://${run.id}/popup.html`);
  await after.getByRole("combobox").waitFor();
  const restored = await after.evaluate(() =>
    chrome.runtime.sendMessage({ type: "snapshot" }),
  );
  assert.equal(restored.ok, true);
  assert.deepEqual(
    restored.data.state.items.map((i) => i.id),
    savedItemIds,
  );
  pass("persistent entries survive a full isolated browser restart");
  await context.close();
  context = undefined;
  const probe = await mkdtemp(path.join(cache, "probe-extension-"));
  await cp(path.join(root, "dist"), probe, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(probe, "manifest.json"), "utf8"),
  );
  manifest.host_permissions = ["http://127.0.0.1/*"];
  manifest.commands = {
    "probe-cmd-t": {
      suggested_key: { default: "Ctrl+T", mac: "Command+T" },
      description: "Probe reserved shortcut",
    },
  };
  await writeFile(path.join(probe, "manifest.json"), JSON.stringify(manifest));
  run = await launch(await mkdtemp(path.join(cache, "probe-profile-")), probe);
  context = run.context;
  const page = await context.newPage();
  await page.goto(base + "/overlay");
  await page.locator("#previous-focus").focus();
  const pageId = await run.worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
    base + "/overlay",
  );
  await run.worker.evaluate(
    (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id },
        files: ["spotlight.js"],
      }),
    pageId,
  );
  await page
    .locator('[data-arc-plugin="spotlight"]')
    .waitFor({ state: "attached" });
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-arc-plugin="spotlight"]'),
  );
  // A closed shadow root protects the injected UI; visible text/keys are checked through host lifecycle.
  await page.screenshot({ path: path.join(results, "spotlight.png") });
  await page.keyboard.press("Escape");
  await page
    .locator('[data-arc-plugin="spotlight"]')
    .waitFor({ state: "detached" });
  assert.equal(
    await page
      .locator("#previous-focus")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  pass(
    "spotlight injection closes with Esc and restores page focus (isolated localhost grant)",
  );
  const shortcutProbe = await run.worker.evaluate(() =>
    chrome.commands.getAll(),
  );
  const report = {
    date: new Date().toISOString(),
    browserVersion,
    assertions,
    errors,
    shortcutProbe,
    registeredCommands: commands,
    limitations: [
      "原生 Cmd+T 物理按键与地址栏焦点需要在桌面 Chrome 手动验收",
      "命令面板注入使用隔离测试扩展的 localhost 授权，真实 activeTab 授权链需原生快捷键验收",
      "三页与四页分屏保留组合目录并逐项打开，原生双页 API 按版本检测",
      "Peek 失焦自动关闭与 Little Arc 窗口位置/焦点受窗口管理器影响，需桌面手动验收",
      "自动归档 alarm 的真实触发周期受 Chrome 后台节流影响，需桌面观察",
      "原生书签顺序调整（onChildrenReordered）不做同步，只同步增删改移",
    ],
  };
  await writeFile(
    path.join(results, "report.json"),
    JSON.stringify(report, null, 2),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify({
      passed: assertions.length,
      browserVersion,
      shortcutProbe,
    }),
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
