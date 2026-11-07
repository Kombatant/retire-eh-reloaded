export interface ContributionGrowthPoint {
  age: number
  contributions: number
  growth: number
  total: number
}

export interface ContributionGrowthParams {
  projectionData: { age: number; Total: number }[]
  annualContribution: number
  showRealValues?: boolean
  inflationRate?: number
}

// Splits the accumulation path into cumulative contributions vs cumulative
// investment growth, using the actual projected balances (so the split is exact).
export function buildContributionGrowth(
  params: ContributionGrowthParams
): ContributionGrowthPoint[] {
  const { projectionData, annualContribution, showRealValues = true, inflationRate = 2.5 } = params
  if (projectionData.length === 0) return []

  const result: ContributionGrowthPoint[] = []
  const initial = projectionData[0].Total
  let cumContrib = initial

  result.push({ age: projectionData[0].age, contributions: initial, growth: 0, total: initial })

  for (let i = 1; i < projectionData.length; i++) {
    const deflateFactor = showRealValues ? Math.pow(1 + inflationRate / 100, i) : 1
    cumContrib += annualContribution / deflateFactor
    const total = projectionData[i].Total
    const growth = Math.max(0, total - cumContrib)
    result.push({
      age: projectionData[i].age,
      contributions: total - growth,
      growth,
      total,
    })
  }

  return result
}
