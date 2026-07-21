"""
test_significance.py -- known-answer and calibration tests for significance.py.

A significance test that is itself wrong is worse than no test: it launders noise
into a p-value. These check the three procedures against cases where the correct
answer is known by construction.

    pytest eval/test_significance.py -v
"""

from __future__ import annotations

import numpy as np
import pytest

import significance as sig


# --- Stationary bootstrap mechanics -----------------------------------------

def test_bootstrap_indices_in_range_and_right_length():
    rng = np.random.default_rng(0)
    for n in (1, 5, 100, 999):
        idx = sig.stationary_bootstrap_indices(n, 10.0, rng)
        assert idx.size == n
        assert idx.min() >= 0 and idx.max() < n


def test_bootstrap_preserves_blocks():
    """With a long mean block, consecutive indices should mostly be consecutive."""
    rng = np.random.default_rng(1)
    idx = sig.stationary_bootstrap_indices(5000, 50.0, rng)
    consecutive = np.mean(np.diff(idx) == 1)
    assert consecutive > 0.9, f"only {consecutive:.2%} consecutive; blocks are not being preserved"


def test_bootstrap_block_len_one_is_iid():
    """block_mean=1 degenerates to an i.i.d. bootstrap."""
    rng = np.random.default_rng(2)
    idx = sig.stationary_bootstrap_indices(5000, 1.0, rng)
    assert np.mean(np.diff(idx) == 1) < 0.05


# --- Bootstrap CI correctness ------------------------------------------------

def test_identical_series_have_zero_difference_and_ci_containing_zero():
    rng = np.random.default_rng(3)
    x = rng.normal(0.0004, 0.01, 800)
    res = sig.bootstrap_metric_diff(x, x.copy(), "sharpe", n_boot=500)
    assert abs(res.difference) < 1e-12
    assert res.ci_low <= 0.0 <= res.ci_high
    assert not res.significant
    assert res.p_value > 0.5


def test_large_real_difference_is_detected():
    """A strategy with a genuinely much higher Sharpe must come out significant."""
    rng = np.random.default_rng(4)
    n = 2000
    good = rng.normal(0.0012, 0.008, n)   # Sharpe ~ 2.4 annualized
    bad = rng.normal(0.0000, 0.008, n)    # Sharpe ~ 0
    res = sig.bootstrap_metric_diff(good, bad, "sharpe", n_boot=1000)
    assert res.difference > 1.0
    assert res.significant
    assert res.p_value < 0.05


def test_bootstrap_is_deterministic_under_seed():
    rng = np.random.default_rng(5)
    a, b = rng.normal(0, 0.01, 400), rng.normal(0, 0.01, 400)
    r1 = sig.bootstrap_metric_diff(a, b, n_boot=200, seed=7)
    r2 = sig.bootstrap_metric_diff(a, b, n_boot=200, seed=7)
    assert r1.ci_low == r2.ci_low and r1.p_value == r2.p_value


def test_misaligned_series_rejected():
    with pytest.raises(ValueError):
        sig.bootstrap_metric_diff(np.zeros(10), np.zeros(11))


def test_bootstrap_ci_is_wider_with_dependence():
    """Serially-dependent data must yield WIDER intervals than i.i.d. data.
    This is the entire reason for using a block bootstrap; if it fails, the
    intervals are too narrow and every 'significant' result is suspect."""
    rng = np.random.default_rng(6)
    n = 3000
    # AR(1) with strong persistence in the level of returns
    e = rng.normal(0, 0.01, n)
    ar = np.zeros(n)
    for t in range(1, n):
        ar[t] = 0.8 * ar[t - 1] + e[t]
    flat = rng.normal(0, 0.01, n)
    wide = sig.bootstrap_metric_diff(ar, flat, n_boot=600, block_mean=40.0)
    narrow = sig.bootstrap_metric_diff(ar, flat, n_boot=600, block_mean=1.0)
    assert (wide.ci_high - wide.ci_low) > (narrow.ci_high - narrow.ci_low)


# --- Diebold-Mariano ---------------------------------------------------------

def test_dm_identical_losses_not_significant():
    rng = np.random.default_rng(7)
    loss = rng.random(500)
    res = sig.diebold_mariano(loss, loss.copy())
    assert res.p_value > 0.99
    assert abs(res.dm_stat) < 1e-9


