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
}

// Live token HUD: the model actually serving the run (reflects any provider
// fallback), cumulative ▲ input / ▼ output, current tokens/sec while
// generating, and a context-window gauge when the model reports its ceiling.
export default function MetricsHud({
  metrics,
  tokensPerSec,
  running,
  servingModel,
}: Props) {
  const pct = contextPercent(metrics);
  return (
    <div className="hud">
      {servingModel && (
        <span className="hud-item" title="Model actually serving this run">
          <Cpu size={13} />
          {servingModel}
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
      {running && tokensPerSec > 0 && (
        <span className="hud-item" title="Tokens per second">
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
