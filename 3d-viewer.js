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
import { hsvToRgb, getColorAtBrightness } from './js/color.js';
import { mapNumber } from './js/math.js';
import { getPatternCode } from './js/patterns.js';

let integration = null;
let isAnimating = false;

// Animation state
let ledAnimationActive = false;
let ledMarkers = []; // array of { mesh, index } for visible LED indicators

// Pattern engine state (mirrors index.js)
let renderFunction = undefined;
let offset = 0;
let offsetIncrement = 1.0;
let running = true;

// DOM elements
const inputModel = document.getElementById('inputModel');
const buttonLoadModel = document.getElementById('buttonLoadModel');
const loadingIndicator = document.getElementById('loadingIndicator');
const messageContainer = document.getElementById('messageContainer');
const previewCard = document.getElementById('previewCard');
const controlsCard = document.getElementById('controlsCard');
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

// Pattern engine DOM elements
const selectPattern3D = document.getElementById('selectPattern3D');
const selectPalette3D = document.getElementById('selectPalette3D');
const canvasSelectedPalette3D = document.getElementById('canvasSelectedPalette3D');
const contextSelectedPalette3D = canvasSelectedPalette3D.getContext('2d');
const buttonPlayPause3D = document.getElementById('buttonPlayPause3D');
const iconPlayPause3D = document.getElementById('iconPlayPause3D');
const inputPreviewCode3D = document.getElementById('inputPreviewCode3D');
const inputPreviewSpeed3D = document.getElementById('inputPreviewSpeed3D');
const renderError3D = document.getElementById('renderError3D');
const inputSphereSize3D = document.getElementById('inputSphereSize3D');
const sphereSizeValue3D = document.getElementById('sphereSizeValue3D');
const debugInfo = document.getElementById('debugInfo');

// Coordinate arrays (populated on model load, used by pattern engine)
let coordsX, coordsY, angles, radii;

// Three.js globals
let scene, camera, renderer;
let cameraControls = null;
let modelGroup = null; // group that holds the loaded model, for easy replacement

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

  renderer.setViewport(0, 0, canvasWidth, canvasHeight);

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
 * Animation loop — drives both Three.js rendering and LED colors
 */
