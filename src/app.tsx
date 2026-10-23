import { createRoot } from "react-dom/client";
import { CommandPalette, Settings } from "./components.tsx";
import { isExtension } from "./client.ts";

const mode = document.body.dataset.view ?? "popup";
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
  ) : (
    <CommandPalette
      mode={mode === "newtab" ? "newtab" : "popup"}
      onClose={() => void close()}
    />
  ),
);
