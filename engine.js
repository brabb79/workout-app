// Program engine. Pure: no DOM, no storage, no clock. See docs/specs/ENGINE.md and docs/program/PROGRESSION.md.
// Dates are 'YYYY-MM-DD' strings.

export const DAY = 86400000;
export function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }
export function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
export function weekKey(d) { const t = new Date(Date.parse(d + 'T00:00:00Z')); const dow = (t.getUTCDay() + 6) % 7; return addDays(d, -dow); }

const rule = (program, name, appliesTo) => program.progression.find(r => r.rule === name && (appliesTo == null || r.applies_to === appliesTo)) || null;
const exById = (program, id) => program.exercises.find(e => e.id === id);
export const blockKey = (workoutId, i) => `${workoutId}#${i}`;

export function ladders(program) {
  return program.progression.filter(r => r.rule === 'ladder').map(r => r.params.rungs);
}
export function ladderOf(program, exerciseId) {
  const l = ladders(program).find(r => r.includes(exerciseId));
  return l ? { rungs: l, index: l.indexOf(exerciseId) } : { rungs: [exerciseId], index: 0 };
}

export function initState() {
  return { version: 1, startedOn: null, introUntil: null, blocks: {}, lastRequired: null, confirms: { doctor_asked_about_intensity: null, hang_bar: false }, flags: [], weeks: {} };
}

function blockState(program, state, workout, i) {
  const key = blockKey(workout.id, i);
  if (!state.blocks[key]) {
    const b = workout.blocks[i];
    state.blocks[key] = { rung: b.exercise, sets: b.sets, target: { ...b.target }, attempt: b.target.min, hits: 0, misses: 0, setsRaised: 0, pain: [], parked: false, bumped: null };
  }
  return state.blocks[key];
}

// Week records and deload
export function weekInfo(program, state, today) {
  const p = rule(program, 'deload', 'all').params;
  const keys = Object.keys(state.weeks).sort();
  const cur = weekKey(today);
  const all = keys.includes(cur) ? keys : [...keys, cur].sort();
  let counter = 0, deload = false, prevMisses = 0;
  for (const k of all) {
    const w = state.weeks[k] || { finished: 0, misses: 0 };
    counter += 1;
    deload = prevMisses >= p.early_if_misses_in_week || counter >= p.every_weeks;
    if (deload) counter = 0;
    prevMisses = w.misses;
    if (k === cur) break;
  }
  return { key: cur, deload, programWeek: all.indexOf(cur) + 1 };
}

export function lastFinished(sessions) {
  let last = null;
  for (const s of sessions) if (s.finishedAt && (!last || s.date > last.date)) last = s;
  return last;
}
export function missedBand(program, sessions, today) {
  const last = lastFinished(sessions);
  if (!last) return null;
  const days = dayDiff(last.date, today);
  const bands = rule(program, 'missed_time', 'all').params.bands;
  return bands.find(b => days >= b.min_days && (b.max_days == null || days <= b.max_days)) || null;
}

export function inIntro(state, today) { return !!state.introUntil && today < state.introUntil; }

export function rotation(program, state) {
  const r = rule(program, 'next_required', 'rotation').params;
  const order = r.order;
  const idx = state.lastRequired ? order.indexOf(state.lastRequired) : -1;
  let next = order[(idx + 1) % order.length];
  if (state.phase2Open && r.phase2_replaces[next]) next = r.phase2_replaces[next];
  return next;
}
export function isRequired(program, workoutId) {
  const r = rule(program, 'next_required', 'rotation').params;
  return r.order.includes(workoutId) || Object.values(r.phase2_replaces).includes(workoutId);
}

