"""Analyst v2 -- a distribution, a regime and a rank, not a direction.

The v1 Analyst emitted a point forecast of return and a bare bullish/bearish
label. Measured over 39 tickers and ten years it had no positive predictive
ability at 1, 5 or 21 trading days -- information coefficient negative at all
three horizons, directional accuracy significantly *below* chance at h=1. A
point estimate of an unpredictable quantity is not a useful object, and
everything downstream that conditioned on it was conditioning on noise.

This redesign changes what the Analyst is asked to produce:

    OHLCV -> features -> regime -> return DISTRIBUTION -> calibrated
             confidence -> cross-sectional rank -> Risk Manager

Five outputs instead of one, chosen because each is either separately
measurable or separately actionable:

**Expected return with uncertainty.** A mean alone cannot express "I do not
know", which is the correct answer most days. Reporting sigma alongside mu
lets the Risk Manager size on the ratio rather than the level, and makes
abstention representable.

**Market regime.** Volatility clusters -- one of the most robust facts in
empirical finance -- so regime is genuinely estimable even where direction is
not. Conditioning on regime is not the same as predicting it.

**Cross-sectional rank.** This is the substantive change. "Will this stock
rise?" and "is this stock stronger than its peers today?" are different
questions with different difficulty. Absolute direction showed negative IC;
relative ranking is the standard formulation in cross-sectional equity work
and is untested here. Ranking requires the whole universe on one date, so it
cannot be produced by a per-ticker call -- hence `rank_universe`.

**Calibrated confidence.** Raw model confidence is not a probability. Here it
is mapped through a reliability curve fitted on realised outcomes, so a
stated 0.7 means the call was right about 70% of the time historically. Only
then is it safe for the Risk Manager to size on.

Every estimate is computed from a strictly backward-looking window. Nothing
in this module uses the bar it is predicting.

No language model is involved.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np

TRADING_DAYS = 252


# --------------------------------------------------------------------------

@dataclass
class RegimeState:
    """Where the market is, not where it is going."""

    label: str                  # calm_trending | calm_choppy | volatile_trending | volatile_choppy
    realised_vol_annual: float
    trend_strength: float       # [-1, 1]; sign is direction, magnitude persistence
    vol_percentile: float       # this asset's vol against its own history
    drawdown_from_peak: float


@dataclass
class ReturnDistribution:
    """A distribution, so that "I don't know" is representable."""

    mu: float                   # expected return over the horizon
    sigma: float                # standard deviation of that estimate
    horizon_days: int
    quantiles: Dict[str, float] = field(default_factory=dict)   # p05, p25, p50, p75, p95

    @property
    def prob_positive(self) -> float:
        if self.sigma <= 1e-12:
            return 1.0 if self.mu > 0 else 0.0
        return float(0.5 * (1.0 + math.erf(self.mu / (self.sigma * math.sqrt(2.0)))))

    @property
    def information_ratio(self) -> float:
        """mu/sigma -- what a sizing rule should key on, not mu alone."""
        return float(self.mu / self.sigma) if self.sigma > 1e-12 else 0.0


@dataclass
class AnalystView:
    ticker: str
    as_of: str
    distribution: ReturnDistribution
    regime: RegimeState
    confidence: float                       # calibrated; see Calibrator
    raw_confidence: float                   # pre-calibration, kept for auditing
    cross_sectional_rank: Optional[float] = None    # [0,1]; None until ranked
    universe_size: int = 0
    features: Dict[str, float] = field(default_factory=dict)
    abstain: bool = False
    reason: str = ""


# --------------------------------------------------------------------------
# Feature engineering -- strictly backward-looking
# --------------------------------------------------------------------------

def _safe(x: float, default: float = 0.0) -> float:
    return float(x) if np.isfinite(x) else default


def build_features(closes: np.ndarray, volumes: Optional[np.ndarray] = None,
                   highs: Optional[np.ndarray] = None,
                   lows: Optional[np.ndarray] = None) -> Dict[str, float]:
    """Features from bars up to and including the decision bar.

    `closes[-1]` is the last observed close. Nothing here reads beyond it.
    """
    c = np.asarray(closes, dtype=float)
    n = c.size
    if n < 60:
        return {}
    r = np.diff(c) / c[:-1]

    def mom(k: int) -> float:
        return _safe(c[-1] / c[-1 - k] - 1.0) if n > k else 0.0

    def vol(k: int) -> float:
        return _safe(r[-k:].std() * math.sqrt(TRADING_DAYS)) if r.size >= k else 0.0

    f: Dict[str, float] = {
        "mom_5": mom(5), "mom_21": mom(21), "mom_63": mom(63),
        "mom_126": mom(126) if n > 126 else 0.0,
        # 12-1 momentum: the standard construction, skipping the most recent
        # month to avoid the well-documented short-term reversal effect.
        "mom_12_1": _safe(c[-22] / c[-min(n - 1, 252)] - 1.0) if n > 253 else 0.0,
        "vol_21": vol(21), "vol_63": vol(63),
        "vol_ratio": _safe(vol(21) / vol(63)) if vol(63) > 1e-9 else 1.0,
        "skew_63": _safe(float(((r[-63:] - r[-63:].mean()) ** 3).mean() /
                               (r[-63:].std() ** 3 + 1e-12))) if r.size >= 63 else 0.0,
        "kurt_63": _safe(float(((r[-63:] - r[-63:].mean()) ** 4).mean() /
                               (r[-63:].std() ** 4 + 1e-12))) if r.size >= 63 else 3.0,
    }

    ma20 = c[-20:].mean()
    ma50 = c[-50:].mean() if n >= 50 else ma20
    ma200 = c[-200:].mean() if n >= 200 else ma50
    f["px_over_ma20"] = _safe(c[-1] / ma20 - 1.0)
    f["px_over_ma50"] = _safe(c[-1] / ma50 - 1.0)
    f["px_over_ma200"] = _safe(c[-1] / ma200 - 1.0)
    f["ma20_over_ma50"] = _safe(ma20 / ma50 - 1.0)

    peak = float(np.maximum.accumulate(c)[-1])
    f["drawdown"] = _safe(c[-1] / peak - 1.0)

    # Persistence of sign: how one-directional recent moves have been.
    win = r[-21:] if r.size >= 21 else r
    f["updays_21"] = _safe(float((win > 0).mean()))
    f["autocorr_1"] = _safe(float(np.corrcoef(r[-63:-1], r[-62:])[0, 1])) if r.size >= 64 else 0.0

    if volumes is not None and len(volumes) == n:
        v = np.asarray(volumes, dtype=float)
        v20, v63 = v[-20:].mean(), v[-63:].mean() if n >= 63 else v[-20:].mean()
        f["vol_surge"] = _safe(v20 / v63 - 1.0) if v63 > 0 else 0.0

    if highs is not None and lows is not None and len(highs) == n:
        h, l = np.asarray(highs, float), np.asarray(lows, float)
        tr = np.maximum(h[1:] - l[1:], np.abs(h[1:] - c[:-1]))
        tr = np.maximum(tr, np.abs(l[1:] - c[:-1]))
        f["atr_pct"] = _safe(tr[-14:].mean() / c[-1]) if tr.size >= 14 else 0.0

    return f


# --------------------------------------------------------------------------
# Regime
# --------------------------------------------------------------------------

def classify_regime(closes: np.ndarray, lookback: int = 252) -> RegimeState:
    c = np.asarray(closes, dtype=float)
    r = np.diff(c) / c[:-1]
    v21 = float(r[-21:].std() * math.sqrt(TRADING_DAYS)) if r.size >= 21 else 0.0

    hist = r[-lookback:] if r.size >= lookback else r
    rolling = np.array([hist[i - 21:i].std() for i in range(21, hist.size)]) \
        if hist.size > 21 else np.array([r.std() if r.size else 0.0])
    pct = float((rolling < (v21 / math.sqrt(TRADING_DAYS))).mean()) if rolling.size else 0.5

    # Trend strength: normalised slope of a line fit to log price. Bounded so
    # it is comparable across assets of very different volatility.
    k = min(63, c.size)
    y = np.log(c[-k:])
    x = np.arange(k, dtype=float)
    slope = float(np.polyfit(x, y, 1)[0]) if k > 2 else 0.0
    strength = float(np.clip(slope / (v21 / math.sqrt(TRADING_DAYS) + 1e-9) / 3.0, -1, 1))

    peak = float(np.maximum.accumulate(c)[-1])
    dd = float(c[-1] / peak - 1.0)

    volatile = pct > 0.7
    trending = abs(strength) > 0.3
    label = (("volatile_" if volatile else "calm_") +
             ("trending" if trending else "choppy"))
    return RegimeState(label=label, realised_vol_annual=v21,
                       trend_strength=strength, vol_percentile=pct,
                       drawdown_from_peak=dd)


# --------------------------------------------------------------------------
# Distribution
# --------------------------------------------------------------------------

def estimate_distribution(closes: np.ndarray, horizon_days: int,
                          features: Optional[Dict[str, float]] = None
                          ) -> ReturnDistribution:
    """Expected return and its uncertainty over `horizon_days`.

    The central estimate is deliberately conservative. Having measured that
    directional forecasts from this data carry no positive information, the
    mean is shrunk hard toward zero: sigma is estimated from data (volatility
    is forecastable), mu is not asserted beyond a small momentum tilt.

    That asymmetry is the point. Pretending to know mu is what produced a
    negative information coefficient; estimating sigma honestly is what makes
    the output useful anyway, because sizing keys on mu/sigma.
    """
    c = np.asarray(closes, dtype=float)
    r = np.diff(c) / c[:-1]
    if r.size < 30:
        return ReturnDistribution(mu=0.0, sigma=0.02, horizon_days=horizon_days)

    daily_sigma = float(r[-63:].std()) if r.size >= 63 else float(r.std())
    sigma = daily_sigma * math.sqrt(horizon_days)

    f = features if features is not None else build_features(c)
    tilt = 0.15 * f.get("mom_12_1", 0.0) + 0.05 * f.get("px_over_ma200", 0.0)
    # Cap the tilt at a quarter of a standard deviation. Any larger and the
    # mean would dominate a quantity we have shown we cannot forecast.
    mu = float(np.clip(tilt, -0.25 * sigma, 0.25 * sigma))

    z = {"p05": -1.645, "p25": -0.674, "p50": 0.0, "p75": 0.674, "p95": 1.645}
    return ReturnDistribution(
        mu=mu, sigma=sigma, horizon_days=horizon_days,
        quantiles={k: float(mu + zz * sigma) for k, zz in z.items()})


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

class Calibrator:
    """Maps raw confidence to an empirically observed hit rate.

    Reliability-diagram binning: raw scores are bucketed, and each bucket
    reports the fraction of its historical calls that proved correct. A raw
    0.9 that was right 55% of the time is reported as 0.55, which is what any
    downstream sizing rule needs in order not to over-bet.

    Deliberately fitted on outcomes only. Nothing here inspects the bar being
    predicted.
    """

    def __init__(self, n_bins: int = 10) -> None:
        self.n_bins = n_bins
        self.edges = np.linspace(0.0, 1.0, n_bins + 1)
        self.hit_rate = np.full(n_bins, 0.5)
        self.counts = np.zeros(n_bins, dtype=int)
        self.fitted = False

    def fit(self, raw: Sequence[float], correct: Sequence[bool]) -> "Calibrator":
        raw = np.asarray(raw, dtype=float)
        ok = np.asarray(correct, dtype=bool)
        for b in range(self.n_bins):
            m = (raw >= self.edges[b]) & (raw < self.edges[b + 1] + (1e-9 if b == self.n_bins - 1 else 0))
            self.counts[b] = int(m.sum())
            if self.counts[b] >= 20:
                self.hit_rate[b] = float(ok[m].mean())
            # Bins with too little evidence keep the 0.5 prior rather than
            # inheriting a number from three observations.
        self.fitted = True
        return self

    def transform(self, raw: float) -> float:
        b = int(np.clip(np.digitize(raw, self.edges) - 1, 0, self.n_bins - 1))
        return float(self.hit_rate[b])

    def expected_calibration_error(self, raw: Sequence[float],
                                   correct: Sequence[bool]) -> float:
        raw = np.asarray(raw, float)
        ok = np.asarray(correct, bool)
        n = raw.size
        if n == 0:
            return 0.0
        ece = 0.0
        for b in range(self.n_bins):
            m = (raw >= self.edges[b]) & (raw < self.edges[b + 1] + (1e-9 if b == self.n_bins - 1 else 0))
            if m.sum() == 0:
                continue
            ece += (m.sum() / n) * abs(ok[m].mean() - raw[m].mean())
        return float(ece)


# --------------------------------------------------------------------------
# The Analyst
# --------------------------------------------------------------------------

class AnalystV2:
    def __init__(self, calibrator: Optional[Calibrator] = None,
                 abstain_below: float = 0.10) -> None:
        self.calibrator = calibrator or Calibrator()
        # Below this |mu/sigma| the view is not distinguishable from noise and
        # is reported as an abstention rather than a weak opinion. Abstaining
        # is a first-class output, not a failure.
        self.abstain_below = abstain_below

    def view(self, ticker: str, closes: np.ndarray, as_of: str,
             horizon_days: int = 5, volumes=None, highs=None, lows=None) -> AnalystView:
        f = build_features(closes, volumes, highs, lows)
        regime = classify_regime(closes)
        dist = estimate_distribution(closes, horizon_days, f)

        ir = abs(dist.information_ratio)
        raw_conf = float(np.clip(0.5 + ir, 0.0, 1.0))
        conf = self.calibrator.transform(raw_conf) if self.calibrator.fitted else raw_conf

        abstain = ir < self.abstain_below
        return AnalystView(
            ticker=ticker, as_of=as_of, distribution=dist, regime=regime,
            confidence=conf, raw_confidence=raw_conf, features=f,
            abstain=abstain,
            reason=("information ratio below abstention threshold"
                    if abstain else ""))

    # ---- cross-sectional ------------------------------------------------

    @staticmethod
    def rank_universe(views: List[AnalystView]) -> List[AnalystView]:
        """Assign each view its percentile rank within the day's universe.

        This is the output the per-ticker pipeline structurally cannot
        produce, and the reason the redesign needs a universe-level call.
        Ranking is done on the information ratio rather than on mu, so a
        confident small expected move outranks an uncertain large one.
        """
        if not views:
            return views
        scores = np.array([v.distribution.information_ratio for v in views])
        order = scores.argsort().argsort().astype(float)
        pct = order / max(1, len(views) - 1)
        for v, p in zip(views, pct):
            v.cross_sectional_rank = float(p)
            v.universe_size = len(views)
        return views
