// ========== 常量配置 ==========
const CONFIG = {
    SHAKE_INTENSITY: 0.15,
    BLOB_SCALE_RUPTURE: 1.5,
    FADE_SPEED: 0.01,
    FLOAT_SPEED: 0.005,
    ROTATION_SPEED: 0.02
};

let currentSession = null;

let panopticonParent; 
const socket = io();

let scene, camera, renderer;
let blob, panopticon, lights = [];
let windowMeshes = [];
let mixer, morphTargets;
const clock = new THREE.Clock();
let controls;

let debrisSystem = null;
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
    camera.position.set(0, 1, 5);
    camera.lookAt(0, 1, 1);
    
    const canvas = document.getElementById('viewport');
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight * 0.7);
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

// 创建灯光
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

// 更新材质
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
        // transmutation: { color: 0xffd700, intensity: 1.0 }
        transmutation: { color: 0xffffff, intensity: 2.0, roughness: 0.6, metalness: 0.2 }
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

// // ========== 场景切换 ==========
// function switchToWarmWorld() {
//     scene.background = new THREE.Color(0xffe4b5);
//     scene.fog = new THREE.FogExp2(0xffe4b5, 0.01);
    
//     lights.forEach(light => {
//         if (light.isAmbientLight) {
//             light.color.setHex(0xffffff);
//             light.intensity = 2.0;
//         }
//         if (light.isDirectionalLight) {
//             light.color.setHex(0xffd700);
//             light.intensity = 1.0;
//         }
//         if (light.isPointLight) {
//             light.intensity = 0;
//         }
//     });

//     if (panopticon) panopticon.visible = false;
//     if (debrisSystem) {
//         scene.remove(debrisSystem);
//         debrisSystem = null;
//     }
// }

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

// function animate() {
//     if (mixer) mixer.update(clock.getDelta());
    
//     updateBlobMorph();
//     updateBlobMaterial();
    
//     const phase = currentState.phase;

//     // Critical phase: 震动效果
//     if (phase === 'critical') {
//         applyVibration(panopticon, CONFIG.SHAKE_INTENSITY);
//         applyVibration(blob, CONFIG.SHAKE_INTENSITY * 0.5);
//     } else if (phase === 'waiting' || phase === 'stable') {
//         resetObjectTransform(panopticon);
//         if (blob) {
//             blob.position.x = 0;
//             blob.position.z = 0;
//             blob.scale.set(1, 1, 1);
//         }
//     }

//     // Rupture phase: 爆炸
//     if (phase === 'rupture') {
//         createExplosion();
//         updateExplosion();
        
//         if (blob) {
//             const target = CONFIG.BLOB_SCALE_RUPTURE;
//             blob.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
//             blob.rotation.y += CONFIG.ROTATION_SPEED;
//         }

//         if (panopticon) {
//             panopticon.children.forEach(child => {
//                 if (child.visible && child.material) {
//                     child.material.transparent = true;
//                     if (child.material.opacity > 0) {
//                         child.material.opacity -= 0.02;
//                     } else {
//                         child.visible = false;
//                     }
//                 }
//             });
//         }
//     }
    
//     // Transmutation phase: 重生
//     if (phase === 'transmutation') {
//         if (!transmutationStarted) {
//             transmutationStarted = true;
//             switchToWarmWorld();
            
//             if (blob) {
//                 blob.position.set(0, 0, 0);
//                 blob.scale.set(1, 1, 1);
//             }
//         }
        
//         if (blob) {
//             blob.rotation.y += CONFIG.FLOAT_SPEED;
//             blob.position.y = Math.sin(Date.now() * 0.001) * 0.5;
//         }
//     }

//     if (phase !== 'transmutation') {
//         transmutationStarted = false;
//     }
    