// Phase 2 gate
export function gateStatus(program, state, sessions, today) {
  const g = rule(program, 'gate', null);
  if (!g) return { open: false, lines: [] };
  const pain = rule(program, 'pain_mark', 'all').params;
  const lines = [];
  let open = true;
  for (const req of g.params.requires) {
    let ok = false, text = '';
    if (req.exercise) {
      const sessionsMet = sessions.filter(s => s.finishedAt && s.blocks.some(b => b.exercise === req.exercise && b.sets.length > 0 && meets(b, req))).length;
      ok = sessionsMet >= req.sessions;
      text = `${exName(program, req.exercise)}: ${req.sets_at_least ? req.sets_at_least + ' sets of ' : ''}${req.value_at_least}${req.per_side ? ' each side' : ''} in ${req.sessions} session${req.sessions > 1 ? 's' : ''} (${Math.min(sessionsMet, req.sessions)} of ${req.sessions})`;
    } else if (req.pain_free_days) {
      const legKeys = Object.entries(state.blocks).filter(([k, b]) => pain.leg_workouts_for_gate.some(w => k.startsWith(w + '#')) || pain.leg_exercises_for_gate.includes(b.rung));
      const lastPain = legKeys.flatMap(([, b]) => b.pain).sort().pop();
      const days = lastPain ? dayDiff(lastPain, today) : Infinity;
      ok = days >= req.pain_free_days;
      text = `${req.pain_free_days} days with no pain mark on a leg exercise (${lastPain ? Math.min(days, req.pain_free_days) : req.pain_free_days} of ${req.pain_free_days})`;
    } else if (req.owner_confirm) {
      const v = state.confirms[req.owner_confirm];
      ok = v === 'yes';
      text = v === 'limit' ? 'Your doctor set a limit: Phase 2 stays closed until the trainer writes it in.' : (v === 'yes' ? 'Doctor asked about intensity: yes' : 'Doctor asked about intensity: not yet');
    }
    if (!ok) open = false;
    lines.push({ ok, text });
  }
  return { open, lines, workout: g.applies_to, replaces: g.params.replaces };
}
function meets(b, req) {
  const vals = b.sets.map(s => +s.value || 0);
  if (req.per_side) {
    const l = vals.filter((_, i) => i % 2 === 0), r = vals.filter((_, i) => i % 2 === 1);
    const perSide = Math.min(l.length, r.length);
    if (req.sets_at_least && perSide < req.sets_at_least) return false;
    const okSets = l.map((v, i) => Math.min(v, r[i] ?? 0) >= req.value_at_least);
    return req.sets_at_least ? okSets.filter(Boolean).length >= req.sets_at_least : okSets.some(Boolean);
  }
  if (req.sets_at_least) return vals.filter(v => v >= req.value_at_least).length >= req.sets_at_least;
  return vals.some(v => v >= req.value_at_least);
}
const exName = (program, id) => (exById(program, id) || { name: id }).name;

// Today
export function todayPlan(program, state, sessions, today) {
  const gate = gateStatus(program, state, sessions, today);
  state.phase2Open = state.phase2Open || gate.open;
  if (Object.entries(state.blocks).some(([k, b]) => b.parked && isLeg(program, k, b))) state.phase2Open = false;
  const next = rotation(program, state);
  const r = rule(program, 'next_required', 'rotation').params;
  const light = program.workouts.filter(w => !r.order.includes(w.id) && !Object.values(r.phase2_replaces).includes(w.id));
  const band = missedBand(program, sessions, today);
  const week = weekInfo(program, state, today);
  const notes = [];
  if (inIntro(state, today)) notes.push(`Intro period until ${state.introUntil}: one set fewer, targets at the minimum, nothing counts yet. Easy on purpose.`);
  else if (week.deload) notes.push('Deload week: one set fewer and targets at the minimum. The lighter week is the plan.');
  if (band) notes.push(band.rungs_back ? `${band.min_days}+ days away: exercises step back ${band.rungs_back} rung${band.rungs_back > 1 ? 's' : ''} when you start.` : `${band.min_days}+ days away: one set fewer this time.`);
  return { required: program.workouts.find(w => w.id === next), light, notes, gate, week, band, intro: inIntro(state, today) };
}
function isLeg(program, key, b) { const p = rule(program, 'pain_mark', 'all').params; return p.leg_exercises_for_gate.includes(b.rung) || p.leg_workouts_for_gate.some(w => key.startsWith(w + '#')); }

