import { useState } from "react";
import { Check, Copy } from "lucide-react";

// Copy `text` to the clipboard with a brief confirmation. clipboard.writeText
// can reject (insecure context / denied permission); we swallow it silently
// rather than surfacing a scary error for a convenience action.
export default function CopyButton({
  text,
  title = "Copy",
  className,
}: {
  text: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — nothing actionable for the user.
    }
  }

  return (
    <button
      type="button"
      className={className ? `copy-btn ${className}` : "copy-btn"}
      onClick={onCopy}
      title={copied ? "Copied" : title}
      aria-label={title}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
