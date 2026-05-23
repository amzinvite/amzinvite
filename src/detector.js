// detector.js — logique de détection de l'état "invitation" sur une page
// produit Amazon. Partagée entre le service worker (fetch background) et
// le content script (lecture du DOM de l'onglet courant).
//
// Trois états retournés :
//   "available"          : bouton "Demander une invitation" présent et actionnable
//   "already_requested"  : Amazon indique que la demande a déjà été envoyée
//   "not_invitation"     : la page n'est pas en mode invitation (achat direct, rupture, etc.)

const REQUESTED_PHRASES = [
  // FR
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
  "lien valide pendant 72 heures",
  // EN
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

// Phrases qui indiquent que l'invitation a été ACCEPTÉE et que le user
// peut désormais acheter (bouton "Ajouter au panier" actif sur un produit
// initialement en invitation).
const ACCEPTED_PHRASES = [
  // FR
  "vous avez été sélectionné",
  "vous avez été invité à acheter",
  "vous êtes invité à acheter",
  "votre invitation a été acceptée",
  "invitation acceptée",
  // EN
  "you've been invited to buy",
  "you have been invited to buy",
  "you've been selected",
  "you have been selected",
  "your invitation has been accepted",
];

const AVAILABLE_PHRASES = [
  "demander une invitation",
  "request an invitation",
  "request invitation",
];

const INVITATION_BUYBOX_SELECTORS = [
  "#requestInvitation",
  "#invitation_buybox",
  "[id*='invitation' i]",
  "[data-feature-name='requestInvitation']",
  "[data-action*='invitation' i]",
];

// Mapping des conteneurs d'état Amazon (format "high demand product").
// Amazon rend TOUS les blocs dans le HTML mais ne remplit QUE celui qui
// correspond à l'état réel ; les autres sont des <div> vides. C'est bien
// plus fiable que matcher du texte (qui inclut aussi les sections
// aok-hidden de chaque bloc).
const HDP_STATE_BLOCKS = [
  { id: "hdp_invited_desktop", state: "accepted" },
  { id: "hdp_requested_desktop", state: "already_requested" },
  { id: "hdp_notRequested_desktop", state: "available" },
  { id: "hdp_expired_desktop", state: "available" },
  { id: "hdp_consumed_desktop", state: "already_requested" },
];

function blockHasContent(el) {
  if (!el) return false;
  if (el.classList?.contains("aok-hidden")) return false;
  // textContent.trim() écarte les blocs Amazon vides (juste des espaces).
  const txt = (el.textContent || "").trim();
  if (txt.length > 0) return true;
  // Fallback : présence d'éléments interactifs (bouton, input).
  return !!el.querySelector?.("input, button, a[role='button']");
}

// Détection HDP depuis du HTML brut (sans DOMParser, indispo dans SW MV3).
// On localise chaque bloc, on trouve son </div> fermant en comptant les
// nesteds, on strip et on mesure. Seuil à 500 chars pour discrimer les
// blocs vides (qui contiennent souvent des micro-placeholders) des actifs
// (plusieurs Ko de buybox).
const HDP_FILLED_MIN_CHARS = 500;

// Trouve l'index du </div> fermant correspondant à un <div ouvert à openTagEnd
// (position juste après le `>` du tag d'ouverture). Compte les nesteds.
// Retourne -1 si introuvable.
function findMatchingDivClose(html, openTagEnd) {
  let depth = 1;
  let pos = openTagEnd;
  const len = html.length;
  while (pos < len && depth > 0) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div", pos);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      pos = nextClose + 5;
      if (depth === 0) return nextClose;
    }
  }
  return -1;
}

