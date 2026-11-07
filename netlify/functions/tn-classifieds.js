// Proxies the TN Gun Owners Firearms Classifieds RSS feed (browser can't fetch it cross-origin).
// ponytail: feed holds the latest 25 topics only; older listings go through the TGO search link on the page.
const FEED = "https://www.tngunowners.com/forums/forum/39-firearms-classifieds.xml/";

export default async () => {
  const r = await fetch(FEED, { headers: { "User-Agent": "Mozilla/5.0 (compatible; thehouseofconrad.com classifieds reader)", Accept: "application/rss+xml, application/xml" } })
    .catch(err => ({ ok: false, status: err.message }));
  if (!r.ok) return new Response(`Feed unavailable: ${r.status}`, { status: 502, headers: { "Cache-Control": "no-store" } });
  return new Response(await r.text(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // 10 min at Netlify's CDN so we hit TGO at most ~6x/hour
      "Cache-Control": "public, max-age=0",
      "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=600",
    },
  });
};

export const config = { path: "/api/tn-classifieds" };
