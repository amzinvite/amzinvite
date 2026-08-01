(() => {
  function shouldOfferAutoRequest({
    manualCheckHasRun = false,
    autoRequest = false,
    autoRequestPromptHandled = false,
  } = {}) {
    return Boolean(manualCheckHasRun && !autoRequest && !autoRequestPromptHandled);
  }

  globalThis.AmzinvitePopupState = Object.freeze({ shouldOfferAutoRequest });
})();
