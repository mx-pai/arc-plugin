import { useEffect, useState } from "react";
import { isExtension, request } from "./client.ts";
import { documentOf, settingsOf, validateBackup } from "./model.ts";
import { shortHost, useSnapshot } from "./ui/hooks.ts";
import {
  Button,
  KindBadge,
  Notice,
  SpaceDot,
} from "./ui/primitives.tsx";
import {
  ArchiveIcon,
  CaretIcon,
  CloseIcon,
  ImportIcon,
  KeyboardIcon,
  LayersIcon,
  RouteIcon,
} from "./ui/icons.tsx";
import { SPACE_COLORS } from "./types.ts";
import type {
  ImportPreview,
  Item,
  Settings as SettingsData,
  Snapshot,
} from "./types.ts";

type View = "spaces" | "import" | "archive" | "routing" | "keys";

// 子视图共享的控制器：快照、设置、忙碌态与两个写入助手。
interface Ctx {
  snapshot: Snapshot;
  settings: SettingsData;
  busy: boolean;
  act: (fn: () => Promise<unknown>, success: string) => Promise<void>;
  updateSettings: (next: SettingsData) => Promise<void>;
  setError: (s: string) => void;
  setStatus: (s: string) => void;
  refresh: () => Promise<Snapshot | undefined>;
  goTo: (view: View) => void;
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

function ItemTree({
  items,
  parentId,
  spaceId,
  open,
  onRemove,
  onRepair,
}: {
  items: Item[];
  parentId: string | null;
  spaceId: string | null;
  open: (id: string) => void;
  onRemove: (id: string) => void;
  onRepair?: (id: string) => void;
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
        item.kind === "split" ? (
          <div key={item.id} className="item-group">
            <div className="saved-row">
              <button className="saved-open" onClick={() => open(item.id)}>
                <KindBadge kind="split" />
                <span>
                  <strong>{item.title}</strong>
                  <small>分屏组合 · {item.children.length} 页</small>
                </span>
              </button>
            </div>
            <details>
              <summary>
                <CaretIcon className="caret" />
                子页面
                <span className="count">{item.children.length} 项</span>
              </summary>
              <ItemTree
                items={items}
                parentId={item.id}
                spaceId={spaceId}
                open={open}
                onRemove={onRemove}
                onRepair={onRepair}
              />
            </details>
          </div>
        ) : item.kind === "link" ? (
          <div key={item.id} className="saved-row">
            <button className="saved-open" onClick={() => open(item.id)}>
              <KindBadge kind="link" />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {shortHost(item.url)}
                  {item.scope === "temporary" ? " · 待打开" : ""}
                  {item.missing ? " · 书签已失联" : ""}
                </small>
              </span>
            </button>
            {item.missing && onRepair && (
              <button
                className="link-btn"
                onClick={() => onRepair(item.id)}
                aria-label={`重新创建 ${item.title} 的书签`}
              >
                修复
              </button>
            )}
            <button
              className="row-remove"
              onClick={() => onRemove(item.id)}
              aria-label={`移除 ${item.title}`}
            >
              <CloseIcon size={15} />
            </button>
          </div>
        ) : (
          <details key={item.id}>
            <summary>
              <CaretIcon className="caret" />
              {item.title}
              <span className="count">{item.children.length} 项</span>
            </summary>
            <ItemTree
              items={items}
              parentId={item.id}
              spaceId={spaceId}
              open={open}
              onRemove={onRemove}
              onRepair={onRepair}
            />
          </details>
        ),
      )}
    </div>
  );
}

