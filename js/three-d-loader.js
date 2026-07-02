/**
 * 3D Model Loader and LED Extractor
 * Supports glTF/glB formats and extracts LED positions from named entities (LED_0, LED_1, etc.)
 *
 * Usage:
 *   import * as THREE from 'three';
 *   import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
 *   const loader = new ThreeDLoader(THREE, GLTFLoader);
 */

export class ThreeDLoader {
  /**
   * @param {Object} THREE - The THREE.js module instance
   * @param {Function} GLTFLoader - The GLTFLoader constructor
   */
  constructor(THREE, GLTFLoader) {
    if (!THREE || !GLTFLoader) {
      throw new Error('ThreeDLoader requires THREE and GLTFLoader to be passed in');
    }
    this.THREE = THREE;
    this.GLTFLoader = GLTFLoader;
    this.model = null;
    this.leds = [];
  }

  /**
   * Load a 3D model from a URL or File object
   * @param {File|string} fileOrUrl - File object or URL to load
   * @returns {Promise<void>}
   */
  async load(fileOrUrl) {
    const url = fileOrUrl instanceof File
      ? URL.createObjectURL(fileOrUrl)
      : fileOrUrl;

    // Load model using the provided GLTFLoader
    const loader = new this.GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        this.model = gltf.scene;
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
    const vector3 = new this.THREE.Vector3();

    // Traverse the model and find all entities matching LED_n pattern
    this.model.traverse((child) => {
      const match = child.name.match(/LED_(\d+)/i);
      if (match) {
        const index = parseInt(match[1]);
        
        // Get world position
        child.getWorldPosition(vector3);
        
        ledMap[index] = {
          index,
          x: vector3.x,
          y: vector3.y,
          z: vector3.z,
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
   * Preserves original coordinate values for compatibility with the main mapper.
   * @returns {Array} Array of LED objects with index, x, y (original 3D coords as 2D)
   */
  getLEDsAs2D() {
    if (this.leds.length === 0) return [];

    return this.leds.map(led => ({
      index: led.index,
      x: led.x,
      y: led.y,
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
   * Get model bounds from the full 3D coordinates
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
