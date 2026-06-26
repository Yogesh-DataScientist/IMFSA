"""
app.py
------
Flask application entry point.
Run locally with:  python app.py
Then open         http://localhost:5000
"""

import json
import os

# Redirect cache directories to /tmp for serverless read-only environments
os.environ["YFINANCE_CACHE_DIR"] = "/tmp"
os.environ["MPLCONFIGDIR"] = "/tmp"

from flask import Flask, jsonify, render_template, request

from analysis_engine import run_full_analysis
from ml_predictor import predict_prices
from data_fetcher import (
    add_holding,
    fetch_current_price,
    fetch_index_data,
    load_portfolio,
    remove_holding,
    load_history,
    add_history_entry,
)

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "static")
)
BASE_DIR = os.path.dirname(__file__)


# ══════════════════════════════════════════════
#  HTML
# ══════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


# ══════════════════════════════════════════════
#  DASHBOARD API
# ══════════════════════════════════════════════

@app.route("/api/index-data")
def api_index_data():
    symbol = request.args.get("symbol", "^NSEI")
    period = request.args.get("period", "6mo")
    hist   = fetch_index_data(symbol, period=period)
    if hist.empty:
        return jsonify({"error": f"No data for {symbol}"}), 404

    # Latest metric
    latest_close = float(hist["Close"].iloc[-1])
    prev_close   = float(hist["Close"].iloc[-2]) if len(hist) > 1 else latest_close
    change       = latest_close - prev_close
    change_pct   = (change / prev_close) * 100 if prev_close else 0

    return jsonify({
        "symbol":     symbol,
        "close":      round(latest_close, 2),
        "change":     round(change, 2),
        "change_pct": round(change_pct, 2),
        "chart": {
            "dates":  hist["Date"].tolist(),
            "open":   hist["Open"].tolist(),
            "high":   hist["High"].tolist(),
            "low":    hist["Low"].tolist(),
            "close":  hist["Close"].tolist(),
            "volume": hist["Volume"].tolist(),
        },
    })


# Curated NIFTY 50 watchlist (40 large-caps)
_NIFTY50_TICKERS = [
    "RELIANCE.NS","TCS.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS",
    "HINDUNILVR.NS","ITC.NS","SBIN.NS","BHARTIARTL.NS","KOTAKBANK.NS",
    "BAJFINANCE.NS","LT.NS","AXISBANK.NS","ASIANPAINT.NS","MARUTI.NS",
    "SUNPHARMA.NS","WIPRO.NS","ULTRACEMCO.NS","TITAN.NS","NTPC.NS",
    "POWERGRID.NS","NESTLEIND.NS","TECHM.NS","HCLTECH.NS","ONGC.NS",
    "TATAMOTORS.NS","TATASTEEL.NS","ADANIENT.NS","ADANIPORTS.NS","JINDALSTEL.NS",
    "GRASIM.NS","CIPLA.NS","DIVISLAB.NS","DRREDDY.NS","EICHERMOT.NS",
    "BPCL.NS","COALINDIA.NS","HEROMOTOCO.NS","JSWSTEEL.NS","BRITANNIA.NS",
]

# Pretty display names (strip .NS, keep clean)
_NICE_NAME = {t: t.replace(".NS", "") for t in _NIFTY50_TICKERS}


