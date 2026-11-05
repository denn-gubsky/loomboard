import { useEffect, useState } from "react";
import type { LoomcycleClient, SpeechDirectionInfo, TranscriptionDirectionInfo } from "@loomcycle/client";

/** What the server offers this caller in each voice direction; null where
 *  it offers nothing (or the host turned it off). */
export interface SpeechCaps {
  speech: SpeechDirectionInfo | null;
  transcription: TranscriptionDirectionInfo | null;
}

const NONE: SpeechCaps = { speech: null, transcription: null };

/** Whether the server offers read-aloud and voice input to this caller, and
 *  how. Asked once per client, never by trying a request: `whoami` says
 *  whether each engine is on and the caller passes its route's gates
 *  (loomcycle 1.140+), and only then is `speechInfo` read. A client without
 *  speechInfo (the package's peer range starts below 1.140) or any failure
 *  means neither. */
export function useSpeechCaps(client: LoomcycleClient, want: { output: boolean; input: boolean }): SpeechCaps {
  const [caps, setCaps] = useState<SpeechCaps>(NONE);
  const { output, input } = want;
  useEffect(() => {
    setCaps(NONE);
    if ((!output && !input) || typeof (client as Partial<LoomcycleClient>).speechInfo !== "function") return;
    let live = true;
    (async () => {
      const surfaces = (await client.whoami()).effective?.surfaces;
      const speak = output && surfaces?.speech === true;
      const hear = input && surfaces?.transcription === true;
      if (!speak && !hear) return;
      const info = await client.speechInfo();
      if (!live) return;
      setCaps({
        speech: speak && info.speech.enabled ? info.speech : null,
        transcription: hear && info.transcription.enabled ? info.transcription : null,
      });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, output, input]);
  return caps;
}
