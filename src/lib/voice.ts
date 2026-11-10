import type { ChatProps } from "../chat";
import { chromeMicPermission, ensureExtensionMicrophone } from "./extMicrophone";
import { isExtension, isTauri } from "./proxyMode";

// The voice controls the app's chats offer on this platform (RFC FX). The
// desktop app keeps the microphone off until FX P4: it declares no microphone
// usage description yet, and macOS may terminate an app that opens the mic
// without one. The extension's side panel cannot show the permission prompt,
// so it gets permission on a page of its own first (RFC GI D3). Read-aloud
// needs no permission and works everywhere.
export const appVoice: ChatProps["voice"] = isTauri
  ? { input: false }
  : isExtension
    ? { ensureMicrophone: () => ensureExtensionMicrophone(chromeMicPermission()) }
    : undefined;
