// ========== 常量配置 ==========
const CONFIG = {
    SHAKE_INTENSITY: 0.15,
    BLOB_SCALE_RUPTURE: 1.5,
    FADE_SPEED: 0.01,
    FLOAT_SPEED: 0.005,
    ROTATION_SPEED: 0.02
};

// ========== 全局变量 ==========
const socket = io();
const clock = new THREE.Clock();

let scene, camera, renderer, controls;
let blob, panopticon, panopticonParent;
let mixer, morphTargets;
let lights = [];
let debrisSystem = null;
let transmutationStarted = false;

let currentState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting',
    gazePoints: []
};

// ========== 初始化 ==========
function init() {
    console.log('Initializing...');
    scene = new THREE.Scene();
    
    const container = document.getElementById('viewport-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 2.1, 0);
    camera.lookAt(0, 1, -5);
    
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    new THREE.RGBELoader()
        .load('sky.hdr', function (texture) {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            scene.background = envMap;
            scene.environment = envMap;
            texture.dispose();
            pmremGenerator.dispose();
            console.log('Environment loaded successfully');
        }, undefined, function (error) {
            console.error('Failed to load environment:', error);
            scene.background = new THREE.Color(0x263238);
        });

    controls = new THREE.PointerLockControls(camera, renderer.domElement);

    renderer.domElement.addEventListener('click', () => {
        controls.lock();
    });
    
    console.log('OrbitControls created');
    
    createLights();
    loadBlobModel();

    // 监听 Esc 键解锁鼠标
    controls.addEventListener('unlock', () => {
        console.log('Camera unlocked');
    });

    window.addEventListener('resize', onWindowResize);
}

// ========== 模型加载 ==========
function loadBlobModel() {
    const loader = new THREE.GLTFLoader();
    
    loader.load('/models/blob02.glb', function (gltf) {
        console.log('GLB loaded');
        
        const model = gltf.scene;
        scene.add(model);

        model.traverse((child) => {
            if (child.isMesh) {
                if (child.name.includes('Self')) {
                    blob = child;
                    blob.scale.set(1, 1, 1);
                    blob.position.set(0, 1, 0); 
                    setupBlobMaterial(child);
                    if (child.morphTargetInfluences) {
                        morphTargets = child.morphTargetInfluences;
                    }
                }
                
                if (child.name.includes('Panopticon')) {
                    panopticon = child;
                    panopticon.position.set(0, 0, 0); 
                    setupPanopticon(child);
                }
            }
        });

                console.log('Model position:', model.position);
console.log('Blob position:', blob?.position);
console.log('Blob scale:', blob?.scale);
console.log('Panopticon scale:', panopticonParent?.scale);
        
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            mixer.clipAction(gltf.animations[0]).play();
        }
        
        renderer.setAnimationLoop(animate);
    });
}


// ========== 材质设置辅助函数 ==========
function setupBlobMaterial(mesh) {
    if (!mesh.material) return;
    mesh.material.metalness = 1.0;
    mesh.material.roughness = 0.1;
    mesh.material.envMapIntensity = 1.5;
    mesh.material.emissive = new THREE.Color(0x000000);
}

function setupPanopticon(mesh) {
    panopticonParent = new THREE.Group();
    (mesh.parent || scene).add(panopticonParent);
    panopticonParent.add(mesh);
    panopticonParent.scale.set(0.01, 0.01, 0.01);
    
    if (mesh.material) {
        mesh.material.color.setHex(0x1a1a1a);
        mesh.material.metalness = 0.6;
        mesh.material.roughness = 0.4;
        mesh.material.side = THREE.DoubleSide;
        mesh.material.transparent = true;
        mesh.material.opacity = 1.0;
    }
}

