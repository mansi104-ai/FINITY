import time

HISTORY_DAYS = 90
TRAIN_WINDOW = 60
BUY_THRESHOLD = 0.005
SELL_THRESHOLD = -0.005
RSI_PERIOD = 14
MA_SHORT = 5
MA_LONG = 20
VOL_WINDOW = 20
GBM_MU = 0.0003
GBM_SIGMA = 0.015

try:
    from ..models.market_data import MarketDataService
    from ..models.market_forecaster import MarketForecaster
except Exception:
    try:
        from models.market_data import MarketDataService
        from models.market_forecaster import MarketForecaster
    except ModuleNotFoundError:
        from python_agents.models.market_data import MarketDataService
        from python_agents.models.market_forecaster import MarketForecaster


class AnalystAgent:
    def __init__(self) -> None:
        self.data_service = MarketDataService()
        self.forecaster = MarketForecaster()

    def predict(self, ticker: str, query: str, sentiment: dict | None = None) -> dict:
        start = time.perf_counter()
        sentiment = sentiment or {}
        market_history = self.data_service.get_history(ticker=ticker, period="3y", interval="1d")

        # Cross-sectional market-context feature (Phase B step 8). Best-effort:
        # if SPY can't be fetched (rate limit, network hiccup, etc.) the
        # underlying feature vector already falls back to a neutral 0.0 for
        # this feature (see MarketForecaster._market_momentum_feature), so a
        # SPY fetch failure degrades gracefully rather than breaking the
        # ticker's own prediction.
        spy_frame = None
        if ticker.upper() != "SPY":
            try:
                spy_history = self.data_service.get_history(ticker="SPY", period="3y", interval="1d")
                spy_frame = spy_history.frame
            except Exception:
                spy_frame = None

        result = self.forecaster.predict(
            market_history.frame,
            ticker=ticker,
            query=query,
            sentiment_score=float(sentiment.get("score", 0.5)),
            sentiment_level=str(sentiment.get("level", "HOLD")),
            data_source=market_history.source,
            market_history=spy_frame,
        )
        result["durationMs"] = int((time.perf_counter() - start) * 1000)
        result["message"] = (
            f"Generated {result.get('horizonLabel', 'forward')} forecast from {market_history.source} history"
        )
        result.setdefault("methodFactors", []).extend(
            [
                f"Analyst constants: history_days={HISTORY_DAYS}, train_window={TRAIN_WINDOW}, RSI={RSI_PERIOD}, MA={MA_SHORT}/{MA_LONG}, vol_window={VOL_WINDOW}.",
                f"Decision thresholds: buy if predicted return >= {BUY_THRESHOLD:.3f}, sell if <= {SELL_THRESHOLD:.3f}.",
                f"GBM fallback params: mu={GBM_MU}, sigma={GBM_SIGMA}.",
                "Feature set includes normalized 20-day volume ratio (V_t/V-bar), MACD histogram, "
                "Bollinger %B, and (when SPY is available) 5-day relative momentum vs. the market.",
                "Ridge and the classifier are fit on identically standardized + winsorized features per "
                "rolling training window (no longer separately/inconsistently scaled).",
                "Directional accuracy is reported both for the raw Ridge regressor and for a Ridge+logistic-classifier ensemble.",
            ]
        )
        return result