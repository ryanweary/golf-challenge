// Golf ball flight + bounce/roll simulation. Pure JS (Node-testable).
import { SURF, WATER_Y, treeHit } from './terrain.js';
import { mulberry32, clamp } from './noise.js';

export const BALL_R = 0.02135;
const MASS = 0.04593, AREA = Math.PI * BALL_R * BALL_R, RHO = 1.225;
const K = 0.5 * RHO * AREA / MASS;
const G = 9.81;
export const MPH = 0.44704;

// clubs: full-swing ball speed (m/s), launch (deg), backspin (rpm), sidespin sensitivity, tee height
export const CLUBS = [
  { id: 'DR', sc: 0.35, name: 'Driver', speed: 73, launch: 11.5, spin: 2650, curve: 1.3, tee: 0.035 },
  { id: '3W', sc: 0.42, name: '3 Wood', speed: 64.5, launch: 12.5, spin: 3400, curve: 1.15, tee: 0.018 },
  { id: '5I', sc: 0.6, name: '5 Iron', speed: 57, launch: 14, spin: 5200, curve: 1.0, tee: 0.006 },
  { id: '7I', sc: 0.75, name: '7 Iron', speed: 51.5, launch: 17.5, spin: 6800, curve: 0.9, tee: 0.004 },
  { id: '9I', sc: 0.88, name: '9 Iron', speed: 46, launch: 22, spin: 8200, curve: 0.8, tee: 0.003 },
  { id: 'PW', sc: 1.0, name: 'P Wedge', speed: 42, launch: 26, spin: 9000, curve: 0.72, tee: 0.003 },
  { id: 'SW', sc: 1.0, name: 'Lob Wedge', speed: 34, launch: 34, spin: 9600, curve: 0.65, tee: 0.003 },
];

// bounce / roll parameters per surface
const SP = [];
SP[SURF.TEE] = { e: 0.34, keep: 0.72, roll: 0.30, bite: 0.3 };
SP[SURF.FAIRWAY] = { e: 0.34, keep: 0.72, roll: 0.30, bite: 0.3 };
SP[SURF.FRINGE] = { e: 0.3, keep: 0.66, roll: 0.34, bite: 0.35 };
SP[SURF.GREEN] = { e: 0.27, keep: 0.66, roll: 0.12, bite: 0.75 };
SP[SURF.ROUGH] = { e: 0.2, keep: 0.45, roll: 0.75, bite: 0.1 };
SP[SURF.DEEP] = { e: 0.14, keep: 0.3, roll: 1.2, bite: 0.05 };
SP[SURF.SAND] = { e: 0.05, keep: 0.12, roll: 1.8, bite: 0 };
// how much the ball's player-applied spin grips each surface (backspin check / spin-back)
const GRIP = [];
GRIP[SURF.TEE] = 0.8; GRIP[SURF.FAIRWAY] = 0.8; GRIP[SURF.FRINGE] = 0.65; GRIP[SURF.GREEN] = 1;
GRIP[SURF.ROUGH] = 0.25; GRIP[SURF.DEEP] = 0.08; GRIP[SURF.SAND] = 0; GRIP[SURF.WATER] = 0;
const RETRO_A = 5.5; // m/s^2 of spin-back pull at full backspin on a green

/** wind(t, y) -> {x, z} m/s. Makes a wind function from a level wind spec (speed mph, dir deg where 0 = blowing downrange / helping, 90 = left->right). */
export function makeWind(speedMph, dirDeg, gustMph = 0, seed = 1) {
  const r = mulberry32(seed), ph1 = r() * 6.28, ph2 = r() * 6.28;
  const base = speedMph * MPH, gust = gustMph * MPH;
  return (t, y) => {
    const hf = clamp(Math.pow(Math.max(y, 0.5) / 10, 0.18), 0.55, 1.25);
    const s = (base + gust * (0.6 * Math.sin(t * 1.7 + ph1) + 0.4 * Math.sin(t * 3.1 + ph2))) * hf;
    const a = (dirDeg + (gust > 0 ? 8 * Math.sin(t * 0.9 + ph2) : 0)) * Math.PI / 180;
    return { x: Math.sin(a) * s, z: -Math.cos(a) * s };
  };
}
const NOWIND = () => ({ x: 0, z: 0 });

