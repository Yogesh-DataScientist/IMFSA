import requests

r = requests.get('http://localhost:5000/api/top-movers', timeout=90)
d = r.json()
print('GAINERS:')
for s in d.get('gainers', []):
    print(f"  {s['name']:15s}  {s['change_pct']:+.2f}%  Rs.{s['price']}")
print('LOSERS:')
for s in d.get('losers', []):
    print(f"  {s['name']:15s}  {s['change_pct']:+.2f}%  Rs.{s['price']}")
