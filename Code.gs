/**
 * Family wish list – Google Apps Script backend.
 * The Google Sheet this script is attached to is the database (sheet "Items").
 * See README.md for the 5-minute setup.
 */

// Shared secret everyone types in once. Change it before deploying.
const FAMILY_CODE = 'change-me';

const SHEET_NAME = 'Items';
const COLS = ['id', 'owner', 'title', 'url', 'image', 'price', 'notes', 'boughtBy', 'added'];

function doGet() {
  return ContentService.createTextOutput('Wish list API is running.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.code !== FAMILY_CODE) throw new Error('Wrong family code');
    req.me = String(req.me || '').trim();
    if (!req.me) throw new Error('Missing name');
    out = { ok: true, data: handle_(req) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (req.action === 'list') return list_(req.me);
  if (req.action === 'preview') return fetchMeta_(req.url);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = sheet_();
    const items = read_(sheet);
    const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    const find = () => {
      const i = items.findIndex(it => it.id === String(req.id));
      if (i < 0) throw new Error('Item not found (maybe deleted) – refresh');
      return { item: items[i], row: i + 2 };
    };

    if (req.action === 'add') {
      let url = String(req.url || '').trim();
      let meta = { url: '', title: '', image: '', price: '' };
      if (url && !(req.title && req.image)) meta = fetchMeta_(url);
      if (meta.url) url = meta.url;
      const title = String(req.title || meta.title || '').trim();
      if (!title && !url) throw new Error('Add a link or a title');
      sheet.appendRow([
        Utilities.getUuid().slice(0, 8), req.me, title || url, url,
        String(req.image || meta.image || ''), String(req.price || meta.price || ''),
        String(req.notes || ''), '', new Date().toISOString()
      ].map(safe_));
    } else if (req.action === 'claim') {
      const { item, row } = find();
      if (same(item.owner, req.me)) throw new Error("That's on your own list");
      if (item.boughtBy && !same(item.boughtBy, req.me)) throw new Error('Already bought by ' + item.boughtBy);
      sheet.getRange(row, COLS.indexOf('boughtBy') + 1).setValue(safe_(req.me));
    } else if (req.action === 'unclaim') {
      const { item, row } = find();
      if (!same(item.boughtBy, req.me)) throw new Error('Only the person who bought it can undo');
      sheet.getRange(row, COLS.indexOf('boughtBy') + 1).setValue('');
    } else if (req.action === 'remove') {
      const { item, row } = find();
      if (!same(item.owner, req.me)) throw new Error('You can only remove items from your own list');
      sheet.deleteRow(row);
    } else {
      throw new Error('Unknown action');
    }
  } finally {
    lock.releaseLock();
  }
  return list_(req.me);
}

// Everyone's items, with "bought" info hidden on your own list to keep the surprise.
function list_(me) {
  const mine = String(me).trim().toLowerCase();
  return read_(sheet_()).map(it => {
    if (it.owner.trim().toLowerCase() === mine) it.boughtBy = '';
    return it;
  });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function read_(sheet) {
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0] !== '').map(r => {
    const o = {};
    COLS.forEach((c, i) => {
      const v = r[i];
      o[c] = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
    });
    return o;
  });
}

