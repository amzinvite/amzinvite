// content.js — injecté sur les pages produit Amazon visitées par l'user.
// Détecte l'état d'invitation depuis le DOM réel et :
//   1. Injecte un widget dans la buybox
//   2. Affiche un badge discret en haut à droite (état rare)
//   3. Reporte l'état au service worker

(function () {
  const HDP_STATE_BLOCKS = [
    { id: "hdp_invited_desktop",      state: "accepted" },
    { id: "hdp_requested_desktop",    state: "already_requested" },
    { id: "hdp_notRequested_desktop", state: "available" },
    { id: "hdp_expired_desktop",      state: "available" },
    { id: "hdp_consumed_desktop",     state: "already_requested" },
  ];

  const STATE_UI = {
    available:         { icon: "🎟️", label: "Dispo à demander",      color: "#fff", accent: "#b45309", bg: "linear-gradient(135deg,#d97706,#b45309)" },
    already_requested: { icon: "⏳", label: "Invitation demandée",   color: "#fff", accent: "#1e40af", bg: "linear-gradient(135deg,#2563eb,#1e40af)" },
    accepted:          { icon: "🎉", label: "Sélectionné — 72h !",   color: "#fff", accent: "#065f46", bg: "linear-gradient(135deg,#059669,#047857)" },
  };

  function blockHasContent(el) {
    if (!el || el.classList?.contains("aok-hidden")) return false;
    const txt = (el.textContent || "").trim();
    if (txt.length > 0) return true;
    return !!el.querySelector?.("input, button, a[role='button']");
  }

  function detect() {
    for (const { id, state } of HDP_STATE_BLOCKS) {
      if (blockHasContent(document.getElementById(id))) return state;
    }
    return "not_invitation";
  }

  function canonicalUrl() {
    const m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m) return `${location.origin}/dp/${m[1]}`;
    return location.origin + location.pathname;
  }

  function findInjectTarget() {
    // Cherche le bloc HDP actif pour injecter juste après
    for (const { id } of HDP_STATE_BLOCKS) {
      const el = document.getElementById(id);
      if (el && blockHasContent(el)) return el;
    }
    // Fallback : buybox principal
    return document.getElementById("desktop_buybox_feature_div")
      || document.getElementById("buyBoxInner")
      || document.getElementById("rightCol");
  }

  function injectWidget(state, isTracked, connected) {
    if (document.getElementById("amzinvite-widget")) return;
    const target = findInjectTarget();
    if (!target) return;

    const ui = STATE_UI[state];
    if (!ui) return;

    const notConnectedHtml = connected === false ? `
      <div style="
        margin-top:8px;padding:8px 10px;border-radius:8px;
        background:rgba(0,0,0,0.2);
        font-size:11px;color:rgba(255,255,255,0.9);line-height:1.4;
      ">
        ⚠️ Connecte-toi à Amazon pour que l'extension fonctionne.
        <a href="https://www.amazon.fr/gp/sign-in.html" target="_blank"
           style="color:#fff;font-weight:700;text-decoration:underline;margin-left:4px">
          Se connecter →
        </a>
      </div>` : "";

    const widget = document.createElement("div");
    widget.id = "amzinvite-widget";
    widget.innerHTML = `
      <div style="
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 14px;
        background: ${ui.bg};
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        color: ${ui.color};
      ">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px;flex-shrink:0">${ui.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13.5px">amzinvite · ${ui.label}</div>
            <div style="font-size:11px;opacity:0.85;margin-top:1px" id="amzinvite-widget-sub">
              ${isTracked ? "✓ Suivi" : "Non suivi · clique pour ajouter"}
            </div>
          </div>
          <button id="amzinvite-widget-btn" style="
            appearance:none;
            border:1.5px solid rgba(255,255,255,0.4);
            border-radius:8px;
            background:rgba(255,255,255,0.2);
            color:#fff;
            font:700 12px -apple-system,system-ui,sans-serif;
            padding:6px 12px;
            cursor:pointer;
            white-space:nowrap;
            flex-shrink:0;
            backdrop-filter:blur(4px);
          ">${isTracked ? "Scan" : "+ Suivre"}</button>
        </div>
        ${notConnectedHtml}
      </div>
    `;

    // Injecter après le bloc HDP
    target.insertAdjacentElement("afterend", widget);

    // Handler bouton
    widget.querySelector("#amzinvite-widget-btn").addEventListener("click", async () => {
      const btn = widget.querySelector("#amzinvite-widget-btn");
      const sub = widget.querySelector("#amzinvite-widget-sub");
      const url = canonicalUrl();
      btn.disabled = true;
      btn.textContent = "…";

      if (isTracked) {
        // Scan solo
        btn.textContent = "3s";
        const start = Date.now();
        const timer = setInterval(() => {
          const remaining = Math.max(0, 3000 - (Date.now() - start));
          btn.textContent = `${Math.ceil(remaining / 1000)}s`;
        }, 200);
        await Promise.all([
          new Promise((r) => chrome.runtime.sendMessage({ type: "check-single", url }, r)),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
        clearInterval(timer);
        btn.textContent = "✓";
        sub.textContent = "✓ Scanné";
        setTimeout(() => { btn.disabled = false; btn.textContent = "Scan"; }, 1500);
      } else {
        // Ajouter au suivi
        chrome.runtime.sendMessage({ type: "add-custom-url", url }, (res) => {
          if (res?.ok || res?.added === false) {
            isTracked = true;
            btn.textContent = "Scan";
            btn.disabled = false;
            sub.textContent = "✓ Suivi par amzinvite";
          } else {
            btn.textContent = "Erreur";
            setTimeout(() => { btn.disabled = false; btn.textContent = "+ Suivre"; }, 2000);
          }
        });
      }
    });
  }


  setTimeout(() => {
    try {
      const state = detect();
      const url = canonicalUrl();

      if (state === "not_invitation") return;

      // Vérifie si déjà suivi pour adapter le bouton
      Promise.all([
        new Promise((r) => chrome.runtime.sendMessage({ type: "get-watchlist" }, r)),
        new Promise((r) => chrome.runtime.sendMessage({ type: "check-amazon-auth" }, r)),
      ]).then(([watchRes, authRes]) => {
        const isTracked = (watchRes?.items || []).some((it) => it.url === url);
        const connected = authRes?.connected ?? null;
        injectWidget(state, isTracked, connected);
      });

      chrome.runtime.sendMessage(
        { type: "report-state", url, state },
        () => { void chrome.runtime.lastError; },
      );
    } catch (e) {
      console.warn("[amzinvite] content detect error", e);
    }
  }, 1500);
})();