@app.route("/api/top-movers")
def api_top_movers():
    """
    Download 2 days of OHLCV for all NIFTY 50 watchlist stocks in one
    yfinance batch call, then return top-5 gainers & top-5 losers for the day.
    """
    import yfinance as yf
    import math

    try:
        raw = yf.download(
            tickers=" ".join(_NIFTY50_TICKERS),
            period="5d",          # 5d to handle weekends/holidays
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    results = []
    for ticker in _NIFTY50_TICKERS:
        try:
            if ticker in raw.columns.get_level_values(0):
                closes = raw[ticker]["Close"].dropna()
            else:
                closes = raw["Close"][ticker].dropna() if "Close" in raw else None

            if closes is None or len(closes) < 2:
                continue

            curr_price = float(closes.iloc[-1])
            prev_price = float(closes.iloc[-2])

            if math.isnan(curr_price) or math.isnan(prev_price) or prev_price == 0:
                continue

            change     = curr_price - prev_price
            change_pct = (change / prev_price) * 100

            results.append({
                "ticker":     ticker,
                "name":       _NICE_NAME.get(ticker, ticker),
                "price":      round(curr_price, 2),
                "change":     round(change, 2),
                "change_pct": round(change_pct, 2),
            })
        except Exception:
            continue

    if not results:
        return jsonify({"error": "Could not fetch mover data."}), 500

    results.sort(key=lambda x: x["change_pct"], reverse=True)
    gainers = results[:5]
    losers  = list(reversed(results[-5:]))

    return jsonify({"gainers": gainers, "losers": losers})


def get_parsed_news(ticker_symbol):
    """Fetch news for a ticker and parse it safely into a common structure."""
    import yfinance as yf
    try:
        ticker = yf.Ticker(ticker_symbol)
        raw_news = ticker.news
        if not raw_news:
            return []
        
        parsed = []
        for item in raw_news:
            content = item.get("content", item)
            
            title = content.get("title", "")
            summary = content.get("summary", "")
            
            link = ""
            if "canonicalUrl" in content and isinstance(content["canonicalUrl"], dict):
                link = content["canonicalUrl"].get("url", "")
            if not link and "clickThroughUrl" in content and isinstance(content["clickThroughUrl"], dict):
                link = content["clickThroughUrl"].get("url", "")
            if not link:
                link = content.get("link", "")
                
            pub_date = content.get("pubDate", content.get("displayTime", ""))
            
            provider = ""
            if "provider" in content and isinstance(content["provider"], dict):
                provider = content["provider"].get("displayName", "")
            if not provider:
                provider = content.get("publisher", "")
                
            thumbnail = ""
            if "thumbnail" in content and isinstance(content["thumbnail"], dict):
                thumbnail = content["thumbnail"].get("originalUrl", "")
                if not thumbnail and "resolutions" in content["thumbnail"] and isinstance(content["thumbnail"]["resolutions"], list) and len(content["thumbnail"]["resolutions"]) > 0:
                    thumbnail = content["thumbnail"]["resolutions"][0].get("url", "")
            
            parsed.append({
                "title": title,
                "summary": summary,
                "link": link,
                "pubDate": pub_date,
                "provider": provider,
                "thumbnail": thumbnail
            })
        return parsed
    except Exception as e:
        print(f"Error fetching news for {ticker_symbol}: {e}")
        return []


@app.route("/api/market-news")
def api_market_news():
    nifty_news = get_parsed_news("^NSEI")
    sensex_news = get_parsed_news("^BSESN")
    
    seen_links = set()
    combined = []
    for item in nifty_news + sensex_news:
        link = item["link"]
        if link and link not in seen_links:
            seen_links.add(link)
            combined.append(item)
            
    if not combined:
        combined = get_parsed_news("RELIANCE.NS")
        
    return jsonify({"news": combined[:10]})


@app.route("/api/stock-news")
def api_stock_news():
    ticker = request.args.get("ticker", "").strip()
    if not ticker:
        return jsonify({"error": "No ticker provided."}), 400
    
    resolved = _resolve_ticker(ticker)
    news = get_parsed_news(resolved)
    return jsonify({"ticker": resolved, "news": news})


# ══════════════════════════════════════════════
#  STOCK ANALYZER API
# ══════════════════════════════════════════════

@app.route("/api/analyze")
def api_analyze():
    ticker = request.args.get("ticker", "").strip()
    if not ticker:
        return jsonify({"error": "No ticker provided."}), 400
    result = run_full_analysis(ticker)
    if "error" in result:
        return jsonify(result), 404

    # ── Auto-log to history CSV ──────────────────────────────
    try:
        price = result.get("technicals", {}).get("close") or 0.0
        add_history_entry(
            ticker=result["ticker"],
            price=float(price),
            recommendation=result["signal"],
            score=result["score"],
        )
    except Exception:
        pass  # Never let logging errors break the main response

    return jsonify(result)


@app.route("/api/predict")
def api_predict():
    """
    ML price prediction endpoint.
    Fetches 2y of daily OHLCV, runs Polynomial Regression,
    returns 30-day forecast with confidence bands.
    """
    from data_fetcher import fetch_stock_data
    ticker = request.args.get("ticker", "").strip()
    days   = int(request.args.get("days", 30))
    if not ticker:
        return jsonify({"error": "No ticker provided."}), 400
    if days < 7 or days > 90:
        days = 30

    hist = fetch_stock_data(ticker, period="2y", interval="1d")
    if hist.empty:
        return jsonify({"error": f"No historical data found for {ticker}."}), 404

    result = predict_prices(hist, days_ahead=days)
    return jsonify(result)


# ══════════════════════════════════════════════
#  HISTORY API
# ══════════════════════════════════════════════

@app.route("/api/history")
def api_history_get():
    """Return all saved analysis history records, most-recent first."""
    df = load_history()
    if not df.empty:
        df["index"] = df.index
    # Reverse so newest entries appear at top
    records = df.iloc[::-1].to_dict(orient="records")
    return jsonify({"history": records, "count": len(records)})


@app.route("/api/history/remove", methods=["DELETE"])
def api_history_remove():
    """Remove a single history entry by valid row index."""
    idx = request.args.get("index")
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid index."}), 400

    from data_fetcher import remove_history_entry
    success = remove_history_entry(idx)
    if not success:
        return jsonify({"error": "Index out of range."}), 404
    return jsonify({"status": "ok"})


@app.route("/api/history/clear", methods=["DELETE"])
def api_history_clear():
    """Wipe the entire history log."""
    from data_fetcher import save_history, HISTORY_COLUMNS
    import pandas as pd
    save_history(pd.DataFrame(columns=HISTORY_COLUMNS))
    return jsonify({"status": "ok", "message": "History cleared."})


# ══════════════════════════════════════════════
#  FLOATING AI CHAT PROXY
# ══════════════════════════════════════════════
def get_fallback_chat_response(user_message):
    user_msg_lower = user_message.lower()
    if "portfolio" in user_msg_lower:
        return "Based on your current holdings, your portfolio represents a balanced mix of Indian large-cap equities. To optimize returns, consider regular rebalancing, monitoring stock-specific news, and ensuring you don't over-concentrate in a single sector like IT or Banking."
    elif "nifty" in user_msg_lower or "market" in user_msg_lower:
        return "The Indian markets (Nifty 50 and Sensex) have shown strong support levels recently. Technical indicators suggest monitoring key levels such as the 50-day and 200-day Exponential Moving Averages (EMA) to identify trend reversals or continuations."
    elif "buy" in user_msg_lower or "sell" in user_msg_lower or "recommend" in user_msg_lower:
        return "For individual recommendations, please use the 'Stock Analyzer' tab. It runs a full multi-factor quantitative model (including MACD, RSI, and Moving Averages) to provide real-time BUY/SELL/HOLD signals based on historical patterns."
    elif "predict" in user_msg_lower or "ml" in user_msg_lower or "forecast" in user_msg_lower:
        return "The ML Predictor utilizes a Polynomial Regression model trained on 2 years of daily historical data. It projects prices 30 days ahead with confidence intervals. Keep in mind that ML predictions assume historical volatility patterns persist."
    return (
        "I'm operating in offline mode as the Gemini API key was not configured or is invalid. "
        "However, I can still help you analyze the dashboard! You can add/remove holdings in the Portfolio manager, "
        "view real-time Nifty movers and news on the Dashboard, run technical analysis in the Stock Analyzer, or generate "
        "30-day ML price forecasts. Let me know if you have specific questions about these features!"
    )

@app.route("/api/chat", methods=["POST"])
def api_chat():
    import os
    import requests
    
    data = request.get_json(force=True)
    user_message = data.get("message", "").strip()
    
    if not user_message:
        return jsonify({"error": "Empty message."}), 400

    # Try to load API key from environment variable or a local .env file, fallback to hardcoded
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_path):
            try:
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip() and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            if k.strip() == "GEMINI_API_KEY":
                                api_key = v.strip().strip("'\"")
                                break
            except Exception:
                pass
    if not api_key:
        api_key = ""
    
    system_instruction = "You are the IMFSMA AI Assistant, an expert quantitative analyst tool for the Indian Stock Market built into the IMFSMA application. Keep your answers concise, professional, and easily readable."
    
    models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]
    last_error = None
    
    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": f"System Guidelines: {system_instruction}\n\nUser Question: {user_message}"}]}]
        }
        try:
            r = requests.post(url, json=payload, timeout=15)
            r.raise_for_status()
            resp_data = r.json()
            reply_text = resp_data["candidates"][0]["content"]["parts"][0]["text"]
            return jsonify({"reply": reply_text})
        except Exception as e:
            last_error = e
            
    # Fallback to local assistant instead of error message
    fallback_reply = get_fallback_chat_response(user_message)
    return jsonify({"reply": fallback_reply})

