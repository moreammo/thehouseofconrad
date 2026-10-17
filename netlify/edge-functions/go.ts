import type { Config, Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// Old links are a plain URL. New ones are JSON { destination, name }.
function parseLink(raw: string | null): { destination: string; name: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.destination === "string" && /^https?:/i.test(parsed.destination)) {
        return { destination: parsed.destination, name: typeof parsed.name === "string" ? parsed.name : "" };
      }
    } catch {
      // fall through to plain URL
    }
  }
  if (/^https?:/i.test(trimmed)) return { destination: trimmed, name: "" };
  return null;
}

// thehouseofconrad.com/go/<code> → logs visit + VPN check, serves minimal collector page, then redirects.
export default async (request: Request, context: Context) => {
  const code = decodeURIComponent(new URL(request.url).pathname.slice("/go/".length));
  if (!code) return new Response("Not found", { status: 404 });

  const link = parseLink(await getStore("links").get(code, { type: "text" }));
  if (!link) return new Response("Not found", { status: 404 });
  const destination = link.destination;

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
    name: link.name,
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

  // Minimal HTML: collect standard + high-entropy Client Hints via sendBeacon, then redirect.
  // No canvas/WebGL/audio/font fingerprinting.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title></head>
<body style="font-family:system-ui;text-align:center;padding:2rem;color:#333">
<p>Redirecting…</p>
<script>
(async function(){
  const dest = ${JSON.stringify(destination).replace(/</g, "\\u003c")};
  const visitKey = ${JSON.stringify(visitKey)};
  const gatherIPs = () => new Promise((resolve) => {
    if (!window.RTCPeerConnection) return resolve({ status: "unsupported", addresses: [] });
    let pc, timer, done = false;
    const addresses = [];
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pc) pc.close();
      resolve({ status, addresses });
    };
    timer = setTimeout(() => finish("timeout"), 900);
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pc.onicecandidate = (event) => {
        if (!event.candidate) return finish("complete");
        const c = event.candidate;
        if (!c.address || !["host", "srflx", "prflx"].includes(c.type) ||
            !/^[0-9a-f:.]+$/i.test(c.address)) return;
        if (addresses.length < 16 && !addresses.some((a) => a.address === c.address && a.type === c.type))
          addresses.push({ address: c.address, type: c.type });
      };
      pc.createDataChannel("network-check");
      pc.createOffer().then((offer) => {
        if (!done) return pc.setLocalDescription(offer);
      }).catch(() => finish("error"));
    } catch (e) { finish("error"); }
  });
  const rtcResult = gatherIPs();
  // Redirect deadline also covers a stalled Client Hints request.
  setTimeout(() => window.location.replace(dest), 1200);
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

    // High-entropy Client Hints (model, architecture, bitness, fullVersionList, etc.)
    if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === "function") {
      try {
        const high = await Promise.race([navigator.userAgentData.getHighEntropyValues([
          "architecture", "bitness", "model", "platformVersion", "uaFullVersion", "fullVersionList", "wow64"
        ]), new Promise((resolve) => setTimeout(() => resolve(null), 150))]);
        data.highEntropy = high;
      } catch (e) {}
    }

    data.webRTC = await rtcResult;
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/go-collect", blob);
    } else {
      fetch("/go-collect", { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
  } catch (e) {}
  setTimeout(function(){ window.location.replace(dest); }, 120);
})();
</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config: Config = { path: "/go/*" };
