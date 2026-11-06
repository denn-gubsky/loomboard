import type { ChatProps } from "../chat";
import { isExtension, isTauri } from "./proxyMode";

// The voice controls the app's chats offer on this platform (RFC FX). The
// microphone waits for P4 in two shells: the desktop app declares no
// microphone usage description yet (macOS may terminate an app that opens
// the mic without one), and the extension's side panel cannot show the
// permission prompt. Read-aloud needs no permission and works everywhere.
export const appVoice: ChatProps["voice"] = isTauri || isExtension ? { input: false } : undefined;
