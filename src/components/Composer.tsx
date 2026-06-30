import { useState, type DragEvent, type KeyboardEvent } from "react";
import {
  Send,
  Square,
  Paperclip,
  X,
  Loader2,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  classify,
  MAX_FILE_BYTES,
  type StagedAttachment,
} from "../lib/attachments";
import {
  attachmentBudget,
  estimateImageTokens,
  estimateTextTokens,
} from "../lib/attachmentBudget";

interface Props {
  disabled: boolean;
  running: boolean;
  /** maxContextTokens − contextTokens, or null when the window is unknown. */
  freeTokens: number | null;
  onSend: (text: string, attachments: StagedAttachment[]) => void;
  onStop: () => void;
  placeholder?: string;
}

let seq = 0;
const nextId = () => `att_${++seq}`;

function AttChip({
  att,
  onRemove,
}: {
  att: StagedAttachment;
  onRemove: () => void;
}) {
  return (
    <div className={`att-chip ${att.status}`} title={att.error ?? att.name}>
      {att.kind === "image" && att.dataUrl ? (
        <img className="att-thumb" src={att.dataUrl} alt={att.name} />
      ) : (
        <FileText size={16} className="att-icon" />
      )}
      <span className="att-name">{att.name}</span>
      {att.status === "processing" && <Loader2 size={13} className="spin" />}
      {att.status === "error" && <AlertCircle size={13} className="att-err" />}
      <button className="att-x" onClick={onRemove} title="Remove" type="button">
        <X size={13} />
      </button>
    </div>
  );
}

export default function Composer({
  disabled,
  running,
  freeTokens,
  onSend,
  onStop,
  placeholder,
}: Props) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<StagedAttachment[]>([]);
  const [dragging, setDragging] = useState(false);

  function patch(id: string, p: Partial<StagedAttachment>) {
    setAtts((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));
  }

  async function processFile(file: File) {
    const kind = classify(file);
    const id = nextId();
    if (!kind) {
      setAtts((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, kind: "text", status: "error", error: "unsupported file type", estTokens: 0 },
      ]);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setAtts((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, kind, status: "error", error: "file too large", estTokens: 0 },
      ]);
      return;
    }
    setAtts((prev) => [
      ...prev,
      { id, name: file.name, size: file.size, kind, status: "processing", estTokens: 0 },
    ]);
    try {
      // Lazy-load the heavy extractors so pdf.js/mammoth stay out of the
      // initial bundle — they load only when a file is actually attached.
      if (kind === "image") {
        const { resampleImage } = await import("../lib/image");
        const img = await resampleImage(file);
        patch(id, {
          status: "ready",
          mediaType: img.mediaType,
          data: img.data,
          dataUrl: img.dataUrl,
          width: img.width,
          height: img.height,
          estTokens: estimateImageTokens(img.width, img.height),
        });
      } else {
        const { extractText } = await import("../lib/extract");
        const extracted = await extractText(file);
        if (!extracted.trim()) {
          patch(id, { status: "error", error: "no text found" });
          return;
        }
        patch(id, { status: "ready", text: extracted, estTokens: estimateTextTokens(extracted) });
      }
    } catch (e) {
      patch(id, { status: "error", error: e instanceof Error ? e.message : "failed to read" });
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) void processFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(e.dataTransfer.files);
  }

  const ready = atts.filter((a) => a.status === "ready");
  const processing = atts.some((a) => a.status === "processing");
  const readyTokens = ready.reduce((s, a) => s + a.estTokens, 0);
  const budget = attachmentBudget(readyTokens, freeTokens);

  function submit() {
    if (disabled || processing) return;
    if (!text.trim() && ready.length === 0) return;
    onSend(text, ready);
    setText("");
    setAtts([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className={dragging ? "composer-wrap dragging" : "composer-wrap"}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {atts.length > 0 && (
        <div className="att-strip">
          {atts.map((a) => (
            <AttChip
              key={a.id}
              att={a}
              onRemove={() => setAtts((prev) => prev.filter((x) => x.id !== a.id))}
            />
          ))}
        </div>
      )}

      {!budget.ok && budget.cap != null && (
        <div className="att-warn">
          <AlertCircle size={14} />
          Attachments (~{readyTokens.toLocaleString()} tokens) exceed the context
          budget (~{budget.cap.toLocaleString()}). Remove some, or the model may
          truncate them.
        </div>
      )}

      <div className="composer">
        {/* A <label> wrapping a visually-hidden input opens the native file
            dialog on click in every browser — more robust than calling
            inputRef.click() on a display:none input, which silently no-ops in
            some browsers. */}
        <label
          className={disabled ? "att-btn disabled" : "att-btn"}
          title="Attach files or images"
        >
          <Paperclip size={18} />
          <input
            className="att-input"
            type="file"
            multiple
            disabled={disabled}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <textarea
          className="composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Message…"}
          rows={1}
          disabled={disabled}
        />
        {running ? (
          <button className="composer-btn stop" onClick={onStop} title="Stop" type="button">
            <Square size={16} />
          </button>
        ) : (
          <button
            className="composer-btn"
            onClick={submit}
            disabled={disabled || processing || (!text.trim() && ready.length === 0)}
            title="Send"
            type="button"
          >
            {processing ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
