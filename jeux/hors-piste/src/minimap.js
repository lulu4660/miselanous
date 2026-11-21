// Heading-up circular minimap: biomes and roads pre-rendered once, player arrow and
// traffic dots drawn at 10 Hz on a small 2D canvas.
import { S } from './vehicles.js';

export function createMinimap(canvas, world) {
  const ctx = canvas.getContext('2d');
  const SZ = 512;
  const base = document.createElement('canvas');
  base.width = base.height = SZ;
  const b = base.getContext('2d');
  const img = b.createImageData(SZ, SZ);
  const nrm = [0, 1, 0];
  const pal = {
    [S.SNOW]: [236, 241, 250], [S.GRASS]: [128, 172, 92], [S.SAND]: [222, 168, 108], [S.DIRT]: [190, 132, 88],
    [S.ROCK]: [150, 140, 140], [S.ICE]: [180, 222, 240],
  };
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const wx = -world.half + (x + 0.5) * world.size / SZ, wz = -world.half + (y + 0.5) * world.size / SZ;
    world.normalAt(wx, wz, nrm);
    const sh = 0.72 + 0.28 * Math.max(0, -nrm[0] * 0.6 + nrm[1] * 0.6 - nrm[2] * 0.5);
    const c = pal[world.surfaceAt(wx, wz)] || [190, 132, 88];
    const o = (y * SZ + x) * 4;
    img.data[o] = c[0] * sh; img.data[o + 1] = c[1] * sh; img.data[o + 2] = c[2] * sh; img.data[o + 3] = 255;
  }
  b.putImageData(img, 0, 0);
  const toPx = (v) => ((v + world.half) / world.size) * SZ;
  b.lineCap = 'round'; b.lineJoin = 'round';
  for (const road of world.roads) {
    for (const [w, col] of [[7, 'rgba(40,30,45,0.55)'], [4, null]]) {
      for (let i = 0; i < road.pts.length - 1 + (road.closed ? 1 : 0); i++) {
        const p = road.pts[i], q = road.pts[(i + 1) % road.pts.length];
        b.strokeStyle = col || ['#000', '#3b3b44', '#8a5a36', '#f7fbff'][p.type];
        b.lineWidth = w;
        b.beginPath(); b.moveTo(toPx(p.x), toPx(p.z)); b.lineTo(toPx(q.x), toPx(q.z)); b.stroke();
      }
    }
  }

  const M = {
    draw(player, cars, yaw) {
      const W = canvas.width, H = canvas.height, R = W / 2;
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
      ctx.translate(R, R);
      ctx.rotate(Math.PI + yaw);
      const s = (W / 260) * (world.size / SZ);
      ctx.scale(s, s);
      ctx.translate(-toPx(player.pos.x), -toPx(player.pos.z));
      ctx.drawImage(base, 0, 0);
      for (const c of cars) {
        if (c === player) continue;
        ctx.fillStyle = c.livery ? c.livery.primary : '#fff';
        ctx.strokeStyle = 'rgba(30,20,35,0.9)'; ctx.lineWidth = 1.2 / s;
        ctx.beginPath(); ctx.arc(toPx(c.pos.x), toPx(c.pos.z), 4.2 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      // player arrow (always pointing up)
      ctx.fillStyle = '#fff4e2'; ctx.strokeStyle = '#2b2233'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(R, R - 9); ctx.lineTo(R + 6.5, R + 7); ctx.lineTo(R, R + 3.5); ctx.lineTo(R - 6.5, R + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      // north tick
      const a = -Math.PI / 2 + Math.PI + yaw, rr = R - W * 0.09;
      ctx.fillStyle = '#ffc94a'; ctx.font = `800 ${Math.round(W * 0.11)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', R + Math.cos(a) * rr, R + Math.sin(a) * rr);
    },
  };
  return M;
}