def test_dm_detects_clearly_better_model():
    rng = np.random.default_rng(8)
    n = 1000
    loss_good = rng.random(n) * 0.5        # mean 0.25
    loss_bad = rng.random(n) * 0.5 + 0.3   # mean 0.55
    res = sig.diebold_mariano(loss_good, loss_bad)
    assert res.dm_stat < 0, "negative DM should mean model A is better"
    assert res.p_value < 0.01


def test_dm_coin_flip_forecaster_is_never_significantly_better():
    """A 50/50 forecaster on an upward-drifting series must never be flagged as
    significantly BETTER than always-predicting-up.

    Note the asymmetry being tested. On a series where 53% of days are up, a
    coin flip is genuinely *worse* than the always-up benchmark, and DM should
    (and does) detect that with a positive statistic. The false positive we must
    rule out is the opposite sign: skill where there is none.

    This is exactly why the benchmark matters. A forecaster reporting "56%
    directional accuracy" in a window that is 55% up days has demonstrated
    essentially nothing, and only a paired test against always-up reveals it --
    see docs/RESEARCH_PLAN.md D6.
    """
    rng = np.random.default_rng(9)
    n = 1500
    actual = np.where(rng.random(n) < 0.53, 1.0, -1.0)   # upward drift
    pred = np.where(rng.random(n) < 0.5, 1.0, -1.0)      # no skill
    res = sig.directional_accuracy_dm(pred, actual)
    assert not (res.dm_stat < 0 and res.p_value < 0.01), (
        f"skill-less forecaster flagged as significantly better "
        f"(DM={res.dm_stat:+.2f}, p={res.p_value:.4f})")


def test_dm_genuinely_skilful_forecaster_beats_always_up():
    """Positive control: a forecaster with real directional edge must be flagged
    as significantly better than always-up (negative DM, small p)."""
    rng = np.random.default_rng(14)
    n = 2000
    actual = np.where(rng.random(n) < 0.52, 1.0, -1.0)
    # 65% agreement with the truth -- real, substantial skill
    correct = rng.random(n) < 0.65
    pred = np.where(correct, actual, -actual)
    res = sig.directional_accuracy_dm(pred, actual)
    assert res.dm_stat < 0 and res.p_value < 0.01, (
        f"real skill not detected (DM={res.dm_stat:+.2f}, p={res.p_value:.4f})")


def test_dm_horizon_correction_widens_pvalue():
    """Longer horizons imply more overlap, hence a less significant result."""
    rng = np.random.default_rng(10)
    n = 800
    a = rng.random(n) * 0.5
    b = rng.random(n) * 0.5 + 0.05
    p1 = sig.diebold_mariano(a, b, horizon=1).p_value
    p10 = sig.diebold_mariano(a, b, horizon=10).p_value
    assert p10 > p1


# --- Hansen SPA --------------------------------------------------------------

def test_spa_worthless_grid_is_not_significant():
    """THE key calibration test. 30 worthless configurations searched against a
    benchmark: the best will look good by chance, the naive p-value will be
    small, and SPA must NOT be fooled."""
    rng = np.random.default_rng(11)
    n, m = 1200, 30
    d = rng.normal(0.0, 0.01, (n, m))     # zero true edge everywhere
    res = sig.hansen_spa(d, n_boot=1000)
    assert res.spa_p_value > 0.10, (
        f"SPA p={res.spa_p_value:.3f} on a grid with zero true edge -- "
        f"the data-snooping correction is not working.")


def test_spa_penalises_search_more_than_naive():
    """The naive p-value ignores the search and must be more optimistic."""
    rng = np.random.default_rng(12)
    d = rng.normal(0.0, 0.01, (1000, 25))
    res = sig.hansen_spa(d, n_boot=800)
    assert res.naive_p_value <= res.spa_p_value + 1e-9, (
        "naive p should be smaller (more optimistic) than SPA p")


def test_spa_detects_one_genuinely_good_model():
    rng = np.random.default_rng(13)
    n, m = 1500, 20
    d = rng.normal(0.0, 0.01, (n, m))
    d[:, 7] += 0.0025                      # one model with a large real edge
    res = sig.hansen_spa(d, n_boot=1000)
    assert res.best_model == 7
    assert res.spa_p_value < 0.05


def test_spa_rejects_bad_shape():
    with pytest.raises(ValueError):
        sig.hansen_spa(np.zeros(100))


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
