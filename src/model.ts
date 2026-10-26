import type {
  AppState,
  AutoArchiveScope,
  DataDocument,
  DomainRule,
  FloatingMode,
  ImportPreview,
  Item,
  LiveTab,
  RuntimeState,
  Settings,
  Space,
} from "./types.ts";
import { SPACE_COLORS } from "./types.ts";

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}
export interface ReconcileResult {
  state: AppState;
  changed: boolean;
  adopted: number;
  markedMissing: number;
  restored: number;
}
export interface ArchiveCandidate {
  tabId: number;
  windowId: number;
  spaceId: string;
  url: string;
  title: string;
  idleMs: number;
}
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
export function normalizeDomainPattern(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  let pattern = value.trim().toLowerCase();
  if (!pattern || pattern.length > 253) return;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(pattern)) {
    try {
      pattern = new URL(pattern).host.toLowerCase();
    } catch {
      return;
    }
  }
  if (/[/@?#]/.test(pattern)) return;
  const wildcard = pattern.startsWith("*.");
  const host = wildcard ? pattern.slice(2) : pattern;
  if (!host) return;
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^(?:${label})(?:\\.${label})*(?::\\d{1,5})?$`).test(host))
    return;
  return wildcard ? `*.${host}` : host;
}
export function normalizeSettings(value: unknown): Settings {
  const raw = (
    value && typeof value === "object" ? value : {}
  ) as Record<string, unknown>;
  const sync = (
    raw.bookmarkSync && typeof raw.bookmarkSync === "object"
      ? raw.bookmarkSync
      : {}
  ) as Record<string, unknown>;
  const auto = (
    raw.autoArchive && typeof raw.autoArchive === "object"
      ? raw.autoArchive
      : {}
  ) as Record<string, unknown>;
  const routing = (
    raw.routing && typeof raw.routing === "object" ? raw.routing : {}
  ) as Record<string, unknown>;
  const seen = new Set<string>();
  const rules: DomainRule[] = [];
  for (const entry of Array.isArray(routing.rules) ? routing.rules : []) {
    if (!entry || typeof entry !== "object") continue;
    const rule = entry as Record<string, unknown>;
    const pattern = normalizeDomainPattern(rule.pattern);
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    rules.push({
      id: typeof rule.id === "string" && rule.id ? rule.id : `rule:${pattern}`,
      pattern,
      spaceId:
        rule.spaceId === null || typeof rule.spaceId === "string"
          ? rule.spaceId
          : undefined,
      openIn: rule.openIn === "little-arc" ? "little-arc" : "current",
    });
    if (rules.length >= 200) break;
  }
  const scope: AutoArchiveScope =
    auto.scope === "managed" || auto.scope === "spaces"
      ? auto.scope
      : "temporary";
  return {
    bookmarkSync: { enabled: sync.enabled !== false },
    autoArchive: {
      enabled: auto.enabled === true,
      afterDays: clamp(auto.afterDays, 0, 365, 7),
      scope,
      spaceIds: Array.isArray(auto.spaceIds)
        ? auto.spaceIds
            .filter((id): id is string => typeof id === "string")
            .slice(0, 200)
        : [],
      maxPerRun: clamp(auto.maxPerRun, 1, 100, 20),
    },
    routing: { rules },
    newtabFocus: raw.newtabFocus === "palette" ? "palette" : "omnibox",
  };
}
export const DEFAULT_SETTINGS = normalizeSettings(undefined);
export function settingsOf(state: { settings?: Settings }): Settings {
  return normalizeSettings(state.settings);
}
export function initialState(): AppState {
  return {
    schemaVersion: 1,
    revision: 0,
    spaces: [
      { id: "work", name: "工作", color: "purple" },
      { id: "personal", name: "个人", color: "green" },
    ],
    items: [],
    archives: [],
    imports: [],
    groupRecords: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}
export function initialRuntime(): RuntimeState {
  return {
    bindings: [],
    windowSpaces: {},
    itemTabs: {},
    previousTabs: {},
    lastAccessed: {},
  };
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
export function splitTargets(
  items: Item[],
  splitId: string,
  max = 4,
): Item[] {
  const split = items.find((i) => i.id === splitId);
  if (!split || split.kind !== "split") return [];
  const seen = new Set<string>();
  const targets: Item[] = [];
  for (const id of split.children) {
    if (seen.has(id)) continue;
    seen.add(id);
    const child = items.find((i) => i.id === id);
    if (child && child.kind === "link" && safeUrl(child.url))
      targets.push(child);
    if (targets.length >= max) break;
  }
  return targets;
}
export function reconcileBookmarks(
  state: AppState,
  roots: BookmarkNode[],
  now: number,
): ReconcileResult {
  const rootId = state.bookmarkRootId;
  const nodes = new Map<string, BookmarkNode>();
  const parents = new Map<string, string | undefined>();
  const walk = (list: BookmarkNode[], parent?: string) => {
    for (const node of list) {
      nodes.set(node.id, node);
      parents.set(node.id, parent);
      if (node.children) walk(node.children, node.id);
    }
  };
  walk(roots);
  const root = rootId ? nodes.get(rootId) : undefined;
  const unchanged: ReconcileResult = {
    state,
    changed: false,
    adopted: 0,
    markedMissing: 0,
    restored: 0,
  };
  if (!rootId || !root) return unchanged;
  const managed = (id: string) => {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (current === rootId) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      current = parents.get(current);
    }
    return false;
  };
  const next = structuredClone(state);
  const itemsById = new Map(next.items.map((item) => [item.id, item]));
  const itemByBookmark = new Map(
    next.items
      .filter((item) => item.bookmarkId)
      .map((item) => [item.bookmarkId!, item]),
  );
  const spaceByBookmark = new Map(
    next.spaces
      .filter((space) => space.bookmarkId)
      .map((space) => [space.bookmarkId!, space]),
  );
  const parentOf = (
    node: BookmarkNode,
  ): { parentId: string | null; spaceId: string | null; scope: Item["scope"] } | undefined => {
    const visited = new Set<string>();
    let current = parents.get(node.id);
    while (current) {
      if (visited.has(current)) return;
      visited.add(current);
      if (current === rootId)
        return { parentId: null, spaceId: null, scope: "favorite" };
      const space = spaceByBookmark.get(current);
      if (space) return { parentId: null, spaceId: space.id, scope: "pinned" };
      const parentItem = itemByBookmark.get(current);
      if (parentItem)
        return {
          parentId: parentItem.id,
          spaceId: parentItem.spaceId,
          scope: parentItem.scope,
        };
      current = parents.get(current);
    }
    return;
  };
  let markedMissing = 0;
  let restored = 0;
  for (const item of next.items) {
    if (!item.bookmarkId) continue;
    const node = nodes.get(item.bookmarkId);
    if (!node) {
      if (item.missing?.reason !== "deleted") {
        item.missing = { at: now, reason: "deleted" };
        markedMissing++;
      }
      continue;
    }
    if (!managed(node.id)) {
      if (item.missing?.reason !== "moved") {
        item.missing = { at: now, reason: "moved" };
        markedMissing++;
      }
      continue;
    }
    const target = parentOf(node);
    let reason: "moved" | "invalid" | undefined;
    if (!target) reason = "moved";
    if (item.kind === "link") {
      const url = safeUrl(node.url);
      if (!url) reason = "invalid";
      else if (item.url !== url) item.url = url;
    }
    if (node.title && node.title !== item.title) item.title = node.title;
    if (target) {
      if (item.parentId !== target.parentId) {
        if (item.parentId) {
          const previous = itemsById.get(item.parentId);
          if (previous)
            previous.children = previous.children.filter((id) => id !== item.id);
        }
        item.parentId = target.parentId;
        if (target.parentId) {
          const parent = itemsById.get(target.parentId);
          if (parent && !parent.children.includes(item.id))
            parent.children.push(item.id);
        }
      }
      if (item.spaceId !== target.spaceId) item.spaceId = target.spaceId;
    }
    if (reason) {
      if (item.missing?.reason !== reason) {
        item.missing = { at: now, reason };
        markedMissing++;
      }
    } else if (item.missing) {
      delete item.missing;
      restored++;
    }
  }
  for (const space of next.spaces) {
    if (!space.bookmarkId) continue;
    const node = nodes.get(space.bookmarkId);
    if (node && managed(node.id) && node.title && node.title !== space.name)
      space.name = node.title;
  }
  let adopted = 0;
  const visit = (list: BookmarkNode[]) => {
    for (const node of list) {
      if (!managed(node.id)) continue;
      if (!spaceByBookmark.has(node.id) && !itemByBookmark.has(node.id)) {
        const target = parentOf(node);
        if (target) {
          const url = node.url ? safeUrl(node.url) : undefined;
          if (!node.url || url) {
            let id = `native:${node.id}`;
            for (let suffix = 2; itemsById.has(id); suffix++)
              id = `native:${node.id}:${suffix}`;
            const title =
              node.title.trim() ||
              (url ? new URL(url).hostname : "") ||
              "未命名条目";
            const item: Item = {
              id,
              spaceId: target.spaceId,
              parentId: target.parentId,
              kind: url ? "link" : "folder",
              scope: target.scope,
              title,
              ...(url ? { url } : {}),
              children: [],
              bookmarkId: node.id,
            };
            next.items.push(item);
            itemsById.set(item.id, item);
            itemByBookmark.set(node.id, item);
            if (target.parentId) {
              const parent = itemsById.get(target.parentId);
              if (parent) parent.children.push(item.id);
            }
            adopted++;
          }
        }
      }
      if (node.children) visit(node.children);
    }
  };
  visit(root.children ?? []);
  const changed =
    JSON.stringify(next.spaces) !== JSON.stringify(state.spaces) ||
    JSON.stringify(next.items) !== JSON.stringify(state.items);
  if (changed) next.undo = undefined;
  return {
    state: changed ? next : state,
    changed,
    adopted,
    markedMissing,
    restored,
  };
}
export function selectAutoArchiveCandidates(
  tabs: LiveTab[],
  state: AppState,
  runtime: RuntimeState,
  now: number,
): ArchiveCandidate[] {
  const config = settingsOf(state).autoArchive;
  if (!config.enabled) return [];
  const items = new Map(state.items.map((item) => [item.id, item]));
  const perWindow = new Map<number, number>();
  for (const tab of tabs)
    perWindow.set(tab.windowId, (perWindow.get(tab.windowId) ?? 0) + 1);
  const threshold = config.afterDays * 86400000;
  const candidates: ArchiveCandidate[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const url = safeUrl(tab.url);
    if (!url) continue;
    if (tab.active || tab.pinned || tab.audible) continue;
    if (tab.splitViewId !== undefined && tab.splitViewId >= 0) continue;
    if ((perWindow.get(tab.windowId) ?? 0) <= 1) continue;
    const binding = runtime.bindings.find(
      (b) => b.windowId === tab.windowId && b.groupId === tab.groupId,
    );
    if (tab.groupId < 0 || !binding) continue;
    const item = tab.itemId ? items.get(tab.itemId) : undefined;
    if (item && item.scope !== "temporary") continue;
    if (config.scope === "spaces" && !config.spaceIds.includes(binding.spaceId))
      continue;
    const last = Math.max(
      tab.lastAccessed ?? 0,
      runtime.lastAccessed[String(tab.id)] ?? 0,
    );
    if (last === 0 ? threshold > 0 : now - last < threshold) continue;
    candidates.push({
      tabId: tab.id,
      windowId: tab.windowId,
      spaceId: binding.spaceId,
      url,
      title: tab.title.trim() || new URL(url).hostname,
      idleMs: Math.max(0, now - last),
    });
  }
  return candidates
    .sort((a, b) => b.idleMs - a.idleMs)
    .slice(0, config.maxPerRun);
}
export function floatingBounds(
  parent:
    | { left?: number; top?: number; width?: number; height?: number }
    | undefined,
  mode: FloatingMode,
): { width: number; height: number; left?: number; top?: number } {
  const preferred =
    mode === "peek" ? { width: 520, height: 640 } : { width: 720, height: 760 };
  const width = Math.min(
    preferred.width,
    Math.max(320, parent?.width ?? preferred.width),
  );
  const height = Math.min(
    preferred.height,
    Math.max(240, parent?.height ?? preferred.height),
  );
  if (parent?.left === undefined || parent?.top === undefined)
    return { width, height };
  return {
    width,
    height,
    left: Math.max(
      0,
      parent.left + (parent.width ?? width) - width - 24,
    ),
    top: Math.max(0, parent.top + 24),
  };
}
export function matchDomainRule(
  url: string,
  rules: DomainRule[],
  spaces: Space[],
): DomainRule | undefined {
  const parsed = safeUrl(url);
  if (!parsed) return;
  const target = new URL(parsed);
  const host = target.host.toLowerCase();
  const hostname = target.hostname.toLowerCase();
  const known = new Set(spaces.map((space) => space.id));
  let best: { rule: DomainRule; exact: boolean } | undefined;
  for (const rule of rules) {
    if (rule.spaceId && !known.has(rule.spaceId)) continue;
    const wildcard = rule.pattern.startsWith("*.");
    const patternHost = wildcard ? rule.pattern.slice(2) : rule.pattern;
    const candidate = /:\d+$/.test(patternHost) ? host : hostname;
    const matched = wildcard
      ? candidate.endsWith(`.${patternHost}`)
      : candidate === patternHost;
    if (!matched) continue;
    const exact = !wildcard;
    if (
      !best ||
      (exact && !best.exact) ||
      (exact === best.exact && rule.pattern.length > best.rule.pattern.length)
    )
      best = { rule, exact };
  }
  return best?.rule;
}
export function routeFor(
  url: string,
  settings: Settings,
  spaces: Space[],
  activeSpaceId: string,
): { spaceId: string; openIn: "current" | "little-arc" } {
  const rule = matchDomainRule(url, settings.routing.rules, spaces);
  return {
    spaceId: rule?.spaceId ?? activeSpaceId,
    openIn: rule?.openIn ?? "current",
  };
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
  const colors = new Set<string>(SPACE_COLORS);
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
  const cleanItems = d.items.map(
    ({ bookmarkId: _id, missing: _missing, ...i }) => i,
  );
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(d.revision) ? d.revision! + 1 : 1,
    spaces: cleanSpaces,
    items: cleanItems,
    archives: d.archives.map(({ sessionId: _id, ...a }) => a),
    imports: [],
    groupRecords: [],
    settings: normalizeSettings(d.settings),
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
