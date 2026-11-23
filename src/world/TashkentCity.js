import * as pc from 'playcanvas';

/**
 * Procedural PBR Ground Textures (Asphalt, Sidewalk Pavers, Plaza Travertine)
 * Combined with the authentic high-detail GLB buildings, trees, landmarks, bridges,
 * statues, and street furniture from the Mountain View / Pelican Campus world +
 * Tashkent TV Tower (tashkent.glb) in the central plaza.
 */
function makeCanvasTexture(device, width, height, drawFn, repeatU = 1, repeatV = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawFn(canvas.getContext('2d'), width, height);

  const tex = new pc.Texture(device, {
    width,
    height,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: repeatU > 1 ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: repeatV > 1 ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    anisotropy: Math.min(8, device.maxAnisotropy || 4),
  });
  tex.setSource(canvas);
  return tex;
}

function createAsphaltTexture(device) {
  return makeCanvasTexture(device, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#242830';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6500; i++) {
      const x = (i * 97) % w;
      const y = (i * 53 + Math.floor(i / 7) * 19) % h;
      const shade = 27 + (i % 24);
      ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.fillStyle = 'rgba(10, 12, 16, 0.20)';
    ctx.fillRect(w * 0.18, 0, w * 0.16, h);
    ctx.fillRect(w * 0.66, 0, w * 0.16, h);
  }, 24, 24);
}

function createSidewalkTexture(device) {
  return makeCanvasTexture(device, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#A3ACB6';
    ctx.fillRect(0, 0, w, h);
    const step = 32;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const alt = ((x / step + y / step) % 2) === 0 ? 166 : 156;
        ctx.fillStyle = `rgb(${alt},${alt + 4},${alt + 8})`;
        ctx.fillRect(x + 1, y + 1, step - 2, step - 2);
      }
    }
  }, 6, 6);
}

function createPlazaTileTexture(device) {
  return makeCanvasTexture(device, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#D5CCB9';
    ctx.fillRect(0, 0, w, h);
    const s = 64;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = ((x / s + y / s) % 2 === 0) ? '#DDD5C4' : '#CFC5B1';
        ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
      }
    }
  }, 8, 8);
}

export class TashkentCity {
  constructor(app, modelLoader) {
    this.app = app;
    this.modelLoader = modelLoader;
    this.root = new pc.Entity('CityWorldRoot');
    this.colliders = [];
    this._textures = [];
    this._materials = [];
    this._prototypes = new Map();
    this._spinners = [];
    this._packRoots = [];
  }

  _trackMat(mat) {
    this._materials.push(mat);
    return mat;
  }

  _makeRoadStrip(name, pos, scale, mat) {
    const e = new pc.Entity(name);
    e.addComponent('render', { type: 'box', material: mat, castShadows: false, receiveShadows: false });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalScale(scale[0], scale[1], scale[2]);
    this.root.addChild(e);
    return e;
  }

  _makePad(name, type, pos, scale, mat) {
    const e = new pc.Entity(name);
    e.addComponent('render', { type, material: mat, castShadows: false, receiveShadows: true });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalScale(scale[0], scale[1], scale[2]);
    this.root.addChild(e);
    return e;
  }

  async _loadPackPrototypes(url) {
    try {
      const asset = await this.modelLoader.loadContainer(url);
      const containerEntity = asset.resource.instantiateRenderEntity({
        castShadows: true,
        receiveShadows: true,
      });
      this._packRoots.push(containerEntity);

      // Register every named direct child of the container root (and named assemblies)
      const queue = [...(containerEntity.children || [])];
      for (const node of queue) {
        if (node.name) {
          this._prototypes.set(node.name, node);
        }
        // Also index immediate sub-nodes if needed (e.g. Stan_Body_V5, Pinwheel rotors)
        for (const ch of (node.children || [])) {
          if (ch.name && !this._prototypes.has(ch.name)) {
            this._prototypes.set(ch.name, ch);
          }
        }
      }
    } catch (err) {
      console.warn(`[TashkentCity] Skipped optional pack ${url}:`, err);
    }
  }

