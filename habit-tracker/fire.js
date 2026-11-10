// The streak flame: a fluid vector flame drawn on a canvas. It is three
// nested shapes whose outlines sway on layered sine waves, sized by a spring.

export const TIERS = [
  { id: 'cold', min: 0, name: 'Unlit' },
  { id: 'spark', min: 1, name: 'Spark' },
  { id: 'blaze', min: 7, name: 'Blaze' },
  { id: 'inferno', min: 30, name: 'Inferno' },
  { id: 'legend', min: 100, name: 'Legendary' },
];

export function tierFor(streak) {
  let tier = TIERS[0];
  for (const t of TIERS) if (streak >= t.min) tier = t;
  return tier;
}

// 0 when unlit, about half size on day one, full size at 100 days.
export function sizeFor(streak) {
  if (streak <= 0) return 0;
  return 0.42 + 0.58 * Math.min(1, Math.log(1 + streak) / Math.log(101));
}

// Per tier: outer tip, outer base, mid tip, mid base, core tip, core base, glow.
const PALETTES = {
  spark: [[255, 70, 28], [255, 140, 44], [255, 160, 36], [255, 204, 84], [255, 226, 140], [255, 247, 220], [255, 106, 31]],
  blaze: [[255, 58, 10], [255, 152, 22], [255, 178, 30], [255, 216, 92], [255, 236, 160], [255, 252, 235], [255, 130, 20]],
  inferno: [[44, 92, 255], [64, 172, 255], [92, 190, 255], [152, 222, 255], [215, 242, 255], [255, 255, 255], [60, 140, 255]],
  legend: [[112, 62, 255], [202, 112, 255], [150, 150, 255], [132, 226, 255], [225, 245, 255], [255, 255, 255], [150, 100, 255]],
};

