import * as THREE from 'three';
import { World, QUALITY } from './world.js';
import { Course, makeLayout, YD, SURF, WATER_Y } from './terrain.js';
import { CLUBS, simulateShot, sampleAt, strikeFromMeter, launchFor, makeWind, BALL_R } from './physics.js';
import { LEVELS, TRACKS, Store, trackUnlock, levelUnlock, nextLevel, starsFor, trackLevels, totalBalls, rankFor, RANKS, MAX_STARS, levelById } from './levels.js';
import { windFor, targetFor, judge, goalText } from './rules.js';
import { Sfx } from './audio.js';
import { clamp, lerp, mulberry32 } from './noise.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MAXM = 1.15, AIM_MAX = 30 * Math.PI / 180, DEAD = 10, SENS = 0.11 * Math.PI / 180;
const MODE_NAME = { drive: 'Longest Drive', target: 'Target Greens', wind: 'Crosswind', island: 'Island Green', obstacle: 'Obstacle Shots' };

Store.load();
const settings = Store.data.settings;
const sfx = new Sfx(); sfx.muted = !settings.sound;

let world;
try { world = new World($('c')); } catch (e) {
  $('loading-text').textContent = 'Sorry — this device/browser could not start WebGL.'; throw e;
}
const cam = world.camera;

const G = {
  state: 'boot', lv: null, stageIdx: 0, ballInStage: 0, ballNo: 0, hits: 0, best: 0, shots: [],
  stage: null, course: null, wind: { s: 0, dir: 0, gust: 0 }, windFn: null, clubIdx: 0,
  aim: 0, aimGoal: 0, m: 0, holdStart: 0, zone: { lo: 0.82, hi: 0.98 }, period: 2.3, inZone: false,
  shot: null, carryTables: null, speed: 1, rng: mulberry32(Date.now() & 0xffff), q: 3, quality: settings.quality,
};
window.__golf = { G, Store, LEVELS, world, startLevel: id => startLevel(levelById(id)) };

// ------------------------------------------------------------ quality
function initialQuality() {
  if (params.has('q')) return clamp(+params.get('q') | 0, 0, 3);
  if (settings.quality !== 'auto') return clamp(+settings.quality | 0, 0, 3);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  return mobile ? 2 : 3;
}
G.q = initialQuality(); world.setQuality(G.q);
const perf = { acc: 0, frames: 0, cool: 3, lowStreak: 0 };
function adaptQuality(dt) {
  if (params.has('q') || settings.quality !== 'auto') return;
  if (document.hidden || dt > 0.5) return;
  perf.cool -= dt; perf.acc += dt; perf.frames++;
  if (perf.acc < 2) return;
  const fps = perf.frames / perf.acc; perf.acc = 0; perf.frames = 0;
  if (perf.cool > 0) return;
  if (fps < 40 && G.q > 0) { perf.lowStreak++; if (perf.lowStreak >= 1) { G.q--; world.setQuality(G.q); perf.cool = 3; perf.lowStreak = 0; updateQInfo(); } }
  else perf.lowStreak = 0;
}

// ------------------------------------------------------------ helpers
function show(id, on = true) { $(id).classList.toggle('show', on); }
function screen(id) { for (const s of ['title', 'career']) show(s, s === id); $('labels').style.display = id === 'career' ? 'none' : ''; $('touch').classList.toggle('on', id === 'game'); $('hud').classList.toggle('hidden', id !== 'game'); }
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function vibrate(p) { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch { /* ignore */ } }
const yd = m => m / YD;
function popText(text, color) { const p = $('pop'); p.textContent = text; p.style.color = color || '#fff'; p.classList.remove('show'); void p.offsetWidth; p.classList.add('show'); }
const deg = r => r * 180 / Math.PI;