//     renderer.render(scene, camera);
// }

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
            
            // ⭐ Panopticon 永久消失
            if (panopticon) {
                panopticon.visible = false;
            }
            
            // ⭐ 清理爆炸碎片
            if (debrisSystem) {
                scene.remove(debrisSystem);
                debrisSystem = null;
            }
            
            // ⭐ 重置 blob
            if (blob) {
                blob.position.set(0, 1, 0);
                blob.scale.set(1, 1, 1);
                blob.rotation.set(0, 0, 0);
                
                // ⭐ 设置柔软材质
                blob.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.roughness = 0.6;  // 更粗糙 = 更柔软
                        child.material.metalness = 0.2;  // 降低金属度
                        child.material.envMapIntensity = 0.5; // 降低环境反射
                        child.material.transparent = true;
                        child.material.opacity = 0.7;
                    }
                });
            }
        }
        
        // ⭐ 柔和的漂浮和旋转
        if (blob) {
            blob.rotation.y += CONFIG.FLOAT_SPEED;
            blob.position.y = 1 + Math.sin(Date.now() * 0.001) * 0.3;
        }
    }

    if (phase !== 'transmutation') {
        transmutationStarted = false;
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

// // 按钮交互
// const gazeBtn = document.getElementById('gaze-btn');
// let isGazing = false;
// let gazeInterval;

// gazeBtn.addEventListener('mousedown', startGaze);
// gazeBtn.addEventListener('touchstart', startGaze);
// gazeBtn.addEventListener('mouseup', endGaze);
// gazeBtn.addEventListener('touchend', endGaze);
// gazeBtn.addEventListener('mouseleave', endGaze);

// function startGaze(e) {
//     e.preventDefault();
//     if (isGazing) return;
    
//     isGazing = true;
//     gazeBtn.classList.add('gazing');
//     document.getElementById('btn-text').textContent = 'GAZING...';
    
//     socket.emit('gaze-start');
    
//     gazeInterval = setInterval(() => {
//         socket.emit('gaze-hold');
//     }, 100);
// }

// function endGaze(e) {
//     if (e) e.preventDefault();
//     if (!isGazing) return;
    
//     isGazing = false;
//     gazeBtn.classList.remove('gazing');
//     document.getElementById('btn-text').textContent = 'HOLD TO GAZE';
    
//     clearInterval(gazeInterval);
//     socket.emit('gaze-end');
// }

// // ========== 面部捕捉与凝视检测 ==========

// let faceMesh;
// let videoCamera;
// let isGazing = false;
// let gazeInterval;
// const video = document.getElementById('face-video');
// const canvas = document.getElementById('face-canvas');
// const canvasCtx = canvas.getContext('2d');
// const gazeStatus = document.getElementById('gaze-status');

// // 初始化 Face Mesh
// function initFaceMesh() {
//     faceMesh = new FaceMesh({
//         locateFile: (file) => {
//             return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
//         }
//     });
    
//     faceMesh.setOptions({
//         maxNumFaces: 1,
//         refineLandmarks: true,
//         minDetectionConfidence: 0.5,
//         minTrackingConfidence: 0.5
//     });
    
//     faceMesh.onResults(onFaceResults);
    
//     // 启动摄像头
//     videoCamera = new Camera(video, {
//         onFrame: async () => {
//             await faceMesh.send({image: video});
//         },
//         width: 320,
//         height: 240
//     });
    
//     videoCamera.start();
//     console.log('Face detection started');
// }

// // 处理面部检测结果
// function onFaceResults(results) {
//     // 清空画布
//     canvasCtx.save();
//     canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    
//     // 绘制视频帧
//     canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    
//     if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
//         const landmarks = results.multiFaceLandmarks[0];
        
//         // 绘制面部网格（可选，用于调试）
//         drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {
//             color: '#00ffff',
//             lineWidth: 0.5
//         });
        
//         // 检测凝视
//         const gazing = detectGaze(landmarks);
        
//         if (gazing && !isGazing) {
//             startGazing();
//         } else if (!gazing && isGazing) {
//             stopGazing();
//         }
//     } else {
//         // 没有检测到面部
//         if (isGazing) {
//             stopGazing();
//         }
//     }
    
//     canvasCtx.restore();
// }

// // 凝视检测算法
// function detectGaze(landmarks) {
//     // 关键点索引（MediaPipe Face Mesh 标准）
//     const leftEye = landmarks[33];   // 左眼内角
//     const rightEye = landmarks[263]; // 右眼内角
//     const noseTip = landmarks[1];    // 鼻尖
//     const leftEyeTop = landmarks[159];
//     const leftEyeBottom = landmarks[145];
//     const rightEyeTop = landmarks[386];
//     const rightEyeBottom = landmarks[374];
    
//     // 1. 检查眼睛是否睁开（眼睛高度）
//     const leftEyeHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);
//     const rightEyeHeight = Math.abs(rightEyeTop.y - rightEyeBottom.y);
//     const eyeOpenThreshold = 0.01; // 阈值，可调整
    
//     const eyesOpen = leftEyeHeight > eyeOpenThreshold && rightEyeHeight > eyeOpenThreshold;
    
//     // 2. 检查面部是否正对屏幕（通过鼻子和眼睛的相对位置）
//     const eyeCenter = {
//         x: (leftEye.x + rightEye.x) / 2,
//         y: (leftEye.y + rightEye.y) / 2
//     };
    
//     const noseOffset = {
//         x: Math.abs(noseTip.x - eyeCenter.x),
//         y: Math.abs(noseTip.y - eyeCenter.y)
//     };
    
//     // 面部正对屏幕时，鼻子应该在两眼中间
//     const facingForward = noseOffset.x < 0.05 && noseOffset.y < 0.05;
    
//     // 3. 检查面部距离（通过眼睛间距判断）
//     const eyeDistance = Math.sqrt(
//         Math.pow(rightEye.x - leftEye.x, 2) + 
//         Math.pow(rightEye.y - leftEye.y, 2)
//     );
    
//     const optimalDistance = eyeDistance > 0.15 && eyeDistance < 0.4;
    
//     // 综合判断
//     return eyesOpen && facingForward && optimalDistance;
// }

// // 开始凝视
// function startGazing() {
//     isGazing = true;
//     gazeStatus.textContent = 'GAZING...';
//     gazeStatus.classList.add('gazing');
    
//     console.log('Started gazing');
//     socket.emit('gaze-start');
    
//     gazeInterval = setInterval(() => {
//         socket.emit('gaze-hold');
//     }, 100);
// }

// // 停止凝视
// function stopGazing() {
//     isGazing = false;
//     gazeStatus.textContent = 'LOOK AT THE SCREEN TO GAZE';
//     gazeStatus.classList.remove('gazing');
    
//     console.log('Stopped gazing');
//     clearInterval(gazeInterval);
//     socket.emit('gaze-end');
// }

// // 页面加载后启动面部检测
// window.addEventListener('load', () => {
//     init();
    
//     // 延迟启动摄像头，等待用户授权
//     setTimeout(() => {
//         initFaceMesh();
//     }, 1000);
// });

// // ========== 面部捕捉与凝视检测 (TensorFlow.js) ==========

// let detector;
// let videoStream;
// let isGazing = false;
// let gazeInterval;
// let animationId;

// async function initFaceDetection() {
//     const video = document.getElementById('face-video');
//     const canvas = document.getElementById('face-canvas');
//     const gazeStatus = document.getElementById('gaze-status');
    
//     if (!video || !canvas || !gazeStatus) {
//         console.error('Face detection elements not found!');
//         return;
//     }
    
//     console.log('Face detection elements found');
    
//     const canvasCtx = canvas.getContext('2d');
    
//     try {
//         // 加载面部检测模型
//         console.log('Loading face detection model...');
//         const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
//         const detectorConfig = {
//             runtime: 'tfjs',
//             maxFaces: 1,
//             refineLandmarks: false,
//             detectionConfidence: 0.3,  // ⭐ 降低检测阈值（默认 0.5）
//             trackingConfidence: 0.3 
//         };
        
//         detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
//         console.log('Face detection model loaded');
        
//         // 启动摄像头
//         videoStream = await navigator.mediaDevices.getUserMedia({
//             video: {
//                 width: 320,
//                 height: 240,
//                 facingMode: 'user'
//             }
//         });
        
//         video.srcObject = videoStream;

//         // ⭐ 等待视频元数据加载
//         await new Promise((resolve) => {
//             video.onloadedmetadata = () => {
//                 console.log('Video metadata loaded');
//                 resolve();
//             };
//         });

//         await video.play();
//         console.log('Camera started');

//         // ⭐ 再等待一下确保视频准备好
//         await new Promise(resolve => setTimeout(resolve, 500));

//         console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);

//         gazeStatus.textContent = 'LOOK AT THE SCREEN TO GAZE';

//         console.log('Starting detection loop...');
//         // 开始检测循环
//         detectFaceLoop(video, canvas, canvasCtx, gazeStatus);
        
//     } catch (error) {
//         console.error('Face detection error:', error);
//         gazeStatus.textContent = 'CAMERA ACCESS DENIED';
//     }
// }

// async function detectFaceLoop(video, canvas, canvasCtx, gazeStatus) {
//     let frameCount = 0;

//     async function detect() {
//         if (!video.paused && !video.ended) {
//             try {
//                 // 检测面部
//                 const faces = await detector.estimateFaces(video, {
//                     flipHorizontal: true
//                 });

//                 // ⭐ 更详细的日志
//                 if (frameCount === 1 || frameCount % 30 === 0) {
//                     console.log('Detection result:', {
//                         frame: frameCount,
//                         faces: faces.length,
//                         videoWidth: video.videoWidth,
//                         videoHeight: video.videoHeight,
//                         videoPaused: video.paused
//                     });
//                 }

//                 // ⭐ 绘制一个测试点，确认画布在更新
//                 if (frameCount % 10 === 0) {
//                     canvasCtx.fillStyle = 'lime';
//                     canvasCtx.fillRect(5, 5, 10, 10);
//                 }
                
//                 // 清空画布
//                 canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
                
//                 // ⭐ 翻转画布（镜像效果）
//                 canvasCtx.save();
//                 canvasCtx.scale(-1, 1);
//                 canvasCtx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
//                 canvasCtx.restore();
                
//                 if (faces.length > 0) {
//                     const face = faces[0];
                    
//                     // 绘制关键点（可选）
//                     drawKeypoints(canvasCtx, face.keypoints);
                    
//                     // 检测凝视
//                     const gazing = detectGaze(face.keypoints);
                    
//                     if (gazing && !isGazing) {
//                         startGazing(gazeStatus);
//                     } else if (!gazing && isGazing) {
//                         stopGazing(gazeStatus);
//                     }
//                 } else {
//                     // 没有检测到面部
//                     if (isGazing) {
//                         stopGazing(gazeStatus);
//                     }
//                 }
                
//             } catch (error) {
//                 console.error('Detection error:', error);
//             }
//         }
        
//         animationId = requestAnimationFrame(detect);
//     }
    
//     detect();
// }

// function drawKeypoints(ctx, keypoints) {
//     // 只绘制眼睛和鼻子的关键点
//     const leftEyeIndices = [33, 133, 159, 145];
//     const rightEyeIndices = [263, 362, 386, 374];
//     const noseIndices = [1];
    
//     ctx.fillStyle = '#00ffff';
    
//     [...leftEyeIndices, ...rightEyeIndices, ...noseIndices].forEach(index => {
//         if (keypoints[index]) {
//             const point = keypoints[index];
//             ctx.beginPath();
//             ctx.arc(point.x, point.y, 2, 0, 2 * Math.PI);
//             ctx.fill();
//         }
//     });
// }

// // function detectGaze(keypoints) {
// //     // 获取关键点
// //     const leftEye = keypoints[33];
// //     const rightEye = keypoints[263];
// //     const noseTip = keypoints[1];
// //     const leftEyeTop = keypoints[159];
// //     const leftEyeBottom = keypoints[145];
// //     const rightEyeTop = keypoints[386];
// //     const rightEyeBottom = keypoints[374];
    
// //     if (!leftEye || !rightEye || !noseTip || !leftEyeTop || !leftEyeBottom || !rightEyeTop || !rightEyeBottom) {
// //         return false;
// //     }
    
// //     // 1. 检查眼睛是否睁开
// //     const leftEyeHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);
// //     const rightEyeHeight = Math.abs(rightEyeTop.y - rightEyeBottom.y);
// //     const eyeOpenThreshold = 5; // 像素值
    
// //     const eyesOpen = leftEyeHeight > eyeOpenThreshold && rightEyeHeight > eyeOpenThreshold;
    
// //     // 2. 检查面部是否正对屏幕
// //     const eyeCenterX = (leftEye.x + rightEye.x) / 2;
// //     const noseOffsetX = Math.abs(noseTip.x - eyeCenterX);
    
// //     const facingForward = noseOffsetX < 20; // 像素值
    
// //     // 3. 检查面部距离（通过眼睛间距）
// //     const eyeDistance = Math.sqrt(
// //         Math.pow(rightEye.x - leftEye.x, 2) + 
// //         Math.pow(rightEye.y - leftEye.y, 2)
// //     );
    
// //     const optimalDistance = eyeDistance > 60 && eyeDistance < 150;

// //     // 调试输出
// //     console.log('Eye heights:', leftEyeHeight.toFixed(1), rightEyeHeight.toFixed(1));
// //     console.log('Nose offset:', noseOffsetX.toFixed(1));
// //     console.log('Eye distance:', eyeDistance.toFixed(1));
// //     console.log('Eyes open:', eyesOpen, 'Facing:', facingForward, 'Distance:', optimalDistance);
    
// //     return eyesOpen && facingForward && optimalDistance;
// // }

// function detectGaze(keypoints) {
//     // ⭐ 临时：只要有关键点就返回 true（用于测试）
//     console.log('Keypoints received:', keypoints.length);
//     return keypoints.length > 0;
// }

// function startGazing(statusElement) {
//     isGazing = true;
//     statusElement.textContent = 'GAZING...';
//     statusElement.classList.add('gazing');
    
//     console.log('👁️ Started gazing');
//     socket.emit('gaze-start');
    
//     gazeInterval = setInterval(() => {
//         socket.emit('gaze-hold');
//     }, 100);
// }

// function stopGazing(statusElement) {
//     isGazing = false;
//     statusElement.textContent = 'LOOK AT THE SCREEN TO GAZE';
//     statusElement.classList.remove('gazing');
    
//     console.log('👁️ Stopped gazing');
//     clearInterval(gazeInterval);
//     socket.emit('gaze-end');
// }

// // 页面加载后启动
// window.addEventListener('load', () => {
//     console.log('🚀 Page loaded, starting Three.js...');
//     init();
    
//     console.log('🚀 Starting face detection...');
//     setTimeout(() => {
//         initFaceDetection();
//     }, 2000);
// });

// ========== 设备朝向检测 ==========

let isGazing = false;
let gazeInterval;

// 请求权限（iOS 13+ 需要）
function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ 需要用户手动授权
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    console.log('Orientation permission granted');
                    startOrientationDetection();
                } else {
                    console.log('Orientation permission denied');
                    document.getElementById('gaze-instruction').textContent = 
                        'PERMISSION DENIED';
                }
            })
            .catch(console.error);
    } else {
        // Android 或旧版 iOS 不需要权限
        console.log('Orientation available without permission');
        startOrientationDetection();
    }
}

