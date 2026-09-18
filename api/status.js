const crypto = require("crypto");

const CITIES = {
  NYC:  { name: "New York City", icao: "KNYC", tz: "America/New_York", lat: 40.7789, lon: -73.9692 },
  TTN:  { name: "Trenton", icao: "KTTN", tz: "America/New_York", lat: 40.2767, lon: -74.8133 },
  PHIL: { name: "Philadelphia", icao: "KPHL", tz: "America/New_York", lat: 39.8719, lon: -75.2411 },
  DC:   { name: "Washington DC", icao: "KDCA", tz: "America/New_York", lat: 38.8512, lon: -77.0402 },
  BOS:  { name: "Boston", icao: "KBOS", tz: "America/New_York", lat: 42.3656, lon: -71.0096 },
  MIA:  { name: "Miami", icao: "KMIA", tz: "America/New_York", lat: 25.7959, lon: -80.287 },
  CHI:  { name: "Chicago", icao: "KORD", tz: "America/Chicago", lat: 41.9742, lon: -87.9073 },
  MIN:  { name: "Minneapolis", icao: "KMSP", tz: "America/Chicago", lat: 44.8848, lon: -93.2223 },
  NOLA: { name: "New Orleans", icao: "KMSY", tz: "America/New_York", lat: 29.9934, lon: -90.258 },
  DEN:  { name: "Denver", icao: "KDEN", tz: "America/Denver", lat: 39.8561, lon: -104.6737 },
  OKC:  { name: "Oklahoma City", icao: "KOKC", tz: "America/Chicago", lat: 35.3931, lon: -97.6007 },
  DAL:  { name: "Dallas", icao: "KDFW", tz: "America/Chicago", lat: 32.8998, lon: -97.0403 },
  AUS:  { name: "Austin", icao: "KAUS", tz: "America/Chicago", lat: 30.1975, lon: -97.6664 },
  SATX: { name: "San Antonio", icao: "KSAT", tz: "America/Chicago", lat: 29.5337, lon: -98.4698 },
  HOU:  { name: "Houston", icao: "KHOU", tz: "America/Chicago", lat: 29.6454, lon: -95.2789 },
  PHX:  { name: "Phoenix", icao: "KPHX", tz: "America/Phoenix", lat: 33.4373, lon: -112.0078 },
  LV:   { name: "Las Vegas", icao: "KLAS", tz: "America/Los_Angeles", lat: 36.084, lon: -115.1537 },
  LAX:  { name: "Los Angeles", icao: "KLAX", tz: "America/Los_Angeles", lat: 33.9425, lon: -118.4081 },
  SEA:  { name: "Seattle", icao: "KSEA", tz: "America/Los_Angeles", lat: 47.4502, lon: -122.3088 }
};

const BASE = (process.env.KALSHI_BASE_URL || "https://external-api.kalshi.com/trade-api/v2").replace(/\/$/, "");
const SEED = Number(process.env.SEED_DOLLARS || "99.29");
const UA = process.env.NWS_USER_AGENT || "ProjectSeaOtter/1.0 (dashboard@local)";

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

