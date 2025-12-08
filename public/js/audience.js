// Socket.io连接
const socket = io();

// Three.js场景设置
let scene, camera, renderer;
let blob, panopticon, lights = [];
let windowMeshes = [];

let mixer, morphTargets;
const clock = new THREE.Clock();

// 游戏状态
let currentState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting',
    gazePoints: []
};

// 初始化
function init() {
    // 创建场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 10, 50);
    
    // 创建相机
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / (window.innerHeight * 0.7),
        0.1,
        1000
    );
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);
    
    // 创建渲染器
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight * 0.7);
    renderer.shadowMap.enabled = true;

    loadBlobModel();
    console.log('Loading blob model...');
    
    // 创建Panopticon
    createPanopticon();
    
    // 创建灯光
    createLights();
    
    // 窗口大小调整
    window.addEventListener('resize', onWindowResize);
    
    // 开始动画循环
    animate();
}

// // 创建中心的几何体
// function createBlob() {
//     const geometry = new THREE.IcosahedronGeometry(1.5, 3);
//     const material = new THREE.MeshStandardMaterial({
//         color: 0x00ffff,
//         metalness: 0.3,
//         roughness: 0.4,
//         emissive: 0x00ffff,
//         emissiveIntensity: 0.2
//     });
    
//     blob = new THREE.Mesh(geometry, material);
//     blob.castShadow = true;
//     scene.add(blob);
    
//     // 保存原始顶点位置
//     blob.geometry.userData.originalPositions = blob.geometry.attributes.position.array.slice();
// }

// 加载 GLB 模型
function loadBlobModel() {
    console.log('Starting to load GLB model...');
    
    const loader = new THREE.GLTFLoader();
    
    loader.load(
        '/models/blob01.glb',  // GLB文件路径
        
        // 成功加载后的回调
        function (gltf) {
            console.log('GLB Model loaded successfully!', gltf);
            
            // 获取整个模型场景
            blob = gltf.scene;
            
            // 添加到Three.js场景
            scene.add(blob);
            
            // 设置位置和大小
            blob.position.set(0, 0, 0);
            blob.scale.set(1, 1, 1);
            
            // 遍历模型，找到有morph targets的mesh
            blob.traverse((child) => {
                if (child.isMesh) {
                    console.log('Found mesh:', child.name);
                    
                    if (child.morphTargetInfluences) {
                        console.log('This mesh has morph targets!');
                        console.log('Morph targets count:', child.morphTargetInfluences.length);
                        
                        // 保存morph targets的引用
                        morphTargets = child.morphTargetInfluences;
                        
                        // 初始化所有morph targets为0
                        for (let i = 0; i < morphTargets.length; i++) {
                            morphTargets[i] = 0;
                        }
                    }
                }
            });
            
            // 如果模型包含动画（可能没有）
            if (gltf.animations && gltf.animations.length > 0) {
                console.log('Found animations:', gltf.animations.length);
                mixer = new THREE.AnimationMixer(blob);
                const action = mixer.clipAction(gltf.animations[0]);
                action.play();
            }
            
            console.log('Blob model setup complete!');
        },
        
        // 加载进度的回调
        function (xhr) {
            const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
            console.log(`Loading model: ${percent}%`);
        },
        
        // 加载失败的回调
        function (error) {
            console.error('Error loading GLB model:', error);
            alert('Failed to load 3D model');
        }
    );
}

// 创建Panopticon环境
function createPanopticon() {
    panopticon = new THREE.Group();
    
    // 创建墙壁（圆柱形）
    const wallGeometry = new THREE.CylinderGeometry(10, 10, 6, 32, 1, true);
    const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0x222222,
        side: THREE.BackSide,
        metalness: 0.5,
        roughness: 0.7
    });
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.receiveShadow = true;
    panopticon.add(walls);
    
    // 创建地面
    const floorGeometry = new THREE.CircleGeometry(10, 32);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        metalness: 0.2,
        roughness: 0.8
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    floor.receiveShadow = true;
    panopticon.add(floor);
    
    // 创建网格
    const gridHelper = new THREE.GridHelper(20, 20, 0x0ff, 0x0ff);
    gridHelper.position.y = -2.9;
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    panopticon.add(gridHelper);
    
    // 创建窗口（12个）
    const windowCount = 12;
    for (let i = 0; i < windowCount; i++) {
        const angle = (i / windowCount) * Math.PI * 2;
        createWindow(angle, i);
    }
    
    scene.add(panopticon);
}

// 创建单个窗口
function createWindow(angle, index) {
    const windowGroup = new THREE.Group();
    
    // 窗框
    const frameGeometry = new THREE.PlaneGeometry(1.5, 2);
    const frameMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    
    // 光束（初始不可见）
    const beamGeometry = new THREE.CylinderGeometry(0.05, 0.3, 10, 8);
    const beamMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.rotation.x = Math.PI / 2;
    beam.position.z = -5;
    
    windowGroup.add(frame);
    windowGroup.add(beam);
    
    // 定位
    const radius = 9.5;
    windowGroup.position.x = Math.cos(angle) * radius;
    windowGroup.position.z = Math.sin(angle) * radius;
    windowGroup.position.y = 0;
    windowGroup.lookAt(0, 0, 0);
    
    panopticon.add(windowGroup);
    windowMeshes.push({ frame, beam, active: false });
}

