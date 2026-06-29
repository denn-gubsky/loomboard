# CLAUDE.md — loomboard project guide

This file is loaded by Claude Code on every session in this repo. Read it cold; act from it without re-discovery.

## Project context

**loomboard** is the user-facing application for the **loomcycle** (`../loomcycle` — runtime; `../loomcycle-internal` — internal docs/RFCs) high-load agentic runtime. Its job is to let people do intensive work *with* agents and agentic teams: chat with agents, manage workflows (Agent, AgentDef, Team, TeamDef), create and edit project documents (Path, Document), and visualize agentic processes on Kanban-like boards and other surfaces (team diagrams, architecture/connection graphs).

loomboard is a **React + Vite + TypeScript single-page app**. It is a *thin client*: it talks to a running loomcycle over its HTTP+SSE `/v1/*` wire, using the published **`@loomcycle/client`** SDK. There is **no loomboard backend** — loomcycle owns auth, persistence, and the agent loop. Conversations are loomcycle **sessions** (interactive runs); chat history is reloaded from loomcycle, not stored locally beyond a small `localStorage` index.

The first surface we are building is a **rich chat interface** (Open WebUI-like) powered by loomcycle agents. The RFC lives at `../loomcycle-internal/doc-internal/rfcs/developer-workflow-board.md` (RFC AC) and is being extended to cover chat as a new operator surface. It is a subject of change.

## Development workflow

This is the chain for every non-trivial change. The discipline is what keeps the code small and reviewable.

