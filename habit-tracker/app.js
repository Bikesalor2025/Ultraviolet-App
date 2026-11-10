import { Flame, tierFor } from './fire.js';
import * as vault from './vault.js';

const STORE_KEY = 'streakfire.v1';
const MILESTONES = [7, 30, 100, 365];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]{1,64}$/;
const NOTE_RE = /^[\w-]{1,64}\|\d{4}-\d{2}-\d{2}$/;
const MIN_PASSWORD = 6;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

// ---------- Dates (always local calendar days) ----------

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
const todayKey = () => dateKey(new Date());
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

function firstDayOfWeek() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch { /* fall through */ }
  return /^en-(US|CA)$/i.test(navigator.language) ? 0 : 1;
}

// ---------- State ----------

function emptyState() {
  return { v: 1, habits: [], active: null, vault: null, notes: {} };
}

// Rebuilds stored or imported data field by field, dropping anything malformed.
function sanitize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.habits)) throw new Error('Not a Streakfire backup');
  const habits = [];
  const seenIds = new Set();
  for (const h of data.habits) {
    if (!h || typeof h.id !== 'string' || !ID_RE.test(h.id) || seenIds.has(h.id)) continue;
    seenIds.add(h.id);
    const done = {};
    if (h.done && typeof h.done === 'object') {
      for (const k of Object.keys(h.done)) if (DATE_RE.test(k) && h.done[k]) done[k] = 1;
    }
    habits.push({
      id: h.id,
      name: (typeof h.name === 'string' ? h.name.trim().slice(0, 40) : '') || 'Habit',
      done,
      seen: Number.isInteger(h.seen) && h.seen > 0 ? h.seen : 0,
    });
  }

  const isBox = (b) => b && typeof b.iv === 'string' && typeof b.ct === 'string';
  let meta = null;
  const v = data.vault;
  if (v && typeof v.salt === 'string' && Number.isInteger(v.iter) && v.iter >= 100_000 && v.iter <= 5_000_000 && isBox(v.check)) {
    meta = { v: 1, kdf: 'PBKDF2-SHA256', iter: v.iter, salt: v.salt, check: { iv: v.check.iv, ct: v.check.ct } };
  }

  const notes = {};
  if (meta && data.notes && typeof data.notes === 'object') {
    for (const k of Object.keys(data.notes)) {
      const box = data.notes[k];
      if (NOTE_RE.test(k) && seenIds.has(k.split('|')[0]) && isBox(box)) notes[k] = { iv: box.iv, ct: box.ct };
    }
  }

  const active = habits.some((h) => h.id === data.active) ? data.active : habits[0]?.id ?? null;
  return { v: 1, habits, active, vault: meta, notes };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch { /* corrupt or unavailable storage: start fresh */ }
  return emptyState();
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('Could not save', 'Browser storage is full or blocked.');
  }
}

let state = loadState();
let vaultKey = null; // in memory only, so notes re-lock on every reload
let viewMonth = monthStart(new Date());
let lastToday = todayKey();
let openKey = null; // day shown in the day dialog
let noteSlot = null; // storage key of the note being edited
let noteOriginal = '';
let igniteKey = null;
let shownStreak = 0;
let calSlide = null; // direction of the next calendar slide-in

const activeHabit = () => state.habits.find((h) => h.id === state.active) ?? null;

function streakInfo(habit) {
  const { done } = habit;
  const today = todayKey();
  // A streak stays alive until the end of the day after the last check-in.
  let cursor = done[today] ? today : addDays(today, -1);
  let current = 0;
  while (done[cursor]) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const keys = Object.keys(done).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }
  return { current, longest, total: keys.length, doneToday: !!done[today], atRisk: current > 0 && !done[today] };
}

// ---------- Flame, icons, toast ----------

const flame = new Flame($('flame'), { reduced });

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const haptic = (pattern) => navigator.vibrate?.(pattern);