/**
 * Simulate a full shot.
 * opts: { x,y,z start, speed m/s, launch deg, aim rad (0 = downrange -z, + = right), face rad offset,
 *         spin rpm, tilt deg (+ hook/left, - slice/right), wind fn, seed }
 * returns { samples: Float32Array [t,x,y,z]*, n, events[], carry, total, rest{}, apex, landT, endT, holed }
 */
export function simulateShot(course, o) {
  const rnd = mulberry32(o.seed || 1);
  const wind = o.wind || NOWIND;
  const dir = o.aim + (o.face || 0);
  const L = o.launch * Math.PI / 180;
  const fx = Math.sin(dir), fz = -Math.cos(dir), rx = Math.cos(dir), rz = Math.sin(dir);
  let px = o.x, py = o.y, pz = o.z;
  let vx = o.speed * Math.cos(L) * fx, vy = o.speed * Math.sin(L), vz = o.speed * Math.cos(L) * fz;
  const tilt = (o.tilt || 0) * Math.PI / 180;
  // spin axis (unit): backspin axis = right vector, tilted toward up for hook
  let ax = rx * Math.cos(tilt), ay = Math.sin(tilt), az = rz * Math.cos(tilt);
  let omega = o.spin * 2 * Math.PI / 60;
  const dt = 1 / 240;
  const samples = []; const events = [];
  let t = 0, mode = 0; // 0 flying, 1 rolling, 2 done
  let apex = py, landT = -1, carryX = 0, carryZ = 0, holed = false, water = false, hitTree = false;
  const nrm = { x: 0, y: 1, z: 0 }, near = [];
  const hitCooldown = new Map();
  let bounces = 0, lastSurf = SURF.TEE, step = 0;
  const sc = o.spinCtl || 0, top = Math.max(0, -sc); let retro = 0; // player spin: + backspin, - topspin
  const push = () => { samples.push(t, px, py, pz); };
  push();
  while (mode < 2 && t < 40) {
    if (mode === 0) {
      const w = wind(t, py);
      const ux = vx - w.x, uy = vy, uz = vz - w.z;
      const u = Math.sqrt(ux * ux + uy * uy + uz * uz) + 1e-6;
      const S = BALL_R * omega / u;
      const Cd = 0.22 + 0.16 * S;
      const Cl = 0.3 * (1 - Math.exp(-S * 5.5));
      // magnus direction = axis x u
      let mx = ay * uz - az * uy, my = az * ux - ax * uz, mz = ax * uy - ay * ux;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz) + 1e-9;
      mx /= ml; my /= ml; mz /= ml;
      const kd = K * Cd * u, kl = K * Cl * u * u;
      const axx = -kd * ux + kl * mx, ayy = -G - kd * uy + kl * my, azz = -kd * uz + kl * mz;
      vx += axx * dt; vy += ayy * dt; vz += azz * dt;
      px += vx * dt; py += vy * dt; pz += vz * dt;
      omega *= Math.exp(-dt / 22);
      if (py > apex) apex = py;
      // trees
      if (py < 45 && !o.noTrees) {
        course.treesNear(px, pz, near);
        for (const tr of near) {
          const hit = treeHit(tr, px, py, pz);
          if (!hit) continue;
          const last = hitCooldown.get(tr) || -9;
          if (t - last < 0.5) continue;
          hitCooldown.set(tr, t); hitTree = true;
          if (hit === 1) {
            const k = 0.18 + rnd() * 0.22;
            const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) * k;
            const ddx = vx * k + (rnd() - 0.5) * sp * 1.4, ddz = vz * k + (rnd() - 0.5) * sp * 1.4;
            vx = ddx; vz = ddz; vy = vy * k * 0.5 - rnd() * 2;
            omega *= 0.2;
            events.push({ t, type: 'leaves', x: px, y: py, z: pz });
          } else {
            const dx = px - tr.x, dz = pz - tr.z, d = Math.hypot(dx, dz) + 1e-6;
            const nx = dx / d, nz = dz / d, vn = vx * nx + vz * nz;
            if (vn < 0) { vx -= 1.5 * vn * nx; vz -= 1.5 * vn * nz; vx *= 0.6; vz *= 0.6; }
            omega *= 0.3;
            events.push({ t, type: 'trunk', x: px, y: py, z: pz });
          }
        }
      }
      // ground / water
      const h = course.heightAt(px, pz);
      if (py - BALL_R <= Math.max(h, WATER_Y)) {
        const surf = course.surfaceAt(px, pz, h);
        if (surf === SURF.WATER && py <= WATER_Y + BALL_R) {
          py = WATER_Y;
          if (landT < 0) { landT = t; carryX = px; carryZ = pz; }
          events.push({ t, type: 'splash', x: px, y: py, z: pz, surf });
          water = true; lastSurf = surf; mode = 2; push(); break;
        }
        if (py - BALL_R <= h) {
          py = h + BALL_R;
          course.normalAt(px, pz, nrm);
          const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
          if (vn < 0) {
            const sp = SP[surf] || SP[SURF.ROUGH];
            const tx = vx - vn * nrm.x, ty = vy - vn * nrm.y, tz = vz - vn * nrm.z;
            const impact = -vn;
            let e = sp.e * clamp(1.15 - impact / 60, 0.55, 1.1);
            const rpm = omega * 60 / (2 * Math.PI);
            let keep = sp.keep - sp.bite * clamp((rpm - 2000) / 6000, 0, 1) * clamp(impact / 18, 0.2, 1.2);
            if (bounces === 0 && sc !== 0) {
              const gr = GRIP[surf] ?? 0.25;
              if (sc > 0) { keep -= 0.42 * sc * gr; retro = sc * gr * clamp(rpm / 6500, 0.35, 1.4); }
              else { keep += 0.2 * top * (0.4 + 0.6 * gr); e *= 1 + 0.22 * top; }
            }
            keep = clamp(keep, bounces === 0 ? (sc > 0 ? -0.35 : -0.12) : 0.05, 0.97);
            vx = tx * keep - e * vn * nrm.x; vy = ty * keep - e * vn * nrm.y; vz = tz * keep - e * vn * nrm.z;
            omega *= 0.45;
            if (landT < 0) { landT = t; carryX = px; carryZ = pz; if (o.carryOnly) { mode = 2; break; } }
            events.push({ t, type: 'bounce', x: px, y: py, z: pz, surf, impact });
            bounces++; lastSurf = surf;
            if (impact * e < 1.1 || surf === SURF.SAND) { mode = 1; }
          }
        }
      }
    } else {
      // rolling on the surface
      course.normalAt(px, pz, nrm);
      const h = course.heightAt(px, pz);
      const surf = course.surfaceAt(px, pz, h);
      lastSurf = surf;
      if (surf === SURF.WATER) {
        events.push({ t, type: 'splash', x: px, y: WATER_Y, z: pz, surf }); water = true; py = WATER_Y; mode = 2; push(); break;
      }
      const sp = SP[surf] || SP[SURF.ROUGH];
      // project velocity on tangent plane
      const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
      vx -= vn * nrm.x; vy -= vn * nrm.y; vz -= vn * nrm.z;
      // gravity along slope
      const gx = -G * (0 - nrm.y * nrm.x), gy = -G * (1 - nrm.y * nrm.y), gz = -G * (0 - nrm.y * nrm.z);
      vx += gx * dt * 0.71; vy += gy * dt * 0.71; vz += gz * dt * 0.71; // 5/7 rolling-sphere factor
      // backspin pulls the ball back toward the tee (check up / spin back), decaying fast
      const gr = GRIP[surf] ?? 0.25;
      if (retro > 0.02) { const a = retro * gr * RETRO_A * dt; vx -= fx * a; vz -= fz * a; retro *= Math.exp(-dt / 0.45); } else retro = 0;
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dec = sp.roll * (1 - 0.32 * top) * G * nrm.y * dt;
      const slopeAcc = Math.sqrt(gx * gx + gy * gy + gz * gz) * 0.71;
      if (v <= dec && slopeAcc < sp.roll * G * 1.2 && retro * gr < 0.08) { vx = vy = vz = 0; mode = 2; }
      else if (v > 0) { const f = Math.max(0, v - dec) / v; vx *= f; vy *= f; vz *= f; }
      px += vx * dt; pz += vz * dt; py = course.heightAt(px, pz) + BALL_R;
      // cup capture
      if (course.holes) for (const hole of course.holes) {
        const d = Math.hypot(px - hole.x, pz - hole.z);
        if (d < 0.07 && v < 1.6) { holed = true; px = hole.x; pz = hole.z; py -= 0.06; mode = 2; events.push({ t, type: 'holed', x: px, y: py, z: pz }); }
      }
      // trees trunks while rolling
      if ((step & 7) === 0) {
        course.treesNear(px, pz, near);
        for (const tr of near) if (treeHit(tr, px, py + 0.1, pz) === 2) { vx *= -0.3; vz *= -0.3; }
      }
      if (Math.abs(px) > 235 || pz < -655 || pz > 58) mode = 2;
    }
    t += dt; step++;
    if ((step & 1) === 0 || mode === 2) push();
  }
  if (landT < 0) { landT = t; carryX = px; carryZ = pz; }
  const endT = t;
  events.push({ t: endT, type: 'rest', x: px, y: py, z: pz, surf: lastSurf });
  const sx = o.x, sz = o.z;
  return {
    samples: Float32Array.from(samples), events, apex: apex - o.y, landT, endT, holed, water, hitTree,
    carry: Math.hypot(carryX - sx, carryZ - sz), land: { x: carryX, z: carryZ },
    total: Math.hypot(px - sx, pz - sz), rest: { x: px, y: py, z: pz, surf: water ? SURF.WATER : lastSurf },
  };
}

