import type { ChatProps } from "../chat";
import { chromeMicPermission, ensureExtensionMicrophone } from "./extMicrophone";
import { isExtension } from "./proxyMode";

// The voice controls the app's chats offer on this platform (RFC FX). The
// extension's side panel cannot show the permission prompt, so it gets
// permission on a page of its own first (RFC GI D3). Everywhere else the
// browser asks: the desktop app declares its microphone use (src-tauri
// Info.plist, without which WebKit hides getUserMedia), and where a webview
// offers no microphone at all (WebKitGTK on Linux) the mic button says so.
// Read-aloud needs no permission and works everywhere.
export const appVoice: ChatProps["voice"] = isExtension
  ? { ensureMicrophone: () => ensureExtensionMicrophone(chromeMicPermission()) }
  : undefined;