// 创建灯光
function createLights() {
    // 环境光
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    // 顶部聚光灯
    const spotLight = new THREE.SpotLight(0xffffff, 1);
    spotLight.position.set(0, 10, 0);
    spotLight.target = blob;
    spotLight.castShadow = true;
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.5;
    scene.add(spotLight);
    
    lights.push(spotLight);
}

// // 更新几何体变形
// function updateBlobDeformation() {
//     const positions = blob.geometry.attributes.position.array;
//     const originalPositions = blob.geometry.userData.originalPositions;
    
//     const pressure = currentState.totalPressure;
//     const phase = currentState.phase;
    
//     // 根据phase不同变形
//     for (let i = 0; i < positions.length; i += 3) {
//         const ox = originalPositions[i];
//         const oy = originalPositions[i + 1];
//         const oz = originalPositions[i + 2];
        
//         let deformation = 0;
        
//         if (phase === 'stable') {
//             // 轻微波动
//             deformation = Math.sin(Date.now() * 0.001 + i) * 0.05;
//         } else if (phase === 'unstable') {
//             // 开始长尖刺
//             deformation = Math.sin(Date.now() * 0.003 + i) * 0.2;
//         } else if (phase === 'critical') {
//             // 剧烈变形
//             deformation = Math.sin(Date.now() * 0.005 + i) * 0.5;
//         } else if (phase === 'rupture') {
//             // 爆炸前的剧烈抖动
//             deformation = (Math.random() - 0.5) * 1.5;
//         } else if (phase === 'transmutation') {
//             // 平滑，发光
//             deformation = Math.sin(Date.now() * 0.001 + i) * 0.1;
//         }
        
//         // 应用变形
//         const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
//         const scale = 1 + deformation;
        
//         positions[i] = ox * scale;
//         positions[i + 1] = oy * scale;
//         positions[i + 2] = oz * scale;
//     }
    
//     blob.geometry.attributes.position.needsUpdate = true;
//     blob.geometry.computeVertexNormals();
// }

// 更新材质颜色
function updateBlobMaterial() {
    const phase = currentState.phase;
    
    let color, emissiveIntensity;
    
    switch(phase) {
        case 'stable':
            color = 0x00ffff;
            emissiveIntensity = 0.2;
            break;
        case 'unstable':
            color = 0x00ff88;
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
            color = 0x00ffff;
            emissiveIntensity = 0.1;
    }
    
    blob.material.color.setHex(color);
    blob.material.emissive.setHex(color);
    blob.material.emissiveIntensity = emissiveIntensity;
}

// 更新窗口状态
function updateWindows() {
    const activeCount = Math.min(currentState.watchers, windowMeshes.length);
    
    windowMeshes.forEach((window, index) => {
        const shouldBeActive = index < activeCount;
        
        if (shouldBeActive && !window.active) {
            // 激活窗口
            window.frame.material.opacity = 0.3;
            window.beam.material.opacity = 0.5;
            window.active = true;
        } else if (!shouldBeActive && window.active) {
            // 关闭窗口
            window.frame.material.opacity = 0;
            window.beam.material.opacity = 0;
            window.active = false;
        }
        
        // 如果是rupture阶段，闪烁
        if (currentState.phase === 'rupture' && window.active) {
            window.beam.material.opacity = Math.random() * 0.8;
        }
    });
}

function updateBlobMorph() {
    // 检查morphTargets是否存在
    if (!morphTargets || morphTargets.length === 0) {
        return;  // 如果没有，直接返回
    }
    
    // 将压力值(0-100)映射到形态键(0-1)
    const pressure = currentState.totalPressure;
    const normalizedPressure = Math.min(pressure / 100, 1.0);
    
    // 更新第一个morph target（对应Blender的"键 1"）
    morphTargets[0] = normalizedPressure;
    
    // 调试输出（可选，帮助你看到变化）
    // console.log('Pressure:', pressure.toFixed(1), 'Morph:', normalizedPressure.toFixed(2));
}

// 动画循环
function animate() {
    requestAnimationFrame(animate);

    // ⭐ 添加：更新动画mixer（如果有）
    if (mixer) {
        const delta = clock.getDelta();
        mixer.update(delta);
    }

    // ⭐ 添加：更新形态键
    updateBlobMorph();
    
    // 更新几何体
    updateBlobDeformation();
    updateBlobMaterial();
    updateWindows();
    
    // 旋转（保留，但检查blob是否存在）
    if (blob) {
        if (currentState.phase === 'critical' || currentState.phase === 'rupture') {
            blob.rotation.y += 0.02;
        } else {
            blob.rotation.y += 0.005;
        }
    }
    
    // 如果是transmutation，上升
    if (currentState.phase === 'transmutation') {
        blob.position.y += 0.01;
        panopticon.children.forEach(child => {
            if (child.material) {
                child.material.opacity = Math.max(0, child.material.opacity - 0.01);
                child.material.transparent = true;
            }
        });
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
    
    // 更新body class以应用phase-specific样式
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
    
    // 持续发送gaze信号
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

// 页面加载时初始化
window.addEventListener('load', init);