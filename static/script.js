// static/script.js — unified version (manual typing + filtering + custom items + backspace remove)
// Fixed: filter uses last token for autocomplete so typing the 2nd/3rd item works

const API_URL = window.location.origin;
let problemsData = [];

// ---------- utilities ----------
function id(sel) { return document.getElementById(sel); }
function logv(...args) { console.log("[rzm]", ...args); }

// ---------- contests ----------
let contestsCache = [];
async function loadContests() {
  try {
    const r = await fetch("static/contesty.json");
    const j = await r.json();
    contestsCache = j.map(c => typeof c === "string" ? { id: c, name: c } : (c.id ? c : { id: c, name: c }));
    renderContestList(contestsCache);
  } catch (e) {
    console.error("loadContests:", e);
    id("contest-list").innerHTML = `<div class="p-2 text-red-400">Błąd ładowania kontestów</div>`;
  }
}

function renderContestList(items) {
  const list = id("contest-list");
  list.innerHTML = "";
  items.forEach(c => {
    const div = document.createElement("div");
    div.className = "px-4 py-2 text-gray-200 hover:bg-violet-600 hover:text-white cursor-pointer";
    div.textContent = c.name || c.id;
    div.onclick = async () => {
      id("contest-input").value = c.id || c.name;
      toggleContestList(false);
      await loadProblemsForSelectedContest();
    };
    list.appendChild(div);
  });
}

function filterContests() {
  const q = (id("contest-input").value || "").toLowerCase();
  const filtered = contestsCache.filter(c =>
    (c.name || "").toLowerCase().includes(q) || (c.id || "").toLowerCase().includes(q)
  );
  renderContestList(filtered);
  toggleContestList(true);
}
function toggleContestList(show) {
  id("contest-list").classList.toggle("hidden", !show);
}
document.addEventListener("click", e => {
  if (!e.target.closest("#contest-list") && !e.target.closest("#contest-input")) toggleContestList(false);
});

