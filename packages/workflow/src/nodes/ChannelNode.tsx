import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CHANNEL_HANDLE, type ChannelFlowData } from "../lib/flow";
import { channelBacklog } from "../lib/channelNodes";

// A channel the team names, drawn as the junction its data edges run through.
//
// The face says what an operator would otherwise find out only when a run did
// not start: whether the channel is declared at all, whether the team's ACL
// grants the side each node needs, whether it is HELD, whether hooks gate
// every message, and how much of what is stored a reader can actually see.
// Everything here is read-only — the channel is a ChannelDef outside the
// TeamDef (decision C11) and is edited where it lives.

export function ChannelNode({ data, selected }: NodeProps) {
  const { view } = data as unknown as ChannelFlowData;
  const { info, grants, declared } = view;

  const missing = (["publish", "subscribe"] as const).filter((s) => grants[s] === false);
  const problems = missing.length > 0 || declared === false;
  const backlog = channelBacklog(info);
  const hooks = info?.hooks ?? [];

  const classes = [
    "lb-wf-node",
    "lb-wf-node--channelref",
    selected ? "is-selected" : "",
    problems ? "has-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-testid={`channel-${view.channel}`}>
      <Handle
        id={CHANNEL_HANDLE.in}
        type="target"
        position={Position.Left}
        className="lb-wf-handle lb-wf-handle--data"
        isConnectable={false}
      />
      <div className="lb-wf-node__head">
        <span className="lb-wf-node__title" title={view.channel}>
          {view.channel}
        </span>
        <span className="lb-wf-node__kind">channel</span>
      </div>
      <div className="lb-wf-node__body">
        <div className="lb-wf-node__meta">
          {view.publishers.length} → {view.readers.length}
          {view.publishers.length > 1 ? " · fan-in" : ""}
          {info?.scope ? ` · ${info.scope}` : ""}
        </div>
        {backlog && <div className="lb-wf-node__meta">{backlog}</div>}
        {info?.hold && (
          <div className="lb-wf-node__meta lb-wf-node__warn" title="Stored, delivered to nobody until released">
            HELD
          </div>
        )}
        {hooks.length > 0 && (
          <div className="lb-wf-node__meta lb-wf-node__hooks" title={hooks.join("\n")}>
            {hooks.length} hook{hooks.length === 1 ? "" : "s"} gate every message
          </div>
        )}
        {declared === false && (
          <div className="lb-wf-finding lb-wf-finding--error">
            not declared — the runtime refuses an undeclared channel
          </div>
        )}
        {missing.length > 0 && (
          <div className="lb-wf-finding lb-wf-finding--error">
            team ACL does not grant {missing.join(" or ")}
          </div>
        )}
      </div>
      <Handle
        id={CHANNEL_HANDLE.out}
        type="source"
        position={Position.Right}
        className="lb-wf-handle lb-wf-handle--data"
        isConnectable={false}
      />
    </div>
  );
}