function SpacesView({ ctx }: { ctx: Ctx }) {
  const { snapshot, act, busy, goTo } = ctx;
  const [spaceId, setSpaceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<import("./types.ts").SpaceColor>("purple");
  const COLORS = SPACE_COLORS;
  const selectedSpace =
    snapshot.state.spaces.find((s) => s.id === spaceId) ??
    snapshot.state.spaces[0];
  const openItem = (id: string) =>
    void act(() => request({ type: "execute", id: `item:${id}` }), "页面已打开");
  const removeItem = (id: string) =>
    void act(() => request({ type: "remove-item", id }), "固定入口已移除");
  const repairItem = (id: string) =>
    void act(() => request({ type: "repair-item", id }), "书签已重新创建");
  const createSpace = () => {
    const name = newName.trim();
    if (!name) return;
    void act(
      () => request({ type: "create-space", name, color: newColor }),
      `空间"${name}"已创建`,
    ).then(() => {
      setNewName("");
      setCreating(false);
    });
  };
  const deleteSpace = (id: string, name: string) => {
    if (!confirm(`确定删除空间"${name}"？空间中的固定入口和归档都会被移除。`)) return;
    void act(
      () => request({ type: "delete-space", id }),
      `空间"${name}"已删除`,
    ).then(() => setSpaceId(""));
  };
  return (
    <>
      <section className="panel">
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
              <SpaceDot color={s.color} />
              {s.name}
            </button>
          ))}
          <button
            className={creating ? "is-active" : ""}
            onClick={() => setCreating(!creating)}
            aria-label="新建空间"
          >
            +
          </button>
        </div>
        {creating && (
          <div className="create-space-form">
            <input
              className="field-input"
              placeholder="空间名称"
              value={newName}
              maxLength={100}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSpace();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch color-${c} ${newColor === c ? "is-active" : ""}`}
                  onClick={() => setNewColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
            <div className="btn-row">
              <Button variant="primary" disabled={busy || !newName.trim()} onClick={createSpace}>
                创建空间
              </Button>
              <Button onClick={() => setCreating(false)}>取消</Button>
            </div>
          </div>
        )}
        {selectedSpace && (
          <div className="workspace-detail">
            <div className="workspace-toolbar">
              <input
                className="space-name-input"
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
              <div className="color-picker">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch color-${c} ${selectedSpace.color === c ? "is-active" : ""}`}
                    onClick={() =>
                      void act(
                        () => request({ type: "set-space-color", id: selectedSpace.id, color: c }),
                        "颜色已更新",
                      )
                    }
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            <div className="btn-row" style={{ marginBottom: 14 }}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => request({ type: "execute", id: `space:${selectedSpace.id}` }),
                    "已切换空间",
                  )
                }
              >
                进入空间
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => request({ type: "adopt-group", spaceId: selectedSpace.id }),
                    "当前分组已接入这个空间",
                  )
                }
              >
                接入当前分组
              </Button>
              {snapshot.state.spaces.length > 1 && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => deleteSpace(selectedSpace.id, selectedSpace.name)}
                >
                  删除空间
                </Button>
              )}
            </div>
            <ItemTree
              items={snapshot.state.items}
              parentId={null}
              spaceId={selectedSpace.id}
              open={openItem}
              onRemove={removeItem}
              onRepair={repairItem}
            />
            {!snapshot.state.items.some((i) => i.spaceId === selectedSpace.id) && (
              <div className="guidance">
                <h3>把常用页面留在这个空间</h3>
                <p className="muted">
                  在网页中使用插件的“固定当前页面”，或从迁移页导入 Arc 目录
                </p>
                <button className="link-btn" onClick={() => goTo("import")}>
                  导入 Arc 数据
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      {snapshot.state.items.some((i) => i.spaceId === null) && (
        <section className="panel">
          <h2>跨空间收藏</h2>
          <ItemTree
            items={snapshot.state.items}
            parentId={null}
            spaceId={null}
            open={openItem}
            onRemove={removeItem}
            onRepair={repairItem}
          />
        </section>
      )}
      <section className="panel">
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
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => request({ type: "execute", id: `archive:${a.id}` }),
                    "页面已恢复",
                  )
                }
              >
                恢复
              </Button>
            </div>
          ))
        ) : (
          <p className="muted">归档后的页面会保留网址和空间归属，可在这里恢复</p>
        )}
      </section>
    </>
  );
}

