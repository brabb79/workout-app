// Workout Log. All data lives in this phone's localStorage. Export and Backup are the owner's copy.
import { initProgram, renderToday, programSessions } from './program-ui.js';
const KEY = 'wt.entries.v1';
const SKEY = 'wt.settings.v1';
// Matched to the owner's equipment (docs/OWNER.md): kettlebells, maces, clubs, bands, bodyweight, bow trainer.
const STARTER_LIFTS = ['Kettlebell swing', 'Goblet squat', 'Kettlebell press', 'Kettlebell row', 'Kettlebell clean', 'Turkish get-up', 'Kettlebell deadlift', 'Mace 360', 'Mace 10-to-2', 'Mace squat', 'Indian club swing', 'Band pull-apart', 'Band row', 'Band press', 'Push-up', 'Pull-up', 'Dead hang', 'Lunge', 'Split squat', 'Step-up', 'Glute bridge', 'Plank', 'Bow trainer draw', 'Tibialis raise', 'Calf raise'];
const STARTER_CARDIO = ['Jump rope', 'Walk', 'Ruck', 'Kettlebell swing intervals', 'Run', 'Bike', 'Row', 'Swim', 'Hike'];

const $ = id => document.getElementById(id);
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = list => localStorage.setItem(KEY, JSON.stringify(list));
const settings = () => { try { return Object.assign({ units: 'lb', awake: true }, JSON.parse(localStorage.getItem(SKEY)) || {}); } catch { return { units: 'lb', awake: true }; } };
const saveSettings = s => localStorage.setItem(SKEY, JSON.stringify(s));
const wUnit = () => settings().units === 'lb' ? 'lb' : 'kg';
const dUnit = () => settings().units === 'lb' ? 'mi' : 'km';
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const nowHm = () => new Date().toTimeString().slice(0, 5);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = n => (n === '' || n == null || isNaN(n)) ? '' : String(+n);

let entries = load();
let editingId = null; // id of the entry being edited, or null

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1500); }

function lastOf(type, name) {
  const n = (name || '').trim().toLowerCase();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === type && (type === 'body' || (e.name || '').toLowerCase() === n)) return e;
  }
  return null;
}
function describe(e) {
  if (e.type === 'lift') return e.sets.map(s => `${fmt(s.reps)}x${fmt(s.weight)}`).join(', ') + ` ${e.units}`;
  if (e.type === 'cardio') return `${fmt(e.minutes)} min` + (e.distance ? `, ${fmt(e.distance)} ${e.distUnits}` : '');
  return `${fmt(e.weight)} ${e.units}`;
}
function names(type) {
  const seen = new Set(type === 'lift' ? STARTER_LIFTS : STARTER_CARDIO);
  entries.filter(e => e.type === type).forEach(e => seen.add(e.name));
  return [...seen];
}
function fillList(id, list) { $(id).innerHTML = list.map(n => `<option value="${n.replace(/"/g, '&quot;')}">`).join(''); }

