const CITIES = ["NYC","EWR","TTN","PHIL","DC","BOS","ATL","MIA","NOLA","CHI","MIN","DEN","OKC","DAL","AUS","SATX","HOU","PHX","LV","LAX","SFO","SEA"];

function verdict(row) {
  if (!row) return { code: "NO MKT", kind: "mute" };
  if (row.placed) return { code: "ENTER", kind: "in" };
  const skip = String(row.skip || "");
  if (skip === "already_held") return { code: "HELD", kind: "held" };
  if (skip.startsWith("pop_")) return { code: "POP", kind: "out" };
  if (skip.includes("out_of_band")) return { code: "BAND", kind: "out" };
  if (skip === "metar_wet") return { code: "WET", kind: "wet" };
  if (skip === "no_pop") return { code: "NO POP", kind: "mute" };
  if (skip === "size_under_1") return { code: "SIZE", kind: "mute" };
  if (skip === "KILL") return { code: "KILL", kind: "wet" };
  if (skip.startsWith("order_error")) return { code: "ERROR", kind: "wet" };
  if (skip.startsWith("book_")) return { code: "BOOK", kind: "mute" };
  if (skip) return { code: skip.slice(0, 18).toUpperCase(), kind: "out" };
  return { code: "PASS", kind: "mute" };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function saveGithub(payload) {
  const token = (process.env.SCAN_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (!token) return false;
  const owner = "MrBigJohn5958";
  const repo = "seaotter-dashboard";
  const path = "data/last-scan.json";
  const get = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "seaotter" }
  });
  const sha = get.ok ? ((await get.json()).sha || undefined) : undefined;
  const body = {
    message: `last clock ${payload.clock || ""}`.trim(),
    content: Buffer.from(JSON.stringify(payload, null, 2)).toString("base64"),
    sha
  };
  const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "seaotter", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return put.ok;
}

async function loadGithub() {
  const urls = [
    "https://raw.githubusercontent.com/MrBigJohn5958/seaotter-dashboard/main/data/last-scan.json",
    "https://cdn.jsdelivr.net/gh/MrBigJohn5958/seaotter-dashboard@main/data/last-scan.json"
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST") {
    const token = (process.env.SCAN_TOKEN || process.env.DASHBOARD_SCAN_TOKEN || "").trim();
    const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || auth !== token) {
      res.status(401).json({ ok: false, error: "bad token" });
      return;
    }
    let payload;
    try { payload = await readBody(req); } catch {
      res.status(400).json({ ok: false, error: "bad json" });
      return;
    }
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ ok: false });
      return;
    }
    globalThis.__LAST_SCAN = payload;
    let stored = "memory";
    try { if (await saveGithub(payload)) stored = "github"; } catch {}
    res.status(200).json({ ok: true, stored, cities: (payload.rows || []).length });
    return;
  }

  const scan = globalThis.__LAST_SCAN || await loadGithub();
  if (!scan) {
    res.status(200).json({ live: false, empty: true });
    return;
  }
  const byCity = {};
  for (const row of scan.rows || []) byCity[row.city] = row;
  const cities = CITIES.map((city) => {
    const row = byCity[city];
    const v = verdict(row);
    return {
      city,
      pop: row && row.pop != null ? row.pop : null,
      yes: row && row.yes_mid != null ? row.yes_mid : null,
      no: row && row.no_price != null ? row.no_price : null,
      contracts: row ? row.contracts || 0 : 0,
      cash: row ? row.cash || 0 : 0,
      held: !!(row && row.held),
      skip: row ? row.skip : "no_market",
      placed: !!(row && row.placed),
      verdict: v.code,
      kind: v.kind
    };
  });
  const entered = cities.filter((c) => c.kind === "in").length;
  res.status(200).json({
    live: true,
    clock: scan.clock || null,
    event: scan.event || null,
    equity: scan.equity != null ? scan.equity : null,
    createdAt: scan.created_at || scan.createdAt || null,
    screened: cities.filter((c) => c.skip !== "no_market").length,
    entered,
    cities
  });
};
