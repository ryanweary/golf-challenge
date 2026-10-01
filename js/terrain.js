// Course layout, terrain height field, surface classification, trees & colliders.
// Pure JS (no three.js) so it can be unit-tested in Node.
import { makeNoise2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';

export const YD = 0.9144;
export const SURF = { TEE: 0, FAIRWAY: 1, ROUGH: 2, GREEN: 3, SAND: 4, WATER: 5, DEEP: 6, FRINGE: 7 };
export const SURF_NAME = ['Tee box', 'Fairway', 'Rough', 'Green', 'Bunker', 'Water', 'Trees / OB', 'Fringe'];
export const PLAY = { x0: -240, x1: 240, z0: 60, z1: -660, step: 2 };
export const WATER_Y = -0.45;

const nA = makeNoise2D(11), nB = makeNoise2D(23), nC = makeNoise2D(37), nD = makeNoise2D(51);

// ---------------------------------------------------------------- layouts
export function makeLayout(stage) {
  const L = {
    fwHalf: 30, fwStart: -2, fwEnd: -380, treeX: 82,
    greens: [], bunkers: [], lakes: [], rows: [], lines: [], seed: stage.seed || 7,
  };
  const m = stage.mode;
  const addGreen = (dYd, xYd, r, extra = {}) => {
    const g = { x: xYd * YD, z: -dYd * YD, r, flag: true, ...extra };
    L.greens.push(g); return g;
  };
  const greenBunkers = (g, k = 1) => {
    L.bunkers.push({ x: g.x + (g.r + 5) * k, z: g.z + 2, rx: 4.5, rz: 7, rot: 0.3 });
    L.bunkers.push({ x: g.x - (g.r + 4) * k, z: g.z - g.r * 0.6, rx: 3.5, rz: 5.5, rot: -0.5 });
  };
  const pond = () => L.lakes.push({ x: -54, z: -86, rx: 17, rz: 27, deco: true });

  if (m === 'drive' || m === 'wind') {
    L.fwHalf = (stage.fw || 60) * YD / 2;
    L.treeX = Math.max(L.fwHalf + 46, 78);
    const g1 = addGreen(100, 24, 9, { deco: true }); greenBunkers(g1);
    const g2 = addGreen(160, -22, 10, { deco: true }); greenBunkers(g2, -1);
    for (const s of [-1, 1]) {
      L.bunkers.push({ x: s * (L.fwHalf + 7), z: -250 * YD, rx: 6, rz: 13, rot: s * 0.15 });
      L.bunkers.push({ x: s * (L.fwHalf + 5), z: -300 * YD, rx: 5, rz: 10, rot: -s * 0.2 });
    }
    L.bunkers.push({ x: -L.fwHalf * 0.55, z: -212 * YD, rx: 4.5, rz: 8, rot: 0.2 });
    if (m === 'wind') L.lines.push({ z: -stage.D * YD, label: stage.D + ' yd' });
    pond();
  } else if (m === 'target') {
    L.fwHalf = 30; L.fwEnd = -300;
    for (const f of stage.flags) {
      const g = addGreen(f.d, f.x || 0, Math.max(stage.R * YD + 3, 9), { target: true });
      greenBunkers(g, f.x > 0 ? -1 : 1);
    }
    pond();
  } else if (m === 'island') {
    L.fwHalf = 28;
    const gr = stage.gr * YD;
    const g = addGreen(stage.d, stage.x || 0, gr, { island: true, target: true });
    L.lakes.push({ x: g.x, z: g.z, rx: gr + 34, rz: gr + 38 });
    L.fwEnd = g.z - gr - 60;
  } else if (m === 'obstacle') {
    L.fwHalf = 30;
    const g = addGreen(stage.flag.d, stage.flag.x || 0, Math.max(stage.R * YD + 3, 9), { target: true });
    greenBunkers(g);
    for (const r of stage.rows) {
      L.rows.push({ z: -r.d * YD, type: r.type, gapC: (r.gx || 0) * YD, gapW: (r.gap || 0) * YD, h: r.h || 26 });
    }
    pond();
  }
  return L;
}

// ---------------------------------------------------------------- course
export class Course {
  constructor(layout) {
    this.L = layout;
    const { x0, x1, z0, z1, step } = PLAY;
    this.nx = Math.round((x1 - x0) / step) + 1;
    this.nz = Math.round((z0 - z1) / step) + 1;
    // green reference heights
    for (const g of layout.greens) {
      g.h = g.island ? WATER_Y + 0.75 : this.baseHeight(g.x, g.z) + 0.3;
      g.pinX = g.x; g.pinZ = g.z;
    }
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = z0 - j * step;
      for (let i = 0; i < this.nx; i++) this.heights[j * this.nx + i] = this.rawHeight(x0 + i * step, z);
    }
    this.buildTrees();
  }

  fwCenter(z) { return 3.0 * Math.sin(z * 0.006); }

  baseHeight(x, z) {
    const L = this.L;
    const ax = Math.abs(x - this.fwCenter(z));
    let h = nA(x * 0.010, z * 0.010) * 1.25 + nB(x * 0.03, z * 0.03) * 0.3;
    h += smoothstep(L.fwHalf + 8, L.treeX + 12, ax) * (2.6 + 1.6 * nC(z * 0.008, x > 0 ? 3 : 9));
    h += smoothstep(L.treeX, 760, ax) * (46 + 38 * nA(x * 0.0025 + 5, z * 0.0025));
    h += Math.pow(smoothstep(-600, -1900, z), 1.3) * (70 + 40 * nB(x * 0.002, 1.3));
    h += smoothstep(70, 500, z) * 34;
    // tee plateau
    const tw = 1 - smoothstep(7, 16, Math.max(Math.abs(x), Math.abs(z + 1)));
    h = lerp(h, 0.3, tw);
    return h;
  }

  lakeE(lk, x, z) {
    const dx = (x - lk.x) / lk.rx, dz = (z - lk.z) / lk.rz;
    if (dx * dx + dz * dz > 2.2) return 9;
    return Math.sqrt(dx * dx + dz * dz) + 0.07 * nD(x * 0.04, z * 0.04);
  }

  rawHeight(x, z) {
    const L = this.L;
    let h = this.baseHeight(x, z);
    for (const lk of L.lakes) {
      const e = this.lakeE(lk, x, z);
      if (e < 1.3) {
        const bed = WATER_Y - 0.9 - (1 - clamp(e, 0, 1)) * 1.6;
        h = lerp(h, bed, smoothstep(1.22, 0.9, e));
      }
    }
    for (const g of L.greens) {
      const d = Math.hypot(x - g.x, z - g.z);
      const fall = g.island ? 2.5 : 11;
      if (d < g.r + fall) {
        const w = 1 - smoothstep(g.r * 0.95, g.r + fall, d);
        const target = g.h + 0.12 * nB(x * 0.07, z * 0.07) + (x - g.x) * 0.006;
        h = lerp(h, target, w);
      }
    }
    for (const b of L.bunkers) {
      const e = this.bunkerE(b, x, z);
      if (e < 1.4) h += -0.55 * smoothstep(1.05, 0.35, e) + 0.18 * smoothstep(1.4, 1.1, e) * smoothstep(0.9, 1.1, e);
    }
    return h;
  }

  bunkerE(b, x, z) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const dx = x - b.x, dz = z - b.z, m = Math.max(b.rx, b.rz) * 1.6;
    if (dx * dx + dz * dz > m * m) return 9;
    const u = (dx * c - dz * s) / b.rx, v = (dx * s + dz * c) / b.rz;
    return Math.sqrt(u * u + v * v) + 0.08 * nC(x * 0.2, z * 0.2);
  }

  heightAt(x, z) {
    const { x0, z0, step } = PLAY;
    const gx = (x - x0) / step, gz = (z0 - z) / step;
    if (gx < 0 || gz < 0 || gx >= this.nx - 1 || gz >= this.nz - 1) return this.rawHeight(x, z);
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const H = this.heights, n = this.nx, k = j * n + i;
    // match the rendered triangle split (a=k, b=k+1, c=k+n, d=k+n+1; tris a,c,b / b,c,d)
    if (fx + fz <= 1) return H[k] + (H[k + 1] - H[k]) * fx + (H[k + n] - H[k]) * fz;
    return H[k + n + 1] + (H[k + n] - H[k + n + 1]) * (1 - fx) + (H[k + 1] - H[k + n + 1]) * (1 - fz);
  }

  normalAt(x, z, out) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l; return out;
  }

  surfaceAt(x, z, h) {
    const L = this.L;
    if (Math.abs(x) < 5.5 && z < 4.5 && z > -7.5) return SURF.TEE;
    for (const g of L.greens) {
      const d = Math.hypot(x - g.x, z - g.z);
      if (d < g.r + 3) {
        const rr = g.r * (1 + 0.06 * nA(x * 0.08, z * 0.08));
        if (d < rr) return SURF.GREEN;
        if (d < rr + 1.8) return SURF.FRINGE;
      }
    }
    for (const lk of L.lakes) {
      if (this.lakeE(lk, x, z) < 1.25) {
        if ((h ?? this.heightAt(x, z)) < WATER_Y) return SURF.WATER;
      }
    }
    for (const b of L.bunkers) if (this.bunkerE(b, x, z) < 1) return SURF.SAND;
    const ax = Math.abs(x - this.fwCenter(z));
    if (Math.abs(x) > L.treeX - 4 || z < PLAY.z1 + 20 || z > 40) return SURF.DEEP;
    if (z < L.fwStart && z > L.fwEnd) {
      const w = L.fwHalf + 2.2 * nC(z * 0.02, x > 0 ? 1 : 5);
      if (ax < w) return SURF.FAIRWAY;
    }
    return SURF.ROUGH;
  }

  // ------------------------------------------------------------ trees
  buildTrees() {
    const L = this.L, rnd = mulberry32(L.seed * 977 + 13);
    const trees = [];
    const free = (x, z, pad = 4) => {
      for (const g of L.greens) if (Math.hypot(x - g.x, z - g.z) < g.r + pad + 4) return false;
      for (const lk of L.lakes) if (this.lakeE(lk, x, z) < 1.25) return false;
      if (Math.abs(x) < 14 && z > -12 && z < 22) return false;
      return true;
    };
    const add = (x, z, type, H, wide = 1) => {
      if (!free(x, z)) return;
      trees.push({ x, z, y: this.heightAt(x, z) - 0.2, type, H, wide, hue: rnd() });
    };
    // side tree lines
    for (let z = 95; z > -690; z -= 6.5) {
      for (const s of [-1, 1]) {
        const n = 3 + ((rnd() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const x = s * (L.treeX + 2 + rnd() * 58 + k * 3);
          const type = rnd() < 0.55 ? 0 : 1;
          add(x, z + rnd() * 6, type, type === 0 ? 13 + rnd() * 11 : 10 + rnd() * 8, 0.85 + rnd() * 0.4);
        }
      }
    }
    // behind the tee
    for (let i = 0; i < 90; i++) {
      const x = (rnd() * 2 - 1) * (L.treeX + 30), z = 32 + rnd() * 70;
      const type = rnd() < 0.5 ? 0 : 1;
      add(x, z, type, type === 0 ? 12 + rnd() * 10 : 9 + rnd() * 7, 0.9 + rnd() * 0.3);
    }
    // back of the range
    for (let i = 0; i < 160; i++) {
      const x = (rnd() * 2 - 1) * (L.treeX + 20), z = -560 - rnd() * 90;
      add(x, z, rnd() < 0.6 ? 0 : 1, 13 + rnd() * 10, 0.9 + rnd() * 0.4);
    }
    // around decorative lakes
    for (const lk of L.lakes) {
      if (!lk.deco) continue;
      for (let i = 0; i < 14; i++) {
        const a = Math.PI * (0.55 + rnd() * 0.9);
        const r = 1.35 + rnd() * 0.5;
        add(lk.x + Math.cos(a) * lk.rx * r, lk.z + Math.sin(a) * lk.rz * r, 1, 8 + rnd() * 6, 1 + rnd() * 0.3);
      }
    }
    // obstacle rows
    for (const row of L.rows) {
      for (let x = -L.treeX - 6; x <= L.treeX + 6; x += 4.2) {
        const jx = x + (rnd() - 0.5) * 1.2;
        if (row.type === 'gap') {
          const cr = 0.14 * row.h * 1.1;
          if (Math.abs(jx - row.gapC) < row.gapW / 2 + cr) continue;
          trees.push({ x: jx, z: row.z + (rnd() - 0.5) * 1.5, y: this.heightAt(jx, row.z) - 0.2, type: 2, H: row.h * (0.95 + rnd() * 0.1), wide: 1.1, hue: rnd(), obstacle: true });
        } else {
          trees.push({ x: jx, z: row.z + (rnd() - 0.5) * 1.5, y: this.heightAt(jx, row.z) - 0.2, type: 1, H: row.h * (0.94 + rnd() * 0.12), wide: 0.62, hue: rnd(), obstacle: true });
        }
      }
    }
    this.trees = trees;
    // colliders + spatial hash
    this.cell = 16; this.hash = new Map();
    for (const t of trees) {
      const c = treeCollider(t); t.col = c;
      const key = ((Math.floor(t.x / this.cell) + 512) << 11) | (Math.floor(t.z / this.cell) + 1024);
      let arr = this.hash.get(key); if (!arr) this.hash.set(key, arr = []); arr.push(t);
    }
  }

  treesNear(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.hash.get(((cx + i + 512) << 11) | (cz + j + 1024));
      if (arr) for (const t of arr) out.push(t);
    }
    return out;
  }
}

