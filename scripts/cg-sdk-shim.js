// CrazyGames adapter. INJECTED AT BUILD TIME by scripts/make-crazygames-zip.mjs into the
// staged copy — index.html on the branch is never touched, so this branch's game file stays
// byte-identical to the itch one and re-syncing after an itch change is a fast-forward rather
// than a merge. That is the whole reason this is a separate file and not an edit.
//
// It runs BEFORE the game, which is possible because the build re-tags the game's single
// inline <script> as `type="text/cg-deferred"` (inert) and this injects it for real once the
// SDK has initialised. Safe to do because the game registers no DOMContentLoaded/load handler
// and never reads document.currentScript — checked, both are absent from all 35k lines.
//
// Two CrazyGames requirements are implemented here and nothing else:
//   1. saving   — https://docs.crazygames.com/sdk/data/
//   2. muting   — https://docs.crazygames.com/sdk/game/#game-settings
(function () {
  'use strict';

  var SDK = window.CrazyGames && window.CrazyGames.SDK;

  // ---- 1. saving ------------------------------------------------------------------
  // The SDK's data module mirrors the localStorage interface EXACTLY and synchronously
  // (getItem / setItem / removeItem / clear), which is the fact that makes this a drop-in:
  // `localStorage` itself is what changes under the game, so all 23 of its storage call
  // sites — eleven `mycelium.*` keys plus the two mute flags — are left untouched. Patching
  // 23 sites with a regex at build time was the alternative and it is the fragile one: a
  // missed site is a save that silently stops syncing, which nobody notices until a player
  // loses a campaign.
  //
  // Defining the property on `window` shadows the prototype getter. If that is ever refused
  // the game keeps its own localStorage and simply does not sync across devices — a
  // degradation, not a break, which is the right failure for a storage wrapper.
  function installStore(data) {
    var shim = {
      getItem: function (k) { try { return data.getItem(String(k)); } catch (e) { return null; } },
      setItem: function (k, v) { try { data.setItem(String(k), String(v)); } catch (e) {} },
      removeItem: function (k) { try { data.removeItem(String(k)); } catch (e) {} },
      clear: function () { try { data.clear(); } catch (e) {} },
      // The data module exposes no enumeration and the game never enumerates — it reads
      // eleven known keys by name. Stubs rather than a lie about what is stored.
      key: function () { return null; },
      length: 0,
    };
    try {
      Object.defineProperty(window, 'localStorage', { value: shim, configurable: true, writable: true });
      return window.localStorage === shim;
    } catch (e) { return false; }
  }

  // ---- 2. muting ------------------------------------------------------------------
  // "This setting should take priority over your in-game audio settings" — so CrazyGames'
  // mute wins while it is on, and the player's own choice has to survive it. The game has
  // two independent mute flags (music and SFX, persisted as `mycMuted` / `mycSfxMuted`) and
  // exposes only TOGGLES, so setting a state means toggling when it differs.
  //
  // THE PERSISTED VALUE IS PUT BACK AFTERWARDS, and that is the whole subtlety: toggleMusic
  // writes the new state to storage, so honouring a CrazyGames mute would otherwise overwrite
  // the player's own preference — and unmuting on CrazyGames later would leave them muted for
  // good, in a save that now syncs across their devices.
  function setMuted(want) {
    var a = window.__cgAudio;
    if (!a) return;
    [['music', 'mycMuted', a.isMusicMuted, a.toggleMusic],
     ['sfx', 'mycSfxMuted', a.isSfxMuted, a.toggleSfx]].forEach(function (row) {
      var key = row[1], is = row[2], toggle = row[3];
      try {
        if (!!is() === !!want) return;
        var keep = window.localStorage.getItem(key);
        toggle();
        if (keep === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, keep);
      } catch (e) {}
    });
  }

  function applySettings() {
    try {
      var s = SDK && SDK.game && SDK.game.settings;
      if (s && s.muteAudio) setMuted(true);
      else if (s) restorePlayerChoice();
    } catch (e) {}
  }

  // Coming OFF a CrazyGames mute hands control back to whatever the player themselves chose,
  // which is exactly what the preserved storage value is for.
  function restorePlayerChoice() {
    var a = window.__cgAudio;
    if (!a) return;
    try {
      setMutedTo(a.isMusicMuted, a.toggleMusic, window.localStorage.getItem('mycMuted') === '1', 'mycMuted');
      setMutedTo(a.isSfxMuted, a.toggleSfx, window.localStorage.getItem('mycSfxMuted') === '1', 'mycSfxMuted');
    } catch (e) {}
  }

  function setMutedTo(is, toggle, want, key) {
    if (!!is() === !!want) return;
    var keep = window.localStorage.getItem(key);
    toggle();
    if (keep === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, keep);
  }

  // ---- boot -----------------------------------------------------------------------
  // The deferred game script is injected exactly once, whatever the SDK does — including
  // when it is absent altogether (opened locally, or served anywhere but CrazyGames). A
  // storage wrapper that can strand the player on a blank page is worse than no wrapper.
  //
  // AND IT WAITS FOR THE PARSER, which is the trap here: this shim is itself a <script> in
  // <head> and the deferred game tag is the NEXT element, so at the moment a resolved promise
  // calls back, `getElementById('cgGame')` is still null — the parser has not reached it. The
  // first version latched `started` before looking, so a fast init (a warm SDK, or anything
  // mocked) permanently disabled the game and left a page that boots to nothing. Caught by
  // tests/crazygames-check.cjs against the built zip, which is the only place it exists.
  var started = false;
  function runGame() {
    if (started) return;
    var held = document.getElementById('cgGame');
    if (!held) {
      // Not parsed yet — come back when it is. If the document is already finished and the tag
      // still is not there, there is nothing to run and retrying forever would not help.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runGame, { once: true });
      return;
    }
    started = true;
    var s = document.createElement('script');
    s.text = held.textContent;
    held.parentNode.removeChild(held);       // 1.5 MB of text with no further use
    document.head.appendChild(s);
    applySettings();                          // the game's audio state exists from here on
  }

  if (!SDK || typeof SDK.init !== 'function') { runGame(); return; }

  var storeOk = false;
  // A hung init must not hold the game hostage — CrazyGames' own advice is to init during
  // the loading screen, and a game that never starts is the one failure they will notice.
  var bail = setTimeout(runGame, 8000);
  Promise.resolve()
    .then(function () { return SDK.init(); })
    .then(function () {
      if (SDK.data) storeOk = installStore(SDK.data);
      try { SDK.game.addSettingsChangeListener(applySettings); } catch (e) {}
    })
    .catch(function (e) { try { console.warn('CrazyGames SDK init failed, running with local storage:', e); } catch (_) {} })
    .then(function () {
      clearTimeout(bail);
      window.__cgReady = { sdk: !!SDK, store: storeOk };
      runGame();
    });
})();