// Forms
function showForm(type) {
  ['liftForm', 'cardioForm', 'bodyForm'].forEach(id => $(id).classList.add('hidden'));
  const id = { lift: 'liftForm', cardio: 'cardioForm', body: 'bodyForm' }[type];
  $(id).classList.remove('hidden');
  document.querySelectorAll('.wUnit').forEach(el => el.textContent = wUnit());
  document.querySelectorAll('.distUnit').forEach(el => el.textContent = dUnit());
  if (type === 'lift') { fillList('liftList', names('lift')); if (!$('sets').children.length) addSet(); $('liftName').focus(); }
  if (type === 'cardio') { fillList('cardioList', names('cardio')); $('cardioName').focus(); }
  if (type === 'body') { const l = lastOf('body'); $('bodyLast').textContent = l ? `Last: ${describe(l)} on ${l.date}` : ''; $('bodyWeight').focus(); }
  $(id).querySelector('button[type=submit]').textContent = editingId ? 'Update' : 'Save';
  $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Tap a saved entry: reopen its form with its values; Save replaces it.
function editEntry(e) {
  editingId = e.id;
  if (e.type === 'lift') { $('sets').innerHTML = ''; showForm('lift'); $('liftName').value = e.name; $('sets').innerHTML = ''; e.sets.forEach(s => addSet(fmt(s.reps), fmt(s.weight))); $('liftNote').value = e.note || ''; liftHint(); }
  if (e.type === 'cardio') { showForm('cardio'); $('cardioName').value = e.name; $('cardioMin').value = fmt(e.minutes); $('cardioDist').value = e.distance ? fmt(e.distance) : ''; $('cardioNote').value = e.note || ''; cardioHint(); }
  if (e.type === 'body') { showForm('body'); $('bodyWeight').value = fmt(e.weight); }
}
function hideForms() { editingId = null; ['liftForm', 'cardioForm', 'bodyForm'].forEach(id => $(id).classList.add('hidden')); }

function addSet(reps = '', weight = '') {
  const sets = $('sets');
  const n = sets.children.length + 1;
  const prev = sets.lastElementChild;
  if (reps === '' && prev) { reps = prev.querySelector('.reps').value; weight = prev.querySelector('.weight').value; }
  const div = document.createElement('div');
  div.className = 'set';
  div.innerHTML = `<div class="n">${n}</div>
    <input class="reps" type="number" inputmode="numeric" min="0" placeholder="reps" value="${reps}" required>
    <input class="weight" type="number" inputmode="decimal" min="0" step="any" placeholder="${wUnit()}" value="${weight}">
    <button type="button" class="ghost danger rm" aria-label="Remove set">x</button>`;
  div.querySelector('.rm').onclick = () => { div.remove(); [...sets.children].forEach((c, i) => c.querySelector('.n').textContent = i + 1); };
  sets.appendChild(div);
}
function liftHint() {
  const l = lastOf('lift', $('liftName').value);
  $('liftLast').textContent = l ? `Last: ${describe(l)} on ${l.date}` : '';
  return l;
}
function prefillLift() {
  const l = liftHint();
  if (l && [...$('sets').querySelectorAll('.reps')].every(i => i.value === '')) {
    $('sets').innerHTML = '';
    l.sets.forEach(s => addSet(fmt(s.reps), fmt(s.weight)));
  }
}
function cardioHint() {
  const l = lastOf('cardio', $('cardioName').value);
  $('cardioLast').textContent = l ? `Last: ${describe(l)} on ${l.date}` : '';
}

function addEntry(e) {
  const old = editingId && entries.find(x => x.id === editingId);
  if (old) { Object.assign(old, e); }
  else { e.id = uid(); e.date = $('date').value || todayIso(); e.time = nowHm(); entries.push(e); }
  save(entries); render(); hideForms(); toast(old ? 'Updated' : 'Saved');
}
$('liftForm').onsubmit = ev => {
  ev.preventDefault();
  const sets = [...$('sets').children].map(c => ({ reps: +c.querySelector('.reps').value, weight: +c.querySelector('.weight').value || 0 }));
  if (!sets.length) return;
  addEntry({ type: 'lift', name: $('liftName').value.trim(), sets, units: wUnit(), note: $('liftNote').value.trim() });
  $('liftForm').reset(); $('sets').innerHTML = ''; $('liftLast').textContent = '';
};
$('cardioForm').onsubmit = ev => {
  ev.preventDefault();
  addEntry({ type: 'cardio', name: $('cardioName').value.trim(), minutes: +$('cardioMin').value, distance: +$('cardioDist').value || 0, distUnits: dUnit(), note: $('cardioNote').value.trim() });
  $('cardioForm').reset(); $('cardioLast').textContent = '';
};
$('bodyForm').onsubmit = ev => {
  ev.preventDefault();
  addEntry({ type: 'body', weight: +$('bodyWeight').value, units: wUnit(), note: '' });
  $('bodyForm').reset();
};
document.querySelectorAll('.types button').forEach(b => b.onclick = () => showForm(b.dataset.type));
document.querySelectorAll('.cancel').forEach(b => b.onclick = hideForms);
$('addSet').onclick = () => addSet();
$('liftName').onchange = prefillLift;
$('liftName').oninput = liftHint;
$('cardioName').oninput = cardioHint;

// Render
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function entryHtml(e) {
  const what = e.type === 'body' ? 'Bodyweight' : e.name;
  return `<div class="entry"><div class="tap" data-edit="${e.id}"><div class="what">${esc(what)}</div><div class="detail">${esc(describe(e))}${e.note ? ' / ' + esc(e.note) : ''}</div></div>
    <button class="ghost danger" data-del="${e.id}" aria-label="Delete">x</button></div>`;
}
function render() {
  const date = $('date').value || todayIso();
  $('dateLabel').textContent = date === todayIso() ? 'today' : date;
  const today = entries.filter(e => e.date === date);
  $('today').innerHTML = today.length ? today.map(entryHtml).join('') : '<div class="hint">Nothing logged yet.</div>';
  const byDay = {};
  entries.filter(e => e.date !== date).forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const days = Object.keys(byDay).sort().reverse().slice(0, 30);
  $('history').innerHTML = days.map(d => `<div class="day">${d}</div><div class="card">${byDay[d].map(entryHtml).join('')}</div>`).join('') || '<div class="hint">No earlier days.</div>';
  document.querySelectorAll('[data-edit]').forEach(d => d.onclick = () => { const e = entries.find(x => x.id === d.dataset.edit); if (e) editEntry(e); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('Delete this entry?')) return;
    entries = entries.filter(e => e.id !== b.dataset.del); save(entries); render();
  });
}

