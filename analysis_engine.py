"""
analysis_engine.py
------------------
Core analytical engine: fetches fundamentals, computes technical indicators,
and applies the Hybrid Decision Matrix to generate BUY / HOLD / SELL signals.
"""

import math
import numpy as np
import pandas as pd

PANDAS_TA_AVAILABLE = False

from data_fetcher import fetch_stock_data, fetch_info


# ══════════════════════════════════════════════════════
#  FUNDAMENTAL ANALYSIS
# ══════════════════════════════════════════════════════

FUNDAMENTAL_KEYS = {
    "P/E Ratio":            "trailingPE",
    "Return on Equity (%)": "returnOnEquity",
    "Debt-to-Equity":       "debtToEquity",
    "Market Cap (Cr)":      "marketCap",
    "EPS (TTM)":            "trailingEps",
    "Book Value":           "bookValue",
    "Dividend Yield (%)":   "dividendYield",
    "52-Week High":         "fiftyTwoWeekHigh",
    "52-Week Low":          "fiftyTwoWeekLow",
    "Current Price":        "currentPrice",
    "Sector":               "sector",
    "Industry":             "industry",
    "Company Name":         "longName",
}


def get_fundamental_data(ticker: str) -> dict:
    """
    Fetch and return fundamental metrics for the given ticker.
    Returns a dict with human-readable keys.
    """
    import yfinance as yf
    import pandas as pd
    
    t = yf.Ticker(ticker)
    
    try:
        raw_info = t.info or {}
        info = {}
        for k, v in raw_info.items():
            if isinstance(v, float) and math.isnan(v):
                info[k] = None
            elif v in ("NaN", "nan", ""):
                info[k] = None
            else:
                info[k] = v
    except Exception:
        info = {}
        
    try:
        f_obj = t.fast_info
        fast = {k: f_obj[k] for k in f_obj.keys()}
    except Exception:
        fast = {}

    # Deep Fallbacks using financials
    inc = pd.DataFrame()
    bal = pd.DataFrame()
    try:
        # Check explicitly for None since bool(NaN) is True
        if info.get("trailingEps") is None or info.get("trailingPE") is None:
            inc = t.income_stmt
            bal = t.balance_sheet
    except Exception:
        pass

    result = {}
    for label, key in FUNDAMENTAL_KEYS.items():
        val = info.get(key)
        
        if val is None:
            # 1. Price, Caps, Ranges
            if label == "Current Price":
                val = fast.get("lastPrice") or info.get("currentPrice") or info.get("regularMarketPrice")
            elif label == "Market Cap (Cr)":
                val = fast.get("marketCap") or info.get("marketCap")
            elif label == "52-Week High":
                val = fast.get("yearHigh") or info.get("fiftyTwoWeekHigh")
            elif label == "52-Week Low":
                val = fast.get("yearLow") or info.get("fiftyTwoWeekLow")
            elif label == "Company Name":
                val = info.get("longName") or info.get("shortName") or ticker
                
            # 2. Deep Fundamentals
            try:
                if label == "EPS (TTM)":
                    if not inc.empty and 'Basic EPS' in inc.index:
                        val = float(inc.loc['Basic EPS'].iloc[0])
                elif label == "Book Value":
                    if not bal.empty and 'Stockholders Equity' in bal.index and 'Ordinary Shares Number' in bal.index:
                        val = float(bal.loc['Stockholders Equity'].iloc[0] / bal.loc['Ordinary Shares Number'].iloc[0])
                elif label == "P/E Ratio":
                    eps = info.get("trailingEps")
                    if eps is None and not inc.empty and 'Basic EPS' in inc.index:
                        eps = float(inc.loc['Basic EPS'].iloc[0])
                    price = fast.get("lastPrice") or info.get("currentPrice")
                    if eps and price and eps > 0:
                        val = float(price / eps)
                elif label == "Return on Equity (%)":
                    if not inc.empty and 'Net Income' in inc.index and not bal.empty and 'Stockholders Equity' in bal.index:
                        ni = float(inc.loc['Net Income'].iloc[0])
                        eq = float(bal.loc['Stockholders Equity'].iloc[0])
                        if eq > 0:
                            val = float(ni / eq)
                elif label == "Debt-to-Equity":
                    if not bal.empty and 'Stockholders Equity' in bal.index:
                        eq = float(bal.loc['Stockholders Equity'].iloc[0])
                        if eq > 0:
                            total_debt = float(bal.loc['Total Debt'].iloc[0]) if 'Total Debt' in bal.index else 0.0
                            val = float((total_debt / eq) * 100) # yfinance info returns it as percentage generally e.g., 50.7 for 0.507
                elif label == "Dividend Yield (%)":
                    try:
                        divs = t.dividends
                        price = fast.get("lastPrice") or info.get("currentPrice")
                        if divs is not None and not divs.empty and price:
                            # Sum last 1 year dividends
                            last_year_divs = divs[divs.index > (pd.Timestamp.now(tz=divs.index.tz) - pd.DateOffset(years=1))].sum()
                            val = float(last_year_divs / price)
                    except Exception:
                        pass
            except Exception:
                pass

        if val is None or (isinstance(val, float) and math.isnan(val)) or val in ("NaN", "nan"):
            result[label] = "N/A"
        elif label in ("Return on Equity (%)", "Dividend Yield (%)") and isinstance(val, (int, float)):
            result[label] = f"{val * 100:.2f}%"
        elif label == "Market Cap (Cr)" and isinstance(val, (int, float)):
            result[label] = f"₹{val / 1e7:,.2f} Cr"
        elif isinstance(val, float):
            result[label] = f"{val:.2f}"
        else:
            result[label] = str(val)
    return result


