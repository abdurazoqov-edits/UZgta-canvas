import * as pc from 'playcanvas';

/**
 * ModelLoader
 * Offline-safe GLB loader with resource caching, bounding-box inspection,
 * automatic grounding (y=0), and optional length normalization.
 */
export class ModelLoader {
  constructor(app) {
    this.app = app;
    this._cache = new Map();
    this._scratchBbox = new pc.BoundingBox();
  }

  loadContainer(url) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }

    const promise = new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(url, 'container', (err, asset) => {
        if (err || !asset || !asset.resource) {
          this._cache.delete(url);
          reject(err || new Error(`Failed to load GLB: ${url}`));
          return;
        }
        resolve(asset);
      });
    });

    this._cache.set(url, promise);
    return promise;
  }

  computeEntityBounds(entity) {
    const renders = entity.findComponents('render');
    const bounds = new pc.BoundingBox();
    let initialized = false;

    for (let i = 0; i < renders.length; i++) {
      const meshInstances = renders[i].meshInstances;
      for (let j = 0; j < meshInstances.length; j++) {
        const mi = meshInstances[j];
        if (!mi.aabb) continue;
        if (!initialized) {
          bounds.copy(mi.aabb);
          initialized = true;
        } else {
          bounds.add(mi.aabb);
        }
      }
    }

    if (!initialized) {
      bounds.center.set(0, 0.5, 0);
      bounds.halfExtents.set(0.5, 0.5, 0.5);
    }
    return bounds;
  }

  /**
   * Instantiates a GLB into a grounded pivot entity so lowest point sits at y = 0,
   * optionally scaling to match targetLength (max horizontal dimension) or targetHeight.
   */
  async instantiateGrounded(url, options = {}) {
    const {
      castShadows = true,
      receiveShadows = true,
      targetLength = null,
      targetHeight = null,
      yawOffsetDeg = 0,
    } = options;

    const asset = await this.loadContainer(url);
    const root = new pc.Entity('GroundedModelRoot');
    const pivot = new pc.Entity('ModelPivot');
    const modelEntity = asset.resource.instantiateRenderEntity({
      castShadows,
      receiveShadows,
    });

    pivot.addChild(modelEntity);
    root.addChild(pivot);

    if (yawOffsetDeg) {
      pivot.setLocalEulerAngles(0, yawOffsetDeg, 0);
    }

    // Force world transform update before measuring AABB
    root.syncHierarchy();
    let bounds = this.computeEntityBounds(modelEntity);

    let scaleFactor = 1.0;
    const sizeX = bounds.halfExtents.x * 2;
    const sizeY = bounds.halfExtents.y * 2;
    const sizeZ = bounds.halfExtents.z * 2;

    if (targetLength && Math.max(sizeX, sizeZ) > 0.001) {
      scaleFactor = targetLength / Math.max(sizeX, sizeZ);
    } else if (targetHeight && sizeY > 0.001) {
      scaleFactor = targetHeight / sizeY;
    }

    if (Math.abs(scaleFactor - 1.0) > 0.001) {
      pivot.setLocalScale(scaleFactor, scaleFactor, scaleFactor);
      root.syncHierarchy();
      bounds = this.computeEntityBounds(modelEntity);
    }

    // Shift pivot so min.y sits at y=0 and horizontal center is at (0, 0)
    const minY = bounds.center.y - bounds.halfExtents.y;
    const pos = pivot.getLocalPosition();
    pivot.setLocalPosition(pos.x - bounds.center.x, pos.y - minY, pos.z - bounds.center.z);
    root.syncHierarchy();

    return {
      root,
      pivot,
      modelEntity,
      containerAsset: asset,
      bounds: this.computeEntityBounds(modelEntity),
      scaleFactor,
    };
  }

  disposeAll() {
    for (const [, promise] of this._cache) {
      promise.then((asset) => {
        try {
          this.app.assets.remove(asset);
          asset.unload();
        } catch {}
      }).catch(() => {});
    }
    this._cache.clear();
  }
}
