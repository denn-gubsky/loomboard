import type { ImageMediaType, PromptContent, PromptSegment } from "@loomcycle/client";
import type { StagedAttachment } from "./attachments";

// A chat turn from the operator. The operator is the authenticated, first-party
// caller, so their typed message is trusted-text (same trust level as a steer
// message), not an untrusted block.
function trustedText(text: string): PromptContent {
  return { type: "trusted-text", text };
}

// Extracted file text is attacker-influenceable, so it rides as an
// untrusted-block which the loop fences (<untrusted>…</untrusted>) against
// prompt injection. "untrusted" is the generic allowed kind; the filename goes
// in the body.
function fileBlock(name: string, text: string): PromptContent {
  return { type: "untrusted-block", kind: "untrusted", text: `File: ${name}\n\n${text}` };
}

function imageBlock(mediaType: ImageMediaType, data: string): PromptContent {
  return { type: "image", media_type: mediaType, data };
}

/** The simple text-only turn (no attachments). */
export function userSegment(text: string): PromptSegment {
  return { role: "user", content: [trustedText(text)] };
}

/** Build the user segment(s) for a turn with attachments: each ready image as
 *  an image block, each ready text file as a fenced untrusted-block, then the
 *  user's typed message. Returns [] if there's nothing to send. */
export function buildUserSegments(
  text: string,
  attachments: StagedAttachment[],
): PromptSegment[] {
  const content: PromptContent[] = [];
  for (const a of attachments) {
    if (a.status !== "ready") continue;
    if (a.kind === "image" && a.data && a.mediaType) {
      content.push(imageBlock(a.mediaType, a.data));
    } else if (a.kind === "text" && a.text) {
      content.push(fileBlock(a.name, a.text));
    }
  }
  const trimmed = text.trim();
  if (trimmed) content.push(trustedText(trimmed));
  return content.length ? [{ role: "user", content }] : [];
}
