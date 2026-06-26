"""
ml_predictor.py
---------------
Lightweight Machine Learning price predictor using
Polynomial Regression (scikit-learn).

- No GPU required
- Trains on 1-2 years of daily data in < 100ms
- Returns historical prices + 30-day forecast + confidence bands
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures
from sklearn.pipeline import make_pipeline


def predict_prices(hist_df: pd.DataFrame, days_ahead: int = 30) -> dict:
    """
    Fit a Polynomial Regression model on historical close prices and
    forecast the next `days_ahead` trading days.

    Parameters
    ----------
    hist_df   : DataFrame with at least columns ['Date', 'Close']
    days_ahead: Number of future trading days to predict (default 30)

    Returns
    -------
    dict with keys:
        hist_dates  : list[str]   — historical date strings (last 6 months shown)
        hist_prices : list[float] — historical close prices
        pred_dates  : list[str]   — predicted future trading date strings
        pred_prices : list[float] — predicted close prices
        upper_band  : list[float] — upper confidence boundary (widens over time)
        lower_band  : list[float] — lower confidence boundary
        model_info  : str         — human-readable model description
        days_ahead  : int
        last_price  : float       — last known close price
        target_price: float       — predicted price at end of forecast window
        change_pct  : float       — expected % change over forecast window
    """
    df = hist_df.copy().reset_index(drop=True)

    # Keep only rows with valid Close prices
    df = df.dropna(subset=["Close"])

    if len(df) < 60:
        return {"error": "Not enough historical data for ML prediction (need at least 60 trading days)."}

    # ── Training data: use last 2 years (max 500 rows) ────────────────────
    train_df = df.tail(500).reset_index(drop=True)

    X_train = np.arange(len(train_df)).reshape(-1, 1).astype(float)
    y_train = train_df["Close"].values.astype(float)

    # ── Model: degree-2 polynomial regression ────────────────────────────
    # Degree 2 captures long-term trend curvature (e.g., parabolic rallies /
    # corrections) without wildly overfitting like higher degrees do.
    model = make_pipeline(
        PolynomialFeatures(degree=2, include_bias=False),
        LinearRegression()
    )
    model.fit(X_train, y_train)

    # ── Residual standard deviation → confidence band ────────────────────
    y_fit = model.predict(X_train)
    residuals = y_train - y_fit
    std_resid = float(np.std(residuals))

    # ── Forecast future trading days ─────────────────────────────────────
    future_start_idx = len(train_df)
    future_indices = np.arange(
        future_start_idx, future_start_idx + days_ahead
    ).reshape(-1, 1).astype(float)

    # Generate future trading dates (skip weekends — no Indian holiday check
    # needed at this level of approximation)
    last_date = pd.to_datetime(train_df["Date"].iloc[-1])
    future_dates = []
    d = last_date
    while len(future_dates) < days_ahead:
        d += pd.Timedelta(days=1)
        if d.weekday() < 5:          # Mon–Fri
            future_dates.append(d.strftime("%Y-%m-%d"))

    raw_pred = model.predict(future_indices)
    pred_prices = np.clip(raw_pred, 0, None)   # prices can't be negative

    # Confidence bands: uncertainty grows linearly over the forecast horizon
    time_factor = np.linspace(1.0, 2.8, days_ahead)
    upper = pred_prices + std_resid * time_factor
    lower = np.clip(pred_prices - std_resid * time_factor, 0, None)

    # ── For the chart, only show the last 6 months of history ────────────
    display_df = train_df.tail(180)

    last_price   = float(train_df["Close"].iloc[-1])
    target_price = float(pred_prices[-1])
    change_pct   = ((target_price - last_price) / last_price) * 100 if last_price else 0.0

    return {
        "hist_dates":   display_df["Date"].tolist(),
        "hist_prices":  [round(float(p), 2) for p in display_df["Close"].values],
        "pred_dates":   future_dates,
        "pred_prices":  [round(float(p), 2) for p in pred_prices],
        "upper_band":   [round(float(p), 2) for p in upper],
        "lower_band":   [round(float(p), 2) for p in lower],
        "model_info":   "Polynomial Regression · Degree 2 · Trained on last 2 years of daily closes",
        "days_ahead":   days_ahead,
        "last_price":   round(last_price, 2),
        "target_price": round(target_price, 2),
        "change_pct":   round(change_pct, 2),
    }
