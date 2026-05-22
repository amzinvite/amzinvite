// content.js — injecté sur les pages produit Amazon visitées par l'user.
// Détecte l'état d'invitation depuis le DOM réel et :
//   1. Affiche un badge discret en haut à droite
//   2. Reporte l'état au service worker (qui le met en local + peut l'envoyer
//      au backend si le partage anonyme est actif)

(function () {
  const HDP_STATE_BLOCKS = [
    { id: "hdp_invited_desktop", state: "accepted" },
    { id: "hdp_requested_desktop", state: "already_requested" },
    { id: "hdp_notRequested_desktop", state: "available" },
    { id: "hdp_expired_desktop", state: "already_requested" },
    { id: "hdp_consumed_desktop", state: "already_requested" },
  ];

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
    // Fallback : produit pas en mode invitation
    return "not_invitation";
  }

  function canonicalUrl() {
    const m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m) return `${location.origin}/dp/${m[1]}`;
    return location.origin + location.pathname;
  }

  function showBadge(state) {
    const existing = document.getElementById("amzinvite-badge");
    if (existing) existing.remove();
    if (state === "not_invitation") return;
    const colors = {
      available: { bg: "#d97706", txt: "🎟️ Invitation dispo — pas encore demandée" },
      already_requested: { bg: "#1d4ed8", txt: "✓ Tu as déjà demandé cette invitation" },
      accepted: { bg: "#047857", txt: "🎉 Tu es sélectionné — clique pour acheter !" },
    };
    const conf = colors[state];
    if (!conf) return;
    const badge = document.createElement("div");
    badge.id = "amzinvite-badge";
    badge.textContent = conf.txt;
    Object.assign(badge.style, {
      position: "fixed", top: "16px", right: "16px", zIndex: "2147483647",
      background: conf.bg, color: "white", padding: "10px 16px",
      borderRadius: "999px",
      font: "600 13px -apple-system, system-ui, sans-serif",
      boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
      cursor: "pointer", transition: "opacity 0.4s, transform 0.2s",
    });
    badge.title = "Cliquer pour masquer";
    badge.addEventListener("click", () => badge.remove());
    badge.addEventListener("mouseenter", () => { badge.style.transform = "translateY(-1px)"; });
    badge.addEventListener("mouseleave", () => { badge.style.transform = "translateY(0)"; });
    document.body.appendChild(badge);
    // Fade après 8s
    setTimeout(() => {
      if (badge.isConnected) {
        badge.style.opacity = "0";
        setTimeout(() => badge.remove(), 500);
      }
    }, 8000);
  }

  // Attente courte pour laisser Amazon hydrater la buybox
  setTimeout(() => {
    try {
      const state = detect();
      showBadge(state);
      chrome.runtime.sendMessage(
        { type: "report-state", url: canonicalUrl(), state },
        () => { void chrome.runtime.lastError; },
      );
    } catch (e) {
      console.warn("[amzinvite] content detect error", e);
    }
  }, 1500);
})();
