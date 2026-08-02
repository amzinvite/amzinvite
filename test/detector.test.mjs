import assert from "node:assert/strict";
import { detectInvitationState } from "../src/detector.js";

const padding = "Invitation expirée. ".repeat(40);

function expiredHtml({ requestable }) {
  const requestControl = requestable
    ? '<button>Demander une invitation</button>'
    : '<p>Votre invitation a expiré.</p>';
  const credentials = requestable
    ? '<input id="hdp-ib-csrf-token" value="token"><input id="hdp-ib-ajax-endpoint" value="data.amazon.fr/request">'
    : "";
  return `<html><body>${credentials}<div id="hdp_expired_desktop">${padding}${requestControl}</div></body></html>`;
}

assert.equal(
  detectInvitationState("", null, expiredHtml({ requestable: true })),
  "available",
  "une invitation expirée avec bouton et identifiants Amazon doit pouvoir être redemandée",
);

assert.equal(
  detectInvitationState("", null, expiredHtml({ requestable: false })),
  "already_requested",
  "une invitation expirée sans action possible ne doit pas déclencher l'auto-demande",
);

assert.equal(
  detectInvitationState("", null, `<div id="hdp_expired_desktop">${padding}<button>Demander une invitation</button></div>`),
  "already_requested",
  "le texte du bouton seul ne suffit pas sans identifiants de requête Amazon",
);

console.log("  ✓ invitations expirées : redemande seulement quand elle est réellement actionnable");
