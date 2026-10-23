import { parseArcSidebar } from "./arc-import.ts";
import { safeUrl } from "./model.ts";
import { search } from "./search.ts";
import {
  adoptGroup,
  execute,
  importArc,
  recordGroups,
  restoreBackup,
  snapshot,
  switchSpace,
  undoImport,
} from "./native.ts";
import {
  enqueue,
  loadRuntime,
  loadState,
  recoverJournal,
  saveRuntime,
  saveState,
} from "./state.ts";
import type { Request, Response } from "./types.ts";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const closingWindows = new Set<number>();
async function openPalette(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (tab?.id && /^https?:/.test(tab.url ?? "")) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["spotlight.js"],
      });
      return;
    } catch {}
  }
  await chrome.action.openPopup();
}
async function handle(
  request: Request,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  await recoverJournal();
  const origin =
    "originTabId" in request
      ? (request.originTabId ?? sender.tab?.id)
      : sender.tab?.id;
  switch (request.type) {
    case "snapshot":
      return snapshot(origin);
    case "execute":
      if (typeof request.id !== "string" || request.id.length > 2000)
        throw new Error("操作参数无效");
      await execute(request.id, request.query ?? "", origin);
      return snapshot(origin);
    case "preview-import":
      if (typeof request.text !== "string") throw new Error("文件内容无效");
      return parseArcSidebar(request.text);
    case "import":
      if (typeof request.text !== "string") throw new Error("文件内容无效");
      return importArc(request.text);
    case "restore":
      if (typeof request.text !== "string") throw new Error("文件内容无效");
      return restoreBackup(request.text);
    case "undo-import":
      return undoImport();
    case "adopt-group":
      return adoptGroup(request.spaceId, origin);
    case "rename-space": {
      if (
        typeof request.name !== "string" ||
        !request.name.trim() ||
        request.name.length > 100
      )
        throw new Error("空间名称应为 1–100 个字符");
      const s = await snapshot();
      const space = s.state.spaces.find((p) => p.id === request.id);
      if (!space) throw new Error("空间不存在");
      space.name = request.name.trim();
      for (const b of s.runtime.bindings.filter((b) => b.spaceId === space.id))
        await chrome.tabGroups.update(b.groupId, { title: space.name });
      if (space.bookmarkId)
        await chrome.bookmarks.update(space.bookmarkId, { title: space.name });
      s.state.undo = undefined;
      await saveState(s.state);
      return;
    }
    case "remove-item": {
      const state = await loadState();
      const item = state.items.find((i) => i.id === request.id);
      if (!item) throw new Error("条目不存在");
      if (item.kind !== "link") throw new Error("请通过原生书签界面编辑目录");
      if (item.bookmarkId) {
        try {
          await chrome.bookmarks.get(item.bookmarkId);
          await chrome.bookmarks.remove(item.bookmarkId);
        } catch (error) {
          if (!message(error).includes("Can't find")) throw error;
        }
      }
      state.items = state.items
        .filter((i) => i.id !== item.id)
        .map((i) => ({
          ...i,
          children: i.children.filter((id) => id !== item.id),
        }));
      state.undo = undefined;
      await saveState(state);
      const runtime = await loadRuntime();
      for (const key of Object.keys(runtime.itemTabs))
        if (key.slice(key.indexOf(":") + 1) === item.id)
          delete runtime.itemTabs[key];
      await saveRuntime(runtime);
      return;
    }
    case "open-palette":
      return openPalette();
    default:
      throw new Error("不支持的请求");
  }
}
chrome.runtime.onMessage.addListener((request: unknown, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !request ||
    typeof request !== "object" ||
    !("type" in request)
  )
    return false;
  enqueue(() => handle(request as Request, sender)).then(
    (data) => reply({ ok: true, data } satisfies Response),
    (error) => reply({ ok: false, error: message(error) } satisfies Response),
  );
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  void enqueue(async () => {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    await recoverJournal();
    const state = await loadState();
    await saveState(state);
  });
});
chrome.runtime.onStartup.addListener(() => {
  void enqueue(async () => {
    await recoverJournal();
    await snapshot();
  });
});
chrome.commands.onCommand.addListener((command) => {
  void enqueue(async () => {
    if (command === "open-palette") return openPalette();
    if (command === "pin-current") return execute("command:pin");
    if (command === "next-space" || command === "previous-space") {
      const s = await snapshot();
      const current = s.state.spaces.findIndex(
        (p) => p.id === s.runtime.windowSpaces[String(s.windowId)],
      );
      const next =
        (current +
          (command === "next-space" ? 1 : -1) +
          s.state.spaces.length) %
        s.state.spaces.length;
      await switchSpace(s.state.spaces[next].id);
    }
  }).catch((error) => console.warn("Arc Plugin", message(error)));
});
chrome.omnibox.setDefaultSuggestion({
  description: "搜索标签、收藏和空间：%s",
});
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void enqueue(async () => {
    const results = search(await snapshot(), text, 8);
    suggest(
      results
        .filter((r) => r.kind !== "search" && r.kind !== "url")
        .map((r) => ({
          content: `arc-plugin:${encodeURIComponent(r.id)}`,
          description: `${r.title} — ${r.subtitle}`
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;"),
        })),
    );
  }).catch(() => suggest([]));
});
chrome.omnibox.onInputEntered.addListener((text) => {
  void enqueue(async () => {
    if (text.startsWith("arc-plugin:"))
      await execute(decodeURIComponent(text.slice(11)));
    else await execute("search", text);
  }).catch((error) => console.warn("Arc Plugin", message(error)));
});
chrome.tabs.onCreated.addListener((tab) => {
  void enqueue(async () => {
    if (!tab.id || tab.pinned || tab.groupId >= 0) return;
    const s = await snapshot();
    const opener = tab.openerTabId
      ? await chrome.tabs.get(tab.openerTabId).catch(() => undefined)
      : undefined;
    const spaceId =
      (opener
        ? s.runtime.bindings.find((b) => b.groupId === opener.groupId)?.spaceId
        : undefined) ?? s.runtime.windowSpaces[String(tab.windowId)];
    const binding = s.runtime.bindings.find(
      (b) => b.windowId === tab.windowId && b.spaceId === spaceId,
    );
    if (binding) {
      await chrome.tabs.group({ groupId: binding.groupId, tabIds: [tab.id] });
      await recordGroups();
    }
  }).catch(() => undefined);
});
chrome.tabs.onActivated.addListener((info) => {
  void enqueue(async () => {
    const tab = await chrome.tabs.get(info.tabId).catch(() => undefined);
    if (!tab) return;
    const runtime = await loadRuntime();
    if (safeUrl(tab.pendingUrl || tab.url))
      runtime.previousTabs[String(info.windowId)] = info.tabId;
    const b = runtime.bindings.find(
      (b) => b.groupId === tab.groupId && b.windowId === info.windowId,
    );
    if (b) {
      b.lastTabId = info.tabId;
      runtime.windowSpaces[String(info.windowId)] = b.spaceId;
    }
    await saveRuntime(runtime);
  }).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (info.isWindowClosing) closingWindows.add(info.windowId);
  void enqueue(async () => {
    const runtime = await loadRuntime();
    const itemIds = new Set<string>();
    for (const [key, id] of Object.entries(runtime.itemTabs))
      if (Number(id) === tabId) {
        const colon = key.indexOf(":");
        itemIds.add(key.slice(colon + 1));
        delete runtime.itemTabs[key];
      }
    const state = await loadState();
    const removed = new Set(
      state.items
        .filter((i) => itemIds.has(i.id) && i.scope === "temporary")
        .map((i) => i.id),
    );
    if (removed.size && !info.isWindowClosing) {
      state.items = state.items
        .filter((i) => !removed.has(i.id))
        .map((i) => ({
          ...i,
          children: i.children.filter((id) => !removed.has(id)),
        }));
      state.undo = undefined;
      await saveState(state);
    }
    await saveRuntime(runtime);
    if (!info.isWindowClosing) await recordGroups();
  }).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url)
    void enqueue(async () => {
      if (tab.active && safeUrl(change.url)) {
        const runtime = await loadRuntime();
        runtime.previousTabs[String(tab.windowId)] = id;
        await saveRuntime(runtime);
      }
      await recordGroups();
    }).catch(() => undefined);
});
chrome.tabGroups.onRemoved.addListener((group) => {
  void enqueue(async () => {
    const runtime = await loadRuntime();
    runtime.bindings = runtime.bindings.filter((b) => b.groupId !== group.id);
    await saveRuntime(runtime);
    if (!closingWindows.has(group.windowId)) await recordGroups();
  }).catch(() => undefined);
});
chrome.tabs.onAttached.addListener((tabId, info) => {
  void enqueue(async () => {
    const runtime = await loadRuntime();
    for (const [key, id] of Object.entries(runtime.itemTabs))
      if (Number(id) === tabId) {
        const itemId = key.slice(key.indexOf(":") + 1);
        delete runtime.itemTabs[key];
        runtime.itemTabs[`${info.newWindowId}:${itemId}`] = id;
      }
    await saveRuntime(runtime);
    await recordGroups();
  }).catch(() => undefined);
});
chrome.tabs.onMoved.addListener(() => {
  void enqueue(recordGroups).catch(() => undefined);
});
chrome.tabGroups.onUpdated.addListener((group) => {
  void enqueue(async () => {
    const runtime = await loadRuntime();
    const binding = runtime.bindings.find((b) => b.groupId === group.id);
    if (!binding || !group.title) return;
    const state = await loadState();
    const space = state.spaces.find((s) => s.id === binding.spaceId);
    if (space && space.name !== group.title) {
      space.name = group.title;
      state.undo = undefined;
      await saveState(state);
    }
  }).catch(() => undefined);
});
