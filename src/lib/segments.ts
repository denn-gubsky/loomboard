import type { PromptSegment } from "@loomcycle/client";

// A chat turn from the operator. The operator is the authenticated, first-party
// caller, so their input is trusted-text (same trust level as a steer message),
// not an untrusted block.
export function userSegment(text: string): PromptSegment {
  return { role: "user", content: [{ type: "trusted-text", text }] };
}