let toastTimer;
function toast(title, sub = '', milestone = false) {
  const el = $('toast');
  clearTimeout(toastTimer);
  $('toastTitle').textContent = title;
  $('toastSub').textContent = sub;
  el.className = `toast${milestone ? ' milestone' : ''}`;
  // Re-showing the popover lifts it above any dialog opened since.
  if (el.showPopover) {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  }
  void el.offsetWidth; // restart the entry animation
  el.classList.add('show');
  toastTimer = setTimeout(() => {
    el.classList.add('leaving');
    toastTimer = setTimeout(() => {
      el.classList.remove('show', 'leaving');
      if (el.hidePopover && el.matches(':popover-open')) el.hidePopover();
    }, 260);
  }, milestone ? 3600 : 2800);
}

function celebrate(milestone) {
  const tier = tierFor(milestone);
  flame.ignite(true);
  haptic([12, 60, 24]);
  toast(`${milestone}-day streak`, milestone === 365 ? 'One full year' : `${tier.name} flame unlocked`, true);
}

// ---------- Rendering ----------

// Rolls the old number out and the new one in, in the direction of change.
function setStreakNumber(n) {
  if (n === shownStreak) return;
  const up = n > shownStreak;
  shownStreak = n;
  const wrap = $('streakNum');
  const next = document.createElement('span');
  next.textContent = n;
  if (reduced) {
    wrap.replaceChildren(next);
    return;
  }
  for (const old of wrap.children) {
    old.className = up ? 'out-up' : 'out-down';
    setTimeout(() => old.remove(), 300);
  }
  next.className = up ? 'in-up' : 'in-down';
  wrap.append(next);
}

function renderHabitBar() {
  const bar = $('habitBar');
  bar.replaceChildren();
  bar.hidden = !state.habits.length;
  for (const h of state.habits) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(h.id === state.active));
    const name = document.createElement('span');
    name.textContent = h.name;
    const count = document.createElement('span');
    count.className = 'chip-count';
    count.append(icon('flame'), String(streakInfo(h).current));
    chip.append(name, count);
    chip.addEventListener('click', () => selectHabit(h.id));
    bar.append(chip);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip chip-add';
  add.append(icon('plus'), 'New habit');
  add.addEventListener('click', () => {
    $('habitName').value = '';
    $('habitDialog').showModal();
  });
  bar.append(add);
}

function renderHero(habit, info) {
  const tier = tierFor(info.current);
  document.body.dataset.tier = tier.id;
  flame.set(info.current, info.atRisk);

  setStreakNumber(info.current);
  $('tierBadge').textContent = tier.name;

  let status;
  if (info.doneToday) status = 'Done for today. See you tomorrow.';
  else if (info.atRisk) status = 'Check in today to keep your streak.';
  else if (info.total) status = 'Your streak ended. Start a new one today.';
  else status = 'Check in to start your streak.';
  $('statusLine').textContent = status;

  const btn = $('checkBtn');
  btn.disabled = info.doneToday;
  btn.classList.toggle('done', info.doneToday);
  $('checkLabel').textContent = info.doneToday ? 'Done today' : 'Check in';
  $('undoBtn').hidden = !info.doneToday;

  const next = MILESTONES.find((m) => m > info.current);
  if (next) {
    $('milestoneLabel').textContent = `Next milestone: ${next} days`;
    $('milestoneCount').textContent = `${info.current} / ${next}`;
    $('milestoneFill').style.width = `${(info.current / next) * 100}%`;
  } else {
    $('milestoneLabel').textContent = 'Over a full year';
    $('milestoneCount').textContent = `${info.current} days`;
    $('milestoneFill').style.width = '100%';
  }

  const now = new Date();
  const prefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-`;
  const monthDone = Object.keys(habit.done).filter((k) => k.startsWith(prefix) && k <= todayKey()).length;
  $('statLongest').textContent = info.longest;
  $('statTotal').textContent = info.total;
  $('statMonth').textContent = `${Math.round((monthDone / now.getDate()) * 100)}%`;
}

function renderCalendar(habit) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const today = todayKey();
  const first = firstDayOfWeek();

  $('calTitle').textContent = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('calNext').disabled = monthStart(new Date()) <= viewMonth;

  const weekdays = $('calWeekdays');
  weekdays.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const cell = document.createElement('div');
    // 4 Jan 1970 was a Sunday.
    cell.textContent = new Date(1970, 0, 4 + ((first + i) % 7)).toLocaleDateString(undefined, { weekday: 'short' });
    weekdays.append(cell);
  }

  const grid = $('calGrid');
  grid.replaceChildren();
  grid.className = 'cal-grid';
  if (calSlide && !reduced) {
    void grid.offsetWidth;
    grid.classList.add(`slide-${calSlide}`);
  }
  calSlide = null;
  const lead = (new Date(year, month, 1).getDay() - first + 7) % 7;
  for (let i = 0; i < lead; i++) grid.append(document.createElement('div'));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`;
    const col = (lead + d - 1) % 7;
    const done = !!habit.done[key];
    const hasNote = !!state.notes[`${habit.id}|${key}`];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    const num = document.createElement('span');
    num.className = 'n';
    num.textContent = d;
    btn.append(num);
    btn.disabled = key > today;
    if (done) btn.classList.add('done');
    if (key === today) btn.classList.add('today');
    if (done && d > 1 && col > 0 && habit.done[addDays(key, -1)]) btn.classList.add('link-l');
    if (done && d < daysInMonth && col < 6 && habit.done[addDays(key, 1)]) btn.classList.add('link-r');
    if (key === igniteKey) btn.classList.add('ignite');
    if (hasNote) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      btn.append(dot);
    }
    const label = parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    btn.setAttribute('aria-label', `${label}${done ? ', done' : ''}${hasNote ? ', has a note' : ''}`);
    btn.addEventListener('click', () => openDay(key));
    grid.append(btn);
  }
  igniteKey = null;
}