// Start
export function startSession(program, state, sessions, workoutId, today) {
  const workout = program.workouts.find(w => w.id === workoutId);
  const required = isRequired(program, workoutId);
  const band = required ? missedBand(program, sessions, today) : null;
  const intro = inIntro(state, today);
  const week = weekInfo(program, state, today);
  const lighter = required && (intro || week.deload || (band && band.sets_minus));
  const countStreaks = required && !intro && !week.deload && !(band && band.count_streaks === false);
  // Bands two and three change the state for good, once, when the workout starts.
  if (band && band.rungs_back && !state.bandAppliedOn) {
    for (const [k, b] of Object.entries(state.blocks)) {
      const l = ladderOf(program, b.rung);
      const ni = Math.max(0, l.index - band.rungs_back);
      if (ni !== l.index) { b.rung = l.rungs[ni]; const wb = writtenBlock(program, k); if (wb) b.target = { ...wb.target }; b.bumped = 'stepped back after time away'; }
      else if (!band.sets) { b.sets = Math.max(band.sets_min || 2, b.sets - 1); b.bumped = 'one set fewer after time away'; }
      if (band.sets === 'written') { const wb = writtenBlock(program, k); if (wb) b.sets = wb.sets; b.setsRaised = 0; }
      if (band.reset_streaks || band.sets === 'written') { b.hits = 0; b.misses = 0; }
    }
    if (band.intro_days) state.introUntil = addDays(today, band.intro_days);
    state.bandAppliedOn = today;
  }
  if (state.bandAppliedOn && lastFinished(sessions) && dayDiff(lastFinished(sessions).date, today) < 7) state.bandAppliedOn = null;
  const lastOfBlock = key => { for (let i = sessions.length - 1; i >= 0; i--) { const s = sessions[i]; if (!s.finishedAt) continue; const b = s.blocks.find(x => x.key === key); if (b && b.sets.length) return b; } return null; };
  const blocks = workout.blocks.map((wb, i) => {
    const bs = blockState(program, state, workout, i);
    const ex = exById(program, bs.rung) || exById(program, wb.exercise);
    const sets = wb.fixed ? wb.sets : (lighter ? Math.max(2, bs.sets - 1) : bs.sets);
    const target = wb.fixed ? { ...wb.target } : { ...bs.target };
    const last = lastOfBlock(blockKey(workout.id, i));
    let def = target.min;
    if (ex.mode === 'rounds') def = bs.attempt;
    const n = wb.per_side ? sets * 2 : sets;
    const setList = [];
    for (let s = 0; s < n; s++) {
      let v = def;
      if (!(intro || week.deload) && last && last.sets[s] != null && ex.mode !== 'rounds') v = Math.min(target.max, Math.max(target.min, +last.sets[s].value || target.min));
      setList.push({ side: wb.per_side ? (s % 2 === 0 ? 'L' : 'R') : null, value: v });
    }
    return { key: blockKey(workout.id, i), exercise: bs.rung, name: ex.name, mode: ex.mode, unit: ex.unit, load: wb.load, rest: wb.rest_seconds, work: wb.work_seconds || null, fixed: !!wb.fixed, perSide: !!wb.per_side, parked: bs.parked, bumped: bs.bumped, target, sets: setList, notes: wb.notes || '', pain: false };
  });
  return { session: { id: null, date: today, workout: workoutId, name: workout.name, required, startedAt: null, finishedAt: null, countStreaks, intro, deload: week.deload, blocks }, state };
}
function writtenBlock(program, key) { const [wid, i] = key.split('#'); const w = program.workouts.find(x => x.id === wid); return w ? w.blocks[+i] : null; }