function ImportView({ ctx }: { ctx: Ctx }) {
  const { snapshot, act, busy, setError } = ctx;
  const [preview, setPreview] = useState<ImportPreview>();
  const [text, setText] = useState("");
  const [restoreText, setRestoreText] = useState("");

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
      const p = await request<ImportPreview>({ type: "preview-import", text: value });
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
    <>
      <section className="panel">
        <h2>从 Arc 导入</h2>
        <p className="muted">选择本机的 StorableSidebar.json，文件内容在本机解析</p>
        <label className="file-picker">
          <ImportIcon size={24} />
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
          macOS 路径：~/Library/Application Support/Arc/StorableSidebar.json
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
            <p>目录与独立入口会保留，链接在点击后打开，导入前保存恢复快照</p>
            {preview.diagnostics.length > 0 && (
              <details>
                <summary>查看解析提示（{preview.diagnostics.length}）</summary>
                <ul>
                  {preview.diagnostics.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => request({ type: "import", text }),
                  `导入完成，已处理 ${preview.counts.links} 条链接`,
                )
              }
            >
              {busy ? "正在导入…" : "确认导入"}
            </Button>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>备份与恢复</h2>
        <p className="muted">备份包含空间、目录、固定入口和归档，可用于换机或恢复</p>
        <div className="btn-row">
          <Button
            onClick={() =>
              saveFile(
                `arc-plugin-backup-${new Date().toISOString().slice(0, 10)}.json`,
                documentOf(snapshot.state),
              )
            }
          >
            导出 JSON 备份
          </Button>
          <label className="btn file-button">
            选择备份文件
            <input
              type="file"
              accept=".json,application/json"
              aria-label="选择备份文件"
              onChange={(e) => void chooseRestore(e.target.files?.[0])}
            />
          </label>
          {snapshot.state.undo && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() => request({ type: "undo-import" }), "已恢复到导入前的状态")
              }
            >
              撤销最近导入
            </Button>
          )}
        </div>
        {restoreText && (
          <div className="restore-review">
            <p>恢复会替换当前扩展目录并生成对应书签，当前状态会保留为可撤销快照</p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request({ type: "restore", text: restoreText });
                  setRestoreText("");
                }, "备份已恢复")
              }
            >
              确认恢复备份
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

type Candidate = {
  tabId: number;
  title: string;
  url: string;
  spaceId: string;
  idleMs: number;
};