  _placeProto(protoName, x, y, z, yawDeg = 0, scale = 1, colliderRadius = 0, colliderBox = null) {
    const proto = this._prototypes.get(protoName);
    if (!proto) return null;

    const instance = proto.clone();
    instance.setPosition(x, y, z);
    instance.setEulerAngles(0, yawDeg, 0);
    if (scale !== 1) {
      const s = instance.getLocalScale();
      instance.setLocalScale(s.x * scale, s.y * scale, s.z * scale);
    }
    this.root.addChild(instance);

    // Collect animated pinwheel rotors if present
    const allNodes = [instance];
    const collect = (n) => {
      for (const c of (n.children || [])) {
        allNodes.push(c);
        collect(c);
      }
    };
    collect(instance);
    for (const n of allNodes) {
      if (/Origami_Pinwheel_Rotor/i.test(n.name || '')) {
        this._spinners.push(n);
      }
    }

    if (colliderBox) {
      const [hw, hd] = colliderBox;
      this.colliders.push({
        type: 'aabb',
        minX: x - hw,
        maxX: x + hw,
        minZ: z - hd,
        maxZ: z + hd,
      });
    } else if (colliderRadius > 0) {
      this.colliders.push({ type: 'circle', x, z, r: colliderRadius });
    }

    return instance;
  }

  async build() {
    const device = this.app.graphicsDevice;

    const asphaltTex = createAsphaltTexture(device);
    const sidewalkTex = createSidewalkTexture(device);
    const plazaTex = createPlazaTileTexture(device);
    this._textures.push(asphaltTex, sidewalkTex, plazaTex);

    const asphaltMat = this._trackMat(new pc.StandardMaterial());
    asphaltMat.diffuseMap = asphaltTex;
    asphaltMat.gloss = 0.24;
    asphaltMat.useMetalness = true;
    asphaltMat.metalness = 0.04;
    asphaltMat.update();

    const sidewalkMat = this._trackMat(new pc.StandardMaterial());
    sidewalkMat.diffuseMap = sidewalkTex;
    sidewalkMat.gloss = 0.16;
    sidewalkMat.useMetalness = true;
    sidewalkMat.update();

    const curbMat = this._trackMat(new pc.StandardMaterial());
    curbMat.diffuse = new pc.Color(0.70, 0.72, 0.75);
    curbMat.gloss = 0.20;
    curbMat.useMetalness = true;
    curbMat.update();

    const plazaMat = this._trackMat(new pc.StandardMaterial());
    plazaMat.diffuseMap = plazaTex;
    plazaMat.gloss = 0.34;
    plazaMat.useMetalness = true;
    plazaMat.update();

    const lawnMat = this._trackMat(new pc.StandardMaterial());
    lawnMat.diffuse = new pc.Color(0.20, 0.42, 0.21);
    lawnMat.gloss = 0.10;
    lawnMat.useMetalness = true;
    lawnMat.update();

    const waterMat = this._trackMat(new pc.StandardMaterial());
    waterMat.diffuse = new pc.Color(0.08, 0.56, 0.72);
    waterMat.gloss = 0.92;
    waterMat.metalness = 0.35;
    waterMat.useMetalness = true;
    waterMat.update();

    const uzDomeMat = this._trackMat(new pc.StandardMaterial());
    uzDomeMat.diffuse = new pc.Color(0.08, 0.58, 0.78);
    uzDomeMat.gloss = 0.65;
    uzDomeMat.metalness = 0.45;
    uzDomeMat.useMetalness = true;
    uzDomeMat.update();

    const whiteLineMat = this._trackMat(new pc.StandardMaterial());
    whiteLineMat.diffuse = new pc.Color(0.93, 0.95, 0.97);
    whiteLineMat.emissive = new pc.Color(0.10, 0.10, 0.10);
    whiteLineMat.update();

    const yellowLineMat = this._trackMat(new pc.StandardMaterial());
    yellowLineMat.diffuse = new pc.Color(0.95, 0.74, 0.14);
    yellowLineMat.emissive = new pc.Color(0.10, 0.08, 0.01);
    yellowLineMat.update();

    // 1. Ground Asphalt + Distant Green Valley Floor
    this._makePad('OuterValleyLawn', 'plane', [0, -0.04, 0], [920, 1, 920], lawnMat);
    this._makePad('CityAsphaltGround', 'plane', [0, 0, 0], [440, 1, 440], asphaltMat);

    // 2. Road Grid & Crosswalks (streets at -120, -60, 0, 60, 120; width 18m)
    const roadCoords = [-120, -60, 0, 60, 120];
    this._buildRoadMarkings(roadCoords, 9.0, whiteLineMat, yellowLineMat);

    // 3. Central Plaza (radius 24m) + Sidewalk Blocks
    this._buildCentralPlaza(plazaMat, curbMat, waterMat, lawnMat, uzDomeMat);
    this._buildSidewalkPads(sidewalkMat, curbMat);

    // 4. Load ALL authentic high-detail GLB city packs from previous bicycle game
    await Promise.all([
      this._loadPackPrototypes('./models/campus/gradient_canopy_v6.glb'),
      this._loadPackPrototypes('./models/campus/campus_horizon_arch_v5.glb'),
      this._loadPackPrototypes('./models/campus/campus_environment_v3.glb'),
      this._loadPackPrototypes('./models/campus/campus_landmarks_v2.glb'),
      this._loadPackPrototypes('./models/campus/props_and_bridge_v6.glb'),
      this._loadPackPrototypes('./models/campus/props_and_finale_v4.glb'),
      this._loadPackPrototypes('./models/campus/trees_v4.glb'),
      this._loadPackPrototypes('./models/campus/android_statues_v2.glb'),
      this._loadPackPrototypes('./models/campus/stan_trex_v5.glb'),
    ]);

    // 5. Place Detailed Buildings, Landmarks, Statues, Trees, Streetlamps, Bridges & Ramps
    this._populateCampusAndCityDistricts();

    // 6. Mount Tashkent TV Tower (public/models/tashkent.glb) in the exact center of the Plaza
    await this._mountTashkentTower();

    this.app.root.addChild(this.root);
    return this;
  }