// crown shape per species (unit-height proportions, must match world.js geometry)
export const TREE_SHAPE = [
  { trunk: 0.2, cy0: 0.16, cy1: 1.0, cr: 0.27, cone: true },   // pine
  { trunk: 0.5, cy0: 0.3, cy1: 0.98, cr: 0.36, cone: false },  // broadleaf
  { trunk: 0.2, cy0: 0.12, cy1: 1.0, cr: 0.14, cone: false },  // poplar
];
function treeCollider(t) {
  const s = TREE_SHAPE[t.type];
  return { cy0: t.y + s.cy0 * t.H, cy1: t.y + s.cy1 * t.H, cr: s.cr * t.H * t.wide, cone: s.cone, trunkR: 0.02 * t.H + 0.12 };
}
// returns 0 = no hit, 1 = crown, 2 = trunk
export function treeHit(t, x, y, z) {
  const c = t.col, dx = x - t.x, dz = z - t.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d > c.cr + 0.2 || y > c.cy1) return 0;
  if (y >= c.cy0) {
    let r;
    if (c.cone) r = c.cr * (c.cy1 - y) / (c.cy1 - c.cy0);
    else { const m = (c.cy0 + c.cy1) / 2, hh = (c.cy1 - c.cy0) / 2, q = (y - m) / hh; r = c.cr * Math.sqrt(Math.max(0, 1 - q * q)); }
    if (d < r) return 1;
  }
  if (y < c.cy0 + 1 && y > t.y && d < c.trunkR) return 2;
  return 0;
}
