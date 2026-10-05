const crypto = require("crypto");

const BASE = (process.env.KALSHI_BASE_URL || "https://external-api.kalshi.com/trade-api/v2").replace(/\/$/, "");

function pem() {
  return (process.env.KALSHI_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}
function sign(ts, method, path) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(ts + method + path);
  signer.end();
  return signer.sign({
    key: pem(),
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }).toString("base64");
}
async function kalshi(path) {
  const url = new URL(BASE + path);
  const ts = String(Date.now());
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "KALSHI-ACCESS-KEY": process.env.KALSHI_API_KEY_ID,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": sign(ts, "GET", url.pathname),
      Accept: "application/json"
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(path.split("?")[0] + " " + res.status + " " + text.slice(0, 180));
  return text ? JSON.parse(text) : {};
}
function num(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function px(v, cents) {
  if (v == null || v === "") return num(cents) / 100;
  return num(v);
}
async function pages(path, key) {
  let out = [];
  let cursor = "";
  for (let i = 0; i < 40; i++) {
    const q = path + (path.includes("?") ? "&" : "?") + "limit=200" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const data = await kalshi(q);
    out = out.concat(data[key] || []);
    cursor = data.cursor || "";
    if (!cursor) break;
  }
  return out;
}
function slimFill(f) {
  return {
    ts: f.created_time || f.ts,
    ticker: f.ticker || f.market_ticker,
    action: f.action || "",
    side: f.outcome_side || f.side || "",
    book: f.book_side || "",
    count: num(f.count_fp != null ? f.count_fp : f.count),
    yes: px(f.yes_price_dollars, f.yes_price),
    no: px(f.no_price_dollars, f.no_price),
    fee: px(f.fee_cost, f.fee),
    taker: !!f.is_taker
  };
}
function moneyFields(row) {
  const out = { status: row.status || row.deposit_status || null, ts: row.created_time || row.finalized_time || row.ts || null };
  for (const [k, v] of Object.entries(row)) {
    if (/account|bank|routing|number|id|wire|address/i.test(k)) continue;
    if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) out[k] = v;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!pem() || !process.env.KALSHI_API_KEY_ID) {
    res.status(200).json({ ok: false, error: "no kalshi env" });
    return;
  }
  try {
    const bal = await kalshi("/portfolio/balance");
    const fills = await pages("/portfolio/fills?", "fills");
    const settlements = await pages("/portfolio/settlements?", "settlements");
    const positions = await pages("/portfolio/positions?count_filter=position&", "market_positions");
    const extra = {};
    for (const [name, path, key] of [
      ["deposits", "/portfolio/deposits?", "deposits"],
      ["withdrawals", "/portfolio/withdrawals?", "withdrawals"]
    ]) {
      try { extra[name] = await pages(path, key); }
      catch (e) { extra[name + "Error"] = String(e.message || e); }
    }
    const slim = fills.map(slimFill);
    const settle = settlements.map((s) => ({
      ticker: s.ticker || s.market_ticker,
      result: s.market_result,
      settled: s.settled_time,
      revenue: s.revenue,
      revenueDollars: s.revenue_dollars,
      yes: num(s.yes_count_fp != null ? s.yes_count_fp : s.yes_count),
      no: num(s.no_count_fp != null ? s.no_count_fp : s.no_count),
      yesCost: s.yes_total_cost_dollars != null ? s.yes_total_cost_dollars : s.yes_total_cost,
      noCost: s.no_total_cost_dollars != null ? s.no_total_cost_dollars : s.no_total_cost,
      fee: s.fee_cost != null ? s.fee_cost : s.fee,
      value: s.value
    }));
    const open = positions.map((p) => ({
      ticker: p.ticker,
      position: num(p.position_fp != null ? p.position_fp : p.position),
      exposure: p.market_exposure_dollars != null ? p.market_exposure_dollars : p.market_exposure,
      fees: p.fees_paid_dollars != null ? p.fees_paid_dollars : p.fees_paid,
      realized: p.realized_pnl_dollars != null ? p.realized_pnl_dollars : p.realized_pnl
    }));
    res.status(200).json({
      ok: true,
      asOf: new Date().toISOString(),
      cash: bal.balance_dollars != null ? num(bal.balance_dollars) : num(bal.balance) / 100,
      portfolioValue: bal.portfolio_value,
      fills: slim,
      settlements: settle,
      open,
      deposits: (extra.deposits || []).map(moneyFields),
      withdrawals: (extra.withdrawals || []).map(moneyFields),
      depositError: extra.depositsError || null,
      withdrawalError: extra.withdrawalsError || null
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
};
