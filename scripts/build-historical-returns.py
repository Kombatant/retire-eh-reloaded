# Derive src/data/historical/canada-annual.json from Statistics Canada full-table CSVs.
# Usage: python3 scripts/build-historical-returns.py <dir with 10100125/, 10100122/, 18100005/> src/data/historical/canada-annual.json
# Download each table from https://www150.statcan.gc.ca/n1/tbl/csv/<table>-eng.zip and unzip into <dir>/<table>/.
import csv, json, sys, statistics
base = sys.argv[1]
out = sys.argv[2]

def monthly(path, dim, name, geo='Canada'):
    vals = {}
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            if row[dim] != name or row['GEO'] != geo or row['VALUE'] == '':
                continue
            vals[row['REF_DATE']] = float(row['VALUE'])
    return vals

tsx_close = monthly(f'{base}/10100125/10100125.csv', 'Toronto Stock Exchange Statistics', "Standard and Poor's/Toronto Stock Exchange Composite Index, close")
tsx_yield = monthly(f'{base}/10100125/10100125.csv', 'Toronto Stock Exchange Statistics', 'Toronto Stock Exchange, stock dividend yields (composite), closing quotations')
bond = monthly(f'{base}/10100122/10100122.csv', 'Rates', 'Government of Canada marketable bonds, average yield: over 10 years')
tbill = monthly(f'{base}/10100122/10100122.csv', 'Rates', 'Treasury bill auction - average yields: 3 month')

cpi = {}
with open(f'{base}/18100005/18100005.csv', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['GEO'] == 'Canada' and row['Products and product groups'] == 'All-items' and row['VALUE'] and row['UOM'] == '2002=100':
            cpi[int(row['REF_DATE'])] = float(row['VALUE'])

def months(series, year):
    return [series[f'{year}-{m:02d}'] for m in range(1, 13) if f'{year}-{m:02d}' in series]

DURATION = 7.0     # approximate modified duration of a broad Canadian bond index
CONVEXITY = 60.0

rows = []
for year in range(1957, 2018):
    try:
        close_prev, close = tsx_close[f'{year-1}-12'], tsx_close[f'{year}-12']
        yields = months(tsx_yield, year)
        y_prev, y_now = bond[f'{year-1}-12'] / 100, bond[f'{year}-12'] / 100
        bills = months(tbill, year)
        infl = cpi[year] / cpi[year - 1] - 1
    except KeyError as e:
        print('missing', year, e, file=sys.stderr)
        continue
    if len(yields) != 12 or len(bills) != 12:
        print('partial year', year, len(yields), len(bills), file=sys.stderr)
        continue
    equity = close / close_prev - 1 + statistics.mean(yields) / 100
    dy = y_now - y_prev
    bond_ret = y_prev - DURATION * dy + 0.5 * CONVEXITY * dy * dy
    cash = statistics.mean(bills) / 100
    rows.append({'year': year, 'equity': round(equity, 5), 'bond': round(bond_ret, 5), 'cash': round(cash, 5), 'inflation': round(infl, 5)})

doc = {
    'description': 'Annual Canadian total returns derived from Statistics Canada tables. Nominal, as fractions.',
    'years': f"{rows[0]['year']}-{rows[-1]['year']}",
    'method': {
        'equity': 'S&P/TSX Composite close, December to December, plus the average monthly dividend yield (Table 10-10-0125-01).',
        'bond': 'Government of Canada bonds over 10 years: prior December yield plus price change from the yield change, duration 7, convexity 60 (Table 10-10-0122-01).',
        'cash': 'Average of monthly 3-month Treasury bill auction yields (Table 10-10-0122-01).',
        'inflation': 'Annual average CPI, all-items, Canada (Table 18-10-0005-01).',
    },
    'source': 'Statistics Canada, Tables 10-10-0125-01, 10-10-0122-01 and 18-10-0005-01, downloaded November 2026.',
    'license': 'Statistics Canada Open Licence (https://www.statcan.gc.ca/en/reference/licence). Index levels are third-party data published by Statistics Canada; only derived annual returns are included.',
    'data': rows,
}
json.dump(doc, open(out, 'w'), indent=1)
eq = [r['equity'] for r in rows]; bd = [r['bond'] for r in rows]; cs = [r['cash'] for r in rows]; inf = [r['inflation'] for r in rows]
def geo(xs):
    p = 1
    for x in xs: p *= 1 + x
    return p ** (1 / len(xs)) - 1
print(len(rows), 'years', rows[0]['year'], rows[-1]['year'])
print('equity geo %.4f sd %.4f' % (geo(eq), statistics.pstdev(eq)))
print('bond   geo %.4f sd %.4f' % (geo(bd), statistics.pstdev(bd)))
print('cash   geo %.4f sd %.4f' % (geo(cs), statistics.pstdev(cs)))
print('infl   geo %.4f sd %.4f' % (geo(inf), statistics.pstdev(inf)))
for y in (1974, 1981, 1987, 2001, 2002, 2008, 2009):
    print([r for r in rows if r['year'] == y])
