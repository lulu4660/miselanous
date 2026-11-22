// Particles (splash droplets, spray, sand dust, sparkles) and tyre-track ribbons.
import * as THREE from 'three';

export function createParticles(max = 900) {
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  const P = [];
  for (let i = 0; i < max; i++) P.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1, r: 1, g: 1, b: 1, grav: 9.8, drag: 0, type: 0 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uScale;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = aColor; vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        // soft puff with a little irregularity (big particles read as dust, not as discs)
        float wob = 0.86 + 0.14 * sin(atan(c.y, c.x) * 5.0 + vAlpha * 40.0);
        float a = pow(max(0.0, 1.0 - d / (0.5 * wob)), 1.8) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  let cursor = 0;
  const c = new THREE.Color();

  function spawn(o) {
    for (let k = 0; k < max; k++) {
      cursor = (cursor + 1) % max;
      const p = P[cursor];
      if (!p.alive || k === max - 1) {
        Object.assign(p, { alive: true, life: 0, grav: 9.8, drag: 0, s1: o.s0, a0: 1, onWater: null }, o);
        c.set(o.color || '#ffffff');
        p.r = c.r; p.g = c.g; p.b = c.b;
        return p;
      }
    }
  }

  return {
    points, spawn,
    splash(x, y, z, intensity, vx = 0, vz = 0, waterLevelAt) {
      const n = Math.floor(10 + intensity * 70);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.6 + Math.random()) * (1.5 + intensity * 4);
        spawn({
          x: x + Math.cos(a) * Math.random() * 1.2, y: y + 0.1, z: z + Math.sin(a) * Math.random() * 1.2,
          vx: Math.cos(a) * sp * 0.6 + vx * 0.4, vy: 2 + Math.random() * (3 + intensity * 7), vz: Math.sin(a) * sp * 0.6 + vz * 0.4,
          max: 0.7 + Math.random() * 0.8, s0: 0.12 + Math.random() * 0.18, s1: 0.05, color: Math.random() < 0.7 ? '#ffffff' : '#c9f3ec', type: 1,
          onWater: waterLevelAt,
        });
      }
    },
    spray(x, y, z, vx, vz, amount) {
      // rooster tail: thrown up and slightly back/out from the tyre
      const side = (Math.random() - 0.5) * 2.2;
      const l = Math.hypot(vx, vz) || 1;
      spawn({
        x: x + (Math.random() - 0.5) * 0.3, y, z: z + (Math.random() - 0.5) * 0.3,
        vx: vx * 0.45 - vz / l * side + (Math.random() - 0.5), vy: 1.8 + Math.random() * 3.5 * amount, vz: vz * 0.45 + vx / l * side + (Math.random() - 0.5),
        max: 0.45 + Math.random() * 0.45, s0: 0.14 + Math.random() * 0.2 * amount, s1: 0.05, color: Math.random() < 0.8 ? '#ffffff' : '#c8f1ee', type: 1,
      });
    },
    // billowing dust (or snow powder): grows, rises a little, lingers behind the car
    dust(x, y, z, vx, vz, color = '#ead2a8', big = 1) {
      spawn({
        x: x + (Math.random() - 0.5) * 0.4, y: y + 0.15, z: z + (Math.random() - 0.5) * 0.4,
        vx: vx * 0.18 + (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random() * 1.1, vz: vz * 0.18 + (Math.random() - 0.5) * 1.2,
        max: (1.4 + Math.random() * 1.2) * big, s0: 0.45, s1: (1.8 + Math.random() * 1.5) * big, a0: 0.46, grav: -0.12, drag: 1.4, color, type: 2,
      });
    },
    // gravel / snow lumps thrown back by a spinning or sliding tyre
    chips(x, y, z, vx, vz, color = '#7a6250') {
      const l = Math.hypot(vx, vz) || 1;
      spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: y + 0.12, z: z + (Math.random() - 0.5) * 0.3,
        vx: vx * 0.35 - (vx / l) * (1 + Math.random() * 3) + (Math.random() - 0.5) * 2.5, vy: 1.5 + Math.random() * 3.5,
        vz: vz * 0.35 - (vz / l) * (1 + Math.random() * 3) + (Math.random() - 0.5) * 2.5,
        max: 0.5 + Math.random() * 0.5, s0: 0.07 + Math.random() * 0.06, s1: 0.06, a0: 1, grav: 9.8, drag: 0.4, color, type: 1,
      });
    },
    // tyre smoke on tarmac: big, slow, pale
    smoke(x, y, z, vx, vz, color = '#d9d6dc') {
      spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: y + 0.25, z: z + (Math.random() - 0.5) * 0.3,
        vx: vx * 0.1 + (Math.random() - 0.5) * 0.6, vy: 0.5 + Math.random() * 0.6, vz: vz * 0.1 + (Math.random() - 0.5) * 0.6,
        max: 1.8 + Math.random() * 1.2, s0: 0.5, s1: 2.6 + Math.random() * 1.4, a0: 0.32, grav: -0.08, drag: 0.9, color, type: 2,
      });
    },
    sparkle(x, y, z, n = 40) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
        const sp = 2 + Math.random() * 5;
        spawn({
          x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp,
          max: 0.8 + Math.random() * 0.9, s0: 0.22, s1: 0.02, grav: 3, drag: 1.2, color: Math.random() < 0.5 ? '#ffe28a' : '#fff6d8', type: 3,
        });
      }
    },
    update(dt) {
      let n = 0;
      for (let i = 0; i < max; i++) {
        const p = P[i];
        if (!p.alive) { size[i] = 0; alpha[i] = 0; continue; }
        p.life += dt;
        if (p.life >= p.max) { p.alive = false; size[i] = 0; alpha[i] = 0; continue; }
        p.vy -= p.grav * dt;
        if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.onWater && p.vy < 0 && p.y < p.onWater(p.x, p.z)) { p.alive = false; size[i] = 0; alpha[i] = 0; continue; }
        const t = p.life / p.max;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
        size[i] = p.s0 + (p.s1 - p.s0) * t;
        alpha[i] = p.a0 * (p.type === 2 ? Math.sin(Math.PI * Math.min(1, t * 1.3)) : 1 - t * t);
        n++;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      return n;
    },
    setScale(heightPx, fovDeg) {
      mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
  };
}

