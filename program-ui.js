// Program screens: Today, workout mode, finish summary. Storage lives here; rules live in engine.js.
import * as E from './engine.js';

const $ = id => document.getElementById(id);
const SKEY = 'wt.program.v1', SESS = 'wt.sessions.v1', LIVE = 'wt.session.v1';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

let program = null, state = null, sessions = [], live = null;

export async function initProgram({ onToast, onRender }) {
  try {
    program = await (await fetch('docs/program/program.json')).json();
  } catch (e) { $('todayCard').innerHTML = '<div class="hint">Program not loaded. The log below still works.</div>'; return; }
  state = read(SKEY, null) || E.initState();
  sessions = read(SESS, []);
  live = read(LIVE, null);
  if (live) showWorkout(); else renderToday();
  $('finishBtn').onclick = finish;
  $('cancelBtn').onclick = () => { if (confirm('Stop without saving this workout?')) { live = null; localStorage.removeItem(LIVE); hideWorkout(); renderToday(); } };
  $('doneBtn').onclick = () => { $('summary').classList.add('hidden'); renderToday(); };
  window.addEventListener('focus', () => { if (!live) renderToday(); });
  initProgram.toast = onToast; initProgram.render = onRender;
}
const save = () => { write(SKEY, state); write(SESS, sessions); if (live) write(LIVE, live); else localStorage.removeItem(LIVE); };
const unitWord = (mode, unit) => ({ reps: 'reps', seconds: 's', rounds: 'rounds', distance: 'mi' }[mode] || unit);
const fmtTarget = b => b.mode === 'rounds' ? `${b.attempt} rounds this time (${b.target.min} to ${b.target.max})` : (b.target.min === b.target.max ? `${b.target.min} ${unitWord(b.mode, b.unit)}` : `${b.target.min} to ${b.target.max} ${unitWord(b.mode, b.unit)}`);

export function renderToday() {
  if (!program) return;
  const today = todayIso();
  const plan = E.todayPlan(program, state, sessions, today);
  save();
  const w = plan.required;
  const gate = plan.gate;
  const confirmKey = 'doctor_asked_about_intensity';
  const askDoctor = state.confirms[confirmKey] == null;
  $('todayCard').innerHTML = `
    <div class="card">
      <div class="row" style="align-items:flex-start"><div style="flex:1"><div class="what">${esc(w.name)}</div><div class="detail">${esc(w.focus)}. About ${w.minutes} min.</div></div>
      <button class="primary" data-start="${w.id}" style="flex:0 0 auto">Start</button></div>
      ${plan.notes.map(n => `<div class="hint" style="margin-top:8px">${esc(n)}</div>`).join('')}
    </div>
    <div class="row" style="flex-wrap:wrap">${plan.light.map(l => `<button data-start="${l.id}" class="light">${esc(l.name)} <span class="detail">${l.minutes}m</span></button>`).join('')}</div>
    <details style="margin-top:10px"><summary class="hint">Phase 2 progress${gate.open ? ': open' : ''} and settings</summary>
      <div class="card">
        ${gate.lines.map(l => `<div class="detail">${l.ok ? '[done]' : '[    ]'} ${esc(l.text)}</div>`).join('')}
        ${askDoctor ? `<div style="margin-top:10px"><div class="hint">${esc(gateQuestion())}</div><div class="actions"><button data-confirm="yes">Yes, I asked</button><button data-confirm="limit">Doctor set a limit</button></div></div>` : ''}
        <div class="actions" style="margin-top:10px">${state.confirms.hang_bar ? '<span class="detail">Hang bar: yes</span>' : '<button data-hangbar="1">I have a hang bar</button>'}</div>
        ${state.flags.length ? `<div class="hint" style="margin-top:10px">Trainer review: ${state.flags.map(f => esc(f.text)).join('; ')}</div>` : ''}
      </div></details>`;
  $('todayCard').querySelectorAll('[data-start]').forEach(b => b.onclick = () => start(b.dataset.start));
  $('todayCard').querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => { E.setConfirm(program, state, confirmKey, b.dataset.confirm); save(); renderToday(); });
  const hb = $('todayCard').querySelector('[data-hangbar]'); if (hb) hb.onclick = () => { E.setHangBar(program, state); save(); renderToday(); };
}
function gateQuestion() { const g = program.progression.find(r => r.rule === 'gate'); const q = g && g.params.requires.find(r => r.owner_confirm); return q ? q.prompt : ''; }

