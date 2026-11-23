import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const IF_MISSING = process.argv.includes('--if-missing');

function pad4(n) {
  return (n + 3) & ~3;
}

/**
 * Pure-JS glTF 2.0 binary (.glb) builder supporting multiple meshes, PBR materials,
 * hierarchical nodes, skins (JOINTS_0 / WEIGHTS_0), and keyframe animations.
 */
class GlbBuilder {
  constructor() {
    this.nodes = [];
    this.meshes = [];
    this.materials = [];
    this.skins = [];
    this.animations = [];
    this.accessors = [];
    this.bufferViews = [];
    this.chunks = [];
    this.byteLength = 0;
    this.sceneNodes = [];
  }

  addMaterial({
    name,
    baseColor = [1, 1, 1, 1],
    metallic = 0.0,
    roughness = 0.5,
    emissive = [0, 0, 0],
    doubleSided = false,
    alphaMode = 'OPAQUE',
  }) {
    const mat = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: baseColor,
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
      doubleSided,
    };
    if (emissive[0] > 0 || emissive[1] > 0 || emissive[2] > 0) {
      mat.emissiveFactor = emissive;
    }
    if (alphaMode !== 'OPAQUE') {
      mat.alphaMode = alphaMode;
    }
    this.materials.push(mat);
    return this.materials.length - 1;
  }

  _appendBuffer(typedArray, target) {
    const raw = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const offset = this.byteLength;
    const paddedLen = pad4(raw.byteLength);
    const padBytes = paddedLen - raw.byteLength;
    this.chunks.push(raw);
    if (padBytes > 0) {
      this.chunks.push(Buffer.alloc(padBytes, 0));
    }
    this.byteLength += paddedLen;

    const bv = {
      buffer: 0,
      byteOffset: offset,
      byteLength: raw.byteLength,
    };
    if (target) bv.target = target;
    this.bufferViews.push(bv);
    return this.bufferViews.length - 1;
  }

  _addAccessor(typedArray, componentType, type, count, target, computeMinMax = false) {
    const bufferView = this._appendBuffer(typedArray, target);
    const acc = {
      bufferView,
      componentType,
      count,
      type,
    };
    if (computeMinMax) {
      const stride = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
      const min = new Array(stride).fill(Infinity);
      const max = new Array(stride).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < stride; k++) {
          const v = typedArray[i * stride + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
      acc.min = min;
      acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  addMesh(name, primitives) {
    const builtPrims = primitives.map((p) => {
      const posArr = new Float32Array(p.positions);
      const normArr = new Float32Array(p.normals);
      const uvArr = new Float32Array(p.uvs || new Array((posArr.length / 3) * 2).fill(0));
      const idxArr = new Uint16Array(p.indices);

      const attributes = {
        POSITION: this._addAccessor(posArr, 5126, 'VEC3', posArr.length / 3, 34962, true),
        NORMAL: this._addAccessor(normArr, 5126, 'VEC3', normArr.length / 3, 34962, false),
        TEXCOORD_0: this._addAccessor(uvArr, 5126, 'VEC2', uvArr.length / 2, 34962, false),
      };

      if (p.joints && p.weights) {
        const jArr = new Uint8Array(p.joints);
        const wArr = new Float32Array(p.weights);
        attributes.JOINTS_0 = this._addAccessor(jArr, 5121, 'VEC4', jArr.length / 4, 34962, false);
        attributes.WEIGHTS_0 = this._addAccessor(wArr, 5126, 'VEC4', wArr.length / 4, 34962, false);
      }

      const indices = this._addAccessor(idxArr, 5123, 'SCALAR', idxArr.length, 34963, false);

      return {
        attributes,
        indices,
        material: p.material,
      };
    });

    this.meshes.push({ name, primitives: builtPrims });
    return this.meshes.length - 1;
  }

  addNode({ name, translation, rotation, scale, mesh, skin, children = [] }, isRoot = false) {
    const node = { name };
    if (translation) node.translation = translation;
    if (rotation) node.rotation = rotation;
    if (scale) node.scale = scale;
    if (mesh !== undefined) node.mesh = mesh;
    if (skin !== undefined) node.skin = skin;
    if (children.length > 0) node.children = children;
    this.nodes.push(node);
    const idx = this.nodes.length - 1;
    if (isRoot) this.sceneNodes.push(idx);
    return idx;
  }

  addSkin(name, joints, inverseBindMatricesFlat, skeletonRoot) {
    const ibmArr = new Float32Array(inverseBindMatricesFlat);
    const ibmAcc = this._addAccessor(ibmArr, 5126, 'MAT4', joints.length, undefined, false);
    this.skins.push({
      name,
      joints,
      inverseBindMatrices: ibmAcc,
      skeleton: skeletonRoot,
    });
    return this.skins.length - 1;
  }

  addAnimation(name, tracks) {
    const samplers = [];
    const channels = [];
    for (const t of tracks) {
      const timeArr = new Float32Array(t.times);
      const valArr = new Float32Array(t.values);
      const input = this._addAccessor(timeArr, 5126, 'SCALAR', timeArr.length, undefined, true);
      const output = this._addAccessor(
        valArr,
        5126,
        t.path === 'rotation' ? 'VEC4' : 'VEC3',
        t.times.length,
        undefined,
        false
      );
      const samplerIdx = samplers.length;
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({
        sampler: samplerIdx,
        target: { node: t.node, path: t.path },
      });
    }
    this.animations.push({ name, samplers, channels });
    return this.animations.length - 1;
  }

  build() {
    const gltf = {
      asset: { version: '2.0', generator: 'TashkentPlayCanvasGlbGen/1.0' },
      scene: 0,
      scenes: [{ nodes: this.sceneNodes }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: this.byteLength }],
    };
    if (this.skins.length > 0) gltf.skins = this.skins;
    if (this.animations.length > 0) gltf.animations = this.animations;

    let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPad = pad4(jsonBuf.byteLength) - jsonBuf.byteLength;
    if (jsonPad > 0) {
      jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
    }

    const binBuf = Buffer.concat(this.chunks);
    const totalLength = 12 + 8 + jsonBuf.byteLength + 8 + binBuf.byteLength;

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuf.byteLength, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuf.byteLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

    return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
  }
}

// Geometry helpers
function createGeoAccumulator() {
  return { positions: [], normals: [], uvs: [], indices: [], joints: [], weights: [] };
}

function addBoxGeo(geo, cx, cy, cz, sx, sy, sz, jointIndex = null) {
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;
  const faces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = geo.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      geo.positions.push(cx + f.v[i][0], cy + f.v[i][1], cz + f.v[i][2]);
      geo.normals.push(f.n[0], f.n[1], f.n[2]);
      geo.uvs.push(uvs[i][0], uvs[i][1]);
      if (jointIndex !== null) {
        geo.joints.push(jointIndex, 0, 0, 0);
        geo.weights.push(1, 0, 0, 0);
      }
    }
    geo.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function addCylinderGeo(geo, cx, cy, cz, rBottom, rTop, height, segs = 16, axis = 'y', jointIndex = null) {
  const half = height * 0.5;
  const baseRingStart = geo.positions.length / 3;

  // Side surface
  for (let yStep = 0; yStep <= 1; yStep++) {
    const r = yStep === 0 ? rBottom : rTop;
    const h = yStep === 0 ? -half : half;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let px, py, pz, nx, ny, nz;
      if (axis === 'y') {
        px = cx + ca * r;
        py = cy + h;
        pz = cz + sa * r;
        nx = ca;
        ny = (rBottom - rTop) / Math.max(0.01, height);
        nz = sa;
      } else {
        // X-axis wheel cylinder
        px = cx + h;
        py = cy + ca * r;
        pz = cz + sa * r;
        nx = 0;
        ny = ca;
        nz = sa;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      geo.positions.push(px, py, pz);
      geo.normals.push(nx / nLen, ny / nLen, nz / nLen);
      geo.uvs.push(i / segs, yStep);
      if (jointIndex !== null) {
        geo.joints.push(jointIndex, 0, 0, 0);
        geo.weights.push(1, 0, 0, 0);
      }
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < segs; i++) {
    const b0 = baseRingStart + i;
    const b1 = baseRingStart + i + 1;
    const t0 = baseRingStart + stride + i;
    const t1 = baseRingStart + stride + i + 1;
    geo.indices.push(b0, t0, b1, b1, t0, t1);
  }

  // Caps
  for (let side = 0; side < 2; side++) {
    const r = side === 0 ? rBottom : rTop;
    const h = side === 0 ? -half : half;
    const dir = side === 0 ? -1 : 1;
    const centerIdx = geo.positions.length / 3;
    if (axis === 'y') {
      geo.positions.push(cx, cy + h, cz);
      geo.normals.push(0, dir, 0);
    } else {
      geo.positions.push(cx + h, cy, cz);
      geo.normals.push(dir, 0, 0);
    }
    geo.uvs.push(0.5, 0.5);
    if (jointIndex !== null) {
      geo.joints.push(jointIndex, 0, 0, 0);
      geo.weights.push(1, 0, 0, 0);
    }
    const ringStart = geo.positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (axis === 'y') {
        geo.positions.push(cx + ca * r, cy + h, cz + sa * r);
        geo.normals.push(0, dir, 0);
      } else {
        geo.positions.push(cx + h, cy + ca * r, cz + sa * r);
        geo.normals.push(dir, 0, 0);
      }
      geo.uvs.push(0.5 + 0.5 * ca, 0.5 + 0.5 * sa);
      if (jointIndex !== null) {
        geo.joints.push(jointIndex, 0, 0, 0);
        geo.weights.push(1, 0, 0, 0);
      }
    }
    for (let i = 0; i < segs; i++) {
      if (side === 0) {
        geo.indices.push(centerIdx, ringStart + i, ringStart + i + 1);
      } else {
        geo.indices.push(centerIdx, ringStart + i + 1, ringStart + i);
      }
    }
  }
}

function quatFromEulerX(rad) {
  const h = rad * 0.5;
  return [Math.sin(h), 0, 0, Math.cos(h)];
}

function quatFromEulerY(rad) {
  const h = rad * 0.5;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

// =========================================================================
// 1. GENERATE TASHKENT TV TOWER (public/models/tashkent.glb)
// =========================================================================
function buildTashkentTowerGlb() {
  const b = new GlbBuilder();
  const matConcrete = b.addMaterial({ name: 'Concrete', baseColor: [0.85, 0.87, 0.90, 1], metallic: 0.05, roughness: 0.65 });
  const matSteel = b.addMaterial({ name: 'TowerSteel', baseColor: [0.92, 0.94, 0.97, 1], metallic: 0.72, roughness: 0.28 });
  const matDarkTrim = b.addMaterial({ name: 'DarkTrim', baseColor: [0.16, 0.20, 0.26, 1], metallic: 0.5, roughness: 0.4 });
  const matGoldGlass = b.addMaterial({ name: 'KoinotGlass', baseColor: [0.22, 0.68, 0.88, 1], metallic: 0.85, roughness: 0.12, emissive: [0.06, 0.22, 0.34] });
  const matUzAccent = b.addMaterial({ name: 'UzTurquoise', baseColor: [0.08, 0.58, 0.76, 1], metallic: 0.35, roughness: 0.3 });
  const matBeacon = b.addMaterial({ name: 'BeaconRed', baseColor: [1.0, 0.16, 0.12, 1], metallic: 0.1, roughness: 0.2, emissive: [1.0, 0.18, 0.12] });

  const concrete = createGeoAccumulator();
  const steel = createGeoAccumulator();
  const darkTrim = createGeoAccumulator();
  const glass = createGeoAccumulator();
  const uzAccent = createGeoAccumulator();
  const beacon = createGeoAccumulator();

  // Granular stepped plinth base (y=0 to y=3.5)
  addCylinderGeo(concrete, 0, 0.9, 0, 16, 14.5, 1.8, 12, 'y');
  addCylinderGeo(uzAccent, 0, 2.2, 0, 13.5, 12.8, 0.8, 12, 'y');
  addCylinderGeo(concrete, 0, 4.2, 0, 11.2, 9.5, 3.2, 12, 'y');

  // Iconic 3 angled structural buttress legs + lattice ribs around lower shaft
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let s = 0; s < 6; s++) {
      const t = s / 5;
      const r = 10.2 * (1 - t) + 3.4 * t;
      const y = 3.5 + t * 24.0;
      addBoxGeo(concrete, ca * r, y, sa * r, 2.2 - t * 0.7, 5.2, 2.2 - t * 0.7);
    }
  }

  // Main central tower shaft
  addCylinderGeo(concrete, 0, 26, 0, 5.6, 3.6, 48, 16, 'y');
  addCylinderGeo(steel, 0, 62, 0, 3.5, 2.6, 26, 16, 'y');

  // Lower Observation Deck & Koinot Restaurant Tier (y=46..54)
  addCylinderGeo(darkTrim, 0, 46.5, 0, 6.2, 8.8, 2.4, 24, 'y');
  addCylinderGeo(glass, 0, 49.4, 0, 9.2, 9.4, 3.4, 24, 'y');
  addCylinderGeo(steel, 0, 52.0, 0, 9.5, 6.8, 1.8, 24, 'y');
  addCylinderGeo(uzAccent, 0, 53.3, 0, 6.8, 5.2, 1.0, 24, 'y');

  // Upper Broadcast Deck (y=68..74)
  addCylinderGeo(darkTrim, 0, 68.5, 0, 4.2, 6.4, 1.8, 20, 'y');
  addCylinderGeo(glass, 0, 70.6, 0, 6.6, 6.6, 2.4, 20, 'y');
  addCylinderGeo(steel, 0, 72.6, 0, 6.6, 4.0, 1.6, 20, 'y');

  // Tall Broadcast Spire (y=73..115)
  addCylinderGeo(steel, 0, 84, 0, 2.2, 1.3, 22, 12, 'y');
  addCylinderGeo(steel, 0, 102, 0, 1.2, 0.55, 16, 12, 'y');
  addCylinderGeo(darkTrim, 0, 112.5, 0, 0.55, 0.3, 5.5, 10, 'y');
  addCylinderGeo(beacon, 0, 116.2, 0, 0.55, 0.55, 1.8, 10, 'y');

  const meshIdx = b.addMesh('TashkentTVTower', [
    { ...concrete, material: matConcrete },
    { ...steel, material: matSteel },
    { ...darkTrim, material: matDarkTrim },
    { ...glass, material: matGoldGlass },
    { ...uzAccent, material: matUzAccent },
    { ...beacon, material: matBeacon },
  ]);

  b.addNode({ name: 'TashkentTVTowerRoot', mesh: meshIdx }, true);
  return b.build();
}

