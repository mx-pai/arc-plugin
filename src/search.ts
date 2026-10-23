import { destination } from "./model.ts";
import type { SearchResult, Snapshot } from "./types.ts";

export const commands = [
  ["pin", "固定当前页面", "保存到当前空间，关闭页面后保留入口"],
  ["archive", "归档当前页面", "保存网址与空间归属"],
  ["split", "与上一个页面分屏", "使用 Chrome 原生双页分屏"],
  ["restore-last", "恢复最近归档", "回到归档前的空间"],
  ["settings", "打开设置", "空间、Arc 迁移、备份与快捷键"],
] as const;
const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase().trim();
function relevance(q: string, title: string, extra: string): number {
  if (!q) return 1;
  const t = norm(title),
    e = norm(extra);
  if (t === q) return 140;
  if (t.startsWith(q)) return 115;
  if (t.includes(q)) return 90;
  if (e.includes(q)) return 60;
  if (q.split(/\s+/).every((token) => (t + " " + e).includes(token))) return 50;
  let at = 0;
  for (const ch of t) if (ch === q[at]) at++;
  return at === q.length && q.length > 1 ? 20 : 0;
}
export function search(
  snapshot: Snapshot,
  input: string,
  limit = 40,
): SearchResult[] {
  const query = norm(input.slice(0, 2048));
  const commandMode = query.startsWith(">");
  const q = commandMode ? query.slice(1).trim() : query;
  const { state, tabs, windowId, runtime } = snapshot;
  const activeSpace = runtime.windowSpaces[String(windowId)];
  const name = (id?: string | null) =>
    id === null
      ? "跨空间收藏"
      : (state.spaces.find((s) => s.id === id)?.name ?? "未分配空间");
  const results: SearchResult[] = [];
  const add = (r: Omit<SearchResult, "score">, extra = "", boost = 0) => {
    const score = relevance(q, r.title, r.subtitle + " " + extra);
    if (score) results.push({ ...r, score: score + boost });
  };
  if (!commandMode) {
    for (const t of tabs)
      add(
        {
          id: `tab:${t.id}`,
          kind: "tab",
          title: t.title || t.url,
          subtitle: `已打开 · ${name(t.spaceId)}`,
          url: t.url,
          spaceId: t.spaceId,
        },
        t.url,
        (t.windowId === windowId ? 12 : 0) +
          (t.spaceId === activeSpace ? 8 : 0),
      );
    for (const i of state.items.filter((i) => i.kind === "link")) {
      if (tabs.some((t) => t.itemId === i.id)) continue;
      add(
        {
          id: `item:${i.id}`,
          kind: "item",
          title: i.title,
          subtitle: `${i.scope === "temporary" ? "待打开" : "固定入口"} · ${name(i.spaceId)}`,
          url: i.url,
          spaceId: i.spaceId ?? undefined,
        },
        i.url ?? "",
        i.spaceId === activeSpace ? 8 : 0,
      );
    }
  }
  for (const s of state.spaces)
    add(
      {
        id: `space:${s.id}`,
        kind: "space",
        title: s.name,
        subtitle: "切换空间",
        spaceId: s.id,
      },
      "",
      commandMode ? 15 : 0,
    );
  for (const [id, title, subtitle] of commands)
    add(
      { id: `command:${id}`, kind: "command", title, subtitle },
      "",
      commandMode ? 20 : -8,
    );
  results.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"),
  );
  if (query && !commandMode) {
    try {
      const d = destination(input);
      results.push({
        id: d.search ? "search" : "url",
        kind: d.search ? "search" : "url",
        title: d.search ? `搜索“${input.trim()}”` : `打开 ${d.url}`,
        subtitle: d.search ? "使用 Google 搜索" : "打开网址",
        url: d.url,
        score: -1,
      });
    } catch {
      /* Credentials in URLs never become search-provider queries. */
    }
  }
  return results.slice(0, limit);
}
