// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignInCard from "./SignInCard";

const onSignIn = vi.fn();
const onConnectToken = vi.fn();

function renderCard(over: Partial<Parameters<typeof SignInCard>[0]> = {}) {
  return render(
    <SignInCard
      intro="intro"
      baseUrl="https://loomcycle.example"
      onBaseUrlChange={() => {}}
      baseUrlPlaceholder=""
      baseUrlHint=""
      blankBaseUrl={null}
      busy={false}
      onSignIn={onSignIn}
      onConnectToken={onConnectToken}
      initialToken=""
      tokenHint=""
      error={null}
      problem={null}
      registration={{ preset: true }}
      {...over}
    />,
  );
}

// What the browser does when the person clicks the summary.
function openAdvanced(container: HTMLElement) {
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

const signInButton = () => screen.queryByRole("button", { name: /Sign in with loomcycle/ });
const tokenButton = () => screen.getByRole("button", { name: "Connect with token", hidden: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignInCard", () => {
  it("offers Sign in with loomcycle as the primary action while Advanced is closed", () => {
    renderCard();
    expect(signInButton()?.className).toBe("btn-primary");
    fireEvent.submit(screen.getByDisplayValue("https://loomcycle.example"));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onConnectToken).not.toHaveBeenCalled();
  });

  it("hides the sign-in button and makes Connect with token primary once Advanced opens", () => {
    const { container } = renderCard();
    openAdvanced(container);
    expect(signInButton()).toBeNull();
    expect(tokenButton().className).toBe("btn-primary");
  });

  it("connects with the token, not a sign-in, when Enter is pressed in the Base URL with Advanced open", () => {
    renderCard({ initialToken: "  tok-123  " });
    fireEvent.submit(screen.getByDisplayValue("https://loomcycle.example"));
    expect(onConnectToken).toHaveBeenCalledWith("tok-123");
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("keeps a sign-in that is waiting on loomcycle's page cancellable with Advanced open", () => {
    const onCancel = vi.fn();
    renderCard({ initialToken: "tok", busy: true, waitingLabel: "Waiting for loomcycle…", onCancel });
    expect(screen.getByText(/Waiting for loomcycle/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