// Export and backup (N2: the owner's data is readable without the app)
function csv() {
  const rows = [['date', 'time', 'type', 'name', 'set', 'reps', 'weight', 'weight_unit', 'minutes', 'distance', 'distance_unit', 'bodyweight', 'note']];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  [...entries].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).forEach(e => {
    if (e.type === 'lift') e.sets.forEach((s, i) => rows.push([e.date, e.time, 'lift', e.name, i + 1, s.reps, s.weight, e.units, '', '', '', '', e.note]));
    else if (e.type === 'cardio') rows.push([e.date, e.time, 'cardio', e.name, '', '', '', '', e.minutes, e.distance, e.distUnits, '', e.note]);
    else rows.push([e.date, e.time, 'body', '', '', '', '', '', '', '', '', e.weight, e.note]);
  });
  return rows.map(r => r.map(q).join(',')).join('\n');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
$('exportCsv').onclick = () => download(`workouts-${todayIso()}.csv`, csv(), 'text/csv');
$('backup').onclick = () => download(`workouts-backup-${todayIso()}.json`, JSON.stringify({ version: 2, settings: settings(), entries, sessions: JSON.parse(localStorage.getItem('wt.sessions.v1') || '[]'), program: JSON.parse(localStorage.getItem('wt.program.v1') || 'null') }, null, 1), 'application/json');
$('restore').onclick = () => $('restoreFile').click();
$('restoreFile').onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(list)) throw new Error('no entries');
    const ids = new Set(entries.map(e => e.id));
    const added = list.filter(e => e && e.id && !ids.has(e.id));
    entries = entries.concat(added); save(entries);
    if (data.settings) { saveSettings(data.settings); $('units').value = settings().units; }
    if (Array.isArray(data.sessions) && !localStorage.getItem('wt.sessions.v1')) localStorage.setItem('wt.sessions.v1', JSON.stringify(data.sessions));
    if (data.program && !localStorage.getItem('wt.program.v1')) localStorage.setItem('wt.program.v1', JSON.stringify(data.program));
    render(); toast(`Restored ${added.length} entries`);
  } catch (err) { alert('Could not read that backup: ' + err.message); }
  ev.target.value = '';
};

// Settings and date
$('units').value = settings().units;
$('units').onchange = () => { saveSettings(Object.assign(settings(), { units: $('units').value })); document.querySelectorAll('.wUnit').forEach(el => el.textContent = wUnit()); document.querySelectorAll('.distUnit').forEach(el => el.textContent = dUnit()); };
$('date').value = todayIso();
$('date').onchange = render;
render();

// Program screens (Today, workout mode, finish).
initProgram({ onToast: toast, onRender: render });

// Keep the screen on while the app is open, so the phone does not lock between sets.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not supported or refused: the phone locks as usual */ }
}
$('awake').checked = !!settings().awake;
$('awake').onchange = () => { saveSettings(Object.assign(settings(), { awake: $('awake').checked })); keepAwake($('awake').checked); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(!!settings().awake); });
keepAwake(!!settings().awake);

// Keep the data when the phone is short on space, and work offline.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