function updateLockButton() {
  const btn = $('lockBtn');
  btn.hidden = !state.vault;
  btn.classList.toggle('on', !!vaultKey);
  btn.setAttribute('aria-label', vaultKey ? 'Lock notes' : 'Notes locked. Unlock');
  $('lockUse').setAttribute('href', vaultKey ? '#i-unlock' : '#i-lock');
}

function render() {
  const habit = activeHabit();
  $('empty').hidden = !!habit;
  $('board').hidden = !habit;
  renderHabitBar();
  updateLockButton();
  if (!habit) {
    document.body.dataset.tier = 'cold';
    flame.set(0, false);
    return;
  }
  const info = streakInfo(habit);
  // A streak that was alive last time we looked and is gone now burned out
  // while the app was closed.
  if (habit.seen > 0 && info.current === 0) {
    toast(`Your ${habit.seen}-day streak ended`, 'Start a new one today.');
  }
  if (habit.seen !== info.current) {
    habit.seen = info.current;
    saveState();
  }
  renderHero(habit, info);
  renderCalendar(habit);
}

// ---------- Actions ----------

function createHabit(rawName) {
  const name = rawName.trim().slice(0, 40);
  if (!name) return false;
  const habit = { id: crypto.randomUUID(), name, done: {}, seen: 0 };
  state.habits.push(habit);
  state.active = habit.id;
  viewMonth = monthStart(new Date());
  saveState();
  render();
  return true;
}

function selectHabit(id) {
  if (state.active === id) return;
  state.active = id;
  viewMonth = monthStart(new Date());
  saveState();
  render();
}

function toggleDay(key) {
  const habit = activeHabit();
  if (!habit || key > todayKey()) return;
  const before = streakInfo(habit).current;
  const nowDone = !habit.done[key];
  if (nowDone) habit.done[key] = 1;
  else delete habit.done[key];
  const after = streakInfo(habit).current;
  habit.seen = after;
  saveState();
  igniteKey = nowDone ? key : null;
  render();

  if (nowDone && after > before) {
    const hit = MILESTONES.filter((m) => before < m && after >= m).pop();
    if (hit) celebrate(hit);
    else {
      flame.ignite();
      haptic(12);
    }
  }
}

// ---------- Day dialog and notes ----------

