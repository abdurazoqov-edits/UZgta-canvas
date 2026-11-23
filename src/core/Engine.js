import * as pc from 'playcanvas';

/**
 * Procedural Golden-Hour Tashkent Sky Texture -> Cubemap + IBL EnvAtlas
 * Gives metallic car paint, chrome trim, and windows crisp outdoor reflections.
 */
function createProceduralSkyEquirectTexture(device) {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Atmospheric vertical gradient (Zenith -> Horizon -> Ground bounce)
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0.0, '#133C75');   // Deep azure zenith
  grad.addColorStop(0.28, '#2D6FB7');  // Mid sky blue
  grad.addColorStop(0.45, '#7EB7DF');  // Bright daylight sky
  grad.addColorStop(0.50, '#F6DEC1');  // Warm golden horizon haze
  grad.addColorStop(0.54, '#C8B8A4');  // Urban horizon bounce
  grad.addColorStop(0.75, '#4A4E57');  // Asphalt bounce
  grad.addColorStop(1.0, '#232730');   // Deep ground
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle sunlit clouds band
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const cx = ((i * 73) % width);
    const cy = height * (0.28 + ((i * 19) % 16) * 0.01);
    const rx = 28 + (i % 5) * 16;
    const ry = 5 + (i % 3) * 4;
    const cGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
    cGrad.addColorStop(0, 'rgba(255, 246, 234, 0.34)');
    cGrad.addColorStop(1, 'rgba(255, 246, 234, 0.0)');
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Warm sun glow & disc (aligned roughly with directional sun vector)
  const sunX = width * 0.68;
  const sunY = height * 0.35;
  const sunHalo = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 72);
  sunHalo.addColorStop(0.0, 'rgba(255, 252, 238, 1.0)');
  sunHalo.addColorStop(0.14, 'rgba(255, 232, 185, 0.85)');
  sunHalo.addColorStop(0.42, 'rgba(255, 198, 130, 0.25)');
  sunHalo.addColorStop(1.0, 'rgba(255, 198, 130, 0.0)');
  ctx.fillStyle = sunHalo;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 72, 0, Math.PI * 2);
  ctx.fill();

  const tex = new pc.Texture(device, {
    name: 'TashkentSkyEquirect',
    width,
    height,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
  });
  tex.setSource(canvas);
  return tex;
}

export class GameEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    this.baseMaxDpr = this.isMobile ? 1.35 : 1.75;
    this.adaptiveLowPower = false;

    this._fpsTimer = 0;
    this._fpsFrames = 0;
    this._lowFpsStreak = 0;
    this._disposables = [];

    // Initialize Draco decoder lazily (used automatically if any .glb uses KHR_draco_mesh_compression)
    try {
      pc.dracoInitialize({
        jsUrl: './draco/draco_wasm_wrapper.js',
        wasmUrl: './draco/draco_decoder.wasm',
        numWorkers: 1,
        lazyInit: true,
      });
    } catch (err) {
      console.warn('[Engine] Draco lazyInit skipped:', err);
    }

    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        preferWebGl2: true,
      },
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
    });

    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, this.baseMaxDpr);

    // Setup scene HDR lighting, skybox, IBL reflections, and fog
    this._setupEnvironment();

    // Setup main camera with ACES Filmic Tone Mapping
    this.cameraEntity = new pc.Entity('MainCamera');
    this.cameraEntity.addComponent('camera', {
      clearColor: new pc.Color(0.45, 0.65, 0.85),
      fov: 58,
      nearClip: 0.25,
      farClip: 620,
      frustumCulling: true,
      toneMapping: pc.TONEMAP_ACES2,
      gammaCorrection: pc.GAMMA_SRGB,
    });
    this.app.root.addChild(this.cameraEntity);

    // Setup directional sun with moving shadow frustum
    this.sunLight = new pc.Entity('SunLight');
    this.sunLight.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1.0, 0.94, 0.84),
      intensity: 2.35,
      castShadows: true,
      shadowResolution: this.isMobile ? 1024 : 2048,
      shadowDistance: 95,
      shadowType: pc.SHADOW_PCF3_32F,
      shadowBias: 0.25,
      normalOffsetBias: 0.05,
      shadowUpdateMode: pc.SHADOWUPDATE_REALTIME,
      affectDynamic: true,
      affectLightmapped: true,
    });
    this.sunLight.setEulerAngles(48, 38, 0);
    this.app.root.addChild(this.sunLight);

    // Soft sky/ground fill light (no shadow cost)
    this.fillLight = new pc.Entity('SkyFillLight');
    this.fillLight.addComponent('light', {
      type: 'directional',
      color: new pc.Color(0.62, 0.78, 1.0),
      intensity: 0.45,
      castShadows: false,
    });
    this.fillLight.setEulerAngles(-35, -140, 0);
    this.app.root.addChild(this.fillLight);

    this._onResize = () => this.app.resizeCanvas();
    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('orientationchange', this._onResize, { passive: true });

    this._onContextLost = (e) => {
      e.preventDefault();
      console.warn('[Engine] WebGL context lost — pausing render loop.');
    };
    this._onContextRestored = () => {
      console.info('[Engine] WebGL context restored.');
      this.app.resizeCanvas();
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    this.app.start();
  }

  _setupEnvironment() {
    const device = this.app.graphicsDevice;
    const equirect = createProceduralSkyEquirectTexture(device);
    const skyboxCubemap = pc.EnvLighting.generateSkyboxCubemap(equirect, 512);
    const lightingSource = pc.EnvLighting.generateLightingSource(equirect, { size: 128 });
    const envAtlas = pc.EnvLighting.generateAtlas(lightingSource, {
      size: 512,
      numReflectionSamples: 512,
      numAmbientSamples: 512,
    });

    // Clean intermediate equirect & lighting source to save mobile VRAM
    equirect.destroy();
    lightingSource.destroy();

    this._disposables.push(skyboxCubemap, envAtlas);

    const scene = this.app.scene;
    scene.skybox = skyboxCubemap;
    scene.envAtlas = envAtlas;
    scene.sky.type = pc.SKYTYPE_INFINITE;
    scene.skyboxIntensity = 1.15;
    scene.ambientLight = new pc.Color(0.24, 0.28, 0.36);
    scene.exposure = 1.12;

    // Subtle distance haze matching horizon color
    scene.fog.type = pc.FOG_EXP2;
    scene.fog.color = new pc.Color(0.76, 0.78, 0.80);
    scene.fog.density = 0.0020;
  }

  /**
   * Adaptive 60 FPS safeguard for mid-range Android GPUs.
   */
  updatePerformanceGovernor(dt) {
    this._fpsTimer += dt;
    this._fpsFrames += 1;
    if (this._fpsTimer < 2.0) return;

    const avgFps = this._fpsFrames / this._fpsTimer;
    this._fpsTimer = 0;
    this._fpsFrames = 0;

    if (avgFps < 40 && !this.adaptiveLowPower) {
      this._lowFpsStreak += 1;
      if (this._lowFpsStreak >= 2) {
        this.adaptiveLowPower = true;
        this.app.graphicsDevice.maxPixelRatio = 1.0;
        if (this.sunLight?.light) {
          this.sunLight.light.shadowResolution = 1024;
          this.sunLight.light.shadowDistance = 70;
        }
        this.app.resizeCanvas();
      }
    } else {
      this._lowFpsStreak = 0;
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    for (const res of this._disposables) {
      try { res.destroy(); } catch {}
    }
    this._disposables = [];
    this.app.destroy();
  }
}
