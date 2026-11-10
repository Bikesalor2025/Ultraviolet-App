import { Flame, tierFor } from './fire.js';
import * as vault from './vault.js';
import { shareCard } from './share.js';
import {
  ALL_DAYS, pad, parseKey, addDays, todayKey, monthStart, firstDayOfWeek,
  cleanDays, isDue, everyDay, nextDueKey, streakInfo, weekStrip, insights, yearGrid,
} from './logic.js';

const STORE_KEY = 'streakfire.v1';
const MILESTONES = [7, 30, 100, 365];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]{1,64}$/;
const NOTE_RE = /^[\w-]{1,64}\|\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_PASSWORD = 6;
const DEFAULT_REMINDER = '20:00';
const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 60]; // minutes; 0 = never
const COLORS = ['#ff7a2f', '#ffc94a', '#5ad17a', '#4da3ff', '#b58cff', '#ff6b9d'];
const COLOR_NAMES = ['Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'];
const WEEK_START = firstDayOfWeek();

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

const weekdayName = (wd, width) => new Date(1970, 0, 4 + wd).toLocaleDateString(undefined, { weekday: width }); // 4 Jan 1970 was a Sunday
const shortDate = (key) => {
  const d = parseKey(key);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
};

// ---------- State ----------

function emptyState() {
  return { v: 1, habits: [], active: null, view: 'habit', vault: null, notes: {}, autoLock: 5 };
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
      days: cleanDays(h.days),
      remind: TIME_RE.test(h.remind) ? h.remind : DEFAULT_REMINDER,
      color: Number.isInteger(h.color) && h.color >= 0 && h.color < COLORS.length ? h.color : 0,
      archived: h.archived === true,
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

  return {
    v: 1,
    habits,
    active: habits.some((h) => h.id === data.active) ? data.active : null,
    view: data.view === 'today' ? 'today' : 'habit',
    vault: meta,
    notes,
    autoLock: AUTO_LOCK_CHOICES.includes(data.autoLock) ? data.autoLock : 5,
  };
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
const plainNotes = new Map(); // decrypted note text by slot, while unlocked
let viewMonth = monthStart(new Date());
let lastToday = todayKey();
let openKey = null; // day shown in the day sheet
let noteSlot = null; // storage key of the note being edited
let noteOriginal = '';
let igniteKey = null; // calendar day to animate on the next render
let popHabit = null; // Today row to animate on the next render
let shownStreak = 0;
let calSlide = null; // direction of the next calendar slide-in
let lastActivity = Date.now();

const liveHabits = () => state.habits.filter((h) => !h.archived);
const activeHabit = () => liveHabits().find((h) => h.id === state.active) ?? null;
const showingToday = () => state.view === 'today' && liveHabits().length >= 2;
const noteSlotFor = (habit, key) => `${habit.id}|${key}`;

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function colorDot(habit) {
  const dot = el('span', 'color-dot');
  dot.style.background = COLORS[habit.color];
  return dot;
}

const haptic = (pattern) => navigator.vibrate?.(pattern);

let toastTimer;
function toast(title, sub = '', milestone = false) {
  const node = $('toast');
  clearTimeout(toastTimer);
  $('toastTitle').textContent = title;
  $('toastSub').textContent = sub;
  node.className = `toast${milestone ? ' milestone' : ''}`;
  // Re-showing the popover lifts it above any dialog opened since.
  if (node.showPopover) {
    if (node.matches(':popover-open')) node.hidePopover();
    node.showPopover();
  }
  void node.offsetWidth; // restart the entry animation
  node.classList.add('show');
  toastTimer = setTimeout(() => {
    node.classList.add('leaving');
    toastTimer = setTimeout(() => {
      node.classList.remove('show', 'leaving');
      if (node.hidePopover && node.matches(':popover-open')) node.hidePopover();
    }, 260);
  }, milestone ? 3600 : 2800);
}

function celebrate(milestone) {
  const tier = tierFor(milestone);
  flame.ignite(true);
  haptic([12, 60, 24]);
  toast(`${milestone}-day streak`, milestone === 365 ? 'One full year' : `${tier.name} flame unlocked`, true);
}

function download(name, type, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Rendering: shell ----------

// Rolls the old number out and the new one in, in the direction of change.
function setStreakNumber(n) {
  if (n === shownStreak) return;
  const up = n > shownStreak;
  shownStreak = n;
  const wrap = $('streakNum');
  const next = el('span', '', n);
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

function renderHabitBar(habits, infos, today) {
  const bar = $('habitBar');
  bar.replaceChildren();
  bar.hidden = !habits.length;
  if (habits.length >= 2) {
    const chip = el('button', 'chip', 'Today');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(today));
    chip.addEventListener('click', () => setView('today'));
    bar.append(chip);
  }
  for (const h of habits) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(!today && h.id === state.active));
    const count = el('span', 'chip-count');
    count.append(icon('flame'), String(infos.get(h.id).current));
    chip.append(colorDot(h), el('span', '', h.name), count);
    chip.addEventListener('click', () => selectHabit(h.id));
    bar.append(chip);
  }
  const add = el('button', 'chip chip-add');
  add.type = 'button';
  add.append(icon('plus'), 'New habit');
  add.addEventListener('click', openNewHabit);
  bar.append(add);
}

