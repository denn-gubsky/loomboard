// Per-conversation model overrides. provider/model/tier/effort can only be set
// on an AgentDef, so when any of these differ from the base agent the chat forks
// a private def at first send (see lib/agentFork). `effort` is loomcycle's
// thinking-mode knob (maps to Anthropic thinking budget / OpenAI
// reasoning_effort / DeepSeek toggle); "" / undefined means inherit the agent.
export interface ConversationConfig {
  provider?: string;
  model?: string;
  tier?: string;
  effort?: string;
}

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
  /** Name of the per-conversation AgentDef fork, once created. */
  forkDefName?: string;
  /** loomcycle session + interactive run, set after the first turn. */
  sessionId?: string;
  runId?: string;
}

/** True when the config diverges from the base agent and a fork is needed. */
export function configIsCustom(config: ConversationConfig): boolean {
  return Boolean(
    config.provider || config.model || config.tier || config.effort,
  );
}

const CONFIG_KEYS: (keyof ConversationConfig)[] = [
  "provider",
  "model",
  "tier",
  "effort",
];

/** True when two configs hold the same overrides. "" and undefined both mean
 *  "inherit", so they compare equal. Used by the config panel's dirty check. */
export function sameConfig(a: ConversationConfig, b: ConversationConfig): boolean {
  return CONFIG_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}
