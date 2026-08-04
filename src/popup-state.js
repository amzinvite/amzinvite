(() => {
  const PARIS_TIME_ZONE = "Europe/Paris";
  const ESTIMATED_WAVE_SLOTS = Object.freeze([
    { weekday: 1, hour: 22, minute: 0, label: "lundi vers 22 h" },
    { weekday: 5, hour: 10, minute: 0, label: "vendredi vers 10 h" },
  ]);

  function shouldOfferAutoRequest({
    manualCheckHasRun = false,
    autoRequest = false,
    autoRequestPromptHandled = false,
  } = {}) {
    return Boolean(manualCheckHasRun && !autoRequest && !autoRequestPromptHandled);
  }

  function parisParts(date) {
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: PARIS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  }

  function parisDateTimeToEpoch(year, month, day, hour, minute) {
    const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
    const initial = new Date(wallClockUtc);
    const parts = parisParts(initial);
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - wallClockUtc;
    const candidate = wallClockUtc - offset;
    const correctedParts = parisParts(new Date(candidate));
    const correctedOffset = Date.UTC(
      correctedParts.year,
      correctedParts.month - 1,
      correctedParts.day,
      correctedParts.hour,
      correctedParts.minute,
      correctedParts.second,
    ) - candidate;
    return wallClockUtc - correctedOffset;
  }

  function nextEstimatedWave(now = new Date()) {
    const current = parisParts(now);
    const parisDayUtc = Date.UTC(current.year, current.month - 1, current.day);
    const candidates = [];
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const day = new Date(parisDayUtc + dayOffset * 86400000);
      const weekday = day.getUTCDay();
      for (const slot of ESTIMATED_WAVE_SLOTS) {
        if (slot.weekday !== weekday) continue;
        const at = parisDateTimeToEpoch(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          slot.hour,
          slot.minute,
        );
        if (at > now.getTime()) candidates.push({ at, label: slot.label });
      }
    }
    return candidates.sort((a, b) => a.at - b.at)[0] || null;
  }

  function formatWaveCountdown(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days} j ${hours} h ${minutes} min`;
    if (hours > 0) return `${hours} h ${minutes} min`;
    return `${minutes} min`;
  }

  globalThis.AmzinvitePopupState = Object.freeze({
    shouldOfferAutoRequest,
    nextEstimatedWave,
    formatWaveCountdown,
  });
})();
