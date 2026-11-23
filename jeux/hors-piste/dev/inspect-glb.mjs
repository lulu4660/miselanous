// Inspect a GLB: node tree (names, transforms), meshes (tris, materials), textures.
// node dev/inspect-glb.mjs file.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const tris = (mesh) => mesh.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3), 0);
function walk(node, depth) {
  const m = node.getMesh();
  const t = node.getTranslation().map((v) => +v.toFixed(2)), s = node.getScale().map((v) => +v.toFixed(3)), r = node.getRotation().map((v) => +v.toFixed(2));
  console.log(`${'  '.repeat(depth)}${node.getName() || '(node)'} t${JSON.stringify(t)} r${JSON.stringify(r)} s${JSON.stringify(s)}${m ? ` mesh:${m.getName()} tris ${tris(m)} mats ${m.listPrimitives().map((p) => p.getMaterial()?.getName()).join(',')}` : ''}`);
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const sc of root.listScenes()) for (const n of sc.listChildren()) walk(n, 0);
console.log('materials:', root.listMaterials().map((m) => `${m.getName()} col=${m.getBaseColorFactor().map((v) => v.toFixed(2))} tex=${m.getBaseColorTexture() ? m.getBaseColorTexture().getName() || m.getBaseColorTexture().getMimeType() : '-'} metal=${m.getMetallicFactor()} rough=${m.getRoughnessFactor()} alpha=${m.getAlphaMode()}`).join('\n  '));
console.log('textures:', root.listTextures().map((t) => `${t.getName()} ${t.getMimeType()} ${t.getSize()?.join('x')} ${t.getImage()?.byteLength}B`).join(', '));
