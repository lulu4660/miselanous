// A few seagulls gliding in lazy circles; they scatter when the horn sounds.
import * as THREE from 'three';

export function createBirds(count = 7) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#fbf6ee', side: THREE.DoubleSide });
  const tipMat = new THREE.MeshLambertMaterial({ color: '#4a4350', side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.18, 0.75, 0.0, -0.05, 0.75, 0, -0.05, 0, 0, 0.18, 0.75, 0.0, 0.12], 3));
  wingGeo.computeVertexNormals();
  const tipGeo = new THREE.BufferGeometry();
  tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.72, 0, -0.06, 0.72, 0, 0.12, 1.05, 0.0, 0.0], 3));
  tipGeo.computeVertexNormals();
  const bodyGeo = new THREE.CapsuleGeometry(0.1, 0.45, 3, 6).rotateX(Math.PI / 2);
  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat);
    b.add(body);
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const m = new THREE.Mesh(wingGeo, mat); const t = new THREE.Mesh(tipGeo, tipMat);
      w.add(m, t);
      w.scale.x = s;
      b.add(w);
      wings.push(w);
    }
    b.scale.setScalar(1.1 + Math.random() * 0.4);
    group.add(b);
    birds.push({
      g: b, wings, cx: (Math.random() - 0.5) * 160, cz: (Math.random() - 0.5) * 160, r: 18 + Math.random() * 30,
      h: 16 + Math.random() * 14, a: Math.random() * 6.28, sp: (0.18 + Math.random() * 0.12) * (Math.random() < 0.5 ? -1 : 1),
      flap: Math.random() * 6, scare: 0,
    });
  }
  return {
    group,
    scare(x, z) {
      for (const b of birds) {
        const d = Math.hypot(b.g.position.x - x, b.g.position.z - z);
        if (d < 60) b.scare = 3;
      }
    },
    update(t, dt, focus) {
      for (const b of birds) {
        // drift circle centres slowly toward the player so gulls stay in view
        b.cx += (focus.x - b.cx) * dt * 0.01;
        b.cz += (focus.z - b.cz) * dt * 0.01;
        b.scare = Math.max(0, b.scare - dt);
        const boost = 1 + b.scare * 0.8;
        b.a += b.sp * dt * boost;
        const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
        b.base = b.base ?? (focus.y || 0); b.base += ((focus.y || 0) - b.base) * Math.min(1, dt * 0.4);
        const y = b.base + b.h + Math.sin(t * 0.4 + b.r) * 1.5 + b.scare * 4;
        const dx = -Math.sin(b.a) * Math.sign(b.sp), dz = Math.cos(b.a) * Math.sign(b.sp);
        b.g.position.set(x, y, z);
        b.g.rotation.set(0, Math.atan2(dx, dz), -Math.sign(b.sp) * 0.25);
        const flapping = b.scare > 0 || Math.sin(t * 0.3 + b.r) > 0.6;
        b.flap += dt * (flapping ? 11 : 0.8);
        const ang = flapping ? Math.sin(b.flap) * 0.55 : 0.12 + Math.sin(b.flap) * 0.04;
        b.wings[0].rotation.z = ang; b.wings[1].rotation.z = -ang;
      }
    },
  };
}
