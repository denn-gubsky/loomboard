// Per-conversation overrides — a SPARSE overlay in loomcycle's own snake_case
// vocabulary (RFC DC per-run overrides), sent with the run rather than baked
// into a forked AgentDef the way this used to work.
//
// Sparse is the whole contract, and it is not the same as "optional": a key that
// is ABSENT means inherit the agent, while a key present with a zero value is a
// real setting. loomcycle stores several of these as POINTERS precisely so that
// `retry_attempts: 0` ("do not retry") and `inject_tool_guide: false` ("leave it
// out") can be said at all. Never test these values for truthiness — presence is
// decided by key presence. `""` is the one exception: the editor emits it for a
// cleared text box, and it means inherit.
//
// `effort` is loomcycle's thinking-mode knob (Anthropic thinking budget / OpenAI
// reasoning_effort / DeepSeek toggle).
export interface ConversationOverrides {
  // Pre-typed for source compatibility with the four-key ConversationConfig this
  // replaced — they are not privileged, they are 4 of the vocabulary, and they
  // happen to be spelled the same in snake_case, which is why no stored record
  // needs migrating. Everything else reads as `unknown`; lib/overrides maps it.
  provider?: string;
  model?: string;
  tier?: string;
  effort?: string;
  [key: string]: unknown;
}

/** @deprecated Renamed to {@link ConversationOverrides}; it is now a sparse
 *  snake_case overlay rather than four fixed fields. Kept as an alias because
 *  the name is published API. */
export type ConversationConfig = ConversationOverrides;

// The conversation record <Chat> drives. The host owns and persists it; the
// component reads it and emits patches (session/run/fork ids, title, agent,
// config) via onConversationChange. Hosts may store extra fields — this is the
// minimum the chat needs.
export interface ChatConversation {
  id: string;
  title: string;
  /** Library agent this chat is based on. "" until the user picks one. */
  baseAgent: string;
  config: ConversationConfig;
  /** @deprecated Name of the per-conversation AgentDef fork, for chats created
   *  before per-run overrides. Never written any more, and never removed from a
   *  record that has one: such a chat is bound to that def server-side for the
   *  life of its session, and dropping the name would make the orphaned def both
   *  permanent and untraceable. See lib/legacyFork. */
  forkDefName?: string;
  /** loomcycle session + interactive run, set after the first turn. */
  sessionId?: string;
  runId?: string;
}

/** Whether a key carries a real setting. Absent, `undefined` and `""` are all
 *  "inherit the agent"; every other value — 0 and false included — is a set
 *  override. */
function isSet(v: unknown): boolean {
  return v !== undefined && v !== "";
}

/** True when the overlay overrides anything at all. */
export function configIsCustom(config: ConversationOverrides): boolean {
  return Object.values(config).some(isSet);
}

/** True when two overlays hold the same overrides. "" and undefined both mean
 *  "inherit", so they compare equal. Used by the panel's dirty check.
 *
 *  Compares the UNION of both key sets rather than a fixed list: the vocabulary
 *  is loomcycle's and grows, and a comparison keyed on names known at build time
 *  silently reports "unchanged" for every key added since.
 *
 *  Shallow by design. An object-valued override (`interruption`) is compared by
 *  identity, so the panel treats a nested edit as dirty — which is the safe
 *  direction for a dirty check, and matches how the editor rebuilds the object
 *  on every keystroke anyway. */
export function sameConfig(
  a: ConversationOverrides,
  b: ConversationOverrides,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = isSet(a[k]) ? a[k] : undefined;
    const bv = isSet(b[k]) ? b[k] : undefined;
    if (av !== bv) return false;
  }
  return true;
}
