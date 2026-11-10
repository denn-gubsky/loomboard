// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../lib/eventReducer";
import type { ReadAloud } from "./useReadAloud";
import { useVoiceReplies } from "./useVoiceReplies";

const user = (text: string): ChatMessage => ({ role: "user", text });
const reply = (text: string, status: "streaming" | "done" | "error" = "done"): ChatMessage => ({
  role: "assistant",
  status,
  parts: [{ type: "text", text }],
});

function reader(): ReadAloud {
  return {
    state: { key: null, status: "idle", error: null, unavailable: false },
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    prime: vi.fn(),
  };
}

// A chat's run as the hook sees it: running and the message list, per render.
function setup(initial: ChatMessage[] = []) {
  const readAloud = reader();
  const hook = renderHook(
    ({ running, messages, resetKey }) => useVoiceReplies(readAloud, running, messages, resetKey),
    { initialProps: { running: false, messages: initial, resetKey: "c1" } },
  );
  const at = (running: boolean, messages: ChatMessage[], resetKey = "c1") => hook.rerender({ running, messages, resetKey });
  return { readAloud, hook, at };
}

describe("useVoiceReplies", () => {
  it("reads the reply of a voice message once its turn has run and stopped", () => {
    const { readAloud, hook, at } = setup([user("Hi"), reply("Hello.")]);
    hook.result.current.sent(true, 2);
    at(false, [user("Hi"), reply("Hello."), user("Book a room")]); // the turn has not started yet
    expect(readAloud.play).not.toHaveBeenCalled();
    at(true, [user("Hi"), reply("Hello."), user("Book a room"), reply("Booked", "streaming")]);
    expect(readAloud.play).not.toHaveBeenCalled(); // never while it streams
    at(false, [user("Hi"), reply("Hello."), user("Book a room"), reply("Booked for Friday.")]);
    expect(readAloud.play).toHaveBeenCalledWith("3", "Booked for Friday.");
    at(true, [user("Hi"), reply("Hello."), user("Book a room"), reply("Booked for Friday."), user("x")]);
    at(false, [user("Hi"), reply("Hello."), user("Book a room"), reply("Booked for Friday."), user("x"), reply("y")]);
    expect(readAloud.play).toHaveBeenCalledTimes(1); // one reading per voice message
  });

  it("waits for a reply still settling after the run stopped", () => {
    const { readAloud, hook, at } = setup();
    hook.result.current.sent(true, 0);
    at(true, [user("Book"), reply("Bo", "streaming")]);
    at(false, [user("Book"), reply("Booked", "streaming")]);
    expect(readAloud.play).not.toHaveBeenCalled();
    at(false, [user("Book"), reply("Booked.")]);
    expect(readAloud.play).toHaveBeenCalledWith("1", "Booked.");
  });

  it("reads nothing for a typed message, a stopped turn or another conversation", () => {
    const typed = setup();
    typed.hook.result.current.sent(false, 0);
    typed.at(true, [user("Typed")]);
    typed.at(false, [user("Typed"), reply("Answer.")]);
    expect(typed.readAloud.play).not.toHaveBeenCalled();

    const stopped = setup();
    stopped.hook.result.current.sent(true, 0);
    stopped.at(true, [user("Book"), reply("Bo", "streaming")]);
    stopped.hook.result.current.cancel();
    stopped.at(false, [user("Book"), reply("Bo")]);
    expect(stopped.readAloud.play).not.toHaveBeenCalled();

    const switched = setup();
    switched.hook.result.current.sent(true, 0);
    switched.at(true, [user("Book")]);
    switched.at(false, [user("Other chat"), reply("Other answer.")], "c2");
    expect(switched.readAloud.play).not.toHaveBeenCalled();
  });
});
