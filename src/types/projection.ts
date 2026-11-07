export interface ProjectionDataPoint {
  year: number
  age: number
  RRSP?: number
  TFSA?: number
  // Non-registered and cash accounts.
  Other?: number
  Total: number
}