  _buildRoadMarkings(roadCoords, roadHalfW, whiteLineMat, yellowLineMat) {
    for (const coord of roadCoords) {
      for (let seg = -195; seg <= 195; seg += 12) {
        const inInter = roadCoords.some((rc) => Math.abs(seg - rc) < roadHalfW + 2);
        if (!inInter && Math.hypot(coord, seg) > 27) {
          this._makeRoadStrip('YLZ1', [coord - 0.16, 0.014, seg], [0.14, 0.02, 10.5], yellowLineMat);
          this._makeRoadStrip('YLZ2', [coord + 0.16, 0.014, seg], [0.14, 0.02, 10.5], yellowLineMat);
          this._makeRoadStrip('WLZL', [coord - 4.4, 0.014, seg], [0.14, 0.02, 4.2], whiteLineMat);
          this._makeRoadStrip('WLZR', [coord + 4.4, 0.014, seg], [0.14, 0.02, 4.2], whiteLineMat);
        }
        if (!inInter && Math.hypot(seg, coord) > 27) {
          this._makeRoadStrip('YLX1', [seg, 0.014, coord - 0.16], [10.5, 0.02, 0.14], yellowLineMat);
          this._makeRoadStrip('YLX2', [seg, 0.014, coord + 0.16], [10.5, 0.02, 0.14], yellowLineMat);
          this._makeRoadStrip('WLXL', [seg, 0.014, coord - 4.4], [4.2, 0.02, 0.14], whiteLineMat);
          this._makeRoadStrip('WLXR', [seg, 0.014, coord + 4.4], [4.2, 0.02, 0.14], whiteLineMat);
        }
      }
    }

    for (const ix of [-60, 0, 60]) {
      for (const iz of [-60, 0, 60]) {
        if (ix === 0 && iz === 0) continue;
        for (let s = -7; s <= 7; s += 1.75) {
          this._makeRoadStrip('ZebraN', [ix + s, 0.016, iz - 10.2], [0.75, 0.02, 2.4], whiteLineMat);
          this._makeRoadStrip('ZebraS', [ix + s, 0.016, iz + 10.2], [0.75, 0.02, 2.4], whiteLineMat);
          this._makeRoadStrip('ZebraW', [ix - 10.2, 0.016, iz + s], [2.4, 0.02, 0.75], whiteLineMat);
          this._makeRoadStrip('ZebraE', [ix + 10.2, 0.016, iz + s], [2.4, 0.02, 0.75], whiteLineMat);
        }
      }
    }
  }

