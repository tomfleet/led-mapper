/**
 * 3D Model to LED Mapper Integration
 * Converts 3D LED positions to 2D coordinates compatible with led-mapper
 */

import ThreeDLoader from './three-d-loader.js';

export class ThreeDIntegration {
  /**
   * @param {Object} THREE - The THREE.js module instance
   * @param {Function} GLTFLoader - The GLTFLoader constructor
   */
  constructor(THREE, GLTFLoader) {
    this.loader = new ThreeDLoader(THREE, GLTFLoader);
    this.leds2D = [];
    this.bounds = null;
  }

  /**
   * Load a 3D model file and extract LED positions
   * @param {File} file - The 3D model file (glTF/glB)
   * @returns {Promise<Array>} Array of 2D LED coordinates
   */
  async loadModel(file) {
    try {
      await this.loader.load(file);
      this.leds2D = this.loader.getLEDsAs2D();
      this.bounds = this.loader.getBounds();
      return this.leds2D;
    } catch (error) {
      console.error('Failed to load 3D model:', error);
      throw error;
    }
  }

  /**
   * Convert extracted 3D LEDs to Pixelblaze map format for led-mapper
   * @returns {string} JSON string in Pixelblaze format [[x,y], [x,y], ...]
   */
  toPixelblazeFormat() {
    if (this.leds2D.length === 0) return '[]';
    
    const map = this.leds2D.map(led => [
      Number(led.x.toFixed(3)),
      Number(led.y.toFixed(3))
    ]);
    
    return JSON.stringify(map);
  }

  /**
   * Convert extracted 3D LEDs to coordinates format for led-mapper
   * Format: index\tx\ty (tab-separated)
   * @returns {string} Tab-separated coordinates
   */
  toCoordinatesFormat() {
    if (this.leds2D.length === 0) return '';
    
    return this.leds2D
      .map(led => `${led.index}\t${led.x.toFixed(1)}\t${led.y.toFixed(1)}`)
      .join('\n');
  }

  /**
   * Get LED data for internal processing
   * @returns {Array} Array of LED objects with x, y, index
   */
  getLEDs() {
    return this.leds2D;
  }

  /**
   * Get all 3D LED data (including Z coordinate)
   * @returns {Array} Array of full 3D LED coordinates
   */
  getLEDs3D() {
    return this.loader.getLEDsAs3D();
  }

  /**
   * Get model bounds information
   * @returns {Object} {minX, maxX, minY, maxY, minZ, maxZ, width, height, depth, centerX, centerY, centerZ}
   */
  getBounds() {
    if (!this.bounds) return null;
    
    return {
      ...this.bounds,
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
      depth: this.bounds.maxZ - this.bounds.minZ,
      centerX: (this.bounds.maxX + this.bounds.minX) / 2,
      centerY: (this.bounds.maxY + this.bounds.minY) / 2,
      centerZ: (this.bounds.maxZ + this.bounds.minZ) / 2,
    };
  }

  /**
   * Get LED count
   * @returns {number}
   */
  getLEDCount() {
    return this.leds2D.length;
  }

  /**
   * Apply colors to 3D model based on FastLED output
   * @param {Array} coordsX - FastLED coordsX array
   * @param {Array} coordsY - FastLED coordsY array
   * @param {Function} colorFunction - Function that returns color for given LED index
   */
  applyLEDColors(coordsX, coordsY, colorFunction) {
    const colorMap = (index) => {
      try {
        return colorFunction(index, coordsX, coordsY);
      } catch (e) {
        return 0x000000;
      }
    };
    
    this.loader.applyColors(colorMap);
  }

  /**
   * Reset all LED colors in 3D model
   */
  resetLEDColors() {
    this.loader.resetColors();
  }

  /**
   * Validate that extracted LEDs form a valid sequence (0 to n-1)
   * @returns {Object} {valid: boolean, gaps: Array, errors: Array}
   */
  validateLEDSequence() {
    const errors = [];
    const gaps = [];

    if (this.leds2D.length === 0) {
      return { valid: false, gaps, errors: ['No LEDs found in model'] };
    }

    const indices = this.leds2D.map(led => led.index).sort((a, b) => a - b);
    
    // Check if starts at 0
    if (indices[0] !== 0) {
      errors.push(`LED sequence should start at 0, but starts at ${indices[0]}`);
    }

    // Check for gaps between sequential indices
    // e.g., if we have [0, 1, 3, 4], there's a gap at index 2
    for (let i = 0; i < indices.length - 1; i++) {
      const current = indices[i];
      const next = indices[i + 1];
      const expectedNext = current + 1;
      
      if (next !== expectedNext) {
        // Found a gap — add all missing indices between current and next
        for (let g = expectedNext; g < next; g++) {
          gaps.push(g);
        }
      }
    }

    // Check for duplicates
    const seen = new Set();
    for (const index of indices) {
      if (seen.has(index)) {
        errors.push(`Duplicate LED index found: ${index}`);
      }
      seen.add(index);
    }

    return {
      valid: errors.length === 0 && gaps.length === 0,
      gaps,
      errors,
    };
  }

  /**
   * Get summary statistics about the loaded model
   * @returns {Object}
   */
  getStats() {
    const validation = this.validateLEDSequence();
    const bounds = this.getBounds();

    return {
      ledCount: this.getLEDCount(),
      bounds,
      validation,
      hasErrors: !validation.valid,
    };
  }
}

export default ThreeDIntegration;
