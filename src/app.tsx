import { createRoot } from "react-dom/client";
import { CommandPalette } from "./palette.tsx";
import { NewTab } from "./newtab.tsx";
import { Settings } from "./settings.tsx";
import { SidePanel } from "./sidepanel.tsx";
import { isExtension } from "./client.ts";

const mode = document.body.dataset.view ?? "popup";
if (mode === "popup" || mode === "newtab" || mode === "sidepanel")
  document.body.classList.add("aurora");

async function close() {
  if (mode === "popup") {
    window.close();
    return;
  }
  if (mode === "newtab" && isExtension) {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) await chrome.tabs.remove(tab.id);
  }
}
createRoot(document.getElementById("root")!).render(
  mode === "options" ? (
    <Settings />
  ) : mode === "newtab" ? (
    <NewTab onClose={() => void close()} />
  ) : mode === "sidepanel" ? (
    <SidePanel />
  ) : (
    <CommandPalette mode="popup" onClose={() => void close()} />
  ),
);
