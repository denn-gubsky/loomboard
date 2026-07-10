import {
  Bot,
  Cpu,
  Brain,
  Sparkles,
  Rocket,
  Compass,
  FlaskConical,
  Zap,
  Ghost,
  Bird,
  Atom,
  Wand2,
  type LucideIcon,
} from "lucide-react";

// Stable visual identity for an agent — a color + icon derived from its name, so
// the same agent looks the same across sessions and machines without any stored
// mapping. The compact tile and the enlarge overlay both take these as params
// (with overrides), which is why identity is a pure function, not app state.

export interface AgentIdentity {
  name: string;
  /** Accent color (avatar tint / card wash / --accent override in the overlay). */
  color: string;
  Icon: LucideIcon;
}

export interface AgentIdentityOverrides {
  /** Explicit accent color; wins over the derived hue. */
  color?: string;
  /** Explicit icon (from lucide or any component); wins over the derived pick. */
  icon?: LucideIcon;
}

// A small curated set that reads as "agent/entity". Order is stable — appending
// (never reordering) keeps existing agents on their current icon.
const ICONS: readonly LucideIcon[] = [
  Bot,
  Cpu,
  Brain,
  Sparkles,
  Rocket,
  Compass,
  FlaskConical,
  Zap,
  Ghost,
  Bird,
  Atom,
  Wand2,
];

// FNV-1a — a cheap, well-distributed, deterministic string hash. We only need
// stability + spread, not cryptographic strength.
function hashName(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive (or override) an agent's color + icon from its name. `name` "" is
 *  treated as a stable fallback so an unnamed run still gets a consistent look. */
export function agentIdentity(
  name: string,
  overrides?: AgentIdentityOverrides,
): AgentIdentity {
  const h = hashName(name || "agent");
  // Two independent draws from the hash so color and icon don't move together.
  const hue = h % 360;
  const iconIdx = (h >>> 9) % ICONS.length;
  return {
    name,
    color: overrides?.color ?? `hsl(${hue} 62% 55%)`,
    Icon: overrides?.icon ?? ICONS[iconIdx],
  };
}
