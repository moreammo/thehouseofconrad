import type { Config } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// thehouseofconrad.com/go-stats : password-protected dashboard for the /go/ links.
// Login: STATS_USERNAME / STATS_PASSWORD env vars (Netlify site settings).
// If STATS_USERNAME is not set, any username works.

type Visit = {
  code: string;
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
};

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

function device(ua?: string | null) {
  if (!ua) return "Unknown";
  if (/bot|crawl|spider|preview|facebookexternalhit|slack|discord/i.test(ua)) return "Bot / link preview";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "Phone";
  return "Desktop";
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

  // Add / update / delete a link from the form.
  if (request.method === "POST") {
    // Browsers resend Basic auth cross-site, so only accept posts from this page.
    if (request.headers.get("Origin") !== url.origin) return new Response("Bad origin", { status: 403 });
    const form = await request.formData();
    const code = String(form.get("code") ?? "").trim();
    const destination = String(form.get("destination") ?? "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(code)) return new Response("Code: letters, numbers, - and _ only", { status: 400 });
    if (form.get("delete")) {
      await links.delete(code);
    } else {
      try {
        if (!/^https?:$/.test(new URL(destination).protocol)) throw 0;
      } catch {
        return new Response("Destination must be a full http(s) URL", { status: 400 });
      }
      await links.set(code, destination);
    }
    return Response.redirect(`${url.origin}/go-stats`, 303);
  }

  const filter = url.searchParams.get("code") ?? "";

  const { blobs: linkKeys } = await links.list();
  const linkRows = await Promise.all(
    linkKeys.map(async ({ key }) => [key, (await links.get(key, { type: "text" })) ?? ""] as const),
  );

  // ponytail: reads every visit on each page load. Fine into the low thousands;
  // past that, roll visits into daily summary blobs.
  const { blobs: visitKeys } = await visits.list(filter ? { prefix: `${filter}/` } : {});
  const all = (
    await Promise.all(visitKeys.map(({ key }) => visits.get(key, { type: "json" }) as Promise<Visit | null>))
  )
    .filter((v): v is Visit => !!v)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const perCode = new Map(tally(all.map((v) => v.code)));
  const place = (v: Visit) => [v.city, v.regionCode, v.country].filter(Boolean).join(", ") || "Unknown";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });

  const linksTable = linkRows.length
    ? linkRows
        .map(
          ([code, dest]) => `<tr>
            <td><a href="?code=${encodeURIComponent(code)}">${esc(code)}</a></td>
            <td class="dest"><a href="${esc(dest)}" target="_blank" rel="noopener">${esc(dest)}</a></td>
            <td class="n">${filter && filter !== code ? "" : perCode.get(code) ?? 0}</td>
            <td><button type="button" class="copy" data-url="${esc(`${url.origin}/go/${code}`)}">Copy</button></td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No links yet. Add one below.</td></tr>`;

  const recent = all
    .slice(0, 200)
    .map(
      (v) => `<tr>
        <td>${esc(fmt(v.timestamp))}</td>
        <td>${esc(v.code)}</td>
        <td>${esc(place(v))}${v.postalCode ? ` ${esc(v.postalCode)}` : ""}</td>
        <td>${esc(device(v.userAgent))}</td>
        <td>${esc(referrerHost(v.referrer))}</td>
        <td>${esc(v.ip)}</td>
        <td class="ua" title="${esc(v.userAgent)}">${esc(v.userAgent)}</td>
      </tr>`,
    )
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
  .ua{ max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:rgba(255,255,255,.55); font-size:12px; }
  form{ display:flex; flex-wrap:wrap; gap:8px; }
  input{ flex:1 1 200px; padding:10px; border-radius:8px; border:1px solid var(--line); background:#000; color:var(--white); font:inherit; }
  button{ padding:10px 16px; border-radius:8px; border:1px solid var(--neon); background:transparent; color:var(--neon); font:inherit; text-transform:uppercase; cursor:pointer; }
  button.del{ border-color:var(--red); color:var(--red); }
  button.copy{ padding:4px 10px; font-size:12px; }
  .filter{ margin-bottom:12px; }
</style></head>
<body><main class="wrap">
  <h1>Link Stats</h1>
  <p class="sub">thehouseofconrad.com/go/…</p>
  ${filter ? `<p class="filter">Showing <b>${esc(filter)}</b> only. <a href="/go-stats">Show all</a></p>` : ""}

  <div class="kpis">
    <div class="kpi"><b>${all.length}</b><span>Total clicks</span></div>
    <div class="kpi"><b>${last24}</b><span>Last 24 hrs</span></div>
    <div class="kpi"><b>${last7}</b><span>Last 7 days</span></div>
    <div class="kpi"><b>${new Set(all.map((v) => v.ip)).size}</b><span>Unique IPs</span></div>
    <div class="kpi"><b>${linkRows.length}</b><span>Links</span></div>
  </div>

  <section class="card">
    <h2>Links</h2>
    <table><tr><th>Code</th><th>Goes to</th><th class="n">Clicks</th><th></th></tr>${linksTable}</table>
  </section>

  <section class="card">
    <h2>Add or change a link</h2>
    <form method="post">
      <input name="code" placeholder="code (e.g. register)" required pattern="[A-Za-z0-9_-]+">
      <input name="destination" type="url" placeholder="https://full-destination-url">
      <button type="submit">Save</button>
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
    <table>
      <tr><th>When (ET)</th><th>Code</th><th>Location</th><th>Device</th><th>Referrer</th><th>IP</th><th>User agent</th></tr>
      ${recent || `<tr><td colspan="7" class="muted">No clicks yet</td></tr>`}
    </table>
  </section>
</main>
<script>
  document.addEventListener("click", (e) => {
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
