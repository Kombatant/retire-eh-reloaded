import type { ProvinceCode } from '@/lib/plan/schema'

// Approximate probate fees / estate administration tax on the value of an
// estate passing through the will, by province (2026). Registered accounts
// and TFSAs with named beneficiaries and joint assets usually avoid probate;
// this estimate applies the fee to the whole estate, which is conservative.
// Review annually.
export function probateFee(province: ProvinceCode, estate: number): number {
  const v = Math.max(0, estate)
  switch (province) {
    case 'ON': return v <= 50000 ? 0 : (v - 50000) * 0.015
    case 'BC': return v <= 25000 ? 0 : Math.min(v - 25000, 25000) * 0.006 + Math.max(0, v - 50000) * 0.014
    case 'AB': return v <= 10000 ? 35 : v <= 25000 ? 135 : v <= 125000 ? 275 : v <= 250000 ? 400 : 525
    case 'SK': return v * 0.007
    case 'MB': return 0
    case 'QC': return 0 // notarial wills need no probate; court verification has a small flat fee
    case 'NB': return v <= 20000 ? Math.min(100, v * 0.005) : v * 0.005
    case 'NS': return v <= 100000 ? Math.min(1003, 85 + v * 0.01) : 1003 + (v - 100000) * 0.01695
    case 'PE': return v <= 100000 ? Math.min(400, 50 + v * 0.004) : v * 0.004
    case 'NL': return v <= 1000 ? 60 : 60 + (v - 1000) * 0.006
    case 'YT': return v <= 25000 ? 0 : 140
    case 'NT': return v <= 10000 ? 30 : v <= 25000 ? 110 : v <= 125000 ? 215 : v <= 250000 ? 325 : 435
    case 'NU': return v <= 10000 ? 30 : v <= 25000 ? 110 : v <= 125000 ? 215 : v <= 250000 ? 325 : 435
  }
}
