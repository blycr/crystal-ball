import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  BALL_RADIUS: 3.0,
  PARTICLE_COUNT: 6000,
  PARTICLE_SIZE: 0.065,

  NOISE_SCALE: 0.3,
  FLOW_SPEED: 0.2,
  TURBULENCE: 0.003,

  GRAVITY: 0.003,
  DRAG: 0.94,
  RESTITUTION: 0.5,

  MOUSE_FORCE: 0.35,
  MOUSE_RADIUS: 1.2,
  MOUSE_SWIRL: 0.15,

  BLOOM_STRENGTH: 0.6,
  BLOOM_RADIUS: 0.5,
  BLOOM_THRESHOLD: 0.45,
};

// ============================================================
// 场景初始化
// ============================================================
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0.5, 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// ============================================================
// 环境贴图 (PMREM)
// ============================================================
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const envScene = new THREE.Scene();
[
  { c: 0x3366cc, p: [-4, 3, -4], s: 1.2 },
  { c: 0x6633cc, p: [4, -1, -3], s: 0.9 },
  { c: 0xccaa33, p: [0, 4, -2], s: 0.7 },
  { c: 0x33aaaa, p: [-2, -3, -5], s: 0.8 },
  { c: 0x222244, p: [3, 2, 2], s: 2.0 },
].forEach(({ c, p, s }) => {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(s, 16, 16),
    new THREE.MeshBasicMaterial({ color: c })
  );
  m.position.set(...p);
  envScene.add(m);
});

const generatedEnvMap = pmremGenerator.fromScene(envScene, 0.04).texture;
scene.environment = generatedEnvMap;

// ============================================================
// 灯光系统
// ============================================================
const ambientLight = new THREE.AmbientLight(0x1a1a2e, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0x88aacc, 0.8);
dirLight.position.set(4, 6, 4);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
scene.add(dirLight);

// 球心幽蓝光源 — 降低强度避免过曝
const coreLight = new THREE.PointLight(0x7766cc, 4.0, 10);
coreLight.position.set(0, 0, 0);
scene.add(coreLight);

// 底部微弱补光
const bottomLight = new THREE.PointLight(0x110033, 1.0, 6);
bottomLight.position.set(0, -3.5, 1);
scene.add(bottomLight);

// 球内多色游动光源 — 从不同角度照亮金属亮片
const innerLights = [];
const lightColors = [0xffaa44, 0x44ffcc, 0xff44aa, 0x44aaff, 0xffff88, 0x88ff44];
lightColors.forEach((c, i) => {
  const l = new THREE.PointLight(c, 2.5, 6.0);
  scene.add(l);
  innerLights.push(l);
});

// 半球填充光 — 保证粒子不会完全陷入死黑
const hemiLight = new THREE.HemisphereLight(0x4466aa, 0x221133, 0.35);
scene.add(hemiLight);

// ============================================================
// 占卜球主体 (玻璃球)
// ============================================================
const ballGeo = new THREE.SphereGeometry(CONFIG.BALL_RADIUS, 64, 64);
const ballMat = new THREE.MeshPhysicalMaterial({
  color: 0x8899bb,
  metalness: 0.0,
  roughness: 0.04,
  transmission: 0.98,
  thickness: 2.5,
  ior: 1.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.2,
  attenuationColor: new THREE.Color(0x0a0a20),
  attenuationDistance: 8.0,
});
const ballMesh = new THREE.Mesh(ballGeo, ballMat);
ballMesh.castShadow = true;
ballMesh.receiveShadow = true;
scene.add(ballMesh);