function openDay(key) {
  const habit = activeHabit();
  if (!habit) return;
  openKey = key;
  noteSlot = `${habit.id}|${key}`;
  $('dayTitle').textContent = parseKey(key).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  $('daySub').textContent = habit.name;
  renderDayToggle();
  renderNote();
  if (!$('dayDialog').open) $('dayDialog').showModal();
}

function renderDayToggle() {
  const habit = activeHabit();
  const done = !!habit?.done[openKey];
  const btn = $('dayToggle');
  btn.setAttribute('aria-pressed', String(done));
  btn.textContent = done ? 'Done · tap to undo' : 'Mark as done';
}

async function renderNote() {
  const hasVault = !!state.vault;
  const unlocked = !!vaultKey;
  $('noteSetup').hidden = hasVault;
  $('noteUnlock').hidden = !hasVault || unlocked;
  $('noteEdit').hidden = !hasVault || !unlocked;
  const pill = $('noteState');
  pill.textContent = !hasVault ? 'No password yet' : unlocked ? 'Unlocked' : 'Locked';
  pill.classList.toggle('open', unlocked);
  for (const id of ['setupErr', 'unlockErr', 'noteErr']) $(id).textContent = '';
  for (const id of ['newPw', 'newPw2', 'pw']) $(id).value = '';
  if (!unlocked) return;

  const slot = noteSlot;
  const box = state.notes[slot];
  const area = $('noteText');
  area.value = '';
  noteOriginal = '';
  $('noteDelete').hidden = !box;
  if (!box) return;
  try {
    const text = await vault.decryptText(vaultKey, box, slot);
    if (noteSlot !== slot) return; // another day was opened meanwhile
    area.value = text;
    noteOriginal = text;
  } catch {
    $('noteErr').textContent = 'This note could not be decrypted. Saving will replace it.';
  }
}

// Encrypts and stores the open note if it changed. Everything it needs is
// captured up front so it stays correct if the dialog closes while it runs.
async function flushNote() {
  const slot = noteSlot;
  const key = vaultKey;
  const text = $('noteText').value;
  if (!slot || !key || text === noteOriginal) return false;
  noteOriginal = text;
  if (text.trim()) state.notes[slot] = await vault.encryptText(key, text, slot);
  else delete state.notes[slot];
  saveState();
  return true;
}

function fail(form, errId, message) {
  $(errId).textContent = message;
  form.classList.remove('shake');
  void form.offsetWidth;
  form.classList.add('shake');
}

async function withBusy(form, work) {
  const btn = form.querySelector('button[type="submit"]');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    await work();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('noteSetup').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const pw = $('newPw').value;
  if (pw.length < MIN_PASSWORD) return fail(form, 'setupErr', `Use at least ${MIN_PASSWORD} characters.`);
  if (pw !== $('newPw2').value) return fail(form, 'setupErr', 'The passwords do not match.');
  withBusy(form, async () => {
    const { key, meta } = await vault.create(pw);
    state.vault = meta;
    vaultKey = key;
    saveState();
    updateLockButton();
    await renderNote();
    $('noteText').focus();
    toast('Password set', 'Your notes are now encrypted.');
  });
});

$('noteUnlock').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const key = await vault.unlock(state.vault, $('pw').value);
    if (!key) {
      fail(form, 'unlockErr', 'Wrong password.');
      $('pw').select();
      return;
    }
    vaultKey = key;
    updateLockButton();
    await renderNote();
    $('noteText').focus();
  });
});

$('noteEdit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saved = await flushNote();
  $('noteDelete').hidden = !state.notes[noteSlot];
  if (activeHabit()) renderCalendar(activeHabit());
  toast(saved ? 'Note saved' : 'No changes to save');
});

$('noteDelete').addEventListener('click', async () => {
  if (!(await confirmDialog('Delete this note?', 'The note for this day will be removed for good.', 'Delete'))) return;
  delete state.notes[noteSlot];
  saveState();
  await renderNote();
  renderCalendar(activeHabit());
  toast('Note deleted');
});

$('dayToggle').addEventListener('click', () => {
  toggleDay(openKey);
  renderDayToggle();
});

