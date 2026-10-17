import type { Config, Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// thehouseofconrad.com/go/<code> → logs visit + VPN check, serves minimal collector page, then redirects.
export default async (request: Request, context: Context) => {
  const code = decodeURIComponent(new URL(request.url).pathname.slice("/go/".length));
  if (!code) return new Response("Not found", { status: 404 });

  const destination = await getStore("links").get(code, { type: "text" });
  if (!destination) return new Response("Not found", { status: 404 });

  const geo = context.geo;
  const now = Date.now();
  const visitKey = `${code}/${now}-${crypto.randomUUID()}`;

  // VPN / proxy / hosting lookup via ip-api.com free tier (non-commercial, 45/min)
  let isProxy = false;
  let isHosting = false;
  let isp: string | undefined;
  let ipTimezone: string | undefined;
  try {
    const ip = context.ip;
    if (ip) {
      const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting,isp,timezone`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success") {
          isProxy = !!data.proxy;
          isHosting = !!data.hosting;
          isp = data.isp;
          ipTimezone = data.timezone;
        }
      }
    }
  } catch {
    // fail open — do not block the redirect
  }

  const visit = {
    code,
    timestamp: new Date(now).toISOString(),
    ip: context.ip,
    userAgent: request.headers.get("User-Agent"),
    referrer: request.headers.get("Referer"),
    country: geo.country?.code,
    region: geo.subdivision?.name,
    regionCode: geo.subdivision?.code,
    city: geo.city,
    postalCode: geo.postalCode,
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: geo.timezone,
    isProxy,
    isHosting,
    isp,
    ipTimezone,
  };

  await getStore("visits").setJSON(visitKey, visit);

  // Minimal HTML: collect standard client signals via sendBeacon, then redirect.
  // No canvas/WebGL/audio/font fingerprinting.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title></head>
<body style="font-family:system-ui;text-align:center;padding:2rem;color:#333">
<p>Redirecting…</p>
<script>
(function(){
  const dest = ${JSON.stringify(destination)};
  const visitKey = ${JSON.stringify(visitKey)};
  try {
    const data = {
      visitKey,
      screenWidth: screen.width,
      screenHeight: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
      languages: navigator.languages ? Array.from(navigator.languages) : [],
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
      connectionType: (navigator.connection && navigator.connection.effectiveType) || undefined,
      userAgentData: navigator.userAgentData ? {
        brands: navigator.userAgentData.brands,
        mobile: navigator.userAgentData.mobile,
        platform: navigator.userAgentData.platform
      } : undefined
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/go-collect", blob);
    } else {
      fetch("/go-collect", { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
  } catch (e) {}
  setTimeout(function(){ window.location.replace(dest); }, 80);
})();
</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config: Config = { path: "/go/*" };