// ---------- tokens ----------
async function loadTokens() {
  try {
    const r = await fetch("/static/tokeny.json");
    const tokens = await r.json();
    const tbody = id("token-db-body");
    tbody.innerHTML = "";
    if (!tokens || tokens.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="logs-empty">Brak zapisanych tokenów.</td></tr>`;
      return;
    }
    tokens.forEach(entry => {
      const name = Object.keys(entry)[0];
      const token = entry[name];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-2">${name}</td>
        <td class="px-4 py-2" title="${token}">${token.substring(0, 8)}...</td>
        <td class="px-4 py-2" data-token="${token}"><span class="status-text">-</span></td>
        <td class="px-4 py-2">
          <button class="btn-mini bg-sky-500/50" onclick="copyToken('${token}')">Kopiuj</button>
          <button class="btn-mini bg-sky-500/50" onclick="useToken('${token}')">Użyj</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch {
    id("token-db-body").innerHTML =
      `<tr><td colspan="4" class="logs-empty status-fail">Nie udało się załadować bazy tokenów.</td></tr>`;
  }
}

// ---------- dropzone ----------
function setupDropZone() {
  const drop = id("problemy-drop");
  const file = id("problemy-file");
  if (!drop || !file) return;
  ["dragenter", "dragover", "dragleave", "drop"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
  );
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, () => drop.classList.add("drag-over")));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("drag-over")));
  drop.addEventListener("drop", e => readFiles(e.dataTransfer.files));
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", e => readFiles(e.target.files));

  function readFiles(files) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.name.endsWith(".json")) { id("problemy-status").textContent = "Wymagany plik .json"; return; }
    const r = new FileReader();
    r.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        problemsData = parsed;
        id("problemy-status").textContent = `Załadowano ${problemsData.length} problemów z pliku`;
        rebuildProblemDropdowns(problemsData);
      } catch {
        id("problemy-status").textContent = "Błąd: nieprawidłowy JSON";
      }
    };
    r.readAsText(f);
  }
}

// ---------- load problems ----------
async function loadProblemsForSelectedContest() {
  const contest = (id("contest-input")?.value || "").trim();
  if (!contest) { id("problemy-status").textContent = "Najpierw wybierz kontest."; return; }
  try {
    const r = await fetch(`static/problemy/problemy-${contest}.json`);
    if (!r.ok) throw new Error("not found");
    const j = await r.json();
    problemsData = j;
    id("problemy-status").textContent = `Załadowano ${j.length} zadań dla ${contest}`;
    rebuildProblemDropdowns(problemsData);
  } catch {
    id("problemy-status").textContent = `Nie znaleziono pliku dla ${contest}`;
  }
}

// ---------- dropdowns ----------
function rebuildProblemDropdowns(data) {
  if (!Array.isArray(data)) data = [];
  const pairs = [
    { kind: "multi", inputId: "multi-problems-text", listId: "multi-problems-list" },
    { kind: "sybau", inputId: "multi-sybau-problems-text", listId: "multi-sybau-problems-list" }
  ];

  pairs.forEach(({ kind, inputId, listId }) => {
    const input = id(inputId);
    const list = id(listId);
    if (!input || !list) return;

    // header with select/clear
    list.innerHTML = `
      <div class="p-2 border-b border-gray-700 sticky top-0 bg-gray-800">
        <div class="flex gap-2 items-center">
          <button class="select-all-btn" onclick="selectAllVisible('${kind}');event.stopPropagation();">Zaznacz wszystkie</button>
          <button class="select-all-btn" style="background:#374151" onclick="clearSelection('${kind}');event.stopPropagation();">✕ Wyczyść</button>
        </div>
      </div>
    `;

    const container = document.createElement("div");
    container.className = "p-1";

    // populate list rows
    data.forEach(item => {
      const short = (item.short_name || item.short || item.id || "").toString();
      const full  = (item.full_name  || item.full  || "").toString();
      const row   = document.createElement("div");
      row.className = "checkbox-item hover:bg-gray-700 rounded-md";
      row.dataset.short = short.toLowerCase();
      row.dataset.full  = full.toLowerCase();

      const cb = document.createElement("input");
      cb.type  = "checkbox";
      cb.value = short;
      cb.style.marginRight = "0.5rem";

      const lbl = document.createElement("span");
      lbl.textContent = `${short} (${full})`;

      row.append(cb, lbl);

      const toggle = () => {
        row.classList.toggle("selected", cb.checked);
        updateSelectedToInput(kind);
      };
      row.addEventListener("click", e => { if (e.target !== cb) cb.checked = !cb.checked; toggle(); });
      cb.addEventListener("change", toggle);
      container.appendChild(row);
    });

    list.appendChild(container);

    // --- typing & filter: use last token for q so typing 2nd/3rd item works
    input.addEventListener("input", () => {
      const raw = input.value;
      // split tokens and use last token as query
      const tokens = raw.split(",").map(s => s.trim());
      const last = tokens.length ? tokens[tokens.length - 1].toLowerCase() : "";
      const q = last;
    
      container.querySelectorAll(".checkbox-item").forEach(r => {
        const vis = (!q) || r.dataset.short.includes(q) || r.dataset.full.includes(q);
        r.style.display = vis ? "" : "none";
      });
    
      if (raw.endsWith(", ")) {
        addCustomTokensFromInput(kind);
        container.querySelectorAll(".checkbox-item").forEach(r => r.style.display = "");
      }
    
      list.classList.remove("hidden");
    });

    // --- keyboard handling (Enter commits, Backspace removes last tag when input empty)
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        syncTypedProblems(kind);
        list.classList.add("hidden");
      } else if (e.key === "Backspace" && input.value.trim() === "") {
        const sel = container.querySelectorAll(".checkbox-item.selected input[type='checkbox']");
        if (sel.length) {
          const last = sel[sel.length - 1];
          last.checked = false;
          last.closest(".checkbox-item").classList.remove("selected");
          updateSelectedToInput(kind);
          e.preventDefault();
        }
      }
    });

    input.addEventListener("blur", () => {
      // commit typed tokens on blur
      setTimeout(() => syncTypedProblems(kind), 120); // small delay so click on list registers
    });
    input.addEventListener("focus", () => list.classList.remove("hidden"));

    // close dropdown if clicked outside
    document.addEventListener("click", e => {
      if (!e.target.closest(`#${listId}`) && e.target !== input) list.classList.add("hidden");
    });

    feather.replace();
  });

  updateSelectedToInput("multi");
  updateSelectedToInput("sybau");
}

