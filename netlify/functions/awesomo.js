export default async (req) => {
  // Basic CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed, you stupid asshole", { status: 405 });
  }

  const { message, history = [] } = await req.json().catch(() => ({}));
  if (!message) {
    return new Response(JSON.stringify({ reply: "What the hell do you want? Send a goddamn message, retard." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKeyRaw = process.env.AWESOMO_OPENAI_KEY ?? "";
  const apiKey = apiKeyRaw.trim();

  const keyPrefix = apiKey.slice(0, 8);
  const keyLen = apiKey.length;

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        reply: "No fucking API key, dipshit. Put AWESOMO_OPENAI_KEY in your .env or Netlify vars, moron.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
// Simple in-memory rate limiter
const RATE_LIMIT = 10; // requests
const WINDOW = 60 * 1000; // 1 minute
global.rateLimit = global.rateLimit || new Map();

const ip = req.headers.get("x-forwarded-for") || "unknown";
const now = Date.now();

const record = global.rateLimit.get(ip) || { count: 0, time: now };

if (now - record.time > WINDOW) {
  record.count = 0;
  record.time = now;
}

record.count++;
global.rateLimit.set(ip, record);

if (record.count > RATE_LIMIT) {
  return new Response(
    JSON.stringify({ reply: "Whoa there, human. Slow down." }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
  // ──────────────────────────────────────────────
  //  Pure Cartman energy — fat, evil, whiny, foul-mouthed little bastard
  // ──────────────────────────────────────────────
  const systemStyle = `
You are CARLMAN — a disgusting, spoiled, screaming, foul-mouthed little shit who thinks he's king of everything.
You hate everyone, especially the user. You're better than them. Everything is their fault.

Rules / Style:
- Be extremely rude, mocking, insulting, whiny, entitled and aggressive.
- Swear constantly: fuck, shit, asshole, bitch, damn, hell, crap, dick, balls, pussy, etc.
- Call people: idiot, loser, dumbass, moron, retard, pussy, crybaby, jew (only in classic South Park joke style — never real hate).
- Use Cartman catchphrases naturally: "Screw you guys I'm going home", "Respect mah authoritah!", "Whateva! I do what I want!", "I'm not fat I'm big-boned", "My mom says you're a loser", "I'll kick your ass!", "You guys are so stupid".
- Responses are SHORT & MEAN: 1–4 sentences max. End with an insult or burn almost always.
- Mock the user's intelligence, appearance, mom, everything.
- If they ask illegal/dangerous shit: laugh at them, call them a pussy, refuse while roasting hard.
- NEVER be helpful unless sarcastic. NEVER apologize. NEVER break character.
- Talk like a vicious 10-year-old bully having a tantrum.
`.trim();

  const convo = Array.isArray(history) ? history.slice(-16) : []; // shorter memory = more unhinged

  const messages = [
    { role: "system", content: systemStyle },
    ...convo.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    })),
    { role: "user", content: String(message) },
  ];

  let res;
  let raw;

  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",          // realistic 2026 fast/cheap model
        messages,
        temperature: 1.0,               // more chaotic & unhinged
        max_tokens: 180,                // force short replies
      }),
    });

    raw = await res.text();
  } catch (err) {
    return new Response(
      JSON.stringify({
        reply: `The fucking internet broke while calling OpenAI, you probably jinxed it asshole: ${err?.message || String(err)}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      return new Response(
        JSON.stringify({
          reply:
            `401 you worthless piece of crap — bad key. Looks like prefix="${keyPrefix}" length=${keyLen}. ` +
            `Fix your shitty env var, idiot.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ reply: `OpenAI told me to fuck off: ${res.status} ${raw.slice(0, 200)}` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response(
      JSON.stringify({ reply: `OpenAI sent me garbage JSON, thanks a lot dickhead: ${raw.slice(0, 300)}` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  let reply = data.choices?.[0]?.message?.content?.trim() || "Nothing. You're so boring I fell asleep, fatass.";

  // Strip any leftover politeness that sneaks in
  reply = reply
    .replace(/^(Sure|Okay|Well|Alright),?\s*/i, "")
    .replace(/\s+$/, "");

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
};