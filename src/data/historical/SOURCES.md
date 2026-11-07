# Canadian historical returns (`canada-annual.json`)

Annual nominal returns for 1957–2015, derived from three Statistics Canada tables
(downloaded November 2026):

| Series | Source table | Method |
|---|---|---|
| Equity | 10-10-0125-01 Toronto Stock Exchange statistics (discontinued 2023) | S&P/TSX Composite close, December to December, plus the average of the 12 monthly dividend yields |
| Bonds | 10-10-0122-01 Financial market statistics | Government of Canada marketable bonds over 10 years: prior December yield + price change from the yield change (modified duration 7, convexity 60) |
| Cash | 10-10-0122-01 | Average of the 12 monthly 3-month Treasury bill auction yields |
| Inflation | 18-10-0005-01 Consumer Price Index, annual average | All-items CPI, Canada, year over year |

The range ends in 2015 because the dividend-yield series stops in April 2018 and
2016–2017 are incomplete. Years with any missing month are excluded, not filled in.

Licence: Statistics Canada Open Licence (https://www.statcan.gc.ca/en/reference/licence).
Index levels are third-party data published by Statistics Canada; only derived annual
returns are included here.

Sanity checks against published TSX total returns: 2008 −31.9% (published about
−33%), 2009 +33.9% (about +35%), 1974 −25.4% (about −26%).

To rebuild, download the three tables' full CSVs from Statistics Canada and run
`scripts/build-historical-returns.py` (usage in the file header).
