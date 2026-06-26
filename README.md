# IMFSA - Intelligent Multidimensional Framework For Stock Analysis 

IMFSMA is a local, interactive web application designed for comprehensive stock market analysis, focusing primarily on the Indian market (e.g., NIFTY 50) while also supporting global stocks. It provides a rich dashboard, technical market diagnostics, portfolio tracking, and Machine Learning-powered price predictions.

## Features

- **Interactive Dashboard:** View real-time or end-of-day market index data and the latest top gainers/losers from the NIFTY 50.
- **Stock Analyzer:** Fetch deep technical analysis for individual tickers.
- **Machine Learning Price Prediction:** Generates a 30-day forecasted price trajectory with confidence bands using Polynomial Regression on historical daily OHLCV data.
- **Portfolio Management:** Add or remove holdings, track total invested amounts, current market values, and individual/overall profit and loss (PnL).
- **Windows Control Panel:** Includes an easy-to-use batch script (`imfsma.bat`) to launch the application and open the browser automatically.

## Tools & Technologies

This project is built using the following stack:

**Backend:**
- **Python:** Core programming language.
- **Flask:** Lightweight web framework for the backend API and routing.
- **yFinance:** Library for downloading financial market data from Yahoo Finance.
- **Data Science/ML:** `pandas`, `pandas-ta`, `numpy`, and `scikit-learn` to process data, calculate technical indicators, and train predictive models.

**Frontend:**
- **HTML/CSS/JavaScript:** Used in the `templates/` and `static/` directories to create the interactive user interface.

## Prerequisites

- **Python 3.8+** installed on your system.
- Basic command-line knowledge.

## Setup Instructions

**1. Clone or Download the repository**  
Extract the files into a directory of your choice.

**2. Open your Terminal or Command Prompt**  
Navigate to the root directory of the project.

**3. Install Dependencies**  
Install all the required Python libraries using the `requirements.txt` file by running:
```bash
pip install -r requirements.txt
```

**4. Run the Application**

- **Option A (For Windows Users - Recommended):**  
  Simply double-click on the `imfsma.bat` file.  
  A menu will appear:
  - Press `1` to **Start Application** (This spins up the local server and automatically opens `http://127.0.0.1:5000` in your default browser).
  - Press `2` to **Stop Application** (Shuts down the background server cleanly).
  - Press `3` to **Exit** the prompt.

- **Option B (Manual / Cross-Platform):**  
  Run the Flask app directly using Python:
  ```bash
  python app.py
  ```
  Once the server is running, manually open your web browser and navigate to:  
  `http://localhost:5000`

## Structure

```
IMDFSMA-repo/
├── requirements.txt      # Python package dependencies
├── app.py                # Main Flask application and API endpoints
├── analysis_engine.py    # Logic for fundamental/technical stock analysis
├── data_fetcher.py       # Functions querying the yFinance API
├── ml_predictor.py       # Polynomial Regression machine learning model
├── imfsma.bat            # Windows batch script for easy execution
├── portfolio.csv         # Local datastore for tracked holdings
├── static/               # CSS, JS, and image assets
└── templates/            # HTML templates for Flask
```

Enjoy analyzing the markets!