# ══════════════════════════════════════════════════════
#  TECHNICAL INDICATORS
# ══════════════════════════════════════════════════════

def _sma(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(window=n).mean()


def _rsi(series: pd.Series, n: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=n - 1, min_periods=n).mean()
    avg_loss = loss.ewm(com=n - 1, min_periods=n).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def get_technical_indicators(hist: pd.DataFrame) -> dict:
    """
    Compute SMA50, SMA200, RSI, MACD from OHLCV DataFrame.
    Returns a dict with latest values and the full series for charting.
    """
    close = hist["Close"].dropna()

    sma50  = _sma(close, 50)
    sma200 = _sma(close, 200)
    rsi    = _rsi(close)
    macd_line, signal_line, histogram = _macd(close)

    latest_close   = float(close.iloc[-1])
    latest_sma50   = float(sma50.iloc[-1])   if not sma50.isna().all()   else None
    latest_sma200  = float(sma200.iloc[-1])  if not sma200.isna().all()  else None
    latest_rsi     = float(rsi.iloc[-1])     if not rsi.isna().all()     else None
    latest_macd    = float(macd_line.iloc[-1])
    latest_signal  = float(signal_line.iloc[-1])
    latest_hist    = float(histogram.iloc[-1])

    return {
        "close":        latest_close,
        "sma50":        latest_sma50,
        "sma200":       latest_sma200,
        "rsi":          round(latest_rsi, 2) if latest_rsi is not None else None,
        "macd":         round(latest_macd, 4),
        "macd_signal":  round(latest_signal, 4),
        "macd_hist":    round(latest_hist, 4),
        # Full series for chart overlays
        "_sma50_series":  sma50.tolist(),
        "_sma200_series": sma200.tolist(),
        "_dates":         hist["Date"].astype(str).tolist(),
    }


# ══════════════════════════════════════════════════════
#  HYBRID DECISION MATRIX  —  Weighted 0-100 Scoring Engine
# ══════════════════════════════════════════════════════
#
#  Total Possible Score: 100 Points
#    Technicals (50 max):
#      - RSI             : 20 pts
#      - Price vs SMA50  : 15 pts
#      - MACD Histogram  : 15 pts
#    Fundamentals (50 max):
#      - P/E Ratio       : 20 pts
#      - ROE             : 20 pts
#      - Debt/Equity     : 10 pts
#
#  Thresholds:  BUY ≥ 65  |  SELL ≤ 39  |  HOLD: 40 to 64

def generate_recommendation(fundamentals: dict, technicals: dict) -> tuple[str, int, list[str]]:
    """
    Returns (signal, score, reasons).
    Score is normalized out of 100 (gracefully handles missing data).
    """
    reasons: list[str] = []
    
    total_score = 0.0
    max_possible_score = 0.0

    close  = technicals.get("close")
    sma50  = technicals.get("sma50")
    sma200 = technicals.get("sma200")
    rsi    = technicals.get("rsi")
    hist   = technicals.get("macd_hist")

    # ── Technicals ──────────────────────────────────────────────────

    # 1. RSI (Max 20 pts)
    if rsi is not None:
        max_possible_score += 20
        if rsi <= 30:
            pts = 20
            reasons.append(f"RSI {rsi:.1f} (Oversold): Strong buy/reversal opportunity (+{pts}/20 pts)")
        elif rsi <= 40:
            pts = 16
            reasons.append(f"RSI {rsi:.1f} (Approaching Oversold): Good entry zone (+{pts}/20 pts)")
        elif rsi <= 55:
            pts = 10
            reasons.append(f"RSI {rsi:.1f}: Neutral momentum (+{pts}/20 pts)")
        elif rsi <= 68:
            pts = 5
            reasons.append(f"RSI {rsi:.1f}: Approaching overbought conditions (+{pts}/20 pts)")
        else:
            pts = 0
            reasons.append(f"RSI {rsi:.1f} (Overbought): High risk of pullback (+{pts}/20 pts)")
        total_score += pts

    # 2. MACD Histogram (Max 15 pts)
    if hist is not None:
        max_possible_score += 15
        if hist > 0:
            pts = 15
            reasons.append(f"MACD Histogram is Positive: Bullish momentum active (+{pts}/15 pts)")
        else:
            pts = 0
            reasons.append(f"MACD Histogram is Negative: Bearish momentum active (+{pts}/15 pts)")
        total_score += pts

    # 3. Price vs SMA50 (Max 15 pts)
    if close and sma50:
        max_possible_score += 15
        pct_diff = (close - sma50) / sma50 * 100
        if pct_diff >= 2:
            pts = 15
            reasons.append(f"Price is {pct_diff:.1f}% above 50-day SMA: Solid uptrend (+{pts}/15 pts)")
        elif pct_diff >= 0:
            pts = 10
            reasons.append(f"Price is marginally ({pct_diff:.1f}%) above 50-day SMA: Mild uptrend (+{pts}/15 pts)")
        elif pct_diff >= -3:
            pts = 5
            reasons.append(f"Price is marginally ({abs(pct_diff):.1f}%) below 50-day SMA: Mild bearish (+{pts}/15 pts)")
        else:
            pts = 0
            reasons.append(f"Price is {abs(pct_diff):.1f}% below 50-day SMA: Strong bearish trend (+{pts}/15 pts)")
        total_score += pts

    # 4. SMA50 vs SMA200 (Informational context)
    if sma50 and sma200:
        if sma50 > sma200:
            reasons.append(f"Golden Cross Active: 50-day SMA > 200-day SMA (Long-term Bullish context)")
        else:
            reasons.append(f"Death Cross Active: 50-day SMA < 200-day SMA (Long-term Bearish context)")


    # ── Fundamentals ────────────────────────────────────────────────

    # 5. P/E Ratio (Max 20 pts)
    # The Indian stock market often runs at higher premiums.
    pe_raw = fundamentals.get("P/E Ratio", "N/A")
    try:
        pe = float(str(pe_raw).replace(",", "")) if pe_raw != "N/A" else None
        if pe is not None and pe > 0:
            max_possible_score += 20
            if pe <= 20:
                pts = 20
                reasons.append(f"P/E Ratio {pe:.1f}: Deeply undervalued vs Indian markets (+{pts}/20 pts)")
            elif pe <= 30:
                pts = 15
                reasons.append(f"P/E Ratio {pe:.1f}: Attractively valued (+{pts}/20 pts)")
            elif pe <= 45:
                pts = 10
                reasons.append(f"P/E Ratio {pe:.1f}: Fairly valued for a growth market (+{pts}/20 pts)")
            elif pe <= 65:
                pts = 4
                reasons.append(f"P/E Ratio {pe:.1f}: Expensive; growth heavily priced in (+{pts}/20 pts)")
            else:
                pts = 0
                reasons.append(f"P/E Ratio {pe:.1f}: Significantly overvalued (+{pts}/20 pts)")
            total_score += pts
    except (ValueError, TypeError):
        pass

    # 6. Return on Equity (Max 20 pts)
    roe_raw = fundamentals.get("Return on Equity (%)", "N/A")
    try:
        roe_str = str(roe_raw).replace("%", "").strip()
        roe = float(roe_str) if roe_str not in ("N/A", "") else None
        if roe is not None:
            max_possible_score += 20
            if roe >= 16:
                pts = 20
                reasons.append(f"ROE {roe:.1f}%: Exceptional shareholder returns (+{pts}/20 pts)")
            elif roe >= 10:
                pts = 14
                reasons.append(f"ROE {roe:.1f}%: Strong profitability (+{pts}/20 pts)")
            elif roe >= 5:
                pts = 7
                reasons.append(f"ROE {roe:.1f}%: Average returns (+{pts}/20 pts)")
            elif roe >= 0:
                pts = 2
                reasons.append(f"ROE {roe:.1f}%: Poor returns (+{pts}/20 pts)")
            else:
                pts = 0
                reasons.append(f"ROE {roe:.1f}%: Negative ROE; destroying value (+{pts}/20 pts)")
            total_score += pts
    except (ValueError, TypeError):
        pass

    # 7. Debt-to-Equity (Max 10 pts)
    de_raw = fundamentals.get("Debt-to-Equity", "N/A")
    try:
        de_val = float(str(de_raw).replace(",", "")) if de_raw != "N/A" else None
        if de_val is not None:
            max_possible_score += 10
            actual_de = de_val / 100.0 if de_val > 20 else de_val
            
            # Cross-check reliability
            roe_check_str = str(fundamentals.get("Return on Equity (%)", "0")).replace("%", "").strip()
            roe_check = float(roe_check_str) if roe_check_str not in ("N/A", "") else 0
            
            if roe_check >= 16 and actual_de > 2.0:
                pts = 6
                reasons.append(f"D/E {actual_de:.2f}x: Elevated but strong ROE implies low real operating risk (+{pts}/10 pts)")
            elif actual_de <= 0.6:
                pts = 10
                reasons.append(f"D/E {actual_de:.2f}x: Very low leverage, strong balance sheet (+{pts}/10 pts)")
            elif actual_de <= 1.2:
                pts = 8
                reasons.append(f"D/E {actual_de:.2f}x: Healthy, manageable leverage (+{pts}/10 pts)")
            elif actual_de <= 2.5:
                pts = 4
                reasons.append(f"D/E {actual_de:.2f}x: Elevated debt, monitor closely (+{pts}/10 pts)")
            else:
                pts = 0
                reasons.append(f"D/E {actual_de:.2f}x: High debt, significant capability risk (+{pts}/10 pts)")
            total_score += pts
    except (ValueError, TypeError):
        pass

    # ── Normalize and Decide ───────────────────────────────────────
    if max_possible_score > 0:
        normalized_score = int(round((total_score / max_possible_score) * 100))
    else:
        normalized_score = 50

    if normalized_score >= 60:
        signal = "BUY"
    elif normalized_score <= 40:
        signal = "SELL"
    else:
        signal = "HOLD"

    return signal, normalized_score, reasons


def build_summary_text(signal: str, score: int, fundamentals: dict,
                       technicals: dict, reasons: list[str]) -> str:
    """Generate a human-readable paragraph summarising the IMFSMA recommendation."""
    name   = fundamentals.get("Company Name", "This stock")
    sector = fundamentals.get("Sector", "")

    signal_phrases = {
        "BUY":  "IMFSMA assigns a **BUY** rating for this stock.",
        "SELL": "IMFSMA assigns a **SELL** rating for this stock.",
        "HOLD": "IMFSMA assigns a **HOLD** rating for this stock.",
    }
    outro_map = {
        "BUY":  "The high score reflects a potent mix of fundamental health and technical momentum.",
        "SELL": "The low score reflects significant weaknesses or elevated downside risks.",
        "HOLD": "The moderate score suggests staying patient and waiting for more decisive indicators.",
    }

    intro = f"{name}"
    if sector:
        intro += f" ({sector})"
    intro += (f" has been evaluated by the IMFSMA 100-Point Algorithmic Matrix "
              f"(Overall Score: {score}/100). {signal_phrases[signal]}")

    return f"{intro} {outro_map[signal]}"


# ══════════════════════════════════════════════════════
#  JSON SANITISER (replace NaN/Inf → None for valid JSON)
# ══════════════════════════════════════════════════════

def _sanitise(obj):
    """Recursively replace float NaN/Inf with None so the result is JSON-safe."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitise(v) for v in obj]
    return obj


# ══════════════════════════════════════════════════════
#  FULL ANALYSIS PIPELINE
# ══════════════════════════════════════════════════════

def run_full_analysis(ticker: str) -> dict:
    """
    Entry point: fetch data, compute indicators, run decision matrix.
    Returns a JSON-serialisable dict.
    """
    hist = fetch_stock_data(ticker, period="1y")
    if hist.empty:
        return {"error": f"No historical data found for '{ticker}'. Please check the ticker symbol (e.g. TCS.NS, RELIANCE.NS)."}

    fundamentals = get_fundamental_data(ticker)
    technicals   = get_technical_indicators(hist)
    signal, score, reasons = generate_recommendation(fundamentals, technicals)
    summary = build_summary_text(signal, score, fundamentals, technicals, reasons)

    # Strip private series keys for lean API response
    chart_sma50  = technicals.pop("_sma50_series",  [])
    chart_sma200 = technicals.pop("_sma200_series", [])
    technicals.pop("_dates", None)

    result = {
        "ticker":       ticker.upper(),
        "signal":       signal,
        "score":        score,
        "summary":      summary,
        "reasons":      reasons,
        "fundamentals": fundamentals,
        "technicals":   technicals,
        "chart": {
            "dates":    hist["Date"].tolist(),
            "open":     hist["Open"].tolist(),
            "high":     hist["High"].tolist(),
            "low":      hist["Low"].tolist(),
            "close":    hist["Close"].tolist(),
            "volume":   hist["Volume"].tolist(),
            "sma50":    chart_sma50,
            "sma200":   chart_sma200,
        },
    }
    # Sanitise all NaN/Inf floats → None so Flask can serialise to valid JSON
    return _sanitise(result)
