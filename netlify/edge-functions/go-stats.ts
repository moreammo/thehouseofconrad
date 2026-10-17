import type { Config } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// thehouseofconrad.com/go-stats : password-protected dashboard for the /go/ links.
// Login: STATS_USERNAME / STATS_PASSWORD env vars (Netlify site settings).
// If STATS_USERNAME is not set, any username works.

type Visit = {
  code: string;
  name?: string;
  timestamp: string;
  ip?: string;
  userAgent?: string | null;
  referrer?: string | null;
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  isProxy?: boolean;
  isHosting?: boolean;
  isp?: string;
  ipTimezone?: string;
  clientTimezone?: string;
  timezoneMismatch?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  availWidth?: number;
  availHeight?: number;
  colorDepth?: number;
  devicePixelRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  languages?: string[];
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  platform?: string;
  connectionType?: string;
  userAgentData?: any;
  highEntropy?: any;
  webRTC?: { status: string; addresses: { address: string; type: string }[] };
};

type Link = { code: string; destination: string; name: string };

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function authorized(request: Request, password: string, username?: string) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    if (username && decoded.slice(0, i) !== username) return false;
    return decoded.slice(i + 1) === password;
  } catch {
    return false;
  }
}

function randomCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => chars[b % chars.length]).join("");
}

function parseLink(code: string, raw: string): Link {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.destination === "string") {
        return {
          code,
          destination: parsed.destination,
          name: typeof parsed.name === "string" ? parsed.name : "",
        };
      }
    } catch {
      // plain URL stored before names existed
    }
  }
  return { code, destination: trimmed, name: "" };
}

function device(ua?: string | null) {
  if (!ua) return "Unknown";
  if (/bot|crawl|spider|preview|facebookexternalhit|slack|discord/i.test(ua)) return "Bot / link preview";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "Phone";
  return "Desktop";
}

function extractModel(ua?: string | null, highEntropy?: any): string {
  if (highEntropy?.model && highEntropy.model !== "") return highEntropy.model;
  if (!ua) return "";
  const android = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\)|;)/i);
  if (android && android[1] && !/Linux|wv|Mobile/i.test(android[1])) return android[1].trim();
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  const model = ua.match(/(SM-[A-Z0-9]+|Pixel [0-9]+|Nexus [0-9]+|OnePlus|Xiaomi|Redmi|POCO|Huawei|Honor)/i);
  if (model) return model[1];
  return "";
}

function referrerHost(ref?: string | null) {
  if (!ref) return "Direct / text / QR";
  try {
    return new URL(ref).hostname;
  } catch {
    return ref;
  }
}

