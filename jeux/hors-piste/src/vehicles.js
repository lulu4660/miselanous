// Vehicle catalogue: one spec per car, read by the physics (vehicle.js), the 3D model
// (gfx/carModel.js + gfx/bodies.js), the garage and the AI. Renderer-free.
// Body frame: origin = centre of mass, +z forward, +y up, +x left. Units: m, kg, N, m/s.

// Surface ids (see world.js): grip multipliers per vehicle are indexed by these.
export const S = { ASPHALT: 0, DIRT: 1, SNOWROAD: 2, GRASS: 3, SAND: 4, SNOW: 5, ROCK: 6, ICE: 7 };
export const SURF_NAMES = ['asphalt', 'dirt', 'snowroad', 'grass', 'sand', 'snow', 'rock', 'ice'];
// base tyre friction (RaycastVehicle frictionSlip) and rolling resistance per surface
export const SURF_GRIP = [1.55, 1.05, 0.62, 0.95, 0.85, 0.5, 1.25, 0.22];
export const SURF_ROLL = [0.012, 0.03, 0.035, 0.04, 0.06, 0.08, 0.02, 0.01];

const wheels4 = (track, front, rear, y, r, rRear = r) => [
  { x: track, y, z: front, front: true, radius: r },
  { x: -track, y, z: front, front: true, radius: r },
  { x: track, y, z: rear, front: false, radius: rRear },
  { x: -track, y, z: rear, front: false, radius: rRear },
];

