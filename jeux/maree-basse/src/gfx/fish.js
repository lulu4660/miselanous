// Little fish that leap out of the lagoon now and then, leaving ripple rings.
import * as THREE from 'three';

export function createFish(terrain, waves, water, particles, count = 3) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.16, 10, 6);
  geo.scale(0.55, 0.7, 1.6);
  const tail = new THREE.ConeGeometry(0.13, 0.22, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.3);
  const mat = new THREE.MeshStandardMaterial({ color: '#9fd2e6', roughness: 0.3, metalness: 0.4 });
  const jumps = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat), new THREE.Mesh(tail, mat));
    g.visible = false;
    group.add(g);
    jumps.push({ g, t: -1, wait: 2 + Math.random() * 6, x0: 0, z0: 0, x1: 0, z1: 0, h: 1 });
  }
  return {
    group,
    update(dt, focus) {
      for (const j of jumps) {
        if (j.t < 0) {
          j.wait -= dt;
          if (j.wait > 0) continue;
          // pick a spot in water, 8-26 m from the player
          for (let k = 0; k < 12; k++) {
            const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 18;
            const x = focus.x + Math.sin(a) * d, z = focus.z + Math.cos(a) * d;
            if (terrain.heightAt(x, z) < -0.5) {
              const b = Math.random() * Math.PI * 2, L = 1.6 + Math.random() * 1.4;
              j.x0 = x; j.z0 = z; j.x1 = x + Math.sin(b) * L; j.z1 = z + Math.cos(b) * L;
              j.h = 0.7 + Math.random() * 0.6;
              j.t = 0; j.g.visible = true;
              waves.disturb(x, z, -0.5, 0.5);
              particles.splash(x, water.levelAt(x, z), z, 0.08, 0, 0, water.levelAt);
              break;
            }
          }
          j.wait = 3 + Math.random() * 8;
          continue;
        }
        j.t += dt / 0.85;
        if (j.t >= 1) {
          j.t = -1; j.g.visible = false;
          waves.disturb(j.x1, j.z1, -0.7, 0.5);
          particles.splash(j.x1, water.levelAt(j.x1, j.z1), j.z1, 0.1, 0, 0, water.levelAt);
          continue;
        }
        const t = j.t;
        const x = j.x0 + (j.x1 - j.x0) * t, z = j.z0 + (j.z1 - j.z0) * t;
        const y = water.levelAt(x, z) + Math.sin(Math.PI * t) * j.h - 0.1;
        j.g.position.set(x, y, z);
        j.g.rotation.set(-Math.cos(Math.PI * t) * 1.1, Math.atan2(j.x1 - j.x0, j.z1 - j.z0), Math.sin(t * 20) * 0.2);
      }
    },
  };
}
