// Solar 风格圆角线性图标，统一 1.6 描边、currentColor，默认 20px。
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}
export function CommandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />
    </Svg>
  );
}
export function SpaceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </Svg>
  );
}
export function TabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 9h18" />
    </Svg>
  );
}
export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" />
    </Svg>
  );
}
export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Svg>
  );
}
export function SplitIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M12 4v16" />
    </Svg>
  );
}
export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.3 2.3 14.7 0 17M12 3.5c-2.3 2.3-2.3 14.7 0 17" />
    </Svg>
  );
}
export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}
export function CaretIcon(props: IconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}
export function EnterIcon(props: IconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="M20 6v5a2 2 0 0 1-2 2H5" />
      <path d="m8 10-3 3 3 3" />
    </Svg>
  );
}
export function LayersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5M3 16l9 5 9-5" />
    </Svg>
  );
}
export function ImportIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}
export function ArchiveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </Svg>
  );
}
export function RouteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H14a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h3.5" />
    </Svg>
  );
}
export function KeyboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </Svg>
  );
}
export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 16v4" />
    </Svg>
  );
}
export function WindowIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="M4 9h16" />
    </Svg>
  );
}
export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  );
}
