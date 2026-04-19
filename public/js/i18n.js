/**
 * Fuzion Pilot — i18n module (vanilla JS, no dependencies)
 *
 * Usage:
 *   <span data-i18n="nav.dashboard">Dashboard</span>
 *   <input data-i18n-placeholder="common.search" placeholder="Rechercher...">
 *   In JS: t('toast.saved') → "Sauvegardé !" or "Saved!"
 *
 * Language priority: localStorage.fp_lang > /api/me response > "fr"
 */

(function () {
  'use strict';

  let _lang = 'fr';
  let _strings = {};
  let _fallback = {};
  let _ready = false;
  const _callbacks = [];

  // Detect language
  function detectLang() {
    // 1. localStorage override
    const stored = localStorage.getItem('fp_lang');
    if (stored === 'fr' || stored === 'en') return stored;
    // 2. Will be set after /api/me response via setLang()
    return 'fr';
  }

  // Load a JSON lang file
  async function loadLangFile(lang) {
    try {
      const res = await fetch('/lang/' + lang + '.json', { cache: 'no-cache' });
      if (!res.ok) return {};
      return await res.json();
    } catch (e) {
      console.warn('[i18n] Failed to load ' + lang + '.json:', e);
      return {};
    }
  }

  // Apply translations to DOM
  function applyDOM() {
    // data-i18n → textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = t(key);
      if (val !== key) el.textContent = val;
    });
    // data-i18n-placeholder → placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = t(key);
      if (val !== key) el.placeholder = val;
    });
    // data-i18n-title → title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      var val = t(key);
      if (val !== key) el.title = val;
    });
    // data-i18n-html → innerHTML (for strings with markup)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var val = t(key);
      if (val !== key) el.innerHTML = val;
    });
    // <title> tag
    var titleKey = document.querySelector('title[data-i18n]');
    if (titleKey) {
      var val = t(titleKey.getAttribute('data-i18n'));
      if (val !== titleKey.getAttribute('data-i18n')) document.title = val;
    }
  }

  // Translate function
  function t(key, vars) {
    var val = _strings[key] || _fallback[key] || key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (k) {
        val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return val;
  }

  // Set language and reload strings
  async function setLang(lang) {
    if (lang !== 'fr' && lang !== 'en') lang = 'fr';
    _lang = lang;
    localStorage.setItem('fp_lang', lang);

    // Always load fallback (fr) first, then target
    if (Object.keys(_fallback).length === 0) {
      _fallback = await loadLangFile('fr');
    }
    if (lang === 'fr') {
      _strings = _fallback;
    } else {
      _strings = await loadLangFile(lang);
    }

    applyDOM();
    _ready = true;
    _callbacks.forEach(function (cb) { try { cb(); } catch (e) {} });
    _callbacks.length = 0;
  }

  // Wait for i18n ready
  function onReady(cb) {
    if (_ready) { cb(); return; }
    _callbacks.push(cb);
  }

  // Get current language
  function getLang() { return _lang; }

  // Re-apply DOM (call after dynamic content is rendered)
  function refresh() { applyDOM(); }

  // Init
  async function init() {
    var lang = detectLang();
    await setLang(lang);
  }

  // Expose globally
  window.t = t;
  window.i18n = {
    t: t,
    setLang: setLang,
    getLang: getLang,
    refresh: refresh,
    onReady: onReady,
    init: init
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
