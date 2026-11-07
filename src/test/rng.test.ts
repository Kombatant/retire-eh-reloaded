import { describe, it, expect } from 'vitest'
import { mulberry32, normal } from '@/lib/sim/rng'

describe('seeded rng', () => {
  it('is reproducible for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
    expect(mulberry32(43)()).not.toBe(seqA[0])
  })

  it('produces uniform values in [0, 1)', () => {
    const rng = mulberry32(1)
    let total = 0
    for (let i = 0; i < 10000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      total += v
    }
    expect(total / 10000).toBeCloseTo(0.5, 1)
  })

  it('produces standard normal draws', () => {
    const rng = mulberry32(7)
    const n = 20000
    const draws = Array.from({ length: n }, () => normal(rng))
    const mean = draws.reduce((s, x) => s + x, 0) / n
    const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / n
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(variance).toBeCloseTo(1, 1)
  })
})
