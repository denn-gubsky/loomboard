/** What the read-aloud control shows. `loading` while the next piece is not
 *  back yet (the request may also be waiting in loomcycle's engine queue). */
export type SpeechStatus = "idle" | "loading" | "playing" | "paused";

export interface SpeechPlayerState {
  /** The reply being read, by the host's key; null when idle. */
  key: string | null;
  status: SpeechStatus;
  /** Why reading a reply stopped, kept until the next play or stop. */
  error: { key: string; message: string } | null;
  /** The server said read-aloud is not this user's any more (a 403, or the
   *  engine switched off): the controls hide for the rest of the session. */
  unavailable: boolean;
}

/** The part of HTMLAudioElement the player uses, so tests can drive it. */
export interface AudioLike {
  src: string;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SpeechPlayerDeps {
  /** One piece's audio. Aborted when the reading stops. */
  synthesize(text: string, signal: AbortSignal): Promise<Blob>;
  createAudio(): AudioLike;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** A user-facing message for a failure. */
  describe(e: unknown): string;
  /** Whether a failure means read-aloud is unavailable to this user. */
  isUnavailable(e: unknown): boolean;
  /** How much synthesised audio to keep for replaying, in bytes. */
  cacheBytes?: number;
}

export interface SpeechPlayer {
  getState(): SpeechPlayerState;
  subscribe(listener: () => void): () => void;
  /** Read `pieces` aloud as reply `key`, stopping whatever was playing. Call
   *  it from the click: it unlocks the audio element before any await. */
  play(key: string, pieces: string[]): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Stop any reading and unlock the audio element, from a gesture that is not
   *  a play: the mic, before a reply is read on its own when the turn ends
   *  (RFC FX §7.3). Stopping keeps the reply out of the recording. */
  prime(): void;
  /** Stop and drop the cached audio (connection change, unmount). */
  dispose(): void;
}

const IDLE: SpeechPlayerState = { key: null, status: "idle", error: null, unavailable: false };

// One silent 16-bit sample. Safari and WKWebView let an audio element play
// only from inside a user gesture, and the first piece arrives after a network
// round trip, when the gesture is spent. Playing this from the click unlocks
// the element, and later play() calls on the same element are allowed.
const SILENCE = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

interface Session {
  key: string;
  abort: AbortController;
  url: string | null;
  /** Ends the wait on the current piece when the session is stopped. */
  interrupt: (() => void) | null;
}

/** The read-aloud engine of one chat: one reading at a time, each piece
 *  fetched while the one before it plays, and played audio kept (by text) in
 *  a small cache so a reply reads again for free. */
export function createSpeechPlayer(deps: SpeechPlayerDeps): SpeechPlayer {
  const cacheLimit = deps.cacheBytes ?? 20 * 1024 * 1024;
  const cache = new Map<string, Blob>();
  let cachedBytes = 0;
  const listeners = new Set<() => void>();
  let state = IDLE;
  let session: Session | null = null;
  let audio: AudioLike | null = null;

  function set(patch: Partial<SpeechPlayerState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  }

  function remember(text: string, blob: Blob) {
    if (blob.size > cacheLimit) return;
    cache.set(text, blob);
    cachedBytes += blob.size;
    for (const [oldest, old] of cache) {
      if (cachedBytes <= cacheLimit) break;
      cache.delete(oldest);
      cachedBytes -= old.size;
    }
  }

  function fetchPiece(text: string, signal: AbortSignal): Promise<Blob> {
    const hit = cache.get(text);
    if (hit) {
      cache.delete(text);
      cache.set(text, hit);
      return Promise.resolve(hit);
    }
    return deps.synthesize(text, signal).then((blob) => {
      remember(text, blob);
      return blob;
    });
  }

  function release(s: Session) {
    if (s.url) deps.revokeObjectURL(s.url);
    s.url = null;
  }

  function endSession() {
    const s = session;
    if (!s) return;
    session = null;
    s.abort.abort();
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    release(s);
    s.interrupt?.();
  }

  function playBlob(s: Session, el: AudioLike, blob: Blob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      s.interrupt = resolve;
      s.url = deps.createObjectURL(blob);
      el.onended = () => {
        release(s);
        resolve();
      };
      el.onerror = () => {
        release(s);
        reject(new Error("The audio could not be played."));
      };
      el.src = s.url;
      el.play().then(
        () => {
          if (session === s) set({ status: "playing" });
        },
        (e: unknown) => {
          release(s);
          reject(e);
        },
      );
    });
  }

  async function read(s: Session, el: AudioLike, pieces: string[]) {
    let ready = false;
    const track = (p: Promise<Blob>) => {
      ready = false;
      p.then(
        () => (ready = true),
        () => (ready = true),
      );
      return p;
    };
    let next = track(fetchPiece(pieces[0], s.abort.signal));
    try {
      for (let i = 0; i < pieces.length; i++) {
        if (i > 0 && !ready) set({ status: "loading" });
        const blob = await next;
        if (session !== s) return;
        if (i + 1 < pieces.length) next = track(fetchPiece(pieces[i + 1], s.abort.signal));
        await playBlob(s, el, blob);
        if (session !== s) return;
      }
      session = null;
      set({ key: null, status: "idle" });
    } catch (e) {
      // A stopped session's abort lands here too; it is not a failure.
      if (session !== s) return;
      session = null;
      release(s);
      set({
        key: null,
        status: "idle",
        error: { key: s.key, message: deps.describe(e) },
        unavailable: state.unavailable || deps.isUnavailable(e),
      });
    } finally {
      // The piece fetched ahead may still reject after a stop; nobody awaits it.
      next.catch(() => undefined);
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play(key, pieces) {
      endSession();
      if (pieces.length === 0) return;
      const el = (audio ??= deps.createAudio());
      // Unlock inside the gesture (see SILENCE); its outcome does not matter.
      el.onended = null;
      el.onerror = null;
      el.src = SILENCE;
      el.play().catch(() => undefined);
      const s: Session = { key, abort: new AbortController(), url: null, interrupt: null };
      session = s;
      set({ key, status: "loading", error: null });
      void read(s, el, pieces);
    },
    pause() {
      if (!session || state.status !== "playing") return;
      audio?.pause();
      set({ status: "paused" });
    },
    resume() {
      if (!session || state.status !== "paused" || !audio) return;
      audio.play().catch(() => undefined);
      set({ status: "playing" });
    },
    stop() {
      endSession();
      set({ key: null, status: "idle", error: null });
    },
    prime() {
      endSession();
      if (state.key !== null || state.status !== "idle") set({ key: null, status: "idle", error: null });
      const el = (audio ??= deps.createAudio());
      el.onended = null;
      el.onerror = null;
      el.src = SILENCE;
      el.play().catch(() => undefined);
    },
    dispose() {
      endSession();
      if (audio) audio.src = "";
      cache.clear();
      cachedBytes = 0;
      state = IDLE;
    },
  };
}
