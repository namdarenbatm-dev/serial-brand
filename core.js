/* core.js — بدون وابستگی. هم در مرورگر و هم در Node کار می‌کند. */
(function (root) {
  'use strict';

  var FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';

  /* ---------- نرمال‌سازی ---------- */
  function normalizeSerial(v) {
    if (v == null) return '';
    var s = String(v).trim();
    s = s.replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); })
         .replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); });
    return s.replace(/[\s\-_.‌‎‏]/g, '').toUpperCase();
  }
  function isSerialLike(s) { return /^[A-Z0-9]{5,24}$/.test(s) && /\d/.test(s); }

  /* ---------- XML کمکی (بدون DOMParser تا در Node هم تست شود) ---------- */
  function decodeXml(s) {
    return s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
            .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(+d); })
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function escXml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; })
                    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }
  function attrs(tag) {
    var o = {};
    tag.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, function (m, k, v) { o[k] = decodeXml(v); return m; });
    return o;
  }
  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref), n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64;
    return n - 1;
  }
  function colName(i) {
    var s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  function fixNum(v) {
    v = v.trim();
    if (/^[+-]?\d+$/.test(v)) return v.replace(/^\+/, '');
    var n = Number(v);
    if (isFinite(n) && Math.floor(n) === n && Math.abs(n) < 1e21) return BigInt(n).toString();
    return v;
  }

  /* ---------- ZIP (خواندن) ---------- */
  async function inflateRaw(u8) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1, i;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('فایل XLSX/ZIP معتبر نیست.');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), files = {};
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true),
          nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true),
          clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true),
          name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method: method, csize: csize, lho: lho };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: function (name) { return !!files[name]; },
      read: async function (name) {
        var f = files[name];
        if (!f) return null;
        var nl = dv.getUint16(f.lho + 26, true), el = dv.getUint16(f.lho + 28, true),
            start = f.lho + 30 + nl + el, data = u8.subarray(start, start + f.csize);
        if (f.method === 0) return data;
        if (f.method === 8) return inflateRaw(data);
        throw new Error('روش فشرده‌سازی فایل پشتیبانی نمی‌شود.');
      }
    };
  }
  async function readText(zip, name) {
    var d = await zip.read(name);
    return d ? new TextDecoder('utf-8').decode(d) : null;
  }

  /* ---------- XLSX (خواندن) ---------- */
  function parseSharedStrings(xml) {
    var out = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, m;
    while ((m = re.exec(xml))) {
      var body = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), s = '';
      body.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (x, t) { s += decodeXml(t); return x; });
      out.push(s);
    }
    return out;
  }
  function parseSheetXml(xml, sst) {
    var rows = [], re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml))) {
      var a = attrs(m[1]);
      if (!a.r) continue;
      var r = parseInt(a.r.replace(/^[A-Z]+/, ''), 10) - 1, c = colIndex(a.r), inner = m[2] || '', val = null, v;
      if (a.t === 's') { v = /<v>(\d+)<\/v>/.exec(inner); if (v) val = sst[+v[1]]; }
      else if (a.t === 'inlineStr') { val = ''; inner.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (x, t) { val += decodeXml(t); return x; }); }
      else if (a.t === 'str' || a.t === 'e') { v = /<v>([\s\S]*?)<\/v>/.exec(inner); if (v) val = decodeXml(v[1]); }
      else { v = /<v>([\s\S]*?)<\/v>/.exec(inner); if (v) val = fixNum(decodeXml(v[1])); }
      if (val == null || val === '') continue;
      (rows[r] = rows[r] || [])[c] = val;
    }
    for (var i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
    return rows;
  }
  async function parseXlsx(buf) {
    var zip = await unzip(buf);
    var wb = await readText(zip, 'xl/workbook.xml');
    if (!wb) throw new Error('این فایل XLSX معتبر نیست (workbook.xml پیدا نشد).');
    var rels = await readText(zip, 'xl/_rels/workbook.xml.rels') || '', relMap = {};
    (rels.match(/<Relationship\b[^>]*\/?>/g) || []).forEach(function (t) {
      var a = attrs(t);
      if (a.Id) relMap[a.Id] = a.Target || '';
    });
    var sheets = (wb.match(/<sheet\b[^>]*\/?>/g) || []).map(function (t) {
      var a = attrs(t), tg = relMap[a['r:id']] || '';
      return { name: a.name, path: tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, '') };
    });
    var ssXml = await readText(zip, 'xl/sharedStrings.xml'), sst = ssXml ? parseSharedStrings(ssXml) : [];
    return {
      names: sheets.map(function (s) { return s.name; }),
      getRows: async function (i) {
        var x = await readText(zip, sheets[i].path);
        if (!x) throw new Error('شیت پیدا نشد.');
        return parseSheetXml(x, sst);
      }
    };
  }

  /* ---------- CSV / متن ---------- */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/, 1)[0] || '', best = ',', bc = -1;
    [',', ';', '\t'].forEach(function (d) {
      var c = first.split(d).length;
      if (c > bc) { bc = c; best = d; }
    });
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === best) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    return rows;
  }
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1256').decode(buf); }
  }

  /* ---------- باز کردن فایل ---------- */
  async function openTable(buf, fileName) {
    var u8 = new Uint8Array(buf);
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0)
      throw new Error('فرمت قدیمی .xls پشتیبانی نمی‌شود. در Excel با Save As آن را به .xlsx یا CSV تبدیل کنید.');
    if (u8[0] === 0x50 && u8[1] === 0x4B) return parseXlsx(buf);
    var rows = parseCsv(decodeText(buf));
    return { names: [fileName || 'متن'], getRows: async function () { return rows; } };
  }

  /* ---------- تشخیص ستون سریال ---------- */
  function detectColumn(rows) {
    var score = {}, maxCol = 0, i, j;
    for (i = 0; i < Math.min(rows.length, 300); i++) {
      for (j = 0; j < rows[i].length; j++) {
        if (rows[i][j] == null) continue;
        maxCol = Math.max(maxCol, j);
        var s = normalizeSerial(rows[i][j]);
        if (isSerialLike(s)) score[j] = (score[j] || 0) + 1;
        if (i === 0 && /serial|^sn$|s\/n|سریال/i.test(String(rows[i][j]))) score[j] = (score[j] || 0) + 1000;
      }
    }
    var col = 0, best = -1;
    for (j = 0; j <= maxCol; j++) if ((score[j] || 0) > best) { best = score[j] || 0; col = j; }
    var h = rows[0] && rows[0][col] != null ? normalizeSerial(rows[0][col]) : '';
    var header = h !== '' && !isSerialLike(h);
    return { col: col, header: header, maxCol: maxCol };
  }

  /* ---------- منطق پچ BrandPAX.xlam ----------
     در VBA: طول سریال + ۲ کاراکتر اول (برای چند مورد ۳ یا ۴ کاراکتر).
     قانون‌های بعدی قبلی‌ها را بازنویسی می‌کنند. داده از macro-data.js می‌آید. */
  var MACRO = root.SB_MACRO || (typeof require !== 'undefined' ? require('./macro-data.js') : null);
  var MODEL_BRAND = { A80: 'PAX', D210: 'PAX', D230: 'PAX', Q80: 'PAX', S80: 'PAX', S90: 'PAX', S800: 'PAX', S900: 'PAX', S910: 'PAX', S920: 'PAX', SP600: 'Newland', Verifone: 'Verifone' };

  function macroPick(part, s) {
    var out = '', label = '', L = s.length, list = (part.byLen[L] || []).map(function (e) { return [e, 'طول ' + L]; });
    (part.any || []).forEach(function (e) { list.push([e, 'هر طول']); });
    list.forEach(function (x) { if (s.slice(0, x[0][0].length).toUpperCase() === String(x[0][0]).toUpperCase()) { out = x[0][1]; label = x[1] + ' + پیشوند ' + x[0][0]; } });
    return { v: out, label: label };
  }
  /* خروجی خام، دقیقاً مثل دو تابع VBA */
  function macroRaw(s) {
    if (!MACRO) return { brand: '', model: '' };
    return { brand: macroPick(MACRO.brand, s).v, model: macroPick(MACRO.model, s).v };
  }
  function macroDetect(s) {
    if (!MACRO) return null;
    var b = macroPick(MACRO.brand, s), m = macroPick(MACRO.model, s), note = '', t;
    if (!b.v && !m.v && /^\d+$/.test(s) && (s.length === 7 || s.length === 9)) {
      t = '0' + s; var b2 = macroPick(MACRO.brand, t), m2 = macroPick(MACRO.model, t);
      if (b2.v || m2.v) { b = b2; m = m2; note = ' (فرض: صفر ابتدای سریال در Excel حذف شده)'; }
    }
    if (!b.v && !m.v) return null;
    var brand = b.v, model = m.v, inferred = '';
    if (model === 'Verifone') {
      if (!brand) brand = 'Verifone';
      else if (brand !== 'Verifone') inferred = ' · ⚠ در پچ: برند ' + brand + ' ولی مدل Verifone (ناسازگار)';
      model = '';
    }
    if (!brand && model && MODEL_BRAND[model]) { brand = MODEL_BRAND[model]; inferred = ' · برند از روی مدل'; }
    brand = brand === 'Pax' ? 'PAX' : brand;
    return { brand: brand, model: model, rule: 'پچ: ' + (m.label || b.label) + inferred + note };
  }

  /* ---------- قانون‌ها ---------- */
  function compileRules(rules) {
    var out = [];
    rules.forEach(function (r, idx) {
      if (r.enabled === false) return;
      var c = { idx: idx, brand: (r.brand || '').trim(), model: (r.model || '').trim(), type: r.type, label: '', ok: true, score: 0, len: parseInt(r.len, 10) || 0 };
      var a = normalizeSerial(r.a), b = normalizeSerial(r.b);
      if (r.type === 'prefix') {
        if (!a) return;
        c.a = a; c.score = 100 + a.length; c.label = 'پیشوند ' + a;
      } else if (r.type === 'range') {
        if (!a || !b) return;
        if (a.length !== b.length) { c.ok = false; c.err = 'طول «از» و «تا» باید برابر باشد'; }
        c.a = a; c.b = b; c.score = 1000; c.label = 'رنج ' + a + '–' + b;
      } else if (r.type === 'regex') {
        if (!r.a) return;
        try { c.re = new RegExp(r.a, 'i'); } catch (e) { c.ok = false; c.err = 'الگوی regex نامعتبر است'; }
        c.score = 10; c.label = 'regex ' + r.a;
      } else return;
      if (!c.brand && !c.model) return;
      out.push(c);
    });
    return out;
  }
  function ruleHit(c, s) {
    if (!c.ok) return false;
    if (c.len && s.length !== c.len) return false;
    if (c.type === 'prefix') return s.indexOf(c.a) === 0;
    if (c.type === 'range') return s.length === c.a.length && s >= c.a && s <= c.b;
    return c.re.test(s);
  }
  function matchSerial(s, compiled) {
    var hits = [];
    for (var i = 0; i < compiled.length; i++) if (ruleHit(compiled[i], s)) hits.push(compiled[i]);
    if (!hits.length) return null;
    hits.sort(function (x, y) { return y.score - x.score || x.idx - y.idx; });
    var best = hits[0], conflict = hits.some(function (h) { return h.brand !== best.brand || h.model !== best.model; });
    return { rule: best, conflict: conflict, others: hits.slice(1) };
  }

  function analyze(rawList, rules, opts) {
    opts = opts || {};
    var compiled = compileRules(rules || []), seen = {}, rows = [], i;
    var sum = { total: 0, ok: 0, partial: 0, unknown: 0, invalid: 0, conflict: 0, dup: 0, byModel: {}, unknownPrefixes: {} };
    for (i = 0; i < rawList.length; i++) {
      var raw = rawList[i], s = normalizeSerial(raw);
      if (s === '') continue;
      var row = { n: rows.length + 1, raw: String(raw), serial: s, brand: '', model: '', rule: '', status: '', dup: false };
      sum.total++;
      if (!/^[A-Z0-9]{4,32}$/.test(s)) { row.status = 'invalid'; sum.invalid++; }
      else {
        if (seen[s]) { row.dup = true; sum.dup++; } seen[s] = 1;
        var m = matchSerial(s, compiled), d = (!m && opts.macro !== false) ? macroDetect(s) : null;
        if (d) {
          row.brand = d.brand; row.model = d.model; row.rule = d.rule;
          row.status = d.model ? 'ok' : 'partial'; sum[row.status]++;
          var k0 = (d.brand || '—') + '\u0001' + (d.model || '—');
          sum.byModel[k0] = (sum.byModel[k0] || 0) + 1;
        } else if (!m) {
          row.status = 'unknown'; sum.unknown++;
          var pf = s.slice(0, 2), uk = s.length + ':' + pf;
          (sum.unknownPrefixes[uk] = sum.unknownPrefixes[uk] || { prefix: pf, len: s.length, count: 0, sample: s }).count++;
        } else {
          row.brand = m.rule.brand; row.model = m.rule.model; row.rule = m.rule.label;
          if (m.conflict) { row.status = 'conflict'; sum.conflict++; row.rule += ' (تداخل با: ' + m.others.map(function (o) { return o.label; }).join('، ') + ')'; }
          else { row.status = 'ok'; sum.ok++; }
          var key = (m.rule.brand || '—') + '\u0001' + (m.rule.model || '—');
          sum.byModel[key] = (sum.byModel[key] || 0) + 1;
        }
      }
      rows.push(row);
    }
    sum.models = Object.keys(sum.byModel).map(function (k) {
      var p = k.split('\u0001');
      return { brand: p[0], model: p[1], count: sum.byModel[k] };
    }).sort(function (a, b) { return b.count - a.count; });
    sum.prefixList = Object.keys(sum.unknownPrefixes).map(function (k) { return sum.unknownPrefixes[k]; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 20);
    delete sum.byModel; delete sum.unknownPrefixes;
    return { rows: rows, summary: sum, compiled: compiled };
  }

  /* ---------- وارد کردن قانون‌ها از جدول ---------- */
  var TYPE_MAP = { prefix: 'prefix', 'پیشوند': 'prefix', range: 'range', 'رنج': 'range', 'بازه': 'range', regex: 'regex', 'الگو': 'regex' };
  function rulesFromRows(rows) {
    if (!rows.length) return [];
    var H = rows[0].map(function (x) { return String(x == null ? '' : x).trim().toLowerCase(); }), ix = {};
    function find(names) { for (var i = 0; i < H.length; i++) if (names.indexOf(H[i]) >= 0) return i; return -1; }
    ix.brand = find(['brand', 'برند']); ix.model = find(['model', 'مدل']); ix.type = find(['type', 'نوع']);
    ix.a = find(['a', 'from', 'prefix', 'از', 'پیشوند', 'از/پیشوند']); ix.b = find(['b', 'to', 'تا']);
    ix.len = find(['len', 'length', 'طول']); ix.note = find(['note', 'توضیح', 'توضیحات']);
    if (ix.brand < 0 || ix.a < 0) throw new Error('ستون‌های «برند» و «از/پیشوند» در فایل قوانین پیدا نشد.');
    var out = [];
    rows.slice(1).forEach(function (r) {
      function g(k) { return ix[k] >= 0 && r[ix[k]] != null ? String(r[ix[k]]).trim() : ''; }
      if (!g('brand') && !g('model')) return;
      var t = TYPE_MAP[g('type').toLowerCase()] || (g('b') ? 'range' : 'prefix');
      out.push({ enabled: true, brand: g('brand'), model: g('model'), type: t, a: g('a'), b: g('b'), len: g('len'), note: g('note') });
    });
    return out;
  }
  var TYPE_FA = { prefix: 'پیشوند', range: 'رنج', regex: 'الگو' };

  /* ---------- ZIP/XLSX (نوشتن، بدون فشرده‌سازی) ---------- */
  var CRC_T = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function u16(n) { return [n & 255, (n >> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var lh = [0x50, 0x4B, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      central.push({ name: name, crc: crc, size: data.length, off: offset });
      offset += lh.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var h = [0x50, 0x4B, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off));
      parts.push(new Uint8Array(h), c.name);
      cdSize += h.length + c.name.length;
    });
    parts.push(new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }
  function sheetXml(header, rows, widths) {
    function cell(v, r, c) {
      return '<c r="' + colName(c) + r + '" t="inlineStr"><is><t xml:space="preserve">' + escXml(v == null ? '' : v) + '</t></is></c>';
    }
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>';
    [header].concat(rows).forEach(function (row, ri) {
      x += '<row r="' + (ri + 1) + '">' + row.map(function (v, ci) { return cell(v, ri + 1, ci); }).join('') + '</row>';
    });
    return x + '</sheetData></worksheet>';
  }
  /* sheets: [{name, header:[], rows:[[]], widths:[]}] */
  function buildXlsx(sheets) {
    var n = sheets.length, i, ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    var wr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    var files = [];
    for (i = 0; i < n; i++) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wb += '<sheet name="' + escXml(sheets[i].name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      wr += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sheets[i].header, sheets[i].rows, sheets[i].widths || []) });
    }
    ct += '</Types>'; wb += '</sheets></workbook>'; wr += '</Relationships>';
    files.unshift(
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wr }
    );
    return zipStore(files);
  }

  var STATUS_FA = { ok: 'شناسایی شد', partial: 'فقط برند', unknown: 'ناشناخته', invalid: 'نامعتبر', conflict: 'تداخل قانون' };
  function resultSheets(res) {
    var s = res.summary;
    return [
      { name: 'نتایج', header: ['ردیف', 'سریال (ورودی)', 'سریال نرمال‌شده', 'برند', 'مدل', 'وضعیت', 'تکراری', 'قانون مطابق'],
        rows: res.rows.map(function (r) { return [r.n, r.raw, r.serial, r.brand, r.model, STATUS_FA[r.status], r.dup ? 'بله' : '', r.rule]; }),
        widths: [7, 22, 22, 14, 14, 14, 9, 36] },
      { name: 'خلاصه', header: ['برند', 'مدل', 'تعداد'],
        rows: s.models.map(function (m) { return [m.brand, m.model, m.count]; }).concat([['', '', ''], ['کل سریال‌ها', '', s.total], ['شناسایی‌شده', '', s.ok], ['فقط برند (مدل مشخص نیست)', '', s.partial], ['ناشناخته', '', s.unknown], ['نامعتبر', '', s.invalid], ['تداخل', '', s.conflict], ['تکراری', '', s.dup]]),
        widths: [18, 18, 10] }
    ];
  }
  function rulesSheet(rules) {
    return { name: 'قوانین', header: ['برند', 'مدل', 'نوع', 'از/پیشوند', 'تا', 'طول', 'توضیح'],
      rows: rules.map(function (r) { return [r.brand, r.model, TYPE_FA[r.type] || r.type, r.a, r.b || '', r.len || '', r.note || '']; }),
      widths: [14, 14, 10, 22, 22, 7, 36] };
  }
  function toCsv(header, rows) {
    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    return '﻿' + [header].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }

  /* ---------- شناسه مصنوعی تست؛ هرگز سریال واقعی سازنده نیست ---------- */
  function generateTestSerials(brand, model, count, start) {
    function token(v, name) {
      var s = String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!s || s.length > 20) throw new Error(name + ' نامعتبر است.');
      return s;
    }
    brand = token(brand, 'برند');
    model = token(model, 'مدل');
    count = Number(count);
    start = start == null || start === '' ? 1 : Number(start);
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('تعداد باید بین ۱ تا ۱۰٬۰۰۰ باشد.');
    if (!Number.isInteger(start) || start < 1 || start > 99999999 || start + count - 1 > 99999999) throw new Error('شماره شروع نامعتبر است.');
    var width = Math.max(6, String(start + count - 1).length), out = [];
    for (var i = 0; i < count; i++) out.push('TEST-' + brand + '-' + model + '-' + String(start + i).padStart(width, '0'));
    return out;
  }

  var api = {
    normalizeSerial: normalizeSerial, isSerialLike: isSerialLike, generateTestSerials: generateTestSerials, openTable: openTable, parseXlsx: parseXlsx, parseCsv: parseCsv,
    detectColumn: detectColumn, macroRaw: macroRaw, macroDetect: macroDetect, MACRO: MACRO, compileRules: compileRules, matchSerial: matchSerial, analyze: analyze, rulesFromRows: rulesFromRows,
    buildXlsx: buildXlsx, resultSheets: resultSheets, rulesSheet: rulesSheet, toCsv: toCsv, colName: colName, STATUS_FA: STATUS_FA, TYPE_FA: TYPE_FA
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SBCore = api;
})(typeof self !== 'undefined' ? self : this);
