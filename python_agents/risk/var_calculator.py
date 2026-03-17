import yfinance as yf
import numpy as np

def calculate_var(ticker: str, position_value: float,
                  confidence: float = 0.95, days: int = 30) -> dict:
    stock   = yf.Ticker(ticker)
    hist    = stock.history(period="90d")
    returns = hist["Close"].pct_change().dropna()

    # Historical VaR
    var_pct = float(np.percentile(returns, (1 - confidence) * 100))
    var_usd = abs(var_pct) * position_value

    return {
        "var_pct":    round(abs(var_pct), 4),
        "var_usd":    round(var_usd, 2),
        "confidence": confidence,
        "volatility": round(float(returns.std()), 4)
    }