function tally(items: string[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function table(title: string, rows: [string, number][]) {
  const body = rows.length
    ? rows.slice(0, 10).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join("")
    : `<tr><td colspan="2" class="muted">No data yet</td></tr>`;
  return `<section class="card"><h2>${esc(title)}</h2><table>${body}</table></section>`;
}

function badges(v: Visit) {
  const parts: string[] = [];
  if (v.isProxy) parts.push(`<span class="badge vpn">VPN/Proxy</span>`);
  if (v.isHosting) parts.push(`<span class="badge hosting">Hosting</span>`);
  if (v.timezoneMismatch) parts.push(`<span class="badge mismatch">TZ mismatch</span>`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export default async (request: Request) => {
  const password = Netlify.env.get("STATS_PASSWORD");
  if (!password) return new Response("Set STATS_PASSWORD in Netlify environment variables.", { status: 500 });
  if (!authorized(request, password, Netlify.env.get("STATS_USERNAME"))) {
    return new Response("Login required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="go-stats"' },
    });
  }

  const links = getStore("links");
  const visits = getStore("visits");
  const url = new URL(request.url);

  if (request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin) return new Response("Bad origin", { status: 403 });
    const form = await request.formData();
    let code = String(form.get("code") ?? "").trim();
    const destination = String(form.get("destination") ?? "").trim();
    const name = String(form.get("name") ?? "").trim().slice(0, 80);
    if (code && !/^[A-Za-z0-9_-]+$/.test(code)) return new Response("Code: letters, numbers, - and _ only", { status: 400 });
    if (form.get("delete")) {
      if (code) await links.delete(code);
      return Response.redirect(`${url.origin}/go-stats`, 303);
    }
    try {
      if (!/^https?:$/.test(new URL(destination).protocol)) throw 0;
    } catch {
      return new Response("Destination must be a full http(s) URL", { status: 400 });
    }
    while (!code || (!form.get("code") && (await links.get(code)) !== null)) code = randomCode();
    await links.set(code, JSON.stringify({ destination, name }));
    return Response.redirect(`${url.origin}/go-stats?new=${encodeURIComponent(code)}`, 303);
  }

  const filter = url.searchParams.get("code") ?? "";
  const anonOnly = url.searchParams.get("anon") === "1";
  const created = url.searchParams.get("new") ?? "";

  const { blobs: linkKeys } = await links.list();
  const linkRows: Link[] = await Promise.all(
    linkKeys.map(async ({ key }) => parseLink(key, (await links.get(key, { type: "text" })) ?? "")),
  );
  const nameByCode = new Map(linkRows.map((r) => [r.code, r.name]));

  const { blobs: visitKeys } = await visits.list(filter ? { prefix: `${filter}/` } : {});
  let all = (
    await Promise.all(visitKeys.map(({ key }) => visits.get(key, { type: "json" }) as Promise<Visit | null>))
  )
    .filter((v): v is Visit => !!v)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (anonOnly) all = all.filter((v) => v.isProxy || v.isHosting);

  const perCode = new Map(tally(all.map((v) => v.code)));
  const place = (v: Visit) => [v.city, v.regionCode, v.country].filter(Boolean).join(", ") || "Unknown";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "medium" });
  const linkName = (v: Visit) => v.name || nameByCode.get(v.code) || "";

  const linksTable = linkRows.length
    ? linkRows
        .map(
          (row) => `<tr>
            <td>${esc(row.name || "—")}</td>
            <td class="dest"><a href="${esc(`${url.origin}/go/${encodeURIComponent(row.code)}`)}" target="_blank" rel="noopener">${esc(`${url.origin}/go/${encodeURIComponent(row.code)}`)}</a><br><a href="?code=${encodeURIComponent(row.code)}">View stats</a></td>
            <td class="dest"><a href="${esc(row.destination)}" target="_blank" rel="noopener">${esc(row.destination)}</a></td>
            <td class="n">${filter && filter !== row.code ? "" : perCode.get(row.code) ?? 0}</td>
            <td><button type="button" class="copy" data-url="${esc(`${url.origin}/go/${row.code}`)}">Copy</button></td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No links yet. Add one below.</td></tr>`;

  const recent = all
    .slice(0, 200)
    .map((v) => {
      const model = extractModel(v.userAgent, v.highEntropy);
      const deviceLabel = model ? `${device(v.userAgent)} (${model})` : device(v.userAgent);
      const name = linkName(v);
      return `<tr class="row">
        <td>${esc(fmt(v.timestamp))}</td>
        <td>${esc(name || "—")}</td>
        <td>${esc(v.code)}</td>
        <td>${esc(place(v))}${v.postalCode ? ` ${esc(v.postalCode)}` : ""}</td>
        <td>${esc(deviceLabel)}${badges(v)}</td>
        <td>${esc(referrerHost(v.referrer))}</td>
        <td>${esc(v.ip)}</td>
        <td class="more-btn">Details ▸</td>
      </tr>
      <tr class="details" hidden><td colspan="8"><dl>
        <dt>Click time (ET)</dt><dd>${esc(new Date(v.timestamp).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }))}</dd>
        <dt>Link name</dt><dd>${esc(name || "No name")}</dd>
        <dt>Code</dt><dd>${esc(v.code)}</dd>
        <dt>Visitor's local time zone</dt><dd>${esc(v.clientTimezone || v.timezone || "Unknown")}</dd>
        <dt>IP timezone</dt><dd>${esc(v.ipTimezone || v.timezone || "Unknown")}</dd>
        <dt>Timezone mismatch</dt><dd>${v.timezoneMismatch ? "Yes" : "No"}</dd>
        <dt>City</dt><dd>${esc(v.city ?? "Unknown")}</dd>
        <dt>State / region</dt><dd>${esc([v.region, v.regionCode && `(${v.regionCode})`].filter(Boolean).join(" ") || "Unknown")}</dd>
        <dt>ZIP / postal</dt><dd>${esc(v.postalCode ?? "Unknown")}</dd>
        <dt>Country</dt><dd>${esc(v.country ?? "Unknown")}</dd>
        <dt>Lat / long</dt><dd>${v.latitude != null && v.longitude != null ? `<a href="https://www.google.com/maps?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener">${esc(v.latitude)}, ${esc(v.longitude)} (map)</a> <span class="muted">approximate, city level</span>` : "Unknown"}</dd>
        <dt>IP address</dt><dd>${v.ip ? `${esc(v.ip)} <a href="https://ipinfo.io/${encodeURIComponent(v.ip)}" target="_blank" rel="noopener">(look up owner)</a>` : "Unknown"}</dd>
        <dt>WebRTC addresses</dt><dd>${v.webRTC?.addresses?.length ? v.webRTC.addresses.map((a) => esc(a.address) + " (" + esc(a.type) + ")").join(", ") : "None reported"} <span class="muted">Browser-reported; may duplicate the request IP. Private addresses are local to a network.</span></dd>
        <dt>WebRTC check</dt><dd>${esc(v.webRTC?.status || "Not collected")} <span class="muted">Does not establish identity or confirm a VPN leak.</span></dd>
        <dt>ISP</dt><dd>${esc(v.isp ?? "Unknown")}</dd>
        <dt>VPN / Proxy</dt><dd>${v.isProxy ? "Yes" : "No"}</dd>
        <dt>Hosting / Datacenter</dt><dd>${v.isHosting ? "Yes" : "No"}</dd>
        <dt>Device class</dt><dd>${esc(device(v.userAgent))}</dd>
        <dt>Model</dt><dd>${esc(model || "Not available")}</dd>
        <dt>Screen</dt><dd>${v.screenWidth && v.screenHeight ? `${v.screenWidth}×${v.screenHeight}` : "Unknown"} ${v.devicePixelRatio ? `(${v.devicePixelRatio}x)` : ""}</dd>
        <dt>Viewport</dt><dd>${v.viewportWidth && v.viewportHeight ? `${v.viewportWidth}×${v.viewportHeight}` : "Unknown"}</dd>
        <dt>Languages</dt><dd>${esc((v.languages || []).join(", ") || "Unknown")}</dd>
        <dt>Hardware concurrency</dt><dd>${v.hardwareConcurrency ?? "Unknown"}</dd>
        <dt>Device memory</dt><dd>${v.deviceMemory ? `${v.deviceMemory} GB` : "Unknown"}</dd>
        <dt>Touch points</dt><dd>${v.maxTouchPoints ?? "Unknown"}</dd>
        <dt>Platform</dt><dd>${esc(v.platform || "Unknown")}</dd>
        <dt>Connection</dt><dd>${esc(v.connectionType || "Unknown")}</dd>
        <dt>High-entropy model</dt><dd>${esc(v.highEntropy?.model || "Not reported")}</dd>
        <dt>Architecture / bitness</dt><dd>${esc([v.highEntropy?.architecture, v.highEntropy?.bitness].filter(Boolean).join(" / ") || "Unknown")}</dd>
        <dt>Platform version</dt><dd>${esc(v.highEntropy?.platformVersion || "Unknown")}</dd>
        <dt>Referrer</dt><dd>${esc(v.referrer || "None (direct, text message, QR code or app)")}</dd>
        <dt>User agent</dt><dd>${esc(v.userAgent ?? "Unknown")}</dd>
      </dl></td></tr>`;
    })
    .join("");

  const last24 = all.filter((v) => Date.now() - Date.parse(v.timestamp) < 864e5).length;
  const last7 = all.filter((v) => Date.now() - Date.parse(v.timestamp) < 7 * 864e5).length;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link Stats</title>
<link href="https://fonts.googleapis.com/css2?family=Rubik+Wet+Paint&family=Oswald:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#060608; --red:#ff1b1b; --neon:#39ff14; --blue:#4d8bff; --white:#fff; --card:rgba(15,15,20,.92); --line:rgba(255,255,255,.12); }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--white); font-family:"Oswald",system-ui,sans-serif; letter-spacing:.3px; }
  .wrap{ max-width:1200px; margin:0 auto; padding:24px 16px 48px; }
  h1{ font-family:"Rubik Wet Paint",system-ui,sans-serif; color:var(--neon); -webkit-text-stroke:.5px var(--red); font-size:clamp(34px,6vw,60px); margin:0 0 4px; text-align:center; }
  .sub{ text-align:center; color:rgba(255,255,255,.6); margin:0 0 20px; }
  h2{ font-size:16px; text-transform:uppercase; color:var(--red); margin:0 0 10px; }
  a{ color:var(--blue); }
  .kpis{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:12px; }
  .kpi{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; text-align:center; }
  .kpi b{ display:block; font-size:32px; color:var(--neon); }
  .kpi span{ text-transform:uppercase; font-size:13px; color:rgba(255,255,255,.7); }
  .grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-bottom:12px; }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:12px; overflow-x:auto; }
  table{ width:100%; border-collapse:collapse; font-size:14px; }
  td,th{ text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th{ text-transform:uppercase; font-size:12px; color:rgba(255,255,255,.6); font-weight:600; }
  .n{ text-align:right; color:var(--neon); font-weight:600; }
  .muted{ color:rgba(255,255,255,.5); }
  .dest{ max-width:420px; overflow-wrap:anywhere; }
  tr.row{ cursor:pointer; }
  tr.row:hover td{ background:rgba(255,255,255,.04); }
  tr.row.open .more-btn{ color:var(--neon); }
  .more-btn{ color:var(--blue); white-space:nowrap; }
  .details td{ background:rgba(0,0,0,.45); }
  dl{ display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:4px 0; }
  dt{ color:rgba(255,255,255,.6); text-transform:uppercase; font-size:12px; padding-top:2px; }
  dd{ margin:0; overflow-wrap:anywhere; }
  .badge{ display:inline-block; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:600; text-transform:uppercase; }
  .badge.vpn{ background:#ff1b1b; color:#fff; }
  .badge.hosting{ background:#ff9f1b; color:#000; }
  .badge.mismatch{ background:#4d8bff; color:#fff; }
  @media (max-width:600px){ dl{ grid-template-columns:1fr; } dd{ margin-bottom:6px; } }
  form{ display:flex; flex-wrap:wrap; gap:8px; }
  input{ flex:1 1 180px; padding:10px; border-radius:8px; border:1px solid var(--line); background:#000; color:var(--white); font:inherit; }
  button{ padding:10px 16px; border-radius:8px; border:1px solid var(--neon); background:transparent; color:var(--neon); font:inherit; text-transform:uppercase; cursor:pointer; }
  button.del{ border-color:var(--red); color:var(--red); }
  button.copy{ padding:4px 10px; font-size:12px; }
  .filter{ margin-bottom:12px; }
  .new{ border-color:var(--neon); }
  .new p{ margin:0; font-size:18px; overflow-wrap:anywhere; }
  .notice{ font-size:13px; color:rgba(255,255,255,.55); margin:0 0 16px; text-align:center; }
</style></head>
<body><main class="wrap">
  <h1>Link Stats</h1>
  <p class="sub">thehouseofconrad.com/go/…</p>
  <p class="notice">This site logs visit and basic device information (including Client Hints) for link analytics.</p>
  ${created ? `<section class="card new"><h2>Your tracking link is ready</h2><p><a href="${esc(`${url.origin}/go/${encodeURIComponent(created)}`)}" target="_blank" rel="noopener">${esc(`${url.origin}/go/${encodeURIComponent(created)}`)}</a> <button type="button" class="copy" data-url="${esc(`${url.origin}/go/${created}`)}">Copy</button></p></section>` : ""}
  ${filter ? `<p class="filter">Showing <b>${esc(filter)}</b> only. <a href="/go-stats">Show all</a></p>` : ""}
  <p class="filter">${anonOnly ? `<a href="/go-stats">Show all visits</a>` : `<a href="?anon=1">Show VPN / hosting only</a>`}</p>

  <div class="kpis">
    <div class="kpi"><b>${all.length}</b><span>Total clicks</span></div>
    <div class="kpi"><b>${last24}</b><span>Last 24 hrs</span></div>
    <div class="kpi"><b>${last7}</b><span>Last 7 days</span></div>
    <div class="kpi"><b>${new Set(all.map((v) => v.ip)).size}</b><span>Unique IPs</span></div>
    <div class="kpi"><b>${linkRows.length}</b><span>Links</span></div>
  </div>

  <section class="card">
    <h2>Links</h2>
    <table><tr><th>Link name</th><th>Tracking link</th><th>Goes to</th><th class="n">Clicks</th><th></th></tr>${linksTable}</table>
  </section>

  <section class="card">
    <h2>Shorten a link</h2>
    <form method="post">
      <input name="name" placeholder="Link name (optional, e.g. Friday game)" maxlength="80">
      <input name="destination" type="url" placeholder="Paste the long URL here" required>
      <input name="code" placeholder="Custom code (optional, blank = random)" pattern="[A-Za-z0-9_-]+">
      <button type="submit">Shorten</button>
      <button type="submit" name="delete" value="1" class="del" formnovalidate>Delete code</button>
    </form>
  </section>

  <div class="grid">
    ${table("Top locations", tally(all.map(place)))}
    ${table("Devices", tally(all.map((v) => device(v.userAgent))))}
    ${table("Referrers", tally(all.map((v) => referrerHost(v.referrer))))}
  </div>

  <section class="card">
    <h2>Recent clicks${all.length > 200 ? " (latest 200)" : ""}</h2>
    <p class="muted">Click any row for the full record. Click time is Eastern. Link name is the name on the short link.</p>
    <table>
      <tr><th>Click time (ET)</th><th>Link name</th><th>Code</th><th>Location</th><th>Device</th><th>Referrer</th><th>IP</th><th></th></tr>
      ${recent || `<tr><td colspan="8" class="muted">No clicks yet</td></tr>`}
    </table>
  </section>
</main>
<script>
  document.addEventListener("click", (e) => {
    const row = e.target.closest("tr.row");
    if (row && !e.target.closest("a")) {
      row.classList.toggle("open");
      row.nextElementSibling.hidden = !row.classList.contains("open");
      row.querySelector(".more-btn").textContent = row.classList.contains("open") ? "Hide ▾" : "Details ▸";
      return;
    }
    const b = e.target.closest(".copy");
    if (!b) return;
    navigator.clipboard.writeText(b.dataset.url).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
  });
</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config: Config = { path: "/go-stats" };
