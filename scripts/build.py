"""Build the live site: data/*.csv -> _site/ (HTML, CSS, JS, observatory.json, CSV downloads).

Uses only the Python standard library so CI needs no installs.
    python scripts/build.py
"""
import csv, json, math, shutil, statistics as st
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA, SITE, OUT = ROOT / "data", ROOT / "site", ROOT / "_site"


def rows(name):
    with open(DATA / name, newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    if v in ("", None): return None
    if v in ("True", "False"): return v == "True"
    try:
        x = float(v)
    except ValueError:
        return v
    if math.isinf(x): return "inf"
    return x


def typed(rs):
    return [{k: num(v) if k not in ("ticker", "group", "model", "month", "peak_date", "company",
                                     "exchange", "gics_sector") else v for k, v in r.items()} for r in rs]


stocks = rows("stocks.csv")
order = [s["ticker"] for s in stocks]
carhart = typed(rows("carhart_stock_year.csv"))
vol = typed(rows("volatility_models.csv"))
annual = typed(rows("annual_volatility.csv"))
per = typed(rows("per_stock_summary.csv"))
groups = typed(rows("group_summary.csv"))

monthly = defaultdict(lambda: {"m": [], "g": [], "e": []})
for r in rows("monthly_conditional_vol.csv"):
    d = monthly[r["ticker"]]
    d["m"].append(r["month"]); d["g"].append(float(r["GARCH"])); d["e"].append(float(r["EGARCH"]))

# ---- headline statistics, computed from the published CSVs
ga = {r["ticker"]: r for r in vol if r["model"] == "GARCH"}
eg = {r["ticker"]: r for r in vol if r["model"] == "EGARCH"}
gaps_g = [abs(r["GARCH_gap_pct"]) for r in annual]
gaps_e = [abs(r["EGARCH_gap_pct"]) for r in annual]


def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num_ = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return num_ / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


by_year = defaultdict(lambda: {"g": [], "e": []})
for r in annual:
    by_year[int(r["year"])]["g"].append(r["GARCH_gap_pct"]); by_year[int(r["year"])]["e"].append(r["EGARCH_gap_pct"])

head = {
    "stock_years": len(carhart),
    "alpha_sig_p05": sum(r["alpha_p"] < .05 for r in carhart),
    "alpha_sig_bh": sum(r["alpha_p_bh"] < .05 for r in carhart),
    "median_r2": st.median(r["R2"] for r in carhart),
    "median_mkt": st.median(r["MKT"] for r in carhart),
    "mkt_sig_share": sum(r["MKT_p"] < .05 for r in carhart) / len(carhart),
    "egarch_better_aic": sum(eg[t]["AIC"] < ga[t]["AIC"] for t in order),
    "egarch_better_bic": sum(eg[t]["BIC"] < ga[t]["BIC"] for t in order),
    "gamma_neg_sig": sum(eg[t]["gamma"] < 0 and eg[t]["gamma_p"] < .05 for t in order),
    "median_persistence": st.median(ga[t]["persistence"] for t in order),
    "median_nu": st.median(r["nu"] for r in vol),
    "peak_mar2020": sum(r["peak_date"].startswith("2020-03") for r in vol),
    "models": len(vol),
    "gap_median_abs": {"GARCH": st.median(gaps_g), "EGARCH": st.median(gaps_e)},
    "gap_within10": {"GARCH": sum(g <= 10 for g in gaps_g) / len(gaps_g),
                     "EGARCH": sum(g <= 10 for g in gaps_e) / len(gaps_e)},
    "corr": {m: corr([r["Unconditional"] for r in annual], [r[m] for r in annual]) for m in ("GARCH", "EGARCH")},
    "median_gap_by_year": {y: {"GARCH": st.median(v["g"]), "EGARCH": st.median(v["e"])} for y, v in sorted(by_year.items())},
}

# Values printed by the executed coursework notebook; the build fails if the published data drift.
EXPECT = {"stock_years": 240, "alpha_sig_p05": 12, "alpha_sig_bh": 0, "egarch_better_aic": 24,
          "egarch_better_bic": 23, "gamma_neg_sig": 19, "peak_mar2020": 41, "models": 48}
for k, v in EXPECT.items():
    assert head[k] == v, f"{k}: {head[k]} != {v}"
assert round(head["median_r2"], 2) == 0.40 and round(head["median_mkt"], 2) == 1.07
assert round(head["gap_median_abs"]["GARCH"], 2) == 5.70 and round(head["gap_median_abs"]["EGARCH"], 2) == 6.46
assert round(head["gap_within10"]["GARCH"] * 100, 1) == 70.8 and round(head["corr"]["GARCH"], 3) == 0.985
assert len(monthly) == 24 and all(len(v["m"]) == 120 for v in monthly.values())

HYP = {  # pre-registered group hypotheses and the notebook's verdicts (16/20 supported)
    "Semiconductors": [["β > 1", True], ["HML < 0", True], ["Volatility rank 1–2", True], ["Asymmetry in > half", False]],
    "Tech platforms & services": [["β ≈ 1 (0.9–1.2)", True], ["HML < 0", True], ["Volatility rank 3–4", True], ["Asymmetry in ≥ half", True]],
    "Consumer discretionary": [["β > 1.05", False], ["HML < 0", True], ["Volatility rank 1–2", True], ["Asymmetry in ≥ half", True]],
    "Defensive": [["β < 1", True], ["HML > 0.05", False], ["Lowest volatility", True], ["Weak asymmetry (≤ half)", False]],
    "Cyclical & financials": [["β ≥ 1", True], ["HML > 0.3", True], ["Volatility rank 1–4", True], ["Asymmetry in ≥ half", True]],
}

payload = {"stocks": stocks, "carhart": carhart, "vol": vol, "annual": annual, "per": per,
           "groups": groups, "monthly": monthly, "head": head, "hypotheses": HYP,
           "verification": json.loads((DATA / "verification.json").read_text())}

if OUT.exists(): shutil.rmtree(OUT)
shutil.copytree(SITE, OUT)
(OUT / "data").mkdir(exist_ok=True)
(OUT / "data" / "observatory.json").write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
for p in DATA.glob("*.csv"):
    shutil.copy(p, OUT / "data" / p.name)
(OUT / ".nojekyll").write_text("")
print(f"built {OUT} · {(OUT / 'data' / 'observatory.json').stat().st_size / 1024:.0f} KB json · checks passed")
