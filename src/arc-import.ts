import { safeUrl } from "./model.ts";
import { SPACE_COLORS } from "./types.ts";
import type { ImportPreview, Item, Space, SpaceColor } from "./types.ts";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
export function arcDictionary(v: unknown): Map<string, Obj> {
  if (!Array.isArray(v))
    return new Map(Object.entries(object(v)).map(([k, x]) => [k, object(x)]));
  const m = new Map<string, Obj>();
  for (let i = 0; i < v.length - 1; i += 2)
    if (typeof v[i] === "string") m.set(v[i] as string, object(v[i + 1]));
  return m;
}
const nativeId = (id: string) => `arc:${encodeURIComponent(id)}`;

export function parseArcSidebar(text: string): ImportPreview {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new Error("Arc 文件超过 10 MB");
  const raw = object(JSON.parse(text));
  const containers = list(object(raw.sidebar).containers).map(object);
  if (!containers.length)
    throw new Error("未找到 sidebar.containers，请选择 StorableSidebar.json");
  const diagnostics: string[] = [];
  let skipped = 0;
  const issue = (message: string) => {
    skipped++;
    if (diagnostics.length < 200) diagnostics.push(message);
  };
  const colors = SPACE_COLORS;
  const spaces = new Map<string, Space>();
  const nodes = new Map<string, Obj>();
  for (const c of containers) {
    for (const [id, it] of arcDictionary(c.items))
      nodes.set(id, { ...it, id: str(it.id) || id });
    for (const [id, s] of arcDictionary(c.spaces))
      if (str(s.title).trim()) {
        spaces.set(id, {
          id: nativeId(`space:${id}`),
          sourceId: id,
          name: str(s.title).slice(0, 200),
          color: colors[spaces.size % colors.length],
        });
      }
  }
  if (nodes.size > 50000) throw new Error("Arc 文件超过 50000 个侧栏节点");
  let localIndex = 0;
  for (const c of containers)
    for (const [id] of arcDictionary(c.spaces)) {
      if (!spaces.has(id))
        spaces.set(id, {
          id: nativeId(`space:${id}`),
          sourceId: id,
          name: `窗口临时页 ${++localIndex}`,
          color: "grey",
        });
    }
  const items = new Map<string, Item>();
  const walk = (
    sourceId: string,
    spaceId: string | null,
    scope: Item["scope"],
    parentId: string | null,
    ancestors: Set<string>,
  ): string[] => {
    if (ancestors.has(sourceId) || ancestors.size > 64) {
      issue("目录存在循环或层级超过 64");
      return [];
    }
    const node = nodes.get(sourceId);
    if (!node) {
      issue("目录引用了缺失节点");
      return [];
    }
    const id = nativeId(str(node.id) || sourceId);
    if (items.has(id)) return items.get(id)!.parentId === parentId ? [id] : [];
    const data = object(node.data);
    const children = list(node.childrenIds).filter(
      (x): x is string => typeof x === "string",
    );
    const next = new Set(ancestors).add(sourceId);
    if ("itemContainer" in data)
      return children.flatMap((child) =>
        walk(child, spaceId, scope, parentId, next),
      );
    const kind: Item["kind"] | undefined =
      "tab" in data
        ? "link"
        : "list" in data
          ? "folder"
          : "splitView" in data
            ? "split"
            : undefined;
    if (!kind) {
      issue("跳过当前版本不支持的节点类型");
      return [];
    }
    const tab = object(data.tab);
    const url = safeUrl(tab.savedURL);
    if (kind === "link" && !url) {
      issue("跳过无效或不支持协议的网址");
      return [];
    }
    const title = (
      str(node.title) ||
      str(tab.savedTitle) ||
      (url ? new URL(url).hostname : kind === "split" ? "分屏组合" : "文件夹")
    ).slice(0, 1000);
    const item: Item = {
      id,
      sourceId: str(node.id) || sourceId,
      spaceId,
      parentId,
      kind,
      scope,
      title,
      children: [],
      ...(url ? { url } : {}),
    };
    const split = object(data.splitView);
    if (kind === "split") {
      item.orientation = str(split.layoutOrientation);
      item.weights = list(split.itemWidthFactors).filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x),
      );
    }
    items.set(id, item);
    if (kind !== "link")
      item.children = children.flatMap((child) =>
        walk(child, spaceId, scope, id, next),
      );
    return [id];
  };
  for (const c of containers) {
    for (const [sourceId, s] of arcDictionary(c.spaces)) {
      const space = spaces.get(sourceId)!;
      const roots = list(s.newContainerIDs);
      let understood = false;
      for (let i = 0; i + 1 < roots.length; i += 2) {
        const tag = object(roots[i]);
        const id = str(roots[i + 1]);
        if (!id) continue;
        const scope =
          "pinned" in tag
            ? "pinned"
            : "unpinned" in tag
              ? "temporary"
              : undefined;
        if (scope) {
          walk(id, space.id, scope, null, new Set());
          understood = true;
        }
      }
      if (!understood) {
        diagnostics.push("部分容器缺少固定区标识，按固定入口保留");
        for (const id of list(s.containerIDs))
          if (typeof id === "string")
            walk(id, space.id, "pinned", null, new Set());
      }
    }
    const top = list(c.topAppsContainerIDs);
    for (let i = 1; i < top.length; i += 2)
      if (typeof top[i] === "string")
        walk(top[i] as string, null, "favorite", null, new Set());
  }
  const result = [...items.values()];
  const used = [...spaces.values()].filter(
    (s) =>
      result.some((i) => i.spaceId === s.id) ||
      !s.name.startsWith("窗口临时页"),
  );
  if (!used.length) throw new Error("文件中没有可识别的空间");
  return {
    spaces: used,
    items: result,
    diagnostics: diagnostics.slice(0, 200),
    counts: {
      links: result.filter((i) => i.kind === "link").length,
      folders: result.filter((i) => i.kind === "folder").length,
      splits: result.filter((i) => i.kind === "split").length,
      skipped,
    },
  };
}
