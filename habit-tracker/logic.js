// Pure date, schedule and streak maths. No DOM, no storage.

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // weekday numbers, Sunday = 0

// ---------- Dates (always local calendar days, as YYYY-MM-DD keys) ----------

export const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
export const todayKey = () => dateKey(new Date());
export const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

export function firstDayOfWeek() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch { /* fall through */ }
  return /^en-(US|CA)$/i.test(navigator.language) ? 0 : 1;
}

// ---------- Schedules ----------

// A habit is due on its chosen weekdays. Days off never break a streak.
export function cleanDays(value) {
  if (!Array.isArray(value)) return ALL_DAYS.slice();
  const days = ALL_DAYS.filter((d) => value.includes(d));
  return days.length ? days : ALL_DAYS.slice();
}
export const isDue = (habit, key) => habit.days.includes(parseKey(key).getDay());
export const everyDay = (habit) => habit.days.length === 7;

export function nextDueKey(habit, from) {
  let key = from;
  while (!isDue(habit, key)) key = addDays(key, 1);
  return key;
}

const firstDone = (habit, today) => Object.keys(habit.done).filter((k) => k <= today).sort()[0];

// ---------- Streaks ----------

// Every streak the habit has had, oldest first. Only a missed due day ends a
// streak, and today doesn't count as missed until it is over. The last run is
// `alive` when nothing has ended it yet.
export function streakRuns(habit) {
  const today = todayKey();
  const first = firstDone(habit, today);
  const runs = [];
  if (!first) return runs;
  let run = null;
  for (let k = first; k <= today; k = addDays(k, 1)) {
    if (habit.done[k]) {
      if (!run) run = { start: k, end: k, length: 0, alive: false };
      run.end = k;
      run.length++;
    } else if (run && isDue(habit, k) && k !== today) {
      runs.push(run);
      run = null;
    }
  }
  if (run) {
    run.alive = true;
    runs.push(run);
  }
  return runs;
}

export function streakInfo(habit) {
  const today = todayKey();
  const runs = streakRuns(habit);
  const last = runs[runs.length - 1];
  const doneToday = !!habit.done[today];
  const dueToday = isDue(habit, today);
  const current = last?.alive ? last.length : 0;
  return {
    current,
    longest: runs.reduce((max, r) => Math.max(max, r.length), 0),
    total: runs.reduce((sum, r) => sum + r.length, 0),
    doneToday,
    dueToday,
    atRisk: current > 0 && dueToday && !doneToday,
  };
}

// How one day should be shown: done, a day off, missed, still open (today),
// in the future, or before the habit existed.
export function dayState(habit, key, today = todayKey(), first = firstDone(habit, today)) {
  if (key > today) return 'future';
  if (habit.done[key]) return 'done';
  if (!isDue(habit, key)) return 'off';
  if (key === today) return 'open';
  return first && key > first ? 'miss' : 'none';
}

// The last seven days, oldest first.
export function weekStrip(habit) {
  const today = todayKey();
  const first = firstDone(habit, today);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i);
    out.push({ key, weekday: parseKey(key).getDay(), state: dayState(habit, key, today, first) });
  }
  return out;
}

// ---------- Insights ----------

export function insights(habit) {
  const today = todayKey();
  const first = firstDone(habit, today);
  if (!first) return null;

  const from30 = addDays(today, -29);
  const hit = ALL_DAYS.map(() => 0);
  const chances = ALL_DAYS.map(() => 0);
  let done30 = 0;
  let chances30 = 0;
  for (let k = first; k <= today; k = addDays(k, 1)) {
    const done = !!habit.done[k];
    // A chance is a due day (or a bonus check-in). Today only counts once done.
    if (!done && (!isDue(habit, k) || k === today)) continue;
    const wd = parseKey(k).getDay();
    chances[wd]++;
    if (done) hit[wd]++;
    if (k >= from30) {
      chances30++;
      if (done) done30++;
    }
  }

  const byWeekday = ALL_DAYS.map((wd) => (chances[wd] ? hit[wd] / chances[wd] : null));
  let bestDay = null;
  for (const wd of ALL_DAYS) {
    if (chances[wd] < 2) continue;
    if (bestDay === null || byWeekday[wd] > byWeekday[bestDay]
      || (byWeekday[wd] === byWeekday[bestDay] && hit[wd] > hit[bestDay])) bestDay = wd;
  }

  const runs = streakRuns(habit).slice().sort((a, b) => b.length - a.length || (a.end < b.end ? 1 : -1)).slice(0, 5);
  return {
    rate30: chances30 ? Math.round((done30 / chances30) * 100) : null,
    bestDay,
    byWeekday,
    runs,
  };
}

// 53 weeks of days ending with the current week, in week columns that start
// on `weekStart`. Each week also says whether a new month begins in it.
export function yearGrid(habit, weekStart) {
  const today = todayKey();
  const first = firstDone(habit, today);
  const thisWeek = addDays(today, -((parseKey(today).getDay() - weekStart + 7) % 7));
  const weeks = [];
  let prevMonth = -1;
  for (let w = 52; w >= 0; w--) {
    const start = addDays(thisWeek, -7 * w);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(start, i);
      days.push({ key, state: dayState(habit, key, today, first) });
    }
    const month = parseKey(start).getMonth();
    weeks.push({ start, days, newMonth: month !== prevMonth });
    prevMonth = month;
  }
  return weeks;
}