// ========== 灯光系统 ==========
function createLights() {
    const ambientLight = new THREE.AmbientLight(0x404040, 3.0);
    scene.add(ambientLight);
    lights.push(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.radius = 4;
    mainLight.shadow.bias = -0.0001;
    scene.add(mainLight);
    lights.push(mainLight);

    const rimLight = new THREE.PointLight(0x00ffff, 0.5);
    rimLight.position.set(-10, 5, -10);
    scene.add(rimLight);
    lights.push(rimLight);
}

// ========== Blob 材质与形态更新 ==========
function updateBlobMaterial() {
    if (!blob) return;
    
    const phaseConfig = {
        waiting: { color: 0xffffff, intensity: 0.0 },
        stable: { color: 0x404040, intensity: 0.3 },
        critical: { 
            color: Math.floor(Date.now() / 50) % 2 === 0 ? 0xff0000 : 0xffff00,
            intensity: Math.floor(Date.now() / 50) % 2 === 0 ? 0.8 : 0.4
        },
        rupture: { color: 0xff0000, intensity: 0.8 },
        transmutation: { color: 0xffd700, intensity: 1.0 }
    };
    
    const config = phaseConfig[currentState.phase] || phaseConfig.waiting;
    
    blob.traverse((child) => {
        if (child.isMesh && child.material) {
            if (child.material.color) child.material.color.setHex(config.color);
            if (child.material.emissive) {
                child.material.emissive.setHex(config.intensity > 0 ? config.color : 0x000000);
            }
            if (child.material.emissiveIntensity !== undefined) {
                child.material.emissiveIntensity = config.intensity;
            }
        }
    });
}

function updateBlobMorph() {
    if (!morphTargets || morphTargets.length === 0) return;
    const normalizedPressure = Math.min(currentState.totalPressure / 100, 1.0);
    morphTargets[0] = normalizedPressure;
}

// ========== 震动效果 ==========
function applyVibration(object, intensity) {
    if (!object) return;
    
    object.position.x = (Math.random() - 0.5) * intensity;
    object.position.z = (Math.random() - 0.5) * intensity;
    
    if (Math.random() > 0.9) {
        const scaleGlitch = 1.0 + (Math.random() - 0.5) * 0.05;
        object.scale.set(scaleGlitch, scaleGlitch, scaleGlitch);
    } else {
        object.scale.set(1, 1, 1);
    }
}

function resetObjectTransform(object) {
    if (!object) return;
    object.position.set(0, 0, 0);
    object.scale.set(1, 1, 1);
}

// ========== 爆炸与粒子效果 ==========
function createExplosion() {
    if (debrisSystem || !panopticon) return;

    panopticon.visible = false;
    const geometry = panopticon.geometry;
    const posAttribute = geometry.attributes.position;
    const count = posAttribute.count;

    const particleGeometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    const colors = [];

    const color1 = new THREE.Color(0x00ffff);
    const color2 = new THREE.Color(0xff00ff);
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);
        
        positions.push(x, y, z);

        const vec = new THREE.Vector3(x, 0, z).normalize();
        const speed = 0.5 + Math.random() * 0.5;
        
        velocities.push(
            vec.x * speed,
            (Math.random() - 0.5) * 0.5,
            vec.z * speed
        );

        tempColor.lerpColors(color1, color2, Math.random());
        colors.push(tempColor.r, tempColor.g, tempColor.b);
    }

    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.3,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
    });

    debrisSystem = new THREE.Points(particleGeometry, material);
    debrisSystem.userData = { velocities };
    debrisSystem.scale.copy(panopticon.scale);
    debrisSystem.position.copy(panopticon.position);
    debrisSystem.rotation.copy(panopticon.rotation);
    
    scene.add(debrisSystem);
}

function updateExplosion() {
    if (!debrisSystem) return;

    const positions = debrisSystem.geometry.attributes.position.array;
    const velocities = debrisSystem.userData.velocities;
    
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += velocities[i];
        positions[i+1] += velocities[i+1];
        positions[i+2] += velocities[i+2];
    }
    
    debrisSystem.geometry.attributes.position.needsUpdate = true;
    debrisSystem.material.opacity -= CONFIG.FADE_SPEED;
    
    if (debrisSystem.material.opacity <= 0) {
        scene.remove(debrisSystem);
        debrisSystem = null;
    }
}