// Stop text like "=IMPORTXML(...)" being treated as a spreadsheet formula.
function safe_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9'
};
const AMAZON_RE = /^https?:\/\/([^/?#]*\.)?(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)([/?#]|$)/i;
const BOT_WALL_RE = /robot check|captcha|access denied|just a moment|attention required|something went wrong/i;

// Pull title / image / price from a product page. `url` in the result is a cleaned-up link.
function fetchMeta_(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { url: '', title: '', image: '', price: '' };
  if (AMAZON_RE.test(url)) return amazonMeta_(url);
  const meta = { url: url, title: '', image: '', price: '' };
  try {
    const html = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: HEADERS })
      .getContentText().slice(0, 600000);
    const tags = {};
    (html.match(/<meta\b[^>]*>/gi) || []).forEach(tag => {
      const key = (attr_(tag, 'property') || attr_(tag, 'name') || attr_(tag, 'itemprop')).toLowerCase();
      const val = attr_(tag, 'content');
      if (key && val && !(key in tags)) tags[key] = decode_(val).trim();
    });
    const pick = keys => { for (const k of keys) if (tags[k]) return tags[k]; return ''; };
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    meta.title = pick(['og:title', 'twitter:title']) || (t ? decode_(t[1]).replace(/\s+/g, ' ').trim() : '');
    if (BOT_WALL_RE.test(meta.title)) { meta.title = ''; return meta; }  // blocked: user types details
    meta.image = absolute_(pick(['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'image']), url);
    let price = pick(['product:price:amount', 'og:price:amount', 'price']);
    if (!price) { const m = html.match(/"price"\s*:\s*"?([0-9][0-9.,]*)"?/i); if (m) price = m[1]; }
    const cur = pick(['product:price:currency', 'og:price:currency', 'pricecurrency']) ||
      ((html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/) || [])[1] || '');
    if (price) meta.price = ({ GBP: '£', USD: '$', EUR: '€' }[cur] || (cur ? cur + ' ' : '')) + price;
  } catch (err) { /* site unreachable – the user can type details in */ }
  if (!meta.title) meta.title = url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0];
  return meta;
}

// Amazon blocks most automated fetches, so this works in layers: expand short links,
// tidy the URL to /dp/ASIN, try the page, and fall back to what the URL itself reveals.
function amazonMeta_(url) {
  const meta = { url: url, title: '', image: '', price: '' };
  try {  // amzn.to / amzn.eu / a.co short links -> full amazon.* URL
    for (let i = 0; i < 5 && !/^https?:\/\/[^/?#]*amazon\./i.test(url); i++) {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false, headers: HEADERS });
      const h = res.getHeaders(), loc = h.Location || h.location;
      if (!loc) break;
      url = absolute_(loc, url);
    }
  } catch (err) {}
  meta.url = url;
  const origin = (url.match(/^https?:\/\/[^/?#]*amazon\.[a-z.]+/i) || [''])[0].replace(/^http:/i, 'https:');
  const asin = ((url.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?=[/?#]|$)/i) || [])[1] || '').toUpperCase();
  if (origin && asin) meta.url = origin + '/dp/' + asin;  // drops tracking/referral junk
  const slug = (url.match(/amazon\.[a-z.]+\/([^/?#]+)\/(?:dp|gp\/product)\//i) || [])[1];
  const slugTitle = slug ? decodeURIComponent(slug).replace(/[-_+]+/g, ' ').trim() : '';

  try {
    const html = UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true, followRedirects: true, headers: HEADERS }).getContentText();
    const t = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
    if (t) {
      meta.title = decode_(t[1]).replace(/\s+/g, ' ').trim();
      const landing = (html.match(/<img\b[^>]*id="landingImage"[^>]*>/i) || [''])[0];
      meta.image = attr_(landing, 'data-old-hires') || ((html.match(/"hiRes":"(https:[^"]+)"/) || [])[1]) ||
        ((decode_(attr_(landing, 'data-a-dynamic-image')).match(/"(https:[^"]+)"/) || [])[1]) || attr_(landing, 'src');
      const at = html.search(/id="(corePrice[^"]*|apex_desktop|price_inside_buybox|priceblock_ourprice)"/i);
      const p = at < 0 ? null : html.slice(at).match(/class="a-offscreen"[^>]*>\s*([^<]+?)\s*</i);
      if (p) meta.price = decode_(p[1]);
    }
  } catch (err) {}

  if (!meta.title) meta.title = slugTitle;
  // Unofficial image endpoint keyed by ASIN; reliable for books, hit-and-miss otherwise.
  if (!meta.image && asin) meta.image = 'https://images-na.ssl-images-amazon.com/images/P/' + asin + '.01.L.jpg';
  return meta;
}

function attr_(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[2] != null ? m[2] : m[3]) : '';
}

function absolute_(src, base) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  const origin = base.match(/^https?:\/\/[^/]+/i)[0];
  if (src.startsWith('//')) return base.split(':')[0] + ':' + src;
  if (src.startsWith('/')) return origin + src;
  return origin + '/' + src;
}

function decode_(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
