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
     * Uses X and Z as 2D coordinates (Y is usually PCB height which is constant).
     * Re-indexes LEDs sequentially starting from 0.
     * @returns {Array} Array of LED objects with index, x, y
     */
    getLEDsAs2D() {
      if (this.leds.length === 0) return [];

      return this.leds.map((led, i) => ({
        index: i,
        x: led.x,
        y: led.z, // Use Z as the Y dimension (XZ plane = 2D layout)
        origY: led.y, // Store original Y for reference
        origZ: led.z,
      }));
    }

    /**
   * Get all LED data with full 3D coordinates
   * Returns sequential indices (0 to n-1) regardless of original naming
   * @returns {Array}
   */
  getLEDsAs3D() {
    return this.leds.map((led, i) => ({
      ...led,
      index: i,
    }));
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

  /**
   * Scan the model's entity names and discover all component prefix groups.
   * Each group has a prefix (e.g. "LED_", "C", "D"), and indices within that prefix.
   * Only includes groups where the entity name ends with a numerical suffix.
   * @returns {Array} Array of { prefix, min, max, count }
   */
  getPrefixGroups() {
    const groups = {};
    const numberSuffixRe = /^(.+?)(\d+)$/;

    this.model.traverse((child) => {
      const name = child.name;
      if (!name) return;
      const match = name.match(numberSuffixRe);
      if (!match) return;
      const prefix = match[1];
      const num = parseInt(match[2], 10);

      if (!groups[prefix]) {
        groups[prefix] = { prefix, min: num, max: num, count: 0 };
      }
      if (num < groups[prefix].min) groups[prefix].min = num;
      if (num > groups[prefix].max) groups[prefix].max = num;
      groups[prefix].count++;
    });

    return Object.values(groups).sort((a, b) => b.count - a.count);
  }

  /**
   * Filter the internal LEDs list to only entities matching the given prefix
   * and within the specified numerical index range.
   * Re-indexes them to 0, 1, 2...
   * @param {string} prefix - e.g. "LED_"
   * @param {number} startIndex - inclusive start of numerical suffix range
   * @param {number} endIndex - inclusive end of numerical suffix range
   * @returns {Array} The new filtered-and-reindexed LEDs array
   */
  filterByPrefix(prefix, startIndex, endIndex) {
    const vector3 = new this.THREE.Vector3();
    const filtered = [];

    this.model.traverse((child) => {
      const match = child.name.match(new RegExp(`^${escapeRegex(prefix)}(\\d+)$`));
      if (!match) return;
      const num = parseInt(match[1], 10);
      if (num < startIndex || num > endIndex) return;

      child.getWorldPosition(vector3);
      filtered.push({
        index: num,
        x: vector3.x,
        y: vector3.y,
        z: vector3.z,
        object: child,
      });
    });

    // Sort by original numerical index
    filtered.sort((a, b) => a.index - b.index);
    // Re-index sequentially from 0
    this.leds = filtered.map((led, i) => ({ ...led, index: i }));

    return this.leds;
  }
}

/**
 * Escape special regex characters in a prefix string for safe use in RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default ThreeDLoader;