  _buildCentralPlaza(plazaMat, curbMat, waterMat, lawnMat, uzDomeMat) {
    this._makePad('PlazaBase', 'cylinder', [0, 0.09, 0], [46, 0.18, 46], plazaMat);
    this._makePad('PlazaCurb', 'cylinder', [0, 0.14, 0], [46.8, 0.12, 46.8], curbMat);
    this._makePad('PlazaWaterRing', 'cylinder', [0, 0.19, 0], [28, 0.08, 28], waterMat);
    this._makePad('PlazaInnerPad', 'cylinder', [0, 0.24, 0], [21.6, 0.12, 21.6], plazaMat);
    this._makePad('PlazaTurquoiseTrim', 'cylinder', [0, 0.30, 0], [22.2, 0.06, 22.2], uzDomeMat);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      this._makePad(`PlazaLawn_${i}`, 'cylinder', [Math.cos(a) * 18.2, 0.21, Math.sin(a) * 18.2], [5.4, 0.10, 5.4], lawnMat);
    }

    this.colliders.push({ type: 'circle', x: 0, z: 0, r: 9.2 });
  }

  _buildSidewalkPads(sidewalkMat, curbMat) {
    const blockCenters = [-90, -30, 30, 90];
    const size = 40;
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        this._makePad(`SW_${bx}_${bz}`, 'box', [bx, 0.07, bz], [size, 0.14, size], sidewalkMat);
        this._makePad(`CBN_${bx}_${bz}`, 'box', [bx, 0.09, bz - size * 0.5], [size + 0.4, 0.18, 0.4], curbMat);
        this._makePad(`CBS_${bx}_${bz}`, 'box', [bx, 0.09, bz + size * 0.5], [size + 0.4, 0.18, 0.4], curbMat);
        this._makePad(`CBW_${bx}_${bz}`, 'box', [bx - size * 0.5, 0.09, bz], [0.4, 0.18, size], curbMat);
        this._makePad(`CBE_${bx}_${bz}`, 'box', [bx + size * 0.5, 0.09, bz], [0.4, 0.18, size], curbMat);
      }
    }
  }

  _populateCampusAndCityDistricts() {
    // 1. ICONIC ARCHITECTURAL BUILDINGS ON CITY BLOCKS (Zero simple boxes!)
    // North-West Hero Block (-34, -34): Gradient Canopy Building (58m x 38m scaled slightly to fit block cleanly)
    this._placeProto('Gradient_Canopy_Building_V6', -35, 0.14, -35, 0, 0.65, 0, [18.5, 13.0]);

    // North-East Block (35, -35): Bay View Canopy Pavilion
    this._placeProto('Bay_View_Canopy_Pavilion_V6', 35, 0.14, -35, -90, 0.60, 0, [11.5, 18.0]);

    // South-West Block (-34, 34): Campus Office Pavilion V6 (Limestone & Terracotta Louvers)
    this._placeProto('Campus_Office_Pavilion_V6', -34, 0.14, 34, 45, 0.85, 0, [14.0, 12.5]);

    // South-East Block (34, 34): Campus Office Pavilion V5 + Courtyard Cafe & Stan T-Rex Plaza!
    this._placeProto('Campus_Office_Pavilion_V5', 36, 0.14, 36, -135, 0.82, 0, [13.5, 12.0]);
    this._placeProto('Stan_Plinth_V5', 22, 0.14, 23, -45, 1.0, 2.4);
    this._placeProto('Stan_Body_V5', 22, 0.70, 23, -45, 1.0, 0);

    // Outer Ring Architectural District Blocks (±90, ±30 and ±90, ±90)
    // West Shoreline Amphitheatre District (-90, -30)
    this._placeProto('Shoreline_Tensile_Bowl_V2', -92, 0.14, -30, 90, 0.72, 0, [14.0, 19.0]);
    this._placeProto('Shoreline_Monument_Sign_V2', -72, 0.14, -30, 90, 0.85, 2.8);

    // East Modern Glass & Office Wings
    this._placeProto('Bldg_ModernGlass_Wing_V3', 90, 0.14, -30, 0, 1.0, 0, [16.0, 9.2]);
    this._placeProto('Campus_Office_Pavilion_V6', 90, 0.14, 30, 180, 0.92, 0, [16.5, 12.0]);
    this._placeProto('Gradient_Canopy_Building_V6', -90, 0.14, 30, 90, 0.65, 0, [13.0, 18.5]);
    this._placeProto('Bldg_ModernGlass_Wing_V3', -30, 0.14, -90, 90, 1.0, 0, [9.2, 16.0]);
    this._placeProto('Bay_View_Canopy_Pavilion_V6', 30, 0.14, -90, 0, 0.62, 0, [18.5, 11.0]);
    this._placeProto('Campus_Office_Pavilion_V5', -30, 0.14, 90, 0, 0.95, 0, [17.0, 12.5]);
    this._placeProto('Bldg_ModernGlass_Wing_V3', 30, 0.14, 90, 180, 1.0, 0, [16.0, 9.2]);

    // Four Outer Corner Blocks (±90, ±90)
    this._placeProto('Campus_Office_Pavilion_V6', -90, 0.14, -90, 45, 0.92, 0, [16.0, 12.5]);
    this._placeProto('Bay_View_Canopy_Pavilion_V6', 90, 0.14, -90, -45, 0.62, 0, [16.0, 12.0]);
    this._placeProto('Shoreline_Tensile_Bowl_V2', 90, 0.14, 90, -90, 0.72, 0, [14.0, 18.5]);
    this._placeProto('Gradient_Canopy_Building_V6', -90, 0.14, 90, 180, 0.66, 0, [18.5, 13.0]);

    // 2. ANDROID SCULPTURE GARDEN & MONUMENTS (Around Central Plaza & Sidewalks)
    const statues = [
      ['Bugdroid_V2', -16.5, 16.5, 45],
      ['Statue_Donut_V2', 16.5, 16.5, -45],
      ['Statue_Cupcake_V2', -16.5, -16.5, 135],
      ['Statue_Lollipop_V2', 16.5, -16.5, -135],
      ['Statue_KitKat_V2', -22, 42, 0],
      ['Statue_Gingerbread_V2', 22, -42, 180],
    ];
    for (const [name, sx, sz, syaw] of statues) {
      this._placeProto(name, sx, 0.18, sz, syaw, 1.0, 1.4);
    }

    // Gemini Carbon Monument & TPU Supercluster Rack Showcase
    this._placeProto('Gemini4_Carbon_Monument_V4', 0, 0.14, -46, 0, 0.75, 0, [6.5, 1.2]);
    this._placeProto('TPU_Supercluster_Rack_V4', -14, 0.14, 46, 0, 1.15, 1.0);
    this._placeProto('TPU_Supercluster_Rack_V4', 14, 0.14, 46, 0, 1.15, 1.0);

    // 3. STEVENS CREEK BRIDGE & STUNT JUMP RAMPS (along Outer Boulevards!)
    this._placeProto('Stevens_Creek_Bridge_V6', -156, 0, 0, 0, 1.0, 0);
    this._placeProto('Campus_Jump_Ramp_V6', 0, 0, 78, 0, 1.15, 0);
    this._placeProto('Campus_Landing_Ramp_V8', 0, 0, 56, 180, 1.15, 0);
    this._placeProto('Campus_Jump_Ramp_V6', 78, 0, 0, -90, 1.15, 0);

    // 4. CAFE SETS, SNACK CARTS, UMBRELLAS, BENCHES, BIKE RACKS & LANDSCAPE BERMS
    const cafeSpots = [
      [-18, 22, 20],
      [18, -22, -20],
      [-23, -18, 45],
      [25, 42, 0],
    ];
    for (const [cx, cz, cyaw] of cafeSpots) {
      this._placeProto('Campus_Umbrella_Cafe_Set_V6', cx, 0.14, cz, cyaw, 1.0, 1.3);
      this._placeProto('Campus_Bench_V4', cx + 3.2, 0.14, cz, cyaw + 90, 1.0, 0.8);
    }
    this._placeProto('Campus_Snack_Cart_V6', -24, 0.14, 24, 135, 1.0, 1.6);
    this._placeProto('Campus_Bike_Rack_V4', 24, 0.14, -24, 45, 1.0, 1.1);

    // Landscape Berms & Hedges along main plaza edges
    for (const [bx, bz, byaw] of [
      [-30, -49, 0], [30, -49, 0], [-30, 49, 180], [30, 49, 180],
      [-49, -30, 90], [-49, 30, 90], [49, -30, -90], [49, 30, -90],
    ]) {
      this._placeProto('Courtyard_Landscape_Berm_V6', bx, 0.14, bz, byaw, 0.85, 0, [7.2, 2.5]);
    }

    // 5. COAST LIVE OAK & COAST REDWOOD TREES + MODERN STREETLAMPS + TRAFFIC MASTS
    const blockCenters = [-90, -30, 30, 90];
    let treeSeed = 0;
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        const corners = [
          [bx - 17.5, bz - 17.5],
          [bx + 17.5, bz - 17.5],
          [bx - 17.5, bz + 17.5],
          [bx + 17.5, bz + 17.5],
        ];
        for (let i = 0; i < corners.length; i++) {
          const [tx, tz] = corners[i];
          if (Math.hypot(tx, tz) < 26) continue;
          const isRedwood = (treeSeed++ % 3) === 0;
          this._placeProto(
            isRedwood ? 'Tree_CoastRedwood_V4' : 'Tree_CoastLiveOak_V4',
            tx,
            0.14,
            tz,
            (treeSeed * 57) % 360,
            isRedwood ? 0.88 : 0.92,
            0.55
          );
        }
        // Street Lamps along sidewalk midpoints
        if (Math.hypot(bx - 18.5, bz) > 26) {
          this._placeProto('Street_Lamp_Modern_V3', bx - 18.5, 0.14, bz, 90, 1.0, 0.3);
        }
        if (Math.hypot(bx + 18.5, bz) > 26) {
          this._placeProto('Street_Lamp_Modern_V3', bx + 18.5, 0.14, bz, -90, 1.0, 0.3);
        }
      }
    }

    // Traffic Masts at major intersections
    for (const [mx, mz, myaw] of [
      [-11, -49, 0], [11, 49, 180], [-49, 11, 90], [49, -11, -90],
      [-71, -49, 0], [71, 49, 180],
    ]) {
      this._placeProto('Traffic_Mast_V4', mx, 0.14, mz, myaw, 1.0, 0.4);
    }

    // 6. SANTA CRUZ MOUNTAIN RIDGELINE HORIZON ARC (surrounding distant backdrop)
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const dist = 255;
      const yaw = (ang * 180) / Math.PI + 180;
      this._placeProto('Santa_Cruz_Ridgeline_Arc_V5', Math.sin(ang) * dist, -1.0, Math.cos(ang) * dist, yaw, 2.3, 0);
    }
  }

  async _mountTashkentTower() {
    try {
      const tower = await this.modelLoader.instantiateGrounded('./models/tashkent.glb', {
        castShadows: true,
        receiveShadows: true,
        targetHeight: 118,
        yawOffsetDeg: 0,
      });
      tower.root.setPosition(0, 0.28, 0);
      this.root.addChild(tower.root);
    } catch (err) {
      console.error('[TashkentCity] Failed to load ./models/tashkent.glb:', err);
    }
  }

  update(dt) {
    // Rotate Gradient Canopy origami wind pinwheels smoothly
    for (let i = 0; i < this._spinners.length; i++) {
      this._spinners[i].rotateLocal(0, 0, dt * 65);
    }
  }

  destroy() {
    this.root.destroy();
    for (const p of this._packRoots) {
      try { p.destroy(); } catch {}
    }
    for (const m of this._materials) {
      try { m.destroy(); } catch {}
    }
    for (const t of this._textures) {
      try { t.destroy(); } catch {}
    }
  }
}