// =========================================================================
// 2. GENERATE RIGGED + ANIMATED CHARACTER (public/models/character.glb)
// =========================================================================
function buildCharacterGlb() {
  const b = new GlbBuilder();
  const matSkin = b.addMaterial({ name: 'Skin', baseColor: [0.87, 0.69, 0.56, 1], metallic: 0.0, roughness: 0.65 });
  const matJacket = b.addMaterial({ name: 'Jacket', baseColor: [0.12, 0.19, 0.32, 1], metallic: 0.05, roughness: 0.72 });
  const matShirt = b.addMaterial({ name: 'Shirt', baseColor: [0.92, 0.94, 0.97, 1], metallic: 0.0, roughness: 0.8 });
  const matPants = b.addMaterial({ name: 'Jeans', baseColor: [0.16, 0.21, 0.30, 1], metallic: 0.0, roughness: 0.85 });
  const matShoes = b.addMaterial({ name: 'Sneakers', baseColor: [0.95, 0.95, 0.97, 1], metallic: 0.05, roughness: 0.5 });
  const matHair = b.addMaterial({ name: 'Hair', baseColor: [0.09, 0.08, 0.08, 1], metallic: 0.05, roughness: 0.75 });

  // Joint hierarchy (index 0..11)
  // Bind positions in world space (feet at y = 0, total height ~1.78m)
  const jointsDef = [
    { name: 'Hips', parent: -1, pos: [0, 0.92, 0] },           // 0
    { name: 'Spine', parent: 0, pos: [0, 1.12, 0] },           // 1
    { name: 'Chest', parent: 1, pos: [0, 1.38, 0] },           // 2
    { name: 'Head', parent: 2, pos: [0, 1.54, 0] },            // 3
    { name: 'LeftUpperArm', parent: 2, pos: [0.24, 1.44, 0] }, // 4
    { name: 'LeftForeArm', parent: 4, pos: [0.26, 1.18, 0] },  // 5
    { name: 'RightUpperArm', parent: 2, pos: [-0.24, 1.44, 0] }, // 6
    { name: 'RightForeArm', parent: 6, pos: [-0.26, 1.18, 0] }, // 7
    { name: 'LeftThigh', parent: 0, pos: [0.10, 0.90, 0] },    // 8
    { name: 'LeftShin', parent: 8, pos: [0.10, 0.48, 0] },     // 9
    { name: 'RightThigh', parent: 0, pos: [-0.10, 0.90, 0] },  // 10
    { name: 'RightShin', parent: 10, pos: [-0.10, 0.48, 0] },  // 11
  ];

  // Build primitives bound to joints in world bind-pose coordinates
  const skinGeo = createGeoAccumulator();
  const jacketGeo = createGeoAccumulator();
  const shirtGeo = createGeoAccumulator();
  const pantsGeo = createGeoAccumulator();
  const shoesGeo = createGeoAccumulator();
  const hairGeo = createGeoAccumulator();

  // Pelvis / Hips (joint 0)
  addBoxGeo(pantsGeo, 0, 0.94, 0, 0.30, 0.16, 0.20, 0);
  // Spine & Chest (joints 1, 2)
  addBoxGeo(shirtGeo, 0, 1.15, 0, 0.28, 0.24, 0.18, 1);
  addBoxGeo(jacketGeo, 0, 1.34, 0, 0.36, 0.28, 0.22, 2);
  // Neck + Head + Hair + Shades (joint 3)
  addBoxGeo(skinGeo, 0, 1.52, 0, 0.10, 0.08, 0.10, 3);
  addBoxGeo(skinGeo, 0, 1.65, 0, 0.20, 0.22, 0.21, 3);
  addBoxGeo(hairGeo, 0, 1.75, 0.01, 0.21, 0.08, 0.22, 3);
  addBoxGeo(hairGeo, 0, 1.67, -0.105, 0.17, 0.05, 0.03, 3); // Sunglasses facing -Z

  // Left Arm (joints 4, 5)
  addBoxGeo(jacketGeo, 0.24, 1.31, 0, 0.11, 0.26, 0.11, 4);
  addBoxGeo(skinGeo, 0.26, 1.04, 0, 0.09, 0.26, 0.09, 5);
  // Right Arm (joints 6, 7)
  addBoxGeo(jacketGeo, -0.24, 1.31, 0, 0.11, 0.26, 0.11, 6);
  addBoxGeo(skinGeo, -0.26, 1.04, 0, 0.09, 0.26, 0.09, 7);

  // Left Leg (joints 8, 9)
  addBoxGeo(pantsGeo, 0.10, 0.69, 0, 0.14, 0.42, 0.15, 8);
  addBoxGeo(pantsGeo, 0.10, 0.28, 0, 0.12, 0.40, 0.13, 9);
  addBoxGeo(shoesGeo, 0.10, 0.045, -0.04, 0.13, 0.09, 0.24, 9);

  // Right Leg (joints 10, 11)
  addBoxGeo(pantsGeo, -0.10, 0.69, 0, 0.14, 0.42, 0.15, 10);
  addBoxGeo(pantsGeo, -0.10, 0.28, 0, 0.12, 0.40, 0.13, 11);
  addBoxGeo(shoesGeo, -0.10, 0.045, -0.04, 0.13, 0.09, 0.24, 11);

  // Create joint nodes (local offsets relative to parent)
  const jointNodeIndices = new Array(jointsDef.length);
  const childrenMap = Array.from({ length: jointsDef.length }, () => []);
  for (let i = 1; i < jointsDef.length; i++) {
    childrenMap[jointsDef[i].parent].push(i);
  }

  function createJointNodeRecursive(jIdx) {
    const def = jointsDef[jIdx];
    const parentPos = def.parent >= 0 ? jointsDef[def.parent].pos : [0, 0, 0];
    const rel = [
      def.pos[0] - parentPos[0],
      def.pos[1] - parentPos[1],
      def.pos[2] - parentPos[2],
    ];
    const childNodeIds = childrenMap[jIdx].map((c) => createJointNodeRecursive(c));
    const nodeIdx = b.addNode({
      name: def.name,
      translation: rel,
      rotation: [0, 0, 0, 1],
      children: childNodeIds,
    });
    jointNodeIndices[jIdx] = nodeIdx;
    return nodeIdx;
  }

  const hipsNodeIdx = createJointNodeRecursive(0);

  // Inverse Bind Matrices (translation by -worldPos)
  const ibmFlat = [];
  for (const def of jointsDef) {
    ibmFlat.push(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -def.pos[0], -def.pos[1], -def.pos[2], 1
    );
  }
  const skinIdx = b.addSkin('CharacterSkin', jointNodeIndices, ibmFlat, hipsNodeIdx);

  const meshIdx = b.addMesh('CharacterMesh', [
    { ...skinGeo, material: matSkin },
    { ...jacketGeo, material: matJacket },
    { ...shirtGeo, material: matShirt },
    { ...pantsGeo, material: matPants },
    { ...shoesGeo, material: matShoes },
    { ...hairGeo, material: matHair },
  ]);

  const meshNodeIdx = b.addNode({ name: 'CharacterBody', mesh: meshIdx, skin: skinIdx });
  b.addNode({ name: 'CharacterRoot', children: [hipsNodeIdx, meshNodeIdx] }, true);

  // Embedded Animations: Idle, Walk, Run
  const jNode = (i) => jointNodeIndices[i];

  // 1) Idle (subtle breathing & relaxed stance)
  b.addAnimation('Idle', [
    {
      node: jNode(2), path: 'rotation',
      times: [0, 1.0, 2.0],
      values: [...quatFromEulerX(0.02), ...quatFromEulerX(-0.02), ...quatFromEulerX(0.02)],
    },
    {
      node: jNode(4), path: 'rotation',
      times: [0, 1.0, 2.0],
      values: [...quatFromEulerX(0.05), ...quatFromEulerX(-0.03), ...quatFromEulerX(0.05)],
    },
    {
      node: jNode(6), path: 'rotation',
      times: [0, 1.0, 2.0],
      values: [...quatFromEulerX(-0.03), ...quatFromEulerX(0.05), ...quatFromEulerX(-0.03)],
    },
  ]);

  // 2) Walk cycle (0.8s loop)
  const wT = [0, 0.2, 0.4, 0.6, 0.8];
  b.addAnimation('Walk', [
    {
      node: jNode(0), path: 'translation',
      times: wT,
      values: [0, 0.90, 0, 0, 0.93, 0, 0, 0.90, 0, 0, 0.93, 0, 0, 0.90, 0],
    },
    {
      node: jNode(8), path: 'rotation', // LeftThigh
      times: wT,
      values: [...quatFromEulerX(0.55), ...quatFromEulerX(0), ...quatFromEulerX(-0.55), ...quatFromEulerX(0), ...quatFromEulerX(0.55)],
    },
    {
      node: jNode(9), path: 'rotation', // LeftShin
      times: wT,
      values: [...quatFromEulerX(-0.15), ...quatFromEulerX(-0.55), ...quatFromEulerX(-0.10), ...quatFromEulerX(-0.05), ...quatFromEulerX(-0.15)],
    },
    {
      node: jNode(10), path: 'rotation', // RightThigh
      times: wT,
      values: [...quatFromEulerX(-0.55), ...quatFromEulerX(0), ...quatFromEulerX(0.55), ...quatFromEulerX(0), ...quatFromEulerX(-0.55)],
    },
    {
      node: jNode(11), path: 'rotation', // RightShin
      times: wT,
      values: [...quatFromEulerX(-0.10), ...quatFromEulerX(-0.05), ...quatFromEulerX(-0.15), ...quatFromEulerX(-0.55), ...quatFromEulerX(-0.10)],
    },
    {
      node: jNode(4), path: 'rotation', // LeftUpperArm
      times: wT,
      values: [...quatFromEulerX(-0.45), ...quatFromEulerX(0), ...quatFromEulerX(0.45), ...quatFromEulerX(0), ...quatFromEulerX(-0.45)],
    },
    {
      node: jNode(5), path: 'rotation', // LeftForeArm
      times: wT,
      values: [...quatFromEulerX(0.25), ...quatFromEulerX(0.18), ...quatFromEulerX(0.32), ...quatFromEulerX(0.18), ...quatFromEulerX(0.25)],
    },
    {
      node: jNode(6), path: 'rotation', // RightUpperArm
      times: wT,
      values: [...quatFromEulerX(0.45), ...quatFromEulerX(0), ...quatFromEulerX(-0.45), ...quatFromEulerX(0), ...quatFromEulerX(0.45)],
    },
    {
      node: jNode(7), path: 'rotation', // RightForeArm
      times: wT,
      values: [...quatFromEulerX(0.32), ...quatFromEulerX(0.18), ...quatFromEulerX(0.25), ...quatFromEulerX(0.18), ...quatFromEulerX(0.32)],
    },
  ]);

  // 3) Run cycle (0.52s loop)
  const rT = [0, 0.13, 0.26, 0.39, 0.52];
  b.addAnimation('Run', [
    {
      node: jNode(0), path: 'translation',
      times: rT,
      values: [0, 0.87, 0, 0, 0.94, 0, 0, 0.87, 0, 0, 0.94, 0, 0, 0.87, 0],
    },
    {
      node: jNode(1), path: 'rotation',
      times: [0, 0.52],
      values: [...quatFromEulerX(0.16), ...quatFromEulerX(0.16)],
    },
    {
      node: jNode(8), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(0.95), ...quatFromEulerX(0.1), ...quatFromEulerX(-0.90), ...quatFromEulerX(0.1), ...quatFromEulerX(0.95)],
    },
    {
      node: jNode(9), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(-0.25), ...quatFromEulerX(-0.95), ...quatFromEulerX(-0.15), ...quatFromEulerX(-0.35), ...quatFromEulerX(-0.25)],
    },
    {
      node: jNode(10), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(-0.90), ...quatFromEulerX(0.1), ...quatFromEulerX(0.95), ...quatFromEulerX(0.1), ...quatFromEulerX(-0.90)],
    },
    {
      node: jNode(11), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(-0.15), ...quatFromEulerX(-0.35), ...quatFromEulerX(-0.25), ...quatFromEulerX(-0.95), ...quatFromEulerX(-0.15)],
    },
    {
      node: jNode(4), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(-0.85), ...quatFromEulerX(0), ...quatFromEulerX(0.85), ...quatFromEulerX(0), ...quatFromEulerX(-0.85)],
    },
    {
      node: jNode(5), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(0.85), ...quatFromEulerX(0.75), ...quatFromEulerX(0.95), ...quatFromEulerX(0.75), ...quatFromEulerX(0.85)],
    },
    {
      node: jNode(6), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(0.85), ...quatFromEulerX(0), ...quatFromEulerX(-0.85), ...quatFromEulerX(0), ...quatFromEulerX(0.85)],
    },
    {
      node: jNode(7), path: 'rotation',
      times: rT,
      values: [...quatFromEulerX(0.95), ...quatFromEulerX(0.75), ...quatFromEulerX(0.85), ...quatFromEulerX(0.75), ...quatFromEulerX(0.95)],
    },
  ]);

  return b.build();
}

