import { describe, expect, it } from "vitest";
import { publishOutcomeMessage, publishPreflight, type PreflightInput } from "./publish";
import { hookNamesOf } from "./hooks";

const base: PreflightInput = {
  channel: "sdlc-intake",
  info: { name: "sdlc-intake", scope: "tenant", message_count: 0 },
  channelsLoaded: true,
  loadedDefId: "def-1",
  activeDefId: "def-1",
  payloadText: '{"path": "/docs/rfp/acme"}',
};

const of = (o: Partial<PreflightInput> = {}) => publishPreflight({ ...base, ...o });
const messages = (o: Partial<PreflightInput> = {}) => of(o).issues.map((i) => i.message).join(" | ");
const blocks = (o: Partial<PreflightInput> = {}) =>
  of(o).issues.filter((i) => i.level === "block");

describe("publishPreflight — the happy path", () => {
  it("allows a well-formed publish and reports nothing", () => {
    const r = of();
    expect(r.canPublish).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.payload).toEqual({ path: "/docs/rfp/acme" });
    expect(r.scope).toBe("tenant");
  });

  it("resolves the scope from the CHANNEL's declaration, not the caller", () => {
    // Publishing at the wrong scope succeeds and then never arrives, which is
    // the worst failure shape available here.
    expect(of({ info: { name: "c", scope: "global" } }).scope).toBe("global");
    expect(of({ info: { name: "c", scope: "user" } }).scope).toBe("user");
  });
});

describe("publishPreflight — things that would silently not start a run", () => {
  it("blocks an agent-scoped channel a walk can never read", () => {
    // The publish would SUCCEED and the Starter would never see it.
    const r = of({ info: { name: "c", scope: "agent" } });
    expect(r.canPublish).toBe(false);
    expect(messages({ info: { name: "c", scope: "agent" } })).toMatch(/never see it/);
  });

  it("blocks an undeclared channel", () => {
    expect(blocks({ info: undefined })).toHaveLength(1);
    expect(messages({ info: undefined })).toMatch(/not declared/);
  });

  it("does NOT claim undeclared before the channel list has loaded", () => {
    // Absence of info means "not declared" only when we actually looked.
    // Otherwise a slow list would block every publish on startup.
    const r = of({ info: undefined, channelsLoaded: false });
    expect(r.canPublish).toBe(true);
  });

  it("warns that a held channel stores the message and runs nothing", () => {
    const r = of({ info: { name: "c", scope: "tenant", hold: true } });
    expect(r.canPublish).toBe(true); // publishing is still legitimate
    expect(messages({ info: { name: "c", scope: "tenant", hold: true } })).toMatch(/HELD/);
  });

  it("warns that a backlog widens the wave beyond the message being sent", () => {
    // The non-obvious one: publishing ONE message to a channel holding forty
    // starts a wave of forty-one, because per=message fans out over what is
    // already there.
    const info = { name: "c", scope: "tenant", message_count: 40 };
    expect(messages({ info })).toMatch(/40 messages already queued/);
    expect(messages({ info })).toMatch(/wider than the one message/);
  });

  it("uses the singular for a backlog of one", () => {
    expect(messages({ info: { name: "c", scope: "tenant", message_count: 1 } })).toMatch(
      /1 message already queued/,
    );
  });

  it("warns when the graph on screen is not the version a publish would run", () => {
    // A publish reaches the PROMOTED version through its armed subscription.
    const m = messages({ loadedDefId: "def-9", activeDefId: "def-1" });
    expect(m).toMatch(/PROMOTED version/);
    expect(m).toMatch(/def-9/);
    expect(m).toMatch(/def-1/);
  });

  it("says nothing about versions when they agree, or when either is unknown", () => {
    expect(of({ loadedDefId: "d", activeDefId: "d" }).issues).toEqual([]);
    expect(of({ activeDefId: undefined }).issues).toEqual([]);
    expect(of({ loadedDefId: undefined }).issues).toEqual([]);
  });
});

