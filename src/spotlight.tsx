import { createRoot } from "react-dom/client";
import { CommandPalette } from "./palette.tsx";
import css from "./styles.css";

const runtime = globalThis as typeof globalThis & {
  __arcPluginClose?: () => void;
};
if (runtime.__arcPluginClose) runtime.__arcPluginClose();
else {
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const host = document.createElement("div");
  host.setAttribute("data-arc-plugin", "spotlight");
  host.style.setProperty("all", "initial", "important");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);
  const backdrop = document.createElement("div");
  backdrop.className = "arc-overlay";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "搜索标签、收藏与空间");
  shadow.append(backdrop);
  const mount = document.createElement("div");
  backdrop.append(mount);
  document.documentElement.append(host);
  const root = createRoot(mount);
  const close = () => {
    root.unmount();
    host.remove();
    delete runtime.__arcPluginClose;
    previous?.focus({ preventScroll: true });
  };
  runtime.__arcPluginClose = close;
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  shadow.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Tab") return;
    const controls = [
      ...shadow.querySelectorAll<HTMLElement>(
        'input,button:not(:disabled),[tabindex="0"]',
      ),
    ].filter((el) => el.getClientRects().length > 0);
    if (!controls.length) return;
    const current = shadow.activeElement;
    if (event.shiftKey && current === controls[0]) {
      event.preventDefault();
      controls.at(-1)!.focus();
    } else if (!event.shiftKey && current === controls.at(-1)) {
      event.preventDefault();
      controls[0].focus();
    }
  });
  root.render(<CommandPalette mode="overlay" onClose={close} />);
}
