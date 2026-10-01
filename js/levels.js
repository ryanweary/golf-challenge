// Career ladder definitions, unlock rules and persistence.
export const TRACKS = [
  { id: 'drive', name: 'Longest Drive', icon: '🏌️', color: '#ffb347', blurb: 'Bomb it down the range. Beat the distance goal with your best of 3 balls.' },
  { id: 'target', name: 'Target Greens', icon: '🎯', color: '#7be07b', blurb: 'Pick the right club and stop the ball close to the pin.' },
  { id: 'wind', name: 'Crosswind', icon: '🌬️', color: '#7cc8ff', blurb: 'The wind shifts every ball. Aim into it and keep it on the short grass.' },
  { id: 'island', name: 'Island Green', icon: '🏝️', color: '#4fd1c5', blurb: 'Water all around. Only the green counts.' },
  { id: 'obstacle', name: 'Obstacle Shots', icon: '🌲', color: '#c3a6ff', blurb: 'Thread the gap or fly the trees, then find the flag.' },
  { id: 'tour', name: 'Tour Championship', icon: '🏆', color: '#ffd700', blurb: 'Multi-stage events that mix every skill. Earn stars to enter.' },
];

const W = (s, dir, gust = 0, vary = 0) => ({ s, dir, gust, vary });

const DRIVE = [
  [190, 70, W(3, 0), 0, false, [190, 210, 230]],
  [205, 66, W(4, 30), 0.05, false, [205, 225, 245]],
  [215, 62, W(5, 200), 0.1, false, [215, 235, 252]],
  [225, 58, W(6, 90), 0.15, true, [225, 242, 258]],
  [232, 54, W(7, 330), 0.22, true, [232, 248, 262]],
  [238, 50, W(8, 160), 0.3, true, [238, 249, 258]],
  [246, 46, W(9, 270), 0.38, true, [246, 259, 270]],
  [253, 42, W(10, 20), 0.46, true, [253, 268, 284]],
  [258, 39, W(11, 60), 0.54, true, [258, 270, 282]],
  [264, 36, W(12, 0, 3), 0.62, true, [264, 278, 292]],
];
const TARGET = [
  [[[120, 0]], 15, W(0, 0), 0, [2, 3, 4]],
  [[[150, -8]], 14, W(2, 90), 0.04, [2, 3, 4]],
  [[[100, 6], [160, -6]], 13, W(3, 200), 0.08, [3, 4, 5]],
  [[[130, -10], [180, 8]], 12, W(4, 60), 0.12, [3, 4, 5]],
  [[[110, 12], [150, -10], [190, 4]], 11, W(5, 240), 0.17, [3, 4, 5]],
  [[[140, -14], [200, 10]], 10, W(6, 120), 0.22, [3, 4, 5]],
  [[[90, 8], [170, -12], [210, 6]], 9, W(7, 300), 0.28, [3, 4, 5]],
  [[[125, -6], [185, 14], [225, -8]], 8, W(8, 180), 0.35, [3, 4, 5]],
  [[[105, 14], [155, -14], [205, 10]], 7, W(9, 45, 2), 0.42, [3, 4, 5]],
  [[[135, -10], [175, 12], [215, -6], [235, 8]], 6, W(10, 250, 3), 0.5, [3, 4, 5]],
];
const WIND = [
  [5, 0, 56, 150], [7, 0, 54, 160], [9, 0, 52, 170], [11, 0, 50, 180], [13, 3, 48, 185],
  [15, 4, 46, 190], [17, 5, 44, 195], [19, 6, 42, 200], [22, 7, 40, 205], [25, 8, 38, 210],
];
const ISLAND = [
  [100, 16, 0, W(0, 0)], [110, 15, 5, W(2, 60)], [120, 14, -6, W(3, 210)], [130, 13, 8, W(4, 100)],
  [140, 12, -8, W(6, 300)], [150, 11, 10, W(7, 150)], [160, 10, -10, W(8, 20)], [170, 9, 6, W(10, 240, 2)],
];
const OBST = [
  [[{ d: 80, type: 'gap', gap: 30, gx: 0 }], [150, 0], 15, W(0, 0), [2, 3, 4]],
  [[{ d: 60, type: 'over', h: 16 }], [115, 0], 15, W(2, 180), [2, 3, 4]],
  [[{ d: 90, type: 'gap', gap: 24, gx: 6 }], [160, -4], 14, W(3, 90), [3, 4, 5]],
  [[{ d: 55, type: 'over', h: 19 }], [105, 4], 13, W(4, 0), [3, 4, 5]],
  [[{ d: 100, type: 'gap', gap: 19, gx: -8 }], [170, 6], 12, W(4, 250), [3, 4, 5]],
  [[{ d: 50, type: 'over', h: 22 }], [95, -5], 12, W(5, 200), [3, 4, 5]],
  [[{ d: 110, type: 'gap', gap: 15, gx: 10 }], [180, -6], 11, W(6, 60), [3, 4, 5]],
  [[{ d: 45, type: 'over', h: 15 }, { d: 125, type: 'gap', gap: 16, gx: -6 }], [175, 0], 10, W(7, 300), [3, 4, 5]],
];

