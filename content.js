/*
 * NumClean — script injecté dans les pages.
 * Intercepte copier / couper / coller et nettoie les numéros (logique dans cleaner.js).
 */
(() => {
  'use strict';
  if (window.__numCleanLoaded) return;
  window.__numCleanLoaded = true;

  const NC = globalThis.NumClean;
  if (!NC) return;

  let settings = Object.assign({}, NC.DEFAULTS);

  // Hôte de l'onglet (même depuis une iframe) pour l'option « actif sur ce site »
  const topHost = (() => {
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
    } catch (_) { /* ignore */ }
    return location.hostname;
  })();

  try {
    chrome.storage.sync.get(NC.DEFAULTS, (s) => {
      if (s) settings = Object.assign({}, NC.DEFAULTS, s);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) {
        settings[k] = 'newValue' in changes[k] ? changes[k].newValue : NC.DEFAULTS[k];
      }
    });
  } catch (_) { /* contexte d'extension invalidé (extension rechargée) */ }

  const isActive = () =>
    settings.enabled && !(settings.disabledSites || []).includes(topHost);

  // Extension désactivée, désinstallée ou rechargée : les onglets déjà ouverts gardent ce script.
  // Dans ce cas on se retire au lieu de continuer à nettoyer.
  function alive() {
    try { if (chrome.runtime && chrome.runtime.id) return true; } catch (_) { /* ignore */ }
    window.removeEventListener('copy', onCopyOrCut, false);
    window.removeEventListener('cut', onCopyOrCut, false);
    window.removeEventListener('paste', onPaste, false);
    return false;
  }

  /* ---------- Utilitaires DOM ---------- */

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  const TEXT_TYPES = new Set(['text', 'search', 'tel', 'url', 'email', 'number']);
  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT_TYPES.has(el.type);
  }
  // Champ où l'on peut écrire : pas en lecture seule ni désactivé
  function isWritable(el) {
    if (!el) return false;
    if (isTextInput(el)) return !el.readOnly && !el.disabled;
    return !!el.isContentEditable;
  }

  function getSelectedText() {
    const el = deepActiveElement();
    if (isTextInput(el)) {
      try {
        const a = el.selectionStart, b = el.selectionEnd;
        if (typeof a === 'number' && typeof b === 'number') return b > a ? el.value.slice(a, b) : '';
      } catch (_) { /* type sans API de sélection */ }
    }
    const sel = window.getSelection();
    return sel ? sel.toString() : '';
  }

  // Modifie la valeur d'un champ en passant par le setter natif (compatible React/Vue)
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function insertText(el, text) {
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) { /* ignore */ }
    if (ok || !isTextInput(el)) return;
    // Repli : on insère nous-mêmes et on prévient la page
    try {
      const a = el.selectionStart, b = el.selectionEnd;
      if (typeof a === 'number') el.setRangeText(text, a, b, 'end');
      else setNativeValue(el, text); // type=number : pas d'API de sélection
    } catch (_) {
      setNativeValue(el, text);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  }

  function deleteSelection(el) {
    let ok = false;
    try { ok = document.execCommand('delete'); } catch (_) { /* ignore */ }
    if (ok || !isTextInput(el)) return;
    try {
      el.setRangeText('', el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteByCut' }));
    } catch (_) { /* ignore */ }
  }

  /* ---------- Confirmation à l'écran ---------- */

  let toastHost = null, toastBox = null, toastTimer = 0;

  function message(r) {
    if (r.items.length > 1) return '✓ ' + r.items.length + ' numéros nettoyés';
    const what = r.kinds[0] === 'phone' ? 'Téléphone' : 'N° de compte';
    const v = r.items[0] || '';
    return '✓ ' + what + ' nettoyé · ' + (v.length > 40 ? v.slice(0, 40) + '…' : v);
  }

  function notify(r) {
    if (!settings.toast || !r.items.length) return;
    const root = document.documentElement;
    // Document entièrement éditable (éditeur de mail en iframe…) : pas de confirmation,
    // pour ne rien glisser dans le contenu enregistré
    if (!root || root.isContentEditable) return;
    try {
      if (!toastHost || !toastHost.isConnected) {
        toastHost = document.createElement('numclean-toast');
        toastHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;pointer-events:none;';
        const shadow = toastHost.attachShadow({ mode: 'closed' });
        toastBox = document.createElement('div');
        Object.assign(toastBox.style, {
          font: '500 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
          color: '#fff',
          background: '#1e3a8a',
          padding: '8px 12px',
          borderRadius: '8px',
          boxShadow: '0 4px 14px rgba(0,0,0,.25)',
          opacity: '0',
          transform: 'translateY(6px)',
          transition: 'opacity .18s ease, transform .18s ease',
          whiteSpace: 'nowrap'
        });
        shadow.appendChild(toastBox);
        // Hors du <body> : jamais dans le contenu d'un éditeur dont le <body> est éditable
        root.appendChild(toastHost);
      }
      toastBox.textContent = message(r);
      requestAnimationFrame(() => {
        toastBox.style.opacity = '1';
        toastBox.style.transform = 'translateY(0)';
      });
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastBox.style.opacity = '0';
        toastBox.style.transform = 'translateY(6px)';
      }, 1600);
    } catch (_) { /* page hostile au DOM : on se passe de la confirmation */ }
  }

  /* ---------- Copier / Couper ---------- */

  function onCopyOrCut(e) {
    if (!alive() || !isActive() || !settings.onCopy) return;
    const dt = e.clipboardData;
    if (!dt) return;

    // Cas 1 : la page a déjà rempli le presse-papiers elle-même (tableurs en ligne,
    // éditeurs riches…). On repasse derrière elle sur le texte brut.
    if (e.defaultPrevented) {
      let txt = '';
      try { txt = dt.getData('text/plain'); } catch (_) { /* ignore */ }
      const r = NC.cleanText(txt, settings);
      if (!r.changed) return;
      try { dt.clearData(); } catch (_) { /* ignore */ }
      dt.setData('text/plain', r.text);
      notify(r);
      return;
    }

    // Cas 2 : copie native de la sélection
    const el = deepActiveElement();
    if (e.type === 'cut' && !isWritable(el)) return;
    const r = NC.cleanText(getSelectedText(), settings);
    if (!r.changed) return;
    dt.setData('text/plain', r.text);
    e.preventDefault();
    if (e.type === 'cut') deleteSelection(el);
    notify(r);
  }

  /* ---------- Coller ---------- */

  function onPaste(e) {
    if (!alive() || !isActive() || !settings.onPaste) return;
    // La page a géré le collage elle-même (masque de saisie, éditeur riche…) : on la laisse faire
    if (e.defaultPrevented) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const el = deepActiveElement();
    if (!isWritable(el)) return;
    // Une copie depuis Excel ou Word ajoute souvent une image : dans un champ texte on garde le
    // texte ; dans un éditeur riche on laisse le collage d'origine (l'image peut y être voulue).
    if (dt.files && dt.files.length && !isTextInput(el)) return;

    let txt = '';
    try { txt = dt.getData('text/plain'); } catch (_) { /* ignore */ }
    const r = NC.cleanText(txt, settings);
    if (!r.changed) return;

    // Éditeurs riches / tableurs en ligne : un collage multi-cellules reste géré par la page
    if (!isTextInput(el)) {
      if (/[\t\r\n]/.test(r.text)) return;
      let ok = false;
      try { ok = document.queryCommandEnabled('insertText'); } catch (_) { /* ignore */ }
      if (!ok) return;
    }

    e.preventDefault();
    insertText(el, r.text);
    notify(r);
  }

  // Écoute en phase de bouillonnement sur window : on passe APRÈS les scripts de la page,
  // qui gardent la main sur leurs propres copier / coller.
  window.addEventListener('copy', onCopyOrCut, false);
  window.addEventListener('cut', onCopyOrCut, false);
  window.addEventListener('paste', onPaste, false);
})();