function updateLockButton() {
  const btn = $('lockBtn');
  btn.hidden = !state.vault;
  btn.classList.toggle('on', !!vaultKey);
  btn.setAttribute('aria-label', vaultKey ? 'Lock notes' : 'Notes locked. Unlock');
  $('lockUse').setAttribute('href', vaultKey ? '#i-unlock' : '#i-lock');
}

function render() {
  const habits = liveHabits();
  if (!habits.some((h) => h.id === state.active)) state.active = habits[0]?.id ?? null;
  const habit = activeHabit();
  const today = showingToday();

  // Streaks that were alive last time we looked and are gone now ended while
  // the app was closed.
  const infos = new Map();
  const ended = [];
  let dirty = false;
  for (const h of habits) {
    const info = streakInfo(h);
    infos.set(h.id, info);
    if (h.seen > 0 && info.current === 0) ended.push({ name: h.name, days: h.seen });
    if (h.seen !== info.current) {
      h.seen = info.current;
      dirty = true;
    }
  }
  if (ended.length === 1) toast(`Your ${ended[0].days}-day streak ended`, `${ended[0].name}. Start a new one today.`);
  else if (ended.length > 1) toast(`${ended.length} streaks ended`, 'Start new ones today.');
  if (dirty) saveState();

  $('empty').hidden = !!habit;
  $('todayView').hidden = !today;
  $('board').hidden = !habit || today;
  $('shareBtn').hidden = !habit || today;
  renderHabitBar(habits, infos, today);
  updateLockButton();

  if (!habit || today) {
    document.body.dataset.tier = 'cold';
    flame.set(0, false);
    if (today) renderToday(habits, infos);
    return;
  }
  renderHero(habit, infos.get(habit.id));
  renderCalendar(habit);
  renderInsights(habit);
  renderNotesCard(habit);
}

// ---------- Rendering: Today ----------

function checkMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(path);
  return svg;
}

