import { Handle, Position, type NodeProps } from "@xyflow/react";
import { VARIABLE_HANDLE, type VariableFlowData } from "../lib/flow";
import type { VariableSource } from "../lib/variables";

// A team variable (RFC CZ "Data nodes"): a named value with a source, drawn
// below the states. The face says where the value comes from — which is what
// decides whether Start asks for it — and how many nodes read it.

export function sourceLabel(s: VariableSource): string {
  if (s.kind === "start") return "asked at Start";
  if (s.kind === "set") return `set by ${s.state}`;
  return `from ${s.state}${s.path ? ` · ${s.path}` : ""}`;
}

export function VariableNode({ data, selected }: NodeProps) {
  const { view } = data as unknown as VariableFlowData;
  const readers = new Set(view.readers.map((r) => r.state)).size;
  const unset = view.sources.length === 0;
  const classes = ["lb-wf-node", "lb-wf-node--variable", selected ? "is-selected" : "", unset ? "is-unset" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-testid={`variable-${view.name}`}>
      <Handle
        id={VARIABLE_HANDLE.in}
        type="target"
        position={Position.Left}
        className="lb-wf-handle lb-wf-handle--variable"
        isConnectable={false}
      />
      <div className="lb-wf-node__head">
        <span className="lb-wf-node__title" title={`\${var.${view.name}}`}>
          {`\${var.${view.name}}`}
        </span>
        <span className="lb-wf-node__kind">variable</span>
      </div>
      <div className="lb-wf-node__body">
        {view.sources.map((s, i) => (
          <div key={i} className="lb-wf-node__meta">
            {sourceLabel(s)}
          </div>
        ))}
        {unset && <div className="lb-wf-finding lb-wf-finding--info">not set — expands to empty</div>}
        <div className="lb-wf-node__meta">
          read by {readers} node{readers === 1 ? "" : "s"}
        </div>
      </div>
      <Handle
        id={VARIABLE_HANDLE.out}
        type="source"
        position={Position.Top}
        className="lb-wf-handle lb-wf-handle--variable"
      />
    </div>
  );
}
