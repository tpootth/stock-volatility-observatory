# Stock Volatility Observatory

Live site for a coursework replication: Carhart four-factor exposures, GARCH(1,1) and
EGARCH(1,1) volatility models, and annual conditional vs unconditional volatility for 24 US-listed
stocks, 2016–2025.

**Live site:** https://tpootth.github.io/stock-volatility-observatory/

## What's inside

| Section | Content |
|---|---|
| Scorecards | Ten-year averages per stock: market β, HML, α, volatility, GARCH persistence, EGARCH γ, ΔAIC |
| Factor exposures | Stock × year heatmap of α, MKT, SMB, HML, UMD or R², with p < 0.05 and BH-FDR markers |
| Volatility | Monthly conditional σ (GARCH vs EGARCH), annual unconditional vs conditional, all-stock scatter, median gap by year |
| Model table | Sortable GARCH/EGARCH parameters, ΔAIC/ΔBIC, peak dates |
| Groups | Five industry groups, group medians, and 16/20 pre-registered hypotheses supported |
| Methods | Specification, verification and limitations |

Filters (group, GICS sector, exchange, ticker search) apply across sections. `?focus=TICKER` deep-links a stock.

## Headline results (verified)

- Carhart α significant at 5% in **12 / 240** stock-years, **0** after Benjamini–Hochberg; median R² 0.40, median β 1.07.
- EGARCH beats GARCH on AIC for **24 / 24** stocks (23 / 24 on BIC); significant negative asymmetry for **19 / 24**.
- Median GARCH persistence 0.976; peak σ falls in March 2020 for **41 / 48** models.
- Annual conditional vs unconditional: median |gap| **5.7 %** (GARCH) / **6.5 %** (EGARCH), correlation 0.985.

`scripts/verify_against_coursework.py` re-fits all 240 regressions and 48 volatility models from the
cleaned daily series (arch 9.0, statsmodels 0.15) and recomputes the annual figures from saved σₜ.
The results match the saved coursework outputs exactly (`data/verification.json`).

## Repository layout

```
data/        aggregate CSVs published with the live site (model estimates, annual and monthly figures)
scripts/
  curate.py                    coursework out/ -> data/ (run locally; documents provenance)
  verify_against_coursework.py independent re-estimation check (run locally; needs daily data)
  build.py                     data/ -> _site/ ; asserts headline figures (stdlib only)
site/        index.html, styles.css, app.js (vanilla JS, hand-built SVG charts)
.github/workflows/pages.yml    build + deploy to GitHub Pages on push to main
```

Local preview:

```bash
python scripts/build.py && python -m http.server -d _site 8000
```

## Data policy

Published: model estimates, annual volatility figures and monthly means of annualised conditional σ.
Not published: daily prices or returns, the Datastream workbook, the coursework report and any
student details. Factor data are from the [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html).

## Limitations

Single-year regressions give noisy α; volatility models are fit in-sample on the full period (not a
forecast test); the 2016 conditional values partly reflect the backcast start; the five groups are
small and hand-built. Educational work, not investment advice.

Code: MIT licence. Aggregate data: provided for educational use.
