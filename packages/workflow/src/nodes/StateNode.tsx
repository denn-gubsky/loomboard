import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLE, type FlowNodeData } from "../lib/flow";
import { RunLines } from "./RunLines";
import { promptFields } from "../lib/bindings";
import { inputFields } from "../lib/inputForm";
import { isInputStarter } from "../lib/validate";

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
  vars: "vars",
  input: "start form",
  starter: "starter",
  // "publish" rather than "channel": the kind names the THING, the badge should
  // name the ACTION, and this kind's whole job is that it publishes and cannot
  // read. Calling it "channel" next to a Starter that also has channels is the
  // confusion the L4 split exists to remove.
  channel: "publish",
};

export function StateNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { node, agents, wait, consolidator, channels, fanout, assigns, hooks, isEntry, findings, pulse, held, result, start, progress, current, lines } =
    d;
  // A Starter reading the walk's input is the team's front door, like an
  // Input state: it shows the form and Start.
  const readsInput = isInputStarter(node);
  const hasForm = !node.opaque && (node.kind === "input" || readsInput);
  const fieldsOf = hasForm ? inputFields(node) : [];

  // A Starter sits IN the data row (C2 amended): it reads on its left and
  // dispatches its agent on its right, so its control handles are the bottom
  // pair only.
  const inRow = !node.opaque && node.kind === "starter";
  // Kinds that carry a prompt can be fed a binding (lib/bindings.ts).
  const takesBindings = !node.opaque && promptFields(node.kind).length > 0;
  // A publish node publishes; so can an Input node — the walk's input, via its
  // `publish` (a drag from this handle to a channel sets it).
  const publishes = !node.opaque && (node.kind === "channel" || node.kind === "input");

  const errors = findings.filter((f) => f.level === "error");
  const infos = findings.filter((f) => f.level === "info");

  const classes = [
    "lb-wf-node",
    `lb-wf-node--${node.opaque ? "opaque" : node.kind || "unset"}`,
    selected ? "is-selected" : "",
    errors.length ? "has-error" : "",
    progress ? `is-${progress}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-testid={`node-${node.id}`}>
      {/* Where a running walk is: a marker above the node, outside its box so
          it never covers the face. */}
      {current && (
        <div className="lb-wf-node__marker" data-testid={`current-${node.id}`} aria-label="the walk is here">
          ▼ now – {node.id}
        </div>
      )}
      {/* Three handle pairs, one per relation. A forward CONTROL edge runs
          right → left across the row; a BACKWARD one (any pushback loop) runs
          through the bottom pair, so it arcs below the row rather than curving
          back through the nodes it connects; a DATA edge runs over the top.
          Separate sides are what keep a control and a data edge between the
          same two nodes from stacking into one path. See lib/flow.ts. */}
      {!inRow && (
        <Handle
          id={HANDLE.targetLeft}
          type="target"
          position={Position.Left}
          className="lb-wf-handle"
        />
      )}
      <Handle
        id={HANDLE.targetBottom}
        type="target"
        position={Position.Bottom}
        className="lb-wf-handle lb-wf-handle--loop"
      />
      {/* The data-flow handles exist only on the kinds that CAN carry a
          channel — a Starter reads, a publish node publishes — even before one
          is set, because dragging to a channel node is how it gets set
          (lib/channelWiring.ts). An unconditional pair would put dead dots on
          every agent tile, implying a connection the kind cannot make. */}
      {/* A variable read from this state (a form field, a capture, a set)
          leaves from the bottom, at the far end from the binding handle. */}
      {!node.opaque && node.kind !== "terminal" && (
        <Handle
          id={HANDLE.sourceVar}
          type="source"
          position={Position.Bottom}
          className="lb-wf-handle lb-wf-handle--variable"
          style={{ left: "88%" }}
          isConnectable={false}
        />
      )}
      {/* Bindings feed in from below, beside the loop handle rather than on
          it, so a binding edge and a pushback loop never share a path. */}
      {takesBindings && (
        <Handle
          id={HANDLE.targetBind}
          type="target"
          position={Position.Bottom}
          className="lb-wf-handle lb-wf-handle--binding"
          style={{ left: "25%" }}
        />
      )}
      {/* Nothing feeds a Starter that reads the walk's input: no channel. */}
      {inRow && !readsInput && (
        <Handle
          id={HANDLE.dataIn}
          type="target"
          position={Position.Left}
          className="lb-wf-handle lb-wf-handle--data"
        />
      )}

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
          {/* A Starter's agent has a node of its own, right of it. */}
          {!inRow && agents.length > 0 && (
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
          {/* The Starter's face is its dispatch RULE (C2, C3): how wide the
              wave is. What it reads and where results go are the channel nodes
              either side of it in the row, so the face does not repeat them;
              the wave is a runtime fact, so it states the rule rather than a
              run count it cannot know. */}
          {!inRow && channels.source && (
            <div className="lb-wf-node__channel lb-wf-node__channel--in" title={`reads ${channels.source}`}>
              ← {channels.source}
            </div>
          )}
          {fanout && <div className="lb-wf-node__meta">{fanout}</div>}
          {pulse && (
            <div
              className={`lb-wf-node__pulse${held ? " lb-wf-node__pulse--held" : ""}`}
              data-testid={`pulse-${node.id}`}
            >
              {pulse}
            </div>
          )}
          {lines && <RunLines lines={lines} testId={`lines-${node.id}`} />}
          {!inRow && channels.sink && (
            <div className="lb-wf-node__channel lb-wf-node__channel--out" title={`publishes to ${channels.sink}`}>
              → {channels.sink}
            </div>
          )}
          {/* A `vars` state exists so an assignment is VISIBLE rather than
              riding something that looks like an agent — so the face names
              what it binds, not merely that it binds something. */}
          {assigns.length > 0 && (
            <div className="lb-wf-node__agents">
              {assigns.map((v) => (
                <span key={v} className="lb-wf-node__var" title={`\${var.${v}}`}>
                  ${v}
                </span>
              ))}
            </div>
          )}
          {/* Hooks gate every run this node starts, so a node that carries
              them should not look like one that does not. Names only. */}
          {hooks.length > 0 && (
            <div className="lb-wf-node__meta lb-wf-node__hooks" title={hooks.join("\n")}>
              {hooks.length} hook{hooks.length === 1 ? "" : "s"}
            </div>
          )}
          {/* An End node shows what the walk that finished here produced —
              read from the walk's run, which holds the output (RFC DI).
              Model output: plain text, never markup. */}
          {node.kind === "terminal" && result && result.length > 0 && (
            <div className="lb-wf-node__result" data-testid={`result-${node.id}`}>
              <div className="lb-wf-node__meta">result</div>
              {result.map((r, i) => (
                <div key={r.runId ?? i} className="lb-wf-node__result-item">
                  {(r.agent || r.ok !== undefined) && (
                    <div className="lb-wf-node__meta">
                      {r.agent ?? ""}
                      {r.ok === false ? " · failed" : ""}
                    </div>
                  )}
                  <pre className="lb-wf-node__result-text" title={r.text}>
                    {r.text}
                  </pre>
                </div>
              ))}
            </div>
          )}
          {/* The Input node: the team's form, each field with the variable it
              becomes, and Start — the team's front door (RFC CZ). */}
          {readsInput && <div className="lb-wf-node__meta">← the walk's input</div>}
          {hasForm && (
            <>
              {fieldsOf.length ? (
                <ul className="lb-wf-node__form">
                  {fieldsOf.map((f) => (
                    <li key={f.name}>
                      <span title={f.picker ? `picked: a ${f.picker.kind}` : f.type}>
                        {f.picker ? "▾ " : ""}
                        {f.title ?? f.name}
                        {f.required ? " *" : ""}
                      </span>
                      {f.variable && <code className="lb-wf-node__var">{`→ \${var.${f.variable}}`}</code>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="lb-wf-node__meta">plain text input</div>
              )}
              {start && (
                <button
                  type="button"
                  className="lb-wf-btn lb-wf-btn--primary lb-wf-node__start nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    start();
                  }}
                >
                  Start…
                </button>
              )}
            </>
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

      {/* The Starter's dispatch to its agent node: derived from its fan-out,
          so not a handle to drag from. The sink is wired from the agent. */}
      {inRow && (
        <Handle
          id={HANDLE.dataOut}
          type="source"
          position={Position.Right}
          className="lb-wf-handle lb-wf-handle--data"
          isConnectable={false}
        />
      )}
      {publishes && (
        <Handle
          id={HANDLE.dataOut}
          type="source"
          position={Position.Top}
          className="lb-wf-handle lb-wf-handle--data"
        />
      )}

      {/* A terminal state accepts inbound edges only; teamgraph refuses an
          outbound one, so withholding BOTH source handles makes that rule a
          property of the UI rather than an error message after the fact. */}
      {/* A Starter has no outbound control handle of its own: its
          transitions leave from its agent node, where its runs end. */}
      {node.kind !== "terminal" && !inRow && (
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