function animate() {
  requestAnimationFrame(animate);

  // Update LED colors if active
  if (ledAnimationActive && running && integration && ledMarkers.length > 0) {
    updateLEDColors();
    offset += offsetIncrement;
    if (offset > 255) offset = 0;
  }

  if (cameraControls) {
    cameraControls.update();
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

/**
 * Compute and apply FastLED-style colors to the 3D model markers
 * Uses the same pattern engine as the 2D mapper
 */
function updateLEDColors() {
  if (renderFunction === undefined) return;

  const numLEDs = integration.getLEDCount();

  for (let i = 0; i < numLEDs; i++) {
    let fillStyle;
    const speed = offsetIncrement;

    try {
      fillStyle = renderFunction(angles, beat8, beatsin8, CHSV, ColorFromPalette, coordsX, coordsY, cos8, CRGB, null, i, offset, radii, sin8, speed);
    } catch (error) {
      handleRenderError(error);
      return;
    }

    // Parse CSS rgb(r,g,b) string to hex
    const match = fillStyle.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      const hexColor = (r << 16) | (g << 8) | b;

      // Update marker mesh
      if (i < ledMarkers.length) {
        const marker = ledMarkers[i].mesh;
        marker.material.color.setHex(hexColor);
        marker.material.emissive.setHex(hexColor);
      }

      // Also try model object geometry
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
 * ColorFromPalette — matches index.js implementation
 */
function ColorFromPalette(palette, index, brightness = 255) {
  let fixedIndex = index;
  while (fixedIndex > 255) fixedIndex -= 256;
  while (fixedIndex < 0) fixedIndex += 256;

  const imageData = contextSelectedPalette3D.getImageData(fixedIndex, 0, canvasSelectedPalette3D.width, canvasSelectedPalette3D.height);
  const data = imageData.data;

  while (brightness > 255) brightness -= 256;
  while (brightness < 0) brightness += 256;

  const rgb = getColorAtBrightness(data, brightness);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Handle render function errors
 */
function handleRenderError(error) {
  renderFunction = undefined;
  console.error(error);
  renderError3D.innerText = `Error: ${error.message}`;
}

/**
 * Start LED animation after model loads
 * Uses X and Z as the 2D plane (for PCB-mount LEDs where Y is constant height).
 */
function startLEDAnimation() {
  if (!integration || integration.getLEDCount() === 0) return;

  const leds2D = integration.getLEDs(); // gets reindexed XZ projection
  const numLEDs = leds2D.length;
  const bounds = integration.getBounds();

  coordsX = [];
  coordsY = [];
  angles = [];
  radii = [];

  // Use the 2D-projected coordinates (X and Z remapped to X and Y)
  // Find bounds in the 2D projection plane
  let minX2 = Infinity, maxX2 = -Infinity;
  let minY2 = Infinity, maxY2 = -Infinity;
  for (const led of leds2D) {
    if (led.x < minX2) minX2 = led.x;
    if (led.x > maxX2) maxX2 = led.x;
    if (led.y < minY2) minY2 = led.y;
    if (led.y > maxY2) maxY2 = led.y;
  }

  for (const led of leds2D) {
    const x256 = Math.round(mapNumber(led.x, minX2, maxX2, 0, 255));
    const y256 = Math.round(mapNumber(led.y, minY2, maxY2, 0, 255));
    coordsX.push(x256);
    coordsY.push(y256);

    const cx = (maxX2 + minX2) / 2;
    const cy = (maxY2 + minY2) / 2;
    const radius = Math.sqrt((led.x - cx) ** 2 + (led.y - cy) ** 2);
    const radians = Math.atan2(cy - led.y, cx - led.x);
    let angleDeg = radians * (180 / Math.PI);
    while (angleDeg < 0) angleDeg += 360;
    while (angleDeg > 360) angleDeg -= 360;

    let maxRadius = 0;
    for (const l of leds2D) {
      const r = Math.sqrt((l.x - cx) ** 2 + (l.y - cy) ** 2);
      if (r > maxRadius) maxRadius = r;
    }

    radii.push(Math.round(mapNumber(radius, 0, maxRadius, 0, 255)));
    angles.push(Math.round(mapNumber(angleDeg, 0, 360, 0, 255)));
  }

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

  return loadModelFromFile(file);
}

/**
 * Core model loading logic
 */
async function loadModelFromFile(file) {
  showLoading(true);
  clearMessage();

  try {
    integration = new ThreeDIntegration(THREE, GLTFLoader);
    await integration.loadModel(file);

    const ledCount_val = integration.getLEDCount();
    if (ledCount_val === 0) {
      showMessage('No LEDs found in model. Ensure entities are named LED_0, LED_1, etc.', 'error');
      return false;
    }

    // Clear scene group and old markers
    while (modelGroup.children.length > 0) {
      modelGroup.remove(modelGroup.children[0]);
    }
    ledMarkers = [];

    const model = integration.loader.model;
    if (model) {
      modelGroup.add(model);

      // Create visible LED markers at each LED position
      const leds3D = integration.getLEDs3D();
      createLEDMarkers(leds3D);

      // Auto-fit camera
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

        // Show all cards
    previewCard.style.display = 'block';
    controlsCard.style.display = 'block';
    outputCard.style.display = 'block';
    statsCard.style.display = 'block';

    // Force canvas resize now that it's visible
    const newWidth = canvas3d.clientWidth;
    const newHeight = canvas3d.clientHeight;
    if (newWidth > 0 && newHeight > 0) {
      renderer.setSize(newWidth, newHeight);
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
    }

    updateStats();
    updateOutput();

    // Initialize pattern engine with normalized coords
    startLEDAnimation();
    onPatternChange3D();
    onPaletteChange3D();

    // Populate settings modal
    populateSettingsModal();

    // Dump debug info
    dumpDebugInfo();

    showMessage(`Successfully loaded ${ledCount_val} LEDs from model`, 'success');
    return true;
  } catch (error) {
    showMessage(`Error loading model: ${error.message}`, 'error');
    console.error(error);
    return false;
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
}

// --- Pattern Engine Event Handlers ---

function onPatternChange3D() {
  const code = getPatternCode(selectPattern3D.value);
  inputPreviewCode3D.value = code;
  onPreviewCodeChange3D();
}

function onPreviewCodeChange3D() {
  const code = inputPreviewCode3D.value;
  renderFunction = undefined;
  renderError3D.innerText = '';

  try {
    renderFunction = Function(
      'angles', 'beat8', 'beatsin8', 'CHSV', 'ColorFromPalette',
      'coordsX', 'coordsY', 'cos8', 'CRGB', 'currentPalette',
      'i', 'offset', 'radii', 'sin8', 'speed',
      code
    );
  } catch (error) {
    handleRenderError(error);
  }
}

function onPaletteChange3D() {
  const paletteName = selectPalette3D.value;
  const palette = palettes[paletteName];
  if (!palette) return;

  const gradient = contextSelectedPalette3D.createLinearGradient(0, 0, canvasSelectedPalette3D.width, 0);
  let offset = 0;
  const offsetIncrement = 1.0 / palette.length;
  palette.forEach((color) => {
    if (color.endsWith('%')) {
      const parts = color.split(')');
      color = parts[0] + ')';
      let percent = parts[parts.length - 1];
      percent = percent.substring(0, percent.length - 2);
      offset = parseFloat(percent) / 100.0;
    }
    gradient.addColorStop(offset, color);
    offset += offsetIncrement;
  });
  contextSelectedPalette3D.fillStyle = gradient;
  contextSelectedPalette3D.fillRect(0, 0, canvasSelectedPalette3D.width, canvasSelectedPalette3D.height);
}

function onPlayPause3D() {
  running = !running;
  iconPlayPause3D.className = running ? 'bi bi-pause-fill' : 'bi bi-play-fill';
  buttonPlayPause3D.title = running ? 'Pause' : 'Play';
}

function onPreviousPattern3D() {
  const newIndex = (selectPattern3D.selectedIndex - 1) % selectPattern3D.options.length;
  selectPattern3D.selectedIndex = newIndex > -1 ? newIndex : selectPattern3D.options.length - 1;
  onPatternChange3D();
}

function onNextPattern3D() {
  selectPattern3D.selectedIndex = (selectPattern3D.selectedIndex + 1) % selectPattern3D.options.length;
  onPatternChange3D();
}

function onPreviousPalette3D() {
  const newIndex = (selectPalette3D.selectedIndex - 1) % selectPalette3D.options.length;
  selectPalette3D.selectedIndex = newIndex > -1 ? newIndex : selectPalette3D.options.length - 1;
  onPaletteChange3D();
}

function onNextPalette3D() {
  selectPalette3D.selectedIndex = (selectPalette3D.selectedIndex + 1) % selectPalette3D.options.length;
  onPaletteChange3D();
}

function onPreviewSpeedChange3D() {
  offsetIncrement = parseFloat(inputPreviewSpeed3D.value) || 1.0;
}

/**
 * Create or recreate LED marker spheres at each LED position
 * Uses the current sphere size from the slider
 */
function createLEDMarkers(leds3D) {
  // Remove existing markers first (from modelGroup)
  for (const m of ledMarkers) {
    if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
  }
  ledMarkers = [];

  const radius = parseFloat(inputSphereSize3D.value) || 0.0005;
  const markerGeom = new THREE.SphereGeometry(radius, 12, 12);

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
}

/**
 * Handle sphere size slider change
 */
function onSphereSizeChange() {
  sphereSizeValue3D.textContent = inputSphereSize3D.value;
  if (integration) {
    const leds3D = integration.getLEDs3D();
    createLEDMarkers(leds3D);
  }
}

/**
 * Dump debug info to the Debug Info panel
 */
function dumpDebugInfo() {
  if (!integration) {
    debugInfo.textContent = 'No model loaded.';
    return;
  }

  const leds3D = integration.getLEDs3D();
  const leds2D = integration.getLEDs();
  const bounds = integration.getBounds();
  const stats = integration.getStats();
  const pixelblaze = integration.toPixelblazeFormat();
  const coords = integration.toCoordinatesFormat();

  let text = '';
  text += `=== Bounds (in scene units) ===\n`;
  text += `minX: ${bounds.minX.toFixed(6)}, maxX: ${bounds.maxX.toFixed(6)}\n`;
  text += `minY: ${bounds.minY.toFixed(6)}, maxY: ${bounds.maxY.toFixed(6)}\n`;
  text += `minZ: ${bounds.minZ.toFixed(6)}, maxZ: ${bounds.maxZ.toFixed(6)}\n`;
  text += `width: ${bounds.width.toFixed(6)}, height: ${bounds.height.toFixed(6)}, depth: ${bounds.depth.toFixed(6)}\n`;
  text += `centerX: ${bounds.centerX.toFixed(6)}, centerY: ${bounds.centerY.toFixed(6)}, centerZ: ${bounds.centerZ.toFixed(6)}\n\n`;

  text += `=== Individual LED Positions (2D Projection: X=x, Z=y) ===\n`;
  leds2D.forEach(led => {
    text += `  LED_${led.index}: (${led.x.toFixed(6)}, ${led.y.toFixed(6)})\n`;
  });
  text += '\n';

  text += `=== Normalized (0-255) ===\n`;
  if (coordsX && angles) {
    for (let i = 0; i < Math.min(leds2D.length, 20); i++) {
      text += `  LED_${i}: x256=${coordsX[i]}, y256=${coordsY[i]}, angle=${angles[i]}, radius=${radii[i]}\n`;
    }
  }
  text += '\n';

  text += `=== Pixelblaze Output ===\n${pixelblaze}\n\n`;

  text += `=== Coordinates Output (first 10) ===\n`;
  const lines = coords.split('\n').slice(0, 10);
  lines.forEach(line => { text += `  ${line}\n`; });
  text += '\n';

  text += `=== Validation ===\n`;
  text += `Valid: ${stats.validation.valid}\n`;
  if (stats.validation.errors.length > 0) {
    text += `Errors: ${stats.validation.errors.join(', ')}\n`;
  }
  if (stats.validation.gaps.length > 0) {
    text += `Gaps: ${stats.validation.gaps.join(', ')}\n`;
  }

  text += `\n=== Marker Spheres ===\n`;
  text += `Sphere radius: ${inputSphereSize3D.value}\n`;
  text += `Marker count: ${ledMarkers.length}\n`;
  text += `Model group children: ${modelGroup ? modelGroup.children.length : 0}\n`;

  debugInfo.textContent = text;
}

/**
 * Populate the settings modal with prefix groups discovered from the model
 */
function populateSettingsModal() {
  const tbody = document.getElementById('prefixTableBody');
  if (!tbody || !integration) return;

  const groups = integration.loader.getPrefixGroups();
  tbody.innerHTML = '';

  groups.forEach((group) => {
    const tr = document.createElement('tr');
    tr.dataset.prefix = group.prefix;
    tr.dataset.min = group.min;
    tr.dataset.max = group.max;

    // Checkbox + prefix name
    const selectTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    checkbox.checked = group.prefix.startsWith('LED_');
    checkbox.dataset.prefix = group.prefix;
    selectTd.appendChild(checkbox);
    selectTd.appendChild(document.createTextNode(` ${group.prefix}`));

    // Count
    const countTd = document.createElement('td');
    countTd.textContent = group.count;

    // Min
    const minTd = document.createElement('td');
    minTd.textContent = group.min;

    // Max
    const maxTd = document.createElement('td');
    maxTd.textContent = group.max;

    // Start input
    const startTd = document.createElement('td');
    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.className = 'form-control form-control-sm';
    startInput.style.width = '5rem';
    startInput.value = group.min;
    startInput.min = group.min;
    startInput.max = group.max;
    startInput.dataset.prefix = group.prefix;
    startTd.appendChild(startInput);

    // End input
    const endTd = document.createElement('td');
    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.className = 'form-control form-control-sm';
    endInput.style.width = '5rem';
    endInput.value = group.max;
    endInput.min = group.min;
    endInput.max = group.max;
    endInput.dataset.prefix = group.prefix;
    endTd.appendChild(endInput);

    // Mapped count
    const mappedTd = document.createElement('td');
    const mappedSpan = document.createElement('span');
    mappedSpan.className = 'badge bg-info';
    const range = group.max - group.min + 1;
    mappedSpan.textContent = checkbox.checked ? range : 0;
    mappedTd.appendChild(mappedSpan);

    tr.appendChild(selectTd);
    tr.appendChild(countTd);
    tr.appendChild(minTd);
    tr.appendChild(maxTd);
    tr.appendChild(startTd);
    tr.appendChild(endTd);
    tr.appendChild(mappedTd);

    // Update mapped count on checkbox/range change
    const updateMapped = () => {
      const s = parseInt(startInput.value) || group.min;
      const e = parseInt(endInput.value) || group.max;
      const count = checkbox.checked ? Math.max(0, e - s + 1) : 0;
      mappedSpan.textContent = count;
    };
    checkbox.addEventListener('change', updateMapped);
    startInput.addEventListener('input', updateMapped);
    endInput.addEventListener('input', updateMapped);

    tbody.appendChild(tr);
  });
}

/**
 * Apply settings from the modal: filter LEDs by selected prefix and range
 */
function onApplySettings() {
  const tbody = document.getElementById('prefixTableBody');
  if (!tbody || !integration) return;

  let selectedGroup = null;
  let selectedStart = 0;
  let selectedEnd = 0;

  // Find the first checked prefix
  for (const tr of tbody.children) {
    const checkbox = tr.querySelector('input[type="checkbox"]');
    if (checkbox && checkbox.checked) {
      const prefix = checkbox.dataset.prefix;
      const startInput = tr.querySelector('td:nth-child(5) input');
      const endInput = tr.querySelector('td:nth-child(6) input');
      selectedGroup = prefix;
      selectedStart = parseInt(startInput.value) || parseInt(tr.dataset.min);
      selectedEnd = parseInt(endInput.value) || parseInt(tr.dataset.max);
      break;
    }
  }

  if (!selectedGroup) {
    showMessage('Please select a prefix group to map to LEDs', 'error');
    return;
  }

  // Filter the loader's LEDs
  integration.loader.filterByPrefix(selectedGroup, selectedStart, selectedEnd);

  // Rebuild the 2D projection and animation state from scratch
  const leds2D = integration.loader.getLEDsAs2D();
  integration.leds2D = leds2D;
  integration.bounds = integration.loader.getBounds();

  // Clear scene and recreate
  while (modelGroup.children.length > 0) {
    modelGroup.remove(modelGroup.children[0]);
  }
  ledMarkers = [];

  const model = integration.loader.model;
  if (model) {
    modelGroup.add(model);
    const leds3D = integration.getLEDs3D();
    createLEDMarkers(leds3D);

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

  updateStats();
  updateOutput();
  startLEDAnimation();
  onPatternChange3D();
  onPaletteChange3D();
  dumpDebugInfo();

  // Close modal
  const modal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
  if (modal) modal.hide();

  showMessage(`Filtered to ${integration.getLEDCount()} LEDs from ${selectedGroup}${selectedStart}-${selectedEnd}`, 'success');
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

// Pattern engine listeners
selectPattern3D.addEventListener('change', onPatternChange3D);
selectPalette3D.addEventListener('change', onPaletteChange3D);
inputPreviewCode3D.addEventListener('input', onPreviewCodeChange3D);
inputPreviewSpeed3D.addEventListener('input', onPreviewSpeedChange3D);
buttonPlayPause3D.addEventListener('click', onPlayPause3D);
document.getElementById('buttonPreviousPattern3D').addEventListener('click', onPreviousPattern3D);
document.getElementById('buttonNextPattern3D').addEventListener('click', onNextPattern3D);
document.getElementById('buttonPreviousPalette3D').addEventListener('click', onPreviousPalette3D);
document.getElementById('buttonNextPalette3D').addEventListener('click', onNextPalette3D);
inputSphereSize3D.addEventListener('input', onSphereSizeChange);

// Settings modal listeners
document.getElementById('buttonApplySettings').addEventListener('click', onApplySettings);
document.getElementById('buttonSelectAllPrefixes').addEventListener('click', () => {
  const tbody = document.getElementById('prefixTableBody');
  if (!tbody) return;
  for (const tr of tbody.children) {
    const cb = tr.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
  }
});
document.getElementById('buttonDeselectAllPrefixes').addEventListener('click', () => {
  const tbody = document.getElementById('prefixTableBody');
  if (!tbody) return;
  for (const tr of tbody.children) {
    const cb = tr.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
  }
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