// Ring-buffer ribbons for each wheel; fade with age.
export function createTracks(count = 4, segs = 420) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#7a5a3e') }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 30 }, uFogFar: { value: 170 } },
    vertexShader: /* glsl */`
      attribute float aBirth; attribute float aStrength;
      uniform float uTime;
      varying float vA; varying float vEdge; varying float vFog;
      uniform float uFogNear; uniform float uFogFar;
      attribute float aSide;
      void main() {
        float age = uTime - aBirth;
        vA = aStrength * (1.0 - smoothstep(18.0, 40.0, age)) * step(0.0, aBirth);
        vEdge = aSide;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = length(mv.xyz);
        vFog = smoothstep(uFogNear, uFogFar, d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uFogColor;
      varying float vA; varying float vEdge; varying float vFog;
      void main() {
        float tread = 0.55 + 0.45 * step(0.5, fract(vEdge * 3.0));
        float a = vA * 0.32 * tread * (1.0 - vFog);
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const ribbons = [];
  for (let r = 0; r < count; r++) {
    const pos = new Float32Array(segs * 4 * 3);
    const birth = new Float32Array(segs * 4).fill(-1);
    const strength = new Float32Array(segs * 4);
    const side = new Float32Array(segs * 4);
    const idx = [];
    for (let s = 0; s < segs; s++) {
      const b = s * 4;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      side[b] = 0; side[b + 1] = 1; side[b + 2] = 0; side[b + 3] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aStrength', new THREE.BufferAttribute(strength, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    ribbons.push({ geo, pos, birth, strength, head: 0, last: null, lastL: null, lastR: null, dirty: false });
  }
  return {
    group, mat,
    // add a point for ribbon r; nx,ny,nz ground normal; dx,dz motion direction
    add(r, x, y, z, dx, dz, width, str, time) {
      const R = ribbons[r];
      const l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l * width * 0.5, sz = dx / l * width * 0.5;
      const L = [x + sx, y + 0.035, z + sz], Rr = [x - sx, y + 0.035, z - sz];
      if (R.last) {
        const d = Math.hypot(x - R.last[0], z - R.last[2]);
        if (d < 0.32) return;
        if (d > 3) { R.last = [x, y, z]; R.lastL = L; R.lastR = Rr; return; }
        const s = R.head;
        const b = s * 4;
        R.pos.set(R.lastL, b * 3); R.pos.set(R.lastR, (b + 1) * 3); R.pos.set(L, (b + 2) * 3); R.pos.set(Rr, (b + 3) * 3);
        for (let k = 0; k < 4; k++) { R.birth[b + k] = time; R.strength[b + k] = str; }
        R.head = (R.head + 1) % (R.pos.length / 12);
        R.dirty = true;
      }
      R.last = [x, y, z]; R.lastL = L; R.lastR = Rr;
    },
    cut(r) { ribbons[r].last = null; },
    update(time, fog) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uFogColor.value.copy(fog.color);
      mat.uniforms.uFogNear.value = fog.near; mat.uniforms.uFogFar.value = fog.far;
      for (const R of ribbons) {
        if (!R.dirty) continue;
        R.geo.attributes.position.needsUpdate = true;
        R.geo.attributes.aBirth.needsUpdate = true;
        R.geo.attributes.aStrength.needsUpdate = true;
        R.dirty = false;
      }
    },
  };
}