// ---------- add custom ----------
function addCustomTokensFromInput(kind) {
  const inputId = kind === "multi" ? "multi-problems-text" : "multi-sybau-problems-text";
  const listId  = kind === "multi" ? "multi-problems-list"  : "multi-sybau-problems-list";
  const input = id(inputId), list = id(listId);
  if (!input || !list) return;
  const container = list.querySelector(".p-1");
  if (!container) return;

  // tokens typed (split on comma), exclude empty/trailing token
  const rawParts = input.value.split(",").map(s => s.trim()).filter(Boolean);
  if (rawParts.length === 0) return;

  rawParts.forEach(token => {
    const shortLower = token.toLowerCase();
    // find existing row by data-short
    const existing = Array.from(container.querySelectorAll(".checkbox-item")).find(r => r.dataset.short === shortLower);
    if (!existing) {
      // create custom row
      const row = document.createElement("div");
      row.className = "checkbox-item hover:bg-gray-700 rounded-md custom-item selected";
      row.dataset.short = shortLower;
      row.dataset.full = "custom";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = token;
      cb.checked = true;
      cb.style.marginRight = "0.5rem";

      const lbl = document.createElement("span");
      lbl.textContent = `${token} (custom)`;

      row.appendChild(cb);
      row.appendChild(lbl);

      row.addEventListener("click", e => {
        if (e.target !== cb) cb.checked = !cb.checked;
        row.classList.toggle("selected", cb.checked);
        updateSelectedToInput(kind);
      });

      cb.addEventListener("change", () => {
        row.classList.toggle("selected", cb.checked);
        updateSelectedToInput(kind);
      });

      container.appendChild(row);
    } else {
      // ensure it's checked
      const cb = existing.querySelector("input[type='checkbox']");
      if (cb) { cb.checked = true; existing.classList.add("selected"); }
    }
  });

  // after adding/checking, update input value to the selected list + trailing comma+space so user can continue typing
  updateSelectedToInput(kind);
  const checks = Array.from(document.querySelectorAll(`#${listId} input:checked`)).map(cb => cb.value);
  input.value = checks.join(", ") + (checks.length ? ", " : "");
}

// ---------- sync typed ----------
function syncTypedProblems(kind) {
  const listId  = kind === "multi" ? "multi-problems-list"  : "multi-sybau-problems-list";
  const list    = id(listId);
  const inputId = kind === "multi" ? "multi-problems-text" : "multi-sybau-problems-text";
  const input   = id(inputId);
  if (!list || !input) return;
  const container = list.querySelector(".p-1");
  if (!container) return;

  const parts = input.value.split(",").map(p => p.trim()).filter(Boolean);
  const existingShorts = Array.from(container.querySelectorAll(".checkbox-item")).map(r => r.dataset.short);

  // Add any custom entries not already in list
  parts.forEach(p => {
    const short = p.toLowerCase();
    if (!existingShorts.includes(short)) {
      const row = document.createElement("div");
      row.className = "checkbox-item hover:bg-gray-700 rounded-md custom-item selected";
      row.dataset.short = short;
      row.dataset.full = "custom";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = p;
      cb.checked = true;
      cb.style.marginRight = "0.5rem";

      const lbl = document.createElement("span");
      lbl.textContent = `${p} (custom)`;

      row.appendChild(cb);
      row.appendChild(lbl);

      row.addEventListener("click", e => {
        if (e.target !== cb) cb.checked = !cb.checked;
        row.classList.toggle("selected", cb.checked);
        updateSelectedToInput(kind);
      });
      cb.addEventListener("change", () => {
        row.classList.toggle("selected", cb.checked);
        updateSelectedToInput(kind);
      });

      container.appendChild(row);
    }
  });

  // Update checked states based on input tokens
  container.querySelectorAll(".checkbox-item").forEach(r => {
    const cb = r.querySelector("input[type='checkbox']");
    const short = r.dataset.short;
    const shouldCheck = parts.includes(short);
    if (cb) {
      cb.checked = shouldCheck;
      r.classList.toggle("selected", shouldCheck);
    }
  });

  // normalize input to checked list (no trailing comma after blur)
  const checks = Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map(cb => cb.value);
  input.value = checks.join(", ");
}

// ---------- helpers ----------
function selectAllVisible(kind) {
  const listId = kind === "multi" ? "multi-problems-list" : "multi-sybau-problems-list";
  const list = id(listId);
  if (!list) return;
  list.querySelectorAll(".checkbox-item").forEach(r => {
    if (r.style.display !== "none") {
      const cb = r.querySelector("input");
      cb.checked = true;
      r.classList.add("selected");
    }
  });
  updateSelectedToInput(kind);
}

function clearSelection(kind) {
  const listId = kind === "multi" ? "multi-problems-list" : "multi-sybau-problems-list";
  const list = id(listId);
  if (!list) return;
  list.querySelectorAll(".checkbox-item").forEach(r => {
    const cb = r.querySelector("input");
    if (cb) cb.checked = false;
    r.classList.remove("selected");
  });
  updateSelectedToInput(kind);
}

