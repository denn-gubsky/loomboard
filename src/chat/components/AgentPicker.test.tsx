// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AgentPicker from "./AgentPicker";
import type { AgentEntry } from "../hooks/useAgents";

// What the picker offers under a host's agent filter: the select from the
// library, and the free-text suggestions when the library cannot be read.

function agent(name: string): AgentEntry {
  return { name, source: "static-only", in_static: true, in_substrate: false, version_count: 0 };
}

const isChat = (name: string) => name.startsWith("chat/");
const library = [agent("chat/medium"), agent("team/writer"), agent("chat/local")];

function offered(): string[] {
  return screen.getAllByRole("option").flatMap((o) => ((o as HTMLOptionElement).disabled ? [] : [o.textContent ?? ""]));
}

afterEach(cleanup);

describe("AgentPicker", () => {
  it("offers only the agents the filter accepts", () => {
    render(<AgentPicker value="" onChange={() => {}} agents={library} loading={false} error={null} agentFilter={isChat} />);
    expect(offered()).toEqual(["chat/medium", "chat/local"]);
  });

  it("offers every agent without a filter", () => {
    render(<AgentPicker value="" onChange={() => {}} agents={library} loading={false} error={null} />);
    expect(offered()).toEqual(["chat/medium", "team/writer", "chat/local"]);
  });

  it("keeps a filtered-out agent the conversation already uses, selected", () => {
    render(
      <AgentPicker value="team/writer" onChange={() => {}} agents={library} loading={false} error={null} agentFilter={isChat} />,
    );
    expect(offered()).toEqual(["chat/medium", "team/writer", "chat/local"]);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("team/writer");
  });

  it("filters the free-text suggestions too, unless none would be left", () => {
    const { container, rerender } = render(
      <AgentPicker
        value=""
        onChange={() => {}}
        agents={[]}
        loading={false}
        error="forbidden"
        knownAgents={["chat/medium", "team/writer"]}
        agentFilter={isChat}
      />,
    );
    const suggestions = () => Array.from(container.querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
    expect(suggestions()).toEqual(["chat/medium"]);
    rerender(
      <AgentPicker
        value=""
        onChange={() => {}}
        agents={[]}
        loading={false}
        error="forbidden"
        knownAgents={["team/writer"]}
        agentFilter={isChat}
      />,
    );
    expect(suggestions()).toEqual(["team/writer"]);
  });
});
