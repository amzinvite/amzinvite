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

  const REQUESTED_PHRASES = [
    "vous avez demandé une invitation",
    "demande d'invitation envoyée",
    "demande envoyée",
    "liste d'attente",
    "file d'attente",
    "vous serez informé",
    "nous vous informerons",
    "nous vérifierons votre compte",
    "votre demande a été",
    "demande enregistrée",
    "demande prise en compte",
    "demande déjà envoyée",
    "invitation demandée, merci",
    "invitation demandée",
    "invitation déjà demandée",
    "l'invitation dépend de plusieurs facteurs",
    "you've requested an invitation",
    "you have requested an invitation",
    "invitation requested",
    "request received",
    "already requested",
    "you've been added to the list",
    "you have been added to the list",
    "added to the waitlist",
    "on the waitlist",
    "we'll let you know",
    "we will let you know",
    "your request has been",
  ];

  const ACCEPTED_PHRASES = [
    "vous avez été sélectionné",
    "vous avez été invité à acheter",
    "vous êtes invité à acheter",
    "votre invitation a été acceptée",
    "invitation acceptée",
    "lien valide pendant 72 heures",
    "you've been invited to buy",
    "you have been invited to buy",
    "you've been selected",
    "you have been selected",
    "your invitation has been accepted",
    "valid for 72 hours",
  ];

  const AVAILABLE_PHRASES = [
    "demander une invitation",
    "request an invitation",
    "request invitation",
  ];

  const REQUEST_BUTTON_SELECTORS = [
    "#requestInvitation",
    "input[name='submit.inviteButton']",
    "[data-feature-name='requestInvitation'] input",
    "[data-feature-name='requestInvitation'] button",
    "[data-action*='invitation' i] input",
    "[data-action*='invitation' i] button",
  ];

  const BUY_BUTTON_SELECTORS = [
    "#add-to-cart-button:not([disabled])",
    "#buy-now-button:not([disabled])",
  ];

  function normalizeText(value) {
    return String(value || "").toLowerCase();
  }

  function includesAny(text, phrases) {
    return phrases.some((phrase) => text.includes(phrase));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.getAttribute?.("aria-hidden") === "true") return false;
    if (el.classList?.contains("aok-hidden")) return false;
    const style = window.getComputedStyle?.(el);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function blockHasContent(el) {
    if (!isVisible(el)) return false;
    const txt = (el.textContent || "").trim();
    if (txt.length > 0) return true;
    return !!el.querySelector?.("input, button, a[role='button']");
  }

  function hasVisibleMatch(root, selectors) {
    if (!root?.querySelectorAll) return false;
    for (const sel of selectors) {
      try {
        const nodes = root.querySelectorAll(sel);
        for (const node of nodes) {
          if (isVisible(node)) return true;
        }
      } catch (_) {
        /* noop */
      }
    }
    return false;
  }

  function detect() {
    const candidates = HDP_STATE_BLOCKS
      .map(({ id, state }) => ({ el: document.getElementById(id), state }))
      .filter(({ el }) => blockHasContent(el));

    for (const { el, state } of candidates) {
      const text = normalizeText(el.textContent);
      if (state === "available" && hasVisibleMatch(el, REQUEST_BUTTON_SELECTORS)) return state;
      if (state === "accepted" && (hasVisibleMatch(el, BUY_BUTTON_SELECTORS) || includesAny(text, ACCEPTED_PHRASES))) return state;
      if (state === "already_requested" && includesAny(text, REQUESTED_PHRASES)) return state;
    }

    const pageText = normalizeText(document.querySelector("#ppd, #centerCol, body")?.textContent);
    if (includesAny(pageText, ACCEPTED_PHRASES)) return "accepted";
    if (includesAny(pageText, REQUESTED_PHRASES)) return "already_requested";
    if (includesAny(pageText, AVAILABLE_PHRASES) || hasVisibleMatch(document, REQUEST_BUTTON_SELECTORS)) {
      return "available";
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
