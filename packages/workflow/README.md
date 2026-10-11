# @loomboard/workflow

A React canvas for [loomcycle](https://github.com/denn-gubsky/loomcycle) agent teams (TeamDefs): author a team as a graph or as JSON, check it against the runtime, run it, and watch it work.

It is the canvas of the [loomboard](https://github.com/denn-gubsky/loomboard) app, packaged so another host can embed it.

- **Edit** a team's states and transitions on a graph, with an inspector for each state.
- **JSON view** of the same team, kept in sync with the graph (Canvas, JSON or Split).
- **Check** asks the runtime what a save would meet, without saving.
- **Run** a team and follow the walk: which state is active, each run's prompt and result, the sub-agents a run started, and the output.
- **Decision nodes:** a state that asks a decision model typed questions and routes on the answer, with a questions editor, a lab to try the questions against a model, and the model's answer with its probabilities once a walk has passed through.
- **Held channels:** release held messages from a channel's panel, for any channel and for a team's own.
- **A team's own definitions:** its agents, skills, channels, schedules and webhooks, edited with the team.
- **Build by hand:** a new team from a template, save as a new team, import, copy and download.

The component is presentational. It has no HTTP client of its own: the host hands it a small `WorkflowDataLayer`, so it works with `@loomcycle/client` or with any other way of reaching the runtime.

## Install

```sh
npm install @loomboard/workflow @loomcycle/def-fields react react-dom
```

`react` (18 or 19), `react-dom` and `@loomcycle/def-fields` (0.4) are peer dependencies.

## Use

```tsx
import { WorkflowCanvas, type WorkflowDataLayer } from "@loomboard/workflow";
import "@loomboard/workflow/styles.css";

export function TeamEditor({ dataLayer, team }: { dataLayer: WorkflowDataLayer; team: string }) {
  return (
    <div style={{ height: "100vh" }}>
      <WorkflowCanvas
        // Remount per team: the canvas holds the loaded team and its save baseline.
        key={team}
        dataLayer={dataLayer}
        teamName={team}
        onSaved={(saved) => console.log(`saved ${saved.name} v${saved.version}`)}
      />
    </div>
  );
}
```

- **Give the canvas a height.** It fills its parent.
- **Import the stylesheet once.** It also pulls in the styles of `@xyflow/react` and `@loomcycle/def-fields`.
- **Keep `dataLayer` stable** between renders (`useMemo`). A new object reloads the team.
- The JSON editor (CodeMirror 6) is loaded on first use of the JSON view, as dynamic imports, so a bundler can split it out.

### Props

| Prop | What |
|---|---|
| `dataLayer` | How the canvas reaches the runtime. Required. |
| `teamName` | The team to open, at its active version. |
| `defId` | Or one specific version. |
| `template` | With neither of the above: the definition a new team starts from. See `TEAM_TEMPLATES`. It is created on its first save, under a name the operator gives. Must be a stable reference. |
| `mode` | `"edit"` (default) or `"readonly"`. |
| `onSaved` | Called after a save, and after a save under a new name, with `{def_id, name, version}`. |
| `theme` | `"dark"` or `"light"`. Defaults to the nearest ancestor's `data-theme`. |
| `renderRunChat` | The host's chat for one run, shown in Run mode. The package has no chat of its own. |
| `onOpenDocument` | Opens a document in the host, offered on a result that is a document chunk. |

## The data layer

Five methods are required. Each of the others turns on one part of the canvas, and the canvas hides that part when the method is absent.

| Method | Needed for |
|---|---|
| `listTeams`, `getActiveTeamDef`, `getTeamDef`, `createTeam`, `forkTeam` | Opening and saving a team. **Required.** |
| `promoteTeam` | Making a saved version the team's active one. See below. |
| `verifyTeam` | The Check button (loomcycle 1.105 or later). |
| `listAgents` | Agent pickers. |
| `runTeamDetached`, `watchWalk`, `cancelWalk` | Run mode: start a walk, follow it, stop it. |
| `readRun`, `readRunPrompt`, `watchRunLines` | A run's result, its prompt, and its last lines on the node. |
| `watchWalkDecisions` | What a walk's Decision nodes answered (loomcycle 1.110 or later). Without it a Decision node says only which way the walk went. |
| `listDecisionModels`, `decide` | The Decision lab, and the decision model names shown for a team's own agents (loomcycle 1.107 or later). |
| `listChannels`, `peekChannel`, `publishChannel` | Channel backlog, the Output panel, the publish composer. |
| `listTeamChannels`, `peekTeamChannel` | A team's own channels (loomcycle 1.108 or later). |
| `releaseChannel`, `releaseTeamChannel` | Releasing held messages from a channel's panel. |
| `listDocuments`, `listChunks`, `readChunk` | Document pickers in the start form, and a result shown as a chunk. |

What the canvas relies on:

- **Save means "the team now runs this".** loomcycle's fork leaves a new version inactive, so after `forkTeam` the canvas calls `promoteTeam(defId)` with the version it saved. Leave `promoteTeam` out only if your `forkTeam` already makes the new version active.
- **`getActiveTeamDef(name)` returns the team's active version.** A save first checks that it is still the one the canvas last saw, and refuses if someone else moved it.
- **`createTeam` under a name that already exists is not refused by loomcycle**; it becomes that team's next active version. The canvas checks `listTeams` first and refuses a taken name itself.
- **`runTeamDetached` is given an `idempotencyKey`**, one per press of Start and the same one on a retry of that press. Pass it to the runtime (loomcycle 1.109 or later), so a start whose answer was lost does not start a second walk.
- **`watchWalk` hands over every run of the walk as a row**, sub-agents included. A row's `parentRunId` is what tells them apart: a member's is the walk's own run, a sub-agent's is the run that started it. The canvas lists a sub-agent under its run and does not count it towards its state.
- **`decide` is a real call.** The Decision lab says so before the operator presses Ask: the runtime charges it to the caller.

A complete binding to `@loomcycle/client` is in the loomboard repo: [`src/lib/workflowCanvasData.ts`](https://github.com/denn-gubsky/loomboard/blob/main/src/lib/workflowCanvasData.ts).

## Without the canvas

The model behind the canvas is exported as pure functions, for a host that needs to read or check a definition without drawing one:

```ts
import { fromDefinition, validateModel, canSave } from "@loomboard/workflow";

const findings = validateModel(fromDefinition(definition));
if (!canSave(findings)) console.log(findings.filter((f) => f.level === "error"));
```

`validateModel` mirrors loomcycle's own graph validation. `testdata/validate-cases.json` is the set of cases both are run against.

## Security

- **Model and agent output is rendered as plain text**, never as markup.
- **An imported definition is treated as someone else's text.** Before it replaces the draft, the canvas lists what it carries beyond the graph (hooks, the team's own definitions, channel grants) and asks for a second confirmation. A hook's URL and headers are never shown in that list.
- The canvas holds no token and makes no request of its own. Authentication belongs to the host's data layer.

## Compatibility

Built against loomcycle 1.111. Saving needs 1.104 or later (a team's own definitions and variables). On an older runtime the calls below fail, or the feature is absent, and the canvas says why.

| Feature | loomcycle |
|---|---|
| Check | 1.105 |
| The Decision lab | 1.107 |
| A team's own channels: reading and releasing | 1.108 |
| The Decision node; a Start that is safe to retry | 1.109 |
| A Decision node's answer after a walk | 1.110 |
| A run's sub-agents as rows | 1.111 |

## Changes

### 0.2.0

- The Decision node: a state that asks a decision model and routes on its answer, with a questions editor, the Decision lab, and the recorded answer in Run mode.
- Release held messages from a channel's panel.
- A run's sub-agents listed under it, each with its own answer and prompt.
- Decision models for a team's own agents: the `Decision` tool and the agent's own narrowing of the models.
- Start sends an idempotency key, so a retried start does not begin a second walk.
- Run mode colours only the transition a walk took out of a Decision node.
- `@loomcycle/def-fields` peer dependency is now 0.4.
- New optional data-layer methods: `watchWalkDecisions`, `listDecisionModels`, `decide`, `releaseChannel`, `releaseTeamChannel`. `WalkRunRow` gains `parentRunId` and `startedAt`; `WalkView` gains `children`.

### 0.1.0

The first release: the graph and JSON views, Check, Run mode, a team's own definitions and variables, and building a team by hand.

## License

Apache-2.0
