// Force layout for the graph view. Runs at build time, like orbital.ts, so the
// page ships a finished picture that works without JavaScript; the client
// script (src/scripts/graph.ts) reuses `createSimulation` to take over from
// the same positions, so the two never disagree about the forces. Seeded, so
// a rebuild reproduces the same layout and the output does not churn.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Graph, GraphEdge } from './graph';

export type SimNode = SimulationNodeDatum & { id: string };
export type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

const SEED = 0x5eed;
/** Enough for 20–100 nodes to settle; checked by eye on the real data. */
const TICKS = 300;
/** viewBox margin. Labels only appear on hover, and flip left near the right edge. */
const PAD = { left: 40, right: 40, top: 40, bottom: 40 };
/** Smallest viewBox, so a map of a handful of nodes is not scaled up to giant shapes. */
const MIN_SIZE = { width: 640, height: 400 };

/** Deterministic PRNG for d3's jiggle and tie-breaking. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * Communities by modularity (the local-move phase of Louvain), as one index
 * per node. Node order and a fixed visiting order keep it deterministic.
 * Isolated nodes each form their own community.
 */
export function communities(ids: readonly string[], edges: readonly GraphEdge[]): number[] {
  const index = new Map(ids.map((id, i) => [id, i]));
  const adj: Map<number, number>[] = ids.map(() => new Map());
  let total = 0;
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a]!.set(b, (adj[a]!.get(b) ?? 0) + e.weight);
    adj[b]!.set(a, (adj[b]!.get(a) ?? 0) + e.weight);
    total += 2 * e.weight;
  }
  const community = ids.map((_, i) => i);
  if (total === 0) return community;
  const degree = adj.map((a) => [...a.values()].reduce((x, y) => x + y, 0));
  const sum = degree.slice();
  for (let pass = 0, moved = true; moved && pass < 50; pass++) {
    moved = false;
    for (let i = 0; i < ids.length; i++) {
      const from = community[i]!;
      sum[from]! -= degree[i]!;
      const links = new Map<number, number>();
      for (const [j, w] of adj[i]!) links.set(community[j]!, (links.get(community[j]!) ?? 0) + w);
      let best = from;
      let gain = (links.get(from) ?? 0) - (sum[from]! * degree[i]!) / total;
      for (const [c, w] of links) {
        const g = w - (sum[c]! * degree[i]!) / total;
        if (g > gain + 1e-12) [best, gain] = [c, g];
      }
      community[i] = best;
      sum[best]! += degree[i]!;
      if (best !== from) moved = true;
    }
  }
  return community;
}

/** Room each node needs around its community's anchor, in simulation units. */
const NODE_AREA = 900;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * One anchor per community, largest first, on a sunflower spiral spaced by
 * the area the communities so far take up, so big clusters sit near the
 * middle and none overlap much.
 */
function anchors(community: number[]): Map<number, { x: number; y: number }> {
  const size = new Map<number, number>();
  for (const c of community) size.set(c, (size.get(c) ?? 0) + 1);
  const order = [...size.keys()].sort((a, b) => size.get(b)! - size.get(a)! || a - b);
  const out = new Map<number, { x: number; y: number }>();
  let area = 0;
  order.forEach((c, k) => {
    const own = size.get(c)! * NODE_AREA;
    const r = k === 0 ? 0 : Math.sqrt((area + own / 2) / Math.PI) * 1.9;
    out.set(c, { x: r * Math.cos(k * GOLDEN_ANGLE), y: r * Math.sin(k * GOLDEN_ANGLE) });
    area += own;
  });
  return out;
}

export function createSimulation(
  nodes: SimNode[],
  edges: GraphEdge[],
): Simulation<SimNode, SimLink> {
  const links: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
  }));
  // Each community is pulled to its own anchor, and links between
  // communities are slack, so clusters read as clusters: linking similar
  // items alone drew one even blob, since similarity is a continuum.
  // Repulsion is short-range: enough to part neighbours, not to scatter a
  // cluster. Labels are hidden until hover, so nodes only need room for their shapes.
  const community = communities(
    nodes.map((n) => n.id),
    edges,
  );
  const of = new Map(nodes.map((n, i) => [n.id, community[i]!]));
  const anchor = anchors(community);
  const at = (n: SimNode) => anchor.get(of.get(n.id)!)!;
  const endpoint = (end: SimNode | string | number) =>
    typeof end === 'object' ? end.id : String(end);
  const within = (l: SimLink) => of.get(endpoint(l.source)) === of.get(endpoint(l.target));
  return forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(lcg(SEED))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => (within(l) ? 30 : 90))
        .strength((l) => (within(l) ? Math.min(1, l.weight * 1.5) : 0.02)),
    )
    .force('charge', forceManyBody<SimNode>().strength(-40).distanceMax(120))
    .force('x', forceX<SimNode>((n) => at(n).x).strength(0.12))
    .force('y', forceY<SimNode>((n) => at(n).y).strength(0.12))
    .force('collide', forceCollide<SimNode>(13))
    .stop();
}

export interface Position {
  id: string;
  x: number;
  y: number;
}

export interface Layout {
  positions: Position[];
  /** `[minX, minY, width, height]`, in simulation units. */
  viewBox: [number, number, number, number];
}

const round = (n: number) => Math.round(n * 10) / 10;

export function layoutGraph(graph: Graph): Layout {
  if (graph.nodes.length === 0) return { positions: [], viewBox: [0, 0, 1, 1] };
  const nodes: SimNode[] = graph.nodes.map((n) => ({ id: n.id }));
  createSimulation(nodes, graph.edges).tick(TICKS);

  const positions = nodes.map((n) => ({ id: n.id, x: round(n.x!), y: round(n.y!) }));
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  let minX = Math.min(...xs) - PAD.left;
  let minY = Math.min(...ys) - PAD.top;
  const fitWidth = Math.max(...xs) + PAD.right - minX;
  const fitHeight = Math.max(...ys) + PAD.bottom - minY;
  // Grow a small box around its centre.
  const width = Math.max(fitWidth, MIN_SIZE.width);
  const height = Math.max(fitHeight, MIN_SIZE.height);
  minX = round(minX - (width - fitWidth) / 2);
  minY = round(minY - (height - fitHeight) / 2);
  return { positions, viewBox: [minX, minY, width, height] };
}

export interface GraphPayload {
  nodes: Position[];
  edges: GraphEdge[];
}

/**
 * The client's starting state, as JSON safe to inline in a `<script>` tag:
 * `<` is escaped so no string in the data can close the tag.
 */
export function graphPayload(graph: Graph, layout: Layout): string {
  const payload: GraphPayload = { nodes: layout.positions, edges: graph.edges };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