describe("publishPreflight — the payload", () => {
  it("blocks a payload that is not JSON, naming the parse error", () => {
    const r = of({ payloadText: "{not json" });
    expect(r.canPublish).toBe(false);
    expect(r.payload).toBeUndefined();
    expect(messages({ payloadText: "{not json" })).toMatch(/not valid JSON/);
  });

  it("blocks an empty payload", () => {
    expect(blocks({ payloadText: "   " })).toHaveLength(1);
  });

  it("accepts any JSON value, not only an object", () => {
    // A channel message is arbitrary JSON; a Starter's binds project out of
    // whatever shape arrives.
    expect(of({ payloadText: '"just a string"' }).payload).toBe("just a string");
    expect(of({ payloadText: "[1,2]" }).payload).toEqual([1, 2]);
  });
});

describe("publishPreflight — nothing to publish to", () => {
  it("blocks when the entry state reads no channel", () => {
    const r = of({ channel: "  " });
    expect(r.canPublish).toBe(false);
    expect(r.issues).toHaveLength(1);
    // And short-circuits: no point complaining about the payload too.
    expect(r.issues[0].message).toMatch(/nothing to publish to/);
  });
});

describe("publishPreflight — hooked channels (RFC DK D6)", () => {
  it("warns that a hooked channel may rewrite, drop or hold the message, naming its hooks", () => {
    const r = of({ info: { name: "c", scope: "tenant", hooks: ["moderate", "redact"] } });
    expect(r.canPublish).toBe(true);
    expect(messages({ info: { name: "c", scope: "tenant", hooks: ["moderate", "redact"] } })).toMatch(
      /carries hooks \(moderate, redact\).*delivered only if they release it/,
    );
  });

  it("says nothing about hooks on a channel that has none", () => {
    expect(messages({ info: { name: "c", scope: "tenant", hooks: [] } })).not.toMatch(/hook/);
  });
});

describe("publishPreflight — the backlog counts only what a Starter can read", () => {
  // message_count includes messages a reader cannot see yet. Counting them
  // overstated the wave, and on a hooked channel said "forty queued" when the
  // Starter would read none of them.
  it("does not warn when everything stored is held or awaiting hooks", () => {
    const info = { name: "c", scope: "tenant", message_count: 10, held_count: 3, awaiting_hooks_count: 7 };
    expect(messages({ info })).not.toMatch(/already queued/);
  });

  it("counts only the visible remainder", () => {
    const info = { name: "c", scope: "tenant", message_count: 5, awaiting_hooks_count: 2 };
    expect(messages({ info })).toMatch(/^3 messages already queued/);
  });
});

describe("publishOutcomeMessage", () => {
  it.each([
    [undefined, "Published."],
    [{}, "Published."],
    [{ awaiting_hooks: true }, "Stored, waiting for the channel's hooks — delivered only if they release it."],
    [{ held: true }, "Stored, held — delivered to nobody until the hold is released."],
    [{ dropped_oldest: 2 }, "Published. The channel was full: 2 older messages were trimmed to make room."],
  ])("reports %j as %s", (outcome, text) => {
    expect(publishOutcomeMessage(outcome)).toBe(text);
  });

  it("never says Published for a message nobody can read yet", () => {
    expect(publishOutcomeMessage({ awaiting_hooks: true, held: true })).not.toMatch(/Published/);
  });
});

describe("hookNamesOf", () => {
  it("names each hook once, never carrying an inline webhook's endpoint", () => {
    const names = hookNamesOf({
      channel_publish: [
        "moderate@2",
        { name: "redact", url: "https://x.example/h?token=s3cr3t", headers: { "X-K": "$cred:k" } },
        "moderate@2",
      ],
    });
    expect(names).toEqual(["moderate@2", "redact"]);
    expect(names.join(" ")).not.toMatch(/s3cr3t|\$cred|https:/);
  });

  it("is empty for anything that is not a hooks map", () => {
    expect(hookNamesOf(undefined)).toEqual([]);
    expect(hookNamesOf(["x"])).toEqual([]);
  });
});