function detectHdpStateFromHtml(html) {
  if (!html) return null;
  for (const { id, state } of HDP_STATE_BLOCKS) {
    // Match strict de l'attribut `id` (avec espace devant), pour ne pas
    // matcher data-csa-c-content-id="hdp_X" qui est aussi présent.
    const attrIdx = html.indexOf(` id="${id}"`);
    if (attrIdx === -1) continue;
    const tagEnd = html.indexOf(">", attrIdx);
    if (tagEnd === -1) continue;
    const closeIdx = findMatchingDivClose(html, tagEnd + 1);
    if (closeIdx === -1) continue;
    const inner = html.slice(tagEnd + 1, closeIdx);
    // Strip tags + whitespace pour mesurer le vrai contenu textuel.
    const size = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (size >= HDP_FILLED_MIN_CHARS) return state;
  }
  return null;
}

export function detectInvitationState(rootText, doc, rawHtml) {
  // rootText : texte brut concaténé de la zone buybox (à fournir par l'appelant)
  // doc      : Document ou DocumentFragment (optionnel, dispo côté content script)
  // rawHtml  : HTML brut complet (optionnel, dispo côté service worker)

  // 1) Détection par bloc Amazon hdp_*_desktop — ordre = priorité.
  //    `accepted` prime (signal le plus actionnable), puis `already_requested`,
  //    enfin `available`. Le path DOM est utilisé côté content script,
  //    le path regex côté service worker (pas de DOMParser dispo en SW MV3).
  if (doc) {
    for (const { id, state } of HDP_STATE_BLOCKS) {
      const el = doc.getElementById?.(id);
      if (blockHasContent(el)) return state;
    }
  } else if (rawHtml) {
    const hdpState = detectHdpStateFromHtml(rawHtml);
    if (hdpState) return hdpState;
  }

  // 2) Fallback texte/sélecteurs pour les pages au format historique.
  const txt = (rootText || "").toLowerCase();
  if (REQUESTED_PHRASES.some((p) => txt.includes(p))) {
    return "already_requested";
  }
  if (doc) {
    for (const sel of INVITATION_BUYBOX_SELECTORS) {
      try {
        const el = doc.querySelector(sel);
        if (el) {
          const elText = (el.textContent || "").toLowerCase();
          if (REQUESTED_PHRASES.some((p) => elText.includes(p))) {
            return "already_requested";
          }
          if (el.disabled === true || el.hasAttribute?.("disabled")) {
            return "already_requested";
          }
          return "available";
        }
      } catch (_) {
        /* sélecteur invalide sur ce moteur — on continue */
      }
    }
  }
  if (AVAILABLE_PHRASES.some((p) => txt.includes(p))) {
    return "available";
  }

  // 3) Page produit normale (achat, rupture, précommande sans invitation)
  return "not_invitation";
}

// Helper pour le service worker : extrait le texte de la buybox depuis du HTML brut.
// DOMParser n'est pas disponible dans les SW MV3 (contrairement au commentaire
// précédent qui était erroné). Le caller doit aussi passer le HTML brut à
// detectInvitationState pour bénéficier de la détection regex des blocs hdp.
export function extractBuyboxText(htmlString) {
  if (typeof DOMParser !== "undefined") {
    // Strip <script> avant parse : DOMParser n'exécute pas ces scripts mais
    // Chrome émet quand même une violation CSP par inline script trouvé, sous
    // la CSP de notre extension (`script-src 'self'`). Une page Amazon en
    // contient ~10 → console polluée à chaque cycle de check.
    const sanitized = (htmlString || "").replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
      "",
    );
    const doc = new DOMParser().parseFromString(sanitized, "text/html");
    const ppd =
      doc.querySelector("#ppd") ||
      doc.querySelector("#centerCol") ||
      doc.body;
    return { text: (ppd?.textContent || "").slice(0, 50000), doc, rawHtml: htmlString };
  }
  // Fallback : on lowercase tout le HTML brut pour le match de phrases.
  // 500k chars (au lieu de 80k) pour couvrir les buybox tardives.
  return {
    text: (htmlString || "").slice(0, 500000).toLowerCase(),
    doc: null,
    rawHtml: htmlString,
  };
}
