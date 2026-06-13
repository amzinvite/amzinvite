// Document offscreen dédié à la lecture du son d'alerte.
// Le service worker MV3 ne peut pas instancier d'AudioContext ;
// il nous envoie un message { type: "play-sound", kind } qu'on joue ici.

// Deux motifs distincts : un carillon montant pour "sélectionné" (le plus
// important), un simple bip pour "dispo".
const PATTERNS = {
  accepted: [
    { freq: 880, start: 0.0, dur: 0.18 },
    { freq: 1175, start: 0.16, dur: 0.18 },
    { freq: 1568, start: 0.32, dur: 0.30 },
  ],
  available: [
    { freq: 988, start: 0.0, dur: 0.16 },
    { freq: 988, start: 0.22, dur: 0.16 },
  ],
};

function playPattern(kind) {
  const notes = PATTERNS[kind] || PATTERNS.available;
  const ctx = new (self.AudioContext || self.webkitAudioContext)();
  const now = ctx.currentTime;
  let end = 0;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    const t0 = now + note.start;
    const t1 = t0 + note.dur;
    // Petite enveloppe pour éviter les clics.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1);
    end = Math.max(end, t1);
  }
  // Ferme le contexte une fois le motif terminé pour libérer les ressources.
  setTimeout(() => ctx.close().catch(() => {}), (end - now) * 1000 + 200);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "play-sound") {
    try { playPattern(msg.kind); } catch (e) { console.warn("[amzinvite] offscreen audio:", e); }
  }
});
