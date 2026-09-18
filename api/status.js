const crypto = require("crypto");

const CITIES = {
  NYC:  { name: "New York City", icao: "KNYC", tz: "America/New_York", lat: 40.7789, lon: -73.9692 },
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
  const raw = (process.env.KALSHI_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  return raw;
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
    if (t.endsWith("-" + k) || t.includes("-" + k + "-") || t.endsWith(k)) return k;
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
  const yy = m[1], mm = months[m[2]], dd = m[3];
  if (!mm) return null;
  return `20${yy}-${mm}-${dd}`;
}

function monthKeyET(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(d || new Date());
  const y = (parts.find((p) => p.type === "year") || {}).value;
  const m = (parts.find((p) => p.type === "month") || {}).value;
  return `${y}-${m}`;
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

async function hourlyPop(city) {
  const meta = CITIES[city];
  if (!meta) return { pop: null, hourly: [] };
  try {
    const pts = await fetch(`https://api.weather.gov/points/${meta.lat.toFixed(4)},${meta.lon.toFixed(4)}`, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" }
    });
    if (!pts.ok) return { pop: null, hourly: [] };
    const props = (await pts.json()).properties || {};
    const hourlyUrl = props.forecastHourly;
    if (!hourlyUrl) return { pop: null, hourly: [] };
    const fc = await fetch(hourlyUrl, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!fc.ok) return { pop: null, hourly: [] };
    const periods = ((await fc.json()).properties || {}).periods || [];
    const hourly = periods.slice(0, 12).map((p) => {
      const v = (p.probabilityOfPrecipitation || {}).value;
      return v == null ? 0 : Number(v);
    });
    const pop = hourly.length ? Math.max(...hourly) : null;
    return { pop, hourly };
  } catch {
    return { pop: null, hourly: [] };
  }
}

async function metar(icao) {
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`, {
      headers: { "User-Agent": UA }
    });
    if (!r.ok) return { wet: false, raw: "", hundredths: 0 };
    const payload = await r.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    let raw = "";
    let best = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      raw = String(row.rawOb || row.raw || raw);
      for (const m of raw.matchAll(/P(\d{4})/g)) best = Math.max(best, parseInt(m[1], 10));
      for (const key of ["pcp1hr", "pcp3hr", "pcp6hr", "precip_in"]) {
        if (row[key] == null) continue;
        const inches = Number(row[key]);
        if (Number.isFinite(inches)) best = Math.max(best, Math.round(inches * 100));
      }
    }
    return { wet: best >= 1, raw, hundredths: best };
  } catch {
    return { wet: false, raw: "", hundredths: 0 };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=8, stale-while-revalidate=30");
  const keyId = (process.env.KALSHI_API_KEY_ID || "").trim();
  const key = pem();
  if (!keyId || !key) {
    res.status(200).json({
      live: false,
      missing: ["KALSHI_API_KEY_ID", "KALSHI_PRIVATE_KEY"],
      hint: "Add both on the Vercel project. PRIVATE_KEY is the PEM text, not a file path."
    });
    return;
  }
  try {
    const [bal, pos] = await Promise.all([
      kalshi("GET", "/portfolio/balance"),
      kalshi("GET", "/portfolio/positions?limit=200&count_filter=position")
    ]);
    let extra = [];
    try {
      const all = await kalshi("GET", "/portfolio/positions?limit=200");
      extra = all.market_positions || all.positions || [];
    } catch {}
    let settlements = [];
    try {
      const s = await kalshi("GET", "/portfolio/settlements?limit=200");
      settlements = s.settlements || [];
    } catch {}
    const cash = bal.balance_dollars != null ? num(bal.balance_dollars) : num(bal.balance) / 100;
    const rows = (pos.market_positions || pos.positions || []).concat(extra);
    const seen = new Set();
    const openRaw = [];
    const monthRows = [];
    for (const p of rows) {
      const ticker = p.ticker || "";
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      if (!String(ticker).toUpperCase().includes("RAIN") && !cityFromTicker(ticker)) continue;
      const contractsRaw = p.position_fp != null ? num(p.position_fp) : num(p.position);
      const city = cityFromTicker(ticker) || "UNK";
      const realized = num(p.realized_pnl_dollars != null ? p.realized_pnl_dollars : p.realized_pnl);
      const fees = num(p.fees_paid_dollars != null ? p.fees_paid_dollars : p.fees_paid);
      const traded = num(p.total_traded_dollars != null ? p.total_traded_dollars : p.total_traded);
      const updated = p.last_updated_ts || p.last_updated || null;
      const date = eventDate(ticker);
      if (contractsRaw) {
        const side = contractsRaw < 0 ? "NO" : "YES";
        const contracts = Math.abs(contractsRaw);
        const exposure = num(p.market_exposure_dollars != null ? p.market_exposure_dollars : p.market_exposure);
        const entry = contracts ? Math.abs(exposure) / contracts : 0;
        openRaw.push({ ticker, city, side, contracts, exposure: Math.abs(exposure), entry });
        if (inThisMonth(date, updated)) {
          monthRows.push({
            city, name: (CITIES[city] || {}).name || city, ticker, date,
            settledAt: updated, side, status: "OPEN",
            realized: null, fees: Number(fees.toFixed(2)), traded: Number((traded || Math.abs(exposure)).toFixed(2))
          });
        }
        continue;
      }
      if ((traded || realized) && inThisMonth(date, updated)) {
        monthRows.push({
          city, name: (CITIES[city] || {}).name || city, ticker, date,
          settledAt: updated, side: "NO", status: "CLOSED",
          realized: Number(realized.toFixed(2)), fees: Number(fees.toFixed(2)), traded: Number(traded.toFixed(2))
        });
      }
    }
    for (const s of settlements) {
      const ticker = s.ticker || s.market_ticker || "";
      if (!String(ticker).toUpperCase().includes("RAIN")) continue;
      const date = eventDate(ticker);
      const updated = s.settled_time || s.updated_ts || null;
      if (!inThisMonth(date, updated)) continue;
      if (monthRows.some((r) => r.ticker === ticker && r.status === "CLOSED")) continue;
      const city = cityFromTicker(ticker) || "UNK";
      monthRows.push({
        city, name: (CITIES[city] || {}).name || city, ticker, date,
        settledAt: updated, side: String(s.side || "NO").toUpperCase(), status: "CLOSED",
        realized: Number(num(s.revenue || s.yes_total_cost || s.no_total_cost || 0).toFixed(2)),
        fees: Number(num(s.fee_cost || 0).toFixed(2)),
        traded: Number(num(s.yes_total_cost || s.no_total_cost || 0).toFixed(2))
      });
    }
    monthRows.sort((a, b) => String(b.date || b.settledAt || "").localeCompare(String(a.date || a.settledAt || "")));

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
        city: row.city,
        name: meta.name || row.city,
        station: meta.icao || "",
        ticker: row.ticker,
        side: row.side,
        entry: Number(row.entry.toFixed(2)),
        mark: Number(mark.toFixed(2)),
        contracts: row.contracts,
        cash: Number(cashUsed.toFixed(2)),
        pop: pop.pop,
        popHourly: pop.hourly,
        metar: wx.wet ? "WET" : "DRY"
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
      weekPnl: null,
      open,
      history: monthRows,
      month: monthKeyET(),
      health: {
        local: null,
        gcp: null,
        feedAgeSec: 8,
        kill: false
      }
    });
  } catch (err) {
    res.status(200).json({ live: false, error: String(err.message || err) });
  }
};
