import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AGENT_HANDLE, type AgentFlowData } from "../lib/flow";

// The agent a Starter dispatches, drawn in the data row between the Starter
// and the channel its results go to (C2 amended). It is the Starter's fan-out,
// not a state: selecting it selects the Starter, and its runs — the Starter's
// runs — are counted HERE, because this is what runs.

export function AgentNode({ data, selected }: NodeProps) {
  const { view, pulse, held } = data as unknown as AgentFlowData;
  const classes = ["lb-wf-node", "lb-wf-node--agentref", selected ? "is-selected" : "", view.agents.length ? "" : "has-error"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-testid={`agent-${view.state}`}>
      <Handle
        id={AGENT_HANDLE.in}
        type="target"
        position={Position.Left}
        className="lb-wf-handle lb-wf-handle--data"
        isConnectable={false}
      />
      <div className="lb-wf-node__head">
        <span className="lb-wf-node__title" title={view.agents.join(", ") || "no agent"}>
          {view.agents.length ? view.agents.join(", ") : <em>no agent set</em>}
        </span>
        <span className="lb-wf-node__kind">agent</span>
      </div>
      <div className="lb-wf-node__body">
        <div className="lb-wf-node__meta">run by {view.state}</div>
        {pulse && (
          <div className={`lb-wf-node__pulse${held ? " lb-wf-node__pulse--held" : ""}`} data-testid={`pulse-${view.state}`}>
            {pulse}
          </div>
        )}
      </div>
      {/* Results leave here: a drag from this handle to a channel sets the
          Starter's sink (lib/channelWiring.ts). */}
      <Handle
        id={AGENT_HANDLE.out}
        type="source"
        position={Position.Right}
        className="lb-wf-handle lb-wf-handle--data"
      />
    </div>
  );
}
