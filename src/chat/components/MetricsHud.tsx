import { ArrowDown, ArrowUp, Cpu, Gauge, Zap } from "lucide-react";
import {
  contextPercent,
  formatCount,
  type TokenMetrics,
} from "../lib/metrics";

interface Props {
  metrics: TokenMetrics;
  /** Rough size of the visible transcript. Shown only once it has clearly
   *  outgrown the prompt, which is the state that means the runtime is distilling
   *  — below that it merely agrees with the gauge and explains nothing. It is
   *  NOT a prompt size: a prompt also carries the system prompt, the tool
   *  definitions and injected memory. */
  conversationTokens?: number;
  tokensPerSec: number;
  running: boolean;
  servingModel: string | null;
  servingProvider: string | null;
}

// Live token HUD: the provider/model actually serving the run (reflects any
// provider fallback), cumulative ▲ input / ▼ output, tokens/sec, and a
// context-window gauge when the model reports its ceiling.
export default function MetricsHud({
  metrics,
  conversationTokens,
  tokensPerSec,
  running,
  servingModel,
  servingProvider,
}: Props) {
  const pct = contextPercent(metrics);
  // The transcript is worth showing only once it has clearly outgrown the
  // prompt: that gap IS the evidence that the runtime is distilling. While the
  // prompt still carries everything the two agree, and a second number that
  // agrees with the first explains nothing. (It also reads smaller than the
  // prompt in that state, since a prompt carries the system prompt, the tool
  // definitions and injected memory that no transcript shows.)
  const outgrown =
    conversationTokens !== undefined &&
    metrics.contextTokens > 0 &&
    conversationTokens > metrics.contextTokens * 1.2;
  const serving = [servingProvider, servingModel].filter(Boolean).join("/");
  return (
    <div className="hud">
      {serving && (
        <span className="hud-item model" title="Provider/model actually serving this run">
          <Cpu size={13} />
          {serving}
        </span>
      )}
      <span className="hud-item" title="Input tokens (cumulative)">
        <ArrowUp size={13} />
        {formatCount(metrics.inputTokens)}
      </span>
      <span className="hud-item" title="Output tokens (cumulative)">
        <ArrowDown size={13} />
        {formatCount(metrics.outputTokens)}
      </span>
      {tokensPerSec > 0 && (
        <span
          className={running ? "hud-item live" : "hud-item"}
          title="Tokens per second"
        >
          <Zap size={13} />
          {tokensPerSec.toFixed(1)}/s
        </span>
      )}
      {pct !== null && (
        <span className="hud-gauge">
          <Gauge size={13} />
          <span className="gauge-track">
            <span
              className="gauge-fill"
              data-warn={pct > 80 ? "" : undefined}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="gauge-pct">{Math.round(pct)}%</span>
          {outgrown && (
            // NOT "of {transcript}". Sat next to the percentage, the word "of"
            // reads as its denominator — so a gauge showing 30k of a 33k window
            // rendered as "90% of 36k", inviting the reader to check 30/36 and
            // conclude the number was wrong. The denominator is the WINDOW; the
            // transcript is a second, larger quantity and has to be labelled.
            <span className="gauge-convo" title="the transcript behind the prompt">
              · transcript {formatCount(conversationTokens!)}
            </span>
          )}
          <span className="gauge-popup" role="tooltip">
            {`the model read ${formatCount(metrics.contextTokens)} of ${formatCount(
              metrics.maxContextTokens,
            )} tokens`}
            {outgrown ? ` · transcript ${formatCount(conversationTokens!)}` : ""}
          </span>
        </span>
      )}
    </div>
  );
}
