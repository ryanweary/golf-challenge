// Per-mode rules: wind per ball, current target, shot judging.
import { SURF, SURF_NAME, YD } from './terrain.js';

export function windFor(stage, ballIdx, rnd = Math.random) {
  const w = stage.wind || { s: 0, dir: 0, gust: 0 };
  if (w.vary) {
    const side = rnd() < 0.5 ? 90 : 270;
    return { s: Math.max(0, Math.round(w.s + (rnd() - 0.5) * 4)), dir: side + (rnd() - 0.5) * 50, gust: w.gust };
  }
  return { s: w.s, dir: w.dir, gust: w.gust || 0 };
}

export function targetFor(stage, course, ballIdx) {
  const greens = course.L.greens.filter(g => g.target);
  if (!greens.length) return null;
  const g = greens[ballIdx % greens.length];
  return { x: g.pinX, z: g.pinZ, g };
}

const FW = new Set([SURF.FAIRWAY, SURF.GREEN, SURF.FRINGE, SURF.TEE]);

export function goalText(stage) {
  switch (stage.mode) {
    case 'drive': return `Hit it ${stage.goal}+ yd${stage.reqFW ? ' and finish in the fairway' : ' and stay in play'}`;
    case 'target': return `Stop the ball within ${stage.R} yd of the pin`;
    case 'wind': return `Finish in the fairway, past the ${stage.D} yd line`;
    case 'island': return 'Land and stay on the island green';
    case 'obstacle': return `Get past the trees and within ${stage.R} yd of the pin`;
  }
  return '';
}

export function judge(stage, res, course, ballIdx) {
  const r = res.rest, surf = r.surf, total = res.total / YD, carry = res.carry / YD;
  const offline = r.x / YD;
  const out = { carry, total, surf, surfName: SURF_NAME[surf], offline, hit: false, value: 0, big: '', tag: '' };
  if (res.water) out.surfName = 'Water';
  switch (stage.mode) {
    case 'drive': {
      const inPlay = !res.water && surf !== SURF.DEEP && (!stage.reqFW || FW.has(surf));
      out.value = inPlay ? total : 0;
      out.hit = inPlay && total >= stage.goal;
      out.big = `${Math.round(total)} yd`;
      out.tag = !inPlay ? (res.water ? 'IN THE WATER' : stage.reqFW ? 'MISSED FAIRWAY' : 'OUT OF PLAY') : out.hit ? 'GOAL!' : `${Math.round(stage.goal - total)} yd short`;
      break;
    }
    case 'wind': {
      const fwd = -r.z / YD;
      const ok = !res.water && FW.has(surf);
      out.value = ok ? fwd : 0;
      out.hit = ok && fwd >= stage.D;
      out.big = `${Math.round(fwd)} yd`;
      out.tag = out.hit ? 'IN THE FAIRWAY!' : !ok ? (res.water ? 'IN THE WATER' : 'MISSED FAIRWAY') : `SHORT OF ${stage.D}`;
      break;
    }
    case 'target': case 'obstacle': {
      const t = targetFor(stage, course, ballIdx);
      const d = res.holed ? 0 : Math.hypot(r.x - t.x, r.z - t.z) / YD;
      out.dist = d;
      out.hit = !res.water && d <= stage.R;
      out.value = out.hit ? 1 : 0;
      out.big = res.holed ? 'IN THE HOLE!' : res.water ? 'SPLASH' : `${d < 10 ? d.toFixed(1) : Math.round(d)} yd`;
      out.tag = res.holed ? 'ACE!!' : out.hit ? (d < stage.R / 3 ? 'STIFFED IT!' : 'ON TARGET!') : res.hitTree && stage.mode === 'obstacle' ? 'CLIPPED THE TREES' : 'MISSED';
      break;
    }
    case 'island': {
      const t = targetFor(stage, course, ballIdx);
      const on = !res.water && (surf === SURF.GREEN || surf === SURF.FRINGE);
      const d = Math.hypot(r.x - t.x, r.z - t.z) / YD;
      out.dist = d;
      out.hit = on || res.holed; out.value = out.hit ? 1 : 0;
      out.big = res.holed ? 'IN THE HOLE!' : res.water ? 'SPLASH' : on ? `${d.toFixed(1)} yd` : 'MISSED';
      out.tag = res.holed ? 'ACE!!' : on ? 'SAFE ON THE ISLAND!' : res.water ? 'IN THE WATER' : 'MISSED THE GREEN';
      break;
    }
  }
  return out;
}
