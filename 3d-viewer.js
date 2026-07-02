/**
 * 3D Viewer Controller
 * Manages the 3D visualization and coordinate extraction workflow
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ThreeDIntegration from './js/three-d-integration.js';
import { beatsin8, beat8, sin8, cos8, CHSV, CRGB, scale8 } from './js/fastled.js';
import { palettes } from './js/palettes.js';
import { hsvToRgb } from './js/color.js';
import { mapNumber } from './js/math.js';

let integration = null;
let animationId = null;
let isAnimating = false;

// DOM elements
const inputModel = document.getElementById('inputModel');
const buttonLoadModel = document.getElementById('buttonLoadModel');
const loadingIndicator = document.getElementById('loadingIndicator');
const messageContainer = document.getElementById('messageContainer');
const previewCard = document.getElementById('previewCard');
const outputCard = document.getElementById('outputCard');
const statsCard = document.getElementById('statsCard');
const canvas3d = document.getElementById('canvas3d');
const buttonResetView = document.getElementById('buttonResetView');
const buttonToggleAnimation = document.getElementById('buttonToggleAnimation');
const textAreaPixelblaze3D = document.getElementById('textAreaPixelblaze3D');
const textAreaCoordinates3D = document.getElementById('textAreaCoordinates3D');
const buttonCopyPixelblaze3D = document.getElementById('buttonCopyPixelblaze3D');
const buttonCopyCoordinates3D = document.getElementById('buttonCopyCoordinates3D');
const buttonSendToMapper = document.getElementById('buttonSendToMapper');
const ledCount = document.getElementById('ledCount');
const boundsInfo = document.getElementById('boundsInfo');
const validationStatus = document.getElementById('validationStatus');

// Three.js globals
let scene, camera, renderer;
let cameraControls = null;
let modelGroup = null; // group that holds the loaded model, for easy replacement

// Animation state
let ledAnimationData = null; // { coordsX, coordsY, angles, radii } for FastLED patterns
let ledAnimationActive = false;
let ledMarkers = []; // array of { mesh, index } for visible LED indicators

/**
 * Initialize Three.js scene
 */
async function initThreeJS() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x555555); // lighter background for debugging

  // Use getBoundingClientRect for reliable dimensions
  const canvasRect = canvas3d.getBoundingClientRect();
  const canvasWidth = canvasRect.width || canvas3d.clientWidth || 800;
  const canvasHeight = canvasRect.height || canvas3d.clientHeight || 600;

    camera = new THREE.PerspectiveCamera(60, canvasWidth / canvasHeight, 0.001, 100);
  camera.position.set(0.05, 0.03, 0.1);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  renderer.setSize(canvasWidth, canvasHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  cameraControls = new OrbitControls(camera, renderer.domElement);
  cameraControls.autoRotate = false;
  cameraControls.enableDamping = true;
  cameraControls.dampingFactor = 0.05;
  cameraControls.target.set(0, 0, 0);
  cameraControls.update();

  // Brighter lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(5, 10, 7);
  scene.add(directionalLight);

  const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
  backLight.position.set(-5, -2, -7);
  scene.add(backLight);

    // Grid helper for orientation — small scale for PCB models in meters
  const gridHelper = new THREE.GridHelper(0.1, 10, 0x888888, 0x444444);
  scene.add(gridHelper);

  // Axes helper (red=X, green=Y, blue=Z) for orientation debugging
  const axesHelper = new THREE.AxesHelper(0.05);
  scene.add(axesHelper);

    // Model group — will be populated when a model is loaded
  modelGroup = new THREE.Group();
  scene.add(modelGroup);

  // Handle window resize
  window.addEventListener('resize', onWindowResize);

  // Start render loop
  animate();
}

/**
 * Animation loop
 */
function animate() {
  animationId = requestAnimationFrame(animate);
  
  // Update LED colors if a model is loaded and animation is active
  if (ledAnimationActive && integration && ledAnimationData) {
    updateLEDColors();
  }
  
  if (cameraControls) {
    cameraControls.update();
  }
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

/**
 * Compute and apply FastLED-style colors to the 3D model
 * Runs a beatsin8 rainbow pattern across the LEDs
 */
function updateLEDColors() {
  const { coordsX, coordsY, angles, radii } = ledAnimationData;
  const numLEDs = integration.getLEDCount();
  
  for (let i = 0; i < numLEDs; i++) {
    // Basic beatsin8 rainbow — hue oscillates per LED based on index + time
    const hue = beatsin8(16, 0, 255) + i * 8;
    const colorStr = CHSV(hue, 255, 255);
    
    // Parse CSS rgb(r,g,b) string to hex number
    const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      const hexColor = (r << 16) | (g << 8) | b;
      
      // Update marker mesh color
      if (i < ledMarkers.length) {
        const marker = ledMarkers[i].mesh;
        marker.material.color.setHex(hexColor);
        marker.material.emissive.setHex(hexColor);
      }
      
      // Also try applying to model object geometry if available
      const leds3D = integration.getLEDs3D();
      if (i < leds3D.length && leds3D[i].object) {
        const obj = leds3D[i].object;
        if (obj.material && obj.material.emissive) {
          obj.material.emissive.setHex(hexColor);
          obj.material.emissiveIntensity = 1.0;
        }
      }
    }
  }
}

