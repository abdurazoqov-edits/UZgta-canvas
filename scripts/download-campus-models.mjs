import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAMPUS_DIR = path.join(ROOT_DIR, 'public', 'models', 'campus');
const BASE_URL = 'https://www.gstatic.com/aistudio/starter-apps/pelican-campus/';

const CAMPUS_SLUGS = [
  'campus_environment_v3',
  'campus_horizon_arch_v5',
  'campus_landmarks_v2',
  'gradient_canopy_v6',
  'props_and_bridge_v6',
  'props_and_finale_v4',
  'trees_v4',
  'android_statues_v2',
  'stan_trex_v5',
  'waymo_gen6_v4',
];

async function ensureSlug(slug) {
  const dest = path.join(CAMPUS_DIR, `${slug}.glb`);
  try {
    const st = await fs.stat(dest);
    if (st.size > 1024) {
      console.log(`[download-campus-models] Cached public/models/campus/${slug}.glb`);
      return;
    }
  } catch {
    // Download if missing
  }

  const url = `${BASE_URL}${slug}.glb`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  console.log(`[download-campus-models] Downloaded public/models/campus/${slug}.glb (${buf.byteLength} bytes)`);
}

async function main() {
  await fs.mkdir(CAMPUS_DIR, { recursive: true });
  await Promise.all(CAMPUS_SLUGS.map(ensureSlug));
}

main().catch((err) => {
  console.error('[download-campus-models] Error:', err);
  process.exit(1);
});