const driveStage = (goal, fw, wind, reqFW, balls = 3) => ({ mode: 'drive', goal, fw, wind, reqFW, balls });
const targetStage = (flags, R, wind, balls = 5) => ({ mode: 'target', flags: flags.map(([d, x]) => ({ d, x })), R, wind, balls });
const windStage = (s, gust, fw, D, balls = 5) => ({ mode: 'wind', fw, D, wind: W(s, 90, gust, 1), balls });
const islandStage = (d, gr, x, wind, balls = 5) => ({ mode: 'island', d, gr, x, wind, balls });
const obstStage = (rows, flag, R, wind, balls = 5) => ({ mode: 'obstacle', rows, flag: { d: flag[0], x: flag[1] }, R, wind, balls });

export const LEVELS = [];
const add = (track, idx, name, stages, metric, stars, sd, extra = {}) =>
  LEVELS.push({ id: `${track}-${idx + 1}`, track, idx, name, stages, metric, stars, sd, seed: 100 + LEVELS.length * 7, ...extra });

DRIVE.forEach(([goal, fw, wind, sd, req, stars], i) =>
  add('drive', i, `Drive ${goal} yd`, [driveStage(goal, fw, wind, req)], 'best', stars, sd));
TARGET.forEach(([flags, R, wind, sd, stars], i) =>
  add('target', i, `${flags.length > 1 ? flags.length + ' flags' : flags[0][0] + ' yd flag'} · ${R} yd`, [targetStage(flags, R, wind)], 'hits', stars, sd));
WIND.forEach(([s, g, fw, D], i) =>
  add('wind', i, `${s} mph${g ? ' gusting' : ''} crosswind`, [windStage(s, g, fw, D)], 'hits', [3, 4, 5], Math.min(0.5, i * 0.055)));
ISLAND.forEach(([d, gr, x, wind], i) =>
  add('island', i, `${d} yd island · ${gr} yd green`, [islandStage(d, gr, x, wind)], 'hits', i < 2 ? [2, 3, 4] : [3, 4, 5], Math.min(0.45, i * 0.06)));
OBST.forEach(([rows, flag, R, wind, stars], i) =>
  add('obstacle', i, rows.map(r => r.type === 'gap' ? `${r.gap} yd gap` : `${r.h} m trees`).join(' + '), [obstStage(rows, flag, R, wind)], 'hits', stars, Math.min(0.45, i * 0.065)));

const TOUR = [
  ['Sunset Invitational', 18, 0.3, [3, 4, 5], [
    driveStage(220, 60, W(4, 20), true, 2), targetStage([[140, 0]], 10, W(4, 250), 2), islandStage(110, 14, 0, W(3, 120), 2)]],
  ['Coastal Classic', 30, 0.36, [3, 4, 5], [
    windStage(10, 2, 50, 170, 2), obstStage([{ d: 90, type: 'gap', gap: 22, gx: -4 }], [150, 4], 12, W(5, 200), 2), targetStage([[120, -8], [170, 8]], 9, W(6, 60), 2)]],
  ['Canyon Open', 42, 0.42, [4, 5, 6], [
    driveStage(240, 50, W(6, 330), true, 2), islandStage(140, 12, -6, W(5, 90), 2), obstStage([{ d: 55, type: 'over', h: 19 }], [100, 0], 10, W(4, 180), 2)]],
  ['Highland Masters', 56, 0.48, [4, 5, 6], [
    windStage(16, 4, 44, 190, 2), targetStage([[110, 10], [160, -10], [200, 6]], 8, W(8, 300, 2), 3), islandStage(155, 11, 8, W(7, 210), 2)]],
  ['Royal Links Cup', 72, 0.55, [4, 5, 6], [
    driveStage(252, 42, W(9, 100), true, 2), obstStage([{ d: 110, type: 'gap', gap: 16, gx: 8 }], [175, -4], 10, W(6, 20), 2),
    windStage(20, 6, 40, 200, 2), islandStage(165, 10, -8, W(6, 270, 2), 2)]],
  ['Golden Hour Grand Final', 90, 0.62, [5, 7, 8], [
    driveStage(255, 38, W(8, 30, 3), true, 2), targetStage([[130, -8], [190, 10]], 8, W(8, 70, 3), 2),
    windStage(24, 8, 38, 205, 2), islandStage(165, 10, 6, W(7, 320, 2), 2),
    obstStage([{ d: 45, type: 'over', h: 15 }, { d: 125, type: 'gap', gap: 15, gx: 6 }], [175, 0], 10, W(6, 110), 2)]],
];
TOUR.forEach(([name, req, sd, stars, stages], i) => add('tour', i, name, stages, 'hits', stars, sd, { reqStars: req }));

