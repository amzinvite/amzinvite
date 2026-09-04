// stats-content.js — enrichit localement les statistiques publiques PrixTCG.
// L'état de sélection ne quitte jamais chrome.storage.local.

(function () {
  const WIDGET_CLASS = "amzinvite-selection-callout";
  const highlightedAsin = new URLSearchParams(location.search).get("asin")?.toUpperCase() || null;
  let countdownTimer = null;
  let renderQueued = false;

  function productKey(element) {
    const marketplace = String(element.dataset.amzinviteMarketplace || "").toLowerCase();
    const asin = String(element.dataset.amzinviteAsin || "").toUpperCase();
    return marketplace && asin ? `${marketplace}:${asin}` : null;
  }

  function parseDuration(text) {
    const normalized = String(text || "").toLowerCase().replace(/,/g, " ");
    const units = [
      [/(\d+)\s*(?:j(?:our)?s?|days?)/i, 86_400_000],
      [/(\d+)\s*(?:h(?:eure)?s?|hours?)/i, 3_600_000],
      [/(\d+)\s*(?:min(?:ute)?s?)/i, 60_000],
      [/(\d+)\s*(?:s(?:econde)?s?|seconds?)/i, 1_000],
    ];
    const duration = units.reduce((total, [pattern, multiplier]) => {
      const match = normalized.match(pattern);
      return total + (match ? Number(match[1]) * multiplier : 0);
    }, 0);
    return duration > 0 ? duration : null;
  }

  function formatCountdown(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    return days > 0 ? `${days} j ${clock}` : clock;
  }

  function amazonUrl(element) {
    const asin = String(element.dataset.amzinviteAsin || "").toUpperCase();
    const marketplace = String(element.dataset.amzinviteMarketplace || "amazon.fr").toLowerCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || !/^amazon\.(?:fr|com\.be|com)$/.test(marketplace)) return null;
    const statsLink = element.querySelector(`a[href*="/go/amzinvite/${asin}"]`);
    if (statsLink?.href) return statsLink.href;
    if (element.dataset.amzinviteFallback === "true") {
      return `${location.origin}/go/amzinvite/${asin}?source=wave_stats`;
    }
    return `https://www.${marketplace}/dp/${asin}`;
  }

  function asinFromItem(item) {
    const explicit = String(item?.asin || "").toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(explicit)) return explicit;
    const source = typeof item === "string" ? item : item?.url;
    const match = String(source || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return match?.[1]?.toUpperCase() || null;
  }

  function createFallbackProduct({ asin, marketplace, name, imageUrl }) {
    if (document.getElementById("amzinvite-selected-product-fallback")) return null;
    const section = document.querySelector("main section");
    if (!section) return null;
    const product = document.createElement("article");
    product.id = "amzinvite-selected-product-fallback";
    product.dataset.amzinviteAsin = asin;
    product.dataset.amzinviteMarketplace = marketplace;
    product.dataset.amzinviteFallback = "true";
    product.style.cssText = "margin-top:24px;padding:16px;border:1px solid rgba(5,150,105,.35);border-radius:16px;background:#fff";

    const identity = document.createElement("div");
    identity.style.cssText = "display:flex;align-items:center;gap:12px;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827";
    if (imageUrl && /^https:\/\//i.test(imageUrl)) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.style.cssText = "width:64px;height:64px;object-fit:contain;border-radius:10px";
      identity.appendChild(image);
    }
    const label = document.createElement("div");
    label.textContent = name || asin;
    identity.appendChild(label);
    product.appendChild(identity);

    const intro = section.querySelector("h1")?.nextElementSibling;
    if (intro) intro.insertAdjacentElement("afterend", product);
    else section.prepend(product);
    return product;
  }

  function createCallout(element, expiryInfo) {
    const url = amazonUrl(element);
    if (!url || element.querySelector(`.${WIDGET_CLASS}`)) return null;

    const duration = parseDuration(expiryInfo?.text);
    const expiresAt = duration && Number(expiryInfo?.checkedAt)
      ? Number(expiryInfo.checkedAt) + duration
      : null;
    const callout = document.createElement("div");
    callout.className = WIDGET_CLASS;
    callout.setAttribute("role", "status");
    callout.style.cssText = "margin-top:12px;padding:12px 14px;border:1px solid #34d399;border-radius:12px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);box-shadow:0 5px 18px rgba(5,150,105,.12);color:#064e3b;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    callout.innerHTML = `
      <div style="font-weight:800;font-size:14px">🎉 Vous avez été sélectionné !</div>
      <div data-amzinvite-expiry style="margin-top:2px">${expiryInfo?.text ? `Votre invitation expire dans ${expiryInfo.text}.` : "Votre invitation Amazon est prête."}</div>
      <a href="${url}" target="_blank" rel="nofollow sponsored noopener" aria-label="Commander ce produit sélectionné sur Amazon" style="display:inline-flex;margin-top:9px;padding:7px 11px;border-radius:8px;background:#047857;color:#fff;text-decoration:none;font-weight:800">Commander maintenant sur Amazon →</a>
    `;

    const firstCell = element.matches("tr") ? element.querySelector("td") : null;
    (firstCell || element).appendChild(callout);
    if (expiresAt) callout.dataset.amzinviteExpiresAt = String(expiresAt);
    if (
      highlightedAsin === String(element.dataset.amzinviteAsin || "").toUpperCase()
      && element.getClientRects().length > 0
    ) {
      element.style.scrollMarginTop = "96px";
      element.style.boxShadow = "inset 4px 0 #059669";
      window.setTimeout(() => element.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    }
    return callout;
  }

  function renderCountdown(callout) {
    const expiresAt = Number(callout.dataset.amzinviteExpiresAt || 0);
    if (!expiresAt) return;
    const target = callout.querySelector("[data-amzinvite-expiry]");
    if (!target) return;
    const remaining = expiresAt - Date.now();
    target.textContent = remaining > 0
      ? `Votre invitation expire dans ${formatCountdown(remaining)}.`
      : "Le délai estimé est terminé : vérifiez immédiatement sur Amazon.";
  }

  async function renderSelections() {
    const elements = [...document.querySelectorAll("[data-amzinvite-asin][data-amzinvite-marketplace]")];
    const { knownStates, knownExpiry, publicFeed, customUrls, knownImages } = await chrome.storage.local.get([
      "knownStates", "knownExpiry", "publicFeed", "customUrls", "knownImages",
    ]);
    if (highlightedAsin && !elements.some((element) => element.dataset.amzinviteAsin?.toUpperCase() === highlightedAsin)) {
      const acceptedKey = Object.keys(knownStates || {}).find(
        (key) => key.endsWith(`:${highlightedAsin}`) && knownStates[key] === "accepted",
      );
      if (acceptedKey) {
        const marketplace = acceptedKey.slice(0, acceptedKey.indexOf(":"));
        const item = [...(customUrls || []), ...(publicFeed || [])].find(
          (candidate) => asinFromItem(candidate) === highlightedAsin,
        );
        const fallback = createFallbackProduct({
          asin: highlightedAsin,
          marketplace,
          name: item?.name || highlightedAsin,
          imageUrl: knownImages?.[acceptedKey] || item?.image_url || null,
        });
        if (fallback) elements.push(fallback);
      }
    }
    for (const element of elements) {
      const key = productKey(element);
      if (!key || knownStates?.[key] !== "accepted") continue;
      createCallout(element, knownExpiry?.[key]);
    }
    document.querySelectorAll(`.${WIDGET_CLASS}`).forEach(renderCountdown);
  }

  void renderSelections();
  countdownTimer = window.setInterval(() => {
    document.querySelectorAll(`.${WIDGET_CLASS}`).forEach(renderCountdown);
  }, 1_000);
  const observer = new MutationObserver(() => {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => {
      renderQueued = false;
      void renderSelections();
    }, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    if (countdownTimer) window.clearInterval(countdownTimer);
  }, { once: true });
})();
