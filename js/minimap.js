// Bird's-eye minimap: cheap 2D canvas. Static layout is rasterised once per fit; overlays redrawn ~12 fps.
import { SURF, WATER_Y } from './terrain.js';

const COL = [];
COL[SURF.TEE] = [120, 178, 74]; COL[SURF.FAIRWAY] = [104, 166, 62]; COL[SURF.ROUGH] = [70, 120, 44];
COL[SURF.GREEN] = [140, 210, 96]; COL[SURF.SAND] = [226, 204, 150]; COL[SURF.WATER] = [58, 120, 160];
COL[SURF.DEEP] = [48, 84, 36]; COL[SURF.FRINGE] = [120, 190, 80];

export class Minimap {
  constructor(el) {
    this.el = el; this.cv = el.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
    this.bg = document.createElement('canvas'); this.fit = null; this.lastDraw = 0; this.dirty = true;
    el.addEventListener('pointerdown', e => { e.stopPropagation(); });
    el.addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('big'); this.dirty = true; this.onToggle?.(el.classList.contains('big')); });
  }
  /** fit view: tee (0,0) at bottom, cover out to `far` metres downrange, centred on cx */
  setCourse(course, targets, R, far, cx = 0) {
    const span = Math.max(80, far * 1.12);
    const f = { span, x0: cx - span / 2, z0: span * 0.08 }; // world z of the map's bottom edge
    if (this.course === course && this.fit && Math.abs(this.fit.span - span) / span < 0.12 && Math.abs(this.fit.x0 - f.x0) < span * 0.05) { this.targets = targets; this.R = R; return; }
    this.course = course; this.targets = targets; this.R = R; this.fit = f; this.dirty = true;
    const N = 128, bg = this.bg; bg.width = bg.height = N;
    const g = bg.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = f.x0 + (i + 0.5) / N * span, z = f.z0 - (j + 0.5) / N * span;
      const h = course.heightAt(x, z), s = course.surfaceAt(x, z, h);
      const c = COL[s] || COL[SURF.ROUGH], sh = s === SURF.WATER ? 1 : 0.88 + Math.max(-0.12, Math.min(0.16, h * 0.012));
      const k = (j * N + i) * 4; d[k] = c[0] * sh; d[k + 1] = c[1] * sh; d[k + 2] = c[2] * sh; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // trees
    const px = N / span;
    for (const t of course.trees || []) {
      const u = (t.x - f.x0) * px, v = (f.z0 - t.z) * px; if (u < -2 || v < -2 || u > N + 2 || v > N + 2) continue;
      g.fillStyle = t.obstacle ? 'rgba(20,40,14,.95)' : 'rgba(28,56,22,.85)';
      g.beginPath(); g.arc(u, v, Math.max(0.8, t.H * t.wide * 0.18 * px), 0, 6.283); g.fill();
    }
  }
  toMap(x, z, W) { const f = this.fit; return [(x - f.x0) / f.span * W, (f.z0 - z) / f.span * W]; }
  /** s = { ball, pred, live, tgtIdx, windDir, windMph, aim, now } */
  draw(s, force) {
    if (!this.fit || this.el.offsetParent === null) return;
    const now = s.now || performance.now();
    if (!force && !this.dirty && now - this.lastDraw < 80) return;
    this.lastDraw = now; this.dirty = false;
    const cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1), css = this.el.clientWidth || 120;
    const W = Math.round(css * dpr); if (cv.width !== W) { cv.width = cv.height = W; }
    const g = this.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true;
    g.drawImage(this.bg, 0, 0, W, W);
    g.fillStyle = 'rgba(30,18,10,.12)'; g.fillRect(0, 0, W, W);
    const m = (x, z) => this.toMap(x, z, W), sc = W / this.fit.span, lw = Math.max(1, dpr);
    // targets
    (this.targets || []).forEach((t, i) => {
      const [u, v] = m(t.pinX ?? t.x, t.pinZ ?? t.z), r = Math.max(3 * dpr, (this.R ? this.R * 0.9144 : t.r || 8) * sc);
      g.lineWidth = (i === s.tgtIdx ? 2 : 1.2) * lw; g.strokeStyle = i === s.tgtIdx ? '#ffd23a' : 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(u, v, r, 0, 6.283); g.stroke();
      g.fillStyle = i === s.tgtIdx ? '#ff4d3a' : '#fff'; g.beginPath(); g.arc(u, v, 1.6 * lw, 0, 6.283); g.fill();
    });
    // predicted path
    const P = s.pred;
    if (P) {
      const sm = P.samples, n = sm.length / 4;
      g.setLineDash([3 * lw, 3 * lw]); g.lineWidth = 1.6 * lw; g.strokeStyle = 'rgba(255,240,200,.95)';
      g.beginPath(); let started = false, landed = false;
      for (let i = 0; i < n; i += 3) {
        const [u, v] = m(sm[i * 4 + 1], sm[i * 4 + 3]);
        if (!landed && sm[i * 4] >= P.landT) { g.lineTo(u, v); g.stroke(); g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.1 * lw; landed = true; g.moveTo(u, v); continue; }
        if (!started) { g.moveTo(u, v); started = true; } else g.lineTo(u, v);
      }
      g.stroke(); g.setLineDash([]);
      const [lu, lv] = m(P.land.x, P.land.z);
      g.lineWidth = 2.2 * lw; g.strokeStyle = '#1a0f08'; g.beginPath(); g.arc(lu, lv, 4.5 * lw, 0, 6.283); g.stroke();
      g.lineWidth = 1.5 * lw; g.strokeStyle = '#ffe08a'; g.beginPath(); g.arc(lu, lv, 4.5 * lw, 0, 6.283); g.stroke();
      if (s.showRest !== false) { const [ru, rv] = m(P.rest.x, P.rest.z); g.fillStyle = 'rgba(255,255,255,.75)'; g.strokeStyle = '#1a0f08'; g.lineWidth = lw; g.beginPath(); g.arc(ru, rv, 2.4 * lw, 0, 6.283); g.fill(); g.stroke(); }
    }
    // live flight trail + ball
    if (s.trail && s.trail.length > 1) {
      g.lineWidth = 2 * lw; g.strokeStyle = 'rgba(255,170,70,.95)'; g.beginPath();
      s.trail.forEach((p, i) => { const [u, v] = m(p.x, p.z); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.stroke();
    }
    const b = s.live || s.ball;
    if (b) { const [u, v] = m(b.x, b.z); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = lw; g.beginPath(); g.arc(u, v, 2.8 * lw, 0, 6.283); g.fill(); g.stroke(); }
    // tee
    { const [u, v] = m(0, 0); g.fillStyle = '#c8352e'; g.fillRect(u - 4 * lw, v + 3 * lw, 8 * lw, 2 * lw); }
    // wind arrow (top-right)
    if (s.windMph > 0.5) {
      const cx = W - 13 * dpr, cy = 13 * dpr, a = s.windDir * Math.PI / 180, L = 7 * dpr;
      g.save(); g.translate(cx, cy); g.fillStyle = 'rgba(15,10,6,.55)'; g.beginPath(); g.arc(0, 0, 11 * dpr, 0, 6.283); g.fill();
      g.rotate(a); g.fillStyle = '#bfe6ff'; g.beginPath(); g.moveTo(0, -L); g.lineTo(L * 0.65, L * 0.25); g.lineTo(L * 0.22, L * 0.1); g.lineTo(L * 0.22, L); g.lineTo(-L * 0.22, L); g.lineTo(-L * 0.22, L * 0.1); g.lineTo(-L * 0.65, L * 0.25); g.closePath(); g.fill(); g.restore();
      g.fillStyle = '#fff'; g.font = `800 ${9 * dpr}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText(Math.round(s.windMph) + '', cx, cy + 21 * dpr);
    }
  }
}
