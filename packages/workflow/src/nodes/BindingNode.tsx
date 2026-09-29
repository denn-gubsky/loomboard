import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BINDING_HANDLE, type BindingFlowData } from "../lib/flow";

// A Document or Memory a team's prompts pull in (RFC CZ P3), drawn below the
// states it feeds.
//
// The face answers what the prompt text hides: WHAT the agent actually
// receives. A whole document by path is not inlined — the runtime renders a
// directive naming the tool and path, and the agent reads it live (RFC CY
// Amendment B) — so the face says so, rather than letting it look like a
// truncated or failed expansion. An unknown memory section renders empty.

export function BindingNode({ data, selected }: NodeProps) {
  const { view } = data as unknown as BindingFlowData;
  const readers = [...new Set(view.readers.map((r) => r.state))];

  const classes = [
    "lb-wf-node",
    "lb-wf-node--binding",
    `lb-wf-node--binding-${view.kind}`,
    selected ? "is-selected" : "",
    view.unknownVariant ? "has-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const delivered =
    view.kind === "document"
      ? view.delivery === "directive"
        ? "the agent is told to read it (whole document)"
        : "inlined into the prompt"
      : view.ref.startsWith("key:")
        ? "a memory entry, inlined"
        : view.ref.startsWith("search:")
          ? "a memory search, inlined"
          : "a memory section, inlined";

  return (
    <div className={classes} data-testid={`binding-${view.kind}-${view.ref}`}>
      <div className="lb-wf-node__head">
        <span className="lb-wf-node__title" title={view.ref}>
          {view.ref}
        </span>
        <span className="lb-wf-node__kind">{view.kind}</span>
      </div>
      <div className="lb-wf-node__body">
        <div className="lb-wf-node__meta">{delivered}</div>
        <div className="lb-wf-node__meta">
          read by {readers.length} node{readers.length === 1 ? "" : "s"}
        </div>
        {view.templated && (
          <div className="lb-wf-node__meta" title="The ref contains ${…}: what it names is decided per run">
            resolved per run
          </div>
        )}
        {view.unknownVariant && (
          <div className="lb-wf-finding lb-wf-finding--error">
            unknown memory section — renders empty
          </div>
        )}
      </div>
      <Handle
        id={BINDING_HANDLE.out}
        type="source"
        position={Position.Top}
        className="lb-wf-handle lb-wf-handle--binding"
        isConnectable={false}
      />
    </div>
  );
}