export const VEHICLES = {
  cabri: {
    id: 'cabri', name: 'Cabri R4', tagline: 'Petite rallye 4×4, vive partout',
    drive: 'awd', mass: 1150,
    box: { minX: -0.9, maxX: 0.9, minY: -0.34, maxY: 0.98, minZ: -1.98, maxZ: 2.02 },
    chassis: [{ half: [0.9, 0.36, 2.0], offset: [0, 0.0, 0.02] }, { half: [0.78, 0.3, 1.1], offset: [0, 0.66, -0.3] }],
    wheels: wheels4(0.8, 1.27, -1.22, -0.06, 0.34),
    restLength: 0.34, stiffness: 24, dampingCompression: 2.6, dampingRelaxation: 2.3, rollInfluence: 0.06, maxTravel: 0.3,
    engineForce: 9800, topSpeed: 44, downforce: 1.2, reverseSpeed: 9, brakeDecel: 12,
    steer: { max: 0.55, maxHigh: 0.12, rate: 3.0 },
    grip: [1.0, 1.08, 1.12, 1.0, 1.05, 1.08, 1.0, 1.05],
    inertiaMul: [1.2, 1.0, 1.3],
    stats: { vitesse: 0.72, accel: 0.8, adherence: 0.78, toutTerrain: 0.75 },
    sound: { pitch: 1.25 },
    livery: { primary: '#2f7fd8', secondary: '#f4efe6', accent: '#ffcf3d' },
  },
  mistral: {
    id: 'mistral', name: 'Mistral GT', tagline: 'Coupé propulsion, roi du bitume',
    drive: 'rwd', mass: 1350,
    box: { minX: -0.97, maxX: 0.97, minY: -0.24, maxY: 0.84, minZ: -2.22, maxZ: 2.28 },
    chassis: [{ half: [0.97, 0.3, 2.24], offset: [0, 0.04, 0.03] }, { half: [0.78, 0.24, 1.0], offset: [0, 0.58, -0.35] }],
    wheels: wheels4(0.86, 1.45, -1.34, -0.04, 0.36),
    restLength: 0.24, stiffness: 38, dampingCompression: 3.4, dampingRelaxation: 3.0, rollInfluence: 0.04, maxTravel: 0.2,
    engineForce: 12500, topSpeed: 56, downforce: 3.2, reverseSpeed: 9, brakeDecel: 13,
    steer: { max: 0.5, maxHigh: 0.09, rate: 3.2 },
    grip: [1.12, 0.92, 0.85, 0.9, 0.85, 0.8, 1.05, 0.9],
    inertiaMul: [1.1, 1.0, 1.5],
    stats: { vitesse: 0.95, accel: 0.9, adherence: 0.6, toutTerrain: 0.3 },
    sound: { pitch: 1.05 },
    livery: { primary: '#d8352f', secondary: '#1f1d24', accent: '#f4efe6' },
  },
  bison: {
    id: 'bison', name: 'Bison 4×4', tagline: 'Gros tout-terrain, imperturbable',
    drive: 'awd', mass: 1900,
    box: { minX: -0.98, maxX: 0.98, minY: -0.42, maxY: 1.22, minZ: -2.12, maxZ: 2.2 },
    chassis: [{ half: [0.96, 0.4, 2.14], offset: [0, -0.02, 0.02] }, { half: [0.72, 0.38, 1.42], offset: [0, 0.8, -0.45] }],
    wheels: wheels4(0.92, 1.33, -1.24, -0.05, 0.46),
    restLength: 0.5, stiffness: 15.5, dampingCompression: 2.4, dampingRelaxation: 2.0, rollInfluence: 0.08, maxTravel: 0.44,
    engineForce: 12600, topSpeed: 33, reverseSpeed: 8, brakeDecel: 10,
    steer: { max: 0.6, maxHigh: 0.16, rate: 2.6 },
    grip: [0.95, 1.08, 1.22, 1.08, 1.15, 1.3, 1.05, 1.1],
    inertiaMul: [1.25, 1.0, 1.6],
    stats: { vitesse: 0.5, accel: 0.55, adherence: 0.85, toutTerrain: 1.0 },
    sound: { pitch: 0.8 },
    livery: { primary: '#f2755b', secondary: '#f6ead6', accent: '#3dbdb7' },
  },
  criquet: {
    id: 'criquet', name: 'Criquet', tagline: 'Buggy léger, saute partout',
    drive: 'rwd', mass: 760,
    box: { minX: -0.72, maxX: 0.72, minY: -0.3, maxY: 1.12, minZ: -1.75, maxZ: 1.85 },
    chassis: [{ half: [0.7, 0.3, 1.78], offset: [0, 0.0, 0.05] }, { half: [0.62, 0.38, 0.75], offset: [0, 0.72, -0.25] }],
    wheels: wheels4(0.88, 1.25, -1.15, -0.06, 0.4, 0.44),
    restLength: 0.44, stiffness: 20, dampingCompression: 2.2, dampingRelaxation: 1.9, rollInfluence: 0.07, maxTravel: 0.4,
    engineForce: 7600, topSpeed: 42, reverseSpeed: 9, brakeDecel: 12,
    steer: { max: 0.58, maxHigh: 0.13, rate: 3.2 },
    grip: [0.95, 1.12, 1.0, 1.08, 1.15, 1.0, 1.0, 0.95],
    inertiaMul: [1.2, 1.0, 1.3],
    stats: { vitesse: 0.7, accel: 0.95, adherence: 0.7, toutTerrain: 0.85 },
    sound: { pitch: 1.45 },
    livery: { primary: '#8ac43f', secondary: '#2b2730', accent: '#ff8a2a' },
  },
};
export const VEHICLE_ORDER = ['cabri', 'mistral', 'bison', 'criquet'];

// AI liveries (paint variations)
export const LIVERIES = [
  { primary: '#f2a23a', secondary: '#1f1d24', accent: '#f4efe6' },
  { primary: '#6b4fd8', secondary: '#f4efe6', accent: '#3ad8c0' },
  { primary: '#e8e3d8', secondary: '#c2372f', accent: '#1f1d24' },
  { primary: '#1f6b4f', secondary: '#e9d6a3', accent: '#f2a23a' },
  { primary: '#d84f8c', secondary: '#f4efe6', accent: '#2b2730' },
  { primary: '#2b2730', secondary: '#ffcf3d', accent: '#e8e3d8' },
];
