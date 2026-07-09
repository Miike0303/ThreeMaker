import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';

/**
 * Phase 0 smoke test: initialize a WebGPURenderer (falls back to WebGL2
 * automatically when WebGPU is unavailable — see ARQUIT_2.MD section 2.2),
 * render a trivial spinning mesh, and overlay stats-gl for GPU/CPU timing.
 */
async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container element.');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.4, 3.2);
  camera.lookAt(0, 0, 0);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(2, 3, 2);
  scene.add(light, new THREE.AmbientLight(0x404060, 2));

  const mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.7, 0.22, 128, 24),
    new THREE.MeshStandardMaterial({ color: 0x5aa9e6, roughness: 0.35, metalness: 0.1 }),
  );
  scene.add(mesh);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Required: selects WebGPU when available, otherwise falls back to WebGL2.
  await renderer.init();

  const stats = new Stats({ trackGPU: true });
  container.appendChild(stats.dom);
  stats.init(renderer);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    stats.begin();

    mesh.rotation.x += 0.006;
    mesh.rotation.y += 0.01;

    renderer.render(scene, camera);

    stats.end();
    stats.update();
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start ThreeMaker desktop renderer:', error);
});
