import type { BrowserCommand } from "./protocol";

// Mediates between the (non-React) channel loop and the React approval bar. The
// loop calls request(cmd) before executing a mutating command in confirm mode;
// the ActionBar renders the pending action and calls approve()/reject(), which
// resolves the loop's promise. Only one action is pending at a time (the loop
// awaits each before processing the next).

export interface PendingAction {
  cmd: BrowserCommand;
  approve: () => void;
  reject: () => void;
}

type Listener = (pending: PendingAction | null) => void;

class ApprovalController {
  private pending: PendingAction | null = null;
  private readonly listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.pending);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Ask the user to approve a command. Resolves true (approve) / false
   *  (reject). */
  request(cmd: BrowserCommand): Promise<boolean> {
    // Supersede any stale pending action (shouldn't happen — the loop is
    // serial — but keeps the controller consistent).
    this.pending?.reject();
    return new Promise<boolean>((resolve) => {
      const settle = (v: boolean) => {
        if (this.pending?.cmd.id !== cmd.id) return;
        this.pending = null;
        this.emit();
        resolve(v);
      };
      this.pending = {
        cmd,
        approve: () => settle(true),
        reject: () => settle(false),
      };
      this.emit();
    });
  }

  /** Reject any pending action (Stop / teardown). */
  cancelPending(): void {
    this.pending?.reject();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.pending);
  }
}

export const approval = new ApprovalController();
