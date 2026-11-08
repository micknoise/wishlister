/**
 * Family wish list – Google Apps Script backend.
 * The Google Sheet this script is attached to is the database (sheet "Items").
 * See README.md for the 5-minute setup.
 */

// Shared secret everyone types in once. Change it before deploying.
const FAMILY_CODE = 'change-me';

const API_VERSION = 2;
const ITEM_COLS = ['id', 'owner', 'title', 'url', 'image', 'price', 'notes', 'addedBy', 'secret',
  'priority', 'qty', 'removedBy', 'archived', 'added'];
const CLAIM_COLS = ['itemId', 'buyer', 'qty', 'bought', 'archived', 'added'];

function doGet() {
  return ContentService.createTextOutput('Wish list API is running (v' + API_VERSION + ').');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.code !== FAMILY_CODE) throw new Error('Wrong family code');
    req.me = clean_(req.me);
    if (!req.me) throw new Error('Missing name');
    out = { ok: true, v: API_VERSION, data: handle_(req) };
  } catch (err) {
    out = { ok: false, v: API_VERSION, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

const clean_ = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const same_ = (a, b) => clean_(a).toLowerCase() === clean_(b).toLowerCase();
const num_ = v => Math.max(1, Math.min(99, parseInt(v, 10) || 1));
const yes_ = v => v ? 'yes' : '';
const now_ = () => new Date().toISOString();

function handle_(req) {
  if (req.action === 'preview') return fetchMeta_(req.url);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const me = req.me, db = db_();
    const find = () => {
      const it = db.items.rows.find(r => r.id === String(req.id));
      // Secret suggestions don't exist as far as the list owner is concerned.
      if (!it || (it.secret && same_(it.owner, me))) throw new Error('Item not found (maybe deleted) – refresh');
      return it;
    };
    const claimsOn = id => db.claims.rows.filter(c => c.itemId === id && !c.archived);
    const myClaim = id => claimsOn(id).find(c => same_(c.buyer, me));
    const canChange = it => same_(it.owner, me) || same_(it.addedBy, me);
    const taken = id => claimsOn(id).reduce((n, c) => n + num_(c.qty), 0);

    switch (req.action) {
      case 'list': break;

      case 'add': {
        const owner = clean_(req.owner) || me;
        const d = details_(req, null);
        db.items.append(Object.assign(d, {
          id: Utilities.getUuid().slice(0, 8), owner: owner, addedBy: me,
          secret: yes_(req.secret && !same_(owner, me)), added: now_()
        }));
        break;
      }

      case 'edit': {
        const it = find();
        if (!canChange(it)) throw new Error('Only the list owner or whoever added it can edit this');
        const d = details_(req, it);
        if (!same_(it.owner, me)) d.secret = yes_(req.secret);
        Object.keys(d).forEach(k => { if (String(d[k]) !== it[k]) db.items.set(it, k, d[k]); });
        break;
      }

      case 'remove': {
        const it = find();
        if (!canChange(it)) throw new Error('Only the list owner or whoever added it can remove this');
        // If someone has already claimed it, keep it so they can see it was removed.
        if (claimsOn(it.id).length) db.items.set(it, 'removedBy', me);
        else db.items.del(it);
        break;
      }

      case 'claim': {
        const it = find();
        if (same_(it.owner, me)) throw new Error("That's on your own list");
        if (it.removedBy || it.archived) throw new Error('That item is no longer on the list');
        if (taken(it.id) >= num_(it.qty)) throw new Error('Someone has already got this');
        const c = myClaim(it.id);
        if (c) db.claims.set(c, 'qty', num_(c.qty) + 1);
        else db.claims.append({ itemId: it.id, buyer: me, qty: 1, bought: '', archived: '', added: now_() });
        break;
      }

      case 'unclaim': case 'dismiss': {
        const it = find(), c = myClaim(it.id);
        if (!c) throw new Error("You haven't said you'll get this");
        if (req.action === 'unclaim' && num_(c.qty) > 1) db.claims.set(c, 'qty', num_(c.qty) - 1);
        else {
          db.claims.del(c);
          if (it.removedBy && !claimsOn(it.id).length) db.items.del(it);
        }
        break;
      }

      case 'bought': {
        const c = myClaim(String(req.id));
        if (!c) throw new Error("You haven't said you'll get this");
        db.claims.set(c, 'bought', yes_(req.bought));
        break;
      }

      case 'archive': {
        // After the occasion: claimed things move to "presents received"; unclaimed ones stay.
        const owner = clean_(req.owner) || me, when = now_();
        db.items.rows.filter(it => same_(it.owner, owner) && !it.archived).forEach(it => {
          const cs = claimsOn(it.id);
          if (!cs.length) return;
          const n = taken(it.id);
          cs.forEach(c => db.claims.set(c, 'archived', when));
          if (it.removedBy || n >= num_(it.qty)) db.items.set(it, 'archived', when);
          else db.items.set(it, 'qty', num_(it.qty) - n);
        });
        break;
      }

      default: throw new Error('Unknown action');
    }
    return view_(db_(), me);
  } finally {
    lock.releaseLock();
  }
}

// Item fields from a request, looking up the link when needed.
function details_(req, old) {
  let url = clean_(req.url), image = clean_(req.image), title = clean_(req.title);
  if (url && (!title || !image) && (!old || url !== old.url)) {
    const meta = fetchMeta_(url);
    if (meta.url) url = meta.url;
    title = title || meta.title;
    image = image || meta.image;
    if (!clean_(req.price)) req.price = meta.price;
  }
  if (old && url === old.url && !image) image = old.image;
  if (!title && !url) throw new Error('Add a link or a title');
  return {
    title: title || url, url: url, image: image, price: clean_(req.price),
    notes: String(req.notes == null ? '' : req.notes).trim(),
    priority: yes_(req.priority), qty: num_(req.qty)
  };
}

// What `me` may see. Owners never get claims or secret suggestions for their own list.
function view_(db, me) {
  const byItem = {};
  db.claims.rows.forEach(c => (byItem[c.itemId] = byItem[c.itemId] || []).push(c));
  const items = [], received = [];
  db.items.rows.forEach(it => {
    const cs = byItem[it.id] || [], active = cs.filter(c => !c.archived);
    if (same_(it.owner, me)) {
      const given = cs.filter(c => c.archived);
      if (given.length) received.push({
        title: it.title, url: it.url, image: it.image,
        from: given.map(c => c.buyer).filter((b, i, a) => a.findIndex(x => same_(x, b)) === i),
        date: given.map(c => c.archived).sort().pop()
      });
      if (!it.secret && !it.removedBy && !it.archived) items.push(public_(it, []));
      return;
    }
    if (it.archived) return;
    if (it.removedBy && !active.some(c => same_(c.buyer, me))) return;
    items.push(public_(it, active));
  });
  received.sort((a, b) => b.date.localeCompare(a.date));
  return { items: items, received: received };
}

function public_(it, claims) {
  return {
    id: it.id, owner: it.owner, title: it.title, url: it.url, image: it.image, price: it.price,
    notes: it.notes, addedBy: it.addedBy, secret: !!it.secret, priority: !!it.priority,
    qty: num_(it.qty), removedBy: it.removedBy, added: it.added,
    claims: claims.map(c => ({ buyer: c.buyer, qty: num_(c.qty), bought: !!c.bought }))
  };
}

function db_() {
  const db = { items: table_('Items', ITEM_COLS), claims: table_('Claims', CLAIM_COLS) };
  // One-off upgrade from v1, which kept a single "boughtBy" name on each item.
  if (db.claims.created && db.items.header.indexOf('boughtBy') >= 0) {
    db.items.rows.filter(it => it.boughtBy).forEach(it => {
      db.claims.append({ itemId: it.id, buyer: it.boughtBy, qty: 1, bought: '', archived: '', added: now_() });
      db.items.set(it, 'boughtBy', '');
    });
    db.claims = table_('Claims', CLAIM_COLS);
  }
  return db;
}

// A sheet as a list of row objects keyed by header; adds any missing columns.
function table_(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name), created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
    created = true;
  }
  const values = sh.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim());
  while (header.length && !header[header.length - 1]) header.pop();
  const missing = cols.filter(c => header.indexOf(c) < 0);
  if (missing.length) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header.push.apply(header, missing);
  }
  const rows = [];
  values.slice(1).forEach((r, i) => {
    const o = { _row: i + 2 };
    header.forEach((h, j) => {
      const v = r[j];
      o[h] = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
    });
    if (o[cols[0]] !== '') rows.push(o);
  });
  return {
    header: header, rows: rows, created: created,
    set(row, field, value) {
      row[field] = String(value);
      sh.getRange(row._row, header.indexOf(field) + 1).setValue(safe_(value));
    },
    append(obj) { sh.appendRow(header.map(h => safe_(obj[h] == null ? '' : obj[h]))); },
    del(row) {
      sh.deleteRow(row._row);
      rows.splice(rows.indexOf(row), 1);
      rows.forEach(r => { if (r._row > row._row) r._row--; });
    }
  };
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
