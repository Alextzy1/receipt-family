// Mock backend for browser tests: replaces fetch for the fake API URL. Fake names only (the repo is public).
window.RF_CONFIG = { apiUrl: 'https://mock.invalid/exec' };
window.__calls = [];
try { localStorage.setItem('rf_code', 'test-code'); localStorage.setItem('rf_who', 'Tester'); localStorage.removeItem('rf_cfg'); } catch (e) {}
window.__analyzeResult = { ok: true, store: 'Test Clinic', date: '2026-10-01', amount: 120.5, category: 'Therapy', taxType: 'Medical expense',
  forWhom: 'TestKid', proofOk: false, missing: 'practitioner name and registration number', items: 'Therapy session', confidence: 'high' };
window.fetch = function (url, opts) {
  var body = JSON.parse(opts.body);
  window.__calls.push(body);
  var res;
  if (body.action === 'config') res = { ok: true, categories: ['Groceries', 'Therapy', 'Other'], taxTypes: ['', 'Medical expense', 'Donation'], forWhom: ['TestAdult', 'TestKid', 'TestFamily'] };
  else if (body.action === 'analyze') res = window.__analyzeResult;
  else if (body.action === 'save') res = { ok: true, saved: true, file: 'x.pdf' };
  else if (body.action === 'recent') res = { ok: true, rows: [{ date: '2026-10-01', store: 'Test Clinic', amount: '$120.50', category: 'Therapy', who: 'Tester', forWhom: 'TestKid', proofOk: 'NO' }] };
  else res = { ok: false, error: 'unknown' };
  return new Promise(function (r) { setTimeout(function () { r({ text: function () { return Promise.resolve(JSON.stringify(res)); } }); }, 150); });
};
