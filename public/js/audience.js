let currentSession = null;

let panopticonParent; 
const socket = io();

let scene, camera, renderer;
let blob, panopticon, lights = [];
let windowMeshes = [];
let mixer, morphTargets;
const clock = new THREE.Clock();
let controls;

let particles = [];
let ruptureStartTime = null;
let transmutationStarted = false;

let currentState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting',
    gazePoints: []
};

// 初始化
function init() {
    console.log('Initializing audience view...');
    scene = new THREE.Scene();
    
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / (window.innerHeight * 0.7),
        0.1,
        1000
    );
    
    // 观众视角：从高墙上往下看
    camera.position.set(8, 2, 0);
    camera.lookAt(0, 0, 0);
    
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight * 0.7);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
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

    console.log('Scene, camera, renderer created');
    
    createLights();
    console.log('Lights created');
    
    // createPanopticon();
    // console.log('Panopticon created');
    
    loadBlobModel();
    
    window.addEventListener('resize', onWindowResize);
}

// 加载 GLB 模型
function loadBlobModel() {
    console.log('Loading GLB...');
    
    const loader = new THREE.GLTFLoader();
    
    loader.load(
        '/models/blob02.glb',
        
        function (gltf) {
            console.log('GLB loaded successfully');
            
            blob = gltf.scene;
            scene.add(blob);
            blob.position.set(0, 0, 0);
            blob.scale.set(1, 1, 1);
            
            blob.traverse((child) => {
                if (child.isMesh) {
                    console.log('Found mesh:', child.name);
                    
                    if (child.material) {
                        child.material.side = THREE.FrontSide;
                        child.material.envMapIntensity = 1.0;
                        
                        const textureMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
                        
                        textureMaps.forEach(mapName => {
                            const texture = child.material[mapName];
                            if (texture) {
                                texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                                texture.minFilter = THREE.LinearMipmapLinearFilter;
                                texture.magFilter = THREE.LinearFilter;
                                
                                if (mapName === 'map' || mapName === 'emissiveMap') {
                                    texture.colorSpace = THREE.SRGBColorSpace;
                                }
                                
                                texture.needsUpdate = true;
                            }
                        });
                        
                        child.material.needsUpdate = true;
                    }
                    
                    if (child.morphTargetInfluences) {
                        console.log('Morph targets found:', child.morphTargetInfluences.length);
                        morphTargets = child.morphTargetInfluences;
                        for (let i = 0; i < morphTargets.length; i++) {
                            morphTargets[i] = 0;
                        }
                    }
                }
            });
            
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(blob);
                const action = mixer.clipAction(gltf.animations[0]);
                action.play();
            }
            
            console.log('Blob setup complete');
            animate();
        },
        
        function (xhr) {
            console.log('Loading:', (xhr.loaded / xhr.total * 100).toFixed(0) + '%');
        },
        
        function (error) {
            console.error('Error loading GLB:', error);
        }
    );
}

// // 创建Panopticon环境
// function createPanopticon() {
//     panopticon = new THREE.Group();
    
//     const wallGeometry = new THREE.CylinderGeometry(10, 10, 6, 32, 1, true);
//     const wallMaterial = new THREE.MeshStandardMaterial({
//         color: 0x222222,
//         side: THREE.BackSide,
//         metalness: 0.5,
//         roughness: 0.7
//     });
//     const walls = new THREE.Mesh(wallGeometry, wallMaterial);
//     walls.receiveShadow = true;
//     panopticon.add(walls);
    
//     const floorGeometry = new THREE.CircleGeometry(10, 32);
//     const floorMaterial = new THREE.MeshStandardMaterial({
//         color: 0x111111,
//         metalness: 0.2,
//         roughness: 0.8
//     });
//     const floor = new THREE.Mesh(floorGeometry, floorMaterial);
//     floor.rotation.x = -Math.PI / 2;
//     floor.position.y = -3;
//     floor.receiveShadow = true;
//     panopticon.add(floor);
    
//     const gridHelper = new THREE.GridHelper(20, 20, 0x00ffff, 0x00ffff);
//     gridHelper.position.y = -2.9;
//     gridHelper.material.opacity = 0.2;
//     gridHelper.material.transparent = true;
//     panopticon.add(gridHelper);
    
//     scene.add(panopticon);
// }

// 创建灯光
function createLights() {
    const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0x292929, 0.6);
    scene.add(hemiLight);
    
    const spotLight = new THREE.SpotLight(0xffffff, 2);
    spotLight.position.set(0, 10, 0);
    spotLight.castShadow = true;
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.5;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    spotLight.shadow.bias = -0.0001;
    scene.add(spotLight);
    lights.push(spotLight);

    const dirLight = new THREE.DirectionalLight(0xfff4e5, 2);
    dirLight.position.set(-30, 50, -30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);
}

