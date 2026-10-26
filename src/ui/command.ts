import { useEffect, useMemo, useRef, useState } from "react";
import { request } from "../client.ts";
import { search } from "../search.ts";
import { useSnapshot } from "./hooks.ts";
import type { SearchResult } from "../types.ts";

export const actionLabel = (kind: SearchResult["kind"]) =>
  kind === "tab"
    ? "切换"
    : kind === "space"
      ? "进入"
      : kind === "command"
        ? "执行"
        : "打开";

// 根据按键修饰符决定浮窗模式：⌘/Ctrl → Little Arc，⌥ → Peek。
export const floatingFor = (event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): "little-arc" | "peek" | undefined =>
  event.metaKey || event.ctrlKey ? "little-arc" : event.altKey ? "peek" : undefined;

// 命令面板与新标签主页共用的搜索状态机：查询、选中项、执行与键盘导航。
// autoFocus=true 时挂载即聚焦输入框（弹窗与注入浮层）；新标签页自行决定焦点。
export function usePaletteSearch(onClose: () => void, autoFocus = false) {
  const { snapshot, error, setError, refresh } = useSnapshot();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => (snapshot ? search(snapshot, query) : []),
    [snapshot, query],
  );
  const activeSpace = snapshot
    ? snapshot.runtime.windowSpaces[String(snapshot.windowId)]
    : undefined;

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    resultList.current
      ?.querySelector<HTMLElement>(`#result-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);

  const run = async (result: SearchResult, openIn?: "little-arc" | "peek") => {
    if (busy || !snapshot) return;
    setBusy(true);
    setError("");
    try {
      if (openIn && result.url)
        await request({
          type: "open-floating",
          url: result.url,
          mode: openIn,
          originTabId: snapshot.originTabId,
        });
      else
        await request({
          type: "execute",
          id: result.id,
          query,
          originTabId: snapshot.originTabId,
        });
      if (!openIn && result.kind === "command" && result.id !== "command:settings") {
        await refresh();
        setQuery("");
        input.current?.focus();
      } else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 输入框上的方向键 / 回车 / Esc 导航；回车按修饰符选择浮窗模式。
  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const onInput = event.target === input.current;
    if (onInput && event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    }
    if (onInput && event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    }
    if (onInput && event.key === "Enter" && results[selected]) {
      event.preventDefault();
      void run(results[selected], floatingFor(event));
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return {
    snapshot,
    error,
    refresh,
    query,
    setQuery,
    selected,
    setSelected,
    busy,
    input,
    resultList,
    results,
    activeSpace,
    run,
    onInputKeyDown,
  };
}
