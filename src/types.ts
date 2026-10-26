export type SpaceColor =
  | "purple"
  | "blue"
  | "green"
  | "orange"
  | "pink"
  | "cyan"
  | "red"
  | "yellow"
  | "grey"
  | "peach"
  | "mint"
  | "lavender";
export const SPACE_COLORS: readonly SpaceColor[] = [
  "purple", "blue", "green", "orange", "pink", "cyan",
  "red", "yellow", "grey", "peach", "mint", "lavender",
];
export interface Space {
  id: string;
  name: string;
  color: SpaceColor;
  sourceId?: string;
  bookmarkId?: string;
}
export interface Item {
  id: string;
  sourceId?: string;
  spaceId: string | null;
  parentId: string | null;
  kind: "link" | "folder" | "split";
  scope: "favorite" | "pinned" | "temporary";
  title: string;
  url?: string;
  children: string[];
  bookmarkId?: string;
  missing?: { at: number; reason: "deleted" | "moved" | "invalid" };
  orientation?: string;
  weights?: number[];
}
export type AutoArchiveScope = "temporary" | "managed" | "spaces";
export interface AutoArchiveSettings {
  enabled: boolean;
  afterDays: number;
  scope: AutoArchiveScope;
  spaceIds: string[];
  maxPerRun: number;
}
export interface DomainRule {
  id: string;
  pattern: string;
  spaceId?: string | null;
  openIn: "current" | "little-arc";
}
export interface Settings {
  bookmarkSync: { enabled: boolean };
  autoArchive: AutoArchiveSettings;
  routing: { rules: DomainRule[] };
  newtabFocus: "omnibox" | "palette";
}
export type FloatingMode = "little-arc" | "peek";
export interface ArchiveEntry {
  id: string;
  spaceId: string;
  title: string;
  url: string;
  archivedAt: number;
  sessionId?: string;
}
export interface ImportRecord {
  id: string;
  importedAt: number;
  itemCount: number;
  bookmarkIds: string[];
}
export interface GroupRecord {
  spaceId: string;
  title: string;
  urls: string[];
}
export interface DataDocument {
  schemaVersion: 1;
  revision: number;
  spaces: Space[];
  items: Item[];
  archives: ArchiveEntry[];
  imports: ImportRecord[];
  groupRecords: GroupRecord[];
  bookmarkRootId?: string;
  settings?: Settings;
}
export interface BookmarkBefore {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  index?: number;
}
export interface AppState extends DataDocument {
  undo?: {
    state: DataDocument;
    createdBookmarkIds: string[];
    changedBookmarks?: BookmarkBefore[];
  };
}
export interface Binding {
  spaceId: string;
  windowId: number;
  groupId: number;
  lastTabId?: number;
}
export interface RuntimeState {
  bindings: Binding[];
  windowSpaces: Record<string, string>;
  itemTabs: Record<string, string>;
  previousTabs: Record<string, number>;
  lastAccessed: Record<string, number>;
  floating?: {
    windowId: number;
    tabId: number;
    mode: FloatingMode;
    openedAt: number;
  };
}
export interface LiveTab {
  id: number;
  windowId: number;
  groupId: number;
  title: string;
  url: string;
  active: boolean;
  audible: boolean;
  pinned: boolean;
  lastAccessed?: number;
  splitViewId?: number;
  spaceId?: string;
  itemId?: string;
}
export interface Snapshot {
  state: AppState;
  tabs: LiveTab[];
  runtime: RuntimeState;
  windowId: number;
  originTabId?: number;
  demo?: boolean;
}
export interface ImportPreview {
  spaces: Space[];
  items: Item[];
  diagnostics: string[];
  counts: { links: number; folders: number; splits: number; skipped: number };
}
export type ResultKind =
  "tab" | "item" | "space" | "command" | "url" | "search";
export interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle: string;
  spaceId?: string;
  url?: string;
  score: number;
}
export type Request =
  | { type: "snapshot"; originTabId?: number }
  | { type: "execute"; id: string; query?: string; originTabId?: number }
  | { type: "preview-import"; text: string }
  | { type: "import"; text: string }
  | { type: "restore"; text: string }
  | { type: "undo-import" }
  | { type: "rename-space"; id: string; name: string }
  | { type: "create-space"; name: string; color: SpaceColor }
  | { type: "delete-space"; id: string }
  | { type: "reorder-spaces"; ids: string[] }
  | { type: "set-space-color"; id: string; color: SpaceColor }
  | { type: "adopt-group"; spaceId: string; originTabId?: number }
  | { type: "remove-item"; id: string }
  | { type: "repair-item"; id: string }
  | { type: "get-settings" }
  | { type: "set-settings"; settings: Settings }
  | { type: "auto-archive-preview" }
  | { type: "run-auto-archive" }
  | { type: "open-floating"; url: string; mode: FloatingMode; originTabId?: number }
  | { type: "open-palette" };
export type Response<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };
