import { useEffect, useMemo } from "react";
import { settingsOf } from "./model.ts";
import { usePaletteSearch } from "./ui/command.ts";
import { letterOf, pinnedEntries, shortHost } from "./ui/hooks.ts";
import { Kbd, Notice, ResultRow, SpaceStrip } from "./ui/primitives.tsx";
import { ArchiveIcon, GlobeIcon, SearchIcon, SplitIcon, TabIcon } from "./ui/icons.tsx";
import type { ArchiveEntry, Item, LiveTab } from "./types.ts";

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function EntryCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const host = shortHost(item.url);
  return (
    <button className="entry-card" onClick={onOpen} title={item.title}>
      <span className="entry-mark" aria-hidden="true">
        {item.kind === "split" ? <SplitIcon size={18} /> : letterOf(item.url, item.title)}
      </span>
      <span className="entry-copy">
        <span className="entry-title">{item.title}</span>
        <span className="entry-host">
          {item.kind === "split" ? `分屏 · ${item.children.length} 页` : host || "链接"}
        </span>
      </span>
    </button>
  );
}

function TabRow({ tab, onOpen }: { tab: LiveTab; onOpen: () => void }) {
  const host = shortHost(tab.url);
  return (
    <button className="newtab-list-row" onClick={onOpen} title={tab.title}>
      <TabIcon size={16} className="row-icon" />
      <span className="row-title">{tab.title || host || "新标签页"}</span>
      <span className="row-meta">{host}</span>
    </button>
  );
}

function ArchiveRow({ entry, onRestore }: { entry: ArchiveEntry; onRestore: () => void }) {
  const host = shortHost(entry.url);
  const ago = formatAge(entry.archivedAt);
  return (
    <button className="newtab-list-row" onClick={onRestore} title={`恢复：${entry.title}`}>
      <ArchiveIcon size={16} className="row-icon" />
      <span className="row-title">{entry.title || host}</span>
      <span className="row-meta">{ago}</span>
    </button>
  );
}