/**
 * Start LED animation after model loads
 */
function startLEDAnimation() {
  if (!integration || integration.getLEDCount() === 0) return;
  
  const leds3D = integration.getLEDs3D();
  const numLEDs = leds3D.length;
  
  // Calculate 0-255 normalized coords for FastLED-style patterns
  const bounds = integration.getBounds();
  const coordsX = [];
  const coordsY = [];
  const angles = [];
  const radii = [];
  
  // Normalize coords to 0-255 range
  for (const led of leds3D) {
    const x256 = Math.round(mapNumber(led.x, bounds.minX, bounds.maxX, 0, 255));
    const y256 = Math.round(mapNumber(led.y, bounds.minY, bounds.maxY, 0, 255));
    coordsX.push(x256);
    coordsY.push(y256);
    
    const cx = (bounds.maxX + bounds.minX) / 2;
    const cy = (bounds.maxY + bounds.minY) / 2;
    const radius = Math.sqrt((led.x - cx) ** 2 + (led.y - cy) ** 2);
    const radians = Math.atan2(cy - led.y, cx - led.x);
    let angleDeg = radians * (180 / Math.PI);
    while (angleDeg < 0) angleDeg += 360;
    while (angleDeg > 360) angleDeg -= 360;
    
    let maxRadius = 0;
    for (const l of leds3D) {
      const r = Math.sqrt((l.x - cx) ** 2 + (l.y - cy) ** 2);
      if (r > maxRadius) maxRadius = r;
    }
    
    radii.push(Math.round(mapNumber(radius, 0, maxRadius, 0, 255)));
    angles.push(Math.round(mapNumber(angleDeg, 0, 360, 0, 255)));
  }
  
  ledAnimationData = { coordsX, coordsY, angles, radii };
  ledAnimationActive = true;
}

/**
 * Handle window resize
 */
