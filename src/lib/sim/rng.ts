// Small seeded PRNG so simulations are reproducible: the same plan and seed
// always give the same chart, instead of jittering on every re-render.

export type Rng = () => number

// mulberry32: fast 32-bit generator with good statistical quality for
// Monte Carlo use (not cryptographic).
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Standard normal draw via Box-Muller. One value per call keeps the API simple;
// the discarded pair member costs little at our sample sizes.
export function normal(rng: Rng): number {
  let u = 0
  while (u === 0) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