$('dayDialog').addEventListener('close', async () => {
  // Closing the dialog keeps whatever was typed.
  const saved = await flushNote().catch(() => false);
  openKey = null;
  noteSlot = null;
  if (saved && activeHabit()) renderCalendar(activeHabit());
});

$('lockBtn').addEventListener('click', async () => {
  if (!vaultKey) {
    openDay(todayKey());
    $('pw').focus();
    return;
  }
  await flushNote().catch(() => false);
  vaultKey = null;
  $('noteText').value = '';
  noteOriginal = '';
  updateLockButton();
  if ($('dayDialog').open) renderNote();
  toast('Notes locked');
});

// ---------- Hero, calendar and habit controls ----------

$('checkBtn').addEventListener('click', () => toggleDay(todayKey()));
$('undoBtn').addEventListener('click', () => toggleDay(todayKey()));

function shiftMonth(step) {
  const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + step, 1);
  if (next > monthStart(new Date()) || !activeHabit()) return;
  viewMonth = next;
  calSlide = step > 0 ? 'next' : 'prev';
  renderCalendar(activeHabit());
}
$('calPrev').addEventListener('click', () => shiftMonth(-1));
$('calNext').addEventListener('click', () => shiftMonth(1));

// Swipe the calendar sideways to change month.
{
  let start = null;
  const grid = $('calGrid');
  grid.addEventListener('touchstart', (e) => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

$('firstHabitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (createHabit($('firstHabitName').value)) $('firstHabitName').value = '';
});

$('habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (createHabit($('habitName').value)) $('habitDialog').close();
});

// ---------- Settings, backup ----------

function confirmDialog(title, body, okLabel) {
  const dlg = $('confirmDialog');
  $('confirmTitle').textContent = title;
  $('confirmBody').textContent = body;
  $('confirmOk').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

$('settingsBtn').addEventListener('click', () => {
  const habit = activeHabit();
  $('settingsHabit').hidden = !habit;
  if (habit) $('renameInput').value = habit.name;
  $('settingsDialog').showModal();
});

$('renameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const habit = activeHabit();
  const name = $('renameInput').value.trim().slice(0, 40);
  if (!habit || !name) return;
  habit.name = name;
  saveState();
  render();
  toast('Habit renamed');
});

$('deleteHabitBtn').addEventListener('click', async () => {
  const habit = activeHabit();
  if (!habit) return;
  const ok = await confirmDialog(
    `Delete "${habit.name}"?`,
    'Its streak, history and notes will be removed for good.',
    'Delete habit',
  );
  if (!ok) return;
  state.habits = state.habits.filter((h) => h.id !== habit.id);
  for (const k of Object.keys(state.notes)) if (k.startsWith(`${habit.id}|`)) delete state.notes[k];
  state.active = state.habits[0]?.id ?? null;
  saveState();
  $('settingsDialog').close();
  render();
  toast('Habit deleted');
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `streakfire-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let next;
  try {
    next = sanitize(JSON.parse(await file.text()));
  } catch {
    toast('Import failed', 'That file is not a Streakfire backup.');
    return;
  }
  const ok = await confirmDialog(
    'Replace everything with this backup?',
    `The backup has ${next.habits.length} habit${next.habits.length === 1 ? '' : 's'}. Your current habits and notes on this device will be overwritten.`,
    'Replace',
  );
  if (!ok) return;
  state = next;
  vaultKey = null;
  viewMonth = monthStart(new Date());
  saveState();
  $('settingsDialog').close();
  render();
  toast('Backup imported');
});

// ---------- Dialog plumbing and housekeeping ----------

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    // Clicks on the backdrop target the dialog but land outside its box.
    const r = dlg.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (e.target === dlg && outside) dlg.close();
  });
}

// Keep bottom sheets above the on-screen keyboard (iOS overlays it on the page).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

// Roll over at midnight when the app is left open.
function checkDayChange() {
  if (todayKey() === lastToday) return;
  lastToday = todayKey();
  viewMonth = monthStart(new Date());
  render();
}
setInterval(checkDayChange, 30_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkDayChange();
});

render();