// ========== 场景切换 ==========
function switchToWarmWorld() {
    scene.background = new THREE.Color(0xffe4b5);
    scene.fog = new THREE.FogExp2(0xffe4b5, 0.01);
    
    lights.forEach(light => {
        if (light.isAmbientLight) {
            light.color.setHex(0xffffff);
            light.intensity = 2.0;
        }
        if (light.isDirectionalLight) {
            light.color.setHex(0xffd700);
            light.intensity = 1.0;
        }
        if (light.isPointLight) {
            light.intensity = 0;
        }
    });

    if (panopticon) panopticon.visible = false;
    if (debrisSystem) {
        scene.remove(debrisSystem);
        debrisSystem = null;
    }
}

// ========== 动画循环 ==========
function animate() {
    if (mixer) mixer.update(clock.getDelta());
    
    updateBlobMorph();
    updateBlobMaterial();
    
    const phase = currentState.phase;

    // Critical phase: 震动效果
    if (phase === 'critical') {
        applyVibration(panopticon, CONFIG.SHAKE_INTENSITY);
        applyVibration(blob, CONFIG.SHAKE_INTENSITY * 0.5);
    } else if (phase === 'waiting' || phase === 'stable') {
        resetObjectTransform(panopticon);
        if (blob) {
            blob.position.x = 0;
            blob.position.z = 0;
            blob.scale.set(1, 1, 1);
        }
    }

    // Rupture phase: 爆炸
    if (phase === 'rupture') {
        createExplosion();
        updateExplosion();
        
        if (blob) {
            const target = CONFIG.BLOB_SCALE_RUPTURE;
            blob.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
            blob.rotation.y += CONFIG.ROTATION_SPEED;
        }

        if (panopticon) {
            panopticon.children.forEach(child => {
                if (child.visible && child.material) {
                    child.material.transparent = true;
                    if (child.material.opacity > 0) {
                        child.material.opacity -= 0.02;
                    } else {
                        child.visible = false;
                    }
                }
            });
        }
    }
    
    // Transmutation phase: 重生
    if (phase === 'transmutation') {
        if (!transmutationStarted) {
            transmutationStarted = true;
            switchToWarmWorld();
            
            if (blob) {
                blob.position.set(0, 0, 0);
                blob.scale.set(1, 1, 1);
            }
        }
        
        if (blob) {
            blob.rotation.y += CONFIG.FLOAT_SPEED;
            blob.position.y = Math.sin(Date.now() * 0.001) * 0.5;
        }
    }

    if (phase !== 'transmutation') {
        transmutationStarted = false;
    }
    
    renderer.render(scene, camera);
}

// ========== 窗口调整 ==========
function onWindowResize() {
    const container = document.getElementById('viewport-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// ========== Socket 通信 ==========
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join-as', 'experiencer');
});

socket.on('initial-state', (state) => {
    currentState = state;
    updateUI();
});

socket.on('state-update', (state) => {
    currentState = state;
    updateUI();
    
    const transformBtn = document.getElementById('transform-btn');
    if (transformBtn) {
        transformBtn.style.display = state.phase === 'rupture' ? 'block' : 'none';
    }
});

function updateUI() {
    const watcherCount = document.getElementById('watcher-count');
    const pressureLevel = document.getElementById('pressure-level');
    const phaseStatus = document.getElementById('phase-status');
    
    if (watcherCount) watcherCount.textContent = currentState.watchers;
    if (pressureLevel) pressureLevel.textContent = Math.floor(currentState.totalPressure);
    if (phaseStatus) phaseStatus.textContent = currentState.phase.toUpperCase();
    
    document.body.className = `experience-view phase-${currentState.phase}`;
}

const transformBtn = document.getElementById('transform-btn');
if (transformBtn) {
    transformBtn.addEventListener('click', () => {
        socket.emit('trigger-transmutation');
    });
}

window.addEventListener('load', init);