1. **Architect** — read code first. Understand the component layout, the existing patterns, the data flow for the area you're touching. If you can't name the seam where your change goes, you're not ready to plan.
2. **Plan** — for anything beyond a one-line fix, write a plan: critical files, the change, a verification step. Validate scope with the user when the change touches the wire contract (which loomcycle endpoints/SSE events we consume), auth handling, or how conversations persist.
3. **Feature branch** — `feature-<short-description>` off `main`. Never commit to `main` directly.
4. **Code** — small focused commits. Each commit reviewable in isolation. No "and also fixed this" omnibus commits.
5. **Tests** — `vitest` unit tests for new logic; a regression test for each fix. A regression test *fails on the unfixed code* — verify by reverting the fix and seeing it go red before you commit. Pure modules (the event reducer, metrics math) are the highest-value test targets; keep logic in pure functions so it stays testable without a DOM.
6. **Self-review** — read your own diff cold. Look for accidentally-committed secrets, dead code, stray `console.log`, TODOs without a follow-up.
7. **Typecheck + tests** — `npm run typecheck` and `npm run test` from the repo root. Must pass clean. Don't commit "with one known failure."
8. **Manual test** — `npm run dev`, point the connection settings at a local loomcycle (`../loomcycle`, default `http://127.0.0.1:8787`), and exercise the affected surface in the browser. For a production check, `npm run build` (runs `tsc --noEmit && vite build`) then `npm run preview`. Plain `tsc --noEmit` is only a typecheck — it produces no deployable bundle.
9. **PR** — one branch, one PR. Title says what the change does in one line. Body explains *why* (the user-visible problem), *what* (the technical change), and *what was tested* (test names + manual steps).
10. **Human review** — wait for the user. Do not self-merge. Address comments in additional commits on the same branch (don't force-push unless asked).
11. **Merge** — squash to `main` after approval, PR title as subject, PR body as body.
12. **CI** — keep CI green: typecheck, tests, and build must pass on every PR.

Skip the chain only for trivial fixes (typos, stale comments, obviously-correct one-liners). When in doubt, follow it.

## Karpathy guidelines (coding discipline)

From `andrej-karpathy-skills:karpathy-guidelines`. The gist:

- **Surgical changes.** Modify the minimum surface needed. Don't rewrite adjacent code "while you're there." Don't refactor and change behavior in the same commit. Smaller diff, easier review.
- **Surface assumptions.** Write down non-obvious choices in a comment or the PR body (e.g. "assumes the parked run is still live; falls back to getTranscript otherwise").
- **Verifiable success criteria.** Before coding, write how you'll know it works — a vitest case, a manual curl/browser step, an observable behavior. "It compiles" is not a criterion.
- **Avoid overcomplication.** Prefer the boring solution. A small stdlib/React-built-in beats a dependency. No speculative abstractions; no global-state library until a real need appears (React context + `useReducer` first).
- **Don't trust your first draft.** Re-read each function as if someone else wrote it. Most bugs are obvious on the second read.

## Security rules — non-negotiable

These apply to every interaction with this repo. Violations are bugs even without a visible failure.

1. **Never share secrets.** The loomcycle bearer token, API keys, OAuth tokens — never paste them into responses, tool output, logs, or commits. Reference by env-var name only (e.g. `LOOMCYCLE_AUTH_TOKEN`), never the value.
2. **Never open or edit `.env.local` / `.env*.local`.** These hold the bearer token and are git-ignored. Reading them surfaces secrets into context; editing them can clobber the user's config. **Exception:** the user explicitly asks you to edit a specific line. Otherwise, when asked to "set X", suggest the line to add manually (e.g. "add `VITE_FOO=bar` to `.env.local`").
3. **Ignore secrets you happen to see.** If a token appears in a log, stack trace, or diff — do not echo it, commit it, or reference its value. Reference by name only.
4. **Treat these name patterns as secrets:** anything matching `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_AUTH`, `*_PASSWORD`, `*_CREDENTIAL`. The loomcycle bearer (`LOOMCYCLE_AUTH_TOKEN`) authorizes all `/v1/*` calls — never log or echo its value. In the browser the token lives in `localStorage`; never serialize it into a screenshot, error report, or telemetry payload.
5. **Targeted `git add`, never `git add .` / `-A`** when uncertain what's staged. `.env*`, `*.pem` can sweep in. Use explicit paths and check `git status --short` before commit.
6. **The token is the user's, scoped by loomcycle.** loomboard does not implement its own authz — it forwards the bearer and respects loomcycle's `whoami`/principal. Don't fabricate tenant/subject; don't widen scope client-side. loomcycle's principal is authoritative.
7. **Don't weaken input trust boundaries.** Agent/model output rendered as Markdown must stay sandboxed: no raw HTML injection that executes (`rehype-raw` with untrusted content is out unless deliberately sanitized), links open safely. Treat all agent/tool output as untrusted content to render, never as code to run.

## Code conventions

- **TypeScript:** `strict` on. No `any` that hides a real type — prefer `unknown` + narrowing. Type from the SDK (`@loomcycle/client`) rather than re-declaring wire shapes.
- **React:** function components + hooks. Keep side-effecting orchestration in hooks (`useChat`) and rendering logic in components; keep wire-event folding in **pure functions** (`lib/eventReducer.ts`, `lib/metrics.ts`) so it's unit-testable.
- **State:** React context + `useReducer` + hooks. No Redux/Zustand/etc. unless a concrete need is demonstrated.
- **Files:** components in `src/components/*.tsx` (PascalCase), hooks in `src/hooks/*.ts` (`useX`), pure libs in `src/lib/*.ts`, persisted state in `src/state/*.ts`.
- **Test naming:** `describe("eventReducer")` / `it("accumulates streamed text into one assistant message")` — the behavior describes the postcondition asserted, not the input.
- **Formatting:** keep it consistent (2-space indent, double quotes, semicolons — match existing files). If a formatter/linter is added later, run it before commit.
- **Comments explain WHY, not WHAT.** The constraint, the surprising-but-correct invariant, the wire quirk (e.g. "compactRun 409s mid-turn, so the button is gated on awaiting_input"). Don't narrate the next line.
- **No dead shims.** Delete unused code; don't keep stubs or "deprecated, ignored" branches.

## Cross-repo notes

- **`@loomcycle/client`** is the wire contract. It's published from the loomcycle monorepo (`../loomcycle/adapters/ts`, npm `@loomcycle/client`). Depend on a **pinned version**; bump deliberately. If a feature needs a newer client method, land/publish it in loomcycle first, then bump here.
- **Wire changes** (new `/v1/*` shapes, new SSE event types) originate in loomcycle. loomboard consumes them; it never assumes a shape the published client doesn't expose. When unsure what an endpoint/event looks like, read `../loomcycle/adapters/ts/src/{client.ts,types.ts}` and `../loomcycle/internal/api/http/`.
- **RFCs** live in `../loomcycle-internal/doc-internal/rfcs/`. The loomboard RFC is AC (`developer-workflow-board.md`). Keep design decisions reflected there.

## When in doubt

- Look at recent commits on `main` (`git log --oneline -20`) for the style of recent changes.
- To learn an endpoint or SSE event, read the SDK source in `../loomcycle/adapters/ts/src/` — it's the source of truth for the wire.
- Ask the user. A 30-second clarification beats an hour of speculative work.