function formatAge(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function NewTab({ onClose }: { onClose: () => void }) {
  const {
    snapshot,
    error,
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
  } = usePaletteSearch(onClose);

  // Chrome newtab has a focus race; multi-frame rAF grabs more reliably than setTimeout.
  useEffect(() => {
    if (!snapshot || settingsOf(snapshot.state).newtabFocus !== "palette") return;
    const grab = () => input.current?.focus();
    grab();
    requestAnimationFrame(() => {
      grab();
      requestAnimationFrame(grab);
    });
  }, [snapshot]);

  const spaceName = useMemo(() => {
    if (!snapshot) return "";
    return snapshot.state.spaces.find((s) => s.id === activeSpace)?.name ?? "";
  }, [snapshot, activeSpace]);
  const entries = snapshot ? pinnedEntries(snapshot, activeSpace) : [];
  const spaceTabs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.tabs
      .filter((t) => t.spaceId === activeSpace && !t.pinned)
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  }, [snapshot, activeSpace]);
  const recentArchives = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.state.archives
      .filter((a) => a.spaceId === activeSpace)
      .sort((a, b) => b.archivedAt - a.archivedAt)
      .slice(0, 8);
  }, [snapshot, activeSpace]);
  const searching = query.trim().length > 0;

  return (
    <main className="arc-app newtab-home" aria-label="Arc Plugin 新标签页" onKeyDown={onInputKeyDown}>
      <div className="newtab-inner">
        <header className="newtab-head">
          <p className="newtab-eyebrow">
            {snapshot?.demo ? "演示预览" : "Arc Plugin"}
            {spaceName && !snapshot?.demo && (
              <>
                {" · "}
                <span>{spaceName}</span>
              </>
            )}
          </p>
          <h1 className="newtab-greeting">
            {greeting()}
            {spaceName ? `，${spaceName}` : ""}
          </h1>
        </header>

        <div className="newtab-search">
          <SearchIcon className="search-icon" size={24} />
          <input
            ref={input}
            className="search-input"
            aria-label="搜索网址、标签、收藏或命令"
            placeholder="搜索，或输入网址前往"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="arc-results"
            aria-activedescendant={results[selected] ? `result-${selected}` : undefined}
          />
        </div>

        {snapshot && (
          <SpaceStrip
            spaces={snapshot.state.spaces}
            activeSpace={activeSpace}
            onPick={(space) =>
              void run({
                id: `space:${space.id}`,
                kind: "space",
                title: space.name,
                subtitle: "切换空间",
                score: 0,
              })
            }
          />
        )}

        {error && <Notice tone="error">{error}</Notice>}
        {!snapshot && !error && (
          <div className="loading" role="status">
            {"正在读取工作区…"}
          </div>
        )}

        {searching ? (
          <div
            id="arc-results"
            ref={resultList}
            className="results scroll newtab-results"
            role="listbox"
            aria-label="搜索结果"
            aria-busy={busy}
          >
            {results.map((result, index) => (
              <ResultRow
                key={result.id}
                result={result}
                index={index}
                selected={index === selected}
                busy={busy}
                onSelect={() => setSelected(index)}
                onRun={(event) =>
                  void run(
                    result,
                    event.metaKey || event.ctrlKey
                      ? "little-arc"
                      : event.altKey
                        ? "peek"
                        : undefined,
                  )
                }
              />
            ))}
          </div>
        ) : snapshot ? (
          <div className="newtab-dashboard">
            {entries.length > 0 && (
              <section className="newtab-grid-wrap" aria-label="固定入口">
                <p className="newtab-section-label">{"固定入口"}</p>
                <div className="entry-grid">
                  {entries.map((item) => (
                    <EntryCard
                      key={item.id}
                      item={item}
                      onOpen={() =>
                        void run({
                          id: `item:${item.id}`,
                          kind: "item",
                          title: item.title,
                          subtitle: "",
                          url: item.url,
                          score: 0,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {spaceTabs.length > 0 && (
              <section className="newtab-list-section" aria-label="打开的标签">
                <p className="newtab-section-label">
                  {"打开的标签"}
                  <span className="section-count">{spaceTabs.length}</span>
                </p>
                <div className="newtab-list">
                  {spaceTabs.map((tab) => (
                    <TabRow
                      key={tab.id}
                      tab={tab}
                      onOpen={() =>
                        void run({
                          id: `tab:${tab.id}`,
                          kind: "tab",
                          title: tab.title,
                          subtitle: shortHost(tab.url),
                          url: tab.url,
                          score: 0,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {recentArchives.length > 0 && (
              <section className="newtab-list-section" aria-label="最近归档">
                <p className="newtab-section-label">
                  {"最近归档"}
                  <span className="section-count">{recentArchives.length}</span>
                </p>
                <div className="newtab-list">
                  {recentArchives.map((entry) => (
                    <ArchiveRow
                      key={entry.id}
                      entry={entry}
                      onRestore={() =>
                        void run({
                          id: `archive:${entry.id}`,
                          kind: "item",
                          title: entry.title,
                          subtitle: "",
                          url: entry.url,
                          score: 0,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {entries.length === 0 && spaceTabs.length === 0 && recentArchives.length === 0 && (
              <section className="newtab-empty">
                <GlobeIcon size={30} />
                <h3>{"这个空间还很干净"}</h3>
                <p className="muted">
                  {"直接在上面搜索，或从设置页导入 Arc 目录，把常用页面固定到这里"}
                </p>
                <button
                  className="link-btn"
                  onClick={() =>
                    void run({
                      id: "command:settings",
                      kind: "command",
                      title: "设置",
                      subtitle: "",
                      score: 0,
                    })
                  }
                >
                  {"打开设置与迁移"}
                </button>
              </section>
            )}
          </div>
        ) : null}

        <footer className="newtab-footer">
          <span className="footer-hints">
            <Kbd>{"↑"}</Kbd>
            <Kbd>{"↓"}</Kbd>
            <span>{"选择"}</span>
            <Kbd>{"↵"}</Kbd>
            <span>{"打开"}</span>
            <Kbd>{"⌘↵"}</Kbd>
            <span>{"小窗"}</span>
            <Kbd>{"⌥↵"}</Kbd>
            <span>{"预览"}</span>
          </span>
          <button
            className="link-btn"
            onClick={() =>
              void run({
                id: "command:settings",
                kind: "command",
                title: "设置",
                subtitle: "",
                score: 0,
              })
            }
          >
            {"设置与迁移"}
          </button>
        </footer>
      </div>
    </main>
  );
}