const TAU = Math.PI * 2;
const POINTS = 26;
const rand = Math.random;
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export class Flame {
  constructor(canvas, { reduced = false } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduced = reduced;
    this.size = 0; // spring position
    this.vel = 0;
    this.target = 0;
    this.dim = 1;
    this.atRisk = false;
    this.ghost = 1; // opacity of the unlit outline
    this.tier = 'spark';
    this.colors = PALETTES.spark.map((c) => c.slice());
    this.sparks = [];
    this.rings = [];
    this.time = 0;
    this.sparkAcc = 0;
    this.w = 0;
    this.h = 0;
    this.visible = true;
    this.running = false;
    this.tick = this.tick.bind(this);

    new ResizeObserver(() => this.resize()).observe(canvas);
    // Stop drawing while the flame is scrolled off screen.
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.start();
    }).observe(canvas);
    this.resize();
    this.start();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r.width === this.w && r.height === this.h && dpr === this.dpr) return;
    this.w = r.width;
    this.h = r.height;
    this.dpr = dpr;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    if (this.reduced) this.renderStill();
    else this.draw();
  }

  start() {
    if (this.reduced || this.running || !this.visible) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  set(streak, atRisk) {
    const tier = tierFor(streak).id;
    if (tier !== 'cold') this.tier = tier;
    this.atRisk = atRisk;
    this.target = sizeFor(streak) * (atRisk ? 0.78 : 1);
    if (this.reduced) this.renderStill();
  }

  // Spring kick, an expanding ring and a few sparks. Used on check-in.
  ignite(big = false) {
    if (this.reduced) return;
    this.vel += big ? 3.4 : 2.2;
    this.rings.push({ age: 0 });
    if (big) setTimeout(() => this.rings.push({ age: 0 }), 180);
    const { cx, by, H } = this.metrics(Math.max(this.target, 0.4));
    for (let i = 0; i < (big ? 26 : 14); i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
      const sp = (70 + rand() * 170) * (big ? 1.25 : 1);
      this.sparks.push({
        x: cx + (rand() - 0.5) * 16,
        y: by - H * (0.35 + rand() * 0.3),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        ttl: 0.5 + rand() * 0.5,
        r: 0.8 + rand() * 1.1,
        drag: true,
      });
    }
  }

  extinguish() {
    this.target = 0;
    if (this.reduced) this.renderStill();
  }

  metrics(size) {
    const H = this.h * 0.7 * size;
    return { cx: this.w / 2, by: this.h * 0.88, H, W: H * 0.3 };
  }

  update(dt) {
    this.time += dt;
    // Slightly underdamped spring, so size changes overshoot a touch.
    const accel = 140 * (this.target - this.size) - 15 * this.vel;
    this.vel += accel * dt;
    this.size = Math.max(0, this.size + this.vel * dt);

    const k = Math.min(1, dt * 4);
    const goal = PALETTES[this.tier];
    for (let i = 0; i < goal.length; i++) {
      for (let j = 0; j < 3; j++) this.colors[i][j] += (goal[i][j] - this.colors[i][j]) * k;
    }
    this.dim += ((this.atRisk ? 0.62 : 1) - this.dim) * k;
    this.ghost += ((this.target === 0 ? 1 : 0) - this.ghost) * k;

    if (this.size > 0.1) {
      this.sparkAcc += this.size * 2.2 * dt;
      while (this.sparkAcc >= 1) {
        this.sparkAcc--;
        const { cx, by, H, W } = this.metrics(this.size);
        this.sparks.push({
          x: cx + (rand() - 0.5) * W * 0.9,
          y: by - H * (0.45 + rand() * 0.45),
          vx: (rand() - 0.5) * 22,
          vy: -(28 + rand() * 46),
          age: 0,
          ttl: 0.9 + rand() * 0.9,
          r: 0.6 + rand() * 0.9,
        });
      }
    }
    for (const p of this.sparks) {
      p.age += dt;
      if (p.drag) {
        const d = Math.pow(0.02, dt);
        p.vx *= d;
        p.vy = p.vy * d - 30 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const r of this.rings) r.age += dt;
    this.sparks = this.sparks.filter((p) => p.age < p.ttl);
    this.rings = this.rings.filter((r) => r.age < 0.8);
  }

  // Traces one flame-shaped outline. `sway` bends it, `seed` desynchronises layers.
  trace(cx, by, W, H, sway, seed) {
    const { ctx, time } = this;
    const left = [];
    const right = [];
    for (let i = 0; i <= POINTS; i++) {
      const t = i / POINTS;
      // Rounded at the base, widest about a third of the way up, pointed tip.
      const profile = Math.sin(Math.PI * Math.pow(t, 0.58)) * (1 - 0.18 * t * t);
      const half = W * profile * (1 + 0.06 * sway * Math.sin(time * 4.3 + t * 7 + seed));
      const bend = sway * 0.42 * W * Math.pow(t, 1.6)
        * (0.65 * Math.sin(time * 2.3 + t * 2.6 + seed) + 0.35 * Math.sin(time * 4.1 + t * 5.2 + seed * 1.7));
      const y = by - H * t;
      left.push([cx + bend - half, y]);
      right.push([cx + bend + half, y]);
    }
    const pts = left.concat(right.slice(1, POINTS).reverse());
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }

  layer(m, scaleW, scaleH, seed, tip, base, sway) {
    const { ctx, time } = this;
    const flicker = 1 + sway * (0.035 * Math.sin(time * 6.1 + seed) + 0.025 * Math.sin(time * 9.7 + seed * 2));
    const H = m.H * scaleH * flicker;
    this.trace(m.cx, m.by, m.W * scaleW, H, sway, seed);
    const grad = ctx.createLinearGradient(0, m.by, 0, m.by - H);
    grad.addColorStop(0, rgb(base));
    grad.addColorStop(1, rgb(tip));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  draw(sway = 1) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.w) return;
    const col = this.colors;

    if (this.ghost > 0.02) {
      const g = this.metrics(0.6);
      this.trace(g.cx, g.by, g.W, g.H, 0, 0);
      ctx.fillStyle = `rgba(255,255,255,${0.035 * this.ghost})`;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(255,255,255,${0.16 * this.ghost})`;
      ctx.stroke();
    }

    if (this.size > 0.03) {
      const m = this.metrics(this.size);
      const pulse = this.atRisk ? 1 + 0.14 * sway * Math.sin(this.time * 2.2) : 1;
      const alpha = Math.min(1, this.size * 4) * this.dim * pulse;

      const gy = m.by - m.H * 0.45;
      const radius = Math.min(m.H * 0.95, gy, this.h - gy, this.w / 2);
      const glow = ctx.createRadialGradient(m.cx, gy, 0, m.cx, gy, radius);
      glow.addColorStop(0, rgb(col[6], 0.3 * alpha * (1 + 0.08 * sway * Math.sin(this.time * 3))));
      glow.addColorStop(1, rgb(col[6], 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.w, this.h);

      ctx.globalAlpha = Math.min(1, alpha);
      this.layer(m, 1, 1, 0, col[0], col[1], sway);
      this.layer(m, 0.64, 0.66, 2.1, col[2], col[3], sway);
      this.layer(m, 0.34, 0.36, 4.4, col[4], col[5], sway);
      ctx.globalAlpha = 1;
    }

    const ringAt = this.metrics(Math.max(this.size, 0.4));
    const ringY = ringAt.by - ringAt.H * 0.42;
    // Keep the ring inside the canvas so it never gets cut off at an edge.
    const ringMax = Math.min(ringAt.W * 3.1, this.h - ringY - 2, ringY - 2);
    const ringMin = ringAt.W * 0.9;
    ctx.lineWidth = 1.5;
    for (const r of this.rings) {
      const t = r.age / 0.8;
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.strokeStyle = rgb(col[3], (1 - t) * 0.5);
      ctx.beginPath();
      ctx.arc(ringAt.cx, ringY, ringMin + Math.max(0, ringMax - ringMin) * ease, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = rgb(col[4]);
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.sin(Math.PI * (p.age / p.ttl)) * 0.9 * this.dim;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Paints one still flame for `streak` onto any canvas, at that canvas's own
  // pixel size. Used for the share image.
  static still(canvas, streak) {
    const tier = tierFor(streak).id;
    const f = Object.create(Flame.prototype);
    Object.assign(f, {
      c: canvas,
      ctx: canvas.getContext('2d'),
      w: canvas.width,
      h: canvas.height,
      dpr: 1,
      time: 1.3,
      size: sizeFor(streak),
      target: sizeFor(streak),
      dim: 1,
      atRisk: false,
      ghost: streak > 0 ? 0 : 1,
      tier: tier === 'cold' ? 'spark' : tier,
      sparks: [],
      rings: [],
    });
    f.colors = PALETTES[f.tier].map((c) => c.slice());
    f.draw(1);
  }

  // Reduced motion: jump straight to the end state and paint one frame.
  renderStill() {
    this.size = this.target;
    this.vel = 0;
    this.dim = this.atRisk ? 0.62 : 1;
    this.ghost = this.target === 0 ? 1 : 0;
    this.colors = PALETTES[this.tier].map((c) => c.slice());
    this.sparks = [];
    this.rings = [];
    this.draw(0);
  }

  tick(now) {
    if (!this.visible) {
      this.running = false;
      return;
    }
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
  }
}