function ArchiveView({ ctx }: { ctx: Ctx }) {
  const { snapshot, settings, busy, updateSettings, setError, setStatus, refresh } =
    ctx;
  const [archiveDays, setArchiveDays] = useState(String(settings.autoArchive.afterDays));
  const [archiveMax, setArchiveMax] = useState(String(settings.autoArchive.maxPerRun));
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  useEffect(() => {
    setArchiveDays(String(settings.autoArchive.afterDays));
    setArchiveMax(String(settings.autoArchive.maxPerRun));
  }, [settings.autoArchive.afterDays, settings.autoArchive.maxPerRun]);

  const runAutoArchive = async () => {
    setError("");
    setStatus("");
    try {
      const result = await request<{ archived: number; failed: number }>({
        type: "run-auto-archive",
      });
      await refresh();
      setStatus(
        `已归档 ${result.archived} 个页面${result.failed ? `，${result.failed} 个失败` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const previewAutoArchive = async () => {
    setError("");
    try {
      setCandidates(await request<Candidate[]>({ type: "auto-archive-preview" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="panel">
      <h2>自动归档</h2>
      <p className="muted">
        只处理托管空间中的页面；固定入口、当前页面、发声页面、分屏页面和每个窗口的最后一个页面不会被归档。
      </p>
      <label className="setting-row">
        <input
          type="checkbox"
          checked={settings.autoArchive.enabled}
          onChange={() =>
            void updateSettings({
              ...settings,
              autoArchive: {
                ...settings.autoArchive,
                enabled: !settings.autoArchive.enabled,
              },
            })
          }
        />
        启用自动归档（每小时检查一次）
      </label>
      <div className="setting-fields">
        <label>
          闲置天数
          <input
            type="number"
            min={0}
            max={365}
            value={archiveDays}
            onChange={(e) => setArchiveDays(e.target.value)}
            onBlur={() =>
              void updateSettings({
                ...settings,
                autoArchive: { ...settings.autoArchive, afterDays: Number(archiveDays) },
              })
            }
          />
        </label>
        <label>
          每次最多
          <input
            type="number"
            min={1}
            max={100}
            value={archiveMax}
            onChange={(e) => setArchiveMax(e.target.value)}
            onBlur={() =>
              void updateSettings({
                ...settings,
                autoArchive: { ...settings.autoArchive, maxPerRun: Number(archiveMax) },
              })
            }
          />
        </label>
        <label>
          归档范围
          <select
            value={settings.autoArchive.scope}
            onChange={(e) =>
              void updateSettings({
                ...settings,
                autoArchive: {
                  ...settings.autoArchive,
                  scope: e.target.value as "temporary" | "managed" | "spaces",
                },
              })
            }
          >
            <option value="temporary">仅待打开页面</option>
            <option value="managed">全部托管页面</option>
            <option value="spaces">指定空间</option>
          </select>
        </label>
      </div>
      {settings.autoArchive.scope === "spaces" && (
        <div className="workspace-tabs" style={{ marginTop: 16 }}>
          {snapshot.state.spaces.map((space) => {
            const selected = settings.autoArchive.spaceIds.includes(space.id);
            return (
              <button
                key={space.id}
                className={selected ? "is-active" : ""}
                onClick={() => {
                  const ids = selected
                    ? settings.autoArchive.spaceIds.filter((id) => id !== space.id)
                    : [...settings.autoArchive.spaceIds, space.id];
                  void updateSettings({
                    ...settings,
                    autoArchive: { ...settings.autoArchive, spaceIds: ids },
                  });
                }}
              >
                <SpaceDot color={space.color} />
                {space.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 18 }}>
        <Button disabled={busy} onClick={() => void previewAutoArchive()}>
          预览候选
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void runAutoArchive()}>
          立即运行一次
        </Button>
      </div>
      {candidates.length > 0 && (
        <div className="archive-preview">
          <h3>{candidates.length} 个候选页面</h3>
          {candidates.slice(0, 5).map((candidate) => (
            <div className="archive-row" key={candidate.tabId}>
              <span>
                <strong>{candidate.title}</strong>
                <small>
                  {shortHost(candidate.url)} · 闲置{" "}
                  {Math.floor(candidate.idleMs / 86400000)} 天
                </small>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RoutingView({ ctx }: { ctx: Ctx }) {
  const { snapshot, settings, busy, updateSettings } = ctx;
  const [rulePattern, setRulePattern] = useState("");
  const [ruleSpace, setRuleSpace] = useState("");
  const [ruleOpenIn, setRuleOpenIn] = useState<"current" | "little-arc">("current");
  return (
    <section className="panel">
      <h2>域名分流</h2>
      <p className="muted">
        只影响命令面板和地址栏中直接打开的网址；固定入口和搜索面板里切换空间的行为不受影响。
      </p>
      <div className="setting-fields" style={{ marginTop: 16 }}>
        <label>
          域名
          <input
            value={rulePattern}
            placeholder="example.com 或 *.example.com"
            onChange={(e) => setRulePattern(e.target.value)}
          />
        </label>
        <label>
          打开到
          <select value={ruleSpace} onChange={(e) => setRuleSpace(e.target.value)}>
            <option value="">当前空间</option>
            {snapshot.state.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          方式
          <select
            value={ruleOpenIn}
            onChange={(e) =>
              setRuleOpenIn(e.target.value === "little-arc" ? "little-arc" : "current")
            }
          >
            <option value="current">当前窗口</option>
            <option value="little-arc">以 Little Arc 小窗</option>
          </select>
        </label>
        <Button
          disabled={busy || !rulePattern.trim()}
          onClick={() => {
            void updateSettings({
              ...settings,
              routing: {
                rules: [
                  ...settings.routing.rules,
                  {
                    id: `rule:${Date.now()}`,
                    pattern: rulePattern,
                    spaceId: ruleSpace || null,
                    openIn: ruleOpenIn,
                  },
                ],
              },
            });
            setRulePattern("");
          }}
        >
          添加规则
        </Button>
      </div>
      {settings.routing.rules.length ? (
        settings.routing.rules.map((rule) => (
          <div className="archive-row" key={rule.id}>
            <span>
              <strong>{rule.pattern}</strong>
              <small>
                {rule.spaceId
                  ? (snapshot.state.spaces.find((space) => space.id === rule.spaceId)
                      ?.name ?? "未知空间")
                  : "当前空间"}
                {" · "}
                {rule.openIn === "little-arc" ? "Little Arc 小窗" : "当前窗口"}
              </small>
            </span>
            <Button
              disabled={busy}
              onClick={() =>
                void updateSettings({
                  ...settings,
                  routing: {
                    rules: settings.routing.rules.filter((item) => item.id !== rule.id),
                  },
                })
              }
            >
              删除
            </Button>
          </div>
        ))
      ) : (
        <p className="muted">还没有规则。添加后，匹配的网址会按这里的方式打开。</p>
      )}
    </section>
  );
}

function KeysView({ ctx }: { ctx: Ctx }) {
  const { settings, updateSettings, setStatus } = ctx;
  const [keys, setKeys] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    if (isExtension) void chrome.commands.getAll().then(setKeys);
  }, []);
  const shortcutOf = (name: string, fallback: string) =>
    keys.find((k) => k.name === name)?.shortcut || fallback;
  return (
    <>
      <section className="panel">
        <h2>键盘入口</h2>
        <dl className="key-list">
          <div>
            <dt>Arc 风格新标签页</dt>
            <dd>
              <span className="kbd">⌘T</span>
            </dd>
          </div>
          <div>
            <dt>居中命令面板</dt>
            <dd>
              <span className="kbd">{shortcutOf("open-palette", "⌘⇧K")}</span>
            </dd>
          </div>
          <div>
            <dt>固定当前页面</dt>
            <dd>
              <span className="kbd">{shortcutOf("pin-current", "⌥⇧P")}</span>
            </dd>
          </div>
          <div>
            <dt>切换上一个 / 下一个空间</dt>
            <dd>
              <span className="kbd">⌥⇧←</span>
              <span className="kbd">→</span>
            </dd>
          </div>
          <div>
            <dt>地址栏搜索</dt>
            <dd>
              <span className="kbd">arc</span> + 空格或 Tab
            </dd>
          </div>
        </dl>
        <Button
          style={{ marginTop: 18 }}
          onClick={() => {
            if (isExtension)
              void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
            else setStatus("在 Chrome 扩展中打开快捷键设置");
          }}
        >
          配置快捷键
        </Button>
      </section>
      <section className="panel">
        <h2>新标签页焦点</h2>
        <label className="setting-row">
          <input
            type="radio"
            name="newtab-focus"
            checked={settings.newtabFocus === "omnibox"}
            onChange={() => void updateSettings({ ...settings, newtabFocus: "omnibox" })}
          />
          保持 Chrome 聚焦原生地址栏（默认）
        </label>
        <label className="setting-row">
          <input
            type="radio"
            name="newtab-focus"
            checked={settings.newtabFocus === "palette"}
            onChange={() => void updateSettings({ ...settings, newtabFocus: "palette" })}
          />
          新标签页加载后尝试聚焦搜索面板
        </label>
      </section>
      <section className="panel">
        <h2>⌘T 的当前边界</h2>
        <p>
          ⌘T 打开这个扩展的新标签页，Chrome
          会优先聚焦原生地址栏，居中面板可通过单独的快捷键唤起
        </p>
        <p>
          Chrome 将 ⌘T 视为保留快捷键，扩展无法注册或接管物理按键；聚焦面板只是尽力而为的替代
        </p>
        <p>普通网页支持命令面板，Chrome 系统页和扩展商店等受限页面使用工具栏弹窗</p>
      </section>
      <section className="panel">
        <h2>能力范围</h2>
        <p>
          当前提供空间、统一搜索、固定入口、手动与自动归档、Arc
          导入、备份、书签双向同步、原生双页分屏、Little Arc 小窗、Peek 预览和域名分流
        </p>
        <p>
          三页、四页分屏保留组合目录并逐项打开；跨设备同步需要独立的账号与后端，当前只提供
          JSON 导出与恢复
        </p>
      </section>
    </>
  );
}

const NAV: { id: View; title: string; icon: typeof LayersIcon }[] = [
  { id: "spaces", title: "空间与收藏", icon: LayersIcon },
  { id: "import", title: "迁移与备份", icon: ImportIcon },
  { id: "archive", title: "自动归档", icon: ArchiveIcon },
  { id: "routing", title: "域名分流", icon: RouteIcon },
  { id: "keys", title: "快捷键与能力", icon: KeyboardIcon },
];
const HEAD: Record<View, { title: string; intro: string }> = {
  spaces: {
    title: "每个空间，都有自己的节奏",
    intro: "页面继续交给 Chrome，空间、固定入口和目录留在这里",
  },
  import: {
    title: "把你的 Arc 带过来",
    intro: "先检查层级与数量，再把空间和链接保存到 Chrome",
  },
  archive: {
    title: "让闲置页面自己退场",
    intro: "按闲置时间归档托管空间中的页面，随时可以恢复",
  },
  routing: {
    title: "让网址回到该去的地方",
    intro: "按域名决定打开到哪个空间，或直接以小窗打开",
  },
  keys: {
    title: "顺手，才是常用的理由",
    intro: "统一搜索、空间切换和收藏操作，沿用你熟悉的键盘习惯",
  },
};

export function Settings() {
  const { snapshot, error, setError, refresh } = useSnapshot();
  const [view, setView] = useState<View>("spaces");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

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
  const settings = snapshot ? settingsOf(snapshot.state) : undefined;
  const updateSettings = (next: SettingsData) =>
    act(() => request({ type: "set-settings", settings: next }), "设置已保存");

  const head = HEAD[view];
  const ctx: Ctx | undefined =
    snapshot && settings
      ? {
          snapshot,
          settings,
          busy,
          act,
          updateSettings,
          setError,
          setStatus,
          refresh,
          goTo: setView,
        }
      : undefined;

  return (
    <div className="arc-app settings-app aurora">
      <aside className="settings-nav">
        <div className="settings-brand">
          <span className="brand-symbol" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4c1 4 3 6 7 7-4 1-6 3-7 7-1-4-3-6-7-7 4-1 6-3 7-7Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <strong>Arc Plugin</strong>
        </div>
        <p className="nav-caption">让熟悉的习惯留下来</p>
        <nav aria-label="设置导航">
          {NAV.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "is-active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <span className="nav-bottom">
          {snapshot?.demo ? "当前为演示预览" : "数据保存在这台设备上"}
        </span>
      </aside>
      <main className="settings-content">
        <header>
          <span className="eyebrow">{snapshot?.demo ? "演示预览" : "Arc Plugin"}</span>
          <h1>{head.title}</h1>
          <p className="intro">{head.intro}</p>
        </header>
        {error && <Notice tone="error">{error}</Notice>}
        {status && <Notice tone="success">{status}</Notice>}
        {!snapshot && !error && <p role="status">正在读取本地数据…</p>}
        {ctx && view === "spaces" && <SpacesView ctx={ctx} />}
        {ctx && view === "import" && <ImportView ctx={ctx} />}
        {ctx && view === "archive" && <ArchiveView ctx={ctx} />}
        {ctx && view === "routing" && <RoutingView ctx={ctx} />}
        {ctx && view === "keys" && <KeysView ctx={ctx} />}
      </main>
    </div>
  );
}