// ------------------------------------------------------------ labels
const labelEls = new Map();
const zoneLabel = { key: 'zone', pos: new THREE.Vector3(), text: '', kind: 'zone' };
function syncLabels(extra = [], hideFlags = false) {
  const want = [...(hideFlags ? world.labels.filter(l => !l.g) : world.labels), ...extra];
  const used = new Set();
  const v = new THREE.Vector3(), W = innerWidth, H = innerHeight;
  want.forEach((L, i) => {
    const key = L.key || (L.g ? 'g' + world.course.L.greens.indexOf(L.g) : 'l' + i);
    used.add(key);
    let el = labelEls.get(key);
    if (!el) { el = document.createElement('div'); el.className = 'lbl'; $('labels').appendChild(el); labelEls.set(key, el); }
    v.copy(L.pos).project(cam);
    const vis = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2;
    el.style.display = vis ? '' : 'none';
    if (!vis) return;
    let text = L.text, cls = 'lbl';
    if (L.g) {
      const d = Math.round(yd(Math.hypot(L.g.pinX, L.g.pinZ)));
      text = `${d} yd`; const tgt = G.course && targetFor(G.stage, G.course, G.ballInStage);
      if (tgt && tgt.g === L.g && G.stage.mode !== 'drive') cls += ' on';
    } else if (L.kind === 'line') cls += ' line';
    else if (L.kind === 'rest') cls += ' rest';
    else if (L.kind) cls += ' ' + L.kind;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
    el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, ${L.key === 'zone' ? '35%' : '-100%'})`;
  });
  for (const [k, el] of labelEls) if (!used.has(k)) { el.remove(); labelEls.delete(k); }
}

// ------------------------------------------------------------ particles
const parts = [];
const partMat = c => new THREE.SpriteMaterial({ map: world.glowTex, color: c, transparent: true, depthWrite: false, opacity: 0.9 });
function burst(p, kind) {
  const n = kind === 'splash' ? 26 : kind === 'leaves' ? 16 : 12;
  const color = kind === 'splash' ? 0xdff4ff : kind === 'leaves' ? 0x5f8a2c : kind === 'sand' ? 0xe8d3a0 : 0x9fc070;
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(partMat(color));
    s.position.copy(p); const a = Math.random() * Math.PI * 2, sp = kind === 'splash' ? 2 + Math.random() * 3 : 1 + Math.random() * 2;
    s.userData = { v: new THREE.Vector3(Math.cos(a) * sp * 0.5, (kind === 'splash' ? 4 : 2) + Math.random() * 3, Math.sin(a) * sp * 0.5), life: 0.9 + Math.random() * 0.5, age: 0, size: kind === 'splash' ? 0.5 : 0.3 };
    world.scene.add(s); parts.push(s);
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i], u = s.userData; u.age += dt;
    u.v.y -= 9.8 * dt; s.position.addScaledVector(u.v, dt);
    const k = u.age / u.life; s.material.opacity = 0.9 * (1 - k); const sc = u.size * (1 + k * 2); s.scale.set(sc, sc, 1);
    if (k >= 1) { world.scene.remove(s); s.material.dispose(); parts.splice(i, 1); }
  }
}

// ------------------------------------------------------------ course / stage
function buildStage(stage, seed) {
  const course = new Course(makeLayout({ ...stage, seed }));
  course.holes = course.L.greens.filter(g => g.flag).map(g => ({ x: g.pinX, z: g.pinZ }));
  return course;
}
function computeCarryTables(course) {
  const ps = [0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0];
  return CLUBS.map(cl => ps.map(p => {
    const l = launchFor(cl, { power: p, quality: 2 });
    const r = simulateShot(course, { x: 0, y: course.heightAt(0, 0) + BALL_R + cl.tee, z: 0, ...l, aim: 0, carryOnly: true, noTrees: true });
    return [p, r.carry];
  }));
}
function carryFor(ci, power) {
  const t = G.carryTables[ci]; if (power <= t[0][0]) return t[0][1] * power / t[0][0];
  for (let i = 1; i < t.length; i++) if (power <= t[i][0]) { const f = (power - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return lerp(t[i - 1][1], t[i][1], f); }
  return t[t.length - 1][1];
}
function setZoneFromSd(sd) {
  const w = 0.17 - 0.09 * sd; G.zone = { lo: 0.98 - w, hi: 0.98 }; G.period = 2.35 - 0.7 * sd;
  const track = document.querySelector('.m-track');
  const pct = v => (v / MAXM * 100) + '%';
  document.querySelector('.m-zone').style.bottom = pct(G.zone.lo);
  document.querySelector('.m-zone').style.height = `calc(${pct(G.zone.hi - G.zone.lo)})`;
  document.querySelector('.m-over').style.height = pct(MAXM - G.zone.hi);
  void track;
}

async function loadStage(si) {
  G.stageIdx = si; G.stage = G.lv.stages[si]; G.ballInStage = 0;
  $('loading').classList.remove('fade'); show('loading', true); $('loading-text').textContent = G.lv.stages.length > 1 ? `Stage ${si + 1}: ${MODE_NAME[G.stage.mode]}` : 'Setting up the range…';
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
  G.course = buildStage(G.stage, G.lv.seed + si * 31);
  world.buildCourse(G.course, G.q);
  G.carryTables = computeCarryTables(G.course);
  buildClubChips();
  setZoneFromSd(G.lv.sd);
  $('loading').classList.add('fade'); setTimeout(() => show('loading', false), 450);
  prepareBall();
}

function stageTargets() { return G.course.L.greens.filter(g => g.target); }

function prepareBall() {
  const st = G.stage;
  G.wind = windFor(st, G.ballInStage, G.rng);
  G.windFn = makeWind(G.wind.s, G.wind.dir, G.wind.gust, (G.rng() * 1e6) | 0);
  world.windYaw = Math.PI / 2 - G.wind.dir * Math.PI / 180;
  world.uniforms.uWind.value = 0.5 + G.wind.s * 0.06;
  sfx.setWind(G.wind.s);
  const tgts = stageTargets(), tgt = targetFor(st, G.course, G.ballInStage);
  world.setTargets(tgts, st.mode === 'target' || st.mode === 'obstacle' ? st.R : 0, tgt ? tgts.indexOf(tgt.g) : -1);
  // default club + aim
  let want = st.mode === 'drive' ? 300 : st.mode === 'wind' ? st.D + 40 : tgt ? yd(Math.hypot(tgt.x, tgt.z)) : 200;
  if (st.mode === 'drive' || st.mode === 'wind') G.clubIdx = 0;
  else {
    let best = 0; for (let i = CLUBS.length - 1; i >= 0; i--) { if (yd(G.carryTables[i][6][1]) >= want - 3) { best = i; break; } }
    G.clubIdx = best;
  }
  G.aim = G.aimGoal = tgt ? Math.round(deg(Math.atan2(tgt.x, -tgt.z))) * Math.PI / 180 : 0;
  G.shot = null; world.setTracer([]); world.landMark.visible = false; G.restLabel = null;
  placeBallAtTee();
  setState('aim');
  updateHud();
}
function placeBallAtTee() {
  const cl = CLUBS[G.clubIdx], h = G.course.heightAt(0, 0);
  G.ballPos = new THREE.Vector3(0, h + BALL_R + cl.tee, 0);
  world.tee.visible = cl.tee > 0.008; world.tee.position.set(0, h + cl.tee + 0.004, 0);
  world.setBall(G.ballPos, 0);
}

// ------------------------------------------------------------ HUD
function buildClubChips() {
  const box = $('clubs'); box.innerHTML = '';
  CLUBS.forEach((cl, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'club'; b.dataset.i = i;
    b.innerHTML = `<b>${cl.id}</b><small>${Math.round(yd(G.carryTables[i][6][1]))}</small>`;
    b.addEventListener('click', () => { if (G.state !== 'aim') return; G.clubIdx = i; sfx.click(); placeBallAtTee(); updateHud(); });
    box.appendChild(b);
  });
}
function updateHud() {
  const lv = G.lv, st = G.stage;
  $('h-title').textContent = `${TRACKS.find(t => t.id === lv.track).icon} ${lv.track === 'tour' ? lv.name : MODE_NAME[st.mode] + ' ' + (lv.idx + 1)}`;
  $('h-goal').textContent = (lv.stages.length > 1 ? `Stage ${G.stageIdx + 1}/${lv.stages.length} · ` : '') + goalText(st);
  const tb = totalBalls(lv);
  $('h-balls').textContent = `Ball ${Math.min(G.ballNo + 1, tb)}/${tb}`;
  $('h-score').textContent = lv.metric === 'best' ? `Best ${Math.round(G.best)} · goal ${st.goal}` : `Hits ${G.hits} · need ${lv.stars[0]}`;
  $('w-mph').textContent = Math.round(G.wind.s);
  const rel = G.wind.dir - deg(G.aim);
  $('w-arrow').style.transform = `rotate(${rel}deg)`;
  $('w-lbl').textContent = G.wind.s < 0.5 ? 'calm' : (G.wind.gust ? 'mph gust' : 'mph');
  $('wind').style.opacity = G.wind.s < 0.5 ? 0.6 : 1;
  const a = Math.round(deg(G.aim));
  $('aim-val').textContent = a === 0 ? 'Aim straight' : `Aim ${Math.abs(a)}° ${a < 0 ? 'L' : 'R'}`;
  document.querySelectorAll('.club').forEach((b, i) => b.classList.toggle('on', i === G.clubIdx));
  const sel = document.querySelector('.club.on'); if (sel && G.state === 'aim') sel.scrollIntoView({ block: 'nearest', inline: 'center' });
}
function updateMeter() {
  const m = G.state === 'charge' ? G.m : 0, pct = m / MAXM * 100;
  document.querySelector('.m-fill').style.height = `calc(${pct}% - 8px)`;
  document.querySelector('.m-needle').style.bottom = `calc(${pct}% - 2px)`;
  $('m-pct').textContent = Math.round(Math.min(m, 1.15) * 100) + '%';
  const inZ = m >= G.zone.lo && m <= G.zone.hi;
  $('meter').classList.toggle('inzone', G.state === 'charge' && inZ);
  $('meter').classList.toggle('over', G.state === 'charge' && m > G.zone.hi);
}

function setState(s) {
  G.state = s;
  const hud = $('hud');
  hud.classList.toggle('charging', s === 'charge');
  hud.classList.toggle('flying', s === 'flight' || s === 'replay' || s === 'rest');
  $('meter').classList.toggle('hidden', !(s === 'aim' || s === 'charge'));
  $('flight-info').classList.toggle('hidden', !(s === 'flight' || s === 'replay' || s === 'rest'));
  $('swing-hint').classList.toggle('hidden', s !== 'aim');
  $('cancel-hint').classList.add('hidden');
  if (s !== 'rest') $('shot-card').classList.add('hidden');
  updateMeter();
}

// ------------------------------------------------------------ input
const touch = $('touch');
let ptr = null;
touch.addEventListener('pointerdown', e => {
  sfx.unlock();
  if (ptr !== null) return;
  if (G.state === 'flight' || G.state === 'replay') { G.speed = G.speed > 1 ? 1 : 4; return; }
  if (G.state !== 'aim') return;
  e.preventDefault();
  ptr = e.pointerId; try { touch.setPointerCapture(e.pointerId); } catch { /* */ }
  G.press = { x: e.clientX, y: e.clientY, aim0: G.aimGoal };
  G.holdStart = performance.now(); G.m = 0; G.inZone = false; G.cancel = false;
  setState('charge'); sfx.chargeStart();
});
touch.addEventListener('pointermove', e => {
  if (e.pointerId !== ptr || G.state !== 'charge') return;
  const dx = e.clientX - G.press.x, dy = e.clientY - G.press.y;
  const eff = Math.sign(dx) * Math.max(0, Math.abs(dx) - DEAD);
  G.aimGoal = clamp(G.press.aim0 + eff * SENS, -AIM_MAX, AIM_MAX);
  G.cancel = dy > 130;
  $('cancel-hint').classList.toggle('hidden', !G.cancel);
});
function endPress(e, cancelled) {
  if (e.pointerId !== ptr) return;
  ptr = null; sfx.chargeStop();
  if (G.state !== 'charge') return;
  if (cancelled || G.cancel) { setState('aim'); toast('Swing cancelled', 1200); return; }
  G.m = meterAt(performance.now());
  swing();
}
touch.addEventListener('pointerup', e => endPress(e, false));
touch.addEventListener('pointercancel', e => endPress(e, true));
function meterAt(now) { if (window.__golf.freezeMeter != null) return window.__golf.freezeMeter; const t = (now - G.holdStart) / 1000, ph = (t % G.period) / G.period; return MAXM * (ph < 0.5 ? ph * 2 : 2 - ph * 2); }

function nudgeButton(id, dir) {
  const el = $(id); let tm = 0, iv = 0;
  const step = () => { if (G.state !== 'aim') return; G.aimGoal = clamp(G.aimGoal + dir * Math.PI / 180, -AIM_MAX, AIM_MAX); sfx.click(); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); step(); tm = setTimeout(() => { iv = setInterval(step, 70); }, 320); });
  const stop = () => { clearTimeout(tm); clearInterval(iv); };
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
}
nudgeButton('aim-l', -1); nudgeButton('aim-r', 1);

// ------------------------------------------------------------ swing
function swing() {
  const cl = CLUBS[G.clubIdx];
  const strike = strikeFromMeter(G.m, G.zone, cl, G.rng);
  const l = launchFor(cl, strike);
  G.aim = G.aimGoal;
  const res = simulateShot(G.course, { x: G.ballPos.x, y: G.ballPos.y, z: G.ballPos.z, ...l, aim: G.aim, face: strike.face, tilt: strike.tilt, wind: G.windFn, seed: (G.rng() * 1e9) | 0 });
  G.shot = { res, strike, club: cl, t: 0, ev: 0, pts: [], ptT: 0, landed: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), replay: false };
  const L = res.land, lx = L.x, lz = L.z, dl = Math.hypot(lx, lz) || 1;
  const toTee = new THREE.Vector3(-lx / dl, 0, -lz / dl), side = new THREE.Vector3(-toTee.z, 0, toTee.x);
  const curve = Math.sign(res.rest.x - lx * 1) || 1;
  G.shot.landCam = new THREE.Vector3(lx, G.course.heightAt(lx, lz), lz).addScaledVector(toTee, 18 + dl * 0.05).addScaledVector(side, -curve * (10 + dl * 0.04)).add(new THREE.Vector3(0, 4.5 + dl * 0.012, 0));
  const hc = G.course.heightAt(G.shot.landCam.x, G.shot.landCam.z); if (G.shot.landCam.y < hc + 2) G.shot.landCam.y = hc + 2;
  G.speed = 1;
  setState('flight');
  sfx.whoosh(strike.power); sfx.strike(strike.quality, cl.id === 'DR' || cl.id === '3W');
  vibrate(strike.quality === 3 ? [25, 30, 45] : strike.quality === 2 ? 30 : 18);
  const colors = ['#ffb08a', '#ffe08a', '#b9ffd6', '#4ee08a'];
  setTimeout(() => popText(strike.label, colors[strike.quality]), 90);
  world.tee.visible = false;
}

// ------------------------------------------------------------ camera
const camPos = new THREE.Vector3(0, 2, 4), camLook = new THREE.Vector3(0, 0, -50);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function addressCam(out, look) {
  const a = G.aim, fx = Math.sin(a), fz = -Math.cos(a), b = G.ballPos;
  const portrait = innerHeight > innerWidth;
  const back = portrait ? 2.9 : 6, up = portrait ? 1.3 : 1.4;
  out.set(b.x - fx * back, b.y + up, b.z - fz * back);
  const pitch = portrait ? 0.2 : 0.155;
  look.set(b.x + fx * 60, b.y + up - Math.tan(pitch) * (60 + back), b.z + fz * 60);
}
function damp(cur, target, rate, dt) { return cur.lerp(target, 1 - Math.exp(-rate * dt)); }

// ------------------------------------------------------------ flight playback
function updateFlight(dt) {
  const S = G.shot, res = S.res;
  const step = dt * G.speed * (S.t > res.landT + 0.3 ? 1.6 : 1);
  S.t = Math.min(res.endT, S.t + step);
  S.prev.copy(S.pos);
  sampleAt(res, S.t, S.pos);
  // tracer points
  while (S.ptT <= Math.min(S.t, res.landT + 0.05)) { const p = new THREE.Vector3(); sampleAt(res, S.ptT, p); S.pts.push(p); S.ptT += 0.035; }
  if (!S.landed) S.pts.push(S.pos.clone());
  world.setTracer(S.pts, 1);
  if (!S.landed) S.pts.pop();
  // events
  while (S.ev < res.events.length && res.events[S.ev].t <= S.t) {
    const ev = res.events[S.ev++]; const p = new THREE.Vector3(ev.x, ev.y, ev.z);
    if (ev.type === 'bounce') {
      if (!S.landed) { S.landed = true; world.landMark.visible = true; world.landMark.position.set(ev.x, G.course.heightAt(ev.x, ev.z) + 0.08, ev.z); S.landAt = performance.now(); }
      if (!S.replay || true) sfx.land(ev.surf, ev.impact);
      if (ev.impact > 6) burst(p, ev.surf === SURF.SAND ? 'sand' : 'turf');
    } else if (ev.type === 'splash') { sfx.splash(); burst(p, 'splash'); S.landed = true; }
    else if (ev.type === 'leaves') { sfx.leaves(); burst(p, 'leaves'); }
    else if (ev.type === 'trunk') sfx.thunk();
    else if (ev.type === 'holed') sfx.cup();
  }
  world.setBall(S.pos, S.t < res.landT ? 1 : 0);
  if (world.landMark.visible) { const k = ((performance.now() - (S.landAt || 0)) / 1000) % 1.2; world.landMark.scale.setScalar(1 + k * 2.5); world.landMark.material.opacity = 0.9 * (1 - k / 1.2); }
  // live info
  const dist = yd(Math.hypot(S.pos.x - G.ballPos.x, S.pos.z - G.ballPos.z));
  $('fi-main').textContent = `${Math.round(dist)} yd`;
  $('fi-sub').textContent = S.t < res.landT ? `Height ${Math.max(0, Math.round(S.pos.y - G.ballPos.y))} m · ${S.club.name}` : `Carry ${Math.round(yd(res.carry))} yd · rolling`;
  // camera
  if (S.replay) {
    const mid = tmpV.set(res.land.x * 0.5, 0, res.land.z * 0.5), dl = Math.hypot(res.land.x, res.land.z);
    const sideX = -res.land.z / (dl || 1), sideZ = res.land.x / (dl || 1);
    tmpV2.set(mid.x + sideX * dl * 0.62, Math.max(G.course.heightAt(mid.x, mid.z), 0) + dl * 0.12 + 4, mid.z + sideZ * dl * 0.62);
    damp(camPos, tmpV2, 3, dt); damp(camLook, S.pos, 5, dt);
  } else if (S.t < 0.45) {
    damp(camLook, S.pos, 8, dt);
  } else if (S.t < res.landT - 1.5) {
    const hx = S.pos.x - S.prev.x, hz = S.pos.z - S.prev.z, hl = Math.hypot(hx, hz) || 1;
    tmpV2.set(S.pos.x - hx / hl * 15, S.pos.y + 3.5, S.pos.z - hz / hl * 15);
    const gh = G.course.heightAt(tmpV2.x, tmpV2.z) + 1.5; if (tmpV2.y < gh) tmpV2.y = gh;
    damp(camPos, tmpV2, 1.8, dt); damp(camLook, S.pos, 7, dt);
  } else {
    damp(camPos, S.landCam, 1.4, dt); damp(camLook, S.pos, 5, dt);
  }
  if (S.t >= res.endT) onRest();
}

function onRest() {
  const S = G.shot, res = S.res;
  G.restLabel = { key: 'rest', pos: new THREE.Vector3(res.rest.x, res.rest.y + 1.8, res.rest.z), kind: 'rest', text: `${Math.round(yd(res.total))} yd` };
  if (S.replay) { S.replay = false; setState('rest'); $('shot-card').classList.remove('hidden'); return; }
  const j = judge(G.stage, res, G.course, G.ballInStage);
  S.judge = j;
  G.shots.push(j);
  if (j.hit) G.hits++;
  if (G.lv.metric === 'best') G.best = Math.max(G.best, j.value);
  else if (G.stage.mode === 'drive') G.best = Math.max(G.best, j.value);
  G.ballNo++;
  setState('rest');
  if (j.hit) { sfx.cheer(res.holed ? 2 : 1); vibrate([20, 40, 20]); } else sfx.groan();
  if (res.holed) popText('ACE!', '#ffd23a');
  // card
  $('sc-tag').textContent = j.tag; $('sc-tag').className = j.hit ? 'hit' : 'miss';
  $('sc-big').textContent = j.big;
  const off = Math.round(j.offline);
  $('sc-sub').textContent = `Carry ${Math.round(j.carry)} yd · Total ${Math.round(j.total)} yd · ${off === 0 ? 'on line' : Math.abs(off) + ' yd ' + (off < 0 ? 'left' : 'right')} · ${j.surfName}`;
  const tb = totalBalls(G.lv), remaining = tb - G.ballNo;
  const doomed = G.lv.metric === 'hits' && G.hits + remaining < G.lv.stars[0];
  $('btn-next').textContent = remaining <= 0 ? 'Results ▶' : doomed ? 'Finish ▶' : (G.ballInStage + 1 >= G.stage.balls ? 'Next stage ▶' : 'Next ball ▶');
  G.doomed = doomed;
  setTimeout(() => { if (G.state === 'rest') $('shot-card').classList.remove('hidden'); }, 700);
  updateHud();
}

$('btn-next').addEventListener('click', () => {
  sfx.click();
  if (G.state !== 'rest') return;
  $('shot-card').classList.add('hidden');
  const tb = totalBalls(G.lv);
  if (G.ballNo >= tb || G.doomed) return finishLevel();
  G.ballInStage++;
  if (G.ballInStage >= G.stage.balls) return loadStage(G.stageIdx + 1);
  prepareBall();
});
$('btn-replay').addEventListener('click', () => {
  sfx.click(); if (G.state !== 'rest' || !G.shot) return;
  const S = G.shot; S.t = 0; S.ev = 0; S.pts = []; S.ptT = 0; S.landed = false; S.replay = true; world.landMark.visible = false;
  G.restLabel = null; G.speed = 1; setState('replay');
});

// ------------------------------------------------------------ results
function snapshotUnlocks() { const o = {}; for (const t of TRACKS) o[t.id] = trackUnlock(t.id).ok; return o; }
function finishLevel() {
  const lv = G.lv;
  const value = lv.metric === 'best' ? Math.round(G.best) : G.hits;
  const stars = starsFor(lv, value);
  const before = snapshotUnlocks();
  const prevRank = rankFor(Store.totalStars());
  const { isNewBest, newStars } = Store.record(lv.id, stars, value);
  const after = snapshotUnlocks();
  setState('results');
  $('r-title').textContent = stars > 0 ? (stars === 3 ? 'Perfect round!' : 'Level complete!') : 'Not quite…';
  $('r-value').textContent = lv.metric === 'best' ? `Best drive: ${value} yd` : `${value} / ${totalBalls(lv)} hits`;
  $('r-sub').textContent = lv.metric === 'best' ? `★ ${lv.stars[0]} · ★★ ${lv.stars[1]} · ★★★ ${lv.stars[2]} yd` : `★ ${lv.stars[0]} · ★★ ${lv.stars[1]} · ★★★ ${lv.stars[2]} hits` + (isNewBest && Store.rec(lv.id).plays > 1 ? ' · new best!' : '');
  const msgs = [];
  for (const t of TRACKS) if (!before[t.id] && after[t.id]) msgs.push(`🔓 ${t.name} unlocked!`);
  const nx = nextLevel(lv);
  if (stars > 0 && nx && levelUnlock(nx).ok && !Store.passed(nx.id) && Store.rec(nx.id).plays === 0) msgs.push(`Next: ${nx.track === 'tour' ? nx.name : MODE_NAME[nx.stages[0].mode] + ' ' + (nx.idx + 1)} unlocked`);
  const newRank = rankFor(Store.totalStars()); if (newRank !== prevRank) msgs.push(`🏅 New rank: ${newRank}`);
  if (newStars && stars === 3) msgs.push('All 3 stars!');
  $('r-unlock').innerHTML = msgs.join('<br>');
  $('r-next').disabled = !(nx && levelUnlock(nx).ok);
  $('r-next').textContent = nx ? 'Next ▶' : 'Done';
  const els = [...$('r-stars').children]; els.forEach(e => e.classList.remove('on'));
  show('results', true);
  els.forEach((e, i) => setTimeout(() => { if (i < stars) { e.classList.add('on'); sfx.star(i); vibrate(15); } }, 450 + i * 380));
  if (stars === 0) sfx.groan(); else setTimeout(() => sfx.cheer(stars / 2 + 0.5), 400);
}
$('r-retry').addEventListener('click', () => { sfx.click(); show('results', false); startLevel(G.lv); });
$('r-next').addEventListener('click', () => { sfx.click(); show('results', false); const nx = nextLevel(G.lv); if (nx && levelUnlock(nx).ok) openIntro(nx); else openCareer(); });
$('r-map').addEventListener('click', () => { sfx.click(); show('results', false); openCareer(); });

// ------------------------------------------------------------ level start / intro
function openIntro(lv) {
  G.introLv = lv;
  const tr = TRACKS.find(t => t.id === lv.track);
  $('i-track').textContent = `${tr.icon} ${tr.name}${lv.track === 'tour' ? '' : ' · Level ' + (lv.idx + 1)}`;
  $('i-track').style.setProperty('--tc', tr.color);
  $('i-name').textContent = lv.name;
  const goals = $('i-goals'); goals.innerHTML = '';
  lv.stages.forEach((st, i) => {
    const li = document.createElement('li');
    li.innerHTML = (lv.stages.length > 1 ? `<b>Stage ${i + 1} · ${MODE_NAME[st.mode]}</b><br>` : '') + `${goalText(st)} <b>(${st.balls} balls)</b>`;
    goals.appendChild(li);
  });
  const s = lv.stars, tb = totalBalls(lv);
  $('i-stars').innerHTML = lv.metric === 'best' ? `<span>★ ${s[0]} yd</span><span>★★ ${s[1]} yd</span><span>★★★ ${s[2]} yd</span>` : `<span>★ ${s[0]}/${tb}</span><span>★★ ${s[1]}/${tb}</span><span>★★★ ${s[2]}/${tb}</span>`;
  const w = lv.stages[0].wind;
  const windTxt = !w || !w.s ? 'Calm' : w.vary ? `${w.s} mph crosswind, shifts every ball${w.gust ? ', gusting' : ''}` : `${w.s} mph wind${w.gust ? ' (gusting)' : ''}`;
  const sz = lv.sd < 0.15 ? 'wide' : lv.sd < 0.35 ? 'normal' : lv.sd < 0.5 ? 'tight' : 'very tight';
  $('i-meta').textContent = `Wind: ${windTxt} · Sweet spot: ${sz}`;
  const rec = Store.rec(lv.id);
  $('i-best').textContent = rec.plays ? `Your best: ${lv.metric === 'best' ? rec.best + ' yd' : rec.best + ' hits'} · ${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}` : '';
  show('intro', true);
}
$('i-back').addEventListener('click', () => { sfx.click(); show('intro', false); });
$('i-go').addEventListener('click', () => { sfx.click(); show('intro', false); startLevel(G.introLv); });

async function startLevel(lv) {
  if (!lv) return;
  G.lv = lv; G.hits = 0; G.best = 0; G.ballNo = 0; G.shots = [];
  screen('game');
  for (const m of ['results', 'pause', 'intro', 'settings']) show(m, false);
  await loadStage(0);
  addressCam(camPos, camLook);
  if (!Store.data.tutorialDone) openTutorial();
}

// ------------------------------------------------------------ tutorial
const TUT = [
  ['Press & hold', 'Press and hold anywhere on the screen to start your swing. The power meter on the right rises and falls while you hold.', ''],
  ['Slide to aim', 'While holding, slide your thumb left or right to aim. The dotted line and ring on the ground show where the ball will land (wind not included!).', 'slide'],
  ['Release in the green', 'Let go while the meter is in the GREEN sweet spot for a perfect strike. Too early = weak shot that slices right. Too late = overswing that hooks left.', ''],
  ['Clubs & wind', 'Pick a club below — the number is its full carry in yards. Watch the wind arrow at the top and aim into it. Tap during flight to fast-forward.', ''],
];
let tutI = 0;
function openTutorial() { tutI = 0; renderTut(); show('tutorial', true); }
function renderTut() {
  const [t, x, art] = TUT[tutI];
  $('tut-title').textContent = t; $('tut-text').textContent = x;
  $('tut-art').className = 'tut-art ' + art;
  $('tut-art').innerHTML = `<div class="finger">👆</div><div class="mini"><b></b><i></i></div>`;
  $('tut-dots').innerHTML = TUT.map((_, i) => `<i class="${i === tutI ? 'on' : ''}"></i>`).join('');
  $('tut-next').textContent = tutI === TUT.length - 1 ? "Let's play" : 'Next';
}
function closeTut() { show('tutorial', false); Store.data.tutorialDone = true; Store.save(); }
$('tut-next').addEventListener('click', () => { sfx.unlock(); sfx.click(); if (tutI < TUT.length - 1) { tutI++; renderTut(); } else closeTut(); });
$('tut-skip').addEventListener('click', () => { sfx.click(); closeTut(); });

// ------------------------------------------------------------ career map
function openCareer() {
  screen('career'); G.state = 'career'; renderCareer();
  if (!G.titleCourse || G.course !== G.titleCourse) setupTitleScene();
}
function renderCareer() {
  const total = Store.totalStars();
  $('c-stars').textContent = total; $('c-max').textContent = MAX_STARS;
  $('c-rank').textContent = rankFor(total);
  const nxt = RANKS.find(([n]) => n > total);
  $('c-next').textContent = nxt ? `${nxt[0] - total} ★ to ${nxt[1]}` : 'Top rank reached!';
  $('c-prog').style.width = (total / MAX_STARS * 100) + '%';
  const box = $('tracks'); box.innerHTML = '';
  for (const tr of TRACKS) {
    const lvls = trackLevels(tr.id), un = trackUnlock(tr.id);
    const got = lvls.reduce((a, l) => a + Store.rec(l.id).stars, 0);
    const el = document.createElement('div'); el.className = 'track' + (un.ok ? '' : ' locked'); el.style.setProperty('--tc', tr.color);
    el.innerHTML = `<header><span class="ticon">${tr.icon}</span><h3>${tr.name}</h3><span class="tstars">${got}/${lvls.length * 3} ★</span></header><p>${tr.blurb}</p>`;
    if (!un.ok) { const m = document.createElement('div'); m.className = 'lockmsg'; m.textContent = `🔒 ${un.req}`; el.appendChild(m); }
    let currentMarked = false;
    if (tr.id === 'tour') {
      const list = document.createElement('div'); list.className = 'events';
      for (const lv of lvls) {
        const u = levelUnlock(lv), r = Store.rec(lv.id);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'event' + (u.ok ? '' : ' lock');
        if (u.ok && !r.stars && !currentMarked) { b.classList.add('current'); currentMarked = true; }
        b.innerHTML = `<span>${u.ok ? '🏆' : '🔒'}</span><b>${lv.name}<br><small style="opacity:.7;color:#fff;font-weight:600">${lv.stages.length} stages · ${u.ok ? totalBalls(lv) + ' balls' : u.req}</small></b><small>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</small>`;
        b.addEventListener('click', () => { sfx.unlock(); sfx.click(); if (u.ok) openIntro(lv); else toast(u.req); });
        list.appendChild(b);
      }
      el.appendChild(list);
    } else {
      const grid = document.createElement('div'); grid.className = 'levels';
      for (const lv of lvls) {
        const u = levelUnlock(lv), r = Store.rec(lv.id);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'lvl' + (u.ok ? '' : ' lock') + (r.stars ? ' done' : '');
        if (u.ok && !r.stars && !currentMarked) { b.classList.add('current'); currentMarked = true; }
        b.innerHTML = u.ok ? `${lv.idx + 1}<small>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</small>` : '🔒';
        b.setAttribute('aria-label', `${tr.name} level ${lv.idx + 1}`);
        b.dataset.id = lv.id;
        b.addEventListener('click', () => { sfx.unlock(); sfx.click(); if (u.ok) openIntro(lv); else toast(u.req); });
        grid.appendChild(b);
      }
      el.appendChild(grid);
    }
    box.appendChild(el);
  }
}
$('career-back').addEventListener('click', () => { sfx.click(); openTitle(); });
$('career-settings').addEventListener('click', () => { sfx.click(); openSettings(); });

// ------------------------------------------------------------ title
function setupTitleScene() {
  const stage = { mode: 'target', flags: [{ d: 135, x: -8 }, { d: 190, x: 9 }], R: 10 };
  G.titleCourse = buildStage(stage, 3);
  world.buildCourse(G.titleCourse, G.q);
  world.setTargets([], 0, -1);
  G.course = G.titleCourse; G.stage = stage;
  G.ballPos = new THREE.Vector3(0, G.titleCourse.heightAt(0, 0) + BALL_R + 0.035, 0);
  world.tee.visible = true; world.tee.position.set(0, G.titleCourse.heightAt(0, 0) + 0.039, 0); world.setBall(G.ballPos, 0);
  world.setAimPreview(G.ballPos, 0, 100, 0, false);
  world.setTracer([]); world.landMark.visible = false;
  world.windYaw = 0.6;
}
function openTitle() {
  screen('title'); G.state = 'title';
  if (G.course !== G.titleCourse || !G.titleCourse) setupTitleScene();
  const s = Store.totalStars(); $('t-stars').textContent = s; $('t-rank').textContent = rankFor(s);
}
$('btn-play').addEventListener('click', () => { sfx.unlock(); sfx.click(); openCareer(); });
$('btn-settings').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSettings(); });

// ------------------------------------------------------------ pause / settings
$('btn-pause').addEventListener('click', () => { sfx.click(); if (G.state === 'charge') return; show('pause', true); });
$('p-resume').addEventListener('click', () => { sfx.click(); show('pause', false); });
$('p-restart').addEventListener('click', () => { sfx.click(); show('pause', false); startLevel(G.lv); });
$('p-map').addEventListener('click', () => { sfx.click(); show('pause', false); setState('career'); openCareer(); });
$('p-settings').addEventListener('click', () => { sfx.click(); openSettings(); });
function syncMute() { $('btn-mute').textContent = settings.sound ? '🔊' : '🔇'; $('s-sound').checked = settings.sound; }
$('btn-mute').addEventListener('click', () => { sfx.unlock(); settings.sound = !settings.sound; sfx.setMuted(!settings.sound); Store.save(); syncMute(); sfx.click(); });
function updateQInfo() {
  document.querySelectorAll('#s-quality button').forEach(b => b.classList.toggle('on', b.dataset.q === String(settings.quality)));
  $('s-qinfo').textContent = `Rendering at ${QUALITY[G.q].name}${settings.quality === 'auto' ? ' (auto-adjusts to keep it smooth)' : ''}`;
}
function openSettings() { $('s-sound').checked = settings.sound; $('s-haptics').checked = settings.haptics; updateQInfo(); show('settings', true); }
$('s-sound').addEventListener('change', e => { sfx.unlock(); settings.sound = e.target.checked; sfx.setMuted(!settings.sound); Store.save(); syncMute(); });
$('s-haptics').addEventListener('change', e => { settings.haptics = e.target.checked; Store.save(); if (settings.haptics) vibrate(30); });
document.querySelectorAll('#s-quality button').forEach(b => b.addEventListener('click', () => {
  sfx.click(); settings.quality = b.dataset.q; Store.save();
  if (settings.quality !== 'auto') { G.q = +settings.quality; world.setQuality(G.q); } else { perf.cool = 2; }
  updateQInfo();
}));
$('s-tutorial').addEventListener('click', () => { sfx.click(); show('settings', false); openTutorial(); });
$('s-reset').addEventListener('click', () => { sfx.click(); show('confirm', true); });
$('cf-no').addEventListener('click', () => { sfx.click(); show('confirm', false); });
$('cf-yes').addEventListener('click', () => {
  sfx.click(); Store.reset(); show('confirm', false); show('settings', false); toast('Progress reset');
  if (G.state === 'career') renderCareer(); else if (G.state === 'title') openTitle();
});
$('s-close').addEventListener('click', () => { sfx.click(); show('settings', false); if (G.state === 'career') renderCareer(); });
syncMute();

// ------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const st = G.state;
  if (st === 'title' || st === 'career' || st === 'boot') {
    const t = now / 1000;
    tmpV2.set(4 + Math.sin(t * 0.06) * 9, 4.2 + Math.sin(t * 0.09) * 1.2, 9 + Math.cos(t * 0.06) * 3);
    damp(camPos, tmpV2, 1.5, dt); damp(camLook, tmpV.set(-8 + Math.sin(t * 0.045) * 14, 3, -190), 1.5, dt);
  } else if (st === 'aim' || st === 'charge') {
    if (st === 'charge') {
      G.m = meterAt(now);
      const inZ = G.m >= G.zone.lo && G.m <= G.zone.hi;
      if (inZ && !G.inZone) vibrate(8);
      G.inZone = inZ; sfx.chargeSet(G.m, inZ); updateMeter();
    }
    const prevAim = G.aim;
    G.aim += (G.aimGoal - G.aim) * (1 - Math.exp(-dt * 16));
    if (Math.abs(G.aim - prevAim) > 1e-5 || !G._hudTick || now - G._hudTick > 250) { updateHud(); G._hudTick = now; }
    addressCam(tmpV2, tmpV); damp(camPos, tmpV2, 6, dt); damp(camLook, tmpV, 6, dt);
    const power = st === 'charge' ? strikeFromMeter(G.m, G.zone, CLUBS[G.clubIdx], () => 0.5).power : 1;
    G.zoneCarry = carryFor(G.clubIdx, power);
    world.setAimPreview(G.ballPos, G.aim, G.zoneCarry, st === 'charge' ? 1 : 0, true);
    world.setBall(G.ballPos, 0);
  } else if (st === 'flight' || st === 'replay') {
    world.setAimPreview(G.ballPos, G.aim, 10, 0, false);
    updateFlight(dt);
  } else {
    world.setAimPreview(G.ballPos, G.aim, 10, 0, false);
    if (G.shot) { world.setBall(G.shot.pos, 0); damp(camLook, G.shot.pos, 3, dt); }
  }
  if (world.landMark.visible && G.shot && st === 'rest') { const k = ((now - (G.shot.landAt || 0)) / 1000) % 1.2; world.landMark.scale.setScalar(1 + k * 2.5); world.landMark.material.opacity = 0.9 * (1 - k / 1.2); }
  const ov = window.__golf.camOverride;
  if (ov) { cam.position.set(...ov.pos); cam.lookAt(...ov.look); } else { cam.position.copy(camPos); cam.lookAt(camLook); }
  world.setShadowFocus(st === 'flight' || st === 'replay' || st === 'rest' ? (G.shot ? tmpV.copy(G.shot.pos).lerp(cam.position, 0.3) : G.ballPos) : tmpV.set(cam.position.x, 0, cam.position.z - 40));
  world.update(dt);
  updateParts(dt);
  world.render();
  const extraL = [];
  if (G.restLabel && (st === 'rest' || st === 'results')) extraL.push(G.restLabel);
  if ((st === 'aim' || st === 'charge') && world.zoneCenter) {
    const a = Math.round(deg(G.aim));
    zoneLabel.pos.set(world.zoneCenter.x, world.zoneCenter.y, world.zoneCenter.z);
    zoneLabel.text = `${Math.round(yd(G.zoneCarry))} yd` + (st === 'charge' ? ` · ${a === 0 ? 'straight' : Math.abs(a) + '°' + (a < 0 ? 'L' : 'R')}` : '');
    zoneLabel.kind = st === 'charge' ? 'zone on' : 'zone'; extraL.push(zoneLabel);
  }
  syncLabels(extraL, st === 'rest' || st === 'results');
  adaptQuality(dt);
}

addEventListener('resize', () => world.resize());
window.visualViewport?.addEventListener('resize', () => world.resize());
addEventListener('orientationchange', () => setTimeout(() => world.resize(), 200));
document.addEventListener('visibilitychange', () => { if (document.hidden && sfx.ctx) sfx.ctx.suspend(); else if (sfx.ctx && settings.sound) sfx.ctx.resume(); });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

// boot
setupTitleScene();
requestAnimationFrame(frame);
setTimeout(() => { $('loading').classList.add('fade'); setTimeout(() => show('loading', false), 500); openTitle(); window.__golfReady = true; }, 60);
