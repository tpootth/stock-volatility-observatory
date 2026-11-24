/* Stock Volatility Observatory — vanilla JS, hand-built SVG charts. */
(() => {
  "use strict";
  const GCOL = {
    "Semiconductors": "#3987e5", "Tech platforms & services": "#d95926", "Consumer discretionary": "#199e70",
    "Defensive": "#c98500", "Cyclical & financials": "#d55181",
  };
  const C = { garch: "#14a974", egarch: "#ea3943", unc: "#c9d1db", panel: "#161a20", muted: "#3a424e", up: "#16c784", down: "#ea3943", dim: "#5d6672" };
  const dir = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const arrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "■");
  const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const $ = (s) => document.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const fmt = (v, d = 2) => { if (v == null || Number.isNaN(v)) return "–"; if (v === "inf" || v === Infinity) return "∞"; let s = Number(v).toFixed(d); if (/^-0(\.0+)?$/.test(s)) s = s.slice(1); return s.replace("-", "−"); };
  const fp = (p) => (p < 0.001 ? "<0.001" : fmt(p, 3));
  const sgn = (v, d = 1) => (v > 0 ? "+" : "") + fmt(v, d);
  const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let D, byT = {}, state;
  const params = new URLSearchParams(location.search);

  /* ---------------- tooltip ---------------- */
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const row = (k, v, col) => `<div class="r"><span>${col ? `<i style="background:${col}"></i>` : ""}${k}</span><span>${v}</span></div>`;

  /* ---------------- svg helpers ---------------- */
  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function frame(container, m = { t: 10, r: 14, b: 26, l: 40 }) {
    container.innerHTML = "";
    const w = container.clientWidth || 600, h = container.clientHeight || 260;
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" }, container);
    return { svg, w, h, m, iw: w - m.l - m.r, ih: h - m.t - m.b };
  }
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  function niceMax(v) { if (!(v > 0) || !Number.isFinite(v)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / (p / 2)) * (p / 2); }
  function ticks(lo, hi, n = 5) {
    if (!(hi > lo) || !Number.isFinite(hi - lo)) return [lo];
    const step0 = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= step0);
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function yAxis(f, y, tv, suffix = "") {
    const g = el("g", { class: "grid" }, f.svg), a = el("g", { class: "axis" }, f.svg);
    tv.forEach((v) => {
      el("line", { x1: f.m.l, x2: f.w - f.m.r, y1: y(v), y2: y(v) }, g);
      const t = el("text", { x: f.m.l - 6, y: y(v) + 3.5, "text-anchor": "end" }, a); t.textContent = fmt(v, 0) + suffix;
    });
  }
  function xLabels(f, items) {
    const a = el("g", { class: "axis" }, f.svg);
    items.forEach(([x, s]) => { const t = el("text", { x, y: f.h - 8, "text-anchor": "middle" }, a); t.textContent = s; });
  }
  // bar with rounded far end, anchored flat at the baseline
  function barPath(x, w, y0, y1, r = 3) {
    const up = y1 < y0, h = Math.abs(y1 - y0); r = Math.min(r, h / 2, w / 2);
    if (h < 0.5) return "";
    return up
      ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
      : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  /* ---------------- filtering ---------------- */
  const visible = () => D.stocks.filter((s) =>
    (!state.groups.size || state.groups.has(s.group)) &&
    (!state.sector || s.gics_sector === state.sector) &&
    (!state.exch || s.exchange === state.exch) &&
    (!state.q || s.ticker.includes(state.q) || s.company.toUpperCase().includes(state.q)));

  /* ---------------- KPIs ---------------- */
  function renderKPIs() {
    const h = D.head;
    const k = [
      [`${h.egarch_better_aic}<small>/24</small>`, "stocks where EGARCH beats GARCH on AIC (" + h.egarch_better_bic + "/24 on BIC)"],
      [`${h.gamma_neg_sig}<small>/24</small>`, "with significant negative asymmetry γ < 0 (p < 0.05)"],
      [`${h.alpha_sig_p05}<small>/${h.stock_years}</small>`, `stock-year alphas with p < 0.05; ${h.alpha_sig_bh} after FDR`],
      [`${fmt(h.gap_median_abs.GARCH, 1)}<small>%</small>`, `median |gap| conditional vs unconditional (EGARCH ${fmt(h.gap_median_abs.EGARCH, 1)}%)`],
      [`${h.peak_mar2020}<small>/${h.models}</small>`, "models whose peak σ falls in March 2020"],
    ];
    $("#kpis").innerHTML = k.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
  }

  /* ---------------- ticker tape ---------------- */
  function renderTape() {
    const items = D.stocks.map((st) => {
      const p = byT[st.ticker].per;
      return `<button type="button" class="tape-item" data-t="${st.ticker}" title="${esc(st.company)}: 10-yr average Carhart alpha and volatility"><b>${st.ticker}</b>` +
        `<span class="${dir(p.alpha_pct_yr)}">${arrow(p.alpha_pct_yr)} ${sgn(p.alpha_pct_yr)}%</span><small>α/yr</small>` +
        `<span>${fmt(p.vol_pct, 1)}%</span><small>vol</small></button>`;
    }).join("");
    const host = $("#tape");
    host.innerHTML = `<div class="tape-track">${items}<span aria-hidden="true" style="display:contents">${items}</span></div>`;
    host.querySelectorAll('[aria-hidden="true"] .tape-item').forEach((b) => b.setAttribute("tabindex", "-1"));
    host.addEventListener("click", (e) => { const b = e.target.closest(".tape-item"); if (b) { setFocus(b.dataset.t); $("#volatility").scrollIntoView({ behavior: "smooth" }); } });
  }

  /* ---------------- filters UI ---------------- */
  function buildFilters() {
    const chips = $("#groupChips");
    const all = document.createElement("button");
    all.className = "chip"; all.type = "button"; all.textContent = "All groups"; all.dataset.g = "";
    chips.appendChild(all);
    Object.keys(GCOL).forEach((g) => {
      const b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.dataset.g = g;
      b.innerHTML = `<i style="background:${GCOL[g]}"></i>${esc(g)}`;
      chips.appendChild(b);
    });
    chips.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const g = b.dataset.g;
      if (!g) state.groups.clear(); else state.groups.has(g) ? state.groups.delete(g) : state.groups.add(g);
      update();
    });
    const sectors = [...new Set(D.stocks.map((s) => s.gics_sector))].sort();
    $("#sectorSel").innerHTML = `<option value="">All</option>` + sectors.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#sectorSel").onchange = (e) => { state.sector = e.target.value; update(); };
    $("#exchSel").onchange = (e) => { state.exch = e.target.value; update(); };
    $("#search").oninput = (e) => { state.q = e.target.value.trim().toUpperCase(); update(); };
    $("#sortSel").onchange = (e) => { state.sort = e.target.value; renderCards(); };
    $("#resetBtn").onclick = () => {
      state.groups.clear(); state.sector = state.exch = state.q = "";
      $("#sectorSel").value = $("#exchSel").value = $("#search").value = ""; update();
    };
    $("#focusSel").onchange = (e) => setFocus(e.target.value);

    const factors = [["alpha_pct_yr", "Alpha %/yr"], ["MKT", "Market β"], ["SMB", "SMB"], ["HML", "HML"], ["UMD", "UMD"], ["R2", "R²"]];
    segmented($("#factorSeg"), factors, () => state.factor, (v) => { state.factor = v; renderHeatmap(); });
    segmented($("#scatSeg"), [["GARCH", "GARCH"], ["EGARCH", "EGARCH"]], () => state.scatModel, (v) => { state.scatModel = v; renderScatter(); });
  }
  function segmented(host, opts, get, set) {
    host.innerHTML = opts.map(([v, l]) => `<button type="button" role="tab" data-v="${v}">${l}</button>`).join("");
    const sync = () => host.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.v === get()));
    host.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set(b.dataset.v); sync(); } });
    sync();
  }
  function syncFilterUI(vis) {
    document.querySelectorAll("#groupChips .chip").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.g ? state.groups.has(b.dataset.g) : state.groups.size === 0));
    $("#countLbl").textContent = `${vis.length} of 24 stocks`;
    const fs = $("#focusSel"), opts = vis.length ? vis : D.stocks;
    fs.innerHTML = opts.map((s) => `<option value="${s.ticker}">${s.ticker} · ${esc(s.company)}</option>`).join("");
    if (!opts.some((s) => s.ticker === state.focus)) state.focus = opts[0].ticker;
    fs.value = state.focus;
  }

  /* ---------------- scorecards ---------------- */
  let sparkMax = 0;
  function renderCards() {
    const vis = visible(), host = $("#cards");
    const per = (t) => byT[t].per;
    const order = D.stocks.map((s) => s.ticker);
    const sorted = [...vis].sort((a, b) => state.sort === "group"
      ? order.indexOf(a.ticker) - order.indexOf(b.ticker)
      : state.sort === "EGARCH_gamma" ? per(a.ticker)[state.sort] - per(b.ticker)[state.sort]
      : per(b.ticker)[state.sort] - per(a.ticker)[state.sort]);
    $("#emptyMsg").hidden = vis.length > 0;
    host.innerHTML = "";
    sorted.forEach((s) => {
      const p = per(s.ticker), g = byT[s.ticker].g, e = byT[s.ticker].e;
      const dAIC = e.AIC - g.AIC;
      const b = document.createElement("button");
      b.type = "button"; b.className = "card"; b.dataset.t = s.ticker;
      b.setAttribute("aria-pressed", s.ticker === state.focus);
      b.setAttribute("aria-label", `${s.ticker} ${s.company} scorecard. Focus volatility charts`);
      b.innerHTML = `
        <div class="card-top"><span><span class="tk">${s.ticker}</span><span class="chg ${dir(p.alpha_pct_yr)}" title="10-yr average Carhart alpha">${arrow(p.alpha_pct_yr)} ${sgn(p.alpha_pct_yr)}%</span></span><span class="exch">${s.exchange}</span></div>
        <div class="co">${esc(s.company)}</div>
        <div class="grp"><i style="background:${GCOL[s.group]}"></i>${esc(s.group)}</div><div class="sector">${esc(s.gics_sector)}</div>
        <svg class="spark" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="metrics">
          <div class="metric" title="Average market beta">Mkt β <b>${fmt(p.MKT_beta)}</b></div>
          <div class="metric" title="Average HML loading">HML <b>${fmt(p.HML)}</b></div>
          <div class="metric" title="Average Carhart alpha, % per year">α %/yr <b class="${dir(p.alpha_pct_yr)}">${sgn(p.alpha_pct_yr)}</b></div>
          <div class="metric" title="Average annual unconditional volatility">Vol % <b>${fmt(p.vol_pct, 1)}</b></div>
          <div class="metric" title="GARCH persistence α+β">Persist. <b>${fmt(p.GARCH_persist, 3)}</b></div>
          <div class="metric" title="EGARCH asymmetry γ">γ <b>${fmt(p.EGARCH_gamma, 3)}</b></div>
          <div class="metric wide">Asymmetry <b><span class="badge ${p.asym_sig ? "yes" : "no"}">${p.asym_sig ? "significant" : "not significant"}</span></b></div>
          <div class="metric wide">ΔAIC (EGARCH − GARCH) <b>${fmt(dAIC, 1)}</b></div>
        </div>`;
      // sparkline: monthly EGARCH σ on a shared scale across all stocks
      const m = D.monthly[s.ticker].e, sv = b.querySelector(".spark");
      const x = lin(0, m.length - 1, 1, 239), y = lin(0, sparkMax, 39, 2);
      const pts = m.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      const sc = p.alpha_pct_yr >= 0 ? C.up : C.down;
      el("polygon", { points: `1,39 ${pts} 239,39`, fill: sc, "fill-opacity": 0.12 }, sv);
      el("polyline", { points: pts, fill: "none", stroke: sc, "stroke-width": 1.4, "vector-effect": "non-scaling-stroke" }, sv);
      b.onclick = () => { setFocus(s.ticker); $("#volatility").scrollIntoView({ behavior: "smooth" }); };
      host.appendChild(b);
    });
  }

  /* ---------------- heatmap ---------------- */
  const FSPEC = {
    alpha_pct_yr: { c: 0, r: 80, d: 0, p: "alpha_p", bh: "alpha_p_bh", lab: "Alpha (% per year)" },
    MKT: { c: 1, r: 1, d: 2, p: "MKT_p", lab: "Market β (centre = 1)" },
    SMB: { c: 0, r: 1.2, d: 2, p: "SMB_p", lab: "SMB loading" },
    HML: { c: 0, r: 1.2, d: 2, p: "HML_p", lab: "HML loading" },
    UMD: { c: 0, r: 1, d: 2, p: "UMD_p", lab: "UMD loading" },
    R2: { seq: true, r: 0.8, d: 2, lab: "R²" },
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; };
  function cellColor(sp, v) {
    if (sp.seq) { const t = Math.max(0, Math.min(1, v / sp.r)); return [mix("#262b33", "#14a974", t), t > 0.6]; }
    const t = Math.max(-1, Math.min(1, (v - sp.c) / sp.r));
    return [mix("#262b33", t < 0 ? "#ea3943" : "#14a974", Math.abs(t)), Math.abs(t) > 0.6];
  }
  function renderHeatmap() {
    const sp = FSPEC[state.factor], vis = visible(), host = $("#heatmap");
    const L = $("#heatLegend");
    L.innerHTML = sp.seq
      ? `<span>${sp.lab}</span><span>0</span><span class="bar" style="background:linear-gradient(90deg,#262b33,#14a974)"></span><span>≥ ${sp.r}</span>`
      : `<span>${sp.lab}</span><span>${fmt(sp.c - sp.r, sp.d)}</span><span class="bar" style="background:linear-gradient(90deg,#ea3943,#262b33,#14a974)"></span><span>${sgn(sp.c + sp.r, sp.d)}</span>`;
    let html = `<div class="hm-row head"><div></div>${YEARS.map((y) => `<div>${y}</div>`).join("")}<div>10-yr avg</div></div>`;
    let prev = null;
    vis.forEach((s) => {
      const rs = byT[s.ticker].carhart;
      const sep = prev && prev !== s.group ? " sep" : ""; prev = s.group;
      html += `<div class="hm-row${sep}"><div class="hm-label"><i style="background:${GCOL[s.group]}"></i>${s.ticker}</div>`;
      rs.forEach((r) => {
        const v = r[state.factor], [bg, dark] = cellColor(sp, v);
        const cls = sp.p ? (sp.bh && r[sp.bh] < 0.05 ? " ring" : r[sp.p] < 0.05 ? " dot" : "") : "";
        html += `<div class="hm-cell${cls}" data-t="${s.ticker}" data-y="${r.year}" style="background:${bg};color:${dark ? "#0d0f13" : "#e9edf2"}">${fmt(v, sp.d)}</div>`;
      });
      const avg = rs.reduce((a, r) => a + r[state.factor], 0) / rs.length;
      html += `<div class="hm-cell avg">${fmt(avg, sp.d)}</div></div>`;
    });
    host.innerHTML = vis.length ? html : `<p class="empty">No stocks match these filters.</p>`;
  }
  function heatTip(e) {
    const c = e.target.closest(".hm-cell[data-t]"); if (!c) return hideTip();
    const r = byT[c.dataset.t].carhart.find((x) => x.year === +c.dataset.y);
    showTip(`<b>${r.ticker} · ${r.year}</b> <span style="opacity:.7">n = ${r.n}</span>` +
      row("Alpha %/yr", `<span class="${dir(r.alpha_pct_yr)}">${arrow(r.alpha_pct_yr)} ${sgn(r.alpha_pct_yr)}</span> (p ${fp(r.alpha_p)})`) +
      row("BH-adjusted p", fp(r.alpha_p_bh)) +
      ["MKT", "SMB", "HML", "UMD"].map((k) => row(k, `${fmt(r[k])} (p ${fp(r[k + "_p"])})`)).join("") +
      row("R²", fmt(r.R2)), e);
  }

  /* ---------------- volatility charts ---------------- */
  function renderLine() {
    const t = state.focus, m = D.monthly[t], f = frame($("#lineChart"), { t: 12, r: 16, b: 26, l: 40 });
    $("#lineTitle").textContent = `${t} · monthly mean conditional volatility (% p.a.)`;
    const ymax = niceMax(Math.max(...m.g, ...m.e) * 1.05);
    const x = lin(0, m.m.length - 1, f.m.l, f.w - f.m.r), y = lin(0, ymax, f.m.t + f.ih, f.m.t);
    yAxis(f, y, ticks(0, ymax, 4), "%");
    xLabels(f, YEARS.filter((yr) => f.iw > 520 || yr % 2 === 0).map((yr) => [x((yr - 2016) * 12 + 6), String(yr)]));
    const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    el("path", { d: path(m.g), fill: "none", stroke: C.garch, "stroke-width": 2, "stroke-linejoin": "round" }, f.svg);
    el("path", { d: path(m.e), fill: "none", stroke: C.egarch, "stroke-width": 2, "stroke-linejoin": "round", "stroke-dasharray": "5 3" }, f.svg);
    const ch = el("line", { y1: f.m.t, y2: f.m.t + f.ih, stroke: C.unc, "stroke-width": 1, opacity: 0 }, f.svg);
    const dg = el("circle", { r: 4, fill: C.garch, stroke: C.panel, "stroke-width": 2, opacity: 0 }, f.svg);
    const de = el("rect", { width: 8, height: 8, x: -99, fill: C.egarch, stroke: C.panel, "stroke-width": 2, opacity: 0 }, f.svg);
    const hit = el("rect", { x: f.m.l, y: f.m.t, width: f.iw, height: f.ih, fill: "transparent" }, f.svg);
    const move = (ev) => {
      const pt = f.svg.getBoundingClientRect(), sx = ((ev.clientX - pt.left) / pt.width) * f.w;
      const i = Math.max(0, Math.min(m.m.length - 1, Math.round(((sx - f.m.l) / f.iw) * (m.m.length - 1))));
      const xi = x(i);
      ch.setAttribute("x1", xi); ch.setAttribute("x2", xi); ch.setAttribute("opacity", 0.35);
      dg.setAttribute("cx", xi); dg.setAttribute("cy", y(m.g[i])); dg.setAttribute("opacity", 1);
      de.setAttribute("x", xi - 4); de.setAttribute("y", y(m.e[i]) - 4); de.setAttribute("opacity", 1);
      showTip(`<b>${t} · ${m.m[i]}</b>` + row("GARCH", fmt(m.g[i], 1) + "%", C.garch) + row("EGARCH", fmt(m.e[i], 1) + "%", C.egarch), ev);
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => { hideTip(); [ch, dg, de].forEach((n) => n.setAttribute("opacity", 0)); });
  }

  function renderAnnual() {
    const t = state.focus, rs = byT[t].annual, f = frame($("#annChart"), { t: 12, r: 10, b: 26, l: 40 });
    $("#annTitle").textContent = `${t} · annual volatility (% p.a.)`;
    const vals = rs.flatMap((r) => [r.Unconditional, r.GARCH, r.EGARCH]);
    const ymax = Math.ceil(Math.max(...vals) * 1.06 / 10) * 10, ymin = Math.max(0, Math.floor(Math.min(...vals) * 0.9 / 10) * 10);
    const bw = f.iw / YEARS.length, x = (yr) => f.m.l + (yr - 2016 + 0.5) * bw, y = lin(ymin, ymax, f.m.t + f.ih, f.m.t);
    yAxis(f, y, ticks(ymin, ymax, 4), "%");
    xLabels(f, YEARS.filter((yr) => f.iw > 380 || yr % 2 === 0).map((yr) => [x(yr), f.iw > 380 ? String(yr) : "’" + String(yr).slice(2)]));
    const off = Math.min(9, bw * 0.22);
    rs.forEach((r) => {
      const cx = x(r.year), lo = Math.min(r.Unconditional, r.GARCH, r.EGARCH), hi = Math.max(r.Unconditional, r.GARCH, r.EGARCH);
      el("line", { x1: cx, x2: cx, y1: y(lo), y2: y(hi), stroke: C.muted, "stroke-width": 2 }, f.svg);
      el("circle", { cx: cx - off, cy: y(r.GARCH), r: 4.5, fill: C.garch, stroke: C.panel, "stroke-width": 2 }, f.svg);
      el("rect", { x: cx + off - 4.5, y: y(r.EGARCH) - 4.5, width: 9, height: 9, rx: 1, fill: C.egarch, stroke: C.panel, "stroke-width": 2 }, f.svg);
      el("circle", { cx, cy: y(r.Unconditional), r: 4.5, fill: C.panel, stroke: C.unc, "stroke-width": 2 }, f.svg);
      const hit = el("rect", { x: cx - bw / 2, y: f.m.t, width: bw, height: f.ih, fill: "transparent" }, f.svg);
      hit.addEventListener("pointermove", (ev) => showTip(`<b>${t} · ${r.year}</b>` +
        row("Unconditional", fmt(r.Unconditional, 1) + "%", C.unc) +
        row("GARCH", `${fmt(r.GARCH, 1)}% (<span class="${dir(r.GARCH_gap_pct)}">${sgn(r.GARCH_gap_pct)}%</span>)`, C.garch) +
        row("EGARCH", `${fmt(r.EGARCH, 1)}% (<span class="${dir(r.EGARCH_gap_pct)}">${sgn(r.EGARCH_gap_pct)}%</span>)`, C.egarch) +
        row("Within-year P95/P05", `${fmt(r.GARCH_p95_p05)} / ${fmt(r.EGARCH_p95_p05)}`), ev));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  function renderScatter() {
    const vis = new Set(visible().map((s) => s.ticker)), mdl = state.scatModel;
    const rs = D.annual.filter((r) => vis.has(r.ticker));
    const f = frame($("#scatChart"), { t: 10, r: 12, b: 34, l: 40 });
    if (!rs.length) return;
    const hi = niceMax(Math.max(...rs.flatMap((r) => [r.Unconditional, r[mdl]])) * 1.04);
    const x = lin(0, hi, f.m.l, f.w - f.m.r), y = lin(0, hi, f.m.t + f.ih, f.m.t);
    const tv = ticks(0, hi, 4);
    yAxis(f, y, tv, "%");
    xLabels(f, tv.map((v) => [x(v), fmt(v, 0) + "%"]).map(([a, b]) => [a, b]));
    f.svg.querySelectorAll(".axis text").forEach((n) => { if (+n.getAttribute("y") === f.h - 8) n.setAttribute("y", f.h - 18); });
    const lab = el("text", { x: f.m.l + f.iw / 2, y: f.h - 2, "text-anchor": "middle", class: "axis" }, f.svg);
    lab.textContent = "Unconditional (% p.a.)"; lab.setAttribute("style", "font:11px var(--mono);fill:#7c8591");
    el("line", { x1: x(0), y1: y(0), x2: x(hi), y2: y(hi), stroke: C.unc, "stroke-dasharray": "4 4", "stroke-width": 1 }, f.svg);
    const draw = (r, focus) => {
      const c = el("circle", { cx: x(r.Unconditional), cy: y(r[mdl]), r: focus ? 5 : 3.6,
        fill: focus ? C.up : C.dim, "fill-opacity": focus ? 1 : 0.7, stroke: C.panel, "stroke-width": focus ? 2 : 1 }, f.svg);
      c.addEventListener("pointermove", (ev) => showTip(`<b>${r.ticker} · ${r.year}</b>` +
        row("Unconditional", fmt(r.Unconditional, 1) + "%") + row(mdl, fmt(r[mdl], 1) + "%") +
        row("Gap", `<span class="${dir(r[mdl + "_gap_pct"])}">${sgn(r[mdl + "_gap_pct"])}%</span>`), ev));
      c.addEventListener("pointerleave", hideTip);
    };
    rs.filter((r) => r.ticker !== state.focus).forEach((r) => draw(r, false));
    rs.filter((r) => r.ticker === state.focus).forEach((r) => draw(r, true));
  }

  function renderGap() {
    const vis = new Set(visible().map((s) => s.ticker));
    const rs = D.annual.filter((r) => vis.has(r.ticker));
    const f = frame($("#gapChart"), { t: 14, r: 12, b: 26, l: 40 });
    if (!rs.length) return;
    const med = YEARS.map((yr) => {
      const a = rs.filter((r) => r.year === yr);
      return { yr, g: median(a.map((r) => r.GARCH_gap_pct)), e: median(a.map((r) => r.EGARCH_gap_pct)) };
    });
    const ext = Math.max(5, ...med.flatMap((d) => [Math.abs(d.g), Math.abs(d.e)]));
    const lo = -niceMax(Math.max(ext * 0.6, Math.abs(Math.min(0, ...med.flatMap((d) => [d.g, d.e]))) * 1.15));
    const hi = niceMax(Math.max(1, ...med.flatMap((d) => [d.g, d.e])) * 1.15);
    const y = lin(lo, hi, f.m.t + f.ih, f.m.t), bw = f.iw / YEARS.length;
    yAxis(f, y, ticks(lo, hi, 4), "%");
    el("line", { x1: f.m.l, x2: f.w - f.m.r, y1: y(0), y2: y(0), stroke: C.unc, "stroke-width": 1 }, f.svg);
    xLabels(f, YEARS.map((yr, i) => [f.m.l + (i + 0.5) * bw, f.iw > 420 ? String(yr) : "’" + String(yr).slice(2)]));
    const w = Math.min(22, bw * 0.32);
    const defs = el("defs", {}, f.svg), pat = el("pattern", { id: "hatchE", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 4, height: 4, fill: C.egarch, "fill-opacity": 0.25 }, pat);
    el("rect", { width: 2, height: 4, fill: C.egarch }, pat);
    med.forEach((d, i) => {
      const cx = f.m.l + (i + 0.5) * bw;
      el("path", { d: barPath(cx - w - 1, w, y(0), y(d.g)), fill: C.garch }, f.svg);
      el("path", { d: barPath(cx + 1, w, y(0), y(d.e)), fill: "url(#hatchE)", stroke: C.egarch, "stroke-width": 1.2 }, f.svg);
      const hit = el("rect", { x: cx - bw / 2, y: f.m.t, width: bw, height: f.ih, fill: "transparent" }, f.svg);
      hit.addEventListener("pointermove", (ev) => showTip(`<b>${d.yr} · median gap</b>` +
        row("GARCH", `<span class="${dir(d.g)}">${sgn(d.g)}%</span>`, C.garch) + row("EGARCH", `<span class="${dir(d.e)}">${sgn(d.e)}%</span>`, C.egarch) +
        row("Stocks", String(vis.size)), ev));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  function renderVolStats() {
    const vis = new Set(visible().map((s) => s.ticker));
    const rs = D.annual.filter((r) => vis.has(r.ticker));
    if (!rs.length) { $("#volStats").innerHTML = ""; return; }
    const ag = rs.map((r) => Math.abs(r.GARCH_gap_pct)), ae = rs.map((r) => Math.abs(r.EGARCH_gap_pct));
    const w10 = (a) => (100 * a.filter((v) => v <= 10).length) / a.length;
    const z = (x) => (Math.abs(x) < 5e-5 ? "0 (identical to 4 dp)" : fmt(x, 4));
    const items = [
      [`${fmt(median(ag), 1)}%`, "median |gap|, GARCH"], [`${fmt(median(ae), 1)}%`, "median |gap|, EGARCH"],
      [`${fmt(w10(ag), 0)}% / ${fmt(w10(ae), 0)}%`, "stock-years within ±10% (GARCH / EGARCH)"],
      [`${rs.length}`, `stock-years in view (${vis.size} stocks)`],
    ];
    $("#volStats").innerHTML = items.map(([b, s]) => `<div class="callout"><b>${b}</b><span>${s}</span></div>`).join("");
  }

  /* ---------------- tables ---------------- */
  const MCOLS = [
    ["ticker", "Ticker", (r) => r.t, "l tick"], ["group", "Group", (r) => r.s.group, "l"],
    ["ga", "GARCH α", (r) => r.g.alpha, "", 3], ["gb", "β", (r) => r.g.beta, "", 3],
    ["gp", "α+β", (r) => r.g.persistence, "", 3], ["hl", "Half-life (d)", (r) => (r.g.half_life_days === "inf" ? Infinity : r.g.half_life_days), "", 1],
    ["gnu", "ν", (r) => r.g.nu, "", 2], ["ea", "EGARCH α", (r) => r.e.alpha, "", 3],
    ["eg", "γ", (r) => r.e.gamma, "", 3], ["egp", "γ p (BH)", (r) => r.e.gamma_p_bh, "", 3],
    ["eb", "β", (r) => r.e.beta, "", 3], ["daic", "ΔAIC", (r) => r.e.AIC - r.g.AIC, "", 1],
    ["dbic", "ΔBIC", (r) => r.e.BIC - r.g.BIC, "", 1], ["pk", "Peak σ (EGARCH)", (r) => r.e.peak_date, "l"],
    ["mx", "Max σ %/day", (r) => r.e.max_sigma_pct, "", 2],
  ];
  function renderModelTable() {
    const tb = $("#modelTable"), vis = visible();
    const data = vis.map((s) => ({ t: s.ticker, s, g: byT[s.ticker].g, e: byT[s.ticker].e }));
    const col = MCOLS.find((c) => c[0] === state.msort.k);
    if (state.msort.k !== "ticker" || state.msort.dir !== 0) data.sort((a, b) => {
      const va = col[2](a), vb = col[2](b);
      const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return state.msort.dir < 0 ? -c : c;
    });
    tb.innerHTML = `<thead><tr>${MCOLS.map(([k, l, , cls]) => `<th class="${cls.includes("l") ? "l" : ""}" data-k="${k}" ${state.msort.k === k ? `aria-sort="${state.msort.dir < 0 ? "descending" : "ascending"}"` : ""}>${l}${state.msort.k === k ? (state.msort.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>` +
      `<tbody>${data.map((r) => `<tr class="${r.t === state.focus ? "focus" : ""}" data-t="${r.t}">${MCOLS.map(([k, , f, cls, d]) => {
        let v = f(r);
        if (k === "group") v = `<span class="grp"><i style="background:${GCOL[v]}"></i>${esc(v)}</span>`;
         else if (k === "egp") v = `${fp(v)}${r.e.gamma < 0 && r.e.gamma_p < 0.05 ? '<span class="badge yes">sig</span>' : ""}`;
        else if (typeof v === "number" || v === Infinity) v = v === Infinity ? "∞" : fmt(v, d);
        return `<td class="${cls}">${v}</td>`;
      }).join("")}</tr>`).join("")}</tbody>`;
  }
  function renderGroupTable() {
    const H = D.hypotheses;
    let n = 0, tot = 0;
    Object.values(H).forEach((a) => a.forEach(([, ok]) => { tot++; n += ok; }));
    $("#hypScore").textContent = `${n}/${tot}`;
    const cols = ["n", "MKT_beta", "SMB", "HML", "UMD", "alpha_pct_yr", "vol_pct", "GARCH_persist", "EGARCH_gamma", "asym_sig"];
    const lab = ["n", "Mkt β", "SMB", "HML", "UMD", "α %/yr", "Vol %", "α+β", "EGARCH γ", "Asym. sig"];
    const dig = [0, 2, 2, 2, 2, 1, 1, 3, 3, 0];
    $("#groupTable").innerHTML = `<thead><tr><th class="l">Group</th>${lab.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>` +
      D.groups.map((g) => `<tr><td class="l gname"><span class="grp"><i style="background:${GCOL[g.group]}"></i>${esc(g.group)}</span></td>` +
        cols.map((c, i) => `<td>${c === "asym_sig" ? `${g[c]}/${g.n}` : fmt(g[c], dig[i])}</td>`).join("") + "</tr>").join("") + "</tbody>";
    const HN = ["Market β", "HML", "Volatility", "Asymmetry"];
    $("#hypGrid").innerHTML = D.groups.map((g) => {
      const hs = H[g.group], k = hs.filter((h) => h[1]).length;
      return `<div class="hyp"><div class="hyp-h"><span class="grp"><i style="background:${GCOL[g.group]}"></i>${esc(g.group)}</span><b>${k}/4</b></div>` +
        hs.map(([txt, ok], i) => `<div class="hyp-r"><span>${HN[i]}</span><span class="chk ${ok ? "y" : "n"}">${ok ? "✓" : "✗"} ${esc(txt)}</span></div>`).join("") + "</div>";
    }).join("");
  }

  function renderVerification() {
    const v = D.verification, h = v.saved_headlines;
    const z = (x) => (Math.abs(x) < 5e-5 ? "0 (identical to 4 dp)" : fmt(x, 4));
    const items = [
      `Q1: 240 stock-year regressions re-fit; max |Δα| = ${z(v.q1_refit_max_abs_diff.alpha_pct_yr)}, max |Δβ| = ${z(v.q1_refit_max_abs_diff.MKT)}.`,
      `Q2: 48 models re-fit; max |Δ log-likelihood| = ${z(v.q2_refit.max_abs_dLL)}, max |Δγ| = ${z(v.q2_refit.max_abs_dgamma)}.`,
      `Q3: 240 annual figures recomputed from saved σₜ; max difference = ${z(Math.max(...Object.values(v.q3_recompute_max_abs_diff_pp)))}.`,
      `Headlines match the executed notebook: ${h.alpha_sig_p05}/240 alphas, EGARCH ${h.egarch_better_aic}/24 (AIC), γ ${h.gamma_neg_sig}/24, median |gap| ${h.q3_median_abs_gap_garch}% / ${h.q3_median_abs_gap_egarch}%.`,
    ];
    $("#verifyList").innerHTML = items.map((s) => `<li>${s}</li>`).join("");
  }

  /* ---------------- orchestration ---------------- */
  function setFocus(t) {
    state.focus = t;
    document.querySelectorAll(".card").forEach((c) => c.setAttribute("aria-pressed", c.dataset.t === t));
    $("#focusSel").value = t;
    document.querySelectorAll("#modelTable tbody tr").forEach((r) => r.classList.toggle("focus", r.dataset.t === t));
    const u = new URL(location.href); u.searchParams.set("focus", t); history.replaceState(null, "", u);
    renderLine(); renderAnnual(); renderScatter();
  }
  function renderCharts() { renderLine(); renderAnnual(); renderScatter(); renderGap(); renderVolStats(); }
  function update() {
    const vis = visible();
    syncFilterUI(vis);
    renderCards(); renderHeatmap(); renderCharts(); renderModelTable();
  }

  async function init() {
    D = await (await fetch("data/observatory.json")).json();
    D.stocks.forEach((s) => (byT[s.ticker] = { s, carhart: [], annual: [] }));
    D.carhart.forEach((r) => byT[r.ticker].carhart.push(r));
    D.annual.forEach((r) => byT[r.ticker].annual.push(r));
    D.vol.forEach((r) => (byT[r.ticker][r.model === "GARCH" ? "g" : "e"] = r));
    D.per.forEach((r) => (byT[r.ticker].per = r));
    Object.values(byT).forEach((o) => { o.carhart.sort((a, b) => a.year - b.year); o.annual.sort((a, b) => a.year - b.year); });
    sparkMax = Math.max(...Object.values(D.monthly).flatMap((m) => m.e));
    const f = (params.get("focus") || "").toUpperCase();
    state = { groups: new Set(), sector: "", exch: "", q: "", sort: "group", factor: "alpha_pct_yr", scatModel: "GARCH",
      focus: byT[f] ? f : "NVDA", msort: { k: "ticker", dir: 0 } };
    renderKPIs(); renderTape(); buildFilters(); renderGroupTable(); renderVerification(); update();
    $("#heatmap").addEventListener("pointermove", heatTip);
    $("#heatmap").addEventListener("pointerleave", hideTip);
    $("#modelTable").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (th) {
        const k = th.dataset.k;
        state.msort = state.msort.k === k ? { k, dir: state.msort.dir === 1 ? -1 : 1 } : { k, dir: k === "ticker" || k === "group" || k === "pk" ? 1 : -1 };
        renderModelTable(); return;
      }
      const tr = e.target.closest("tbody tr"); if (tr) setFocus(tr.dataset.t);
    });
    let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(renderCharts, 120); }).observe($("#volatility"));
    addEventListener("scroll", hideTip, { passive: true });
  }
  init().catch((err) => { console.error(err); document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="empty">Could not load data: ${esc(err.message)}</p>`); });
})();