// 菲涅尔边缘光 — 勾勒球体轮廓
const rimGeo = new THREE.SphereGeometry(CONFIG.BALL_RADIUS * 1.02, 64, 64);
const rimMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.FrontSide,
  uniforms: {
    uColor: { value: new THREE.Color(0x4466ff) },
    uIntensity: { value: 0.6 },
  },
  vertexShader: /* glsl */ `
    varying float vFresnel;
    void main() {
      vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
      vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
      vFresnel = 1.0 - abs(dot(viewDir, worldNormal));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying float vFresnel;
    void main() {
      float alpha = pow(vFresnel, 3.0) * uIntensity;
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
});
const rimMesh = new THREE.Mesh(rimGeo, rimMat);
scene.add(rimMesh);

// 内部微弱体积光
const innerGeo = new THREE.SphereGeometry(CONFIG.BALL_RADIUS * 0.92, 32, 32);
const innerMat = new THREE.MeshBasicMaterial({
  color: 0x202050,
  transparent: true,
  opacity: 0.28,
  side: THREE.BackSide,
  depthWrite: false,
});
const innerMesh = new THREE.Mesh(innerGeo, innerMat);
scene.add(innerMesh);

// 底座
const standGeo = new THREE.TorusGeometry(CONFIG.BALL_RADIUS * 0.6, 0.05, 16, 64);
const standMat = new THREE.MeshStandardMaterial({
  color: 0x333355,
  metalness: 0.85,
  roughness: 0.25,
  emissive: 0x110022,
  emissiveIntensity: 0.4,
});
const stand = new THREE.Mesh(standGeo, standMat);
stand.rotation.x = Math.PI / 2;
stand.position.y = -CONFIG.BALL_RADIUS * 0.82;
scene.add(stand);

// ============================================================
// 粒子系统 (亮片)
// ============================================================
const noise3D = createNoise3D();

const positions = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
const velocities = new Float32Array(CONFIG.PARTICLE_COUNT * 3);

const PALETTE = [
  new THREE.Color(0xffd700),
  new THREE.Color(0xc0c0c0),
  new THREE.Color(0x00e5ff),
  new THREE.Color(0x9d4edd),
  new THREE.Color(0x2ec4b6),
  new THREE.Color(0xff006e),
  new THREE.Color(0x3a86ff),
];

for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
  const r = Math.cbrt(Math.random()) * (CONFIG.BALL_RADIUS * 0.9);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  positions[i * 3 + 2] = r * Math.cos(phi);
}

const particleGeo = new THREE.IcosahedronGeometry(CONFIG.PARTICLE_SIZE, 0);
const particleMat = new THREE.MeshStandardMaterial({
  metalness: 1.0,
  roughness: 0.06,
  envMapIntensity: 6.0,
});
const particles = new THREE.InstancedMesh(particleGeo, particleMat, CONFIG.PARTICLE_COUNT);
particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
  particles.setColorAt(i, PALETTE[Math.floor(Math.random() * PALETTE.length)]);
}
particles.instanceColor.needsUpdate = true;
scene.add(particles);

// ============================================================
// 流体速度场
// ============================================================
const _flowVel = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _normal = new THREE.Vector3();
const _vel = new THREE.Vector3();

function getFlowVelocity(x, y, z, time) {
  const s = CONFIG.NOISE_SCALE;
  const t = time * CONFIG.FLOW_SPEED;

  const n1x = noise3D(x * s + t, y * s, z * s);
  const n1y = noise3D(x * s, y * s + t, z * s);
  const n1z = noise3D(x * s, y * s, z * s + t);

  const n2x = noise3D(x * s * 2.0 - t * 0.7, y * s * 2.0, z * s * 2.0);
  const n2y = noise3D(x * s * 2.0, y * s * 2.0 - t * 0.7, z * s * 2.0);
  const n2z = noise3D(x * s * 2.0, y * s * 2.0, z * s * 2.0 - t * 0.7);

  // Curl-noise: 各分量交叉耦合产生涡旋
  const vx = (n1y - n1z + (n2y - n2z) * 0.5) * CONFIG.TURBULENCE;
  const vy = (n1z - n1x + (n2z - n2x) * 0.5) * CONFIG.TURBULENCE;
  const vz = (n1x - n1y + (n2x - n2y) * 0.5) * CONFIG.TURBULENCE;

  // 缓慢大尺度旋转
  const d = Math.sqrt(x * x + z * z);
  const a = Math.atan2(z, x);
  const sw = 0.002 * (1.0 - d / CONFIG.BALL_RADIUS);
  return _flowVel.set(
    vx - Math.sin(a) * sw * d,
    vy,
    vz + Math.cos(a) * sw * d
  );
}

// ============================================================
// 鼠标交互
// ============================================================
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const mouseWorldPos = new THREE.Vector3();
const mousePrevWorldPos = new THREE.Vector3();
const mouseForce = new THREE.Vector3();
const mouseInfluenceCenter = new THREE.Vector3(0, 0, -999);

let isMouseDown = false;
let isHoveringBall = false;
let hasPrevMousePos = false;

function onPointerMove(event) {
  mouseNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);
  const intersects = raycaster.intersectObject(ballMesh);

  if (intersects.length > 0) {
    isHoveringBall = true;
    mouseWorldPos.copy(intersects[0].point);
    document.body.style.cursor = isMouseDown ? 'grabbing' : 'grab';
  } else {
    isHoveringBall = false;
    document.body.style.cursor = 'default';
  }
}

function onPointerDown(event) {
  isMouseDown = true;
  if (isHoveringBall) {
    mousePrevWorldPos.copy(mouseWorldPos);
    hasPrevMousePos = true;
    document.body.style.cursor = 'grabbing';
  }
}

function onPointerUp() {
  isMouseDown = false;
  hasPrevMousePos = false;
  mouseForce.set(0, 0, 0);
  document.body.style.cursor = 'default';
}

window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointerup', onPointerUp);

window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    onPointerMove({ clientX: t.clientX, clientY: t.clientY });
    onPointerDown({ clientX: t.clientX, clientY: t.clientY });
  }
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1) {
    e.preventDefault();
    const t = e.touches[0];
    onPointerMove({ clientX: t.clientX, clientY: t.clientY });
  }
}, { passive: false });
window.addEventListener('touchend', onPointerUp);

// ============================================================
// 后处理 (Bloom)
// ============================================================
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.BLOOM_STRENGTH,
  CONFIG.BLOOM_RADIUS,
  CONFIG.BLOOM_THRESHOLD
);
composer.addPass(bloomPass);

// ============================================================
// 动画循环
// ============================================================
const clock = new THREE.Clock();

function updateMouseForce() {
  if (!isMouseDown || !isHoveringBall || !hasPrevMousePos) {
    mouseForce.set(0, 0, 0);
    mouseInfluenceCenter.set(0, 0, -999);
    return;
  }
  const delta = _vel.copy(mouseWorldPos).sub(mousePrevWorldPos);
  const maxDelta = 0.3;
  if (delta.length() > maxDelta) delta.normalize().multiplyScalar(maxDelta);
  mouseForce.copy(delta).multiplyScalar(CONFIG.MOUSE_FORCE);
  mouseInfluenceCenter.copy(mouseWorldPos);
  mousePrevWorldPos.copy(mouseWorldPos);
}

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  updateMouseForce();

  // 核心光源脉动
  coreLight.intensity = 2.2 + Math.sin(time * 1.2) * 0.6;
  coreLight.color.setHSL(0.72 + Math.sin(time * 0.25) * 0.02, 0.75, 0.5);

  // 多色游动光源在球内漂移
  innerLights.forEach((light, i) => {
    const t = time * 0.35 + i * 1.57;
    light.position.set(
      Math.sin(t) * 2.0,
      Math.cos(t * 0.8) * 1.6,
      Math.sin(t * 0.6) * 1.4
    );
  });

  // 更新边缘光颜色
  rimMat.uniforms.uColor.value.setHSL(
    0.65 + Math.sin(time * 0.4) * 0.05,
    0.8,
    0.55 + Math.sin(time * 0.7) * 0.1
  );

  const r = CONFIG.BALL_RADIUS * 0.94;
  const rSq = r * r;
  const mouseRSq = CONFIG.MOUSE_RADIUS * CONFIG.MOUSE_RADIUS;

  for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
    const ix = i * 3;
    const iy = ix + 1;
    const iz = ix + 2;

    const px = positions[ix];
    const py = positions[iy];
    const pz = positions[iz];

    // 1. 流体速度场
    const flow = getFlowVelocity(px, py, pz, time);
    velocities[ix] += flow.x;
    velocities[iy] += flow.y;
    velocities[iz] += flow.z;

    // 2. 鼠标力
    const dx = px - mouseInfluenceCenter.x;
    const dy = py - mouseInfluenceCenter.y;
    const dz = pz - mouseInfluenceCenter.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq < mouseRSq && mouseForce.lengthSq() > 0.0001) {
      const influence = 1.0 - distSq / mouseRSq;
      const influenceSq = influence * influence;
      velocities[ix] += mouseForce.x * influenceSq;
      velocities[iy] += mouseForce.y * influenceSq;
      velocities[iz] += mouseForce.z * influenceSq;

      const sw = CONFIG.MOUSE_SWIRL * influenceSq;
      velocities[ix] += (-dy * mouseForce.z + dz * mouseForce.y) * sw;
      velocities[iy] += (-dz * mouseForce.x + dx * mouseForce.z) * sw;
      velocities[iz] += (-dx * mouseForce.y + dy * mouseForce.x) * sw;
    }

    // 3. 重力
    velocities[iy] -= CONFIG.GRAVITY;

    // 4. 更新位置
    positions[ix] += velocities[ix];
    positions[iy] += velocities[iy];
    positions[iz] += velocities[iz];

    // 5. 边界碰撞
    const newDistSq = positions[ix] ** 2 + positions[iy] ** 2 + positions[iz] ** 2;
    if (newDistSq > rSq) {
      const newDist = Math.sqrt(newDistSq);
      const penetration = newDist - r;
      _normal.set(positions[ix], positions[iy], positions[iz]).normalize();

      const pushBack = penetration + 0.015;
      positions[ix] -= _normal.x * pushBack;
      positions[iy] -= _normal.y * pushBack;
      positions[iz] -= _normal.z * pushBack;

      const vn = velocities[ix] * _normal.x + velocities[iy] * _normal.y + velocities[iz] * _normal.z;
      if (vn > 0) {
        velocities[ix] -= _normal.x * vn * (1 + CONFIG.RESTITUTION);
        velocities[iy] -= _normal.y * vn * (1 + CONFIG.RESTITUTION);
        velocities[iz] -= _normal.z * vn * (1 + CONFIG.RESTITUTION);
      }
      velocities[ix] *= 0.93;
      velocities[iy] *= 0.93;
      velocities[iz] *= 0.93;
    }

    // 6. 阻力
    velocities[ix] *= CONFIG.DRAG;
    velocities[iy] *= CONFIG.DRAG;
    velocities[iz] *= CONFIG.DRAG;

    // 7. 微扰动 (防止完全静止)
    if (Math.abs(velocities[ix]) < 0.00005 && Math.abs(velocities[iy]) < 0.00005 && Math.abs(velocities[iz]) < 0.00005) {
      if (Math.random() < 0.003) {
        velocities[ix] += (Math.random() - 0.5) * 0.0003;
        velocities[iy] += (Math.random() - 0.5) * 0.0003;
        velocities[iz] += (Math.random() - 0.5) * 0.0003;
      }
    }

    // 8. 更新矩阵 (仅位置，不拉伸)
    _dummy.position.set(positions[ix], positions[iy], positions[iz]);
    _dummy.rotation.set(
      time * 0.3 + i * 0.1,
      time * 0.2 + i * 0.05,
      0
    );
    _dummy.updateMatrix();
    particles.setMatrixAt(i, _dummy.matrix);
  }

  particles.instanceMatrix.needsUpdate = true;
  composer.render();
}

// ============================================================
// 窗口自适应
// ============================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