export const levelById = id => LEVELS.find(l => l.id === id);
export const trackLevels = t => LEVELS.filter(l => l.track === t);
export const totalBalls = lv => lv.stages.reduce((a, s) => a + s.balls, 0);

export const RANKS = [[0, 'Rookie'], [10, 'Weekend Hacker'], [25, 'Club Amateur'], [45, 'Scratch Golfer'], [70, 'Club Pro'], [95, 'Tour Pro'], [120, 'Major Champion'], [145, 'Range Legend']];
export const rankFor = stars => { let r = RANKS[0][1]; for (const [n, name] of RANKS) if (stars >= n) r = name; return r; };
export const MAX_STARS = LEVELS.length * 3;

// ------------------------------------------------------------ persistence
const KEY = 'goldenHourGolf.v1';
export const Store = {
  data: null,
  load() {
    try { this.data = JSON.parse(localStorage.getItem(KEY)) || null; } catch { this.data = null; }
    if (!this.data || typeof this.data !== 'object') this.data = {};
    this.data.levels ||= {};
    this.data.settings = { sound: true, music: true, sfx: true, haptics: true, quality: 'auto', ...(this.data.settings || {}) };
    this.data.tutorialDone ||= false;
    return this.data;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ } },
  reset() { const s = this.data.settings; this.data = { levels: {}, settings: s, tutorialDone: false }; this.save(); },
  rec(id) { return this.data.levels[id] || { stars: 0, best: 0, plays: 0 }; },
  passed(id) { return (this.data.levels[id]?.stars || 0) > 0; },
  totalStars() { return Object.values(this.data.levels).reduce((a, r) => a + (r.stars || 0), 0); },
  record(id, stars, best, higherBetter = true) {
    const r = { ...this.rec(id) };
    r.plays = (r.plays || 0) + 1;
    const isNewBest = higherBetter ? best > (r.best || 0) : true;
    if (isNewBest) r.best = best;
    const newStars = stars > (r.stars || 0);
    r.stars = Math.max(r.stars || 0, stars);
    this.data.levels[id] = r; this.save();
    return { isNewBest, newStars };
  },
};

// unlock rules
export function trackUnlock(track) {
  switch (track) {
    case 'drive': case 'target': return { ok: true };
    case 'wind': return { ok: Store.passed('drive-3'), req: 'Clear Longest Drive 3' };
    case 'island': return { ok: Store.passed('target-3'), req: 'Clear Target Greens 3' };
    case 'obstacle': return { ok: Store.passed('wind-2') && Store.passed('island-2'), req: 'Clear Crosswind 2 and Island Green 2' };
    case 'tour': return { ok: Store.totalStars() >= 18, req: 'Earn 18 ★ to enter' };
  }
  return { ok: false };
}
export function levelUnlock(lv) {
  const t = trackUnlock(lv.track);
  if (!t.ok) return t;
  if (lv.idx > 0 && !Store.passed(`${lv.track}-${lv.idx}`)) return { ok: false, req: `Clear level ${lv.idx} first` };
  if (lv.reqStars && Store.totalStars() < lv.reqStars) return { ok: false, req: `Needs ${lv.reqStars} ★` };
  return { ok: true };
}
export function nextLevel(lv) {
  const same = LEVELS.find(l => l.track === lv.track && l.idx === lv.idx + 1);
  return same || null;
}
export function starsFor(lv, value) {
  let s = 0; for (const th of lv.stars) if (value >= th) s++; return s;
}
