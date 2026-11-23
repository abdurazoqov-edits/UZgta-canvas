import * as pc from 'playcanvas';

/**
 * Uzbekistan Davlat Raqami (Custom License Plate) 1024x256 HiDPI Generator
 * Crisp, zero-blur rendering via maximum anisotropy + linear mipmaps.
 */
export function parseUzPlateText(raw) {
  const cleaned = String(raw || '01 A 777 AA')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  const parts = cleaned.split(' ').filter(Boolean);
  const region = (parts[0] || '01').slice(0, 2).padEnd(2, '0');
  const main = parts.length > 1 ? parts.slice(1).join(' ') : 'A 777 AA';
  return { region, main, full: `${region} ${main}` };
}

export function drawUzPlateToCanvas(canvas, rawText) {
  const W = 1024;
  const H = 256;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext('2d');
  const { region, main } = parseUzPlateText(rawText);

  ctx.clearRect(0, 0, W, H);

  // Outer black bezel frame
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0, 0, W, H);

  // Embossed bright reflective aluminum inner plate
  const pad = 12;
  const rx = 20;
  const px = pad;
  const py = pad;
  const pw = W - pad * 2;
  const ph = H - pad * 2;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, rx);
  ctx.clip();

  const bgGrad = ctx.createLinearGradient(0, py, 0, py + ph);
  bgGrad.addColorStop(0, '#FFFFFF');
  bgGrad.addColorStop(0.45, '#F6F8FB');
  bgGrad.addColorStop(1, '#E4E9F0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(px, py, pw, ph);

  // Subtle horizontal metallic micro-sheen
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(px, py + 6, pw, 4);

  // Left Flag + UZ Strip (right side in modern UZ plates? Wait: standard UZ plates have Region on Left, Number Center, Flag+UZ on Right! Let's render authentic UZ layout: [01 | A 777 AA | UZ Flag + UZ])
  const flagZoneW = 112;
  const flagZoneX = px + pw - flagZoneW;

  // Vertical divider before region code (01)
  const regionW = 166;
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(px + regionW, py + 12);
  ctx.lineTo(px + regionW, py + ph - 12);
  ctx.stroke();

  // Uzbekistan Flag on right strip
  const fx = flagZoneX + 18;
  const fy = py + 26;
  const fw = 76;
  const fh = 50;

  // Blue stripe
  ctx.fillStyle = '#0099B5';
  ctx.fillRect(fx, fy, fw, fh * 0.31);
  // Red fimbriation
  ctx.fillStyle = '#CE1126';
  ctx.fillRect(fx, fy + fh * 0.31, fw, fh * 0.04);
  // White stripe
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(fx, fy + fh * 0.35, fw, fh * 0.30);
  // Red fimbriation
  ctx.fillStyle = '#CE1126';
  ctx.fillRect(fx, fy + fh * 0.65, fw, fh * 0.04);
  // Green stripe
  ctx.fillStyle = '#1EB53A';
  ctx.fillRect(fx, fy + fh * 0.69, fw, fh * 0.31);

  // Crescent & stars on flag
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(fx + 14, fy + 8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0099B5';
  ctx.beginPath();
  ctx.arc(fx + 16, fy + 8, 4.2, 0, Math.PI * 2);
  ctx.fill();

  // Flag border
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(fx, fy, fw, fh);

  // Bold "UZ" text below flag
  ctx.fillStyle = '#0077B6';
  ctx.font = '800 54px "Arial Black", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UZ', flagZoneX + flagZoneW * 0.5, py + ph * 0.66);

  // Region Code (e.g. "01")
  ctx.fillStyle = '#090D16';
  ctx.font = '800 132px "Bahnschrift", "DIN Condensed", "Arial Narrow", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region, px + regionW * 0.5, py + ph * 0.54);

  // Main Plate Number (e.g. "A 777 AA" or "777 AAA")
  const mainAreaX = px + regionW + 14;
  const mainAreaW = flagZoneX - mainAreaX - 8;
  let fontSize = 136;
  ctx.font = `800 ${fontSize}px "Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif`;
  while (ctx.measureText(main).width > mainAreaW && fontSize > 68) {
    fontSize -= 4;
    ctx.font = `800 ${fontSize}px "Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif`;
  }

  // Slight embossed drop highlight + crisp black ink
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(main, mainAreaX + mainAreaW * 0.5, py + ph * 0.54 + 2);
  ctx.fillStyle = '#090D16';
  ctx.fillText(main, mainAreaX + mainAreaW * 0.5, py + ph * 0.54);

  // Four corner mounting bolts
  const boltCoords = [
    [px + 26, py + 26],
    [px + pw - 26, py + 26],
    [px + 26, py + ph - 26],
    [px + pw - 26, py + ph - 26],
  ];
  for (const [bx, by] of boltCoords) {
    ctx.fillStyle = '#94A3B8';
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();

  // Inner sharp dark rim
  ctx.strokeStyle = '#0B0E14';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(px + 2, py + 2, pw - 4, ph - 4, rx);
  ctx.stroke();
}

export class LicensePlateSystem {
  constructor(app) {
    this.app = app;
    this._plateCanvas = document.createElement('canvas');
    this._plateCanvas.width = 1024;
    this._plateCanvas.height = 256;
  }

  createPlateSet(plateText) {
    const device = this.app.graphicsDevice;
    drawUzPlateToCanvas(this._plateCanvas, plateText);

    const texture = new pc.Texture(device, {
      name: 'UzLicensePlateTex',
      width: 1024,
      height: 256,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      flipY: false,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      anisotropy: Math.min(16, device.maxAnisotropy || 8),
    });
    texture.setSource(this._plateCanvas);

    const plateMat = new pc.StandardMaterial();
    plateMat.diffuseMap = texture;
    plateMat.emissiveMap = texture;
    plateMat.emissive = new pc.Color(0.28, 0.28, 0.28); // Stays crisp in shadows without blowing out in sun
    plateMat.gloss = 0.42;
    plateMat.metalness = 0.12;
    plateMat.useMetalness = true;
    plateMat.update();

    const bezelMat = new pc.StandardMaterial();
    bezelMat.diffuse = new pc.Color(0.05, 0.06, 0.08);
    bezelMat.gloss = 0.3;
    bezelMat.useMetalness = true;
    bezelMat.update();

    const makePlateAssembly = (name) => {
      const holder = new pc.Entity(name);

      // Thin dark plastic frame backing (52cm x 13cm x 1.6cm)
      const frame = new pc.Entity(`${name}_Frame`);
      frame.addComponent('render', {
        type: 'box',
        castShadows: false,
        receiveShadows: false,
        material: bezelMat,
      });
      frame.setLocalScale(0.54, 0.145, 0.014);
      holder.addChild(frame);

      // Front-facing crisp textured plate face
      const face = new pc.Entity(`${name}_Face`);
      face.addComponent('render', {
        type: 'plane',
        castShadows: false,
        receiveShadows: false,
        material: plateMat,
      });
      face.setLocalPosition(0, 0, 0.0085);
      face.setLocalEulerAngles(90, 0, 0);
      face.setLocalScale(0.52, 1, 0.13);
      holder.addChild(face);

      return holder;
    };

    const frontHolder = makePlateAssembly('PlateFront');
    const rearHolder = makePlateAssembly('PlateRear');

    const updateText = (newText) => {
      drawUzPlateToCanvas(this._plateCanvas, newText);
      texture.upload();
    };

    const destroy = () => {
      try { texture.destroy(); } catch {}
      try { plateMat.destroy(); } catch {}
      try { bezelMat.destroy(); } catch {}
      try { frontHolder.destroy(); } catch {}
      try { rearHolder.destroy(); } catch {}
    };

    return {
      frontHolder,
      rearHolder,
      updateText,
      destroy,
    };
  }
}