function renderToday(habits, infos) {
  const today = todayKey();
  $('todayDate').textContent = parseKey(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // Rest days only count towards the total once they're done as a bonus.
  const counted = habits.filter((h) => infos.get(h.id).dueToday || infos.get(h.id).doneToday);
  const done = counted.filter((h) => infos.get(h.id).doneToday).length;
  $('todayLabel').textContent = !counted.length ? 'Nothing due today' : done === counted.length ? 'All done for today' : 'Done today';
  $('todayCount').textContent = counted.length ? `${done} / ${counted.length}` : '';
  $('todayFill').style.width = counted.length ? `${(done / counted.length) * 100}%` : '0%';

  const list = $('todayList');
  list.replaceChildren();
  for (const h of habits) {
    const info = infos.get(h.id);
    const row = el('li', 'today-row');
    if (info.doneToday) row.classList.add('done');
    if (h.id === popHabit) row.classList.add('pop');

    const check = el('button', 'check-circle');
    check.type = 'button';
    check.setAttribute('aria-pressed', String(info.doneToday));
    check.setAttribute('aria-label', `${info.doneToday ? 'Undo check-in' : 'Check in'}: ${h.name}`);
    check.append(checkMark());
    check.addEventListener('click', () => toggleDay(today, h));

    const main = el('button', 'today-main');
    main.type = 'button';
    const name = el('span', 'today-name');
    name.append(colorDot(h), el('span', '', h.name));
    const sub = el('span', 'today-sub');
    const streak = el('span', 'chip-count');
    streak.append(icon('flame'), String(info.current));
    sub.append(streak, el('span', '', info.doneToday ? 'Done' : info.dueToday ? 'Due today' : 'Rest day'));
    main.append(name, sub);
    main.addEventListener('click', () => selectHabit(h.id));

    const mini = el('span', 'mini-week');
    mini.setAttribute('aria-hidden', 'true');
    for (const day of weekStrip(h)) mini.append(el('i', day.state));

    row.append(check, main, mini);
    list.append(row);
  }
  popHabit = null;
}

// ---------- Rendering: habit ----------

const noteButtonLabel = (habit) => (state.notes[noteSlotFor(habit, todayKey())] ? "Edit today's note" : 'Add a note for today');

function renderHero(habit, info) {
  const today = todayKey();
  const tier = tierFor(info.current);
  document.body.dataset.tier = tier.id;
  flame.set(info.current, info.atRisk);

  setStreakNumber(info.current);
  $('tierBadge').textContent = tier.name;

  let status;
  if (info.doneToday) status = everyDay(habit) ? 'Done for today. See you tomorrow.' : 'Done for today.';
  else if (!info.dueToday) {
    const next = parseKey(nextDueKey(habit, addDays(today, 1))).toLocaleDateString(undefined, { weekday: 'long' });
    status = `Rest day. Next due ${next}.`;
  } else if (info.atRisk) status = 'Check in today to keep your streak.';
  else if (info.total) status = 'Your streak ended. Start a new one today.';
  else status = 'Check in to start your streak.';
  $('statusLine').textContent = status;

  const strip = $('weekStrip');
  strip.replaceChildren();
  const week = weekStrip(habit);
  for (const day of week) {
    const cell = el('div', `wk ${day.state}`);
    if (day.key === today) cell.classList.add('now');
    cell.append(el('i'), el('span', '', weekdayName(day.weekday, 'narrow')));
    strip.append(cell);
  }
  strip.setAttribute('aria-label', `Last 7 days: ${week.filter((d) => d.state === 'done').length} done`);

  $('noteTodayBtn').textContent = noteButtonLabel(habit);

  const btn = $('checkBtn');
  btn.disabled = info.doneToday;
  btn.classList.toggle('done', info.doneToday);
  $('checkLabel').textContent = info.doneToday ? 'Done today' : info.dueToday ? 'Check in' : 'Check in anyway';
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

  // This month: check-ins against the days that were due so far.
  let monthDone = 0;
  let monthDue = 0;
  for (let k = `${today.slice(0, 8)}01`; k <= today; k = addDays(k, 1)) {
    if (habit.done[k]) monthDone++;
    if (isDue(habit, k)) monthDue++;
  }
  $('statLongest').textContent = info.longest;
  $('statTotal').textContent = info.total;
  $('statMonth').textContent = monthDue ? `${Math.min(100, Math.round((monthDone / monthDue) * 100))}%` : '–';
}

function renderCalendar(habit) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const today = todayKey();

  $('calTitle').textContent = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('calNext').disabled = monthStart(new Date()) <= viewMonth;

  const weekdays = $('calWeekdays');
  weekdays.replaceChildren();
  for (let i = 0; i < 7; i++) weekdays.append(el('div', '', weekdayName((WEEK_START + i) % 7, 'short')));

  const grid = $('calGrid');
  grid.replaceChildren();
  grid.className = 'cal-grid';
  if (calSlide && !reduced) {
    void grid.offsetWidth;
    grid.classList.add(`slide-${calSlide}`);
  }
  calSlide = null;
  const lead = (new Date(year, month, 1).getDay() - WEEK_START + 7) % 7;
  for (let i = 0; i < lead; i++) grid.append(el('div'));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`;
    const col = (lead + d - 1) % 7;
    const done = !!habit.done[key];
    const hasNote = !!state.notes[noteSlotFor(habit, key)];
    const btn = el('button', 'day');
    btn.type = 'button';
    btn.append(el('span', 'n', d));
    btn.disabled = key > today;
    const off = !done && !isDue(habit, key);
    if (done) btn.classList.add('done');
    if (off) btn.classList.add('off');
    if (off && restJoins(habit, key, -1) && restJoins(habit, key, 1)) btn.classList.add('bridge');
    if (key === today) btn.classList.add('today');
    if (done && d > 1 && col > 0 && habit.done[addDays(key, -1)]) btn.classList.add('link-l');
    if (done && d < daysInMonth && col < 6 && habit.done[addDays(key, 1)]) btn.classList.add('link-r');
    if (key === igniteKey) btn.classList.add('ignite');
    if (hasNote) btn.append(el('span', 'dot'));
    const label = parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    btn.setAttribute('aria-label', `${label}${done ? ', done' : ''}${off ? ', rest day' : ''}${hasNote ? ', has a note' : ''}`);
    btn.addEventListener('click', () => openDay(key));
    grid.append(btn);
  }
  igniteKey = null;
  $('calLegend').textContent = everyDay(habit)
    ? 'Tap a day to edit it or add a note. A dot marks days with a note.'
    : 'Tap a day to edit it or add a note. Dimmed days are rest days.';
}

// True when, going one way from a rest day, the next non-rest day is a done
// day. Used to draw the thin line that carries a streak across days off.
function restJoins(habit, key, step) {
  const today = todayKey();
  for (let i = 0, k = addDays(key, step); i < 7 && k <= today; i++, k = addDays(k, step)) {
    if (habit.done[k]) return true;
    if (isDue(habit, k)) return false;
  }
  return false;
}

function renderInsights(habit) {
  const data = insights(habit);
  $('insEmpty').hidden = !!data;
  $('insBody').hidden = !data;
  if (!data) return;

  $('insRate').textContent = data.rate30 === null ? '–' : `${data.rate30}%`;
  $('insBest').textContent = data.bestDay === null ? '–' : weekdayName(data.bestDay, 'long');

  const bars = $('insWeekdays');
  bars.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const wd = (WEEK_START + i) % 7;
    const rate = data.byWeekday[wd];
    const col = el('div', 'wd');
    if (rate === null) col.classList.add('none');
    if (wd === data.bestDay) col.classList.add('best');
    const track = el('div', 'wd-track');
    const fill = el('div', 'wd-fill');
    fill.style.height = `${rate === null ? 0 : Math.max(6, Math.round(rate * 100))}%`;
    track.append(fill);
    col.append(track, el('span', '', weekdayName(wd, 'narrow')));
    col.setAttribute('role', 'img');
    col.setAttribute('aria-label', `${weekdayName(wd, 'long')}: ${rate === null ? 'no data' : `${Math.round(rate * 100)}%`}`);
    bars.append(col);
  }

  const weeks = yearGrid(habit, WEEK_START);
  const months = $('heatMonths');
  const heat = $('heat');
  months.replaceChildren();
  heat.replaceChildren();
  let doneCount = 0;
  weeks.forEach((week, i) => {
    // The last columns have no room for a label.
    if (week.newMonth && i < weeks.length - 2) {
      const label = el('span', '', parseKey(week.start).toLocaleDateString(undefined, { month: 'short' }));
      label.style.gridColumnStart = String(i + 1);
      months.append(label);
    }
    for (const day of week.days) {
      if (day.state === 'done') doneCount++;
      heat.append(el('i', day.state));
    }
  });
  heat.setAttribute('aria-label', `${doneCount} check-ins in the past year`);
  // Newest weeks are on the right; start scrolled to them.
  requestAnimationFrame(() => { $('heatScroll').scrollLeft = $('heatScroll').scrollWidth; });

  const runs = $('insRuns');
  runs.replaceChildren();
  for (const run of data.runs) {
    const item = el('li');
    const range = run.start === run.end ? shortDate(run.start) : `${shortDate(run.start)} – ${shortDate(run.end)}`;
    item.append(el('strong', '', `${run.length} day${run.length === 1 ? '' : 's'}`), el('span', 'muted', range));
    if (run.alive) item.append(el('span', 'pill open', 'Current'));
    runs.append(item);
  }
}

// ---------- Notes: timeline and locking ----------

async function readNote(slot) {
  if (plainNotes.has(slot)) return plainNotes.get(slot);
  const text = await vault.decryptText(vaultKey, state.notes[slot], slot);
  plainNotes.set(slot, text);
  return text;
}

let notesRender = 0;
async function renderNotesCard(habit) {
  const run = ++notesRender;
  const slots = Object.keys(state.notes).filter((s) => s.startsWith(`${habit.id}|`)).sort().reverse();
  const unlocked = !!vaultKey;
  $('notesCount').textContent = String(slots.length);
  $('notesCount').hidden = !slots.length;
  $('notesEmpty').hidden = slots.length > 0;
  $('notesLocked').hidden = !slots.length || unlocked;
  $('notesOpen').hidden = !slots.length || !unlocked;
  if (!slots.length || !unlocked) {
    $('noteList').replaceChildren();
    return;
  }

  const entries = [];
  for (const slot of slots) {
    try {
      entries.push({ key: slot.split('|')[1], text: await readNote(slot) });
    } catch { /* unreadable note: leave it out of the list */ }
    if (run !== notesRender || !vaultKey) return; // superseded, or locked meanwhile
  }

  const query = $('noteSearch').value.trim().toLowerCase();
  const shown = query ? entries.filter((e) => e.text.toLowerCase().includes(query)) : entries;
  const list = $('noteList');
  list.replaceChildren();
  for (const entry of shown) {
    const btn = el('button', 'note-item');
    btn.type = 'button';
    btn.append(el('span', 'note-date', shortDate(entry.key)), el('span', 'note-text', entry.text));
    btn.addEventListener('click', () => openDay(entry.key));
    const item = el('li');
    item.append(btn);
    list.append(item);
  }
  $('noteNoMatch').hidden = shown.length > 0;
}

async function tryUnlock(password) {
  const key = await vault.unlock(state.vault, password);
  if (!key) return false;
  vaultKey = key;
  lastActivity = Date.now();
  refreshNotesUi();
  return true;
}

// Everything that looks different depending on whether notes are unlocked.
function refreshNotesUi() {
  updateLockButton();
  if ($('dayDialog').open) renderNote();
  const habit = activeHabit();
  if (habit && !showingToday()) renderNotesCard(habit);
}

async function lockNotes(message = 'Notes locked', sub = '') {
  await flushNote().catch(() => false);
  vaultKey = null;
  plainNotes.clear();
  $('noteText').value = '';
  $('noteSearch').value = '';
  noteOriginal = '';
  refreshNotesUi();
  toast(message, sub);
}

let afterUnlock = null;
function openUnlock(then = null) {
  afterUnlock = then;
  $('unlockPw').value = '';
  $('unlockDialogErr').textContent = '';
  $('unlockDialog').showModal();
}

// ---------- Actions ----------

function createHabit(rawName, days = ALL_DAYS, color = 0) {
  const name = rawName.trim().slice(0, 40);
  if (!name) return false;
  const habit = {
    id: crypto.randomUUID(), name, done: {}, days: cleanDays(days), remind: DEFAULT_REMINDER, color, archived: false, seen: 0,
  };
  state.habits.push(habit);
  state.active = habit.id;
  state.view = 'habit';
  viewMonth = monthStart(new Date());
  saveState();
  render();
  return true;
}

function selectHabit(id) {
  if (state.active === id && !showingToday()) return;
  state.active = id;
  state.view = 'habit';
  viewMonth = monthStart(new Date());
  $('noteSearch').value = '';
  saveState();
  render();
  window.scrollTo({ top: 0 });
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  saveState();
  render();
  window.scrollTo({ top: 0 });
}

function toggleDay(key, habit = activeHabit()) {
  if (!habit || key > todayKey()) return;
  const before = streakInfo(habit);
  const nowDone = !habit.done[key];
  if (nowDone) habit.done[key] = 1;
  else delete habit.done[key];
  const after = streakInfo(habit);
  habit.seen = after.current;
  saveState();
  igniteKey = nowDone ? key : null;
  popHabit = nowDone ? habit.id : null;
  render();

  if (!nowDone || after.current <= before.current) return;
  const hit = MILESTONES.filter((m) => before.current < m && after.current >= m).pop();
  if (hit) {
    celebrate(hit);
    return;
  }
  flame.ignite();
  haptic(12);
  // Beating an old record is worth a word, once the record meant something.
  if (before.longest >= 3 && after.current > before.longest) {
    toast('New personal best', `${after.current} days in a row.`);
  }
}

// ---------- Day sheet and notes ----------

function openDay(key) {
  const habit = activeHabit();
  if (!habit) return;
  openKey = key;
  noteSlot = noteSlotFor(habit, key);
  $('dayTitle').textContent = parseKey(key).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  $('daySub').textContent = isDue(habit, key) ? habit.name : `${habit.name} · Rest day`;
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
    const text = await readNote(slot);
    if (noteSlot !== slot) return; // another day was opened meanwhile
    area.value = text;
    noteOriginal = text;
  } catch {
    $('noteErr').textContent = 'This note could not be decrypted. Saving will replace it.';
  }
}

// Encrypts and stores the open note if it changed. Everything it needs is
// captured up front so it stays correct if the sheet closes while it runs.
async function flushNote() {
  const slot = noteSlot;
  const key = vaultKey;
  const text = $('noteText').value;
  if (!slot || !key || text === noteOriginal) return false;
  noteOriginal = text;
  if (text.trim()) {
    state.notes[slot] = await vault.encryptText(key, text, slot);
    plainNotes.set(slot, text);
  } else {
    delete state.notes[slot];
    plainNotes.delete(slot);
  }
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

// Redraws the parts of the habit page that show whether a day has a note.
function refreshNoteMarks() {
  const habit = activeHabit();
  if (!habit || showingToday()) return;
  renderCalendar(habit);
  renderNotesCard(habit);
  $('noteTodayBtn').textContent = noteButtonLabel(habit);
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
    lastActivity = Date.now();
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
    if (!(await tryUnlock($('pw').value))) {
      fail(form, 'unlockErr', 'Wrong password.');
      $('pw').select();
      return;
    }
    $('noteText').focus();
  });
});

$('unlockForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    if (!(await tryUnlock($('unlockPw').value))) {
      fail(form, 'unlockDialogErr', 'Wrong password.');
      $('unlockPw').select();
      return;
    }
    $('unlockDialog').close();
    const then = afterUnlock;
    afterUnlock = null;
    if (then) then();
  });
});

$('noteEdit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saved = await flushNote();
  $('noteDelete').hidden = !state.notes[noteSlot];
  refreshNoteMarks();
  toast(saved ? 'Note saved' : 'No changes to save');
});

$('noteDelete').addEventListener('click', async () => {
  if (!(await confirmDialog('Delete this note?', 'The note for this day will be removed for good.', 'Delete'))) return;
  delete state.notes[noteSlot];
  plainNotes.delete(noteSlot);
  saveState();
  await renderNote();
  refreshNoteMarks();
  toast('Note deleted');
});

$('dayToggle').addEventListener('click', () => {
  toggleDay(openKey);
  renderDayToggle();
});

$('dayDialog').addEventListener('close', async () => {
  // Closing the sheet keeps whatever was typed.
  const saved = await flushNote().catch(() => false);
  openKey = null;
  noteSlot = null;
  if (saved) refreshNoteMarks();
});

$('lockBtn').addEventListener('click', () => {
  if (vaultKey) lockNotes();
  else openUnlock();
});

$('notesUnlockBtn').addEventListener('click', () => openUnlock());
$('noteTodayBtn').addEventListener('click', () => openDay(todayKey()));

{
  let timer;
  $('noteSearch').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const habit = activeHabit();
      if (habit) renderNotesCard(habit);
    }, 120);
  });
}

// Lock notes after a stretch with no taps or typing, including time spent
// in another app.
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => { lastActivity = Date.now(); }, { capture: true, passive: true });
}
function checkAutoLock() {
  if (!vaultKey || !state.autoLock) return;
  if (Date.now() - lastActivity >= state.autoLock * 60_000) lockNotes('Notes locked', 'Locked after a while without activity.');
}
setInterval(checkAutoLock, 15_000);

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

// ---------- New habit, due days, colours ----------

// Seven weekday toggles in the locale's week order. At least one stays on.
function renderDayPicker(container, days, onChange) {
  container.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const wd = (WEEK_START + i) % 7;
    const btn = el('button', 'day-chip', weekdayName(wd, 'narrow'));
    btn.type = 'button';
    btn.setAttribute('aria-label', weekdayName(wd, 'long'));
    btn.setAttribute('aria-pressed', String(days.includes(wd)));
    btn.addEventListener('click', () => {
      const next = days.includes(wd) ? days.filter((d) => d !== wd) : cleanDays([...days, wd]);
      if (next.length) onChange(next);
    });
    container.append(btn);
  }
}

function renderSwatches(container, selected, onChange) {
  container.replaceChildren();
  COLORS.forEach((color, i) => {
    const btn = el('button', 'swatch');
    btn.type = 'button';
    btn.style.background = color;
    btn.setAttribute('aria-label', COLOR_NAMES[i]);
    btn.setAttribute('aria-pressed', String(i === selected));
    btn.addEventListener('click', () => onChange(i));
    container.append(btn);
  });
}

let draft = { days: ALL_DAYS.slice(), color: 0 };
function renderDraft() {
  renderDayPicker($('newDueDays'), draft.days, (days) => {
    draft.days = days;
    renderDraft();
  });
  renderSwatches($('newColors'), draft.color, (color) => {
    draft.color = color;
    renderDraft();
  });
}

function openNewHabit() {
  $('habitName').value = '';
  // Start on the first colour no other habit is using.
  const used = new Set(liveHabits().map((h) => h.color));
  const free = COLORS.findIndex((_, i) => !used.has(i));
  draft = { days: ALL_DAYS.slice(), color: free < 0 ? 0 : free };
  renderDraft();
  $('habitDialog').showModal();
}

$('habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (createHabit($('habitName').value, draft.days, draft.color)) $('habitDialog').close();
});

// ---------- Reminders ----------

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

// A repeating five-minute event on the habit's due days, in local time.
function reminderEvent(habit) {
  const [hh, mm] = habit.remind.split(':').map(Number);
  const start = parseKey(nextDueKey(habit, todayKey()));
  start.setHours(hh, mm);
  const end = new Date(start.getTime() + 5 * 60_000);
  return {
    title: `Check in: ${habit.name}`,
    start: stamp(start),
    end: stamp(end),
    rule: everyDay(habit) ? 'FREQ=DAILY' : `FREQ=WEEKLY;BYDAY=${habit.days.map((d) => BYDAY[d]).join(',')}`,
    url: location.origin + location.pathname,
  };
}

function googleCalendarUrl(habit) {
  const ev = reminderEvent(habit);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    details: `Open Streakfire to check in: ${ev.url}`,
    dates: `${ev.start}/${ev.end}`,
    recur: `RRULE:${ev.rule}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// iCalendar file (RFC 5545) with an alert at the start of the event.
function reminderIcs(habit) {
  const ev = reminderEvent(habit);
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const utc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Streakfire//Habit reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Same UID each time, so re-adding updates the event instead of duplicating it.
    `UID:${habit.id}@streakfire`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${utc}`,
    `DTSTART:${ev.start}`,
    `DTEND:${ev.end}`,
    `RRULE:${ev.rule}`,
    `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc(`Open Streakfire to check in: ${ev.url}`)}`,
    `URL:${ev.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(ev.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Lines longer than 75 bytes continue on the next line after a space.
function foldLine(line) {
  const enc = new TextEncoder();
  let out = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > 75) {
      out += '\r\n ';
      bytes = 1;
    }
    out += ch;
    bytes += size;
  }
  return out;
}

$('remindTime').addEventListener('change', (e) => {
  const habit = activeHabit();
  if (!habit || !TIME_RE.test(e.target.value)) return;
  habit.remind = e.target.value;
  saveState();
  $('remindGoogle').href = googleCalendarUrl(habit);
});

$('remindIcs').addEventListener('click', () => {
  const habit = activeHabit();
  if (!habit) return;
  download('streakfire-reminder.ics', 'text/calendar', reminderIcs(habit));
  toast('Reminder file ready', 'Open it to add the event to your calendar.');
});

// ---------- Share ----------

let shareBlob = null;
const shareFile = () => new File([shareBlob], 'streakfire-streak.png', { type: 'image/png' });

$('shareBtn').addEventListener('click', () => {
  const habit = activeHabit();
  if (!habit) return;
  const card = shareCard(habit.name, streakInfo(habit).current);
  $('sharePreview').getContext('2d').drawImage(card, 0, 0);
  shareBlob = null;
  $('shareSend').hidden = true;
  card.toBlob((blob) => {
    shareBlob = blob;
    $('shareSend').hidden = !blob || !navigator.canShare?.({ files: [shareFile()] });
  }, 'image/png');
  $('shareDialog').showModal();
});

$('shareSend').addEventListener('click', async () => {
  if (!shareBlob) return;
  try {
    await navigator.share({ files: [shareFile()] });
  } catch { /* the share sheet was dismissed */ }
});

$('shareSave').addEventListener('click', () => {
  if (shareBlob) download('streakfire-streak.png', 'image/png', shareBlob);
});

// ---------- Settings ----------

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

function renderHabitSettings() {
  const habit = showingToday() ? null : activeHabit();
  $('settingsHabit').hidden = !habit;
  if (!habit) return;
  $('renameInput').value = habit.name;
  renderSwatches($('colors'), habit.color, (color) => {
    habit.color = color;
    saveState();
    render();
    renderSettings();
  });
  renderDayPicker($('dueDays'), habit.days, (days) => {
    habit.days = days;
    // The schedule changed, not the user's effort: no "streak ended" toast.
    habit.seen = streakInfo(habit).current;
    saveState();
    render();
    renderSettings();
  });
  $('remindTime').value = habit.remind;
  $('remindGoogle').href = googleCalendarUrl(habit);
}

function iconButton(name, label, onClick, disabled = false) {
  const btn = el('button', 'icon-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.disabled = disabled;
  btn.append(icon(name));
  btn.addEventListener('click', onClick);
  return btn;
}

function textButton(label, onClick, danger = false) {
  const btn = el('button', `ghost compact${danger ? ' danger' : ''}`, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

// Swaps a habit with its neighbour among the habits that aren't archived.
function moveHabit(habit, step) {
  const live = liveHabits();
  const other = live[live.indexOf(habit) + step];
  if (!other) return;
  const a = state.habits.indexOf(habit);
  const b = state.habits.indexOf(other);
  [state.habits[a], state.habits[b]] = [state.habits[b], state.habits[a]];
  saveState();
  render();
  renderSettings();
}

function setArchived(habit, archived) {
  habit.archived = archived;
  saveState();
  render();
  renderSettings();
  toast(archived ? 'Habit archived' : 'Habit restored', archived ? 'Restore it any time from Settings.' : '');
}

async function deleteHabit(habit) {
  const ok = await confirmDialog(
    `Delete "${habit.name}"?`,
    'Its streak, history and notes will be removed for good.',
    'Delete habit',
  );
  if (!ok) return false;
  state.habits = state.habits.filter((h) => h.id !== habit.id);
  for (const slot of Object.keys(state.notes)) {
    if (slot.startsWith(`${habit.id}|`)) {
      delete state.notes[slot];
      plainNotes.delete(slot);
    }
  }
  saveState();
  render();
  renderSettings();
  toast('Habit deleted');
  return true;
}

function renderManageList() {
  const list = $('manageList');
  list.replaceChildren();
  const live = liveHabits();
  const archived = state.habits.filter((h) => h.archived);
  $('manageEmpty').hidden = state.habits.length > 0;
  live.forEach((habit, i) => {
    const row = el('li', 'manage-row');
    const name = el('span', 'manage-name');
    name.append(colorDot(habit), el('span', '', habit.name));
    row.append(
      name,
      iconButton('up', `Move ${habit.name} up`, () => moveHabit(habit, -1), i === 0),
      iconButton('down', `Move ${habit.name} down`, () => moveHabit(habit, 1), i === live.length - 1),
      textButton('Archive', () => setArchived(habit, true)),
    );
    list.append(row);
  });
  for (const habit of archived) {
    const row = el('li', 'manage-row archived');
    const name = el('span', 'manage-name');
    name.append(colorDot(habit), el('span', '', habit.name), el('span', 'pill', 'Archived'));
    row.append(
      name,
      textButton('Restore', () => setArchived(habit, false)),
      textButton('Delete', () => deleteHabit(habit), true),
    );
    list.append(row);
  }
}

function renderSettings() {
  renderHabitSettings();
  renderManageList();
  $('noVaultMsg').hidden = !!state.vault;
  $('vaultSettings').hidden = !state.vault;
  $('autoLock').value = String(state.autoLock);
}

$('settingsBtn').addEventListener('click', () => {
  renderSettings();
  for (const id of ['pwCurrent', 'pwNew', 'pwNew2']) $(id).value = '';
  $('pwErr').textContent = '';
  // Open on the section that matters for where the user is.
  const habitOpen = !$('settingsHabit').hidden;
  $('settingsHabit').open = habitOpen;
  $('settingsHabits').open = !habitOpen;
  $('settingsNotes').open = false;
  $('settingsData').open = false;
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
  renderSettings();
  toast('Habit renamed');
});

$('archiveHabitBtn').addEventListener('click', () => {
  const habit = activeHabit();
  if (habit) setArchived(habit, true);
});

$('deleteHabitBtn').addEventListener('click', async () => {
  const habit = activeHabit();
  if (habit && (await deleteHabit(habit))) $('settingsDialog').close();
});

$('autoLock').addEventListener('change', (e) => {
  const minutes = Number(e.target.value);
  if (!AUTO_LOCK_CHOICES.includes(minutes)) return;
  state.autoLock = minutes;
  lastActivity = Date.now();
  saveState();
});

// Changing the password re-encrypts every note under a key from the new one.
$('pwForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const next = $('pwNew').value;
  if (next.length < MIN_PASSWORD) return fail(form, 'pwErr', `Use at least ${MIN_PASSWORD} characters.`);
  if (next !== $('pwNew2').value) return fail(form, 'pwErr', 'The new passwords do not match.');
  withBusy(form, async () => {
    await flushNote().catch(() => false);
    const oldKey = await vault.unlock(state.vault, $('pwCurrent').value);
    if (!oldKey) return fail(form, 'pwErr', 'The current password is wrong.');
    const { key, meta } = await vault.create(next);
    const notes = {};
    let unreadable = 0;
    for (const slot of Object.keys(state.notes)) {
      try {
        notes[slot] = await vault.encryptText(key, await vault.decryptText(oldKey, state.notes[slot], slot), slot);
      } catch {
        unreadable++;
      }
    }
    if (unreadable) {
      return fail(form, 'pwErr', `${unreadable} note${unreadable === 1 ? '' : 's'} could not be read, so nothing was changed.`);
    }
    state.vault = meta;
    state.notes = notes;
    vaultKey = key;
    lastActivity = Date.now();
    saveState();
    for (const id of ['pwCurrent', 'pwNew', 'pwNew2']) $(id).value = '';
    $('pwErr').textContent = '';
    refreshNotesUi();
    toast('Password changed', 'All notes were re-encrypted.');
  });
});

async function exportNotes() {
  const ok = await confirmDialog(
    'Export notes as plain text?',
    'The file will not be encrypted. Anyone who opens it can read your notes.',
    'Export',
  );
  if (!ok) return;
  const parts = [];
  for (const habit of state.habits) {
    const slots = Object.keys(state.notes).filter((s) => s.startsWith(`${habit.id}|`)).sort();
    for (const slot of slots) {
      try {
        parts.push(`${habit.name} — ${slot.split('|')[1]}\n${await readNote(slot)}\n`);
      } catch { /* unreadable note: skip */ }
    }
  }
  if (!parts.length) {
    toast('No notes to export');
    return;
  }
  download(`streakfire-notes-${todayKey()}.txt`, 'text/plain', parts.join('\n'));
}

$('exportNotesBtn').addEventListener('click', () => {
  if (vaultKey) exportNotes();
  else openUnlock(exportNotes);
});

$('exportBtn').addEventListener('click', () => {
  download(`streakfire-backup-${todayKey()}.json`, 'application/json', JSON.stringify(state, null, 2));
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
  plainNotes.clear();
  viewMonth = monthStart(new Date());
  saveState();
  $('settingsDialog').close();
  render();
  toast('Backup imported');
});

$('eraseBtn').addEventListener('click', async () => {
  const ok = await confirmDialog(
    'Erase all data?',
    'Every habit, streak and note on this device will be removed for good. Export a backup first if you might want them back.',
    'Erase everything',
  );
  if (!ok) return;
  state = emptyState();
  vaultKey = null;
  plainNotes.clear();
  saveState();
  $('settingsDialog').close();
  render();
  toast('All data erased');
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

// Only one settings section stays open at a time.
for (const section of document.querySelectorAll('details.set')) {
  section.addEventListener('toggle', () => {
    if (!section.open) return;
    for (const other of document.querySelectorAll('details.set')) if (other !== section) other.open = false;
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
  if (document.hidden) return;
  checkDayChange();
  checkAutoLock();
});

// Offline support.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
