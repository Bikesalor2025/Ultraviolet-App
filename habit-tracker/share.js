// Draws the shareable streak image: flame, streak count and habit name.

import { Flame, tierFor } from './fire.js';

const ACCENTS = { cold: '#ff7a2f', spark: '#ff7a2f', blaze: '#ffa21f', inferno: '#4da3ff', legend: '#b58cff' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

export function shareCard(name, streak) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = ACCENTS[tierFor(streak).id];

  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.8);
  wash.addColorStop(0, `${accent}3d`);
  wash.addColorStop(1, `${accent}00`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const flame = document.createElement('canvas');
  flame.width = 760;
  flame.height = 720;
  Flame.still(flame, streak);
  ctx.drawImage(flame, (W - flame.width) / 2, 70);

  ctx.textAlign = 'center';
  ctx.fillStyle = streak > 0 ? '#f5f2ef' : '#5d5650';
  ctx.font = `700 300px ${FONT}`;
  ctx.fillText(String(streak), W / 2, 1010);

  ctx.fillStyle = '#9b938c';
  ctx.font = `600 52px ${FONT}`;
  ctx.fillText('day streak', W / 2, 1090);

  ctx.fillStyle = '#f5f2ef';
  ctx.font = `650 60px ${FONT}`;
  ctx.fillText(fit(ctx, name, W - 160), W / 2, 1200);

  ctx.fillStyle = accent;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('Streakfire', W / 2, 1290);
  return canvas;
}
