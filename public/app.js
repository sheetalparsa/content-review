const els = {
  reviewerId: document.getElementById("reviewerId"),
  locale: document.getElementById("locale"),
  loginBtn: document.getElementById("loginBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  status: document.getElementById("status"),
  mine: document.getElementById("mine"),
  tickets: document.getElementById("tickets"),
  debug: document.getElementById("debug"),
};

function setDebug(obj) {
  els.debug.textContent = JSON.stringify(obj, null, 2);
}

function getToken() {
  return localStorage.getItem("token");
}

function setToken(token) {
  if (!token) localStorage.removeItem("token");
  else localStorage.setItem("token", token);
}

function authHeaders() {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {}),
      ...authHeaders(),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

function setAuthedUI(authed) {
  els.refreshBtn.disabled = !authed;
  els.logoutBtn.disabled = !authed;
  els.loginBtn.disabled = authed;
  els.reviewerId.disabled = authed;
  els.locale.disabled = authed;
}

async function login() {
  const reviewer_id = els.reviewerId.value.trim();
  const locale = els.locale.value;
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ reviewer_id, locale }),
  });
  setToken(data.token);
  els.status.textContent = `Authenticated as ${data.reviewer.reviewer_id} (${data.reviewer.locale})`;
  setAuthedUI(true);
  await refreshTickets();
  setDebug({ login: data });
}

async function logout() {
  setToken(null);
  els.status.textContent = "Not authenticated";
  els.mine.innerHTML = "";
  els.tickets.innerHTML = "";
  setAuthedUI(false);
  setDebug({ ok: true });
}

function renderTickets(tickets) {
  els.tickets.innerHTML = "";
  if (!tickets.length) {
    els.tickets.innerHTML = `<div class="muted">No available tickets right now.</div>`;
    return;
  }

  for (const t of tickets) {
    const div = document.createElement("div");
    div.className = "ticket";
    div.innerHTML = `
      <div>
        <div class="ticket-title">${t.title} <span class="pill">${t.locale}</span></div>
        <div class="muted">${t.id}</div>
      </div>
      <div style="display:flex; justify-content:flex-end;">
        <button data-id="${t.id}">Reserve</button>
      </div>
    `;
    div.querySelector("button").addEventListener("click", async () => {
      try {
        const reservation = await api(`/tickets/${encodeURIComponent(t.id)}/reserve`, { method: "POST" });
        setDebug({ reserved: reservation });
        const confirmed = confirm(`Reserved ${t.id}. Confirm start processing now?`);
        if (confirmed) {
          const out = await api(`/tickets/${encodeURIComponent(t.id)}/confirm`, { method: "POST" });
          setDebug({ confirmed: out });
        }
        await refreshTickets();
      } catch (e) {
        setDebug({ error: e.message, details: e.body || null });
        await refreshTickets();
      }
    });
    els.tickets.appendChild(div);
  }
}

function renderMine(tickets) {
  els.mine.innerHTML = "";
  if (!tickets.length) {
    els.mine.innerHTML = `<div class="muted">No reserved/in-progress tickets.</div>`;
    return;
  }

  for (const t of tickets) {
    const div = document.createElement("div");
    div.className = "ticket";
    const isReserved = t.status === "RESERVED";
    const expiresInSec = Math.max(0, Math.floor((t.expires_at_ms - Date.now()) / 1000));
    div.innerHTML = `
      <div>
        <div class="ticket-title">${t.title} <span class="pill">${t.status}</span></div>
        <div class="muted">${t.id}</div>
        ${isReserved ? `<div class="muted">expires in ~${expiresInSec}s</div>` : ``}
      </div>
      <div style="display:flex; justify-content:flex-end; gap: 8px;">
        ${isReserved ? `<button data-confirm="${t.id}">Confirm</button>` : ``}
      </div>
    `;
    const btn = div.querySelector("button[data-confirm]");
    if (btn) {
      btn.addEventListener("click", async () => {
        try {
          const out = await api(`/tickets/${encodeURIComponent(t.id)}/confirm`, { method: "POST" });
          setDebug({ confirmed: out });
          await refreshTickets();
        } catch (e) {
          setDebug({ error: e.message, details: e.body || null });
          await refreshTickets();
        }
      });
    }
    els.mine.appendChild(div);
  }
}

async function refreshTickets() {
  const [mine, available] = await Promise.all([api("/tickets/mine"), api("/tickets/available")]);
  renderMine(mine.tickets);
  renderTickets(available.tickets);
}

function bootstrap() {
  const token = getToken();
  setAuthedUI(!!token);
  if (token) {
    els.status.textContent = "Authenticated (token in localStorage)";
    refreshTickets().catch((e) => setDebug({ error: e.message }));
  }

  els.loginBtn.addEventListener("click", () => login().catch((e) => setDebug({ error: e.message, details: e.body || null })));
  els.refreshBtn.addEventListener("click", () => refreshTickets().catch((e) => setDebug({ error: e.message, details: e.body || null })));
  els.logoutBtn.addEventListener("click", () => logout());
}

bootstrap();
