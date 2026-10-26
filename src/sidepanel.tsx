import { useState } from "react";
import { request } from "./client.ts";
import { letterOf, pinnedEntries, shortHost, useSnapshot } from "./ui/hooks.ts";
import {
  Button,
  KindBadge,
  Notice,
  SpaceDot,
} from "./ui/primitives.tsx";
import { CloseIcon, SearchIcon } from "./ui/icons.tsx";
import { search } from "./search.ts";
import type { Item, LiveTab, SearchResult } from "./types.ts";

function TabRow({ tab, onSwitch }: { tab: LiveTab; onSwitch: () => void }) {
  return (
    <button className="sp-row" onClick={onSwitch}>
      <span className="sp-avatar">{letterOf(tab.url, tab.title)}</span>
      <span className="sp-copy">
        <span className="sp-title">{tab.title || tab.url}</span>
        <span className="sp-host">{shortHost(tab.url)}</span>
      </span>
      {tab.active && <span className="sp-active-dot" />}
    </button>
  );
}

function PinRow({ item, onOpen }: { item: Item; onOpen: () => void }) {
  return (
    <button className="sp-row" onClick={onOpen}>
      <KindBadge kind={item.kind === "split" ? "split" : "link"} />
      <span className="sp-copy">
        <span className="sp-title">{item.title}</span>
        <span className="sp-host">{shortHost(item.url)}</span>
      </span>
    </button>
  );
}

export function SidePanel() {
  const { snapshot, error } = useSnapshot();
  const [query, setQuery] = useState("");

  if (!snapshot) {
    return (
      <div className="arc-app sp-root">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <div className="loading">正在加载…</div>
        )}
      </div>
    );
  }

  const activeSpace = snapshot.runtime.windowSpaces[String(snapshot.windowId)];
  const currentSpace =
    snapshot.state.spaces.find((s) => s.id === activeSpace) ??
    snapshot.state.spaces[0];

  const switchSpace = (id: string) =>
    void request({ type: "execute", id: `space:${id}` });
  const switchTab = (tabId: number) =>
    void request({ type: "execute", id: `tab:${tabId}` });
  const openItem = (itemId: string) =>
    void request({ type: "execute", id: `item:${itemId}` });
  const openResult = (result: SearchResult) =>
    void request({ type: "execute", id: result.id, query });

  const spaceTabs = snapshot.tabs.filter(
    (t) => t.spaceId === currentSpace?.id,
  );
  const pinned = pinnedEntries(snapshot, activeSpace);
  const searching = query.trim().length > 0;
  const results = searching ? search(snapshot, query, 12) : [];

  return (
    <div className="arc-app sp-root">
      <header className="sp-header">
        <SpaceDot color={currentSpace?.color ?? "grey"} />
        <span className="sp-space-name">{currentSpace?.name}</span>
      </header>

      <div className="sp-search-bar">
        <SearchIcon size={15} className="sp-search-icon" />
        <input
          className="sp-search-input"
          placeholder="搜索标签、收藏或命令"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {searching && (
          <button className="sp-search-clear" onClick={() => setQuery("")}>
            <CloseIcon size={13} />
          </button>
        )}
      </div>

      <div className="sp-spaces scroll">
        {snapshot.state.spaces.map((s) => (
          <button
            key={s.id}
            className={`sp-space ${s.id === currentSpace?.id ? "is-active" : ""}`}
            onClick={() => switchSpace(s.id)}
            title={s.name}
          >
            <SpaceDot color={s.color} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="sp-body scroll">
        {searching ? (
          <div className="sp-section">
            <p className="sp-label">搜索结果</p>
            {results.map((r) => (
              <button
                key={r.id}
                className="sp-row"
                onClick={() => openResult(r)}
              >
                <span className="sp-avatar">
                  {letterOf(r.url, r.title)}
                </span>
                <span className="sp-copy">
                  <span className="sp-title">{r.title}</span>
                  <span className="sp-host">{r.subtitle}</span>
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="sp-empty muted">未找到匹配项</p>
            )}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="sp-section">
                <p className="sp-label">固定入口</p>
                {pinned.map((item) => (
                  <PinRow
                    key={item.id}
                    item={item}
                    onOpen={() => openItem(item.id)}
                  />
                ))}
              </div>
            )}
            <div className="sp-section">
              <p className="sp-label">
                打开的标签 · {spaceTabs.length}
              </p>
              {spaceTabs.map((tab) => (
                <TabRow
                  key={tab.id}
                  tab={tab}
                  onSwitch={() => switchTab(tab.id)}
                />
              ))}
              {spaceTabs.length === 0 && (
                <p className="sp-empty muted">这个空间还没有打开的标签</p>
              )}
            </div>
          </>
        )}
      </div>

      <footer className="sp-footer">
        <Button
          variant="ghost"
          onClick={() =>
            void request({ type: "execute", id: "command:settings" })
          }
        >
          设置与迁移
        </Button>
      </footer>
    </div>
  );
}