async function kalshi(method, path) {
  const url = new URL(BASE + path);
  const signPath = url.pathname;
  const ts = String(Date.now());
  const res = await fetch(url, {
    method,
    headers: {
      "KALSHI-ACCESS-KEY": process.env.KALSHI_API_KEY_ID,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": sign(ts, method, signPath),
      Accept: "application/json"
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kalshi ${method} ${signPath} ${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

function cityFromTicker(ticker) {
  const t = String(ticker || "").toUpperCase();
  const keys = Object.keys(CITIES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (t.endsWith("-" + k)) return k;
  }
  return null;
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eventDate(ticker) {
  const m = String(ticker || "").match(/-(\d{2})([A-Z]{3})(\d{2})-/);
  if (!m) return null;
  const months = { JAN:"01", FEB:"02", MAR:"03", APR:"04", MAY:"05", JUN:"06", JUL:"07", AUG:"08", SEP:"09", OCT:"10", NOV:"11", DEC:"12" };
  const mm = months[m[2]];
  if (!mm) return null;
  return `20${m[1]}-${mm}-${m[3]}`;
}

function monthKeyET(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit"
  }).formatToParts(d || new Date());
  return `${(parts.find((p) => p.type === "year") || {}).value}-${(parts.find((p) => p.type === "month") || {}).value}`;
}

function inThisMonth(dateStr, iso) {
  const key = monthKeyET();
  if (dateStr && dateStr.slice(0, 7) === key) return true;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()) && monthKeyET(d) === key) return true;
  }
  return false;
}

function settlementPnl(s) {
  const result = String(s.market_result || "").toLowerCase();
  const yesN = num(s.yes_count_fp);
  const noN = num(s.no_count_fp);
  const yesC = num(s.yes_total_cost_dollars);
  const noC = num(s.no_total_cost_dollars);
  if (result === "no") {
    if (noN > 0) return noN - noC;
    if (yesN > 0) return -yesC;
  }
  if (result === "yes") {
    if (yesN > 0) return yesN - yesC;
    if (noN > 0) return -noC;
  }
  let payout = num(s.revenue);
  if (Number.isInteger(payout) && Math.abs(payout) >= 20) payout /= 100;
  return payout - yesC - noC;
}

async function hourlyPop(city) {
  const meta = CITIES[city];
  if (!meta) return { pop: null, hourly: [] };
  try {
    const pts = await fetch(`https://api.weather.gov/points/${meta.lat.toFixed(4)},${meta.lon.toFixed(4)}`, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" }
    });
    if (!pts.ok) return { pop: null, hourly: [] };
    const hourlyUrl = ((await pts.json()).properties || {}).forecastHourly;
    if (!hourlyUrl) return { pop: null, hourly: [] };
    const fc = await fetch(hourlyUrl, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!fc.ok) return { pop: null, hourly: [] };
    const periods = ((await fc.json()).properties || {}).periods || [];
    const hourly = periods.slice(0, 12).map((p) => Number((p.probabilityOfPrecipitation || {}).value || 0));
    return { pop: hourly.length ? Math.max(...hourly) : null, hourly };
  } catch {
    return { pop: null, hourly: [] };
  }
}

