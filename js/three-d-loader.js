/**
 * 3D Model Loader and LED Extractor
 * Supports glTF/glB formats and extracts LED positions from named entities (LED_0, LED_1, etc.)
 */

export class ThreeDLoader {
  constructor() {
    this.scene = null;
    this.model = null;
    this.leds = [];
    this.THREE = null;
    this.GLTFLoader = null;
  }

  /**
   * Load THREE.js and dependencies
   */
  async loadThreeJS() {
    if (this.THREE) return;

    const threeModule = await import('https://cdn.jsdelivr.net/npm/three@r128/build/three.module.js');
    this.THREE = threeModule;

    const loaderModule = await import('https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/loaders/GLTFLoader.js');
    this.GLTFLoader = loaderModule.GLTFLoader;
  }

  /**
   * Load a 3D model from a URL or File object
   * @param {File|string} fileOrUrl - File object or URL to load
   * @returns {Promise<void>}
   */
  async load(fileOrUrl) {
    await this.loadThreeJS();

    const url = fileOrUrl instanceof File
      ? URL.createObjectURL(fileOrUrl)
      : fileOrUrl;

    // Setup scene
    this.scene = new this.THREE.Scene();
    this.scene.background = new this.THREE.Color(0x2a2a2a);

    // Load model
    const loader = new this.GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        this.model = gltf.scene;
        this.scene.add(this.model);
        this.extractLEDs();
        resolve();
      }, undefined, reject);
    });
  }

  /**
   * Extract LED positions from model by searching for named entities (LED_n pattern)
   * @returns {Array} Array of LED objects with index, x, y, z coordinates
   */
  extractLEDs() {
    this.leds = [];
    const ledMap = {};

    // Traverse the model and find all entities matching LED_n pattern
    this.model.traverse((child) => {
      const match = child.name.match(/LED_(\d+)/i);
      if (match) {
        const index = parseInt(match[1]);
        
        // Get world position
        const worldPos = new this.THREE.Vector3();
        child.getWorldPosition(worldPos);
        
        ledMap[index] = {
          index,
          x: worldPos.x,
          y: worldPos.y,
          z: worldPos.z,
          object: child, // Keep reference for visualization
        };
      }
    });

    // Convert to sorted array
    this.leds = Object.values(ledMap).sort((a, b) => a.index - b.index);

    return this.leds;
  }

  /**
   * Get LEDs in format compatible with led-mapper (2D projection)
   * Converts 3D coordinates to 2D by dropping Z axis
   * @returns {Array} Array of LED objects with index, x, y
   */
  getLEDsAs2D() {
    if (this.leds.length === 0) return [];

    // Find min/max for normalization
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    this.leds.forEach(led => {
      minX = Math.min(minX, led.x);
      maxX = Math.max(maxX, led.x);
      minY = Math.min(minY, led.y);
      maxY = Math.max(maxY, led.y);
    });

    // Convert to 2D array, normalized to 0-255 range for led-mapper compatibility
    return this.leds.map(led => ({
      index: led.index,
      x: ((led.x - minX) / (maxX - minX)) * 255,
      y: ((led.y - minY) / (maxY - minY)) * 255,
      z: led.z, // Keep Z for reference
    }));
  }

  /**
   * Get all LED data with full 3D coordinates
   * @returns {Array}
   */
  getLEDsAs3D() {
    return this.leds;
  }

  /**
   * Apply colors to LED objects in the 3D scene
   * @param {Object|Function} colorMap - Object mapping LED index to color, or function(index) -> color
   */
  applyColors(colorMap) {
    if (!this.model) return;

    this.leds.forEach(led => {
      const color = typeof colorMap === 'function' ? colorMap(led.index) : colorMap[led.index];
      if (color && led.object) {
        // Apply emissive material to make LEDs glow
        if (led.object.material) {
          led.object.material.emissive.set(color);
          led.object.material.emissiveIntensity = 1.0;
        }
      }
    });
  }

  /**
   * Reset all LED colors to default
   */
  resetColors() {
    this.leds.forEach(led => {
      if (led.object && led.object.material) {
        led.object.material.emissive.set(0x000000);
        led.object.material.emissiveIntensity = 0;
      }
    });
  }

  /**
   * Get model bounds
   * @returns {Object} {minX, maxX, minY, maxY, minZ, maxZ}
   */
  getBounds() {
    if (this.leds.length === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    this.leds.forEach(led => {
      minX = Math.min(minX, led.x);
      maxX = Math.max(maxX, led.x);
      minY = Math.min(minY, led.y);
      maxY = Math.max(maxY, led.y);
      minZ = Math.min(minZ, led.z);
      maxZ = Math.max(maxZ, led.z);
    });

    return { minX, maxX, minY, maxY, minZ, maxZ };
  }
}

export default ThreeDLoader;
