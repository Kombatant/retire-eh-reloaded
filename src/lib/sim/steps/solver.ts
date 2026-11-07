// Find w in [lo, hi] with f(w) ≈ 0 for an increasing function f.
// Tax is piecewise linear in the withdrawal, so a secant step usually lands
// within a dollar in a few iterations; bisection keeps it safe at kinks
// (credit phase-outs, the OAS clawback, GIS).
export function solveIncreasing(f: (w: number) => number, lo: number, hi: number, tolerance = 0.5, maxIterations = 40): number {
  let a = lo
  let fa = f(a)
  if (fa >= 0) return a
  let b = hi
  let fb = f(b)
  if (fb <= 0) return b
  for (let i = 0; i < maxIterations; i++) {
    // Secant guess, kept strictly inside the bracket.
    let w = a - (fa * (b - a)) / (fb - fa)
    if (!(w > a && w < b)) w = (a + b) / 2
    const fw = f(w)
    if (Math.abs(fw) <= tolerance) return w
    if (fw < 0) {
      a = w
      fa = fw
    } else {
      b = w
      fb = fw
    }
    if (b - a < 0.01) break
  }
  return b
}