function onWindowResize() {
  const width = canvas3d.clientWidth;
  const height = canvas3d.clientHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

/**
 * Load 3D model file
 */
async function onLoadModel() {
  const file = inputModel.files[0];
  if (!file) {
    showMessage('Please select a file', 'error');
    return;
  }

  showLoading(true);
  clearMessage();

  try {
    integration = new ThreeDIntegration(THREE, GLTFLoader);
    await integration.loadModel(file);

    const ledCount_val = integration.getLEDCount();
    if (ledCount_val === 0) {
      showMessage('No LEDs found in model. Ensure entities are named LED_0, LED_1, etc.', 'error');
      return;
    }

        // Replace model in scene — clear the group and add the new model
    while (modelGroup.children.length > 0) {
      modelGroup.remove(modelGroup.children[0]);
    }
    ledMarkers = [];

        const model = integration.loader.model;
    if (model) {
      modelGroup.add(model);
      
      // Create visible LED markers (spheres) at each LED position
      // These show the animation color even if the model's LED bodies
      // are just flat PCB pads with no emissive-capable geometry.
      const leds3D = integration.getLEDs3D();
      const markerGeom = new THREE.SphereGeometry(0.0015, 12, 12); // ~1.5mm radius spheres
      
      // Store marker meshes so we can update their colors every frame
      ledMarkers = [];
      
      leds3D.forEach(led => {
                const markerMat = new THREE.MeshStandardMaterial({
          color: 0x333333,
          emissive: 0x000000,
          emissiveIntensity: 3.0,
          transparent: true,
          opacity: 0.85,
        });
        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.position.set(led.x, led.y, led.z);
        modelGroup.add(marker);
        ledMarkers.push({ mesh: marker, index: led.index });
      });
      
      // Auto-fit camera to the loaded model bounds
      const bounds = integration.getBounds();
      if (bounds) {
        const maxDim = Math.max(bounds.width, bounds.height, bounds.depth);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        
        camera.position.x = bounds.centerX;
        camera.position.y = bounds.centerY;
        camera.position.z = bounds.centerZ + cameraZ;
        camera.lookAt(bounds.centerX, bounds.centerY, bounds.centerZ);
        
        cameraControls.target.set(bounds.centerX, bounds.centerY, bounds.centerZ);
        cameraControls.update();
      }
    }

    // Update UI
    previewCard.style.display = 'block';
    outputCard.style.display = 'block';
    statsCard.style.display = 'block';

        updateStats();
    updateOutput();

    // Auto-start LED animation
    startLEDAnimation();

    showMessage(`Successfully loaded ${ledCount_val} LEDs from model`, 'success');
  } catch (error) {
    showMessage(`Error loading model: ${error.message}`, 'error');
    console.error(error);
  } finally {
    showLoading(false);
  }
}

/**
 * Update statistics display
 */
function updateStats() {
  if (!integration) return;

  const count = integration.getLEDCount();
  const bounds = integration.getBounds();
  const stats = integration.getStats();

  ledCount.textContent = count;

  if (bounds) {
    boundsInfo.innerHTML = `
      <div>X: ${bounds.minX.toFixed(2)} to ${bounds.maxX.toFixed(2)} (${bounds.width.toFixed(2)})</div>
      <div>Y: ${bounds.minY.toFixed(2)} to ${bounds.maxY.toFixed(2)} (${bounds.height.toFixed(2)})</div>
      <div>Z: ${bounds.minZ.toFixed(2)} to ${bounds.maxZ.toFixed(2)} (${bounds.depth.toFixed(2)})</div>
    `;
  }

  if (stats.validation.valid) {
    validationStatus.innerHTML = '<span class="badge bg-success">✓ Valid LED sequence</span>';
  } else {
    let html = '<span class="badge bg-danger">✗ Issues found:</span><ul class="small mt-2">';
    stats.validation.errors.forEach(err => {
      html += `<li>${err}</li>`;
    });
    if (stats.validation.gaps.length > 0) {
      html += `<li>Gaps at indices: ${stats.validation.gaps.join(', ')}</li>`;
    }
    html += '</ul>';
    validationStatus.innerHTML = html;
  }
}

/**
 * Update coordinate output
 */
function updateOutput() {
  if (!integration) return;

  textAreaPixelblaze3D.value = integration.toPixelblazeFormat();
  textAreaCoordinates3D.value = integration.toCoordinatesFormat();
}

/**
 * Reset camera view
 */
function onResetView() {
  if (!integration || !cameraControls) return;

  const bounds = integration.getBounds();
  if (bounds) {
    const maxDim = Math.max(bounds.width, bounds.height, bounds.depth);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;
    
    camera.position.x = bounds.centerX;
    camera.position.y = bounds.centerY;
    camera.position.z = bounds.centerZ + cameraZ;
    
    cameraControls.target.set(bounds.centerX, bounds.centerY, bounds.centerZ);
    cameraControls.update();
  }
}

/**
 * Toggle auto-rotation animation
 */
function onToggleAnimation() {
  isAnimating = !isAnimating;
  if (cameraControls) {
    cameraControls.autoRotate = isAnimating;
  }
  buttonToggleAnimation.innerHTML = isAnimating 
    ? '<i class="bi bi-pause-fill"></i> Stop Animation'
    : '<i class="bi bi-play-fill"></i> Start Animation';

  // Also start/stop LED color animation
  if (isAnimating) {
    if (integration) startLEDAnimation();
  } else {
    ledAnimationActive = false;
  }
}

/**
 * Send the Pixelblaze map to the main mapper page via URL params
 */
function onSendToMapper() {
  if (!integration || integration.getLEDCount() === 0) {
    showMessage('No data to send. Load a model first.', 'error');
    return;
  }

  const pixelblazeData = integration.toPixelblazeFormat();
  const compressed = LZString.compressToEncodedURIComponent(pixelblazeData);
  const mapperUrl = `index.htm?p=${compressed}`;
  
  window.open(mapperUrl, '_blank');
  showMessage('Opened main mapper with 3D coordinates', 'success');
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showMessage('Copied to clipboard', 'success');
  }).catch(() => {
    showMessage('Failed to copy', 'error');
  });
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
  loadingIndicator.style.display = show ? 'block' : 'none';
}

/**
 * Display message
 */
function showMessage(text, type = 'info') {
  const className = type === 'error' ? 'error-message' : type === 'success' ? 'success-message' : 'text-info';
  messageContainer.innerHTML = `<div class="${className}">${text}</div>`;
}

/**
 * Clear messages
 */
function clearMessage() {
  messageContainer.innerHTML = '';
}

/**
 * Event listeners
 */
buttonLoadModel.addEventListener('click', onLoadModel);
buttonResetView.addEventListener('click', onResetView);
buttonToggleAnimation.addEventListener('click', onToggleAnimation);
buttonCopyPixelblaze3D.addEventListener('click', () => {
  copyToClipboard(textAreaPixelblaze3D.value);
});
buttonCopyCoordinates3D.addEventListener('click', () => {
  copyToClipboard(textAreaCoordinates3D.value);
});

if (buttonSendToMapper) {
  buttonSendToMapper.addEventListener('click', onSendToMapper);
}

inputModel.addEventListener('change', () => {
  buttonLoadModel.disabled = false;
});

// Initialize on page load
(async () => {
  try {
    await initThreeJS();
  } catch (error) {
    showMessage(`Failed to initialize 3D viewer: ${error.message}`, 'error');
    console.error(error);
  }
})();
