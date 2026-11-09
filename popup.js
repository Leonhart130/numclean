/* NumClean — popup de réglages */
(async () => {
  'use strict';
  const NC = globalThis.NumClean;
  const KEYS = ['enabled', 'onCopy', 'onPaste', 'phones', 'accounts', 'convertFR', 'inText', 'toast'];
  const $ = (id) => document.getElementById(id);

  let settings = Object.assign({}, NC.DEFAULTS, await chrome.storage.sync.get(NC.DEFAULTS));

  function save(patch) {
    Object.assign(settings, patch);
    chrome.storage.sync.set(patch);
    refresh();
  }

  // Interrupteurs
  for (const k of KEYS) {
    const cb = $(k);
    cb.checked = !!settings[k];
    cb.addEventListener('change', () => save({ [k]: cb.checked }));
  }

  // Site de l'onglet courant
  let host = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = tab && tab.url ? new URL(tab.url) : null;
    if (u && (u.protocol === 'http:' || u.protocol === 'https:')) host = u.hostname;
  } catch (_) { /* ignore */ }

  const siteCb = $('site');
  if (host) {
    $('host').textContent = host;
    siteCb.checked = !(settings.disabledSites || []).includes(host);
    siteCb.addEventListener('change', () => {
      const set = new Set(settings.disabledSites || []);
      if (siteCb.checked) set.delete(host); else set.add(host);
      save({ disabledSites: Array.from(set) });
    });
  } else {
    $('host').textContent = 'cette page';
    $('siteNote').textContent = 'Les pages internes de Chrome ne sont pas prises en charge';
    $('siteRow').classList.add('na');
    siteCb.checked = false;
    siteCb.disabled = true;
  }

  // Zone de test / nettoyage manuel (utile pour un numéro copié depuis un PDF ou Excel)
  const test = $('test');
  const out = $('result');
  const copyBtn = $('copyResult');
  let lastClean = '';
  function runTest() {
    const v = test.value;
    out.textContent = '';
    out.className = 'result';
    lastClean = '';
    copyBtn.hidden = true;
    if (!v) return;
    const r = NC.cleanText(v, settings);
    if (!r.changed) {
      out.textContent = 'Rien à nettoyer';
      out.className = 'result none';
      return;
    }
    out.className = 'result ok';
    out.textContent = r.text;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = r.items.length > 1 ? r.items.length + ' numéros'
      : (r.kinds[0] === 'phone' ? 'téléphone' : 'n° de compte');
    out.appendChild(kind);
    lastClean = r.text;
    copyBtn.hidden = false;
    copyBtn.textContent = 'Copier le résultat';
  }
  test.addEventListener('input', runTest);

  copyBtn.addEventListener('click', async () => {
    if (!lastClean) return;
    try {
      await navigator.clipboard.writeText(lastClean);
      copyBtn.textContent = 'Copié ✓';
    } catch (_) {
      // Repli : on sélectionne le résultat pour un Ctrl+C manuel
      const range = document.createRange();
      range.selectNodeContents(out.firstChild || out);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copyBtn.textContent = 'Sélectionné, fais Ctrl+C';
    }
  });

  function refresh() {
    document.body.classList.toggle('off', !settings.enabled);
    document.querySelector('.opts').inert = !settings.enabled; // pas modifiable au clavier non plus
    runTest();
  }
  refresh();
})();
