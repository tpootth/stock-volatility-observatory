"""Curate publishable aggregate outputs from the original coursework folder.

Run locally, once, against the coursework tree (it is NOT run in CI):

    python scripts/curate.py /path/to/hw_nasdaq

Reads only saved model outputs from `our_analysis/out/` plus the stock list, and writes
aggregate CSVs to `data/`. Daily prices / returns, the Datastream workbook, reports and
anything with student details are deliberately not copied. Daily conditional sigma is
reduced to monthly means of annualised sigma.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SRC = Path(sys.argv[1])
OUT = SRC / "our_analysis" / "out"
DST = Path(__file__).resolve().parents[1] / "data"
DST.mkdir(exist_ok=True)

GROUPS = {
    "Semiconductors": ["NVDA", "AMD", "TSM", "KLAC", "INTC", "TXN"],
    "Tech platforms & services": ["AAPL", "IBM", "PYPL", "PAYX", "BKNG"],
    "Consumer discretionary": ["TSLA", "NKE", "LULU", "SBUX"],
    "Defensive": ["PG", "PM", "TGT", "PFE", "LLY"],
    "Cyclical & financials": ["BAC", "KKR", "SLB", "PCAR"],
}
ORDER = [t for ts in GROUPS.values() for t in ts]
GROUP_OF = {t: g for g, ts in GROUPS.items() for t in ts}
strip = lambda s: s.str.replace(r"^\d+\s+", "", regex=True)

NAMES = {"NVDA": "NVIDIA", "AMD": "Advanced Micro Devices", "TSM": "Taiwan Semiconductor (ADR)", "KLAC": "KLA",
         "INTC": "Intel", "TXN": "Texas Instruments", "AAPL": "Apple", "IBM": "IBM", "PYPL": "PayPal",
         "PAYX": "Paychex", "BKNG": "Booking Holdings", "TSLA": "Tesla", "NKE": "Nike", "LULU": "Lululemon",
         "SBUX": "Starbucks", "PG": "Procter & Gamble", "PM": "Philip Morris Intl.", "TGT": "Target",
         "PFE": "Pfizer", "LLY": "Eli Lilly", "BAC": "Bank of America", "KKR": "KKR", "SLB": "SLB",
         "PCAR": "PACCAR"}

stocks = pd.read_csv(SRC / "our_analysis/data/stock_list.csv").set_index("ticker").loc[ORDER]
stocks = pd.DataFrame({"ticker": ORDER, "company": [NAMES[t] for t in ORDER],
                       "exchange": stocks.exchange.values, "gics_sector": stocks.gics_sector.values,
                       "group": [GROUP_OF[t] for t in ORDER]})
stocks.to_csv(DST / "stocks.csv", index=False)

q1 = pd.read_csv(OUT / "q1_carhart_stock_year.csv")
q1["group"] = strip(q1.group)
q1.round(6).to_csv(DST / "carhart_stock_year.csv", index=False)

q2 = pd.read_csv(OUT / "q2_volatility_models.csv")
q2["group"] = strip(q2.group)
q2.round(6).to_csv(DST / "volatility_models.csv", index=False)

q3 = pd.read_csv(OUT / "q3_annual_volatility.csv")
q3["group"] = strip(q3.group)
q3.round(4).to_csv(DST / "annual_volatility.csv", index=False)

per = pd.read_csv(OUT / "per_stock_summary.csv", index_col=0)
per["group"] = strip(per.group)
per.index.name = "ticker"
per.round(6).to_csv(DST / "per_stock_summary.csv")

grp = pd.read_csv(OUT / "group_summary.csv")
grp["group"] = strip(grp.group)
grp.round(6).to_csv(DST / "group_summary.csv", index=False)

# Monthly mean of annualised conditional sigma (aggregate of daily model output)
frames = []
for model in ["GARCH", "EGARCH"]:
    s = pd.read_csv(OUT / f"q2_daily_sigma_{model.lower()}_pct.csv", parse_dates=[0], index_col=0)
    m = (s[ORDER] * np.sqrt(252)).resample("MS").mean()
    m = m.reset_index(names="month").melt(id_vars="month", var_name="ticker", value_name="sigma_ann_pct")
    m["model"] = model
    frames.append(m)
mon = pd.concat(frames)
mon["month"] = mon.month.dt.strftime("%Y-%m")
mon = mon.pivot_table(index=["ticker", "month"], columns="model", values="sigma_ann_pct").reset_index()
mon.columns.name = None
mon.round(3).to_csv(DST / "monthly_conditional_vol.csv", index=False)
print("wrote", sorted(p.name for p in DST.glob("*.csv")))
