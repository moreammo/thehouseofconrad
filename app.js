// =========================
// Suck-it guy counter (ORIGINAL BEHAVIOR)
// =========================
const wrap = document.querySelector("#chopWrap");
const frameA = document.querySelector("#frameA"); // we count iterations from ONE element
const toggleBtn = document.querySelector("#toggleChop");
const resetBtn = document.querySelector("#resetChop");
const countEl = document.querySelector("#chopCount");

let chopping = true; // auto-start (matches the "chopping" class in HTML)
let chops = 0;

function render() {
  if (!countEl || !toggleBtn) return;
  countEl.textContent = String(chops);
  toggleBtn.textContent = chopping ? "Stop SuckNit" : "Start SuckNit";
}

// Fires each time frameA's animation loops (once per chop cycle)
frameA?.addEventListener("animationiteration", () => {
  if (!chopping) return;
  chops += 1;
  render();
});

toggleBtn?.addEventListener("click", () => {
  chopping = !chopping;
  wrap?.classList.toggle("chopping", chopping);
  render();
});

resetBtn?.addEventListener("click", () => {
  chops = 0;
  render();
});

// Only render if counter elements exist
if (countEl && toggleBtn) render();


// =========================
// AWESOMO 3000 popover chat
// =========================
const popover = document.querySelector("#awesomoPopover");
const form = document.querySelector("#awesomoForm");
const input = document.querySelector("#awesomoInput");
const log = document.querySelector("#awesomoLog");

console.log("AWESOMO init:", { popover, form, input, log });

let greeted = false;

// Keep a lightweight conversation history for better replies
let history = []; // [{ role: "user"|"assistant", content: "..." }]

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMsg(who, text) {
  if (!log) return null;
  const p = document.createElement("p");
  p.className = `awesomo-msg ${who}`;
  p.innerHTML = `<strong>${who === "user" ? "You" : "AWESOMO"}</strong>: ${escapeHtml(text)}`;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
  return p;
}

async function callAwesomo(userText) {
  const res = await fetch("/.netlify/functions/awesomo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: userText, history }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Chat function failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.reply || "Beep boop… I got nothing.";
}

// When popover opens, greet once
popover?.addEventListener("beforetoggle", (event) => {
  if (event.newState === "open") {
    setTimeout(() => input?.focus(), 0);
    if (!greeted) {
      addMsg("bot", "Beep boop. I am AWESOMO 3000. Ask your question.");
      greeted = true;
    }
  }
});

// Single submit handler
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = input?.value?.trim();
  if (!text) return;

  addMsg("user", text);
  history.push({ role: "user", content: text });

  input.value = "";

  const typingNode = addMsg("bot", "Beep boop… thinking.");

  try {
    const reply = await callAwesomo(text);

    if (typingNode) typingNode.remove();
    addMsg("bot", reply);

    history.push({ role: "assistant", content: reply });

    // cap history so it doesn’t grow forever
    if (history.length > 24) history = history.slice(-24);
  } catch (err) {
    if (typingNode) typingNode.remove();
    addMsg("bot", "Beep boop… my brain module is down. Try again.");
    console.error(err);
  }
});