// Finish
export function finishSession(program, state, sessions, session, today) {
  const results = [];
  if (session.required) {
    if (!state.startedOn) { state.startedOn = today; state.introUntil = addDays(today, rule(program, 'intro_weeks', 'all').params.days); session.intro = true; session.countStreaks = false; }
    const wk = weekKey(today);
    state.weeks[wk] = state.weeks[wk] || { finished: 0, misses: 0 };
    state.weeks[wk].finished += 1;
    for (const sb of session.blocks) {
      if (sb.parked) continue;
      const bs = state.blocks[sb.key];
      bs.bumped = null;
      if (sb.pain) { applyPain(program, state, bs, sb, today); results.push({ key: sb.key, name: sb.name, result: 'PAIN', change: bs.bumped }); continue; }
      if (sb.fixed) continue;
      const res = resultOf(sb);
      if (res === 'MISS') state.weeks[wk].misses += 1;
      let change = null;
      if (session.countStreaks) {
        if (res === 'HOLD') { bs.hits = 0; bs.misses = 0; }
        if (res === 'HIT') { bs.hits += 1; bs.misses = 0; }
        if (res === 'MISS') { bs.misses += 1; bs.hits = 0; }
        change = progress(program, state, bs, sb);
      }
      results.push({ key: sb.key, name: sb.name, result: res, change });
    }
    const r = rule(program, 'next_required', 'rotation').params;
    state.lastRequired = r.order.find(o => o === session.workout || r.phase2_replaces[o] === session.workout) || session.workout;
  }
  session.finishedAt = today;
  session.id = session.id || (today + '-' + session.workout);
  sessions.push(session);
  return { results, state, sessions };
}

export function resultOf(sb) {
  const vals = sb.sets.map(s => +s.value);
  if (!vals.length || vals.every(v => isNaN(v))) return 'MISS';
  if (sb.mode === 'rounds') { const v = vals[0] || 0; return v >= sb.target.min ? 'HIT' : (v <= sb.target.min - 2 ? 'MISS' : 'HOLD'); }
  if (vals.every(v => v >= sb.target.max)) return 'HIT';
  if (vals.some(v => v < sb.target.min)) return 'MISS';
  return 'HOLD';
}

function progress(program, state, bs, sb) {
  const mode = sb.mode;
  const p = (rule(program, { reps: 'double_progression', seconds: 'time_ladder', rounds: 'round_ladder', distance: 'distance_then_load' }[mode], mode) || { params: {} }).params;
  const l = ladderOf(program, bs.rung);
  const written = writtenBlock(program, sb.key);
  const up = () => { bs.rung = l.rungs[l.index + 1]; if (mode === 'reps') bs.target = { ...written.target }; return `moved up to ${exName(program, bs.rung)}`; };
  const down = () => { bs.rung = l.rungs[l.index - 1]; if (mode === 'reps') bs.target = { ...written.target }; return `stepped back to ${exName(program, bs.rung)}`; };
  const flag = text => { state.flags.push({ key: sb.key, text, date: sb.date || '' }); return text; };
  let change = null;
  if (bs.hits >= (p.hits_to_advance || 2)) {
    if (mode === 'reps') {
      if (l.index < l.rungs.length - 1) change = up();
      else if (bs.sets < p.sets_max) { bs.sets += 1; bs.setsRaised += 1; change = `sets up to ${bs.sets}`; }
      else if (bs.target.max < p.rep_cap) { bs.target.min += p.rep_step; bs.target.max += p.rep_step; change = `target up to ${bs.target.min} to ${bs.target.max}`; }
      else change = flag(`${sb.name}: outgrown this program, trainer review`);
    } else if (mode === 'seconds') {
      if (bs.target.max < p.seconds_cap) { bs.target.min += p.step_seconds; bs.target.max += p.step_seconds; change = `target up to ${bs.target.min} to ${bs.target.max} s`; }
      else if (l.index < l.rungs.length - 1) change = up();
      else if (bs.sets < p.sets_max) { bs.sets += 1; bs.setsRaised += 1; change = `sets up to ${bs.sets}`; }
      else change = flag(`${sb.name}: outgrown this program, trainer review`);
    } else if (mode === 'rounds') {
      if (bs.attempt < bs.target.max) { bs.attempt += p.step_rounds; change = `rounds up to ${bs.attempt}`; }
      else if (l.index < l.rungs.length - 1) { bs.rung = l.rungs[l.index + 1]; const wb = writtenBlock(program, sb.key); bs.target = { ...wb.target }; bs.attempt = bs.target.min; change = `moved up to ${exName(program, bs.rung)}`; }
      else change = flag(`${sb.name}: outgrown this program, trainer review`);
    } else if (mode === 'distance') {
      if (bs.target.max < p.max_miles) { bs.target.min = bs.target.max = +(bs.target.max + p.step_miles).toFixed(2); change = `distance up to ${bs.target.max} mi`; }
      else if (l.index < l.rungs.length - 1) { bs.rung = l.rungs[l.index + 1]; bs.target = { min: p.reset_miles_on_load_step, max: p.reset_miles_on_load_step }; change = `moved up to ${exName(program, bs.rung)}`; }
      else change = flag(`${sb.name}: outgrown this program, trainer review`);
    }
    bs.hits = 0; bs.misses = 0;
  } else if (bs.misses >= (p.misses_to_regress || 2)) {
    if (mode === 'reps') {
      if (bs.sets > p.sets_min && bs.setsRaised > 0) { bs.sets -= 1; bs.setsRaised -= 1; change = `sets down to ${bs.sets}`; }
      else if (l.index > 0) change = down();
      else { bs.target.min = Math.max(p.rep_floor, bs.target.min - p.rep_step); bs.target.max = Math.max(bs.target.min, bs.target.max - p.rep_step); change = `target down to ${bs.target.min} to ${bs.target.max}`; if (bs.target.min === p.rep_floor) flag(`${sb.name}: at the floor, trainer review`); }
    } else if (mode === 'seconds') {
      if (bs.target.min > p.seconds_floor) { bs.target.min = Math.max(p.seconds_floor, bs.target.min - p.step_seconds); bs.target.max = Math.max(bs.target.min, bs.target.max - p.step_seconds); change = `target down to ${bs.target.min} to ${bs.target.max} s`; }
      else if (l.index > 0) change = down();
    } else if (mode === 'rounds') {
      if (bs.attempt > bs.target.min) { bs.attempt -= p.step_rounds; change = `rounds down to ${bs.attempt}`; }
      else if (l.index > 0) { bs.rung = l.rungs[l.index - 1]; const wb = writtenBlock(program, sb.key); bs.target = { ...wb.target }; bs.attempt = bs.target.max; change = `stepped back to ${exName(program, bs.rung)}`; }
    } else if (mode === 'distance') {
      bs.target.min = bs.target.max = Math.max(p.floor_miles, +(bs.target.max - p.step_miles).toFixed(2)); change = `distance down to ${bs.target.max} mi`;
    }
    bs.hits = 0; bs.misses = 0;
  }
  if (change) bs.bumped = change;
  return change;
}

