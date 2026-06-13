// Onboarding : activation de l'auto-demande en un clic.
// Page d'extension (CSP script-src 'self') → pas de JS inline, d'où ce fichier.

const btn = document.getElementById("enable-auto");

function markEnabled() {
  btn.textContent = "✓ Auto-demande activée";
  btn.disabled = true;
}

async function init() {
  try {
    const { autoRequest } = await chrome.storage.local.get("autoRequest");
    if (autoRequest) markEnabled();
  } catch (_) {}
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  try {
    // On garde aussi le suivi Pokémon TCG FR actif pour que l'auto-demande
    // ait des produits à surveiller.
    await chrome.storage.local.set({ autoRequest: true, trackPokemonTcgFr: true });
    try { await chrome.runtime.sendMessage({ type: "reschedule-alarm" }); } catch (_) {}
    try { await chrome.runtime.sendMessage({ type: "refresh-public-feed" }); } catch (_) {}
    markEnabled();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "⚡ Activer l'auto-demande";
    console.warn("[amzinvite] activation auto-demande échouée:", e);
  }
});

init();
