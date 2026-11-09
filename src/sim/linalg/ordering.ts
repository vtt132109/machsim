/**
 * Fill-reducing column ordering for sparse LU.
 *
 * Minimum-degree ordering on the symmetric structure of A + A^T, computed with
 * an explicit elimination graph: eliminating vertex v turns its neighbourhood
 * into a clique and removes v. The vertex of smallest current degree is chosen
 * next (ties broken by the lowest index, so the ordering is deterministic).
 *
 * Circuit matrices are very sparse and close to structurally symmetric, so this
 * classic heuristic gives near-optimal fill for ladders, meshes and trees, and its
 * O(sum of |clique|^2) cost is negligible next to repeated numeric factorisation.
 */

/** Binary min-heap of packed integer keys (degree * stride + vertex). */
class MinHeap {
  private data: number[] = [];

  get length(): number {
    return this.data.length;
  }

  push(key: number): void {
    const d = this.data;
    d.push(key);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (d[parent] <= key) break;
      d[i] = d[parent];
      i = parent;
    }
    d[i] = key;
  }

  pop(): number {
    const d = this.data;
    const top = d[0];
    const last = d.pop() as number;
    if (d.length > 0) {
      let i = 0;
      const n = d.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && d[r] < d[l] ? r : l;
        if (d[c] >= last) break;
        d[i] = d[c];
        i = c;
      }
      d[i] = last;
    }
    return top;
  }
}

/**
 * Minimum-degree ordering of an n x n pattern given in CSC form.
 * Returns `order` where order[k] is the column eliminated at step k.
 */
export function minimumDegreeOrdering(n: number, colPtr: Int32Array, rowIdx: Int32Array): Int32Array {
  const adj: Set<number>[] = new Array<Set<number>>(n);
  for (let i = 0; i < n; i++) adj[i] = new Set<number>();
  for (let c = 0; c < n; c++) {
    for (let p = colPtr[c]; p < colPtr[c + 1]; p++) {
      const r = rowIdx[p];
      if (r !== c) {
        adj[r].add(c);
        adj[c].add(r);
      }
    }
  }
  const stride = n + 1;
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) heap.push(adj[i].size * stride + i);
  const eliminated = new Uint8Array(n);
  const order = new Int32Array(n);
  let k = 0;
  const nb: number[] = [];
  while (heap.length > 0 && k < n) {
    const key = heap.pop();
    const v = key % stride;
    const deg = (key - v) / stride;
    if (eliminated[v] || adj[v].size !== deg) continue; // stale entry
    order[k++] = v;
    eliminated[v] = 1;
    nb.length = 0;
    for (const u of adj[v]) nb.push(u);
    for (const u of nb) adj[u].delete(v);
    for (let a = 0; a < nb.length; a++) {
      const sa = adj[nb[a]];
      for (let b = 0; b < nb.length; b++) if (a !== b) sa.add(nb[b]);
    }
    for (const u of nb) heap.push(adj[u].size * stride + u);
    adj[v].clear();
  }
  return order;
}
