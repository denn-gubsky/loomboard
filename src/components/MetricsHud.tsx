import { ArrowDown, ArrowUp, Cpu, Gauge, Zap } from "lucide-react";
import {
  contextPercent,
  formatCount,
  type TokenMetrics,
} from "../lib/metrics";

interface Props {
  metrics: TokenMetrics;
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
  tokensPerSec,
  running,
  servingModel,
  servingProvider,
}: Props) {
  const pct = contextPercent(metrics);
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
        <span
          className="hud-gauge"
          title={`Context used ${formatCount(metrics.contextTokens)} / ${formatCount(
            metrics.maxContextTokens,
          )}`}
        >
          <Gauge size={13} />
          <span className="gauge-track">
            <span
              className="gauge-fill"
              data-warn={pct > 80 ? "" : undefined}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="gauge-pct">{Math.round(pct)}%</span>
        </span>
      )}
    </div>
  );
}
