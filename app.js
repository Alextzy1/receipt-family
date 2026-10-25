/* Receipt Family - plain JS, no dependencies. */
(function () {
  'use strict';

  var VERSION = '2.0.0';
  // Fallback lists only (used until the server's 'config' answer arrives). Family names are never in this file.
  var CATEGORIES = ['Groceries', 'Medical / pharmacy', 'Therapy', 'Kids / childcare', 'Activities (kids)', 'Home',
    'Car / gas', 'Donation', 'Education', 'Clothing', 'Eating out', 'Household supplies', 'Pets', 'Gifts', 'Other'];
  var TAX_TYPES = [['', 'No'], ['Medical expense', 'Medical expense'], ['Disability (DTC)', 'Disability (DTC)'],
    ['Childcare expense', 'Childcare expense'], ['Donation', 'Donation'], ['Other / ask accountant', 'Other / ask accountant']];
  var MAX_PAGES = 6;
  var MAX_PDF_BYTES = 8 * 1024 * 1024;
  var MAX_TOTAL_CHARS = 28 * 1024 * 1024;   // backend accepts 30 MB in total
  var MAX_DIM = 1600;
  var JPEG_Q = 0.8;
  var REQUEST_TIMEOUT_MS = 90000;

  function $(id) { return document.getElementById(id); }

  /* ---------- storage (always try/catch) ---------- */
  var mem = {};
  function lsGet(k) { try { var v = window.localStorage.getItem(k); return v === null ? (mem[k] || '') : v; } catch (e) { return mem[k] || ''; } }
  function lsSet(k, v) { mem[k] = v; try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var state = {
    code: lsGet('rf_code'),
    who: lsGet('rf_who'),
    seq: 0,            // bumps on every new receipt / cancel, so stale results are ignored
    aseq: 0,           // bumps on every analyze run
    pages: [],         // [{id, mime, dataUrl, name}] of the current receipt (jpeg images and/or PDFs)
    nextId: 1,
    formShown: false,  // the analysis form has been shown for this receipt
    edited: false,     // the user typed in the form since it was filled
    proof: { ok: null, missing: '' },
    controller: null,  // AbortController for the in-flight analyze
    saving: false,
    stack: []          // open "layers" for the Back button: 'work', 'settings'
  };

  /* ---------- helpers ---------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 4500 : 2500);
  }
  function show(el, on) { el.hidden = !on; }
  function setText(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  function apiConfigured() {
    var u = (window.RF_CONFIG && window.RF_CONFIG.apiUrl) || '';
    return /^https:\/\//i.test(u);
  }

  function friendlyError(e) {
    if (!e) return 'Something went wrong. Please try again.';
    if (e.rfCode === 'noapi') return 'This app is not connected to the receipt server yet. Ask whoever set up the app to finish the setup.';
    if (e.name === 'AbortError' || e.rfCode === 'timeout') return 'That took too long. Check your connection and try again.';
    if (e.rfCode === 'badreply') return 'The server sent an unexpected reply. Please try again in a moment.';
    if (e.rfCode === 'server') return e.message || 'The server could not do that.';
    if (e.name === 'TypeError') return 'Cannot reach the server. Check your internet connection and try again.';
    return 'Something went wrong. Please try again.';
  }

  /* ---------- API ---------- */
  function api(payload, signal) {
    if (!apiConfigured()) {
      var ne = new Error('noapi'); ne.rfCode = 'noapi';
      return Promise.reject(ne);
    }
    var body = {};
    for (var k in payload) { if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k]; }
    body.k = state.code;

    var ctrl = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    return fetch(window.RF_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).then(function (res) {
      return res.text();
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) { var be = new Error('badreply'); be.rfCode = 'badreply'; throw be; }
      if (!data || data.ok !== true) {
        var se = new Error((data && data.error) ? String(data.error) : 'The server could not do that.');
        se.rfCode = 'server';
        throw se;
      }
      return data;
    }).catch(function (e) {
      if (timedOut) { var te = new Error('timeout'); te.rfCode = 'timeout'; throw te; }
      throw e;
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---------- screens ---------- */
  function route() {
    var ready = !!(state.code && state.who);
    show($('screen-setup'), !ready);
    show($('screen-main'), ready);
    if (ready) {
      $('who-name').textContent = state.who;
    } else {
      show($('setup-code-wrap'), !state.code);
      $('setup-who').value = state.who || '';
    }
  }

  /* ---------- setup ---------- */
  $('setup-go').addEventListener('click', function () {
    var setupWho = $('setup-who').value.trim();
    var code = state.code || $('setup-code').value.trim();
    if (!code) { setText($('setup-error'), 'Please paste the family code.'); return; }
    if (!setupWho) { setText($('setup-error'), 'Please type your first name.'); return; }
    setText($('setup-error'), '');
    state.code = code; state.who = setupWho;
    lsSet('rf_code', code); lsSet('rf_who', setupWho);
    $('setup-code').value = '';
    route();
    loadRecent();
    loadConfig();
  });
  $('setup-code').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('setup-go').click(); });

  // Setup link: #k=<code>
  function takeHashCode() {
    var m = /(?:^#|&)k=([^&]*)/.exec(window.location.hash || '');
    if (!m) return false;
    var code = '';
    try { code = decodeURIComponent(m[1]).trim(); } catch (e) { code = m[1].trim(); }
    try { history.replaceState(null, '', window.location.pathname + window.location.search); }
    catch (e) { try { window.location.hash = ''; } catch (e2) { /* ignore */ } }
    if (!code) return false;
    state.code = code;
    lsSet('rf_code', code);
    return true;
  }

  /* ---------- history layers (Android back button / iOS swipe) ---------- */
  function pushLayer(name) {
    if (state.stack.indexOf(name) !== -1) return;
    state.stack.push(name);
    try { history.pushState({ rf: name }, ''); } catch (e) { /* ignore */ }
  }
  function applyClose(name) {
    if (name === 'settings') { show($('settings'), false); }
    else if (name === 'work') { resetWork(); }
  }
  function closeLayer(name) {
    var i = state.stack.lastIndexOf(name);
    if (i === -1) { applyClose(name); return; }
    if (i === state.stack.length - 1) {
      try { history.back(); return; } catch (e) { /* fall through */ }
    }
    state.stack.splice(i, 1);
    applyClose(name);
  }
  window.addEventListener('popstate', function () {
    var name = state.stack.pop();
    if (name) applyClose(name);
  });

  /* ---------- selects + config (the family names come from the server, never from this code) ---------- */
  var config = null;
  function fillSelect(sel, items) {
    var keep = sel.value;
    sel.innerHTML = '';
    items.forEach(function (it) {
      var o = document.createElement('option');
      var val = Array.isArray(it) ? it[0] : it;
      var label = Array.isArray(it) ? it[1] : it;
      o.value = val; o.textContent = label;
      sel.appendChild(o);
    });
    if (keep && items.some(function (it) { return (Array.isArray(it) ? it[0] : it) === keep; })) sel.value = keep;
  }
  function applyConfig(cfg) {
    var cats = (cfg && Array.isArray(cfg.categories) && cfg.categories.length) ? cfg.categories : CATEGORIES;
    var taxes = (cfg && Array.isArray(cfg.taxTypes) && cfg.taxTypes.length)
      ? cfg.taxTypes.map(function (t) { return [t, t === '' ? 'No' : t]; }) : TAX_TYPES;
    var who = (cfg && Array.isArray(cfg.forWhom)) ? cfg.forWhom : [];
    config = { categories: cats, taxTypes: taxes, forWhom: who };
    fillSelect($('f-category'), cats);
    fillSelect($('f-tax'), taxes);
    fillSelect($('f-who'), [['', '(not sure)']].concat(who));
    if (cats.indexOf($('f-category').value) === -1) $('f-category').value = cats.indexOf('Other') !== -1 ? 'Other' : cats[0];
  }
  function loadConfig() {
    if (!state.code) return;
    api({ action: 'config' }).then(function (d) {
      applyConfig(d);
      lsSet('rf_cfg', JSON.stringify({ categories: d.categories, taxTypes: d.taxTypes, forWhom: d.forWhom }));
    }, function () { /* keep the cached / default lists */ });
  }
  (function () {
    var cached = null;
    try { cached = JSON.parse(lsGet('rf_cfg') || 'null'); } catch (e) { cached = null; }
    applyConfig(cached);
    $('f-category').value = 'Other';
  })();

  /* ---------- capture: camera, upload, add page ---------- */
  $('btn-snap').addEventListener('click', function () { $('file-cam').click(); });
  $('btn-upload').addEventListener('click', function () { $('file-up').click(); });
  $('btn-addpage').addEventListener('click', function () { $('file-add').click(); });
  function hookInput(id, isNew) {
    $(id).addEventListener('change', function () {
      var files = this.files ? Array.prototype.slice.call(this.files) : [];
      this.value = '';  // allow picking the same file again
      if (files.length) handleFiles(files, isNew);
    });
  }
  hookInput('file-cam', true);
  hookInput('file-up', true);
  hookInput('file-add', false);

  function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''); }

  function resizeToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('empty');
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          var out = c.toDataURL('image/jpeg', JPEG_Q);
          URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function readPdf(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > MAX_PDF_BYTES) { reject(new Error('big')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        if (i < 0) { reject(new Error('read')); return; }
        resolve('data:application/pdf;base64,' + s.slice(i + 1));   // force the type: some pickers leave it empty
      };
      fr.onerror = function () { reject(new Error('read')); };
      fr.readAsDataURL(file);
    });
  }

  function readOne(file) {
    var pdf = isPdf(file);
    return (pdf ? readPdf(file) : resizeToJpeg(file)).then(function (dataUrl) {
      return { page: { id: state.nextId++, mime: pdf ? 'application/pdf' : 'image/jpeg', dataUrl: dataUrl, name: file.name || '' } };
    }, function (e) {
      var nm = file.name ? '"' + file.name + '"' : 'A file';
      return { error: e && e.message === 'big' ? nm + ' is a PDF over 8 MB.' : nm + ' could not be read.' };
    });
  }

  function totalChars() { return state.pages.reduce(function (n, p) { return n + p.dataUrl.length; }, 0); }

  function beginReceipt() {
    state.seq++; state.aseq++;
    if (state.controller) { try { state.controller.abort(); } catch (e) { /* ignore */ } state.controller = null; }
    state.pages = [];
    clearForm();
    renderThumbs();
    show($('capture'), false);
    show($('work'), true);
    show($('form'), false);
    show($('retry-row'), false);
    show($('reread-row'), false);
    setText($('work-error'), '');
    show($('analyzing'), true);
    pushLayer('work');
  }

  function handleFiles(files, isNew) {
    if (isNew) beginReceipt();
    var mySeq = state.seq;
    var room = MAX_PAGES - state.pages.length;
    var notes = [];
    if (files.length > room) {
      notes.push('Only ' + MAX_PAGES + ' pages fit in one receipt. The extra files were skipped.');
      files = files.slice(0, room);
    }
    if (!files.length) { if (notes.length) toast(notes.join(' '), true); return; }
    var added = 0;
    // read in order, one at a time (keeps memory low on phones)
    files.reduce(function (chain, f) {
      return chain.then(function () {
        if (mySeq !== state.seq) return;
        return readOne(f).then(function (r) {
          if (mySeq !== state.seq) return;
          if (r.error) { notes.push(r.error); return; }
          if (totalChars() + r.page.dataUrl.length > MAX_TOTAL_CHARS) { notes.push('Too much data for one receipt. Some pages were skipped.'); return; }
          state.pages.push(r.page); added++;
        });
      });
    }, Promise.resolve()).then(function () {
      if (mySeq !== state.seq) return;
      if (notes.length) toast(notes.join(' '), true);
      renderThumbs();
      if (!state.pages.length) {
        show($('analyzing'), false);
        setText($('work-error'), 'Could not read that file. Please try another one.');
        show($('retry-row'), true);
        $('btn-retry').hidden = true; $('btn-manual').hidden = true;
        return;
      }
      if (added) pagesChanged();
    });
  }

  function removePage(id) {
    state.pages = state.pages.filter(function (p) { return p.id !== id; });
    if (!state.pages.length) { closeLayer('work'); return; }
    renderThumbs();
    pagesChanged();
  }

  // Pages were added or removed: read again by itself unless the user already typed in the form.
  function pagesChanged() {
    setText($('work-error'), '');
    show($('retry-row'), false);
    if (state.formShown && state.edited) {
      if (state.controller) { try { state.controller.abort(); } catch (e) { /* ignore */ } state.controller = null; state.aseq++; }
      show($('analyzing'), false);
      show($('form'), true);
      show($('reread-row'), true);
      return;
    }
    runAnalyze();
  }

  function renderThumbs() {
    var box = $('thumbs');
    box.innerHTML = '';
    state.pages.forEach(function (p, i) {
      var d = document.createElement('div'); d.className = 'thumb';
      if (p.mime === 'application/pdf') {
        var t = document.createElement('div'); t.className = 'pdf'; t.textContent = 'PDF';
        var sm = document.createElement('small'); sm.textContent = (p.name || '').slice(0, 18);
        t.appendChild(sm); d.appendChild(t);
      } else {
        var im = document.createElement('img'); im.alt = 'Page ' + (i + 1); im.src = p.dataUrl; d.appendChild(im);
      }
      var n = document.createElement('span'); n.className = 'num'; n.textContent = String(i + 1); d.appendChild(n);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove page ' + (i + 1));
      rm.addEventListener('click', function () { removePage(p.id); });
      d.appendChild(rm);
      box.appendChild(d);
    });
    $('btn-addpage').hidden = state.pages.length >= MAX_PAGES || !state.pages.length;
    setText($('pages-hint'), state.pages.length ? state.pages.length + ' of ' + MAX_PAGES + ' pages' : '');
  }

  function runAnalyze() {
    if (!state.pages.length) return;
    var my = ++state.aseq;
    var mySeq = state.seq;
    if (state.controller) { try { state.controller.abort(); } catch (e) { /* ignore */ } }
    show($('analyzing'), true);
    show($('retry-row'), false);
    show($('reread-row'), false);
    show($('form'), false);
    setText($('work-error'), '');
    var ctrl = new AbortController();
    state.controller = ctrl;
    api({ action: 'analyze', pages: state.pages.map(function (p) { return p.dataUrl; }) }, ctrl.signal).then(function (d) {
      if (my !== state.aseq || mySeq !== state.seq) return;  // a newer run (or cancel) took over
      state.controller = null;
      show($('analyzing'), false);
      fillForm(d);
      state.formShown = true; state.edited = false;
      show($('form'), true);
    }, function (e) {
      if (my !== state.aseq || mySeq !== state.seq) return;
      state.controller = null;
      show($('analyzing'), false);
      setText($('work-error'), friendlyError(e));
      show($('retry-row'), true);
      $('btn-retry').hidden = false;
      $('btn-manual').hidden = false;
      if (state.formShown && state.edited) show($('form'), true);
    });
  }

  $('btn-retry').addEventListener('click', function () { runAnalyze(); });
  $('btn-reread').addEventListener('click', function () { runAnalyze(); });
  $('btn-manual').addEventListener('click', function () {
    setText($('work-error'), '');
    show($('retry-row'), false);
    if (!state.edited) { clearForm(); $('f-date').value = todayStr(); }
    state.formShown = true;
    show($('form'), true);
  });
  $('btn-cancel').addEventListener('click', function () { closeLayer('work'); });
  $('btn-cancel2').addEventListener('click', function () { closeLayer('work'); });

  /* ---------- form ---------- */
  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function clearForm() {
    $('f-store').value = ''; $('f-date').value = ''; $('f-amount').value = '';
    $('f-category').value = 'Other'; $('f-tax').value = ''; $('f-who').value = '';
    $('f-note').value = ''; $('f-items').value = '';
    setText($('form-error'), ''); setText($('date-hint'), '');
    show($('confidence'), false);
    state.proof = { ok: null, missing: '' };
    state.formShown = false; state.edited = false;
    updateProofWarn();
  }
  function updateProofWarn() {
    var on = state.proof.ok === false && $('f-tax').value !== '';
    setText($('proof-warn'), on ? 'For taxes, ask for: ' + (state.proof.missing || 'a complete receipt with all the details') : '');
  }
  function fillForm(d) {
    $('f-store').value = d.store ? String(d.store) : '';
    var hasDate = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
    $('f-date').value = hasDate ? d.date : todayStr();
    setText($('date-hint'), hasDate ? '' : 'Date not found on the receipt. Showing today, please check it.');
    var amt = (typeof d.amount === 'number' && isFinite(d.amount)) ? d.amount : parseAmount(d.amount);
    $('f-amount').value = amt === null ? '' : amt.toFixed(2);
    $('f-category').value = config.categories.indexOf(d.category) !== -1 ? d.category : 'Other';
    var tax = d.taxType || '';
    $('f-tax').value = config.taxTypes.some(function (t) { return t[0] === tax; }) ? tax : '';
    var wh = d.forWhom || '';
    $('f-who').value = config.forWhom.indexOf(wh) !== -1 ? wh : '';
    $('f-items').value = d.items ? String(d.items) : '';
    state.proof = { ok: d.proofOk === false ? false : (d.proofOk === true ? true : null), missing: d.missing ? String(d.missing) : '' };
    updateProofWarn();
    var conf = d.confidence;
    var b = $('confidence');
    if (conf === 'high' || conf === 'medium' || conf === 'low') {
      b.className = 'badge ' + conf;
      b.textContent = conf === 'high' ? 'Read with high confidence' : 'Please double-check (' + conf + ' confidence)';
      b.hidden = false;
    } else { b.hidden = true; }
  }
  function parseAmount(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = String(v).replace(/[^0-9.,-]/g, '');
    if (!s) return null;
    if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) s = s.replace(',', '.');  // 12,50 -> 12.50
    else s = s.replace(/,/g, '');                                                  // 1,250.00 -> 1250.00
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  $('form').addEventListener('input', function () { state.edited = true; });
  $('form').addEventListener('change', function () { state.edited = true; });
  $('f-tax').addEventListener('change', updateProofWarn);

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (state.saving) return;
    var store = $('f-store').value.trim();
    var date = $('f-date').value;
    var amount = parseAmount($('f-amount').value);
    if (!store) return setText($('form-error'), 'Please enter the store name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setText($('form-error'), 'Please enter the date.');
    if (amount === null || amount <= 0) return setText($('form-error'), 'Please enter the total amount.');
    if (!state.pages.length) return setText($('form-error'), 'Please add a photo or PDF first.');
    setText($('form-error'), '');

    state.saving = true;
    var btn = $('btn-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    var mySeq = state.seq;
    var taxType = $('f-tax').value;
    api({
      action: 'save',
      pages: state.pages.map(function (p) { return p.dataUrl; }),
      date: date,
      amount: amount,
      store: store,
      category: $('f-category').value,
      taxType: taxType,
      forWhom: $('f-who').value,
      proofOk: taxType ? state.proof.ok : null,
      missing: taxType && state.proof.ok === false ? state.proof.missing : '',
      who: state.who,
      note: $('f-note').value.trim(),
      items: $('f-items').value.trim()
    }).then(function () {
      state.saving = false;
      btn.disabled = false; btn.textContent = 'Save';
      toast('Saved. Thank you, ' + state.who + '!');
      if (mySeq === state.seq) closeLayer('work');
      loadRecent();
    }, function (e) {
      state.saving = false;
      btn.disabled = false; btn.textContent = 'Save';
      setText($('form-error'), friendlyError(e));
    });
  });

  function resetWork() {
    var i = state.stack.lastIndexOf('work');
    if (i !== -1) state.stack.splice(i, 1);
    state.seq++; state.aseq++;
    if (state.controller) { try { state.controller.abort(); } catch (e) { /* ignore */ } state.controller = null; }
    state.pages = [];
    clearForm();
    renderThumbs();
    show($('work'), false);
    show($('analyzing'), false);
    show($('form'), false);
    show($('retry-row'), false);
    show($('reread-row'), false);
    setText($('work-error'), '');
    show($('capture'), true);
  }

  /* ---------- recent ---------- */
  var recentSeq = 0;
  function fmtMoney(n) {
    var v = Number(n);
    return isFinite(v) ? '$' + v.toFixed(2) : '';
  }
  function loadRecent() {
    var my = ++recentSeq;
    var list = $('recent');
    var msg = $('recent-msg');
    if (!state.code) return;
    msg.textContent = 'Loading...'; msg.hidden = false;
    api({ action: 'recent' }).then(function (d) {
      if (my !== recentSeq) return;
      list.innerHTML = '';
      var rows = (d && d.rows) || [];
      if (!rows.length) { msg.textContent = 'Nothing saved yet.'; return; }
      msg.hidden = true;
      rows.forEach(function (r) {
        var li = document.createElement('li');
        var s = document.createElement('span'); s.className = 's'; s.textContent = r.store || '(no store)';
        var a = document.createElement('span'); a.className = 'a'; a.textContent = fmtMoney(r.amount);
        var m = document.createElement('span'); m.className = 'm';
        m.textContent = [r.date, r.category, r.forWhom, r.who].filter(Boolean).join(' · ');
        if (r.proofOk === 'NO') {
          var fl = document.createElement('span'); fl.className = 'flag'; fl.textContent = ' · needs proof';
          m.appendChild(fl);
        }
        li.appendChild(s); li.appendChild(a); li.appendChild(m);
        list.appendChild(li);
      });
    }, function (e) {
      if (my !== recentSeq) return;
      list.innerHTML = '';
      msg.hidden = false;
      msg.textContent = 'Could not load recent receipts. ' + friendlyError(e);
    });
  }
  $('btn-refresh').addEventListener('click', loadRecent);

  /* ---------- settings ---------- */
  $('btn-settings').addEventListener('click', function () {
    $('set-who').value = state.who;
    $('set-code').value = state.code;
    $('set-code').type = 'password';
    $('set-show').checked = false;
    setText($('set-error'), '');
    $('version').textContent = 'Receipt Family v' + VERSION;
    show($('settings'), true);
    pushLayer('settings');
  });
  $('set-show').addEventListener('change', function () { $('set-code').type = this.checked ? 'text' : 'password'; });
  $('set-close').addEventListener('click', function () { closeLayer('settings'); });
  $('settings').addEventListener('click', function (ev) { if (ev.target === $('settings')) closeLayer('settings'); });
  $('set-save').addEventListener('click', function () {
    var code = $('set-code').value.trim();
    if (!code) return setText($('set-error'), 'The family code cannot be empty.');
    var setWho = $('set-who').value.trim();
    if (!setWho) return setText($('set-error'), 'Please type your first name.');
    var codeChanged = code !== state.code;
    state.code = code; state.who = setWho;
    lsSet('rf_code', code); lsSet('rf_who', setWho);
    $('who-name').textContent = state.who;
    closeLayer('settings');
    toast('Settings saved');
    if (codeChanged) { loadRecent(); loadConfig(); }
  });

  /* ---------- service worker (http/https only, not inside the APK) ---------- */
  function registerSW() {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (!/^https?:$/.test(window.location.protocol)) return;
      if (window.location.hostname === 'appassets.androidplatform.net') return;
      if (/ReceiptFamilyApp/.test(navigator.userAgent)) return;
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------- boot ---------- */
  takeHashCode();
  window.addEventListener('hashchange', function () { if (takeHashCode()) { route(); loadRecent(); loadConfig(); } });
  route();
  if (state.code && state.who) { loadRecent(); loadConfig(); }
  registerSW();
})();
