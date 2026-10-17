import type { Config, Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// thehouseofconrad.com/go/<code> → 302 to the URL stored in the "links" blob store.
export default async (request: Request, context: Context) => {
  const code = decodeURIComponent(new URL(request.url).pathname.slice("/go/".length));
  if (!code) return new Response("Not found", { status: 404 });

  const destination = await getStore("links").get(code, { type: "text" });
  if (!destination) return new Response("Not found", { status: 404 });

  const geo = context.geo;
  const now = Date.now();
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
  };

  // Unique key per visit so concurrent clicks never overwrite each other.
  await getStore("visits").setJSON(`${code}/${now}-${crypto.randomUUID()}`, visit);

  return Response.redirect(destination, 302);
};

export const config: Config = { path: "/go/*" };
