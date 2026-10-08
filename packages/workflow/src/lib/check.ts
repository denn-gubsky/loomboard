// The runtime's check of an unsaved team (RFC DX phase 5; loomcycle RFC DY,
// `TeamDef op=verify` with an overlay): everything a save would be refused
// for, and everything that would stop the saved team running, in one answer,
// with nothing written.
//
// This module turns that answer into what the canvas shows. The canvas's own
// findings (lib/validate.ts) mirror the graph rules and are instant; these
// come from the runtime, which also knows the caller's authority, the agents
// and channels that exist, and the agent checks.
//
// Pure: no React, no network.

import type { JsonPath } from "./teamJson";
import type { TeamCheck, TeamCheckIssue } from "../types";
import type { Finding } from "./validate";

/** The name an unnamed draft is checked under. Its own name is not checked
 *  until it has one (lib/newTeam.ts teamNameError does that at create). */
export const UNNAMED_TEAM = "new-team";

/** A runtime issue path — `states[2].handler.sink.channel`, `local.agents.x`,
 *  `vars["has space"]` — as a JsonPath. A key outside `[A-Za-z0-9_-]+` is a
 *  bracketed JSON string. What cannot be read ends the path there: a shorter
 *  path still points at an enclosing value. */
export function parseIssuePath(path: string): JsonPath {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      i++;
    } else if (c === "[") {
      if (path[i + 1] === '"') {
        // A JSON string: find its closing quote, skipping escapes.
        let j = i + 2;
        while (j < path.length && path[j] !== '"') j += path[j] === "\\" ? 2 : 1;
        if (path[j] !== '"' || path[j + 1] !== "]") return out;
        try {
          out.push(JSON.parse(path.slice(i + 1, j + 1)) as string);
        } catch {
          return out;
        }
        i = j + 2;
      } else {
        const end = path.indexOf("]", i);
        const n = end < 0 ? NaN : Number(path.slice(i + 1, end));
        if (!Number.isInteger(n) || n < 0) return out;
        out.push(n);
        i = end + 1;
      }
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(path.slice(i));
      if (!m) return out;
      out.push(m[0]);
      i += m[0].length;
    }
  }
  return out;
}

// The server prefixes graph errors for its own logs; the canvas's findings
// drop it (lib/validate.ts), and so do these.
const PREFIX = "team definition: ";

/** One runtime issue as a finding the canvas can place: on its state, and at
 *  its line in the JSON view. `refused` and `unrunnable` are errors;
 *  `advisory` stops nothing. */
export function issueFinding(issue: TeamCheckIssue): Finding {
  const detail = issue.detail.startsWith(PREFIX) ? issue.detail.slice(PREFIX.length) : issue.detail;
  const path = issue.path ? parseIssuePath(issue.path) : [];
  return {
    level: issue.severity === "advisory" ? "info" : "error",
    message: issue.severity === "unrunnable" ? `${detail} (it would be saved, but could not run)` : detail,
    ...(issue.state ? { nodeId: issue.state } : {}),
    ...(path.length ? { path } : {}),
  };
}

export function checkFindings(check: TeamCheck): Finding[] {
  return (check.issues ?? []).map(issueFinding);
}

export interface CheckSummary {
  tone: "ok" | "warn" | "error";
  text: string;
}

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The check in one line: would the save be accepted, and could it run. */
export function checkSummary(check: TeamCheck): CheckSummary {
  const issues = check.issues ?? [];
  const refused = issues.filter((i) => i.severity === "refused").length;
  const unrunnable = issues.filter((i) => i.severity === "unrunnable").length;
  const advisory = issues.length - refused - unrunnable;
  if (!check.valid) {
    return { tone: "error", text: `The runtime would refuse this save: ${count(refused || issues.length, "problem")}.` };
  }
  if (check.runnable === false) {
    return { tone: "warn", text: `The runtime would save this, but a walk could not run it: ${count(unrunnable, "problem")}.` };
  }
  return {
    tone: "ok",
    text: "The runtime accepts this team, and a walk could run it." + (advisory ? ` ${count(advisory, "note")}.` : ""),
  };
}