// 开始监听设备朝向
function startOrientationDetection() {
    const instruction = document.getElementById('gaze-instruction');
    const angleDisplay = document.getElementById('angle-display');
    
    if (!instruction || !angleDisplay) {
        console.error('Orientation UI elements not found');
        return;
    }
    
    window.addEventListener('deviceorientation', (event) => {
        const beta = event.beta;   // 前后倾斜 (-180 到 180)
        const gamma = event.gamma;  // 左右倾斜 (-90 到 90)
        
        // 更新角度显示（用于调试）
        angleDisplay.textContent = `β: ${beta ? beta.toFixed(0) : '--'}° γ: ${gamma ? gamma.toFixed(0) : '--'}°`;
        
        if (beta === null || gamma === null) {
            return; // 传感器数据无效
        }
        
        // 检测是否正对屏幕
        // beta: 60-90° = 手机接近垂直
        // gamma: -20 到 +20° = 不左右歪斜
        const isFacingScreen = (
            beta > 60 && beta < 90 &&
            Math.abs(gamma) < 20
        );
        
        if (isFacingScreen && !isGazing) {
            startGazing();
        } else if (!isFacingScreen && isGazing) {
            stopGazing();
        }
    });
    
    console.log('Orientation detection started');
    instruction.textContent = 'HOLD PHONE UP TO GAZE';
}

// 开始凝视
function startGazing() {
    isGazing = true;
    const instruction = document.getElementById('gaze-instruction');
    instruction.textContent = 'GAZING...';
    instruction.classList.add('gazing');
    
    console.log('Started gazing');
    socket.emit('gaze-start');
    
    gazeInterval = setInterval(() => {
        socket.emit('gaze-hold');
    }, 100);
}

// 停止凝视
function stopGazing() {
    isGazing = false;
    const instruction = document.getElementById('gaze-instruction');
    instruction.textContent = 'HOLD PHONE UP TO GAZE';
    instruction.classList.remove('gazing');
    
    console.log('Stopped gazing');
    clearInterval(gazeInterval);
    socket.emit('gaze-end');
}

// 页面加载后启动
window.addEventListener('load', () => {
    console.log('Page loaded');
    init();
    
    // 延迟 1 秒后请求权限（给 Three.js 时间加载）
    setTimeout(() => {
        console.log('Requesting orientation permission...');
        requestOrientationPermission();
    }, 1000);
});

// window.addEventListener('load', init);

