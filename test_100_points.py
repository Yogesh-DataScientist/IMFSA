from analysis_engine import run_full_analysis

stocks = ['TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'RELIANCE.NS']
for t in stocks:
    r = run_full_analysis(t)
    sig   = r['signal']
    score = r['score']
    print(f"{t:18s} | Signal: {sig:4s} | Score: {score}/100")
    for reason in r['reasons']:
        print(f"  - {reason}")
    print()