function start(workoutId) {
  const today = todayIso();
  const { session } = E.startSession(program, state, sessions, workoutId, today);
  session.startedAt = new Date().toISOString();
  live = session; save(); showWorkout();
}

function showWorkout() {
  document.body.classList.add('inWorkout');
  $('workout').classList.remove('hidden');
  $('workoutTitle').textContent = live.name;
  const flags = [];
  if (live.intro) flags.push('intro period: easy on purpose');
  if (live.deload) flags.push('deload week');
  $('workoutNote').textContent = flags.join(', ');
  $('blocks').innerHTML = live.blocks.map((b, i) => blockHtml(b, i)).join('');
  $('blocks').querySelectorAll('input[data-set]').forEach(inp => inp.oninput = () => { const [bi, si] = inp.dataset.set.split('.'); live.blocks[+bi].sets[+si].value = inp.value === '' ? '' : +inp.value; write(LIVE, live); });
  $('blocks').querySelectorAll('input[data-minutes]').forEach(inp => inp.oninput = () => { live.blocks[+inp.dataset.minutes].minutes = inp.value === '' ? null : +inp.value; write(LIVE, live); });
  $('blocks').querySelectorAll('input[data-pain]').forEach(inp => inp.onchange = () => { live.blocks[+inp.dataset.pain].pain = inp.checked; write(LIVE, live); });
  $('blocks').querySelectorAll('[data-unpark]').forEach(b => b.onclick = () => { E.unpark(program, state, b.dataset.unpark); save(); const { session } = E.startSession(program, state, sessions, live.workout, live.date); session.startedAt = live.startedAt; live = session; save(); showWorkout(); });
  window.scrollTo(0, 0);
}
function hideWorkout() { document.body.classList.remove('inWorkout'); $('workout').classList.add('hidden'); }

function blockHtml(b, i) {
  if (b.parked) return `<div class="card"><div class="what">${esc(b.name)}</div><div class="hint">${esc(b.bumped || 'Parked.')}</div><div class="actions"><button data-unpark="${b.key}">Unpark</button></div></div>`;
  const interval = b.work ? `${b.work} s work, ${b.rest} s rest. ` : (b.rest ? `Rest ${b.rest} s. ` : '');
  const inputs = b.sets.map((s, si) => `<div class="setcell"><label>${s.side ? s.side : (b.mode === 'distance' ? 'miles' : 'set ' + (si + 1))}</label><input type="number" inputmode="decimal" step="any" min="0" data-set="${i}.${si}" value="${s.value}"></div>`).join('') + (b.mode === 'distance' ? `<div class="setcell"><label>minutes</label><input type="number" inputmode="numeric" min="0" data-minutes="${i}" value="${b.minutes ?? ''}"></div>` : '');
  return `<div class="card${b.bumped ? ' bumped' : ''}">
    <div class="what">${esc(b.name)} <span class="detail">${esc(b.load)}</span></div>
    <div class="detail">${fmtTarget(b)}. ${interval}${b.notes ? esc(b.notes) : ''}</div>
    ${b.bumped ? `<div class="bump">Changed: ${esc(b.bumped)}</div>` : ''}
    <div class="sets">${inputs}</div>
    ${b.fixed ? '' : `<label class="painrow"><input type="checkbox" data-pain="${i}"> pain, not burn</label>`}
  </div>`;
}

function finish() {
  const today = todayIso();
  live.blocks.forEach(b => { b.sets = b.sets.filter(s => s.value !== '' && s.value != null); });
  const { results } = E.finishSession(program, state, sessions, live, today);
  live = null; save();
  hideWorkout();
  const lines = results.map(r => `<div class="entry"><div><div class="what">${esc(r.name)}</div><div class="detail">${r.result}${r.change ? ': ' + esc(r.change) : ''}</div></div></div>`).join('');
  $('summaryBody').innerHTML = lines || '<div class="hint">Saved. Light workouts change nothing in the program.</div>';
  $('summary').classList.remove('hidden');
  window.scrollTo(0, 0);
  if (initProgram.toast) initProgram.toast('Workout saved');
}

export function programSessions() { return sessions; }
