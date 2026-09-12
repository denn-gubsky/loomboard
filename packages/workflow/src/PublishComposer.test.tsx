// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishComposer, type PublishComposerProps } from "./PublishComposer";

afterEach(cleanup);

const base: PublishComposerProps = {
  channel: "sdlc-intake",
  info: { name: "sdlc-intake", scope: "tenant", message_count: 0 },
  channelsLoaded: true,
  loadedDefId: "def-1",
  activeDefId: "def-1",
  onPublish: async () => undefined,
  onClose: () => undefined,
};

const show = (o: Partial<PublishComposerProps> = {}) => render(<PublishComposer {...base} {...o} />);

const payload = () => screen.getByLabelText(/Message/) as HTMLTextAreaElement;
const publishBtn = () => screen.getByRole("button", { name: /^Publish$/ }) as HTMLButtonElement;

describe("PublishComposer", () => {
  it("publishes the parsed payload at the channel's declared scope", async () => {
    // Scope comes from the channel, never a default: publishing at the wrong
    // one succeeds and then never arrives.
    const onPublish = vi.fn(async () => undefined);
    show({ onPublish, info: { name: "c", scope: "global" } });
    fireEvent.change(payload(), { target: { value: '{"path":"/docs/rfp/acme"}' } });
    fireEvent.click(publishBtn());
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    expect(onPublish).toHaveBeenCalledWith({ path: "/docs/rfp/acme" }, "global");
  });

  it("refuses to publish a payload that is not JSON", async () => {
    const onPublish = vi.fn(async () => undefined);
    show({ onPublish });
    fireEvent.change(payload(), { target: { value: "{oops" } });
    await waitFor(() => expect(publishBtn().disabled).toBe(true));
    expect(screen.getByText(/not valid JSON/)).toBeTruthy();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("blocks a channel a walk can never read, explaining the silent failure", async () => {
    show({ info: { name: "c", scope: "agent" } });
    fireEvent.change(payload(), { target: { value: "{}" } });
    await waitFor(() => expect(publishBtn().disabled).toBe(true));
    expect(screen.getByText(/never see it/)).toBeTruthy();
  });

  it("warns about a held channel but still allows the publish", async () => {
    // Queueing behind a hold is legitimate — the operator just has to know
    // nothing will run yet.
    show({ info: { name: "c", scope: "tenant", hold: true } });
    fireEvent.change(payload(), { target: { value: "{}" } });
    await waitFor(() => expect(publishBtn().disabled).toBe(false));
    expect(screen.getByText(/HELD/)).toBeTruthy();
  });

  it("warns that a backlog makes the wave wider than the message sent", async () => {
    show({ info: { name: "c", scope: "tenant", message_count: 40 } });
    expect(screen.getByText(/40 messages already queued/)).toBeTruthy();
  });

  it("warns when the graph on screen is not the version a publish would run", () => {
    show({ loadedDefId: "def-9", activeDefId: "def-1" });
    expect(screen.getByText(/PROMOTED version/)).toBeTruthy();
  });

  it("surfaces a publish failure rather than reporting success", async () => {
    show({
      onPublish: async () => {
        throw new Error("channel_not_declared");
      },
    });
    fireEvent.change(payload(), { target: { value: "{}" } });
    fireEvent.click(publishBtn());
    expect(await screen.findByText(/channel_not_declared/)).toBeTruthy();
    expect(screen.queryByText(/^Published\.$/)).toBeNull();
  });

  it("confirms a successful publish", async () => {
    show();
    fireEvent.change(payload(), { target: { value: "{}" } });
    fireEvent.click(publishBtn());
    expect(await screen.findByText(/^Published\.$/)).toBeTruthy();
  });
});
