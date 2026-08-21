// ==UserScript==
// @name         Content Rewards — Deep Link Auto-Opener
// @namespace    signal-campaign-matcher
// @version      2.0
// @description  Reads #search=<title> from the URL on contentrewards.com/discover, types it into the search box, waits for filtered results, then clicks ONLY the card whose title BEST matches the search term.
// @match        https://contentrewards.com/discover*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ─── Selectors (adjust if Content Rewards updates their markup) ───────────
  const SEARCH_SELECTOR = 'input[placeholder*="Campaign" i], input[placeholder*="search" i], input[type="search"]';
  const MAX_WAIT_MS = 12000;  // how long to keep polling for the card
  const POLL_MS     = 300;    // polling interval

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function getSearchTerm() {
    const hash = window.location.hash || '';
    const m = hash.match(/#search=(.+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
  }

  function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Score how well card title matches the target term (higher = better) */
  function matchScore(cardTitle, target) {
    const cn = norm(cardTitle);
    const tn = norm(target);
    if (cn === tn) return 100;                             // exact match
    if (cn.startsWith(tn) || tn.startsWith(cn)) return 80;
    // Count how many words of the target appear in the card title
    const tWords = tn.split(' ').filter(w => w.length > 2);
    const hits   = tWords.filter(w => cn.includes(w)).length;
    if (hits === 0) return 0;
    return Math.round((hits / tWords.length) * 60);
  }

  /** React-safe way to set an input value and fire change events */
  function setInputValue(el, value) {
    el.focus();
    const proto  = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    if (el._valueTracker) el._valueTracker.setValue('');
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Simulate a human click */
  function simulateClick(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ['pointerdown','mousedown','mouseup','click'].forEach(type =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
  }

  /** Find the BEST-matching clickable campaign card in the current DOM */
  function findBestCard(term) {
    // Grab all candidate "title" elements — h1‥h4 are most reliable
    const titleEls = Array.from(document.querySelectorAll('h1, h2, h3, h4'));

    let bestEl    = null;
    let bestScore = 0;

    for (const el of titleEls) {
      const text  = (el.textContent || '').trim();
      const score = matchScore(text, term);
      if (score > bestScore) {
        // Walk up to find the closest clickable container
        const clickable =
          el.closest('[class*="cursor-pointer"]') ||
          el.closest('[class*="campaign"]')       ||
          el.closest('article')                   ||
          el.closest('[role="button"]')            ||
          el.closest('a')                          ||
          el;
        bestScore = score;
        bestEl    = clickable;
      }
    }

    // Only accept if score is ≥ 40 (at least 40% of words matched)
    return bestScore >= 40 ? bestEl : null;
  }

  // ─── Core logic ──────────────────────────────────────────────────────────

  let alreadyRan = false;

  function run() {
    const term = getSearchTerm();
    if (!term || alreadyRan) return;

    console.log(`[SIGNAL] Looking for campaign: "${term}"`);

    // Type into search box
    const input = Array.from(document.querySelectorAll(SEARCH_SELECTOR))
                       .find(el => el.offsetParent !== null);
    if (input) {
      setInputValue(input, term);
    } else {
      console.warn('[SIGNAL] Could not find search input — will still try to match cards');
    }

    // Poll until we find the best-matching card
    const start = Date.now();
    const timer = setInterval(() => {
      const card = findBestCard(term);
      if (card) {
        clearInterval(timer);
        alreadyRan = true;
        console.log(`[SIGNAL] ✅ Clicking best match for: "${term}"`, card);
        simulateClick(card);
        return;
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        clearInterval(timer);
        console.warn(`[SIGNAL] ⚠️ Gave up after ${MAX_WAIT_MS}ms — no card with sufficient match found for: "${term}"`);
      }
    }, POLL_MS);
  }

  // Re-run if hash changes (user navigates to a new campaign from your dashboard)
  window.addEventListener('hashchange', () => { alreadyRan = false; run(); });
  window.addEventListener('load', run);

  // Staggered attempts to handle React's async rendering
  setTimeout(run, 800);
  setTimeout(run, 2000);
  setTimeout(run, 4000);
})();
