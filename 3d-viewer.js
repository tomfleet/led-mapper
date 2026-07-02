/**
 * 3D Viewer Controller
 * Manages the 3D visualization and coordinate extraction workflow
 */

import ThreeDIntegration from './js/three-d-integration.js';

let integration = null;
let animationId = null;
let isAnimating = false;
let THREE = null;
let OrbitControls = null;

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
const ledCount = document.getElementById('ledCount');
const boundsInfo = document.getElementById('boundsInfo');
const validationStatus = document.getElementById('validationStatus');

// Three.js globals
let scene, camera, renderer;
let cameraControls = null;

/**
 * Load Three.js library
 */
async function loadThreeJS() {
  if (THREE) return;
  
  // Load Three.js
  //const threeModule = await import('https://cdn.jsdelivr.net/npm/three@r128/build/three.module.js');
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js');
  THREE = threeModule.default || threeModule;
  
  // Load OrbitControls
  const controlsModule = await import('https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/controls/OrbitControls.js');
  OrbitControls = controlsModule.OrbitControls;
  
  return { THREE, OrbitControls };
}

/**
 * Initialize Three.js scene
 */
async function initThreeJS() {
  await loadThreeJS();
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a2a);

  camera = new THREE.PerspectiveCamera(75, canvas3d.clientWidth / canvas3d.clientHeight, 0.1, 1000);
  camera.position.z = 5;

  renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  renderer.setSize(canvas3d.clientWidth, canvas3d.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  cameraControls = new OrbitControls(camera, renderer.domElement);
  cameraControls.autoRotate = false;
  cameraControls.enableDamping = true;
  cameraControls.dampingFactor = 0.05;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);

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
  
  if (cameraControls) {
    cameraControls.update();
  }
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
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
    integration = new ThreeDIntegration();
    await integration.loadModel(file);

    const ledCount_val = integration.getLEDCount();
    if (ledCount_val === 0) {
      showMessage('No LEDs found in model. Ensure entities are named LED_0, LED_1, etc.', 'error');
      return;
    }

    // Add model to scene
    scene.clear();
    const model = integration.loader.model;
    if (model) {
      scene.add(model);
      
      // Re-add lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 5, 5);
      scene.add(directionalLight);
      
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

    // Update UI
    previewCard.style.display = 'block';
    outputCard.style.display = 'block';
    statsCard.style.display = 'block';

    updateStats();
    updateOutput();

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
