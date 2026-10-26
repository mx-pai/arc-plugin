// Aurora 原子组件：面板统一走这些基元，保证样式一致、便于复用。
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  CommandIcon,
  EnterIcon,
  FolderIcon,
  GlobeIcon,
  LinkIcon,
  SearchIcon,
  SpaceIcon,
  SplitIcon,
  TabIcon,
} from "./icons.tsx";
import { actionLabel } from "./command.ts";
import { letterOf, shortHost } from "./hooks.ts";
import type { SearchResult, Space, SpaceColor } from "../types.ts";

export function Brand({ label }: { label?: string }) {
  return (
    <span className="brand-symbol" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 4c1 4 3 6 7 7-4 1-6 3-7 7-1-4-3-6-7-7 4-1 6-3 7-7Z"
          fill="currentColor"
        />
      </svg>
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
};
export function Button({ variant = "default", className = "", ...rest }: ButtonProps) {
  const cls =
    variant === "primary"
      ? "btn btn-primary"
      : variant === "ghost"
        ? "btn btn-ghost"
        : "btn";
  return <button className={`${cls} ${className}`.trim()} {...rest} />;
}

export function IconButton({
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`icon-btn ${className}`.trim()} {...rest} />;
}

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: ReactNode;
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function SpaceDot({ color }: { color: SpaceColor }) {
  return <span className={`space-dot color-${color}`} aria-hidden="true" />;
}

// 搜索结果左侧标记：命令/空间/搜索用线性图标，网页用首字母胶囊。
export function Mark({ result }: { result: SearchResult }) {
  if (result.kind === "command")
    return (
      <span className="result-mark">
        <CommandIcon size={17} />
      </span>
    );
  if (result.kind === "space")
    return (
      <span className="result-mark">
        <SpaceIcon size={17} />
      </span>
    );
  if (result.kind === "search")
    return (
      <span className="result-mark">
        <SearchIcon size={17} />
      </span>
    );
  if (result.kind === "url")
    return (
      <span className="result-mark">
        <GlobeIcon size={17} />
      </span>
    );
  return <span className="result-mark">{letterOf(result.url, result.title)}</span>;
}

export function KindBadge({ kind }: { kind: "link" | "folder" | "split" }) {
  if (kind === "split")
    return (
      <span className="tiny-mark">
        <SplitIcon size={15} />
      </span>
    );
  if (kind === "folder")
    return (
      <span className="tiny-mark">
        <FolderIcon size={15} />
      </span>
    );
  return (
    <span className="tiny-mark">
      <LinkIcon size={15} />
    </span>
  );
}

export function TabBadge() {
  return (
    <span className="tiny-mark">
      <TabIcon size={15} />
    </span>
  );
}

// 共享的单条搜索结果行，命令面板与新标签主页复用。
export function ResultRow({
  result,
  index,
  selected,
  busy,
  onSelect,
  onRun,
}: {
  result: SearchResult;
  index: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onRun: (event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => void;
}) {
  return (
    <button
      id={`result-${index}`}
      className={`result-row ${selected ? "is-selected" : ""}`}
      role="option"
      aria-selected={selected}
      onMouseMove={onSelect}
      onClick={onRun}
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
        {actionLabel(result.kind)}
        <EnterIcon size={14} />
      </span>
    </button>
  );
}

// 共享的空间切换条。
export function SpaceStrip({
  spaces,
  activeSpace,
  onPick,
}: {
  spaces: Space[];
  activeSpace?: string;
  onPick: (space: Space) => void;
}) {
  if (!spaces.length) return null;
  return (
    <div className="space-strip scroll" aria-label="空间">
      {spaces.map((space) => (
        <button
          key={space.id}
          className={`space-chip ${activeSpace === space.id ? "is-active" : ""}`}
          onClick={() => onPick(space)}
        >
          <SpaceDot color={space.color} />
          {space.name}
        </button>
      ))}
    </div>
  );
}