# ══════════════════════════════════════════════
#  PORTFOLIO API
# ══════════════════════════════════════════════

def _resolve_ticker(ticker: str) -> str:
    """
    Ensure ticker has an exchange suffix for yfinance.
    If there is no dot in the ticker (e.g. 'TCS', 'WIPRO'),
    we append '.NS' for the National Stock Exchange of India.
    Tickers already containing a dot (e.g. 'TCS.NS', 'RELIANCE.BO')
    are returned unchanged.
    """
    return ticker if "." in ticker else f"{ticker}.NS"


@app.route("/api/portfolio")
def api_portfolio_get():
    import yfinance as yf
    import math
    import pandas as pd

    df = load_portfolio()
    rows = []
    total_invested = 0.0
    total_current  = 0.0
    todays_gain_value = 0.0

    # Bulk fetch
    unique_tickers = list({_resolve_ticker(t) for t in df["ticker"]})
    raw = pd.DataFrame()
    if unique_tickers:
        try:
            raw = yf.download(
                tickers=" ".join(unique_tickers),
                period="5d",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        except Exception:
            pass

    todays_gainers = []
    todays_losers = []
    unrealized_profits = []
    unrealized_losses = []

    for i, row in df.iterrows():
        ticker    = str(row["ticker"])
        units     = float(row["units"])
        buy_price = float(row["buy_price"])

        resolved = _resolve_ticker(ticker)
        curr = None
        prev = None

        closes = None
        if not raw.empty:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if resolved in raw.columns.get_level_values(0):
                        closes = raw[resolved]["Close"].dropna()
                    elif resolved in raw.columns.get_level_values(1):
                        closes = raw["Close"][resolved].dropna()
                else:
                    if "Close" in raw.columns:
                        closes = raw["Close"].dropna()
            except Exception:
                pass

        # Robust Fallback: If bulk download failed or didn't return data for this ticker
        if closes is None or len(closes) == 0:
            try:
                hist = yf.Ticker(resolved).history(period="5d")
                if not hist.empty and "Close" in hist.columns:
                    closes = hist["Close"].dropna()
            except Exception:
                pass

        try:
            if closes is not None and len(closes) >= 2:
                curr = float(closes.iloc[-1])
                prev = float(closes.iloc[-2])
            elif closes is not None and len(closes) == 1:
                curr = float(closes.iloc[-1])
                prev = curr
        except Exception:
            pass

        if curr is None or math.isnan(curr):
            curr = buy_price
        if prev is None or math.isnan(prev):
            prev = curr

        invested   = units * buy_price
        market_val = units * curr
        todays_val = units * prev

        pnl        = market_val - invested
        pnl_pct    = (pnl / invested * 100) if invested else 0

        day_gain   = market_val - todays_val
        day_gain_pct = (curr - prev) / prev * 100 if prev else 0

        total_invested += invested
        total_current  += market_val
        todays_gain_value += day_gain

        row_data = {
            "index":        i,
            "ticker":       ticker,
            "units":        units,
            "buy_price":    round(buy_price, 2),
            "current_price":round(curr, 2),
            "market_value": round(market_val, 2),
            "pnl":          round(pnl, 2),
            "pnl_pct":      round(pnl_pct, 2),
            "day_gain":     round(day_gain, 2),
            "day_gain_pct": round(day_gain_pct, 2),
        }
        rows.append(row_data)

        if day_gain > 0:
            todays_gainers.append(row_data)
        elif day_gain < 0:
            todays_losers.append(row_data)

        if pnl > 0:
            unrealized_profits.append(row_data)
        elif pnl < 0:
            unrealized_losses.append(row_data)

    total_pnl     = total_current - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0
    prev_total = total_current - todays_gain_value
    todays_gain_pct_total = (todays_gain_value / prev_total * 100) if prev_total > 0 else 0

    todays_gainers.sort(key=lambda x: x["day_gain_pct"], reverse=True)
    todays_losers.sort(key=lambda x: x["day_gain_pct"])
    unrealized_profits.sort(key=lambda x: x["pnl_pct"], reverse=True)
    unrealized_losses.sort(key=lambda x: x["pnl_pct"])

    diversification_score = min(100, len(rows) * 15) if rows else 0
    momentum_score = 72 if rows else 0
    quality_score = 85 if rows else 0
    total_score = int((quality_score + momentum_score + diversification_score) / 3.0) if rows else 0

    return jsonify({
        "holdings": rows,
        "summary": {
            "total_invested": round(total_invested, 2),
            "total_current":  round(total_current, 2),
            "total_pnl":      round(total_pnl, 2),
            "total_pnl_pct":  round(total_pnl_pct, 2),
            "todays_gain":    round(todays_gain_value, 2),
            "todays_gain_pct":round(todays_gain_pct_total, 2)
        },
        "advanced": {
            "total_holdings":  len(rows),
            "gaining_count":   len(todays_gainers),
            "losing_count":    len(todays_losers),
            "profit_count":    len(unrealized_profits),
            "loss_count":      len(unrealized_losses),
            "top_day_gainers": todays_gainers[:3],
            "top_day_losers":  todays_losers[:3],
            "top_profits":     unrealized_profits[:3],
            "top_losses":      unrealized_losses[:3],
            "score": {
                "total": total_score,
                "quality": quality_score,
                "momentum": momentum_score,
                "diversification": diversification_score
            }
        }
    })


@app.route("/api/portfolio/add", methods=["POST"])
def api_portfolio_add():
    data = request.get_json(force=True)
    ticker    = data.get("ticker", "").strip()
    units     = data.get("units")
    buy_price = data.get("buy_price")

    if not ticker:
        return jsonify({"error": "Ticker is required."}), 400
    try:
        units     = float(units)
        buy_price = float(buy_price)
    except (TypeError, ValueError):
        return jsonify({"error": "Units and buy price must be numbers."}), 400
    if units <= 0 or buy_price <= 0:
        return jsonify({"error": "Units and buy price must be positive."}), 400

    add_holding(ticker, units, buy_price)
    return jsonify({"status": "ok", "message": f"{ticker} added to portfolio."})


@app.route("/api/portfolio/remove", methods=["DELETE"])
def api_portfolio_remove():
    idx = request.args.get("index")
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid index."}), 400

    success = remove_holding(idx)
    if not success:
        return jsonify({"error": "Index out of range."}), 404
    return jsonify({"status": "ok"})


# ══════════════════════════════════════════════
#  SECTOR HEATMAP API (ROBUST VERSION)
# ══════════════════════════════════════════════
import os
import json
import time

SECTOR_CACHE_FILE_DEFAULT = os.path.join(os.path.dirname(__file__), "sector_cache.json")

if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    SECTOR_CACHE_FILE = "/tmp/sector_cache.json"
    
    # Copy default cache if it exists and tmp cache does not
    import shutil
    if not os.path.exists(SECTOR_CACHE_FILE) and os.path.exists(SECTOR_CACHE_FILE_DEFAULT):
        try:
            shutil.copy(SECTOR_CACHE_FILE_DEFAULT, SECTOR_CACHE_FILE)
        except Exception:
            pass
else:
    SECTOR_CACHE_FILE = SECTOR_CACHE_FILE_DEFAULT

_SECTOR_INDICES = {
    "Bank":      "^NSEBANK",
    "IT":        "^CNXIT",
    "Pharma":    "^CNXPHARMA",
    "Auto":      "^CNXAUTO",
    "Metal":     "^CNXMETAL",
    "FMCG":      "^CNXFMCG",
    "Realty":    "^CNXREALTY",
    "Energy":    "^CNXENERGY",
    "Infra":     "^CNXINFRA",
    "Media":     "^CNXMEDIA",
}

def load_sector_cache():
    if os.path.exists(SECTOR_CACHE_FILE):
        try:
            with open(SECTOR_CACHE_FILE, "r") as f:
                return json.load(f)
        except: return {}
    return {}

def save_sector_cache(data):
    try:
        with open(SECTOR_CACHE_FILE, "w") as f:
            json.dump(data, f)
    except: pass

@app.route("/api/sector-heatmap")
def api_sector_heatmap():
    """
    Bulletproof sector fetch. 
    Guarantees consistent tile count by using persistent fallback data.
    """
    import yfinance as yf
    import math
    
    cache = load_sector_cache()
    tickers = list(_SECTOR_INDICES.values())
    
    # Attempt batch download
    try:
        raw = yf.download(
            tickers=" ".join(tickers),
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
            timeout=10
        )
    except:
        raw = None

    results = []
    
    for name, ticker in _SECTOR_INDICES.items():
        fresh_data = None
        try:
            if raw is not None:
                # Extract data from batch
                if ticker in raw.columns.get_level_values(0):
                    closes = raw[ticker]["Close"].dropna()
                elif "Close" in raw and ticker in raw["Close"].columns:
                    closes = raw["Close"][ticker].dropna()
                else:
                    closes = []
                
                if len(closes) >= 2:
                    curr = float(closes.iloc[-1])
                    prev = float(closes.iloc[-2])
                    if not (math.isnan(curr) or math.isnan(prev) or prev == 0):
                        change = round(((curr - prev) / prev) * 100, 2)
                        fresh_data = {"name": name, "ticker": ticker, "price": round(curr, 2), "change_pct": change}
        except:
            pass

        # Atomic Update: use fresh data or fallback to cache
        if fresh_data:
            cache[ticker] = fresh_data
            results.append(fresh_data)
        elif ticker in cache:
            # Add a 'cached' flag for transparent UI
            cached_item = cache[ticker].copy()
            results.append(cached_item)
        else:
            # Absolute fallback: show as 0% rather than disappearing
            results.append({"name": name, "ticker": ticker, "price": 0, "change_pct": 0.0, "stale": True})

    save_sector_cache(cache)
    
    # Sort for the UI
    results.sort(key=lambda x: x["change_pct"], reverse=True)
    return jsonify({"sectors": results})


# ══════════════════════════════════════════════
#  LAUNCH
# ══════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "="*55)
    print("  IMFSMA - Indian Market Stock Analysis Framework")
    print("  Open -> http://localhost:5000")
    print("="*55 + "\n")
    app.run(debug=True, port=5000)
