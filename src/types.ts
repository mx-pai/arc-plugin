export type SpaceColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";
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
  orientation?: string;
  weights?: number[];
}
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
  | { type: "adopt-group"; spaceId: string; originTabId?: number }
  | { type: "remove-item"; id: string }
  | { type: "open-palette" };
export type Response<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };
