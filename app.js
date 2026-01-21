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
  countEl.textContent = String(chops);
  toggleBtn.textContent = chopping ? "Stop SuckNit" : "Start chopping";
}

// Fires each time frameA's animation loops (once per chop cycle)
frameA.addEventListener("animationiteration", () => {
  if (!chopping) return;
  chops += 1;
  render();
});

toggleBtn.addEventListener("click", () => {
  chopping = !chopping;
  wrap.classList.toggle("chopping", chopping);
  render();
});

resetBtn.addEventListener("click", () => {
  chops = 0;
  render();
});

render();


// =========================
// AWESOMO 3000 popover chat
// =========================
const popover = document.querySelector("#awesomoPopover");
const form = document.querySelector("#awesomoForm");
const input = document.querySelector("#awesomoInput");
const log = document.querySelector("#awesomoLog");

const awesomoLines = [
  "Beep boop. That question is beneath me.",
  "Processing… nope.",
  "That is not in my database. Also, no.",
  "Beep. Your request has been denied.",
  "I am AWESOMO 3000. I do what I want.",
  "If I knew where Mel Gibson was, I'd be down on my knees licking his balls.",
  "I checked on the internet, Kyle, and getting Butters to put my wiener in his mouth wouldn't make me not gay!",
  "Dear guys, words cannot describe how much I hate you guys.",
  "Eh, you get your bitch ass back in the kitchen and make me some pie",
  "Kyle! YOU JEW BITCH!",
  "I'll make you eat your parents! Nya nya nya nya nyaaaa nya!",
  "I'm not fat, I just haven't grown into my body yet you skinny bitch",
  "Don't call me fat, you fucking Jew!",
  "Kyle's mom's a bitch, she's a big fat bitch!"
];

let greeted = false;

function escapeHtml(str){
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMsg(who, text){
  const p = document.createElement("p");
  p.className = `awesomo-msg ${who}`;
  p.innerHTML = `<strong>${who === "user" ? "You" : "AWESOMO"}</strong>: ${escapeHtml(text)}`;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function getReply(){
  return awesomoLines[Math.floor(Math.random() * awesomoLines.length)];
}

popover?.addEventListener("beforetoggle", (event) => {
  if (event.newState === "open") {
    setTimeout(() => input?.focus(), 0);
    if (!greeted) {
      addMsg("bot", "Beep boop. I am AWESOMO 3000. Ask your question.");
      greeted = true;
    }
  }
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addMsg("user", text);
  input.value = "";
  addMsg("bot", getReply());
});
