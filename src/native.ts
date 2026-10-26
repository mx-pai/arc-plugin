import { parseArcSidebar } from "./arc-import.ts";
import {
  destination,
  documentOf,
  floatingBounds,
  mergeImport,
  normalizeSettings,
  reconcileBookmarks,
  routeFor,
  safeUrl,
  selectAutoArchiveCandidates,
  settingsOf,
  splitTargets,
  validateBackup,
} from "./model.ts";
import {
  loadRuntime,
  loadState,
  rollbackBookmarks,
  resolveCreation,
  saveJournal,
  saveRuntime,
  saveState,
} from "./state.ts";
import type {
  AppState,
  Binding,
  FloatingMode,
  Item,
  RuntimeState,
  Settings,
  Snapshot,
  Space,
} from "./types.ts";
import type { Journal } from "./state.ts";

const ownPage = (url?: string) =>
  !!url &&
  (url.startsWith(chrome.runtime.getURL("")) ||
    /^chrome:\/\/(newtab|new-tab-page)\//.test(url) ||
    url === "about:blank");
type ChromeGroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
const CHROME_COLORS: Record<string, ChromeGroupColor> = {
  purple: "purple", blue: "blue", green: "green", orange: "orange",
  pink: "pink", cyan: "cyan", red: "red", yellow: "yellow", grey: "grey",
  peach: "orange", mint: "cyan", lavender: "purple",
};
const chromeColor = (c: string): ChromeGroupColor =>
  CHROME_COLORS[c] ?? "grey";
