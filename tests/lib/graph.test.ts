import { describe, expect, it } from 'vitest';
import { EDGE_THRESHOLD, MAX_LINKS, linkSimilar, shortLabel } from '../../src/lib/graph';

describe('shortLabel', () => {
  it('leaves a short title alone', () => {
    expect(shortLabel('Sanibel Symposium')).toBe('Sanibel Symposium');
  });

  it('truncates to the limit with an ellipsis', () => {
    const label = shortLabel('Total Energy and Force Methods Workshop 2027');
    expect([...label]).toHaveLength(28);
    expect(label.endsWith('…')).toBe(true);
  });

  it('counts code points, never splitting a surrogate pair', () => {
    const label = shortLabel('🧪'.repeat(40), 10);
    expect([...label]).toHaveLength(10);
    expect(label).toBe('🧪'.repeat(9) + '…');
  });
});

describe('linkSimilar', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));

  it('keeps each item to its strongest links, even when every pair clears the threshold', () => {
    // Everything resembles everything: linking all pairs drew one even blob.
    const edges = linkSimilar(items, () => 0.9);
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    expect(edges.length).toBeLessThan((items.length * (items.length - 1)) / 2);
    // A pair is kept when either side picks it, so a degree can exceed MAX_LINKS, but not 2x.
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(2 * MAX_LINKS);
  });

  it('prefers the strongest links', () => {
    const sim = (a: { id: string }, b: { id: string }) =>
      a.id === 'n0' && b.id === 'n9' ? 0.95 : EDGE_THRESHOLD;
    const edges = linkSimilar(items, sim);
    expect(edges).toContainEqual({ source: 'n0', target: 'n9', weight: 0.95 });
  });

  it('gives an item with nothing over the threshold its single best link, and leaves an unlike item alone', () => {
    const sim = (a: { id: string }, b: { id: string }) =>
      a.id === 'n1' && b.id === 'n2' ? 0.1 : 0;
    expect(linkSimilar(items, sim)).toEqual([{ source: 'n1', target: 'n2', weight: 0.1 }]);
  });
});
