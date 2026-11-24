"""Independent verification of the saved coursework outputs (our_analysis/out).

Re-estimates Q1 (Carhart, HAC-5), Q2 (GARCH/EGARCH Student-t, grid multi-start) and Q3
from the cleaned daily series in nasdaq_homework/results, then compares to the saved CSVs.
"""
import sys, json
from pathlib import Path
import numpy as np, pandas as pd
import statsmodels.api as sm
from arch import arch_model
import warnings; warnings.filterwarnings("ignore")

ROOT = Path(sys.argv[1])
OUT = ROOT / "our_analysis/out"
RES = ROOT / "nasdaq_homework/results"
rep = {}

ret = pd.read_csv(RES / "daily_total_returns_pct.csv", parse_dates=["date"], index_col="date").loc["2016":"2025"]
fac = pd.read_csv(RES / "daily_factors_pct.csv", parse_dates=["date"], index_col="date").loc["2016":"2025"]
assert ret.index.equals(fac.index)
logret = 100 * np.log1p(ret / 100)

q1 = pd.read_csv(OUT / "q1_carhart_stock_year.csv")
q2 = pd.read_csv(OUT / "q2_volatility_models.csv")
q3 = pd.read_csv(OUT / "q3_annual_volatility.csv")
sg = pd.read_csv(OUT / "q2_daily_sigma_garch_pct.csv", parse_dates=[0], index_col=0)
se = pd.read_csv(OUT / "q2_daily_sigma_egarch_pct.csv", parse_dates=[0], index_col=0)

# ---------- headline stats recomputed from saved CSVs
eg = q2[q2.model == "EGARCH"].set_index("ticker"); ga = q2[q2.model == "GARCH"].set_index("ticker")
rep["saved_headlines"] = {
    "q1_rows": len(q1), "alpha_sig_p05": int((q1.alpha_p < .05).sum()), "alpha_sig_bh": int((q1.alpha_p_bh < .05).sum()),
    "median_R2": round(q1.R2.median(), 3), "median_MKT": round(q1.MKT.median(), 3),
    "egarch_better_aic": int((eg.AIC < ga.loc[eg.index].AIC).sum()),
    "egarch_better_bic": int((eg.BIC < ga.loc[eg.index].BIC).sum()),
    "gamma_neg_sig": int(((eg.gamma < 0) & (eg.gamma_p < .05)).sum()),
    "median_garch_persistence": round(ga.persistence.median(), 4),
    "peak_mar2020": int(pd.to_datetime(q2.peak_date).dt.strftime("%Y-%m").eq("2020-03").sum()),
    "q3_median_abs_gap_garch": round(q3.GARCH_gap_pct.abs().median(), 2),
    "q3_median_abs_gap_egarch": round(q3.EGARCH_gap_pct.abs().median(), 2),
    "q3_within10_garch": round((q3.GARCH_gap_pct.abs() <= 10).mean() * 100, 2),
    "q3_within10_egarch": round((q3.EGARCH_gap_pct.abs() <= 10).mean() * 100, 2),
    "q3_corr_garch": round(q3.Unconditional.corr(q3.GARCH), 4),
}

# ---------- Q3 recomputed from saved sigma + returns
r = []
for _, row in q3.iterrows():
    m = logret.index.year == row.year
    u = logret.loc[m, row.ticker].std() * np.sqrt(252)
    g = np.sqrt((sg.loc[sg.index.year == row.year, row.ticker] ** 2).mean() * 252)
    e = np.sqrt((se.loc[se.index.year == row.year, row.ticker] ** 2).mean() * 252)
    r.append((abs(u - row.Unconditional), abs(g - row.GARCH), abs(e - row.EGARCH)))
r = np.array(r)
rep["q3_recompute_max_abs_diff_pp"] = dict(zip(["uncond", "garch", "egarch"], r.max(0).round(6).tolist()))

# ---------- Q1 independent re-fit
X = sm.add_constant(fac[["MKT", "SMB", "HML", "UMD"]])
d = []
for _, row in q1.iterrows():
    m = ret.index.year == row.year
    f = sm.OLS(ret.loc[m, row.ticker] - fac.RF[m], X[m]).fit(cov_type="HAC", cov_kwds={"maxlags": 5})
    d.append([abs(f.params.const * 252 - row.alpha_pct_yr), abs(f.params.MKT - row.MKT),
              abs(f.params.HML - row.HML), abs(f.pvalues.const - row.alpha_p)])
d = np.array(d)
rep["q1_refit_max_abs_diff"] = dict(zip(["alpha_pct_yr", "MKT", "HML", "alpha_p"], d.max(0).round(6).tolist()))

# ---------- Q2 independent re-fit (same grid multi-start idea)
def fit_best(y, vol):
    o = 1 if vol == "EGARCH" else 0
    mdl = arch_model(y, mean="Constant", vol=vol, p=1, o=o, q=1, dist="t")
    fits = [mdl.fit(disp="off", options={"maxiter": 5000})]
    v = y.var()
    grid = ([(a, b) for a in (.03, .08, .15) for b in (.80, .90, .95) if a + b < .995] if vol == "GARCH"
            else [(a, b) for a in (.05, .15, .25) for b in (.90, .96, .99)])
    for a, b in grid:
        sv = fits[0].params.copy(); sv["alpha[1]"], sv["beta[1]"] = a, b
        sv["omega"] = v * (1 - a - b) if vol == "GARCH" else np.log(v) * (1 - b)
        if vol == "EGARCH": sv["gamma[1]"] = -.05
        sv["nu"] = 5
        try:
            f = mdl.fit(starting_values=sv.values, disp="off", options={"maxiter": 5000})
            if f.convergence_flag == 0 and np.isfinite(f.loglikelihood): fits.append(f)
        except Exception: pass
    return max(fits, key=lambda f: f.loglikelihood)

q2rows = []
for _, row in q2.iterrows():
    f = fit_best(logret[row.ticker], row.model)
    q2rows.append({"ticker": row.ticker, "model": row.model, "saved_LL": row.loglik, "refit_LL": f.loglikelihood,
                   "dLL": f.loglikelihood - row.loglik,
                   "saved_gamma": row.gamma, "refit_gamma": f.params.get("gamma[1]", np.nan)})
q2v = pd.DataFrame(q2rows)
q2v.to_csv(Path(__file__).with_name("q2_refit_compare.csv"), index=False)
rep["q2_refit"] = {"max_abs_dLL": round(q2v.dLL.abs().max(), 4), "median_abs_dLL": round(q2v.dLL.abs().median(), 5),
                   "max_abs_dgamma": round((q2v.saved_gamma - q2v.refit_gamma).abs().max(), 5)}
print(json.dumps(rep, indent=2))
json.dump(rep, open(Path(__file__).with_name("verification.json"), "w"), indent=2)
