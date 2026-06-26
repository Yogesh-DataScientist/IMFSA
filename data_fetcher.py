"""
data_fetcher.py
---------------
Provides helper functions for fetching market data via yfinance
and reading / writing the local portfolio CSV.
"""

import os

# Redirect cache directories to /tmp for serverless read-only environments
os.environ["YFINANCE_CACHE_DIR"] = "/tmp"
os.environ["MPLCONFIGDIR"] = "/tmp"

import pandas as pd
import yfinance as yf

PORTFOLIO_FILE_DEFAULT = os.path.join(os.path.dirname(__file__), "portfolio.csv")
PORTFOLIO_COLUMNS = ["ticker", "units", "buy_price"]

HISTORY_FILE_DEFAULT = os.path.join(os.path.dirname(__file__), "history.csv")
HISTORY_COLUMNS = ["date", "ticker", "price", "recommendation", "score"]

# Check if running in a serverless / read-only environment like Vercel
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    PORTFOLIO_FILE = "/tmp/portfolio.csv"
    HISTORY_FILE = "/tmp/history.csv"
    
    # Copy default files to /tmp if they don't exist yet so it starts with current defaults
    import shutil
    if not os.path.exists(PORTFOLIO_FILE) and os.path.exists(PORTFOLIO_FILE_DEFAULT):
        try:
            shutil.copy(PORTFOLIO_FILE_DEFAULT, PORTFOLIO_FILE)
        except Exception:
            pass
    if not os.path.exists(HISTORY_FILE) and os.path.exists(HISTORY_FILE_DEFAULT):
        try:
            shutil.copy(HISTORY_FILE_DEFAULT, HISTORY_FILE)
        except Exception:
            pass
else:
    PORTFOLIO_FILE = PORTFOLIO_FILE_DEFAULT
    HISTORY_FILE = HISTORY_FILE_DEFAULT


# ──────────────────────────────────────────────
# Market data helpers
# ──────────────────────────────────────────────

def fetch_index_data(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """
    Fetch OHLCV history for an index (e.g. '^NSEI', '^BSESN').
    Returns a DataFrame with columns: Date, Open, High, Low, Close, Volume.
    """
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval=interval)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    hist["Date"] = hist["Date"].astype(str)
    return hist[["Date", "Open", "High", "Low", "Close", "Volume"]]


def fetch_stock_data(ticker: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """
    Fetch OHLCV history for an NSE/BSE stock ticker (e.g. 'TCS.NS').
    Returns a DataFrame with columns: Date, Open, High, Low, Close, Volume.
    """
    t = yf.Ticker(ticker)
    hist = t.history(period=period, interval=interval)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    hist["Date"] = hist["Date"].astype(str)
    return hist[["Date", "Open", "High", "Low", "Close", "Volume"]]


def fetch_current_price(ticker: str):
    """Return the latest closing price for a ticker, or None on failure."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="2d")
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception:
        return None


def fetch_info(ticker: str) -> dict:
    """Return the yfinance info dict for a ticker."""
    try:
        return yf.Ticker(ticker).info or {}
    except Exception:
        return {}


# ──────────────────────────────────────────────
# Portfolio CSV helpers
# ──────────────────────────────────────────────

def load_portfolio() -> pd.DataFrame:
    """Load portfolio from CSV; returns empty DataFrame if file doesn't exist."""
    if not os.path.exists(PORTFOLIO_FILE):
        return pd.DataFrame(columns=PORTFOLIO_COLUMNS)
    try:
        df = pd.read_csv(PORTFOLIO_FILE)
        for col in PORTFOLIO_COLUMNS:
            if col not in df.columns:
                df[col] = None
        return df[PORTFOLIO_COLUMNS]
    except Exception:
        return pd.DataFrame(columns=PORTFOLIO_COLUMNS)


def save_portfolio(df: pd.DataFrame) -> None:
    """Persist portfolio DataFrame to CSV."""
    df[PORTFOLIO_COLUMNS].to_csv(PORTFOLIO_FILE, index=False)


def add_holding(ticker: str, units: float, buy_price: float) -> None:
    """Append a new holding to the portfolio CSV.
    We store the bare symbol (without exchange suffix) because the
    portfolio API resolves to .NS at fetch time via _resolve_ticker().
    """
    df = load_portfolio()
    bare_ticker = ticker.upper().strip().replace(".NS", "").replace(".BO", "")
    new_row = pd.DataFrame([{
        "ticker": bare_ticker,
        "units": units,
        "buy_price": buy_price,
    }])
    df = pd.concat([df, new_row], ignore_index=True)
    save_portfolio(df)


def remove_holding(index: int) -> bool:
    """Remove a holding by its row index. Returns True on success."""
    df = load_portfolio()
    if index < 0 or index >= len(df):
        return False
    df = df.drop(index=index).reset_index(drop=True)
    save_portfolio(df)
    return True


# ──────────────────────────────────────────────
# History CSV helpers
# ──────────────────────────────────────────────

def load_history() -> pd.DataFrame:
    """Load analysis history from CSV; returns empty DataFrame if file doesn't exist."""
    if not os.path.exists(HISTORY_FILE):
        return pd.DataFrame(columns=HISTORY_COLUMNS)
    try:
        df = pd.read_csv(HISTORY_FILE)
        for col in HISTORY_COLUMNS:
            if col not in df.columns:
                df[col] = None
        return df[HISTORY_COLUMNS]
    except Exception:
        return pd.DataFrame(columns=HISTORY_COLUMNS)


def save_history(df: pd.DataFrame) -> None:
    """Persist history DataFrame to CSV."""
    df[HISTORY_COLUMNS].to_csv(HISTORY_FILE, index=False)


def add_history_entry(ticker: str, price: float, recommendation: str, score: int) -> None:
    """Append a new analysis result to the history CSV."""
    from datetime import datetime
    df = load_history()
    new_row = pd.DataFrame([{
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "ticker": ticker.upper().strip(),
        "price": round(price, 2),
        "recommendation": recommendation,
        "score": score,
    }])
    df = pd.concat([df, new_row], ignore_index=True)
    save_history(df)


def remove_history_entry(index: int) -> bool:
    """Remove a history entry by its row index. Returns True on success."""
    df = load_history()
    if index < 0 or index >= len(df):
        return False
    df = df.drop(index=index).reset_index(drop=True)
    save_history(df)
    return True
