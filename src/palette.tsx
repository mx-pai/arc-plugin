import { request } from "./client.ts";
import { usePaletteSearch } from "./ui/command.ts";
import {
  Brand,
  IconButton,
  Kbd,
  Notice,
  ResultRow,
  SpaceStrip,
} from "./ui/primitives.tsx";
import { CloseIcon, SearchIcon } from "./ui/icons.tsx";

type Mode = "popup" | "overlay";

// 工具栏弹窗与网页注入浮层共用；居中命令面板。新标签主页见 newtab.tsx。
export function CommandPalette({
  mode,
  onClose,
}: {
  mode: Mode;
  onClose: () => void;
}) {
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
  } = usePaletteSearch(onClose, true);

  return (
    <main
      className={`arc-app palette palette-${mode}`}
      aria-label="Arc Plugin 搜索"
      onKeyDown={onInputKeyDown}
    >
      <div className="palette-head">
        <Brand />
        <span>Arc Plugin</span>
        <span className="head-note">
          {snapshot?.demo ? "演示预览" : "你的浏览工作区"}
        </span>
        {mode === "overlay" && (
          <IconButton onClick={onClose} aria-label="关闭搜索">
            <CloseIcon size={18} />
          </IconButton>
        )}
      </div>
      <div className="search-wrap">
        <SearchIcon className="search-icon" size={22} />
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
          aria-activedescendant={results[selected] ? `result-${selected}` : undefined}
        />
        <Kbd>esc</Kbd>
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
          正在读取工作区…
        </div>
      )}
      <div
        id="arc-results"
        ref={resultList}
        className="results scroll"
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
      <footer className="palette-footer">
        <span className="footer-hints">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span>选择</span>
          <Kbd>↵</Kbd>
          <span>打开</span>
          <Kbd>⌘↵</Kbd>
          <span>小窗</span>
          <Kbd>⌥↵</Kbd>
          <span>预览</span>
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
          设置与迁移
        </button>
      </footer>
    </main>
  );
}
