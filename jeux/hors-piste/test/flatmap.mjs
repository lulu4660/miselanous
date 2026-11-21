// A small synthetic map for vehicle tests: flat (or sloped) ground of one surface type.
export function flatMap({ surf = 0, h = 0.5, slope = 0, size = 600, n = 240 } = {}) {
  const N = n, V = N + 1, half = size / 2, cell = size / N;
  const heights = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) heights[j * V + i] = h + (-half + i * cell) * slope;
  const M = { N, V, cell, half, size, heights, roads: [] };
  M.heightAt = (x, z) => h + Math.max(-half, Math.min(half, x)) * slope;
  M.normalAt = (x, z, out) => { const l = Math.hypot(slope, 1); out[0] = -slope / l; out[1] = 1 / l; out[2] = 0; return M.heightAt(x, z); };
  M.surfaceAt = () => surf;
  return M;
}
