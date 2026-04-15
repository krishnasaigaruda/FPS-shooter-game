// Entry point — boots the game: loads assets, sets up scene, wires UI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

import { Game } from './game.js';
import { UI } from './ui.js';

const ASSETS = {
  player: './player.glb',
  enemy: './enemy.glb',
  gun: './gun.glb',
  map: './map/source/extracted/STATICout.fbx',
};

const loadbar = document.getElementById('loadfill');
const loaderEl = document.getElementById('loader');

// ---------- Renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa9b7c6, 80, 420);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 2000);

// ---------- Sky + sunlight (realistic lighting) ----------
const sky = new Sky();
sky.scale.setScalar(4500);
scene.add(sky);
const sun = new THREE.Vector3();
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6;
skyU.rayleigh.value = 2;
skyU.mieCoefficient.value = 0.005;
skyU.mieDirectionalG.value = 0.8;
const phi = THREE.MathUtils.degToRad(90 - 35);
const theta = THREE.MathUtils.degToRad(30);
sun.setFromSphericalCoords(1, phi, theta);
skyU.sunPosition.value.copy(sun);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2a1a, 1.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xfff2d6, 3.2);
dir.position.copy(sun).multiplyScalar(200);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
const s = 140;
dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
dir.shadow.camera.near = 1; dir.shadow.camera.far = 600;
dir.shadow.bias = -0.00015;
dir.shadow.normalBias = 0.04;
scene.add(dir);
scene.add(dir.target);

// Subtle ambient so shadowed areas aren't pitch black
scene.add(new THREE.AmbientLight(0xb0c0d0, 1.1));

// Environment map from the sky so PBR materials (gun, enemies) reflect realistic light
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const envScene = new THREE.Scene();
envScene.add(sky.clone());
scene.environment = pmrem.fromScene(envScene, 0.04).texture;

// ---------- Postprocessing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.15, 0.4, 1.1);
composer.addPass(bloom);
const smaa = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);

// ---------- Loaders ----------
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => {
  loadbar.style.width = `${(loaded / total) * 100}%`;
};
// FBX stores absolute/authoring texture paths — rewrite them to our textures folder.
manager.setURLModifier((url) => {
  const base = url.split(/[/\\]/).pop();
  if (!base) return url;
  if (/\.(png|jpg|jpeg|tga|bmp)$/i.test(base)) {
    return './map/source/extracted/' + base;
  }
  return url;
});
manager.onError = (u) => console.warn('Missing asset:', u);
const gltf = new GLTFLoader(manager);
const fbx = new FBXLoader(manager);

function loadGLB(url) {
  return new Promise((res, rej) => gltf.load(url, (g) => res(g), undefined, rej));
}
function loadFBX(url) {
  return new Promise((res, rej) => fbx.load(url, (g) => res(g), undefined, rej));
}