// =========================================================================
// 3. GENERATE CARS (cobalt.glb, malibu.glb, gentra.glb)
// Forward = -Z, Up = +Y, wheels centered at local pivot (0,0,0)
// =========================================================================
function buildCarGlb({ name, bodyColor, metallic, roughness, length, width, cabinHeight, wheelRadius }) {
  const b = new GlbBuilder();
  const matBody = b.addMaterial({ name: 'CarPaint', baseColor: bodyColor, metallic, roughness });
  const matTrim = b.addMaterial({ name: 'DarkTrim', baseColor: [0.09, 0.10, 0.12, 1], metallic: 0.35, roughness: 0.55 });
  const matGlass = b.addMaterial({ name: 'CarGlass', baseColor: [0.08, 0.14, 0.20, 0.88], metallic: 0.9, roughness: 0.08, alphaMode: 'BLEND' });
  const matChrome = b.addMaterial({ name: 'Chrome', baseColor: [0.88, 0.90, 0.94, 1], metallic: 0.95, roughness: 0.12 });
  const matHeadlight = b.addMaterial({ name: 'Headlight', baseColor: [1.0, 0.97, 0.88, 1], metallic: 0.1, roughness: 0.1, emissive: [1.0, 0.95, 0.82] });
  const matTaillight = b.addMaterial({ name: 'Taillight', baseColor: [0.95, 0.12, 0.12, 1], metallic: 0.1, roughness: 0.15, emissive: [0.85, 0.08, 0.08] });
  const matTire = b.addMaterial({ name: 'RubberTire', baseColor: [0.07, 0.07, 0.08, 1], metallic: 0.0, roughness: 0.88 });
  const matRim = b.addMaterial({ name: 'AlloyRim', baseColor: [0.78, 0.82, 0.87, 1], metallic: 0.92, roughness: 0.18 });

  const bodyGeo = createGeoAccumulator();
  const trimGeo = createGeoAccumulator();
  const glassGeo = createGeoAccumulator();
  const chromeGeo = createGeoAccumulator();
  const headGeo = createGeoAccumulator();
  const tailGeo = createGeoAccumulator();

  const halfL = length * 0.5;
  const halfW = width * 0.5;

  // Main chassis lower body
  addBoxGeo(bodyGeo, 0, 0.58, 0, width, 0.54, length);
  // Front hood slope block
  addBoxGeo(bodyGeo, 0, 0.88, -halfL * 0.52, width * 0.95, 0.18, length * 0.36);
  // Rear trunk deck
  addBoxGeo(bodyGeo, 0, 0.88, halfL * 0.62, width * 0.94, 0.16, length * 0.24);
  // Cabin roof & pillars
  addBoxGeo(bodyGeo, 0, 0.88 + cabinHeight, 0.12, width * 0.80, 0.08, length * 0.44);
  addBoxGeo(trimGeo, -halfW * 0.78, 0.88 + cabinHeight * 0.5, -0.35, 0.06, cabinHeight, 0.09);
  addBoxGeo(trimGeo, halfW * 0.78, 0.88 + cabinHeight * 0.5, -0.35, 0.06, cabinHeight, 0.09);
  addBoxGeo(trimGeo, -halfW * 0.78, 0.88 + cabinHeight * 0.5, 0.62, 0.08, cabinHeight, 0.14);
  addBoxGeo(trimGeo, halfW * 0.78, 0.88 + cabinHeight * 0.5, 0.62, 0.08, cabinHeight, 0.14);

  // Side mirrors
  addBoxGeo(bodyGeo, -halfW - 0.08, 0.98, -0.58, 0.14, 0.09, 0.12);
  addBoxGeo(bodyGeo, halfW + 0.08, 0.98, -0.58, 0.14, 0.09, 0.12);

  // Cabin glass greenhouse
  addBoxGeo(glassGeo, 0, 0.88 + cabinHeight * 0.5, 0.12, width * 0.78, cabinHeight * 0.86, length * 0.46);

  // Front & rear bumpers, rocker skirts, grille
  addBoxGeo(trimGeo, 0, 0.30, 0, width * 0.96, 0.12, length * 1.01);
  addBoxGeo(trimGeo, 0, 0.55, -halfL - 0.01, width * 0.56, 0.22, 0.05);
  addBoxGeo(chromeGeo, 0, 0.60, -halfL - 0.035, width * 0.58, 0.05, 0.03);
  addBoxGeo(chromeGeo, 0, 0.48, -halfL - 0.035, width * 0.52, 0.04, 0.03);

  // Headlights (front -Z)
  addBoxGeo(headGeo, -halfW * 0.68, 0.68, -halfL - 0.01, 0.36, 0.14, 0.05);
  addBoxGeo(headGeo, halfW * 0.68, 0.68, -halfL - 0.01, 0.36, 0.14, 0.05);

  // Taillights (rear +Z)
  addBoxGeo(tailGeo, -halfW * 0.68, 0.72, halfL + 0.01, 0.38, 0.14, 0.05);
  addBoxGeo(tailGeo, halfW * 0.68, 0.72, halfL + 0.01, 0.38, 0.14, 0.05);

  // Exhaust tips
  addCylinderGeo(chromeGeo, -0.52, 0.25, halfL + 0.03, 0.05, 0.05, 0.14, 10, 'y');
  addCylinderGeo(chromeGeo, 0.52, 0.25, halfL + 0.03, 0.05, 0.05, 0.14, 10, 'y');

  const chassisMeshIdx = b.addMesh(`${name}_Chassis`, [
    { ...bodyGeo, material: matBody },
    { ...trimGeo, material: matTrim },
    { ...glassGeo, material: matGlass },
    { ...chromeGeo, material: matChrome },
    { ...headGeo, material: matHeadlight },
    { ...tailGeo, material: matTaillight },
  ]);

  // Shared Wheel Mesh (centered at 0,0,0, axle along X)
  const tireGeo = createGeoAccumulator();
  const rimGeo = createGeoAccumulator();
  addCylinderGeo(tireGeo, 0, 0, 0, wheelRadius, wheelRadius, 0.24, 20, 'x');
  addCylinderGeo(rimGeo, 0, 0, 0, wheelRadius * 0.64, wheelRadius * 0.64, 0.255, 16, 'x');
  // Spokes on rim so rotation is super visible!
  addBoxGeo(rimGeo, 0, 0, 0, 0.265, wheelRadius * 1.12, 0.05);
  addBoxGeo(rimGeo, 0, 0, 0, 0.265, 0.05, wheelRadius * 1.12);

  const wheelMeshIdx = b.addMesh(`${name}_Wheel`, [
    { ...tireGeo, material: matTire },
    { ...rimGeo, material: matRim },
  ]);

  const wheelX = halfW - 0.08;
  const frontZ = -halfL * 0.60;
  const rearZ = halfL * 0.58;

  const chassisNode = b.addNode({ name: `${name}_Body`, mesh: chassisMeshIdx });
  const wfl = b.addNode({ name: 'wheel_fl', translation: [-wheelX, wheelRadius, frontZ], mesh: wheelMeshIdx });
  const wfr = b.addNode({ name: 'wheel_fr', translation: [wheelX, wheelRadius, frontZ], mesh: wheelMeshIdx });
  const wrl = b.addNode({ name: 'wheel_rl', translation: [-wheelX, wheelRadius, rearZ], mesh: wheelMeshIdx });
  const wrr = b.addNode({ name: 'wheel_rr', translation: [wheelX, wheelRadius, rearZ], mesh: wheelMeshIdx });

  // Named Plate Anchor Nodes
  const plateFront = b.addNode({
    name: 'plate_front',
    translation: [0, 0.39, -halfL - 0.04],
    rotation: quatFromEulerY(Math.PI),
  });
  const plateRear = b.addNode({
    name: 'plate_rear',
    translation: [0, 0.58, halfL + 0.04],
    rotation: [0, 0, 0, 1],
  });

  b.addNode({
    name: `${name}_Root`,
    children: [chassisNode, wfl, wfr, wrl, wrr, plateFront, plateRear],
  }, true);

  return b.build();
}