function applyPain(program, state, bs, sb, today) {
  const p = rule(program, 'pain_mark', 'all').params;
  const recent = bs.pain.filter(d => dayDiff(d, today) <= p.second_within_days);
  bs.pain.push(today);
  bs.hits = 0; bs.misses = 0;
  if (recent.length >= 1) { bs.parked = true; bs.bumped = p.second.message; return; }
  const l = ladderOf(program, bs.rung);
  if (l.index > 0) { bs.rung = l.rungs[l.index - 1]; const wb = writtenBlock(program, sb.key); if (wb) bs.target = { ...wb.target }; bs.bumped = `pain mark: stepped back to ${exName(program, bs.rung)}`; }
  else { bs.sets = Math.max(2, bs.sets - 1); bs.bumped = 'pain mark: one set fewer'; }
}

export function unpark(program, state, key) {
  const bs = state.blocks[key]; if (!bs) return;
  const wb = writtenBlock(program, key);
  const l = ladderOf(program, bs.rung);
  bs.parked = false; bs.rung = l.rungs[0]; bs.sets = wb.sets; bs.target = { ...wb.target }; bs.attempt = wb.target.min; bs.hits = 0; bs.misses = 0; bs.setsRaised = 0; bs.bumped = 'back from parked, at the first rung';
}
export function setHangBar(program, state) {
  state.confirms.hang_bar = true;
  const l = ladders(program).find(r => r.includes('dead_hang'));
  if (!l) return;
  for (const bs of Object.values(state.blocks)) if (l.includes(bs.rung) && bs.rung !== 'dead_hang') { bs.rung = 'dead_hang'; bs.bumped = 'hang bar: now dead hangs'; }
}
export function manualBump(state, key, text) { const bs = state.blocks[key]; if (bs) { bs.manual = bs.manual || []; bs.manual.push(text); } }
