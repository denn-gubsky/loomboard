import type { ChatProps } from "../chat";
import { isExtension, isTauri } from "./proxyMode";

// The voice controls the app's chats offer on this platform (RFC FX).
// - Voice input is offered in Russian and English only (owner, 2026-11-06):
//   no speech-to-text model the deployments run is good enough in Ukrainian
//   yet, and a short list keeps the picker a quick switch.
// - The microphone waits for P4 in two shells: the desktop app declares no
//   microphone usage description yet (macOS may terminate an app that opens
//   the mic without one), and the extension's side panel cannot show the
//   permission prompt. Read-aloud needs no permission and works everywhere.
export const appVoice: ChatProps["voice"] = {
  languages: ["ru", "en"],
  ...(isTauri || isExtension ? { input: false } : {}),
};
