import type {
  AppState,
  DataDocument,
  ImportPreview,
  RuntimeState,
  Space,
} from "./types.ts";

export function initialState(): AppState {
  return {
    schemaVersion: 1,
    revision: 0,
    spaces: [
      { id: "work", name: "工作", color: "purple" },
      { id: "okr", name: "OKR", color: "blue" },
      { id: "personal", name: "个人", color: "green" },
    ],
    items: [],
    archives: [],
    imports: [],
    groupRecords: [],
  };
}
export function initialRuntime(): RuntimeState {
  return { bindings: [], windowSpaces: {}, itemTabs: {}, previousTabs: {} };
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return;
  }
}
export function destination(query: string): { url: string; search: boolean } {
  const q = query.trim();
  const direct = safeUrl(q);
  if (direct) return { url: direct, search: false };
  try {
    const parsed = new URL(q);
    if (parsed.username || parsed.password)
      throw new Error("网址包含身份信息，请先移除用户名和密码");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("网址包含"))
      throw error;
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(q)) {
    const local = safeUrl(`http://${q}`);
    if (local) return { url: local, search: false };
  }
  if (/^[\p{L}\d-]+(?:\.[\p{L}\d-]+)+(?::\d+)?(?:[/?#]\S*)?$/u.test(q)) {
    const domain = safeUrl(`https://${q}`);
    if (domain) return { url: domain, search: false };
  }
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    search: true,
  };
}
export function documentOf(state: AppState): DataDocument {
  const { undo: _undo, ...doc } = state;
  return structuredClone(doc);
}
export function mergeImport(state: AppState, preview: ImportPreview): AppState {
  const existingSpaces = new Map(state.spaces.map((s) => [s.id, s]));
  const spaceIds = new Map<string, string>();
  for (const incoming of preview.spaces) {
    const existing =
      state.spaces.find(
        (s) => s.sourceId && s.sourceId === incoming.sourceId,
      ) ??
      state.spaces.find(
        (s) =>
          ["work", "okr", "personal"].includes(s.id) &&
          !s.sourceId &&
          s.name === incoming.name &&
          !state.items.some((i) => i.spaceId === s.id) &&
          !state.groupRecords.some((g) => g.spaceId === s.id),
      );
    const id = existing?.id ?? incoming.id;
    spaceIds.set(incoming.id, id);
    existingSpaces.set(id, {
      ...existing,
      ...incoming,
      id,
      bookmarkId: existing?.bookmarkId,
    });
  }
  const items = new Map(state.items.map((i) => [i.id, i]));
  for (const incoming of preview.items)
    items.set(incoming.id, {
      ...incoming,
      spaceId:
        incoming.spaceId === null
          ? null
          : (spaceIds.get(incoming.spaceId) ?? incoming.spaceId),
      bookmarkId: items.get(incoming.id)?.bookmarkId,
    });
  return {
    ...state,
    revision: state.revision + 1,
    spaces: [...existingSpaces.values()],
    items: [...items.values()],
  };
}
export function validateBackup(text: string): DataDocument {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new Error("备份文件超过 10 MB");
  const d = JSON.parse(text) as Partial<DataDocument>;
  if (
    d.schemaVersion !== 1 ||
    !Array.isArray(d.spaces) ||
    !d.spaces.length ||
    !Array.isArray(d.items) ||
    !Array.isArray(d.archives)
  )
    throw new Error("备份版本或数据结构不受支持");
  if (
    d.spaces.length > 1000 ||
    d.items.length > 50000 ||
    d.archives.length > 50000
  )
    throw new Error("备份条目数量超过上限");
  const spaces = new Set<string>();
  const ids = new Set<string>();
  const colors = new Set([
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
  ]);
  for (const s of d.spaces) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      spaces.has(s.id) ||
      typeof s.name !== "string" ||
      !s.name.trim() ||
      !colors.has(s.color)
    )
      throw new Error("备份包含无效或重复空间");
    spaces.add(s.id);
  }
  for (const i of d.items) {
    if (
      !i ||
      typeof i.id !== "string" ||
      !i.id ||
      ids.has(i.id) ||
      !["link", "folder", "split"].includes(i.kind) ||
      typeof i.title !== "string" ||
      !Array.isArray(i.children) ||
      !i.children.every((x) => typeof x === "string") ||
      !["favorite", "pinned", "temporary"].includes(i.scope)
    )
      throw new Error("备份包含无效或重复条目");
    if (i.spaceId !== null && !spaces.has(i.spaceId))
      throw new Error("条目引用了不存在的空间");
    if (i.kind === "link" && !safeUrl(i.url))
      throw new Error("备份包含不受支持的网址");
    ids.add(i.id);
  }
  const map = new Map(d.items.map((i) => [i.id, i]));
  for (const item of d.items) {
    if (item.parentId !== null && !ids.has(item.parentId))
      throw new Error("条目引用了不存在的目录");
    if (item.parentId === item.id) throw new Error("备份目录存在循环");
    if (item.parentId !== null) {
      const parent = map.get(item.parentId)!;
      if (
        parent.kind === "link" ||
        parent.spaceId !== item.spaceId ||
        !parent.children.includes(item.id)
      )
        throw new Error("备份目录关系不一致");
    }
    const visited = new Set<string>();
    let current = item;
    while (current.parentId !== null) {
      if (visited.has(current.id) || visited.size > 64)
        throw new Error("备份目录存在循环或层级超过 64");
      visited.add(current.id);
      current = map.get(current.parentId)!;
    }
    for (const id of item.children) {
      const child = map.get(id);
      if (
        !child ||
        child.parentId !== item.id ||
        child.spaceId !== item.spaceId
      )
        throw new Error("备份目录关系不一致");
    }
  }
  const archiveIds = new Set<string>();
  for (const a of d.archives) {
    if (
      !a ||
      typeof a.id !== "string" ||
      archiveIds.has(a.id) ||
      typeof a.title !== "string" ||
      !safeUrl(a.url) ||
      !spaces.has(a.spaceId) ||
      !Number.isFinite(a.archivedAt)
    )
      throw new Error("备份归档结构无效");
    archiveIds.add(a.id);
  }
  // Native browser IDs are session/profile specific and must be recreated.
  const cleanSpaces = d.spaces.map(({ bookmarkId: _id, ...s }) => s);
  const cleanItems = d.items.map(({ bookmarkId: _id, ...i }) => i);
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(d.revision) ? d.revision! + 1 : 1,
    spaces: cleanSpaces,
    items: cleanItems,
    archives: d.archives.map(({ sessionId: _id, ...a }) => a),
    imports: [],
    groupRecords: [],
  };
}
export function spaceForGroup(
  spaces: Space[],
  groupId: number,
  bindings: RuntimeState["bindings"],
): Space | undefined {
  return spaces.find((s) =>
    bindings.some((b) => b.groupId === groupId && b.spaceId === s.id),
  );
}
