import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(ROOT_DIR, 'android');
const MANIFEST_PATH = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');

async function patchAndroidManifest() {
  let xml = await fs.readFile(MANIFEST_PATH, 'utf8');

  // Ensure hardwareAccelerated="true" and largeHeap="true" on <application>
  if (!xml.includes('android:hardwareAccelerated')) {
    xml = xml.replace(
      '<application',
      '<application\n        android:hardwareAccelerated="true"\n        android:largeHeap="true"'
    );
  } else {
    xml = xml.replace(/android:hardwareAccelerated="[^"]*"/g, 'android:hardwareAccelerated="true"');
  }

  // Ensure landscape orientation & hardware acceleration on MainActivity
  if (!xml.includes('android:screenOrientation')) {
    xml = xml.replace(
      'android:name=".MainActivity"',
      'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"\n            android:hardwareAccelerated="true"'
    );
  }

  await fs.writeFile(MANIFEST_PATH, xml, 'utf8');
  console.log('[configure-android] Patched AndroidManifest.xml with hardwareAccelerated=true & sensorLandscape.');
}

async function patchMainActivityImmersive() {
  const javaRoot = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java');
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(full);
        if (found) return found;
      } else if (entry.name === 'MainActivity.java') {
        return full;
      }
    }
    return null;
  };

  const mainActivityPath = await walk(javaRoot);
  if (!mainActivityPath) return;

  let code = await fs.readFile(mainActivityPath, 'utf8');
  if (code.includes('WindowInsetsControllerCompat') || code.includes('SYSTEM_UI_FLAG_FULLSCREEN')) {
    return;
  }

  const imports = `import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
`;

  code = code.replace(
    'import com.getcapacitor.BridgeActivity;',
    `import com.getcapacitor.BridgeActivity;\n${imports}`
  );

  const onCreatePatch = `public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), decorView);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}`;

  code = code.replace(/public class MainActivity extends BridgeActivity\s*\{[\s\S]*?\}/, onCreatePatch);
  await fs.writeFile(mainActivityPath, code, 'utf8');
  console.log('[configure-android] Patched MainActivity.java for fullscreen immersive mode.');
}

async function main() {
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    console.warn('[configure-android] android/ folder not found yet. Run "npx cap add android" first.');
    process.exit(0);
  }
  await patchAndroidManifest();
  await patchMainActivityImmersive();
}

main().catch((err) => {
  console.error('[configure-android] Error:', err);
  process.exit(1);
});