// ---------- Boot ----------
(async function boot() {
  try {
    const [playerGLB, enemyGLB, gunGLB, mapFBX] = await Promise.all([
      loadGLB(ASSETS.player),
      loadGLB(ASSETS.enemy),
      loadGLB(ASSETS.gun),
      loadFBX(ASSETS.map),
    ]);

    // Load the manifest of available textures so we can fuzzy-match by material name.
    const texList = await fetch('./js/texture_list.txt').then((r) => r.text()).then((t) => t.trim().split('\n'));
    const texLoader = new THREE.TextureLoader();
    const texCache = new Map();
    const loadTex = (filename) => {
      if (texCache.has(filename)) return texCache.get(filename);
      const tex = texLoader.load('./map/source/extracted/' + filename);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      texCache.set(filename, tex);
      return tex;
    };
    // Fuzzy-match a material name to a texture filename.
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const texIndex = texList.map((f) => ({ f, key: norm(f.replace(/\.[^.]+$/, '')) }));
    const findTex = (matName) => {
      if (!matName) return null;
      const k = norm(matName);
      if (k.length < 3) return null;
      // exact
      let hit = texIndex.find((t) => t.key === k);
      if (hit) return hit.f;
      // material name starts with texture name (prefix, min 4 chars) or vice versa
      hit = texIndex.find((t) => t.key.length >= 4 && k.startsWith(t.key));
      if (hit) return hit.f;
      hit = texIndex.find((t) => k.length >= 4 && t.key.startsWith(k));
      if (hit) return hit.f;
      return null;
    };

    // Debug: collect unique material names
    const matNames = new Set();

    // Replace every map material with a MeshBasicMaterial carrying the same
    // diffuse map. This bypasses lighting entirely so we can verify textures
    // are actually loading, and gives consistent readable look regardless of
    // whatever lighting we set up.
    let matsWithMap = 0, matsTotal = 0;
    mapFBX.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const newMats = mats.map((m) => {
          matsTotal++;
          if (m.name) matNames.add(m.name);
          let map = m.map || null;
          if (!map) {
            const file = findTex(m.name);
            if (file) map = loadTex(file);
          }
          if (map) {
            matsWithMap++;
            map.colorSpace = THREE.SRGBColorSpace;
            map.wrapS = map.wrapT = THREE.RepeatWrapping;
          }
          const isAlpha = !!(m.name && /alpha|fence|bush|shrub|leaf|rail|chain/i.test(m.name));
          return new THREE.MeshBasicMaterial({
            map,
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: isAlpha,
            alphaTest: isAlpha ? 0.5 : 0,
          });
        });
        o.material = Array.isArray(o.material) ? newMats : newMats[0];
      }
    });
    console.log(`[map] materials: ${matsTotal}, with texture: ${matsWithMap}`);

    console.log('[map] material names:', [...matNames]);
    console.log('[map] texture files:', texList.length);

    // Scale map so the tallest geometry is ~80 units. Player eye = 1.7, so a
    // 20m building is ~12x the player's height — matches real FPS feel.
    const box = new THREE.Box3().setFromObject(mapFBX);
    const size = box.getSize(new THREE.Vector3());
    const scale = 80 / Math.max(size.y, 1);
    mapFBX.scale.setScalar(scale);
    mapFBX.updateMatrixWorld(true);
    scene.add(mapFBX);

    // Fallback ground plane — placed just below street level so holes/gaps in
    // the map fill in seamlessly. We set its Y after sampling the street.
    const groundTex = texLoader.load('./map/source/extracted/road_tarmac_09.png');
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(60, 60);
    const fallbackGround = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ map: groundTex, color: 0x777777, side: THREE.DoubleSide, depthWrite: true })
    );
    fallbackGround.rotation.x = -Math.PI / 2;
    scene.add(fallbackGround);
    fallbackGround.userData.isFallbackGround = true;

    // Sample the map from above to find street level and a clear spawn.
    const scaledBox = new THREE.Box3().setFromObject(mapFBX);
    const scaledSize = scaledBox.getSize(new THREE.Vector3());
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const samples = [];
    // Pick the first upward-facing hit (filters out roofs/awnings/ceilings).
    const firstUpHit = (rx, rz) => {
      ray.set(new THREE.Vector3(rx, scaledBox.max.y + 50, rz), down);
      ray.far = scaledSize.y + 200;
      const hits = ray.intersectObject(mapFBX, true);
      for (const h of hits) {
        if (!h.face) continue;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y > 0.4) return h.point.y;
      }
      return null;
    };
    for (let i = 0; i < 200; i++) {
      const rx = scaledCenter.x + (Math.random() - 0.5) * scaledSize.x * 0.6;
      const rz = scaledCenter.z + (Math.random() - 0.5) * scaledSize.z * 0.6;
      const y = firstUpHit(rx, rz);
      if (y != null) samples.push({ x: rx, y, z: rz });
    }
    // Street level = lowest of the topmost-hits across samples.
    samples.sort((a, b) => a.y - b.y);
    const streetY = samples.length ? samples[Math.floor(samples.length * 0.1)].y : 0;
    // Pick a spawn point whose top-hit is close to streetY.
    const streetSamples = samples.filter((s) => Math.abs(s.y - streetY) < 2);
    const spawn = streetSamples[0] || { x: scaledCenter.x, y: streetY, z: scaledCenter.z };
    // Place fallback ground just below street level so it plugs holes invisibly
    fallbackGround.position.y = streetY - 0.85;

    // Expose map bounds for clamping
    const mapBounds = {
      minX: scaledBox.min.x + 5, maxX: scaledBox.max.x - 5,
      minZ: scaledBox.min.z + 5, maxZ: scaledBox.max.z - 5,
    };

    const ui = new UI();
    const game = new Game({
      renderer, scene, camera, composer,
      playerGLB, enemyGLB, gunGLB, mapRoot: mapFBX,
      ui, spawnPoint: spawn, mapBounds, streetY,
    });

    loaderEl.classList.add('hidden');
    ui.showStart();

    document.getElementById('startBtn').addEventListener('click', () => {
      game.start();
    });
    // Click the canvas to re-lock the pointer after ESC
    renderer.domElement.addEventListener('click', () => {
      if (game.state === 'playing' && !game.player.controls.isLocked) {
        game.player.controls.lock();
      }
    });
    document.getElementById('restartBtn').addEventListener('click', () => location.reload());

    // render/resize loop
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);
    onResize();

    const clock = new THREE.Clock();
    function tick() {
      const dt = Math.min(clock.getDelta(), 0.05);
      game.update(dt);
      composer.render();
      requestAnimationFrame(tick);
    }
    tick();
  } catch (err) {
    loaderEl.innerHTML = `<div style="color:#f66">Failed to load assets.<br>${err.message || err}</div>`;
    console.error(err);
  }
})();
