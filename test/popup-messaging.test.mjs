import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const messaging = source.slice(source.indexOf("async function sendMessage("), source.indexOf("function setVal("));

async function send(runtime, timeoutMs = 8_000) {
  const context = vm.createContext({ chrome: { runtime }, setTimeout, clearTimeout });
  vm.runInContext(messaging, context);
  return context.sendMessage({ type: "get-watchlist" }, timeoutMs);
}

const response = { ok: true, items: [] };
assert.equal(await send({ sendMessage: (_, callback) => callback(response) }), response);
const backendError = { ok: false, error: "feed HTTP 503" };
assert.equal(await send({ sendMessage: (_, callback) => callback(backendError) }), backendError);

let errorRead = false;
const failed = await send({
  get lastError() {
    errorRead = true;
    return { message: "Could not establish connection. Receiving end does not exist." };
  },
  sendMessage: (_, callback) => callback(undefined),
});
assert.equal(errorRead, true);
assert.equal(failed.ok, false);
assert.match(failed.error, /Receiving end does not exist/);
assert.match(failed.error, /chrome:\/\/extensions/);
assert.match((await send({ sendMessage: (_, callback) => callback(undefined) })).error, /aucune réponse/);
assert.match((await send({ sendMessage: () => { throw new Error("Extension context invalidated."); } })).error, /context invalidated/);
assert.match((await send({ sendMessage: () => {} }, 5)).error, /relancé automatiquement/);
console.log("  ✓ popup : erreurs Chrome et réponses absentes diagnostiquées");
