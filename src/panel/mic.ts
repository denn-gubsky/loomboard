import "../index.css";
import "./panel.css";

// The one-time microphone page (RFC GI D3): the side panel opens it in a tab
// because Chrome shows no permission prompt in a side panel. The grant
// belongs to the extension's origin, so the panel can record once it is
// given here. The stream is closed at once: this page records nothing.

const allow = document.getElementById("allow") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;

async function closeThisTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
}

allow.addEventListener("click", async () => {
  allow.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.textContent = "Microphone allowed. Go back to the side panel and press the mic.";
    setTimeout(() => void closeThisTab(), 1500);
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    status.textContent =
      name === "NotAllowedError"
        ? "The microphone was blocked. Allow it from the icon at the right of the address bar, then press the button again."
        : name === "NotFoundError"
          ? "No microphone was found."
          : "The microphone could not be opened.";
    allow.disabled = false;
  }
});
