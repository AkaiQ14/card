// public/security.js — Silent gate (no spinner/overlay).
// Real enforcement is on the server. This only re-checks quietly and
// shows a minimal "Forbidden" page if something slips through.

(() => {
  'use strict';

  // Add ?debug to the URL to see console logs.
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const endpoints = [
    { url: 'https://api.ipify.org?format=json', parse: d => d.ip },
    { url: 'https://ipv4.icanhazip.com',        parse: t => t },
    { url: 'https://v4.ident.me',               parse: t => t },
  ];

  function dbg(...args) { if (DEBUG) console.log('[security]', ...args); }

  async function fetchWithTimeout(url, ms = 5000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    } finally { clearTimeout(to); }
  }

  function extractIPv4(result, parseFn) {
    try {
      let value = parseFn ? parseFn(result) : result;
      value = (typeof value === 'string' ? value : String(value || '')).trim().replace(/\s+/g, '');
      return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? value : '';
    } catch { return ''; }
  }

  async function detectPublicIPv4() {
    for (const ep of endpoints) {
      try {
        const raw = await fetchWithTimeout(ep.url, 5000);
        const ip = extractIPv4(raw, ep.parse);
        if (ip) return ip;
      } catch (e) { dbg('endpoint failed:', ep.url, e?.message || e); }
    }
    return '';
  }

  async function verify(ipv4) {
    try {
      const r = await fetch('/api/security/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ ipv4 }),
      });
      if (!r.ok) return { allowed: false, reason: 'تعذر الاتصال بالخادم.' };
      return r.json();
    } catch { return { allowed: false, reason: 'تعذر الاتصال بالخادم.' }; }
  }

  function showDenied(reason) {
    document.documentElement.innerHTML = `
      <!doctype html><meta charset="utf-8">
      <title>Forbidden</title>
      <style>
        html,body{height:100%;margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Cairo',sans-serif;background:#111827;color:#fff}
        .wrap{display:flex;align-items:center;justify-content:center;height:100%}
        .card{background:rgba(0,0,0,.5);border-radius:12px;padding:28px;text-align:center;max-width:560px}
        h1{margin:0 0 8px;font-size:22px}
      </style>
      <div class="wrap"><div class="card">
        <div style="font-size:56px;margin-bottom:14px">🚫</div>
        <h1>غير مصرح لك بالوصول</h1>
        <p>${reason || 'هذا المحتوى متاح فقط لعناوين IP محددة.'}</p>
      </div></div>`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const ip = await detectPublicIPv4();
      dbg('detected IPv4:', ip || '(none)');
      const verdict = await verify(ip);
      dbg('server allowed:', !!verdict.allowed, 'serverSeenIP:', verdict.serverSeenIP || '-');

      if (!verdict.allowed) showDenied(verdict.reason);
      // If allowed: do nothing (no overlay, no flash).
    } catch (e) {
      dbg('check failed:', e?.message || e);
      // Fail-open silently; server is authoritative anyway.
    }
  });
})();
