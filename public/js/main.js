// Socket.io连接
const socket = io();

// Three.js场景设置
let scene, camera, renderer;
let blob, panopticon, lights = [];
let windowMeshes = [];

// 游戏状态
let currentState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting',
    gazePoints: []
};

// 初始化函数 - 必须在最前面定义！
function init() {
    console.log('Initializing Three.js scene...');
    
    // 创建场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 10, 50);
    
    // 创建相机
    const container = document.getElementById('viewport-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);
    
    // 创建渲染器
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    
    console.log('Scene created');
    
    // 创建几何体
    createBlob();
    console.log('Blob created');
    
    // 创建Panopticon
    createPanopticon();
    console.log('Panopticon created');
    
    // 创建灯光
    createLights();
    console.log('Lights created');
    
    // 窗口大小调整
    window.addEventListener('resize', onWindowResize);
    
    // 开始动画循环
    animate();
    console.log('Animation started');
}

// 创建中心的几何体
function createBlob() {
    const geometry = new THREE.IcosahedronGeometry(1.5, 3);
    const material = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0x00ffff,
        emissiveIntensity: 0.2
    });
    
    blob = new THREE.Mesh(geometry, material);
    blob.castShadow = true;
    scene.add(blob);
    
    // 保存原始顶点位置
    const positions = geometry.attributes.position.array;
    blob.geometry.userData.originalPositions = new Float32Array(positions);
}

// 创建Panopticon环境
function createPanopticon() {
    panopticon = new THREE.Group();
    
    // 创建墙壁
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
    const gridHelper = new THREE.GridHelper(20, 20, 0x00ffff, 0x00ffff);
    gridHelper.position.y = -2.9;
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    panopticon.add(gridHelper);
    
    // 创建窗口
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
    
    // 光束
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
    spotLight.castShadow = true;
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.5;
    scene.add(spotLight);
    
    lights.push(spotLight);
}

// 更新几何体变形
function updateBlobDeformation() {
    if (!blob || !blob.geometry.userData.originalPositions) return;
    
    const positions = blob.geometry.attributes.position.array;
    const originalPositions = blob.geometry.userData.originalPositions;
    
    const phase = currentState.phase;
    
    for (let i = 0; i < positions.length; i += 3) {
        const ox = originalPositions[i];
        const oy = originalPositions[i + 1];
        const oz = originalPositions[i + 2];
        
        let deformation = 0;
        
        if (phase === 'stable') {
            deformation = Math.sin(Date.now() * 0.001 + i) * 0.05;
        } else if (phase === 'unstable') {
            deformation = Math.sin(Date.now() * 0.003 + i) * 0.2;
        } else if (phase === 'critical') {
            deformation = Math.sin(Date.now() * 0.005 + i) * 0.5;
        } else if (phase === 'rupture') {
            deformation = (Math.random() - 0.5) * 1.5;
        } else if (phase === 'transmutation') {
            deformation = Math.sin(Date.now() * 0.001 + i) * 0.1;
        }
        
        const scale = 1 + deformation;
        positions[i] = ox * scale;
        positions[i + 1] = oy * scale;
        positions[i + 2] = oz * scale;
    }
    
    blob.geometry.attributes.position.needsUpdate = true;
    blob.geometry.computeVertexNormals();
}

// 更新材质颜色
function updateBlobMaterial() {
    if (!blob) return;
    
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
            window.frame.material.opacity = 0.3;
            window.beam.material.opacity = 0.5;
            window.active = true;
        } else if (!shouldBeActive && window.active) {
            window.frame.material.opacity = 0;
            window.beam.material.opacity = 0;
            window.active = false;
        }
        
        if (currentState.phase === 'rupture' && window.active) {
            window.beam.material.opacity = Math.random() * 0.8;
        }
    });
}

// 动画循环
function animate() {
    requestAnimationFrame(animate);
    
    updateBlobDeformation();
    updateBlobMaterial();
    updateWindows();
    
    if (currentState.phase === 'critical' || currentState.phase === 'rupture') {
        blob.rotation.y += 0.02;
        blob.rotation.x += 0.01;
    } else {
        blob.rotation.y += 0.005;
    }
    
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
    const container = document.getElementById('viewport-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Socket.io事件
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join-as', 'experiencer');
});

socket.on('initial-state', (state) => {
    console.log('Initial state received:', state);
    currentState = state;
    updateUI();
});

socket.on('state-update', (state) => {
    currentState = state;
    updateUI();
    
    // 显示转化按钮
    const transformBtn = document.getElementById('transform-btn');
    if (transformBtn) {
        if (state.phase === 'rupture') {
            transformBtn.style.display = 'block';
        } else {
            transformBtn.style.display = 'none';
        }
    }
});

// 更新UI
function updateUI() {
    const watcherCount = document.getElementById('watcher-count');
    const pressureLevel = document.getElementById('pressure-level');
    const phaseStatus = document.getElementById('phase-status');
    
    if (watcherCount) watcherCount.textContent = currentState.watchers;
    if (pressureLevel) pressureLevel.textContent = Math.floor(currentState.totalPressure);
    if (phaseStatus) phaseStatus.textContent = currentState.phase.toUpperCase();
    
    document.body.className = `experience-view phase-${currentState.phase}`;
}

// 转化按钮
const transformBtn = document.getElementById('transform-btn');
if (transformBtn) {
    transformBtn.addEventListener('click', () => {
        socket.emit('trigger-transmutation');
    });
}

// 页面加载时初始化 - 这一行必须在 init 函数定义之后！
window.addEventListener('load', init);