function updateSelectedToInput(kind) {
  const listId = kind === "multi" ? "multi-problems-list" : "multi-sybau-problems-list";
  const inputId = kind === "multi" ? "multi-problems-text" : "multi-sybau-problems-text";
  const checks = Array.from(document.querySelectorAll(`#${listId} input:checked`)).map(cb => cb.value);
  const input = id(inputId);
  if (input) input.value = checks.join(", ");
}

// ---------- submissions ----------
async function getCode(codeId, fileId) {
  const code = id(codeId)?.value || "";
  const fileInput = id(fileId);
  const file = fileInput?.files?.[0];
  if (code) return code;
  if (file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = () => reject(new Error("Błąd odczytu pliku"));
      r.readAsText(file);
    });
  }
  return null;
}

async function performSubmit(endpoint, payload) {
  try {
    const r = await fetch(`${API_URL}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (j.success) alert("✅ Sukces: " + (j.message || ""));
    else alert("❌ Błąd: " + (j.error || j.message || JSON.stringify(j)));
    refreshLogs();
  } catch {
    alert("Błąd komunikacji z serwerem API.");
  }
}

async function multiSubmit() {
  const token = id("token").value.trim();
  const contest = id("contest-input").value.trim();
  const repeat = parseInt(id("multi-repeat").value || "1");
  const concurrency = parseInt(id("multi-concurrency").value || "5");
  const problems = id("multi-problems-text").value.trim();
  if (!token || !contest || !problems) return alert("⚠️ Wypełnij Token, Contest i wybierz zadania.");
  const code = await getCode("multi-code", "multi-file");
  if (!code) return alert("⚠️ Wklej kod lub wybierz plik.");
  performSubmit("multi_submit", { token, contest, problems, code, repeat, concurrency });
}

async function multiSybauSubmit() {
  const token = id("token").value.trim();
  const contest = id("contest-input").value.trim();
  const repeat = parseInt(id("multi-sybau-repeat").value || "1");
  const concurrency = parseInt(id("multi-sybau-concurrency").value || "5");
  const problems = id("multi-sybau-problems-text").value.trim();
  if (!token || !contest || !problems) return alert("⚠️ Wypełnij Token, Contest i wybierz zadania.");
  performSubmit("spam_submit", { token, contest, problems, repeat, concurrency });
}

// ---------- logs ----------
async function refreshLogs() {
  const body = id("logs-body");
  try {
    const r = await fetch(`${API_URL}/get_logs`);
    const logs = await r.json();
    body.innerHTML = "";
    if (!logs?.length) {
      body.innerHTML = `<tr><td colspan="4" class="logs-empty">Brak zakończonych zleceń.</td></tr>`;
      return;
    }
    logs.forEach(l => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-2">${l.timestamp}</td>
        <td class="px-4 py-2">${l.problem} (${l.contest})</td>
        <td class="px-4 py-2 ${l.status === "OK" ? "status-ok" : "status-fail"}">${l.status}</td>
        <td class="px-4 py-2 response-text">${l.response}</td>`;
      body.appendChild(tr);
    });
  } catch {
    body.innerHTML = `<tr><td colspan="4" class="logs-empty status-fail">Nie udało się załadować logów.</td></tr>`;
  }
}

async function clearLogs() {
  try {
    const r = await fetch(`${API_URL}/clear_logs`, { method: "POST" });
    if (r.ok) refreshLogs();
    else alert("Błąd czyszczenia logów");
  } catch {
    alert("Błąd komunikacji z serwerem API.");
  }
}

// ---------- token helpers ----------
function useToken(t) {
  if (id("token")) id("token").value = t;
  checkToken();
}
function copyToken(t) {
  navigator.clipboard.writeText(t)
    .then(() => alert("📋 Token skopiowany"))
    .catch(() => alert("❌ Błąd kopiowania"));
}