async function metar(icao) {
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`, {
      headers: { "User-Agent": UA }
    });
    if (!r.ok) return { wet: false };
    const payload = await r.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    let best = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const raw = String(row.rawOb || row.raw || "");
      for (const m of raw.matchAll(/P(\d{4})/g)) best = Math.max(best, parseInt(m[1], 10));
    }
    return { wet: best >= 1 };
  } catch {
    return { wet: false };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=8, stale-while-revalidate=30");
  const keyId = (process.env.KALSHI_API_KEY_ID || "").trim();
  const key = pem();
  if (!keyId || !key) {
    res.status(200).json({ live: false, hint: "Add Kalshi env vars on Vercel." });
    return;
  }
  try {
    const [bal, pos] = await Promise.all([
      kalshi("GET", "/portfolio/balance"),
      kalshi("GET", "/portfolio/positions?limit=200&count_filter=position")
    ]);
    let settlements = [];
    try {
      let cursor = "";
      for (let i = 0; i < 5; i++) {
        const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const s = await kalshi("GET", `/portfolio/settlements?limit=200${q}`);
        settlements = settlements.concat(s.settlements || []);
        cursor = s.cursor || "";
        if (!cursor) break;
      }
    } catch {}
    const cash = bal.balance_dollars != null ? num(bal.balance_dollars) : num(bal.balance) / 100;
    const rows = pos.market_positions || pos.positions || [];
    const openRaw = [];
    const byTicker = {};

    for (const p of rows) {
      const ticker = p.ticker || "";
      if (!String(ticker).toUpperCase().includes("RAIN")) continue;
      const contractsRaw = p.position_fp != null ? num(p.position_fp) : num(p.position);
      if (!contractsRaw) continue;
      const city = cityFromTicker(ticker) || "UNK";
      const side = contractsRaw < 0 ? "NO" : "YES";
      const contracts = Math.abs(contractsRaw);
      const exposure = num(p.market_exposure_dollars != null ? p.market_exposure_dollars : (num(p.market_exposure) / 100));
      const fees = num(p.fees_paid_dollars != null ? p.fees_paid_dollars : (num(p.fees_paid) / 100));
      const date = eventDate(ticker);
      openRaw.push({ ticker, city, side, contracts, exposure: Math.abs(exposure), entry: contracts ? Math.abs(exposure) / contracts : 0 });
      if (inThisMonth(date, p.last_updated_ts)) {
        byTicker[ticker] = {
          city, name: (CITIES[city] || {}).name || city, ticker, date,
          settledAt: p.last_updated_ts, side, status: "OPEN", realized: null,
          fees: Number(fees.toFixed(2)), traded: Number(Math.abs(exposure).toFixed(2))
        };
      }
    }

    for (const s of settlements) {
      const ticker = s.ticker || s.market_ticker || "";
      if (!String(ticker).toUpperCase().includes("RAIN")) continue;
      const date = eventDate(ticker);
      const updated = s.settled_time || null;
      if (!inThisMonth(date, updated)) continue;
      const city = cityFromTicker(ticker) || "UNK";
      const noN = num(s.no_count_fp);
      const yesN = num(s.yes_count_fp);
      byTicker[ticker] = {
        city, name: (CITIES[city] || {}).name || city, ticker, date,
        settledAt: updated,
        side: noN >= yesN ? "NO" : "YES",
        result: String(s.market_result || "").toUpperCase(),
        status: "CLOSED",
        realized: Number(settlementPnl(s).toFixed(2)),
        fees: Number(num(s.fee_cost).toFixed(2)),
        traded: Number((num(s.yes_total_cost_dollars) + num(s.no_total_cost_dollars)).toFixed(2))
      };
    }

    const monthRows = Object.values(byTicker).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const monthClosedPnl = monthRows.filter((r) => r.status === "CLOSED").reduce((a, r) => a + num(r.realized), 0);

    const open = [];
    let openMark = 0;
    for (const row of openRaw) {
      let yes = null;
      try {
        const mkt = await kalshi("GET", `/markets/${encodeURIComponent(row.ticker)}`);
        const market = mkt.market || mkt;
        yes = num(market.last_price_dollars != null ? market.last_price_dollars : (market.last_price || 0) / 100);
        if (!yes) yes = num(market.yes_bid_dollars != null ? market.yes_bid_dollars : (market.yes_bid || 0) / 100);
      } catch {}
      const mark = row.side === "NO" ? (yes ? 1 - yes : row.entry) : (yes || row.entry);
      const meta = CITIES[row.city] || {};
      const [pop, wx] = await Promise.all([hourlyPop(row.city), metar(meta.icao || "")]);
      const cashUsed = row.exposure || row.contracts * row.entry;
      openMark += row.contracts * mark;
      open.push({
        city: row.city, name: meta.name || row.city, station: meta.icao || "",
        ticker: row.ticker, side: row.side,
        entry: Number(row.entry.toFixed(2)), mark: Number(mark.toFixed(2)),
        contracts: row.contracts, cash: Number(cashUsed.toFixed(2)),
        pop: pop.pop, popHourly: pop.hourly, metar: wx.wet ? "WET" : "DRY"
      });
    }

    const portfolio = cash + openMark;
    res.status(200).json({
      live: true,
      asOf: new Date().toISOString(),
      seed: SEED,
      cash: Number(cash.toFixed(2)),
      openMark: Number(openMark.toFixed(2)),
      portfolio: Number(portfolio.toFixed(2)),
      sinceSeed: Number((portfolio - SEED).toFixed(2)),
      weekPnl: Number(monthClosedPnl.toFixed(2)),
      open,
      history: monthRows,
      month: monthKeyET()
    });
  } catch (err) {
    res.status(200).json({ live: false, error: String(err.message || err) });
  }
};