// 创建爆炸粒子
function createExplosionParticles() {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    
    // 从 blob 的位置发射粒子
    for (let i = 0; i < particleCount; i++) {
        // 初始位置：接近中心
        positions.push(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        );
        
        // 随机速度：向外爆炸
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const speed = 0.05 + Math.random() * 0.1;
        
        velocities.push(
            Math.sin(phi) * Math.cos(theta) * speed,
            Math.sin(phi) * Math.sin(theta) * speed,
            Math.cos(phi) * speed
        );
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
        color: 0xff0000,
        size: 0.2,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
    });
    
    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
    
    return {
        system: particleSystem,
        velocities: velocities,
        life: 1.0
    };
}

// 更新爆炸粒子
function updateExplosionParticles() {
    particles.forEach((particle, index) => {
        const positions = particle.system.geometry.attributes.position.array;
        
        // 更新每个粒子位置
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += particle.velocities[i];
            positions[i + 1] += particle.velocities[i + 1];
            positions[i + 2] += particle.velocities[i + 2];
            
            // 添加重力
            particle.velocities[i + 1] -= 0.001;
        }
        
        particle.system.geometry.attributes.position.needsUpdate = true;
        
        // 粒子生命值衰减
        particle.life -= 0.01;
        particle.system.material.opacity = particle.life;
        
        // 移除死亡粒子
        if (particle.life <= 0) {
            scene.remove(particle.system);
            particles.splice(index, 1);
        }
    });
}

// 更新材质
function updateBlobMaterial() {
    if (!blob) return;
    
    const phase = currentState.phase;
    let color = 0xffffff; 
    let emissiveIntensity = 0.0;
    
    switch(phase) {
        case 'waiting':
            color = 0xffffff;
            emissiveIntensity = 0.0;
            break;
        case 'stable':
            color = 0x404040;
            emissiveIntensity = 0.3;
            break;
        case 'critical':
            color = 0xffff00;
            emissiveIntensity = 0.5;
            break;
        case 'rupture':
            color = 0xff0000;
            emissiveIntensity = 0.8;
            break;
        case 'transmutation':
            color = 0xffd700;
            emissiveIntensity = 1.0;
            break;
        default:
            color = 0xffffff;
            emissiveIntensity = 0.0;
    }
    
    blob.traverse((child) => {
        if (child.isMesh && child.material) {
            if (child.material.color) {
                child.material.color.setHex(color);
            }
            if (child.material.emissive) {
                child.material.emissive.setHex(emissiveIntensity > 0 ? color : 0x000000);
            }
            if (child.material.emissiveIntensity !== undefined) {
                child.material.emissiveIntensity = emissiveIntensity;
            }
        }
    });
}

// 更新窗口
function updateWindows() {
    return;
}

// 更新形态键
function updateBlobMorph() {
    if (!morphTargets || morphTargets.length === 0) return;
    
    const pressure = currentState.totalPressure;
    const normalizedPressure = Math.min(pressure / 100, 1.0);
    morphTargets[0] = normalizedPressure;
}

// // 动画循环
// function animate() {
//     requestAnimationFrame(animate);

//     if (mixer) {
//         const delta = clock.getDelta();
//         mixer.update(delta);
//     }

//     updateBlobMorph();
//     updateBlobMaterial();
//     updateWindows();
    
//     if (currentState.phase === 'transmutation' && blob) {
//         blob.position.y += 0.01;
        
//         if (panopticon) {
//             panopticon.children.forEach(child => {
//                 if (child.material) {
//                     child.material.opacity = Math.max(0, child.material.opacity - 0.01);
//                     child.material.transparent = true;
//                 }
//             });
//         }
//     }
    
//     renderer.render(scene, camera);
// }

