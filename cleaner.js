/*
 * NumClean — logique de nettoyage (partagée entre les pages et la popup).
 * Ce fichier ne dépend pas de chrome.* : il se teste aussi avec Node.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,     // interrupteur général
    onCopy: true,      // nettoyer au Ctrl+C / Ctrl+X
    onPaste: true,     // nettoyer au Ctrl+V
    phones: true,      // numéros de téléphone
    accounts: true,    // numéros de compte de facturation (et autres suites de chiffres)
    convertFR: true,   // +33 / 0033 → 0
    inText: false,     // repérer aussi les n° de tél. au milieu d'un texte
    toast: true,       // petite confirmation à l'écran
    disabledSites: []  // sites où l'extension est coupée
  });

  // Une valeur n'est traitée que si elle contient entre MIN_DIGITS et MAX_DIGITS chiffres.
  // (évite de toucher à "12 50", "1 000"…). Ajuste ici si tes n° de compte sont plus courts.
  const MIN_DIGITS = 6;
  const MAX_DIGITS = 20;

  // Caractères invisibles : espaces de largeur nulle, marques de direction, trait d'union conditionnel…
  const INVISIBLE_RE = /[­​-‏‪-‮⁠-⁤﻿]/g;

  // Après normalisation NFKC (qui transforme espaces insécables/fines en espace normal et
  // les chiffres pleine largeur en chiffres ASCII), une valeur ne doit contenir que des
  // chiffres et des séparateurs : espace . - _ / ( ) · • ‐ ‑ ‒ – — ― −
  const TOKEN_RE = /^\+?[0-9 .\-_\/()·‐-―−•‧∙]+$/;

  // Compte de facturation avec lettre(s) : groupes de chiffres, et des lettres seulement dans le
  // dernier groupe, soit 1-2 lettres collées à la fin (« 2648807 02C »), soit 1-2 lettres suivies
  // d'au moins 2 chiffres (« 2648807 C02 »). « 150 000 m2 » ou « 2648807 PV » ne sont pas touchés.
  // Le « / » n'est jamais un séparateur de compte (c'est celui des dates et des listes).
  const ACC_SEP = '[ .\\-_\\u00B7\\u2010-\\u2015\\u2212\\u2022\\u2027\\u2219]+';
  const ALNUM_ACCOUNT_RE = new RegExp(
    '^[0-9]+(?:' + ACC_SEP + '[0-9]+)*(?:[A-Za-z]{1,2}|' + ACC_SEP + '[A-Za-z]{1,2}[0-9]{2,})$'
  );

  // Forme d'un numéro de téléphone national : 0X puis 4 paires, avec un même séparateur partout
  // (« 04 01 02 03 04 », « 04.01.02.03.04 », « 0401020304 »).
  const PHONE_LAYOUT_RE = /^0[1-9]([ .\-_\/·‐-―−•‧∙]?)\d{2}(?:\1\d{2}){3}$/;

  // Puce devant un numéro : « – 04 01 02 03 04 », « • 04 01 02 03 04 »
  const BULLET_RE = /^[\-‐-―−•·*]\s+/;

  // Garde-fous : des chiffres qui ne sont PAS des numéros
  const DATE_RE = /^\d{1,2}([.\-\/])\d{1,2}\1(?:\d{2}|\d{4})$/;                      // 14/10/2026, 14.10.26
  const SPACED_DATE_RE = /^(0?[1-9]|[12]\d|3[01]) (0?[1-9]|1[0-2]) (?:19|20)?\d{2}$/;   // 14 10 2026, 14 10 26
  const ISO_DATE_RE = /^\d{4}([.\-\/])\d{1,2}\1\d{1,2}$/;                           // 2026-10-14
  const SPACED_ISO_RE = /^(19|20)\d{2} (0?[1-9]|1[0-2]) (0?[1-9]|[12]\d|3[01])$/;     // 2026 10 14
  const MONTH_YEAR_RE = /^(0?[1-9]|1[0-2])(?: ?[.\-\/‐-―] ?| )(19|20)\d{2}$/; // 10/2026, 10 2026
  const YEAR_MONTH_RE = /^(19|20)\d{2}(?: ?[.\-\/‐-―] ?| )(0?[1-9]|1[0-2])$/; // 2026-10
  const YEAR_PAIR_RE = /^(19|20)\d{2} *[\-\/‐-―−] *(?:(19|20)\d{2}|\d{2})$/; // 2025-2026, 2025-26
  const DOT_DATE_IN_RE = /(?:^|\D)\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})(?!\d)/;          // 01.10.2026-31.10.2026
  const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;                                       // 192.168.1.10
  const DECIMAL_RE = /^(?:[\d ]*\d\.\d{1,2}|\d{1,4}\.\d+|\d{1,3}(?: \d{3})+\.\d+)$/; // 1234.56, 48.8566, 1 234.567
  const NEGATIVE_RE = /^[\-‐-―−]/;                                   // -123456, –123456
  const LIST_DASH_RE = /\s[\-‐-―−]\s/;                               // « A - B »
  const TWO_PHONES_RE = /^0[1-9]\d{8}0[1-9]\d{8}$/;                                // deux numéros à la suite

  // Numéro de téléphone français au milieu d'un texte (option « inText »)
  const SEP = '[\\s.\\-\\u2010-\\u2015]{0,3}';
  const PHONE_IN_TEXT_RE = new RegExp(
    '(?<![\\d+][\\s.\\-\\/]?)' +
    '(?:(?:\\+|00)\\s*33' + SEP + '(?:\\(0\\)' + SEP + ')?|0)[1-9](?:' + SEP + '\\d{2}){4}' +
    '(?![\\s.\\-\\/]?\\d)',
    'g'
  );

  /**
   * Analyse une valeur isolée. Renvoie { kind: 'phone'|'account', value } si c'est un
   * numéro à traiter (selon les options), sinon null.
   */
  function cleanToken(raw, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    let s = String(raw).replace(INVISIBLE_RE, '').normalize('NFKC').trim();
    if (!s) return null;

    // Puce devant la valeur : acceptée seulement si ce qui suit est un numéro de téléphone
    // (« – 1 234 567 » reste un montant négatif, intact)
    if (BULLET_RE.test(s)) {
      const r = cleanToken(s.replace(BULLET_RE, ''), o);
      return r && r.kind === 'phone' ? r : null;
    }

    // Compte de facturation avec lettre(s) (ex. « 2648807 02C »)
    if (/[A-Za-z]/.test(s)) {
      if (!o.accounts || !ALNUM_ACCOUNT_RE.test(s)) return null;
      const alnum = s.replace(/[^0-9A-Za-z]/g, '');
      const digitCount = alnum.replace(/[A-Za-z]/g, '').length;
      if (digitCount < MIN_DIGITS || alnum.length > MAX_DIGITS) return null;
      return { kind: 'account', value: alnum };
    }

    // Indicatif entre parenthèses : « (+33) 4 01 02 03 04 »
    s = s.replace(/^\(\s*(\+\d{1,3})\s*\)\s*/, '$1 ');

    if (!TOKEN_RE.test(s)) return null;
    if (NEGATIVE_RE.test(s) || DATE_RE.test(s) || SPACED_DATE_RE.test(s) || ISO_DATE_RE.test(s) ||
        SPACED_ISO_RE.test(s) || MONTH_YEAR_RE.test(s) || YEAR_MONTH_RE.test(s) ||
        YEAR_PAIR_RE.test(s) || IP_RE.test(s) || DECIMAL_RE.test(s)) return null;

    const plus = s.charAt(0) === '+';
    // Préfixe « (0) » des numéros internationaux : +33 (0)4 01 02 03 04
    if (plus || s.startsWith('00')) s = s.replace(/\(\s*0\s*\)/g, '');

    const digits = s.replace(/\D/g, '');
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

    let kind, value;
    if (plus) {                                        // +33…, +32…, +44…
      kind = 'phone';
      if (/^330?[1-9]\d{8}$/.test(digits)) {           // +33 4… ou +33 04… (0 en trop)
        const national = digits.slice(digits.length - 9);
        value = o.convertFR ? '0' + national : '+33' + national;
      } else {
        value = '+' + digits;
      }
    } else if (/^00330?[1-9]\d{8}$/.test(digits)) {    // 0033 4… ou 0033 04…
      kind = 'phone';
      const national = digits.slice(digits.length - 9);
      value = o.convertFR ? '0' + national : '0033' + national;
    } else if (/^0[1-9]\d{8}$/.test(digits) &&
               PHONE_LAYOUT_RE.test(s.replace(/[()]/g, '').trim())) { // 0X XX XX XX XX
      kind = 'phone';
      value = digits;
    } else {                                           // tout le reste : n° de compte, référence…
      // Un compte ne contient ni « / », ni parenthèses, ni tiret entouré d'espaces, ni date :
      // ce sont des dates, des listes (« 04… / 06… ») ou des montants négatifs « (1 234) ».
      if (/[\/()]/.test(s) || LIST_DASH_RE.test(s) || DOT_DATE_IN_RE.test(s) ||
          TWO_PHONES_RE.test(digits)) return null;
      kind = 'account';
      value = digits;
    }

    if (kind === 'phone' && !o.phones) return null;
    if (kind === 'account' && !o.accounts) return null;
    return { kind: kind, value: value };
  }

  function result(value, kind) {
    return { text: value, changed: true, items: [value], kinds: [kind] };
  }

  /**
   * Nettoie un texte copié/collé.
   * Renvoie { text, changed, items: [valeurs nettoyées], kinds: ['phone'|'account'] }.
   */
  function cleanText(text, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const none = { text: text, changed: false, items: [], kinds: [] };
    if (typeof text !== 'string' || !text || text.length > 50000) return none;

    // 1) Cas le plus courant : la sélection entière est UN numéro → on renvoie juste le numéro propre.
    //    (Pas si elle contient une tabulation : une cellule vide en tête doit rester en place.)
    if (text.indexOf('\t') === -1) {
      const whole = cleanToken(text, o);
      if (whole) return whole.value === text ? none : result(whole.value, whole.kind);
    }

    // 2) Numéro de téléphone coupé par un retour à la ligne ou une tabulation (copie depuis un PDF) :
    //    « 04 01\n02 03 04 ». On ne recolle que si le tout forme un vrai numéro de téléphone et
    //    qu'un morceau contient lui-même un séparateur (une colonne « 01 / 02 / 03… » reste intacte).
    if (o.phones && /[\t\r\n]/.test(text)) {
      const pieces = text.split(/[\t\r\n]+/).map(function (p) { return p.trim(); }).filter(Boolean);
      if (pieces.length >= 2 && pieces.some(function (p) { return /\d[\s.\-‐-―]+\d/.test(p); })) {
        const joined = cleanToken(pieces.join(' '), o);
        if (joined && joined.kind === 'phone') return result(joined.value, 'phone');
      }
    }

    // 3) Plusieurs lignes / cellules (copie d'une colonne ou d'un tableau).
    //    Pour ne pas abîmer une copie de texte « normal », on ne traite que si toutes les lignes
    //    non vides sont des numéros, ou des lignes de tableau (tabulations) — sauf option inText.
    const parts = text.split(/(\r\n|\r|\n)/);
    const lines = parts.filter(function (p, i) { return i % 2 === 0 && p.trim() !== ''; });
    const isNumber = function (l) { return cleanToken(l, o) !== null; };
    const allNumbers = lines.length > 0 && lines.every(isNumber);
    const pureTable = lines.length > 0 && text.indexOf('\t') !== -1 &&
      lines.every(function (l) { return l.indexOf('\t') !== -1 || isNumber(l); });
    if (!allNumbers && !pureTable && !(o.inText && o.phones)) return none;

    const items = [];
    const kinds = new Set();
    const out = parts.map(function (part, i) {
      if (i % 2 === 1) return part; // saut de ligne conservé tel quel
      return part.split('\t').map(function (cell) {
        if (allNumbers || pureTable) {
          const r = cleanToken(cell, o);
          if (r) {
            if (r.value !== cell) { items.push(r.value); kinds.add(r.kind); }
            return r.value;
          }
        }
        if (o.inText && o.phones) {
          return cell.replace(PHONE_IN_TEXT_RE, function (m) {
            const p = cleanToken(m, o);
            if (p && p.kind === 'phone' && p.value !== m) {
              items.push(p.value); kinds.add('phone');
              return p.value;
            }
            return m;
          });
        }
        return cell;
      }).join('\t');
    }).join('');

    if (out === text) return none;
    return { text: out, changed: true, items: items, kinds: Array.from(kinds) };
  }

  const api = { DEFAULTS: DEFAULTS, cleanText: cleanText, cleanToken: cleanToken };
  root.NumClean = api;
  // Export Node (tests) uniquement : jamais dans une page, pour ne rien écraser chez elle
  if (typeof window === 'undefined' && typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
