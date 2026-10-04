// The graph shared by the three map views (events, positions, groups): nodes
// ready to draw, and edges between similar items. Pure: no DOM, no layout.
// Each directory supplies its own similarity; spec:
// docs/superpowers/specs/2026-09-28-event-graph-design.md.
import type { Shape } from './graph-shapes';

/** Pairs scoring at least this are linked. */
export const EDGE_THRESHOLD = 0.35;

export interface GraphNode {
  id: string;
  title: string;
  href: string;
  shape: Shape;
  /** Drawn faded: past events, archived positions. */
  dimmed: boolean;
}

/** Undirected; `source` precedes `target` in the input order. */
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** A node label: at most `max` code points, ending in `…` when cut. */
export function shortLabel(title: string, max = 28): string {
  const chars = [...title];
  if (chars.length <= max) return title;
  return (
    chars
      .slice(0, max - 1)
      .join('')
      .trimEnd() + '…'
  );
}

/** Links each item keeps at most: enough to place it, few enough that clusters show. */
export const MAX_LINKS = 4;

/**
 * Links each item to its `MAX_LINKS` most similar items scoring at least
 * `EDGE_THRESHOLD` (a pair is linked when either side picks it), plus its
 * single best link below that, so an item that resembles anything at all is
 * never drawn alone. Linking every pair over the threshold instead joined
 * nearly everything — a shared country alone came close — and the layout
 * drew one even blob. An item sharing nothing with any other stays unlinked.
 */
export function linkSimilar<T extends { id: string }>(
  items: T[],
  similarity: (a: T, b: T) => number,
): GraphEdge[] {
  const candidates: { j: number; weight: number }[][] = items.map(() => []);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const weight = similarity(items[i]!, items[j]!);
      if (weight <= 0) continue;
      candidates[i]!.push({ j, weight });
      candidates[j]!.push({ j: i, weight });
    }
  }

  const kept = new Map<string, GraphEdge>();
  candidates.forEach((list, i) => {
    // Strongest first. Similarities are sums of a few discrete parts, so ties
    // are common; breaking them by the next items in cyclic order spreads the
    // picks instead of making hubs of the first items listed. Deterministic.
    const after = (j: number) => (j - i + items.length) % items.length;
    list.sort((a, b) => b.weight - a.weight || after(a.j) - after(b.j));
    const picks = list.filter((c) => c.weight >= EDGE_THRESHOLD).slice(0, MAX_LINKS);
    if (picks.length === 0 && list[0]) picks.push(list[0]);
    for (const { j, weight } of picks) {
      const [lo, hi] = i < j ? [i, j] : [j, i];
      kept.set(`${lo}|${hi}`, { source: items[lo]!.id, target: items[hi]!.id, weight });
    }
  });

  const order = (k: string) => k.split('|').map(Number) as [number, number];
  return [...kept.entries()]
    .sort(([a], [b]) => {
      const [a0, a1] = order(a);
      const [b0, b1] = order(b);
      return a0 - b0 || a1 - b1;
    })
    .map(([, e]) => e);
}