function animate() {
    requestAnimationFrame(animate);
    
    if (mixer) {
        const delta = clock.getDelta();
        mixer.update(delta);
    }
    
    updateBlobMorph();
    updateBlobMaterial();
    updateWindows();
    
    const phase = currentState.phase;
    
    // ⭐ Rupture 阶段：爆炸效果
    if (phase === 'rupture') {
        if (!ruptureStartTime) {
            ruptureStartTime = Date.now();
            console.log('Rupture started!');
        }
        
        const ruptureTime = (Date.now() - ruptureStartTime) / 1000; // 秒
        
        if (blob) {
            // 剧烈抖动
            blob.position.x = (Math.random() - 0.5) * 0.3;
            blob.position.y = (Math.random() - 0.5) * 0.3;
            blob.position.z = (Math.random() - 0.5) * 0.3;
            
            // 快速旋转
            blob.rotation.x += 0.05;
            blob.rotation.y += 0.08;
            blob.rotation.z += 0.03;
        }
        
        // Panopticon 震动和裂开
        if (panopticon) {
            panopticon.children.forEach(child => {
                if (child.material) {
                    // 逐渐变透明
                    if (child.material.opacity === undefined) {
                        child.material.transparent = true;
                        child.material.opacity = 1.0;
                    }
                    child.material.opacity -= 0.005;
                    
                    // 墙壁震动
                    if (child.geometry.type === 'CylinderGeometry') {
                        child.position.x = (Math.random() - 0.5) * 0.1;
                        child.position.z = (Math.random() - 0.5) * 0.1;
                    }
                }
            });
        }
        
        // 1秒后开始生成爆炸粒子
        if (ruptureTime > 1.0 && particles.length < 5) {
            particles.push(createExplosionParticles());
        }
        
        // 2秒后，物体消失
        if (ruptureTime > 2.0 && blob) {
            blob.visible = false;
        }
    }
    
    // ⭐ Transmutation 阶段：重生
    if (phase === 'transmutation') {
        if (!transmutationStarted) {
            transmutationStarted = true;
            ruptureStartTime = null;
            console.log('Transmutation started - resetting blob');
            
            // 重置 blob
            if (blob) {
                blob.visible = true;
                blob.position.set(0, -5, 0); // 从下方开始
                blob.rotation.set(0, 0, 0);
                blob.scale.set(1, 1, 1);
                
                // 重置形态键
                if (morphTargets) {
                    for (let i = 0; i < morphTargets.length; i++) {
                        morphTargets[i] = 0;
                    }
                }
            }
            
            // 清除所有粒子
            particles.forEach(particle => {
                scene.remove(particle.system);
            });
            particles = [];
        }
        
        // 物体上升
        if (blob && blob.position.y < 0) {
            blob.position.y += 0.05;
        }
        
        // Panopticon 逐渐恢复
        if (panopticon) {
            panopticon.children.forEach(child => {
                if (child.material && child.material.opacity !== undefined) {
                    child.material.opacity = Math.min(1.0, child.material.opacity + 0.01);
                }
                
                // 重置位置
                if (child.geometry.type === 'CylinderGeometry') {
                    child.position.x = 0;
                    child.position.z = 0;
                }
            });
        }
        
        // 缓慢旋转
        if (blob) {
            blob.rotation.y += 0.002;
        }
    }
    
    // 其他阶段重置标志
    if (phase !== 'rupture') {
        ruptureStartTime = null;
    }
    if (phase !== 'transmutation') {
        transmutationStarted = false;
    }
    
    // 更新粒子
    if (particles.length > 0) {
        updateExplosionParticles();
    }
    
    renderer.render(scene, camera);
}

// 窗口大小调整
function onWindowResize() {
    camera.aspect = window.innerWidth / (window.innerHeight * 0.7);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight * 0.7);
}

// Socket.io事件
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join-as', 'audience');
});

socket.on('initial-state', (state) => {
    currentState = state;
    updateUI();
});

socket.on('state-update', (state) => {
    currentState = state;
    updateUI();
});

// 更新UI
function updateUI() {
    document.getElementById('watcher-count').textContent = currentState.watchers;
    document.getElementById('pressure-level').textContent = Math.floor(currentState.totalPressure);
    document.getElementById('phase-status').textContent = currentState.phase.toUpperCase();
    
    document.body.className = `audience-view phase-${currentState.phase}`;
}

// 按钮交互
const gazeBtn = document.getElementById('gaze-btn');
let isGazing = false;
let gazeInterval;

gazeBtn.addEventListener('mousedown', startGaze);
gazeBtn.addEventListener('touchstart', startGaze);
gazeBtn.addEventListener('mouseup', endGaze);
gazeBtn.addEventListener('touchend', endGaze);
gazeBtn.addEventListener('mouseleave', endGaze);

function startGaze(e) {
    e.preventDefault();
    if (isGazing) return;
    
    isGazing = true;
    gazeBtn.classList.add('gazing');
    document.getElementById('btn-text').textContent = 'GAZING...';
    
    socket.emit('gaze-start');
    
    gazeInterval = setInterval(() => {
        socket.emit('gaze-hold');
    }, 100);
}

function endGaze(e) {
    if (e) e.preventDefault();
    if (!isGazing) return;
    
    isGazing = false;
    gazeBtn.classList.remove('gazing');
    document.getElementById('btn-text').textContent = 'HOLD TO GAZE';
    
    clearInterval(gazeInterval);
    socket.emit('gaze-end');
}

window.addEventListener('load', init);