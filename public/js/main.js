// ========== VRButton 定义 ==========
const VRButton = {
    createButton: function(renderer) {
        const button = document.createElement('button');
        
        function stylizeElement(element) {
            element.style.position = 'absolute';
            element.style.bottom = '20px';
            element.style.padding = '12px 6px';
            element.style.border = '1px solid #fff';
            element.style.borderRadius = '4px';
            element.style.background = 'rgba(0,0,0,0.1)';
            element.style.color = '#fff';
            element.style.font = 'normal 13px sans-serif';
            element.style.textAlign = 'center';
            element.style.opacity = '0.5';
            element.style.outline = 'none';
            element.style.zIndex = '999';
        }
        
        button.textContent = 'VR NOT AVAILABLE';
        button.style.left = 'calc(50% - 90px)';
        button.style.width = '180px';
        stylizeElement(button);
        
        return button;
    }
};

let currentSession = null;

// Socket.io连接
const socket = io();

// Three.js场景设置
let scene, camera, renderer;
let blob, panopticon, lights = [];
let windowMeshes = [];
let mixer, morphTargets;
const clock = new THREE.Clock();
let controls;

// 游戏状态
let currentState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting',
    gazePoints: []
};

let moveForward = false;

// 初始化
function init() {
    console.log('Initializing...');
    scene = new THREE.Scene();
    
    const container = document.getElementById('viewport-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 1.0, 0);
    camera.lookAt(0, 1, 0);
    
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(width, height);
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

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI;
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    
    console.log('OrbitControls created');
    
    createLights();
    createPanopticon();
    loadBlobModel();
    
    window.addEventListener('resize', onWindowResize);
}

// 加载 GLB 模型
function loadBlobModel() {
    console.log('Loading GLB...');
    
    const loader = new THREE.GLTFLoader();
    
    loader.load(
        '/models/blob01.glb',
        
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
                        
                        // 优化所有纹理
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
                                console.log('Optimized texture:', mapName);
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
            renderer.setAnimationLoop(animate);
        },
        
        function (xhr) {
            console.log('Loading:', (xhr.loaded / xhr.total * 100).toFixed(0) + '%');
        },
        
        function (error) {
            console.error('Error loading GLB:', error);
        }
    );
}

// 创建Panopticon
function createPanopticon() {
    panopticon = new THREE.Group();
    
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
    
    const gridHelper = new THREE.GridHelper(20, 20, 0x00ffff, 0x00ffff);
    gridHelper.position.y = -2.9;
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    panopticon.add(gridHelper);
    
    scene.add(panopticon);
}

function createLights() {
    const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0x292929, 0.6);
    scene.add(hemiLight);
    
    const spotLight = new THREE.SpotLight(0xffffff, );
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

function updateBlobMorph() {
    if (!morphTargets || morphTargets.length === 0) return;
    
    const pressure = currentState.totalPressure;
    const normalizedPressure = Math.min(pressure / 100, 1.0);
    morphTargets[0] = normalizedPressure;
}

function animate() {
    if (controls) {
        controls.update();
    }
    
    if (mixer) {
        const delta = clock.getDelta();
        mixer.update(delta);
    }
    
    updateBlobMorph();
    updateBlobMaterial();
    updateWindows();
    
    if (currentState.phase === 'transmutation' && blob) {
        blob.position.y += 0.01;
        if (panopticon) {
            panopticon.children.forEach(child => {
                if (child.material) {
                    child.material.opacity = Math.max(0, child.material.opacity - 0.01);
                    child.material.transparent = true;
                }
            });
        }
    }
    
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('viewport-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

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
        if (state.phase === 'rupture') {
            transformBtn.style.display = 'block';
        } else {
            transformBtn.style.display = 'none';
        }
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