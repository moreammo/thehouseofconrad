interface Env {
  LINKS: KVNamespace;
  VISITS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const code = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!code) return new Response("Not found", { status: 404 });

    const destination = await env.LINKS.get(code);
    if (!destination) return new Response("Not found", { status: 404 });

    const cf = request.cf ?? {};
    const now = Date.now();
    const visit = {
      code,
      timestamp: new Date(now).toISOString(),
      ip: request.headers.get("CF-Connecting-IP"),
      userAgent: request.headers.get("User-Agent"),
      referrer: request.headers.get("Referer"),
      country: cf.country,
      region: cf.region,
      regionCode: cf.regionCode,
      city: cf.city,
      postalCode: cf.postalCode,
      latitude: cf.latitude,
      longitude: cf.longitude,
      timezone: cf.timezone,
      continent: cf.continent,
      colo: cf.colo,
      asn: cf.asn,
      asOrganization: cf.asOrganization,
    };

    // Unique key per visit: KV has no append, and one key can't take >1 write/sec.
    // waitUntil = the redirect goes out without waiting on the write.
    ctx.waitUntil(env.VISITS.put(`${code}:${now}:${crypto.randomUUID()}`, JSON.stringify(visit)));

    return Response.redirect(destination, 302);
  },
};
