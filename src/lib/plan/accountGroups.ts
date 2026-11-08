import type { AccountType, AccountV2, Holding } from './schema'

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  RRSP: 'RRSP',
  RRIF: 'RRIF',
  TFSA: 'TFSA',
  FHSA: 'FHSA',
  LIRA: 'LIRA',
  LIF: 'LIF',
  NONREG: 'Non-registered',
  CASH: 'Cash / savings',
  STOCK: 'Stock portfolio',
}

export const ACCOUNT_DESCRIPTIONS: Record<AccountType, string> = {
  RRSP: 'Tax-deferred. Contributions are deductible; withdrawals are taxed as income.',
  RRIF: 'An RRSP converted to an income fund. Withdrawals are taxed as income.',
  TFSA: 'Tax-free growth and withdrawals.',
  FHSA: 'First Home Savings Account. Deductible contributions ($8,000/yr, $40,000 lifetime).',
  LIRA: 'Locked-in retirement account from a former employer pension. Taxed like an RRSP.',
  LIF: 'Life income fund (a converted LIRA). Taxed like a RRIF.',
  NONREG: 'Taxable investment account. Distributions are taxed yearly; sales realize capital gains.',
  CASH: 'Savings or high-interest account. Interest is taxed every year.',
  STOCK: 'Individual stocks (including employer RSUs and ESPP shares) in a taxable account, each with its own price projection.',
}

export type AccountGroup = 'registered' | 'tfsa' | 'taxable'

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  registered: 'RRSP & registered',
  tfsa: 'TFSA',
  taxable: 'Non-registered & cash',
}

export function accountGroup(type: AccountType): AccountGroup {
  if (type === 'TFSA') return 'tfsa'
  if (type === 'NONREG' || type === 'CASH' || type === 'STOCK') return 'taxable'
  return 'registered'
}

export function groupBalances(accounts: Pick<AccountV2, 'type' | 'balance'>[]): Record<AccountGroup, number> {
  const totals: Record<AccountGroup, number> = { registered: 0, tfsa: 0, taxable: 0 }
  for (const a of accounts) totals[accountGroup(a.type)] += a.balance || 0
  return totals
}

// Market value of stock holdings in Canadian dollars. Prices are in USD.
export function stockValueCad(holdings: Pick<Holding, 'shares' | 'priceUsd'>[], usdCad: number): number {
  return holdings.reduce((s, h) => s + h.shares * h.priceUsd, 0) * usdCad
}

// What an account is worth today, in CAD. Stock accounts hold shares, not a balance.
export function accountValue(account: AccountV2, usdCad: number): number {
  if (account.type === 'STOCK') return stockValueCad(account.holdings, usdCad)
  return account.balance || 0
}
