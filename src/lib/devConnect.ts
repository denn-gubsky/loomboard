import type { ConnectionSettings } from "../state/settings";

// Dev-only convenience: seed the connection from the environment so
// `VITE_DEV_TOKEN=… npm run dev` lands straight in the app instead of stopping
// at the Connect screen to re-paste a bearer on every fresh profile.
//
// SAFETY — this must never reach a shipped build. Vite replaces
// `import.meta.env.DEV` with the literal `false` in any `vite build`, so the
// whole branch (and the inlined token literal with it) is dead code the
// minifier drops; only `vite dev` ever takes it. That is why DEV is checked
// here rather than, say, a VITE_ flag a build could accidentally carry.
//
// Pure → unit-tested.

export interface DevConnectEnv {
  /** Vite's build-mode flag: true only under `vite dev`. */
  DEV?: boolean;
  /** The bearer to seed. Absent/empty ⇒ the feature is off. */
  VITE_DEV_TOKEN?: string;
  /** Which runtime to point at. Blank/absent ⇒ "", which in dev means the
   *  proxy's own default target (LOOMBOARD_PROXY_TARGET, else 127.0.0.1:8787). */
  VITE_DEV_BASE_URL?: string;
}

export function devConnectSettings(
  env: DevConnectEnv,
  persisted: ConnectionSettings | null,
): ConnectionSettings | null {
  if (env.DEV !== true) return null;
  // A connection the user already made wins: they may have pointed the app
  // somewhere else in the UI, and having the env yank it back on every reload
  // would make that switch impossible. Log out (which clears the stored
  // connection) and the seed applies again on the next load.
  if (persisted) return null;
  const token = env.VITE_DEV_TOKEN;
  if (!token) return null;
  return { baseUrl: env.VITE_DEV_BASE_URL ?? "", token };
}