let bookmarkQuietUntil = 0;
export function quietBookmarkSync(ms = 1500): void {
  bookmarkQuietUntil = Math.max(bookmarkQuietUntil, Date.now() + ms);
}
export function bookmarkSyncQuietUntil(): number {
  return bookmarkQuietUntil;
}
const getTab = async (id?: number) => {
  if (id === undefined) return;
  try {
    return await chrome.tabs.get(id);
  } catch {
    return;
  }
};
const getBookmark = async (id?: string) => {
  if (!id) return;
  try {
    return (await chrome.bookmarks.get(id))[0];
  } catch {
    return;
  }
};
export async function snapshot(originTabId?: number): Promise<Snapshot> {
  const [state, runtime, all, groups, focused] = await Promise.all([
    loadState(),
    loadRuntime(),
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }),
  ]);
  const origin = await getTab(originTabId);
  const windowId = origin?.windowId ?? focused.id ?? all[0]?.windowId ?? 0;
  const before = JSON.stringify(runtime);
  runtime.bindings = runtime.bindings.filter(
    (b) =>
      groups.some((g) => g.id === b.groupId && g.windowId === b.windowId) &&
      state.spaces.some((s) => s.id === b.spaceId),
  );
  // Browser IDs change across sessions. Restore a binding only for a unique exact candidate.
  for (const record of state.groupRecords) {
    const candidates = groups.filter(
      (g) =>
        g.title === record.title &&
        !runtime.bindings.some((b) => b.groupId === g.id) &&
        JSON.stringify(
          all
            .filter((t) => t.groupId === g.id && !ownPage(t.url))
            .map((t) => t.url ?? ""),
        ) === JSON.stringify(record.urls),
    );
    if (record.urls.length && candidates.length === 1) {
      const g = candidates[0];
      runtime.bindings.push({
        spaceId: record.spaceId,
        windowId: g.windowId,
        groupId: g.id,
      });
    }
  }
  if (
    !state.spaces.some((s) => s.id === runtime.windowSpaces[String(windowId)])
  )
    runtime.windowSpaces[String(windowId)] = state.spaces[0].id;
  const active = all.find(
    (t) =>
      t.windowId === windowId && t.active && !ownPage(t.pendingUrl || t.url),
  );
  const previous = await getTab(runtime.previousTabs[String(windowId)]);
  const actionable =
    origin && !ownPage(origin.pendingUrl || origin.url)
      ? origin
      : (active ??
        (previous && !ownPage(previous.pendingUrl || previous.url)
          ? previous
          : undefined));
  if (before !== JSON.stringify(runtime)) await saveRuntime(runtime);
  const tabs = all
    .filter((t) => t.id !== undefined && !ownPage(t.pendingUrl || t.url))
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      groupId: t.groupId,
      title: t.title ?? "",
      url: t.pendingUrl || t.url || "",
      active: t.active,
      audible: t.audible ?? false,
      pinned: t.pinned,
      lastAccessed: t.lastAccessed,
      splitViewId: t.splitViewId,
      spaceId: runtime.bindings.find(
        (b) => b.groupId === t.groupId && b.windowId === t.windowId,
      )?.spaceId,
      itemId: Object.entries(runtime.itemTabs)
        .find(
          ([key, id]) =>
            Number(id) === t.id && key.startsWith(`${t.windowId}:`),
        )?.[0]
        .slice(`${t.windowId}:`.length),
    }));
  return { state, runtime, tabs, windowId, originTabId: actionable?.id };
}
export async function recordGroups(): Promise<void> {
  const s = await snapshot();
  const records = s.runtime.bindings
    .map((b) => ({
      spaceId: b.spaceId,
      title: s.state.spaces.find((p) => p.id === b.spaceId)?.name ?? "",
      urls: s.tabs
        .filter((t) => t.groupId === b.groupId && t.windowId === b.windowId)
        .map((t) => t.url),
    }))
    .filter((r) => r.urls.length);
  if (JSON.stringify(records) !== JSON.stringify(s.state.groupRecords)) {
    s.state.groupRecords = records;
    await saveState(s.state);
  }
}
async function bind(
  space: Space,
  windowId: number,
  runtime: RuntimeState,
  tabId: number,
): Promise<Binding> {
  let binding = runtime.bindings.find(
    (b) => b.spaceId === space.id && b.windowId === windowId,
  );
  if (binding) {
    try {
      await chrome.tabGroups.get(binding.groupId);
    } catch {
      runtime.bindings = runtime.bindings.filter((b) => b !== binding);
      binding = undefined;
    }
  }
  const groupId = binding
    ? await chrome.tabs.group({ groupId: binding.groupId, tabIds: [tabId] })
    : await chrome.tabs.group({
        tabIds: [tabId],
        createProperties: { windowId },
      });
  await chrome.tabGroups.update(groupId, {
    title: space.name,
    color: chromeColor(space.color),
    collapsed: false,
  });
  if (!binding) {
    binding = { spaceId: space.id, windowId, groupId };
    runtime.bindings.push(binding);
  }
  binding.lastTabId = tabId;
  return binding;
}
export async function switchSpace(
  id: string,
  originTabId?: number,
): Promise<void> {
  const s = await snapshot(originTabId);
  const space = s.state.spaces.find((p) => p.id === id);
  if (!space) throw new Error("空间不存在");
  const b = s.runtime.bindings.find(
    (b) => b.spaceId === id && b.windowId === s.windowId,
  );
  const members = b
    ? await chrome.tabs.query({ windowId: s.windowId, groupId: b.groupId })
    : [];
  let tab = members.find((t) => t.id === b?.lastTabId) ?? members[0];
  if (!tab) {
    tab = await chrome.tabs.create({
      windowId: s.windowId,
      url: "chrome://newtab/",
      active: true,
    });
    await bind(space, s.windowId, s.runtime, tab.id!);
  } else {
    await chrome.tabGroups.update(b!.groupId, { collapsed: false });
    await chrome.tabs.update(tab.id!, { active: true });
  }
  s.runtime.windowSpaces[String(s.windowId)] = id;
  for (const other of s.runtime.bindings.filter(
    (b) => b.windowId === s.windowId && b.spaceId !== id,
  ))
    try {
      await chrome.tabGroups.update(other.groupId, { collapsed: true });
    } catch {}
  await saveRuntime(s.runtime);
  await recordGroups();
}
export async function adoptGroup(
  spaceId: string,
  originTabId?: number,
): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  const space = s.state.spaces.find((p) => p.id === spaceId);
  if (!space || !tab || tab.groupId < 0)
    throw new Error("请先切到要接入的原生标签分组");
  const existing = s.runtime.bindings.find(
    (b) => b.windowId === tab.windowId && b.spaceId === spaceId,
  );
  if (existing && existing.groupId !== tab.groupId)
    throw new Error("当前窗口的这个空间已关联其他分组");
  s.runtime.bindings = s.runtime.bindings.filter(
    (b) => b.groupId !== tab.groupId,
  );
  s.runtime.bindings.push({
    spaceId,
    windowId: tab.windowId,
    groupId: tab.groupId,
    lastTabId: tab.id,
  });
  s.runtime.windowSpaces[String(tab.windowId)] = spaceId;
  await chrome.tabGroups.update(tab.groupId, {
    title: space.name,
    color: chromeColor(space.color),
  });
  await saveRuntime(s.runtime);
  await recordGroups();
}
export async function openItem(
  id: string,
  originTabId?: number,
): Promise<void> {
  const s = await snapshot(originTabId);
  const item = s.state.items.find((i) => i.id === id);
  if (!item) throw new Error("固定入口不存在");
  if (item.kind === "split") return openSplit(item, s);
  if (item.kind !== "link") throw new Error("请在设置中展开目录或分屏组合");
  const url = safeUrl(item.url);
  if (!url) throw new Error("这个网址当前无法打开");
  const key = `${s.windowId}:${item.id}`;
  const previous = await getTab(Number(s.runtime.itemTabs[key]));
  if (previous && previous.windowId === s.windowId) {
    await chrome.tabs.update(previous.id!, { active: true });
    if (previous.groupId >= 0)
      await chrome.tabGroups.update(previous.groupId, { collapsed: false });
    return;
  }
  const tab = await chrome.tabs.create({
    windowId: s.windowId,
    url,
    active: true,
  });
  const space = s.state.spaces.find((p) => p.id === item.spaceId);
  if (space) {
    await bind(space, s.windowId, s.runtime, tab.id!);
    s.runtime.windowSpaces[String(s.windowId)] = space.id;
  }
  s.runtime.itemTabs[key] = String(tab.id);
  await saveRuntime(s.runtime);
  await recordGroups();
}
async function adjacentPair(
  windowId: number,
  firstId: number,
  secondId: number,
): Promise<[number, number]> {
  const first = await getTab(firstId);
  if (!first) throw new Error("页面已经关闭");
  await chrome.tabs.move(secondId, { index: first.index + 1 });
  const ordered = (await chrome.tabs.query({ windowId }))
    .filter((t) => t.id === firstId || t.id === secondId)
    .sort((a, b) => a.index - b.index);
  if (ordered.length !== 2) throw new Error("页面已经关闭");
  return [ordered[0].id!, ordered[1].id!];
}
async function openSplit(item: Item, s: Snapshot): Promise<void> {
  const targets = splitTargets(s.state.items, item.id);
  if (targets.length < 2) throw new Error("分屏组合至少需要两个有效网页");
  const api = chrome.tabs as typeof chrome.tabs & {
    createSplit?: (ids: [number, number]) => Promise<number>;
  };
  if (targets.length === 2 && !api.createSplit)
    throw new Error("原生分屏 API 需要 Chrome 155 或更新版本");
  const created: number[] = [];
  try {
    for (const target of targets) {
      const tab = await chrome.tabs.create({
        windowId: s.windowId,
        url: target.url!,
        active: false,
      });
      created.push(tab.id!);
    }
    const space = s.state.spaces.find((p) => p.id === item.spaceId);
    if (space) {
      for (const tabId of created)
        await bind(space, s.windowId, s.runtime, tabId);
      s.runtime.windowSpaces[String(s.windowId)] = space.id;
    }
    if (targets.length === 2 && api.createSplit) {
      const pair = await adjacentPair(s.windowId, created[0], created[1]);
      await api.createSplit(pair);
    }
    await chrome.tabs.update(created[0], { active: true });
    targets.forEach((target, index) => {
      const key = `${s.windowId}:${target.id}`;
      if (!s.runtime.itemTabs[key]) s.runtime.itemTabs[key] = String(created[index]);
    });
    await saveRuntime(s.runtime);
    await recordGroups();
  } catch (error) {
    await Promise.all(created.map((id) => chrome.tabs.remove(id).catch(() => undefined)));
    throw error;
  }
}
async function bookmarkParent(
  state: AppState,
  spaceId: string | null,
): Promise<string> {
  if (!(await getBookmark(state.bookmarkRootId))) {
    const tree = await chrome.bookmarks.getTree();
    const parent =
      tree[0].children?.find((n) => n.id === "2") ??
      tree[0].children?.find((n) => !n.url);
    if (!parent) throw new Error("未找到可写的 Chrome 书签目录");
    state.bookmarkRootId = (
      await chrome.bookmarks.create({
        parentId: parent.id,
        title: "Arc Plugin",
      })
    ).id;
  }
  if (spaceId === null) return state.bookmarkRootId!;
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) throw new Error("空间不存在");
  if (!(await getBookmark(space.bookmarkId)))
    space.bookmarkId = (
      await chrome.bookmarks.create({
        parentId: state.bookmarkRootId,
        title: space.name,
      })
    ).id;
  return space.bookmarkId!;
}
export async function pinCurrent(originTabId?: number): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  const url = safeUrl(tab?.pendingUrl) || safeUrl(tab?.url);
  if (!tab || !url) throw new Error("请先打开一个普通网页再固定");
  const spaceId =
    s.runtime.bindings.find((b) => b.groupId === tab.groupId)?.spaceId ??
    s.runtime.windowSpaces[String(tab.windowId)] ??
    s.state.spaces[0].id;
  const knownIds = Object.entries(s.runtime.itemTabs)
    .filter(
      ([key, t]) => Number(t) === tab.id && key.startsWith(`${tab.windowId}:`),
    )
    .map(([key]) => key.slice(`${tab.windowId}:`.length));
  if (
    s.state.items.some(
      (item) => knownIds.includes(item.id) && item.scope !== "temporary",
    )
  )
    return;
  const title = tab.title?.trim() || new URL(url).hostname;
  const parentId = await bookmarkParent(s.state, spaceId);
  quietBookmarkSync();
  const bookmark = await chrome.bookmarks.create({ parentId, title, url });
  const id = `saved:${crypto.randomUUID()}`;
  s.state.items.push({
    id,
    spaceId,
    parentId: null,
    kind: "link",
    scope: "pinned",
    title,
    url,
    children: [],
    bookmarkId: bookmark.id,
  });
  s.state.undo = undefined;
  await saveState(s.state);
  s.runtime.itemTabs[`${tab.windowId}:${id}`] = String(tab.id);
  await saveRuntime(s.runtime);
}
export async function archiveCurrent(originTabId?: number): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  const url = safeUrl(tab?.pendingUrl) || safeUrl(tab?.url);
  if (!tab || !url) throw new Error("这个页面无法归档");
  const boundId = Object.entries(s.runtime.itemTabs)
    .find(
      ([key, id]) =>
        Number(id) === tab.id && key.startsWith(`${tab.windowId}:`),
    )?.[0]
    .slice(`${tab.windowId}:`.length);
  const boundItem = s.state.items.find((i) => i.id === boundId);
  const isSaved = boundItem && boundItem.scope !== "temporary";
  if (tab.pinned || isSaved)
    throw new Error("固定入口保留在收藏中，可使用 Chrome 的关闭标签操作");
  if (tab.audible) throw new Error("这个页面正在播放音频，请暂停后归档");
  const entry = {
    id: crypto.randomUUID(),
    spaceId:
      s.runtime.bindings.find((b) => b.groupId === tab.groupId)?.spaceId ??
      s.runtime.windowSpaces[String(tab.windowId)] ??
      s.state.spaces[0].id,
    title: tab.title?.trim() || new URL(url).hostname,
    url,
    archivedAt: Date.now(),
  };
  s.state.archives.unshift(entry);
  s.state.undo = undefined;
  await saveState(s.state);
  try {
    await chrome.tabs.remove(tab.id!);
  } catch (error) {
    s.state.archives = s.state.archives.filter((a) => a.id !== entry.id);
    await saveState(s.state);
    throw error;
  }
}
export async function restoreArchive(id?: string): Promise<void> {
  const s = await snapshot();
  const entry = id
    ? s.state.archives.find((a) => a.id === id)
    : s.state.archives[0];
  if (!entry) throw new Error("还没有归档的页面");
  const tab = await chrome.tabs.create({
    windowId: s.windowId,
    url: entry.url,
    active: true,
  });
  const space = s.state.spaces.find((p) => p.id === entry.spaceId);
  if (space) await bind(space, s.windowId, s.runtime, tab.id!);
  s.state.archives = s.state.archives.filter((a) => a.id !== entry.id);
  s.runtime.windowSpaces[String(s.windowId)] = entry.spaceId;
  s.state.undo = undefined;
  await saveState(s.state);
  await saveRuntime(s.runtime);
}
export async function splitCurrent(originTabId?: number): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  if (!tab) throw new Error("请先打开一个网页");
  const api = chrome.tabs as typeof chrome.tabs & {
    createSplit?: (ids: [number, number]) => Promise<number>;
  };
  if (!api.createSplit)
    throw new Error("原生分屏 API 需要 Chrome 155 或更新版本");
  const previous = (await chrome.tabs.query({ windowId: tab.windowId }))
    .filter(
      (t) =>
        t.id !== tab.id &&
        t.pinned === tab.pinned &&
        t.groupId === tab.groupId &&
        !ownPage(t.url),
    )
    .sort(
      (a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index),
    )[0];
  if (!previous) throw new Error("请先在同一分组中打开另一个页面");
  const pair = await adjacentPair(tab.windowId, previous.id!, tab.id!);
  await api.createSplit(pair);
}
export async function unsplitCurrent(originTabId?: number): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  if (!tab?.splitViewId || tab.splitViewId < 0)
    throw new Error("当前页面不在原生分屏中");
  const api = chrome.tabs as typeof chrome.tabs & {
    unsplit?: (splitViewId: number) => Promise<void>;
  };
  if (!api.unsplit)
    throw new Error("原生分屏 API 需要 Chrome 155 或更新版本");
  await api.unsplit(tab.splitViewId);
}
export async function reconcileNow(): Promise<{
  changed: boolean;
  adopted: number;
  markedMissing: number;
  restored: number;
}> {
  const state = await loadState();
  if (!settingsOf(state).bookmarkSync.enabled || !state.bookmarkRootId)
    return { changed: false, adopted: 0, markedMissing: 0, restored: 0 };
  const result = reconcileBookmarks(
    state,
    await chrome.bookmarks.getTree(),
    Date.now(),
  );
  if (result.changed) await saveState(result.state);
  return {
    changed: result.changed,
    adopted: result.adopted,
    markedMissing: result.markedMissing,
    restored: result.restored,
  };
}
export async function repairItem(id: string): Promise<void> {
  const s = await snapshot();
  const item = s.state.items.find((i) => i.id === id);
  if (!item) throw new Error("条目不存在");
  if (item.kind !== "link") throw new Error("只有链接可以重新创建书签");
  const url = safeUrl(item.url);
  if (!url) throw new Error("这个网址当前无法写入书签");
  const parentId = await bookmarkParent(s.state, item.spaceId);
  quietBookmarkSync();
  const bookmark = await chrome.bookmarks.create({
    parentId,
    title: item.title,
    url,
  });
  item.bookmarkId = bookmark.id;
  delete item.missing;
  s.state.undo = undefined;
  await saveState(s.state);
}
export async function getSettings(): Promise<Settings> {
  return settingsOf(await loadState());
}
export async function setSettings(value: Settings): Promise<Settings> {
  const state = await loadState();
  state.settings = normalizeSettings(value);
  state.undo = undefined;
  await saveState(state);
  return state.settings;
}
export async function autoArchivePreview(now = Date.now()) {
  const s = await snapshot();
  return selectAutoArchiveCandidates(s.tabs, s.state, s.runtime, now).map(
    (candidate) => ({
      tabId: candidate.tabId,
      title: candidate.title,
      url: candidate.url,
      spaceId: candidate.spaceId,
      idleMs: candidate.idleMs,
    }),
  );
}
export async function autoArchive(
  now = Date.now(),
): Promise<{ archived: number; failed: number }> {
  const s = await snapshot();
  const candidates = selectAutoArchiveCandidates(
    s.tabs,
    s.state,
    s.runtime,
    now,
  );
  if (!candidates.length) return { archived: 0, failed: 0 };
  const entries = candidates.map((candidate) => ({
    id: crypto.randomUUID(),
    spaceId: candidate.spaceId,
    title: candidate.title,
    url: candidate.url,
    archivedAt: now,
  }));
  s.state.archives.unshift(...entries);
  s.state.undo = undefined;
  await saveState(s.state);
  let failed = 0;
  for (let index = 0; index < candidates.length; index++) {
    try {
      await chrome.tabs.remove(candidates[index].tabId);
    } catch {
      failed++;
      s.state.archives = s.state.archives.filter(
        (entry) => entry.id !== entries[index].id,
      );
    }
  }
  if (failed) await saveState(s.state);
  return { archived: candidates.length - failed, failed };
}
export async function closeFloating(): Promise<void> {
  const runtime = await loadRuntime();
  const floating = runtime.floating;
  if (!floating) return;
  delete runtime.floating;
  await saveRuntime(runtime);
  await chrome.windows.remove(floating.windowId).catch(() => undefined);
}
export async function openFloating(
  urlInput: string,
  mode: FloatingMode,
  originTabId?: number,
): Promise<void> {
  const url = safeUrl(urlInput);
  if (!url) throw new Error("这个网址当前无法打开");
  const s = await snapshot(originTabId);
  await closeFloating();
  const origin = await getTab(s.originTabId);
  const parent = origin
    ? await chrome.windows.get(origin.windowId).catch(() => undefined)
    : undefined;
  const bounds = floatingBounds(parent, mode);
  let win;
  try {
    win = await chrome.windows.create({
      url,
      type: "popup",
      focused: true,
      ...bounds,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!/bounds/i.test(text)) throw error;
    win = await chrome.windows.create({
      url,
      type: "popup",
      focused: true,
      width: bounds.width,
      height: bounds.height,
    });
  }
  const tab = win?.tabs?.[0];
  if (!win?.id || !tab?.id) throw new Error("无法打开小窗");
  s.runtime.floating = {
    windowId: win.id,
    tabId: tab.id,
    mode,
    openedAt: Date.now(),
  };
  await saveRuntime(s.runtime);
}
export async function openFloatingFromCurrent(
  mode: FloatingMode,
  originTabId?: number,
): Promise<void> {
  const s = await snapshot(originTabId);
  const tab = await getTab(s.originTabId);
  const url =
    safeUrl(tab?.pendingUrl) || safeUrl(tab?.url);
  if (!url) throw new Error("请先打开一个普通网页");
  await openFloating(url, mode, originTabId);
}
async function mirrorImport(
  state: AppState,
  incomingIds: Set<string>,
  journal: Journal,
): Promise<void> {
  quietBookmarkSync(3000);
  const created = async (
    details: Parameters<typeof chrome.bookmarks.create>[0],
  ) => {
    if (!details.parentId) throw new Error("书签创建缺少父目录");
    journal.creating = {
      parentId: details.parentId,
      title: details.title ?? "",
      url: details.url,
      beforeIds: (await chrome.bookmarks.getChildren(details.parentId)).map(
        (node) => node.id,
      ),
    };
    await saveJournal(journal);
    const node = await chrome.bookmarks.create(details);
    journal.created.push(node.id);
    delete journal.creating;
    await saveJournal(journal);
    return node.id;
  };
  const tree = await chrome.bookmarks.getTree();
  const rootParent =
    tree[0].children?.find((n) => n.id === "2") ??
    tree[0].children?.find((n) => !n.url);
  if (!rootParent) throw new Error("Chrome 书签目录不可写");
  if (!(await getBookmark(state.bookmarkRootId)))
    state.bookmarkRootId = await created({
      parentId: rootParent.id,
      title: "Arc Plugin",
    });
  for (const space of state.spaces.filter((s) =>
    state.items.some(
      (i) =>
        incomingIds.has(i.id) && i.spaceId === s.id && i.scope !== "temporary",
    ),
  )) {
    if (!(await getBookmark(space.bookmarkId)))
      space.bookmarkId = await created({
        parentId: state.bookmarkRootId,
        title: space.name,
      });
  }
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const visiting = new Set<string>();
  const mirror = async (item: Item): Promise<string | undefined> => {
    if (item.scope === "temporary") return;
    if (visiting.has(item.id)) throw new Error("导入目录存在循环");
    visiting.add(item.id);
    let parentId =
      item.spaceId === null
        ? state.bookmarkRootId
        : state.spaces.find((s) => s.id === item.spaceId)?.bookmarkId;
    if (item.parentId) {
      const parent = byId.get(item.parentId);
      if (parent) parentId = parent.bookmarkId ?? (await mirror(parent));
    }
    if (!parentId) throw new Error("导入目录的父节点缺失");
    const existing = await getBookmark(item.bookmarkId);
    if (existing) {
      if (
        existing.title !== item.title ||
        existing.url !== item.url ||
        existing.parentId !== parentId
      ) {
        journal.changed.push({
          id: existing.id,
          title: existing.title,
          url: existing.url,
          parentId: existing.parentId,
          index: existing.index,
        });
        await saveJournal(journal);
        await chrome.bookmarks.update(existing.id, {
          title: item.title,
          ...(item.url ? { url: item.url } : {}),
        });
        if (existing.parentId !== parentId)
          await chrome.bookmarks.move(existing.id, { parentId });
      }
    } else
      item.bookmarkId = await created({
        parentId,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
      });
    visiting.delete(item.id);
    return item.bookmarkId;
  };
  for (const item of state.items.filter((i) => incomingIds.has(i.id)))
    await mirror(item);
}
export async function importArc(
  text: string,
): Promise<{ added: number; updated: number }> {
  const preview = parseArcSidebar(text);
  const before = await loadState();
  const state = mergeImport(before, preview);
  const sameItem = (source: Item) => {
    const incoming = state.items.find((i) => i.id === source.id)!;
    const old = before.items.find((i) => i.id === incoming.id);
    return (
      old &&
      [
        "sourceId",
        "spaceId",
        "parentId",
        "kind",
        "scope",
        "title",
        "url",
        "orientation",
      ].every(
        (key) => old[key as keyof Item] === incoming[key as keyof Item],
      ) &&
      JSON.stringify(old.children) === JSON.stringify(incoming.children) &&
      JSON.stringify(old.weights) === JSON.stringify(incoming.weights)
    );
  };
  if (
    preview.items.every(sameItem) &&
    preview.spaces.every((space) =>
      before.spaces.some(
        (s) =>
          s.sourceId === space.sourceId &&
          s.name === space.name &&
          s.color === space.color,
      ),
    )
  )
    return { added: 0, updated: 0 };
  const journal: Journal = {
    before: documentOf(before),
    created: [],
    changed: [],
  };
  await saveJournal(journal);
  try {
    await mirrorImport(state, new Set(preview.items.map((i) => i.id)), journal);
    state.undo = {
      state: journal.before,
      createdBookmarkIds: journal.created,
      changedBookmarks: journal.changed,
    };
    state.imports.push({
      id: crypto.randomUUID(),
      importedAt: Date.now(),
      itemCount: preview.items.length,
      bookmarkIds: journal.created,
    });
    await saveState(state);
    await chrome.storage.local.remove("pending");
    return {
      added: preview.items.filter(
        (i) => !before.items.some((old) => old.id === i.id),
      ).length,
      updated: preview.items.filter((i) =>
        before.items.some((old) => old.id === i.id),
      ).length,
    };
  } catch (error) {
    await resolveCreation(journal);
    const failures = await rollbackBookmarks(journal.created, journal.changed);
    if (!failures.length) {
      await chrome.storage.local.set({ data: journal.before });
      await chrome.storage.local.remove("pending");
    }
    throw error;
  }
}
export async function undoImport(): Promise<void> {
  const state = await loadState();
  if (!state.undo) throw new Error("当前没有可撤销的导入");
  quietBookmarkSync(3000);
  const failures = await rollbackBookmarks(
    state.undo.createdBookmarkIds,
    state.undo.changedBookmarks,
  );
  if (failures.length)
    throw new Error("部分书签已发生变化，撤销暂未完成，请检查专属目录");
  await saveState(state.undo.state);
  await saveRuntime({
    bindings: [],
    windowSpaces: {},
    itemTabs: {},
    previousTabs: {},
    lastAccessed: {},
  });
}
export async function restoreBackup(text: string): Promise<void> {
  const doc = validateBackup(text);
  const before = await loadState();
  const state: AppState = { ...doc };
  quietBookmarkSync(3000);
  const journal: Journal = {
    before: documentOf(before),
    created: [],
    changed: [],
  };
  await saveJournal(journal);
  try {
    await mirrorImport(state, new Set(state.items.map((i) => i.id)), journal);
    state.undo = {
      state: journal.before,
      createdBookmarkIds: journal.created,
      changedBookmarks: journal.changed,
    };
    await saveState(state);
    await saveRuntime({
      bindings: [],
      windowSpaces: {},
      itemTabs: {},
      previousTabs: {},
      lastAccessed: {},
    });
    await chrome.storage.local.remove("pending");
  } catch (error) {
    await resolveCreation(journal);
    const failures = await rollbackBookmarks(journal.created, journal.changed);
    if (!failures.length) {
      await chrome.storage.local.set({ data: journal.before });
      await chrome.storage.local.remove("pending");
    }
    throw error;
  }
}
export async function execute(
  id: string,
  query = "",
  originTabId?: number,
): Promise<void> {
  if (id.startsWith("tab:")) {
    const tab = await getTab(Number(id.slice(4)));
    if (!tab) throw new Error("标签已经关闭");
    await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.groupId >= 0)
      await chrome.tabGroups.update(tab.groupId, { collapsed: false });
    await chrome.tabs.update(tab.id!, { active: true });
    return;
  }
  if (id.startsWith("item:")) return openItem(id.slice(5), originTabId);
  if (id.startsWith("space:")) return switchSpace(id.slice(6), originTabId);
  if (id.startsWith("archive:")) return restoreArchive(id.slice(8));
  if (id === "url" || id === "search") {
    if (!query.trim() || query.length > 2048)
      throw new Error("请输入网址或搜索词");
    const target = destination(query).url;
    const s = await snapshot(originTabId);
    const activeSpaceId =
      s.runtime.windowSpaces[String(s.windowId)] ?? s.state.spaces[0].id;
    const route = routeFor(
      target,
      settingsOf(s.state),
      s.state.spaces,
      activeSpaceId,
    );
    if (route.openIn === "little-arc") {
      await openFloating(target, "little-arc", originTabId);
      return;
    }
    const tab = await chrome.tabs.create({
      windowId: s.windowId,
      url: target,
      active: true,
    });
    const space = s.state.spaces.find((p) => p.id === route.spaceId);
    if (space) await bind(space, s.windowId, s.runtime, tab.id!);
    await saveRuntime(s.runtime);
    return;
  }
  if (id === "command:pin") return pinCurrent(originTabId);
  if (id === "command:archive") return archiveCurrent(originTabId);
  if (id === "command:restore-last") return restoreArchive();
  if (id === "command:split") return splitCurrent(originTabId);
  if (id === "command:unsplit") return unsplitCurrent(originTabId);
  if (id === "command:little-arc")
    return openFloatingFromCurrent("little-arc", originTabId);
  if (id === "command:peek")
    return openFloatingFromCurrent("peek", originTabId);
  if (id === "command:auto-archive-now") {
    await autoArchive();
    return;
  }
  if (id === "command:check-bookmarks") {
    await reconcileNow();
    return;
  }
  if (id === "command:settings") return chrome.runtime.openOptionsPage();
  if (id === "command:new-space") return chrome.runtime.openOptionsPage();
  throw new Error("操作不存在或当前不可用");
}