async function writeIfNeeded(relPath, bufferFn) {
  const fullPath = path.join(MODELS_DIR, relPath);
  if (IF_MISSING) {
    try {
      const st = await fs.stat(fullPath);
      if (st.size > 64) {
        console.log(`[generate-starter-glbs] Keeping existing public/models/${relPath}`);
        return;
      }
    } catch {
      // Missing -> generate
    }
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const buf = bufferFn();
  await fs.writeFile(fullPath, buf);
  console.log(`[generate-starter-glbs] Generated public/models/${relPath} (${buf.byteLength} bytes)`);
}

async function main() {
  await writeIfNeeded('tashkent.glb', buildTashkentTowerGlb);
  await writeIfNeeded('character.glb', buildCharacterGlb);
  await writeIfNeeded('cars/cobalt.glb', () =>
    buildCarGlb({
      name: 'Cobalt',
      bodyColor: [0.95, 0.96, 0.98, 1],
      metallic: 0.45,
      roughness: 0.22,
      length: 4.48,
      width: 1.82,
      cabinHeight: 0.56,
      wheelRadius: 0.34,
    })
  );
  await writeIfNeeded('cars/malibu.glb', () =>
    buildCarGlb({
      name: 'Malibu',
      bodyColor: [0.09, 0.10, 0.13, 1],
      metallic: 0.78,
      roughness: 0.16,
      length: 4.86,
      width: 1.90,
      cabinHeight: 0.50,
      wheelRadius: 0.36,
    })
  );
  await writeIfNeeded('cars/gentra.glb', () =>
    buildCarGlb({
      name: 'Gentra',
      bodyColor: [0.12, 0.28, 0.56, 1],
      metallic: 0.62,
      roughness: 0.20,
      length: 4.52,
      width: 1.78,
      cabinHeight: 0.54,
      wheelRadius: 0.33,
    })
  );
}

main().catch((err) => {
  console.error('[generate-starter-glbs] Error:', err);
  process.exit(1);
});
