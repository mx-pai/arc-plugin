import { useCallback, useEffect, useRef, useState } from "react";
import { isExtension, request } from "./client.ts";
import { documentOf, validateBackup } from "./model.ts";
import { search } from "./search.ts";
import type { ImportPreview, Item, SearchResult, Snapshot } from "./types.ts";

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const s = await request<Snapshot>({ type: "snapshot" });
      setSnapshot(s);
      setError("");
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (!isExtension) return;
    const listener = (_c: unknown, area: string) => {
      if (area === "local") void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);
  return { snapshot, error, setError, refresh };
}
const shortHost = (url?: string) => {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
function Mark({ result }: { result: SearchResult }) {
  return (
    <span className={`result-mark mark-${result.kind}`} aria-hidden="true">
      {result.kind === "space"
        ? "◉"
        : result.kind === "command"
          ? "⌘"
          : result.kind === "search"
            ? "⌕"
            : (shortHost(result.url) || result.title).slice(0, 1).toUpperCase()}
    </span>
  );
}
export function CommandPalette({
  mode,
  onClose,
}: {
  mode: "popup" | "newtab" | "overlay";
  onClose: () => void;
}) {
  const { snapshot, error, setError, refresh } = useSnapshot();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const results = snapshot ? search(snapshot, query) : [];
  useEffect(() => {
    if (mode !== "newtab") input.current?.focus();
  }, [mode]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    resultList.current
      ?.querySelector<HTMLElement>(`#result-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);
  const run = async (result: SearchResult) => {
    if (busy || !snapshot) return;
    setBusy(true);
    setError("");
    try {
      await request({
        type: "execute",
        id: result.id,
        query,
        originTabId: snapshot.originTabId,
      });
      if (result.kind === "command" && result.id !== "command:settings") {
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
  return (
    <main
      className={`arc-app palette palette-${mode}`}
      aria-label="Arc Plugin 搜索"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.target === input.current && event.key === "ArrowDown") {
          event.preventDefault();
          setSelected((i) => Math.min(i + 1, results.length - 1));
        }
        if (event.target === input.current && event.key === "ArrowUp") {
          event.preventDefault();
          setSelected((i) => Math.max(0, i - 1));
        }
        if (
          event.target === input.current &&
          event.key === "Enter" &&
          results[selected]
        ) {
          event.preventDefault();
          void run(results[selected]);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="palette-head">
        <span className="brand-symbol" aria-hidden="true">
          a
        </span>
        <span>Arc Plugin</span>
        <span className="head-note">
          {snapshot?.demo ? "演示预览" : "你的浏览工作区"}
        </span>
        {mode === "overlay" && (
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭搜索"
          >
            ×
          </button>
        )}
      </div>
      <div className="search-wrap">
        <span aria-hidden="true">⌕</span>
        <input
          ref={input}
          className="search-input"
          aria-label="搜索网址、标签、收藏或命令"
          placeholder="搜索网址、标签、收藏或命令"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="arc-results"
          aria-activedescendant={
            results[selected] ? `result-${selected}` : undefined
          }
        />
        <kbd>{mode === "newtab" ? "⌘⇧K" : "esc"}</kbd>
      </div>
      <div className="space-strip" aria-label="空间">
        {snapshot?.state.spaces.map((space) => (
          <button
            key={space.id}
            className={`space-chip ${snapshot.runtime.windowSpaces[String(snapshot.windowId)] === space.id ? "is-active" : ""}`}
            onClick={() =>
              void run({
                id: `space:${space.id}`,
                kind: "space",
                title: space.name,
                subtitle: "切换空间",
                score: 0,
              })
            }
          >
            <span className={`space-dot color-${space.color}`} />
            {space.name}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!snapshot && !error && (
        <div className="loading" role="status">
          正在读取工作区
        </div>
      )}
      <div
        id="arc-results"
        ref={resultList}
        className="results"
        role="listbox"
        aria-label="搜索结果"
        aria-busy={busy}
      >
        {results.map((result, index) => (
          <button
            id={`result-${index}`}
            key={result.id}
            className={`result-row ${index === selected ? "is-selected" : ""}`}
            role="option"
            aria-selected={index === selected}
            onMouseMove={() => setSelected(index)}
            onClick={() => void run(result)}
            disabled={busy}
          >
            <Mark result={result} />
            <span className="result-copy">
              <span className="result-title">{result.title}</span>
              <span className="result-subtitle">
                {result.subtitle}
                {result.url && ` · ${shortHost(result.url)}`}
              </span>
            </span>
            <span className="result-action">
              {result.kind === "tab"
                ? "切换"
                : result.kind === "space"
                  ? "进入"
                  : result.kind === "command"
                    ? "执行"
                    : "打开"}
            </span>
          </button>
        ))}
      </div>
      <footer className="palette-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择 <kbd>↵</kbd> 打开
        </span>
        <button
          className="text-button"
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
          设置与迁移
        </button>
      </footer>
    </main>
  );
}

function ItemTree({
  items,
  parentId,
  spaceId,
  open,
  onRemove,
}: {
  items: Item[];
  parentId: string | null;
  spaceId: string | null;
  open: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const roots = parentId
    ? (items
        .find((i) => i.id === parentId)
        ?.children.map((id) => items.find((i) => i.id === id))
        .filter((i): i is Item => !!i) ?? [])
    : items.filter((i) => i.parentId === null && i.spaceId === spaceId);
  return (
    <div className="item-tree">
      {roots.map((item) =>
        item.kind === "link" ? (
          <div key={item.id} className="saved-row">
            <button onClick={() => open(item.id)}>
              <span className="tiny-mark">
                {shortHost(item.url).slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {shortHost(item.url)}
                  {item.scope === "temporary" ? " · 待打开" : ""}
                </small>
              </span>
            </button>
            <button
              className="row-remove"
              onClick={() => onRemove(item.id)}
              aria-label={`移除 ${item.title}`}
            >
              ×
            </button>
          </div>
        ) : (
          <details key={item.id}>
            <summary>
              {item.title}
              <span className="muted">
                {item.kind === "split"
                  ? "分屏组合"
                  : `${item.children.length} 项`}
              </span>
            </summary>
            <ItemTree
              items={items}
              parentId={item.id}
              spaceId={spaceId}
              open={open}
              onRemove={onRemove}
            />
          </details>
        ),
      )}
    </div>
  );
}
function saveFile(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Settings() {
  const { snapshot, error, setError, refresh } = useSnapshot();
  const [view, setView] = useState<"spaces" | "import" | "keys">("spaces");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview>();
  const [restoreText, setRestoreText] = useState("");
  const [keys, setKeys] = useState<chrome.commands.Command[]>([]);
  const [spaceId, setSpaceId] = useState("");
  useEffect(() => {
    if (isExtension) void chrome.commands.getAll().then(setKeys);
  }, []);
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      await refresh();
      setStatus(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const selectedSpace =
    snapshot?.state.spaces.find((s) => s.id === spaceId) ??
    snapshot?.state.spaces[0];
  const importFile = async (file?: File) => {
    setError("");
    setPreview(undefined);
    setText("");
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("文件超过 10 MB，请选择侧栏 JSON 文件");
      return;
    }
    try {
      const value = await file.text();
      const p = await request<ImportPreview>({
        type: "preview-import",
        text: value,
      });
      setText(value);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const chooseRestore = async (file?: File) => {
    if (!file) return;
    try {
      const value = await file.text();
      validateBackup(value);
      setRestoreText(value);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="arc-app settings-app">
      <aside className="settings-nav">
        <div className="settings-brand">
          <span className="brand-symbol">a</span>
          <strong>Arc Plugin</strong>
        </div>
        <p className="nav-caption">让熟悉的习惯留下来</p>
        <nav aria-label="设置导航">
          {(
            [
              ["spaces", "空间与收藏"],
              ["import", "迁移与备份"],
              ["keys", "快捷键与能力"],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              className={view === id ? "is-active" : ""}
              onClick={() => setView(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <span className="nav-bottom">
          {snapshot?.demo ? "当前为演示预览" : "数据保存在这台设备上"}
        </span>
      </aside>
      <main className="settings-content">
        <header>
          <span className="eyebrow">
            {snapshot?.demo ? "演示预览 · " : ""}Arc Plugin
          </span>
          <h1>
            {view === "spaces"
              ? "每个空间，都有自己的节奏"
              : view === "import"
                ? "把你的 Arc 带过来"
                : "顺手，才是常用的理由"}
          </h1>
          <p className="intro">
            {view === "spaces"
              ? "页面继续交给 Chrome，空间、固定入口和目录留在这里"
              : view === "import"
                ? "先检查层级与数量，再把空间和链接保存到 Chrome"
                : "统一搜索、空间切换和收藏操作，沿用你熟悉的键盘习惯"}
          </p>
        </header>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        {status && (
          <div className="notice notice-success" role="status">
            {status}
          </div>
        )}
        {!snapshot && !error && <p role="status">正在读取本地数据</p>}
        {snapshot && view === "spaces" && (
          <>
            <div className="section-heading">
              <h2>空间</h2>
              <span>{snapshot.state.spaces.length} 个空间</span>
            </div>
            <div className="workspace-tabs">
              {snapshot.state.spaces.map((s) => (
                <button
                  key={s.id}
                  className={selectedSpace?.id === s.id ? "is-active" : ""}
                  onClick={() => setSpaceId(s.id)}
                >
                  <span className={`space-dot color-${s.color}`} />
                  {s.name}
                </button>
              ))}
            </div>
            {selectedSpace && (
              <section className="workspace-detail">
                <div className="workspace-toolbar">
                  <input
                    key={selectedSpace.id + selectedSpace.name}
                    aria-label="空间名称"
                    defaultValue={selectedSpace.name}
                    maxLength={100}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== selectedSpace.name)
                        void act(
                          () =>
                            request({
                              type: "rename-space",
                              id: selectedSpace.id,
                              name: value,
                            }),
                          "空间名称已更新",
                        );
                    }}
                  />
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          request({
                            type: "execute",
                            id: `space:${selectedSpace.id}`,
                          }),
                        "已切换空间",
                      )
                    }
                  >
                    进入空间
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          request({
                            type: "adopt-group",
                            spaceId: selectedSpace.id,
                          }),
                        "当前分组已接入这个空间",
                      )
                    }
                  >
                    接入当前分组
                  </button>
                </div>
                <ItemTree
                  items={snapshot.state.items}
                  parentId={null}
                  spaceId={selectedSpace.id}
                  open={(id) =>
                    void act(
                      () => request({ type: "execute", id: `item:${id}` }),
                      "页面已打开",
                    )
                  }
                  onRemove={(id) =>
                    void act(
                      () => request({ type: "remove-item", id }),
                      "固定入口已移除",
                    )
                  }
                />
                {!snapshot.state.items.some(
                  (i) => i.spaceId === selectedSpace.id,
                ) && (
                  <div className="guidance">
                    <h3>把常用页面留在这个空间</h3>
                    <p>
                      在网页中使用插件的“固定当前页面”，或从迁移页导入 Arc 目录
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setView("import")}
                    >
                      导入 Arc 数据
                    </button>
                  </div>
                )}
              </section>
            )}
            {snapshot.state.items.some((i) => i.spaceId === null) && (
              <section>
                <h2>跨空间收藏</h2>
                <ItemTree
                  items={snapshot.state.items}
                  parentId={null}
                  spaceId={null}
                  open={(id) =>
                    void act(
                      () => request({ type: "execute", id: `item:${id}` }),
                      "页面已打开",
                    )
                  }
                  onRemove={(id) =>
                    void act(
                      () => request({ type: "remove-item", id }),
                      "固定入口已移除",
                    )
                  }
                />
              </section>
            )}
            <section className="archive-section">
              <div className="section-heading">
                <h2>归档</h2>
                <span>{snapshot.state.archives.length} 个页面</span>
              </div>
              {snapshot.state.archives.length ? (
                snapshot.state.archives.map((a) => (
                  <div className="archive-row" key={a.id}>
                    <span>
                      <strong>{a.title}</strong>
                      <small>
                        {shortHost(a.url)} ·{" "}
                        {new Date(a.archivedAt).toLocaleString("zh-CN")}
                      </small>
                    </span>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            request({ type: "execute", id: `archive:${a.id}` }),
                          "页面已恢复",
                        )
                      }
                    >
                      恢复
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  归档后的页面会保留网址和空间归属，可在这里恢复
                </p>
              )}
            </section>
          </>
        )}
        {snapshot && view === "import" && (
          <>
            <section className="import-section">
              <h2>从 Arc 导入</h2>
              <p>选择本机的 StorableSidebar.json，文件内容在本机解析</p>
              <label className="file-picker">
                <span>选择 Arc 侧栏文件</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  aria-label="选择 Arc 侧栏文件"
                  disabled={busy}
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </label>
              <p className="file-location">
                macOS 路径：~/Library/Application
                Support/Arc/StorableSidebar.json
              </p>
              {preview && (
                <div className="import-preview">
                  <h3>导入预览</h3>
                  <div className="preview-numbers">
                    <span>
                      <strong>{preview.spaces.length}</strong>空间
                    </span>
                    <span>
                      <strong>{preview.counts.links}</strong>链接
                    </span>
                    <span>
                      <strong>{preview.counts.folders}</strong>文件夹
                    </span>
                    <span>
                      <strong>{preview.counts.splits}</strong>分屏组合
                    </span>
                  </div>
                  <div className="preview-spaces">
                    {preview.spaces.map((s) => (
                      <span key={s.id}>{s.name}</span>
                    ))}
                  </div>
                  <p>
                    目录与独立入口会保留，链接在点击后打开，导入前保存恢复快照
                  </p>
                  {preview.diagnostics.length > 0 && (
                    <details>
                      <summary>
                        查看解析提示（{preview.diagnostics.length}）
                      </summary>
                      <ul>
                        {preview.diagnostics.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => request({ type: "import", text }),
                        `导入完成，已处理 ${preview.counts.links} 条链接`,
                      )
                    }
                  >
                    {busy ? "正在导入…" : "确认导入"}
                  </button>
                </div>
              )}
            </section>
            <section className="backup-section">
              <h2>备份与恢复</h2>
              <p>备份包含空间、目录、固定入口和归档，可用于换机或恢复</p>
              <div className="button-row">
                <button
                  className="button"
                  onClick={() =>
                    saveFile(
                      `arc-plugin-backup-${new Date().toISOString().slice(0, 10)}.json`,
                      documentOf(snapshot.state),
                    )
                  }
                >
                  导出 JSON 备份
                </button>
                <label className="button file-button">
                  选择备份文件
                  <input
                    type="file"
                    accept=".json,application/json"
                    aria-label="选择备份文件"
                    onChange={(e) => void chooseRestore(e.target.files?.[0])}
                  />
                </label>
                {snapshot.state.undo && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => request({ type: "undo-import" }),
                        "已恢复到导入前的状态",
                      )
                    }
                  >
                    撤销最近导入
                  </button>
                )}
              </div>
              {restoreText && (
                <div className="restore-review">
                  <p>
                    恢复会替换当前扩展目录并生成对应书签，当前状态会保留为可撤销快照
                  </p>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await request({ type: "restore", text: restoreText });
                        setRestoreText("");
                      }, "备份已恢复")
                    }
                  >
                    确认恢复备份
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        {view === "keys" && (
          <>
            <section>
              <h2>键盘入口</h2>
              <dl className="key-list">
                <div>
                  <dt>Arc 风格新标签页</dt>
                  <dd>
                    <kbd>⌘T</kbd>
                  </dd>
                </div>
                <div>
                  <dt>居中命令面板</dt>
                  <dd>
                    <kbd>
                      {keys.find((k) => k.name === "open-palette")?.shortcut ||
                        "⌘⇧K"}
                    </kbd>
                  </dd>
                </div>
                <div>
                  <dt>固定当前页面</dt>
                  <dd>
                    <kbd>
                      {keys.find((k) => k.name === "pin-current")?.shortcut ||
                        "⌥⇧P"}
                    </kbd>
                  </dd>
                </div>
                <div>
                  <dt>切换上一个 / 下一个空间</dt>
                  <dd>
                    <kbd>⌥⇧← / →</kbd>
                  </dd>
                </div>
                <div>
                  <dt>地址栏搜索</dt>
                  <dd>
                    <kbd>arc</kbd> + 空格或 Tab
                  </dd>
                </div>
              </dl>
              <button
                className="button"
                onClick={() => {
                  if (isExtension)
                    void chrome.tabs.create({
                      url: "chrome://extensions/shortcuts",
                    });
                  else setStatus("在 Chrome 扩展中打开快捷键设置");
                }}
              >
                配置快捷键
              </button>
            </section>
            <section>
              <h2>⌘T 的当前边界</h2>
              <p>
                ⌘T 打开这个扩展的新标签页，Chrome
                会优先聚焦原生地址栏，居中面板可通过单独的快捷键唤起
              </p>
              <p>
                普通网页支持命令面板，Chrome
                系统页和扩展商店等受限页面使用工具栏弹窗
              </p>
              <p>
                原生按键与焦点表现需要在你的 Chrome
                中实测，当前版本保留浏览器的保留快捷键规则
              </p>
            </section>
            <section>
              <h2>能力范围</h2>
              <p>
                当前提供空间、统一搜索、固定入口、手动归档、导入预览、备份和原生双页分屏入口
              </p>
              <p>
                三页、四页分屏保留组合目录，可从目录逐项打开，自动归档、完整书签双向编辑和桌面辅助能力安排在后续版本
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
