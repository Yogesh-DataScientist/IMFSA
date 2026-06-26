from analysis_engine import run_full_analysis

# A diverse mix of strong Indian stocks
nifty_sample = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 
    'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'BAJFINANCE.NS', 'LARSEN.NS',
    'HINDUNILVR.NS', 'AXISBANK.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'KOTAKBANK.NS'
]

results = []
for t in nifty_sample:
    r = run_full_analysis(t)
    if 'error' not in r:
        results.append((t, r['signal'], r['score']))

results.sort(key=lambda x: x[2], reverse=True)
for t, sig, score in results:
    print(f"{t:15s} | {sig:4s} | {score}/100")
