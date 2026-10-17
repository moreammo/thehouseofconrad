import type { Config } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// Receives non-blocking beacon from the /go/ collector page and merges client signals into the visit blob.
export default async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const body = await request.json();
    const visitKey = body?.visitKey;
    if (!visitKey || typeof visitKey !== "string") return new Response("Bad request", { status: 400 });

    const store = getStore("visits");
    const existing = await store.get(visitKey, { type: "json" }) as any;
    if (!existing) return new Response("Not found", { status: 404 });

    const updated: any = {
      ...existing,
      clientTimezone: body.timezone,
      screenWidth: body.screenWidth,
      screenHeight: body.screenHeight,
      availWidth: body.availWidth,
      availHeight: body.availHeight,
      colorDepth: body.colorDepth,
      devicePixelRatio: body.devicePixelRatio,
      viewportWidth: body.viewportWidth,
      viewportHeight: body.viewportHeight,
      languages: Array.isArray(body.languages) ? body.languages : [],
      hardwareConcurrency: body.hardwareConcurrency,
      deviceMemory: body.deviceMemory,
      maxTouchPoints: body.maxTouchPoints,
      platform: body.platform,
      connectionType: body.connectionType,
      userAgentData: body.userAgentData,
    };

    // Timezone mismatch: client-reported vs IP-derived (or Netlify geo)
    const ipTz = existing.ipTimezone || existing.timezone;
    if (body.timezone && ipTz) {
      updated.timezoneMismatch = body.timezone !== ipTz;
    }

    await store.setJSON(visitKey, updated);
    return new Response(null, { status: 204 });
  } catch {
    return new Response("error", { status: 400 });
  }
};

export const config: Config = { path: "/go-collect" };
