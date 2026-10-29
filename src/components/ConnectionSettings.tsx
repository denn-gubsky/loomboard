import { useState } from "react";
import { useConnection } from "../state/connection";
import { isTauri } from "../lib/proxyMode";
import { CALLBACK_PATH } from "../lib/appSignIn";
import SignInCard, { type Registration } from "./SignInCard";

// The sign-in screen of the app (web SPA, desktop). Shown whenever we are not
// in the "connected" state.
export default function ConnectionSettings() {
  const { settings, status, error, problem, connect, signInWithLoomcycle, cancelSignIn } =
    useConnection();
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");

  // What the operator registers for this build. The desktop app's addresses
  // ship in loomcycle's `loomboard` preset; in `tauri dev` its webview is the
  // Vite dev server, an origin the preset does not list.
  const registration: Registration = isTauri
    ? { preset: true, origin: import.meta.env.DEV ? window.location.origin : undefined }
    : { redirectUri: `${window.location.origin}${CALLBACK_PATH}`, origin: window.location.origin };

  return (
    <SignInCard
      intro="loomboard is a thin client over a loomcycle runtime. Enter its address, then sign in on loomcycle's own page."
      baseUrl={baseUrl}
      onBaseUrlChange={setBaseUrl}
      baseUrlPlaceholder="https://loomcycle.example.com — blank = local default"
      baseUrlHint={
        <>
          Any reachable loomcycle (local, a LAN box like TrueNAS, or remote). Blank ={" "}
          <code>http://127.0.0.1:8787</code>.
        </>
      }
      busy={status === "connecting" || status === "signing-in"}
      waitingLabel={status === "signing-in" ? "Finish signing in in your browser…" : undefined}
      onCancel={isTauri ? cancelSignIn : undefined}
      onSignIn={() => void signInWithLoomcycle(baseUrl.trim())}
      onConnectToken={(token) => void connect({ baseUrl: baseUrl.trim(), token })}
      initialToken={settings?.token ?? ""}
      tokenHint="Stored in this browser only. Leave blank if the runtime has no auth."
      error={status === "error" ? error : null}
      problem={problem}
      registration={registration}
    />
  );
}
