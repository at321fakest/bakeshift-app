/**
 * Bakeshift: fetch a recipe page even when the site blocks Google's servers.
 *
 * Some big recipe sites (Serious Eats, Allrecipes, Simply Recipes and the rest of
 * Dotdash Meredith, among others) refuse requests from data-center addresses, and
 * UrlFetchApp always runs on Google's servers and labels itself "Google-Apps-Script".
 * Apps like Paprika don't hit this because they load the page on your phone.
 *
 * fetchRecipeHtml_(url) tries, in order:
 *   1. the site itself (as before)
 *   2. the newest Internet Archive (Wayback Machine) copy: the site's original HTML,
 *      so the existing recipe parser reads it unchanged
 *   3. Jina Reader (r.jina.ai), which loads the page in a real browser and returns its HTML
 * and returns the first copy that contains recipe markup. Only the public recipe URL
 * is sent to the fallbacks; nothing about the user is sent.
 *
 * Usage: in the URL import code, replace
 *     var html = UrlFetchApp.fetch(url).getContentText();
 * with
 *     var html = fetchRecipeHtml_(url).html;
 */

function fetchRecipeHtml_(url) {
  var fallback = null; // a page that loaded but had no recipe markup, kept as a last resort
  var errors = [];
  var sources = [
    { via: 'direct', get: function () { return fetchText_(url, {}); } },
    { via: 'archive', get: function () { return fetchFromWayback_(url); } },
    { via: 'reader', get: function () { return fetchText_('https://r.jina.ai/' + url, { 'X-Return-Format': 'html' }); } }
  ];
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    try {
      var html = s.get();
      if (!html) { errors.push(s.via + ': no page'); continue; }
      if (hasRecipeMarkup_(html)) return { html: html, via: s.via };
      if (!fallback && !looksBlocked_(html)) fallback = { html: html, via: s.via };
      errors.push(s.via + ': no recipe on page');
    } catch (e) {
      errors.push(s.via + ': ' + (e && e.message ? e.message : e));
    }
  }
  if (fallback) return fallback;
  throw new Error('BLOCKED: this site wouldn’t let Bakeshift read the recipe (' + errors.join('; ') + ')');
}

/** GETs a URL and returns its text, or null for a non-200 response. */
function fetchText_(url, headers) {
  var h = { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' };
  for (var k in headers) h[k] = headers[k];
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: h });
  return res.getResponseCode() === 200 ? res.getContentText() : null;
}

/** The newest Wayback Machine snapshot of the page, as the site's original HTML. */
function fetchFromWayback_(url) {
  var bare = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  var info = fetchText_('https://archive.org/wayback/available?url=' + encodeURIComponent(bare), { 'Accept': 'application/json' });
  if (!info) return null;
  var snap = (((JSON.parse(info) || {}).archived_snapshots || {}).closest) || null;
  if (!snap || !snap.available || String(snap.status) !== '200') return null;
  // "id_" after the timestamp returns the page exactly as archived, without the Wayback toolbar or rewritten links.
  var raw = String(snap.url).replace(/^http:/, 'https:').replace(/\/web\/(\d+)\//, '/web/$1id_/');
  return fetchText_(raw, {});
}

/** True when the page carries schema.org Recipe data (JSON-LD or microdata). */
function hasRecipeMarkup_(html) {
  return /"@type"\s*:\s*(\[[^\]]*)?"Recipe"/.test(html) || /itemtype=["']https?:\/\/schema\.org\/Recipe["']/i.test(html);
}

/** True for typical bot-check / access-denied pages. */
function looksBlocked_(html) {
  return html.length < 4000 && /access denied|captcha|are you a robot|request blocked|attention required|enable javascript/i.test(html);
}
