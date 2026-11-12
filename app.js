(function () {
  'use strict';
  var C = window.SBCore, $ = function (id) { return document.getElementById(id); };
  var KEY = 'sbd.rules.v2', MKEY = 'sbd.macro.v1', PAGE = 200;

  /* قوانین شخصی پیش‌فرض خالی است؛ قوانین پچ داخل macro-data.js هستند (D230 هم در آن است). */
  var DEFAULT_RULES = [];
  var rules = loadRules(), table = null, rowsCache = {}, serials = [], res = null, filter = 'all', shown = PAGE, deferredInstall = null;

  /* ---------- ذخیره‌سازی ---------- */
  function loadRules() {
    try { var s = localStorage.getItem(KEY); if (s) { var j = JSON.parse(s); if (Array.isArray(j)) return j; } } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_RULES));
  }
  function saveRules() { try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch (e) {} }

  /* ---------- ابزار ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nf(n) { return Number(n).toLocaleString('fa-IR'); }
  var tt;
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(tt); tt = setTimeout(function () { t.hidden = true; }, err ? 7000 : 3000);
  }
  function download(name, data, type) {
    var url = URL.createObjectURL(new Blob([data], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------- ورودی فایل ---------- */
  async function handleFile(f) {
    if (!f) return;
    try {
      table = await C.openTable(await f.arrayBuffer(), f.name);
      rowsCache = {};
      var sel = $('sheetSel'); sel.innerHTML = '';
      table.names.forEach(function (n, i) { var o = document.createElement('option'); o.value = i; o.textContent = n; sel.appendChild(o); });
      $('fileInfo').textContent = 'فایل: ' + f.name;
      await loadSheet(0, true);
    } catch (e) { toast(e.message || String(e), true); }
  }
  async function getRows(i) { if (!rowsCache[i]) rowsCache[i] = await table.getRows(i); return rowsCache[i]; }
  async function loadSheet(i, auto) {
    var rows = await getRows(i);
    if (!rows.length) { toast('این شیت خالی است.', true); return; }
    var det = C.detectColumn(rows), cs = $('colSel'); cs.innerHTML = '';
    for (var c = 0; c <= det.maxCol; c++) {
      var sample = ''; for (var r = 0; r < Math.min(rows.length, 4); r++) if (rows[r][c] != null && !sample) sample = String(rows[r][c]);
      var o = document.createElement('option'); o.value = c;
      o.textContent = 'ستون ' + C.colName(c) + (sample ? ' — ' + sample.slice(0, 18) : ''); cs.appendChild(o);
    }
    cs.value = det.col; $('hdrChk').checked = det.header; $('pickRow').hidden = false;
    runFromTable();
  }
  async function runFromTable() {
    if (!table) return;
    var rows = await getRows(+$('sheetSel').value), col = +$('colSel').value, start = $('hdrChk').checked ? 1 : 0;
    serials = []; for (var i = start; i < rows.length; i++) if (rows[i] && rows[i][col] != null) serials.push(rows[i][col]);
    run();
  }
  function runFromPaste() {
    table = null; $('pickRow').hidden = true; $('fileInfo').textContent = '';
    serials = $('paste').value.split(/\r?\n/);
    run();
  }

  /* ---------- تحلیل و نمایش ---------- */
  function run() {
    res = C.analyze(serials, rules, { macro: $('macroChk').checked });
    shown = PAGE;
    if (!res.summary.total) { $('resCard').hidden = true; toast('سریالی پیدا نشد. ستون یا ردیف عنوان را بررسی کنید.', true); return; }
    $('resCard').hidden = false;
    renderStats(); renderFilters(); renderTable(); renderUnknown();
  }
  function renderStats() {
    var s = res.summary;
    function st(cls, n, l) { return '<div class="stat ' + cls + '"><b>' + nf(n) + '</b><span>' + l + '</span></div>'; }
    $('stats').innerHTML = st('', s.total, 'کل سریال') + st('ok', s.ok, 'شناسایی‌شده') + (s.partial ? st('', s.partial, 'فقط برند (مدل نامشخص)') : '') + st('unknown', s.unknown, 'ناشناخته') +
      st('bad', s.invalid, 'نامعتبر') + st('bad', s.conflict, 'تداخل قانون') + st('', s.dup, 'تکراری');
    var max = s.models.length ? s.models[0].count : 1;
    $('models').innerHTML = s.models.length ? '<div class="bars">' + s.models.map(function (m) {
      return '<div class="bar"><span>' + esc(m.brand) + ' ' + esc(m.model) + '</span><i style="width:' + Math.max(1, m.count / max * 100) + '%"></i><em>' + nf(m.count) + '</em></div>';
    }).join('') + '</div>' : '';
  }
  var FILTERS = [['all', 'همه'], ['ok', 'شناسایی‌شده'], ['partial', 'فقط برند'], ['unknown', 'ناشناخته'], ['invalid', 'نامعتبر'], ['conflict', 'تداخل'], ['dup', 'تکراری']];
  function renderFilters() {
    $('filters').innerHTML = FILTERS.map(function (f) { return '<button class="f" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>'; }).join('');
  }
  function filtered() {
    var q = C.normalizeSerial($('q').value), qt = $('q').value.trim().toLowerCase();
    return res.rows.filter(function (r) {
      if (filter === 'dup' ? !r.dup : filter !== 'all' && r.status !== filter) return false;
      if (!qt) return true;
      return r.serial.indexOf(q) >= 0 || r.brand.toLowerCase().indexOf(qt) >= 0 || r.model.toLowerCase().indexOf(qt) >= 0;
    });
  }
  function renderTable() {
    var list = filtered(), slice = list.slice(0, shown);
    $('resTbl').tBodies[0].innerHTML = slice.map(function (r) {
      return '<tr><td>' + nf(r.n) + '</td><td class="sn">' + esc(r.serial) + '</td><td>' + esc(r.brand) + '</td><td>' + esc(r.model) +
        '</td><td><span class="tag ' + r.status + '">' + C.STATUS_FA[r.status] + '</span>' + (r.dup ? '<span class="tag dup">تکراری</span>' : '') +
        '</td><td class="wrap">' + esc(r.rule) + '</td></tr>';
    }).join('');
    $('more').hidden = list.length <= shown;
    $('pageInfo').textContent = 'نمایش ' + nf(Math.min(shown, list.length)) + ' از ' + nf(list.length);
  }
  function renderUnknown() {
    var p = res.summary.prefixList;
    $('unkBox').hidden = !p.length;
    $('unk').innerHTML = p.map(function (x) {
      return '<div><code>' + esc(x.prefix) + '…</code><span>طول ' + nf(x.len) + ' · ' + nf(x.count) + ' سریال (نمونه: ' + esc(x.sample) + ')</span><button class="btn" data-mk="' + esc(x.prefix) + '" data-len="' + x.len + '">ساخت قانون</button></div>';
    }).join('');
  }

  /* ---------- قوانین ---------- */
  function renderRules(focusLast) {
    var tb = $('rulesTbl').tBodies[0];
    tb.innerHTML = rules.map(function (r, i) {
      var comp = C.compileRules([r])[0], bad = comp && !comp.ok;
      return '<tr data-i="' + i + '"><td><input type="checkbox" data-k="enabled"' + (r.enabled !== false ? ' checked' : '') + ' title="فعال"></td>' +
        '<td><input data-k="brand" value="' + esc(r.brand) + '" placeholder="PAX"></td>' +
        '<td><input data-k="model" value="' + esc(r.model) + '" placeholder="D230"></td>' +
        '<td><select data-k="type"><option value="prefix"' + (r.type === 'prefix' ? ' selected' : '') + '>پیشوند</option><option value="range"' + (r.type === 'range' ? ' selected' : '') + '>رنج</option><option value="regex"' + (r.type === 'regex' ? ' selected' : '') + '>الگو (regex)</option></select></td>' +
        '<td><input class="sn' + (bad ? ' bad' : '') + '" data-k="a" value="' + esc(r.a) + '"' + (bad ? ' title="' + esc(comp.err) + '"' : '') + '></td>' +
        '<td><input class="sn' + (bad ? ' bad' : '') + '" data-k="b" value="' + esc(r.b || '') + '"' + (r.type !== 'range' ? ' disabled' : '') + '></td>' +
        '<td><input data-k="len" value="' + esc(r.len || '') + '" style="width:60px" inputmode="numeric" placeholder="—"></td>' +
        '<td><input data-k="note" value="' + esc(r.note || '') + '"></td>' +
        '<td><button class="rm" data-rm="' + i + '" title="حذف">×</button></td></tr>';
    }).join('');
    if (focusLast) { var inp = tb.querySelectorAll('tr:last-child input[data-k=brand]')[0]; if (inp) inp.focus(); }
  }
  var rerun = debounce(function () { if (serials.length) run(); }, 250);
  function addRule(prefix, len) {
    rules.push({ enabled: true, brand: '', model: '', type: 'prefix', a: prefix || '', b: '', len: len || '', note: '' });
    saveRules(); renderRules(true);
    $('rulesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- رویدادها ---------- */
  var drop = $('drop'), fileIn = $('file');
  drop.addEventListener('click', function (e) { if (e.target !== fileIn) fileIn.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', function () { handleFile(fileIn.files[0]); fileIn.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
  $('sheetSel').addEventListener('change', function () { loadSheet(+this.value); });
  $('colSel').addEventListener('change', runFromTable);
  $('hdrChk').addEventListener('change', runFromTable);
  $('pasteGo').addEventListener('click', runFromPaste);

  /* ---------- تولید شناسه مصنوعی تست ---------- */
  var testIds = [];
  $('testGenerate').addEventListener('click', function () {
    try {
      testIds = C.generateTestSerials($('testBrand').value, $('testModel').value, $('testCount').value, $('testStart').value);
      $('testOutput').value = testIds.join('\\n');
      $('testCopy').disabled = false; $('testCsv').disabled = false;
      toast(testIds.length + ' شناسه مصنوعی TEST تولید شد؛ سریال واقعی نیست.');
    } catch (e) { testIds = []; $('testOutput').value = ''; $('testCopy').disabled = true; $('testCsv').disabled = true; toast(e.message || String(e), true); }
  });
  $('testCopy').addEventListener('click', async function () {
    if (!testIds.length) return;
    try { await navigator.clipboard.writeText(testIds.join('\\n')); toast('شناسه‌های تست کپی شدند.'); }
    catch (e) { toast('دسترسی کپی در این مرورگر ممکن نیست؛ متن را دستی انتخاب کنید.', true); }
  });
  $('testCsv').addEventListener('click', function () {
    if (!testIds.length) return;
    download('TEST-identifiers-' + stamp() + '.csv', C.toCsv(['شناسه مصنوعی تست'], testIds.map(function (x) { return [x]; })), 'text/csv;charset=utf-8');
  });

  $('filters').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; shown = PAGE; renderFilters(); renderTable(); });
  $('q').addEventListener('input', debounce(function () { shown = PAGE; renderTable(); }, 150));
  $('more').addEventListener('click', function () { shown += PAGE; renderTable(); });
  $('unk').addEventListener('click', function (e) { var b = e.target.closest('[data-mk]'); if (b) addRule(b.dataset.mk, b.dataset.len); });

  $('expXlsx').addEventListener('click', function () {
    if (!res) return;
    download('serial-brand-' + stamp() + '.xlsx', C.buildXlsx(C.resultSheets(res)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  $('expCsv').addEventListener('click', function () {
    if (!res) return;
    var s = C.resultSheets(res)[0];
    download('serial-brand-' + stamp() + '.csv', C.toCsv(s.header, s.rows), 'text/csv;charset=utf-8');
  });

  var rt = $('rulesTbl').tBodies[0];
  function onRuleEdit(e) {
    var el = e.target, tr = el.closest('tr'); if (!tr || !el.dataset.k) return;
    var r = rules[+tr.dataset.i], k = el.dataset.k;
    r[k] = k === 'enabled' ? el.checked : el.value;
    saveRules();
    if (k === 'type' || e.type === 'change') { if (k === 'type' || k === 'a' || k === 'b') renderRules(); }
    rerun();
  }
  rt.addEventListener('input', onRuleEdit); rt.addEventListener('change', onRuleEdit);
  rt.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]'); if (!b) return;
    rules.splice(+b.dataset.rm, 1); saveRules(); renderRules(); rerun();
  });
  $('addRule').addEventListener('click', function () { addRule(''); });
  $('resetRules').addEventListener('click', function () {
    if (!confirm('همه قوانین پاک شوند و به حالت اولیه برگردند؟')) return;
    rules = JSON.parse(JSON.stringify(DEFAULT_RULES)); saveRules(); renderRules(); rerun();
  });
  $('expRules').addEventListener('click', function () {
    download('serial-rules-' + stamp() + '.xlsx', C.buildXlsx([C.rulesSheet(rules)]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  $('impRules').addEventListener('click', function () { $('rulesFile').click(); });
  $('rulesFile').addEventListener('change', async function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    try {
      var t = await C.openTable(await f.arrayBuffer(), f.name), imported = C.rulesFromRows(await t.getRows(0));
      if (!imported.length) throw new Error('قانونی در فایل پیدا نشد.');
      var replace = confirm('تعداد قانون‌های فایل: ' + imported.length + '\n\nOK = جایگزین قوانین فعلی\nCancel = اضافه شدن به قوانین فعلی');
      rules = replace ? imported : rules.concat(imported);
      saveRules(); renderRules(); rerun(); toast(imported.length + ' قانون وارد شد.');
    } catch (e) { toast(e.message || String(e), true); }
  });

  /* ---------- PWA ---------- */
  function net() { var c = $('netChip'); c.textContent = navigator.onLine ? 'آنلاین' : 'آفلاین'; c.className = 'chip' + (navigator.onLine ? '' : ' off'); }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async function () {
    if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; this.hidden = true;
  });
  window.addEventListener('appinstalled', function () { $('installBtn').hidden = true; });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* قوانین داخلی پچ: نمایش فقط‌خواندنی، گروه‌بندی‌شده بر اساس طول و مدل */
  function renderMacroTable() {
    var M = C.MACRO; if (!M) return;
    var rows = [];
    Object.keys(M.model.byLen).sort(function (a, b) { return a - b; }).forEach(function (L) {
      var g = {}; M.model.byLen[L].forEach(function (e) { g[e[1]] = g[e[1]] || {}; });
      /* آخرین قانون برای هر پیشوند برنده است */
      var last = {}; M.model.byLen[L].forEach(function (e) { last[e[0]] = e[1]; });
      Object.keys(last).forEach(function (p) { (g[last[p]] = g[last[p]] || {})[p] = 1; });
      Object.keys(g).forEach(function (m) { var ps = Object.keys(g[m]); if (ps.length) rows.push('<tr><td>' + nf(L) + '</td><td>' + esc(m) + '</td><td>' + esc(ps.join('، ')) + '</td></tr>'); });
    });
    $('macroTbl').tBodies[0].innerHTML = rows.join('');
  }
  try { var mv = localStorage.getItem(MKEY); if (mv === '0') $('macroChk').checked = false; } catch (e) {}
  $('macroChk').addEventListener('change', function () { try { localStorage.setItem(MKEY, this.checked ? '1' : '0'); } catch (e) {} if (serials.length) run(); });
  renderMacroTable();
  renderRules();
})();