// ---------- token check ----------
let _tokenCheck = { controller: null, inProgress: false };
async function checkToken() {
  const token = id("token")?.value.trim();
  const status = id("token-status");
  if (!status) return;

  status.className = "status-message";
  status.textContent = "⏳ Sprawdzanie...";

  if (!token) {
    status.textContent = "⚠️ Wklej token API.";
    status.className = "status-fail";
    return;
  }

  try {
    const resp = await fetch(`${API_URL}/check_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    // Handle both JSON and plain text responses
    let data;
    const text = await resp.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    let username = "";
    let valid = false;

    if (data.valid) {
      valid = true;
      username = data.username || "";
    } else if (data.raw && data.raw.startsWith("pong")) {
      valid = true;
      username = data.raw.replace(/^pong\s*/i, "").trim();
    }

    if (valid) {
      status.textContent = `✅ Token poprawny (${username || "?"})`;
      status.className = "status-ok";
    } else {
      status.textContent = `❌ ${data.error || "Błąd tokena"}`;
      status.className = "status-fail";
    }
  } catch (e) {
    status.textContent = "❌ Błąd komunikacji z API.";
    status.className = "status-fail";
  }
}


// ---------- small UI fixes ----------
const contestInput = id("contest-input");
if (contestInput) {
  contestInput.addEventListener("input", () => {
    filterContests();
    toggleContestList(true);
  });
  contestInput.addEventListener("focus", () => {
    filterContests();
    toggleContestList(true);
  });
}

// Check all tokens (row-level status update)
async function checkAllTokens() {
  const tbody = id("token-db-body");
  const rows = tbody ? tbody.querySelectorAll("[data-token]") : [];
  if (rows.length === 0) {
    alert("Brak tokenów do sprawdzenia.");
    return;
  }

  for (const row of rows) {
    const span = row.querySelector(".status-text");
    const token = row.dataset.token;
    span.innerHTML = '<i data-feather="loader" class="animate-spin"></i>';
    feather.replace();

    try {
      const res = await fetch(`${API_URL}/check_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await res.json();

      if (data.valid) {
        span.innerHTML = '<i data-feather="check-circle" class="text-green-500"></i>';
        row.title = data.username || "OK";
      } else {
        span.innerHTML = '<i data-feather="x-circle" class="text-red-500"></i>';
        row.title = data.error || "Niepoprawny";
      }
    } catch (e) {
      span.innerHTML = '<i data-feather="alert-circle" class="text-red-500"></i>';
      row.title = "Błąd komunikacji";
    }

    feather.replace();
  }
}

// ---------- Gizmo AI Proxy with Markdown rendering ----------
async function Gizmo() {
  const input = id("gizmo-input");
  const resultDiv = id("gizmo-result");
  if (!input || !resultDiv) return;

  let jsonData;
  try {
    jsonData = JSON.parse(input.value);
  } catch {
    resultDiv.innerHTML = "❌ Błąd: nieprawidłowy JSON w polu wejściowym.";
    resultDiv.className = "mt-4 text-sm text-red-400 bg-gray-800 p-3 rounded-md border border-red-700 overflow-auto max-h-60 font-mono";
    return;
  }

  resultDiv.innerHTML = "⏳ Wysyłanie zapytania do Gizmo AI...";
  resultDiv.className = "mt-4 text-sm text-gray-300 bg-gray-800 p-3 rounded-md border border-gray-700 overflow-auto max-h-96 font-mono";

  try {
    const resp = await fetch(`${API_URL}/gizmo_ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonData),
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: false, response: text };
    }

    // Determine what to render
    let content = "";
    if (data.success && data.response && data.response.response) {
      content = data.response.response;
    } else if (data.response) {
      content = JSON.stringify(data.response, null, 2);
    } else {
      content = "❌ Nieoczekiwany format odpowiedzi:\n" + text;
    }

    // Render Markdown
    resultDiv.innerHTML = marked.parse(content);
    hljs.highlightAll();

  } catch (err) {
    resultDiv.innerHTML = "❌ Błąd połączenia: " + err.message;
  }
}


// Called when you click the Send button or press Enter
async function sendMessage() {
  const msg = document.getElementById("msg").value.trim();
  const resultDiv = document.getElementById("gizmo-result");
  if (!msg) return alert("Please type a message.");

  resultDiv.innerHTML = "⏳ Sending message to Gizmo AI...";

  // Automatically build the correct JSON format
  const payload = {
    _tag: "AIChat",
    messages: [{ role: "user", content: msg }]
  };

  try {
    const res = await fetch("/gizmo_ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    // Extract message from response
    let message = "";
    if (typeof data === "object" && data.response) {
      message = data.response.response || JSON.stringify(data.response, null, 2);
    } else {
      message = text;
    }

    // Render Markdown and code highlighting
    // ✅ FIXED
    if (window.marked) {
      resultDiv.innerHTML = marked.parse(message);
    } else {
      console.error("❌ Marked library not loaded properly");
      resultDiv.textContent = message;
    }
    if (window.hljs) hljs.highlightAll();

  } catch (e) {
    resultDiv.textContent = "❌ Error sending message: " + e.message;
  }
}




document.addEventListener("DOMContentLoaded", () => {
  const btn = id("gizmo-send");
  if (btn) btn.addEventListener("click", sendToGizmo);
});


// ---------- init ----------
document.addEventListener("DOMContentLoaded", () => {
  loadContests();
  loadTokens();
  setupDropZone();
  refreshLogs();
});