// sample interpolated position at time t into out
export function sampleAt(res, t, out) {
  const s = res.samples, n = s.length / 4;
  if (t <= 0) { out.x = s[1]; out.y = s[2]; out.z = s[3]; return 0; }
  let lo = 0, hi = n - 1;
  if (t >= s[hi * 4]) { out.x = s[hi * 4 + 1]; out.y = s[hi * 4 + 2]; out.z = s[hi * 4 + 3]; return hi; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m * 4] <= t) lo = m; else hi = m; }
  const a = lo * 4, b = hi * 4, f = (t - s[a]) / (s[b] - s[a] || 1);
  out.x = s[a + 1] + (s[b + 1] - s[a + 1]) * f;
  out.y = s[a + 2] + (s[b + 2] - s[a + 2]) * f;
  out.z = s[a + 3] + (s[b + 3] - s[a + 3]) * f;
  return lo;
}

/**
 * Map a swing (meter value at release, sweet zone) to strike parameters.
 * Returns { power, tilt, face, quality, label }
 */
export function strikeFromMeter(m, zone, club, rnd = Math.random) {
  const { lo, hi } = zone, c = (lo + hi) / 2, half = (hi - lo) / 2;
  let power, tilt, face, quality, label;
  if (m >= lo && m <= hi) {
    const e = (m - c) / half; // -1..1
    power = 1; tilt = e * 2.5 + (rnd() - 0.5) * 1.2; face = (e * 0.4 + (rnd() - 0.5) * 0.5) * Math.PI / 180;
    quality = Math.abs(e) < 0.4 ? 3 : 2; label = quality === 3 ? 'PERFECT!' : 'GREAT';
  } else if (m < lo) {
    const d = lo - m;
    power = Math.max(0.12, 0.97 * m / lo);
    tilt = -(d * 34 + (rnd() - 0.3) * 2); face = (d * 3 + rnd() * 0.5) * Math.PI / 180;
    quality = d < 0.08 ? 1 : 0; label = d < 0.08 ? 'EARLY · FADE' : 'WEAK · SLICE';
  } else {
    const d = m - hi;
    power = Math.max(0.6, 1 - d * 1.6);
    tilt = d * 120 + rnd() * 2; face = -(d * 10 + rnd() * 0.5) * Math.PI / 180;
    quality = d < 0.05 ? 1 : 0; label = d < 0.05 ? 'LATE · DRAW' : 'OVERSWING · HOOK';
  }
  tilt *= club.curve;
  return { power, tilt, face, quality, label };
}

/** Player spin control: v = vertical (-1 topspin .. +1 backspin), h = horizontal (-1 draw .. +1 fade). */
export function spinEffect(club, ctl) {
  const v = clamp(ctl?.v || 0, -1, 1), h = clamp(ctl?.h || 0, -1, 1);
  const cap = club.sc ?? 0.6;
  return { e: v * cap, tilt: -h * 7 * (0.6 + 0.4 * club.curve), cap };
}
export function launchFor(club, strike, ctl) {
  const p = strike.power, se = spinEffect(club, ctl), e = se.e;
  const spinMul = e >= 0 ? 1 + 0.55 * e : 1 + 0.6 * e;
  return {
    speed: club.speed * (0.25 + 0.75 * p) * (1 + (e < 0 ? -e * 0.015 : -e * 0.01)),
    launch: club.launch * (1 + (1 - p) * 0.12) + e * 1.8,
    spin: club.spin * (0.55 + 0.45 * p) * (strike.quality === 0 ? 0.85 : 1) * spinMul,
    spinCtl: e, tiltAdd: se.tilt,
  };
}
