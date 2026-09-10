import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLE, type FlowNodeData } from "../lib/flow";

// One component for every handler kind, rather than one per kind.
//
// WHY: the kinds differ by a badge and which rows they show, not by structure
// — and an OPAQUE node (a kind this build has never seen) has to render
// something sensible with no per-kind component available at all. A single
// face that degrades to "title + kind + a note" is what makes forward
// compatibility visible rather than a crash.

const KIND_LABEL: Record<string, string> = {
  agent: "agent",
  parallel: "parallel",
  consolidator: "consolidator",
  terminal: "end",
};

export function StateNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { node, agents, wait, consolidator, isEntry, findings } = d;

  const errors = findings.filter((f) => f.level === "error");
  const infos = findings.filter((f) => f.level === "info");

  const classes = [
    "lb-wf-node",
    `lb-wf-node--${node.opaque ? "opaque" : node.kind || "unset"}`,
    selected ? "is-selected" : "",
    errors.length ? "has-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-testid={`node-${node.id}`}>
      {/* Four handles, not two. A forward edge runs right → left across the
          row; a BACKWARD one (any pushback loop) runs through the bottom pair
          instead, so it arcs below the row rather than curving back through
          the nodes and stacking on top of the forward edge. See lib/flow.ts. */}
      <Handle
        id={HANDLE.targetLeft}
        type="target"
        position={Position.Left}
        className="lb-wf-handle"
      />
      <Handle
        id={HANDLE.targetBottom}
        type="target"
        position={Position.Bottom}
        className="lb-wf-handle lb-wf-handle--loop"
      />

      <div className="lb-wf-node__head">
        <span className="lb-wf-node__title" title={node.id}>
          {node.id || <em>unnamed</em>}
        </span>
        {isEntry && (
          <span className="lb-wf-node__entry" title="The walk starts here">
            entry
          </span>
        )}
        <span className="lb-wf-node__kind">
          {node.opaque ? node.kind || "?" : (KIND_LABEL[node.kind] ?? node.kind)}
        </span>
      </div>

      {node.opaque ? (
        <div className="lb-wf-node__opaque">
          Not known to this canvas version — preserved unchanged and validated by the runtime.
        </div>
      ) : (
        <div className="lb-wf-node__body">
          {agents.length > 0 && (
            <div className="lb-wf-node__agents">
              {agents.map((a) => (
                <span key={a} className="lb-wf-node__agent" title={a}>
                  {a}
                </span>
              ))}
            </div>
          )}
          {node.kind === "parallel" && (
            <div className="lb-wf-node__meta">
              wait {wait || "all"}
              {consolidator ? ` · → ${consolidator}` : ""}
            </div>
          )}
          {node.kind === "agent" && consolidator && (
            <div className="lb-wf-node__meta">judged by {consolidator}</div>
          )}
        </div>
      )}

      {(errors.length > 0 || infos.length > 0) && (
        <div className="lb-wf-node__findings">
          {errors.map((f, i) => (
            <div key={`e${i}`} className="lb-wf-finding lb-wf-finding--error" title={f.message}>
              {f.message}
            </div>
          ))}
          {infos.map((f, i) => (
            <div key={`i${i}`} className="lb-wf-finding lb-wf-finding--info" title={f.message}>
              {f.message}
            </div>
          ))}
        </div>
      )}

      {/* A terminal state accepts inbound edges only; teamgraph refuses an
          outbound one, so withholding BOTH source handles makes that rule a
          property of the UI rather than an error message after the fact. */}
      {node.kind !== "terminal" && (
        <>
          <Handle
            id={HANDLE.sourceRight}
            type="source"
            position={Position.Right}
            className="lb-wf-handle"
          />
          <Handle
            id={HANDLE.sourceBottom}
            type="source"
            position={Position.Bottom}
            className="lb-wf-handle lb-wf-handle--loop"
          />
        </>
      )}
    </div>
  );
}
