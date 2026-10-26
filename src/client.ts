import {
  initialRuntime,
  initialState,
  mergeImport,
  normalizeSettings,
  settingsOf,
  validateBackup,
} from "./model.ts";
import { parseArcSidebar } from "./arc-import.ts";
import type { Request, Response, Snapshot } from "./types.ts";

export const isExtension =
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
const demo = (): Snapshot => {
  const state = initialState();
  state.items = [
    {
      id: "demo:docs",
      spaceId: "work",
      parentId: null,
      kind: "link",
      scope: "pinned",
      title: "Chrome 扩展文档",
      url: "https://developer.chrome.com/docs/extensions",
      children: [],
    },
    {
      id: "demo:arc",
      spaceId: "work",
      parentId: null,
      kind: "link",
      scope: "pinned",
      title: "Arc 使用指南",
      url: "https://resources.arc.net/",
      children: [],
    },
  ];
  const runtime = initialRuntime();
  runtime.windowSpaces["1"] = "work";
  return {
    state,
    runtime,
    windowId: 1,
    demo: true,
    tabs: [
      {
        id: 1,
        windowId: 1,
        groupId: 1,
        title: "Arc Plugin · 设计与实现",
        url: "https://example.com/arc-plugin",
        active: true,
        audible: false,
        pinned: false,
        spaceId: "work",
      },
    ],
  };
};
let previewState = demo();
export async function request<T = unknown>(message: Request): Promise<T> {
  if (isExtension) {
    const result = (await chrome.runtime.sendMessage(message)) as Response<T>;
    if (!result?.ok)
      throw new Error(result?.error ?? "后台暂时不可用，请在扩展页重新加载");
    return result.data;
  }
  if (message.type === "snapshot") return structuredClone(previewState) as T;
  if (message.type === "preview-import")
    return parseArcSidebar(message.text) as T;
  if (message.type === "import") {
    previewState.state = mergeImport(
      previewState.state,
      parseArcSidebar(message.text),
    );
    return { added: previewState.state.items.length, updated: 0 } as T;
  }
  if (message.type === "restore") {
    previewState.state = validateBackup(message.text);
    return undefined as T;
  }
  if (message.type === "get-settings")
    return settingsOf(previewState.state) as T;
  if (message.type === "set-settings") {
    previewState.state.settings = normalizeSettings(message.settings);
    return previewState.state.settings as T;
  }
  if (message.type === "auto-archive-preview") return [] as T;
  if (message.type === "run-auto-archive")
    return { archived: 0, failed: 0 } as T;
  if (message.type === "create-space") {
    const id = `space:${Date.now()}`;
    previewState.state.spaces.push({ id, name: message.name, color: message.color });
    return structuredClone(previewState) as T;
  }
  if (message.type === "delete-space") {
    previewState.state.spaces = previewState.state.spaces.filter((s) => s.id !== message.id);
    previewState.state.items = previewState.state.items.filter((i) => i.spaceId !== message.id);
    return structuredClone(previewState) as T;
  }
  if (message.type === "reorder-spaces") {
    const byId = new Map(previewState.state.spaces.map((s) => [s.id, s]));
    previewState.state.spaces = message.ids.map((id) => byId.get(id)!).filter(Boolean);
    return structuredClone(previewState) as T;
  }
  if (message.type === "set-space-color") {
    const space = previewState.state.spaces.find((s) => s.id === message.id);
    if (space) space.color = message.color;
    return structuredClone(previewState) as T;
  }
  if (message.type === "open-floating" || message.type === "repair-item")
    throw new Error("这项操作需要在真实扩展中使用");
  if (message.type === "execute") {
    if (message.id.startsWith("space:"))
      previewState.runtime.windowSpaces["1"] = message.id.slice(6);
    else if (message.id === "command:settings")
      window.location.href = "/options.html";
    else if (message.id.startsWith("tab:") || message.id.startsWith("item:"))
      throw new Error("当前为演示预览，请在 Chrome 中加载扩展以打开页面");
    else throw new Error("这项操作需要在真实扩展中使用");
    return structuredClone(previewState) as T;
  }
  throw new Error("当前为演示预览，这项操作需要在 Chrome 扩展中使用");
}
