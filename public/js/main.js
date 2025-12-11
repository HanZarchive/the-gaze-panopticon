let currentSession = null;

let panopticonParent; 

const socket = io();

// Three.js场景设置
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

let moveForward = false;

// 初始化
function init() {
    console.log('Initializing...');
    scene = new THREE.Scene();
    
    const container = document.getElementById('viewport-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
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

    renderer.toneMapping = THREE.ReinhardToneMapping; // 改用 Reinhard，比 ACES 柔和，不容易过曝
    renderer.toneMappingExposure = 1.2; // 稍微调高一点整体亮度，让画面通透，而不是黑白对比强烈
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // renderer.xr.enabled = true;

    // document.body.appendChild( VRButton.createButton( renderer ) );

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
    // createPanopticon();
    loadBlobModel();

    const userGroup = new THREE.Group();
    userGroup.position.set(0, 1, 0); 
    
    // 把 userGroup 加进场景，再把相机加进 userGroup
    scene.add(userGroup);
    userGroup.add(camera);
    
    window.addEventListener('resize', onWindowResize);
}

// 加载 GLB 模型
// function loadBlobModel() {
//     console.log('Loading GLB...');
    
//     const loader = new THREE.GLTFLoader();
    
//     loader.load(
//         '/models/blob02.glb',
        
//         function (gltf) {
//             console.log('GLB loaded successfully');
            
//             blob = gltf.scene;
//             scene.add(blob);
//             blob.position.set(0, 0, 0);
//             blob.scale.set(1, 1, 1);
            
//             blob.traverse((child) => {
//                 if (child.isMesh) {
//                     console.log('Found mesh:', child.name);
                    
//                     if (child.material) {
//                         child.material.side = THREE.FrontSide;
//                         child.material.envMapIntensity = 1.0;
                        
//                         // 优化所有纹理
//                         const textureMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
                        
//                         textureMaps.forEach(mapName => {
//                             const texture = child.material[mapName];
//                             if (texture) {
//                                 texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
//                                 texture.minFilter = THREE.LinearMipmapLinearFilter;
//                                 texture.magFilter = THREE.LinearFilter;
                                
//                                 if (mapName === 'map' || mapName === 'emissiveMap') {
//                                     texture.colorSpace = THREE.SRGBColorSpace;
//                                 }
                                
//                                 texture.needsUpdate = true;
//                                 console.log('Optimized texture:', mapName);
//                             }
//                         });
                        
//                         child.material.needsUpdate = true;
//                     }

//                     if (child.morphTargetInfluences) {
//                         console.log('Morph targets found:', child.morphTargetInfluences.length);
//                         morphTargets = child.morphTargetInfluences;
//                         for (let i = 0; i < morphTargets.length; i++) {
//                             morphTargets[i] = 0;
//                         }
//                     }
//                 }
//             });
            
//             if (gltf.animations && gltf.animations.length > 0) {
//                 mixer = new THREE.AnimationMixer(blob);
//                 const action = mixer.clipAction(gltf.animations[0]);
//                 action.play();
//             }
            
//             console.log('Blob setup complete');
//             renderer.setAnimationLoop(animate);
//         },
        
//         function (xhr) {
//             console.log('Loading:', (xhr.loaded / xhr.total * 100).toFixed(0) + '%');
//         },
        
//         function (error) {
//             console.error('Error loading GLB:', error);
//         }
//     );
// }

function loadBlobModel() {
    const loader = new THREE.GLTFLoader();
    
    loader.load('/models/blob02.glb', function (gltf) {
        console.log('GLB loaded');
        
        // 把整个场景加进来
        const model = gltf.scene;
        scene.add(model);
        
        // 遍历所有子物体，根据名字“对号入座”
        model.traverse((child) => {
            if (child.isMesh) {
                
                // 1. 找到 "Self" (中心的你)
                // 使用 includes 是为了防止导出时软件自动加后缀 (比如 Self.001)
                if (child.name.includes('Self')) {
                    blob = child; // 赋值给全局变量
                    console.log("Found Self:", child.name);

                    // const SelfScale = 5; 
                    // blob.scale.set(SelfScale, SelfScale, SelfScale);

                    // blob.scale.set(BLOB_SCALE, BLOB_SCALE, BLOB_SCALE);
                    // blob.position.set(0, 1, 0);

                    // === Self 的 XG 材质设置 ===
                    if (child.material) {
                        // 液态金属感：高金属度，低粗糙度
                        child.material.metalness = 1.0; 
                        child.material.roughness = 0.1;
                        child.material.envMapIntensity = 1.5; // 让它强力反射环境
                        child.material.emissive = new THREE.Color(0x000000); // 初始不发光
                    }
                    
                    // 获取变形动画数据 (如果有)
                    if (child.morphTargetInfluences) {
                        morphTargets = child.morphTargetInfluences;
                    }
                }
                
                // 2. 找到 "Panopticon" (全景监狱)
                if (child.name.includes('Panopticon')) {
                    panopticon = child; // 赋值给全局变量
                    console.log("Found Panopticon:", child.name);

                    panopticonParent = new THREE.Group();
                    
                    if (child.parent) {
                        child.parent.add(panopticonParent);
                    } else {
                        scene.add(panopticonParent);
                    }

                    panopticonParent.add(child);

                    const scaleFactor = 0.01; // 👈 在这里尽情调整大小，越小越安全
                    panopticonParent.scale.set(scaleFactor, scaleFactor, scaleFactor);

                    // panopticonParent.position.set(0, 0, 0);

                    // === Panopticon 的材质设置 ===
                    if (child.material) {
                        // 深色哑光金属，压抑感
                        child.material.color.setHex(0x1a1a1a);
                        child.material.metalness = 0.6;
                        child.material.roughness = 0.4;
                        child.material.side = THREE.DoubleSide; // 确保双面可见
                        child.material.transparent = true; // 开启透明，为后面的消失做准备
                        child.material.opacity = 1.0;
                    }
                }
            }
        });
        
        // 设置动画混合器 (绑定在整个 scene 上最保险)
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model); // 改为 model
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
        }
        
        // 开始动画循环
        renderer.setAnimationLoop(animate);
    });
}

// // 创建Panopticon
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

// function createLights() {
//     const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0x292929, 0.6);
//     scene.add(hemiLight);
    
//     const spotLight = new THREE.SpotLight(0xffffff, );
//     spotLight.position.set(0, 10, 0);
//     spotLight.castShadow = true;
//     spotLight.angle = Math.PI / 6;
//     spotLight.penumbra = 0.5;
//     spotLight.shadow.mapSize.width = 1024;
//     spotLight.shadow.mapSize.height = 1024;
//     spotLight.shadow.bias = -0.0001;
//     scene.add(spotLight);
//     lights.push(spotLight);

//     const dirLight = new THREE.DirectionalLight(0xfff4e5, 2);
//     dirLight.position.set(-30, 50, -30);
//     dirLight.castShadow = true;
//     dirLight.shadow.camera.left = -50;
//     dirLight.shadow.camera.right = 50;
//     dirLight.shadow.camera.top = 50;
//     dirLight.shadow.camera.bottom = -50;
//     dirLight.shadow.camera.near = 1;
//     dirLight.shadow.camera.far = 200;
//     dirLight.shadow.mapSize.set(2048, 2048);
//     dirLight.shadow.bias = -0.0005;
//     scene.add(dirLight);
// }

function createLights() {
    // 1. 环境光 (AmbientLight): 
    // 提高亮度，把颜色改成稍微带点冷色调的灰，避免死黑阴影
    // XG风格通常暗部也是有细节的，不是纯黑
    const ambientLight = new THREE.AmbientLight(0x404040, 3.0); 
    scene.add(ambientLight);
    lights.push(ambientLight);
    
    // 2. 主光源 (DirectionalLight): 
    // 模拟一种更均匀的顶部光，而不是聚光灯
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true; // 开启阴影
    
    // 柔化阴影 (关键步骤)
    mainLight.shadow.mapSize.width = 2048; // 提高分辨率
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.radius = 4; // 模糊阴影边缘，让它看起来更高级、不生硬
    mainLight.shadow.bias = -0.0001; 
    
    scene.add(mainLight);
    lights.push(mainLight);

    // 3. 补光 (PointLight):
    // 在反方向加一个微弱的紫色或蓝色补光，增加赛博/科技感
    // 这会让物体的背光面有好看的边缘光，而不是黑乎乎的
    const rimLight = new THREE.PointLight(0x00ffff, 0.5); // 青色补光
    rimLight.position.set(-10, 5, -10);
    scene.add(rimLight);
    lights.push(rimLight);
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
        // case 'critical':
        //     color = 0xffff00;
        //     emissiveIntensity = 0.5;
        //     break;
        case 'critical':
        // XG 风格：警示黄/红，并且高频闪烁
        // Date.now() % 100 用来实现快速闪烁效果
        const isFlicker = Math.floor(Date.now() / 50) % 2 === 0;
        
        if (isFlicker) {
            color = 0xff0000; // 红色警报
            emissiveIntensity = 0.8;
        } else {
            color = 0xffff00; // 黄色
            emissiveIntensity = 0.4;
        }
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

function applyVibration(object, intensity) {
    if (!object) return;
    
    // 我们只在 X 和 Z 轴（水平面）上震动，保持 Y 轴稳定（接地感）
    // (Math.random() - 0.5) * intensity 会产生一个正负随机数
    object.position.x = (Math.random() - 0.5) * intensity;
    object.position.z = (Math.random() - 0.5) * intensity;
    
    // 如果想要那种 XG 风格的“赛博故障感”，可以偶尔随机改变一下缩放
    // 只有 10% 的概率发生缩放故障
    if (Math.random() > 0.9) {
        const scaleGlitch = 1.0 + (Math.random() - 0.5) * 0.05; // 微小的缩放跳变
        object.scale.set(scaleGlitch, scaleGlitch, scaleGlitch);
    } else {
        object.scale.set(1, 1, 1); // 恢复正常
    }
}

// ========== 新增：爆炸粒子系统 ==========
let debrisSystem = null; // 粒子系统变量

function createExplosion() {
    if (debrisSystem) return; 

    if (!panopticon) {
        console.warn("Panopticon is undefined. Skipping explosion.");
        return;
    }

    panopticon.visible = false;

    // 2. 直接获取几何体 (因为 Panopticon 现在已经是 Mesh 了)
    const geometry = panopticon.geometry;

    // // 1. 找到监狱的墙壁并隐藏它
    // // panopticon 是一个 Group，我们需要找到里面的 Mesh (圆柱体墙壁)
    // let wallMesh = null;
    // panopticon.traverse(child => {
    //     if (child.isMesh && child.geometry.type === 'CylinderGeometry') {
    //         wallMesh = child;
    //     }
    // });

    // if (!wallMesh) return; // 如果找不到墙壁就退出
    // wallMesh.visible = false; // 瞬间隐藏实体墙壁

    // // 2. 准备粒子数据
    // const originalGeo = wallMesh.geometry;
    // const posAttribute = originalGeo.attributes.position;
    // const count = posAttribute.count;

    // const geometry = new THREE.BufferGeometry();
    // const positions = [];
    // const velocities = []; // 速度
    // const colors = [];     // 颜色

    // XG 风格配色：青色 + 洋红
    const color1 = new THREE.Color(0x00ffff); 
    const color2 = new THREE.Color(0xff00ff);
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
        // 获取每个顶点的位置
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);
        
        // 只有墙壁本身（半径比较大）的顶点才变成粒子，忽略圆柱体中心的点
        // 这样爆炸看起来是环形的
        positions.push(x, y, z);

        // 计算向外的爆炸速度
        // 向量方向 = 当前点坐标 归一化
        const vec = new THREE.Vector3(x, 0, z).normalize();
        
        // 速度随机化，制造错落感
        const speed = 0.5 + Math.random() * 0.5; 
        
        velocities.push(
            vec.x * speed,       // X轴向外冲
            (Math.random() - 0.5) * 0.5, // Y轴稍微乱飞一点
            vec.z * speed        // Z轴向外冲
        );

        // 随机分配颜色
        const mixRatio = Math.random();
        tempColor.lerpColors(color1, color2, mixRatio);
        colors.push(tempColor.r, tempColor.g, tempColor.b);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // 3. 创建粒子材质
    const material = new THREE.PointsMaterial({
        size: 0.3,             // 粒子大小
        vertexColors: true,    // 使用我们定义的颜色
        blending: THREE.AdditiveBlending, // 发光叠加模式
        transparent: true,
        opacity: 1.0,
        depthWrite: false      // 避免粒子遮挡问题
    });

    debrisSystem = new THREE.Points(geometry, material);
    debrisSystem.userData = { velocities: velocities }; // 把速度存进去

    debrisSystem.scale.copy(panopticon.scale);
    debrisSystem.position.copy(panopticon.position);
    debrisSystem.rotation.copy(panopticon.rotation);
    
    // 把粒子系统加入场景
    scene.add(debrisSystem);
}

// 更新粒子动画（让它们飞出去）
function updateExplosion() {
    if (!debrisSystem) return;

    const positions = debrisSystem.geometry.attributes.position.array;
    const velocities = debrisSystem.userData.velocities;
    
    // 遍历所有粒子并更新位置
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += velocities[i];     // X
        positions[i+1] += velocities[i+1]; // Y
        positions[i+2] += velocities[i+2]; // Z
        
        // 可选：加一点重力，让粒子稍微下坠
        // velocities[i+1] -= 0.01; 
    }
    
    debrisSystem.geometry.attributes.position.needsUpdate = true;
    
    // 逐渐消失
    debrisSystem.material.opacity -= 0.01; // 约 100 帧后完全消失
    
    // 如果完全透明了，从场景移除（省资源）
    if (debrisSystem.material.opacity <= 0) {
        scene.remove(debrisSystem);
        debrisSystem = null;
    }
}

// ========== 新增：切换到温暖世界 ==========
function switchToWarmWorld() {
    console.log("🌞 Welcome to the New World");
    
    // 1. 改变背景颜色：从黑暗变成 晨曦色/杏色 (XG 暖调)
    // 这种颜色配合金属材质的 Blob 会非常有质感
    scene.background = new THREE.Color(0xffe4b5); // Moccasin / 暖杏色
    scene.fog = new THREE.FogExp2(0xffe4b5, 0.01); //这也是关键，加上雾气让地平线柔和
    
    // 2. 调整灯光：关掉压抑的顶光，打开温暖的环境光
    // 遍历现有的灯光修改它们
    lights.forEach(light => {
        if (light.isAmbientLight) {
            light.color.setHex(0xffffff);
            light.intensity = 2.0; // 整体变亮
        }
        if (light.isDirectionalLight) {
            light.color.setHex(0xffd700); // 太阳光变成金色
            light.intensity = 1.0;
        }
        if (light.isPointLight) {
            light.intensity = 0; // 关掉那盏诡异的青色补光
        }
    });

    // 3. 彻底移除监狱和碎片
    if (panopticon) panopticon.visible = false;
    if (debrisSystem) {
        scene.remove(debrisSystem);
        debrisSystem = null;
    }
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
    
    const phase = currentState.phase;

    if (phase === 'critical') {
        // 1. 震动强度：可以设为 0.2 左右
        // 如果想随着压力变大而震动更剧烈，也可以关联 pressure
        const shakePower = 0.15; 
        
        // 让监狱（panopticon）晃动
        applyVibration(panopticon, shakePower);
        
        // 让我也晃动，稍微弱一点，因为我是被挤压的中心
        applyVibration(blob, shakePower * 0.5);

        } else if (phase === 'waiting' || phase === 'stable') {
        // 如果回到了稳定状态，确保位置归零（复位）
        if (panopticon) {
            panopticon.position.set(0, 0, 0);
            panopticon.scale.set(1, 1, 1);
        }
        if (blob) {
            blob.position.x = 0;
            blob.position.z = 0;
            blob.scale.set(1, 1, 1);
        }
    }
    
    // // ⭐ Rupture 阶段：爆炸效果
    // if (phase === 'rupture') {
    //     if (!ruptureStartTime) {
    //         ruptureStartTime = Date.now();
    //         console.log('Rupture started!');
    //     }
        
    //     const ruptureTime = (Date.now() - ruptureStartTime) / 1000; // 秒
        
    //     if (blob) {
    //         // 剧烈抖动
    //         blob.position.x = (Math.random() - 0.5) * 0.3;
    //         blob.position.y = (Math.random() - 0.5) * 0.3;
    //         blob.position.z = (Math.random() - 0.5) * 0.3;
            
    //         // 快速旋转
    //         blob.rotation.x += 0.05;
    //         blob.rotation.y += 0.08;
    //         blob.rotation.z += 0.03;
    //     }
        
    //     // Panopticon 震动和裂开
    //     if (panopticon) {
    //         panopticon.children.forEach(child => {
    //             if (child.material) {
    //                 // 逐渐变透明
    //                 if (child.material.opacity === undefined) {
    //                     child.material.transparent = true;
    //                     child.material.opacity = 1.0;
    //                 }
    //                 child.material.opacity -= 0.005;
                    
    //                 // 墙壁震动
    //                 if (child.geometry.type === 'CylinderGeometry') {
    //                     child.position.x = (Math.random() - 0.5) * 0.1;
    //                     child.position.z = (Math.random() - 0.5) * 0.1;
    //                 }
    //             }
    //         });
    //     }
        
    //     // 1秒后开始生成爆炸粒子
    //     if (ruptureTime > 1.0 && particles.length < 5) {
    //         particles.push(createExplosionParticles());
    //     }
        
    //     // 2秒后，物体消失
    //     if (ruptureTime > 2.0 && blob) {
    //         blob.visible = false;
    //     }
    // }

    // ========== Phase 3: Rupture (爆炸) ==========
    if (phase === 'rupture') {


        
        // 1. 触发爆炸 (函数内部有防重复锁，一直调用也没事)
        createExplosion();
        
        // 2. 更新粒子飞行
        updateExplosion();
        
        // 3. 处理 Blob (中间的你)
        // // 此时 Blob 应该不再震动，而是展现出一种“幸存者”的姿态
        // if (blob) {
        //     // 稍微放大一点，表示能量释放
        //     blob.scale.lerp(new THREE.Vector3(1.5, 1.5, 1.5), 0.1);
        //     // 慢慢自转
        //     blob.rotation.y += 0.02;
        // }

        if (blob) {
            // 目标是比基础大小再大 1.5 倍
            // const target = BASE_SCALE * 1.5; // 计算目标大小
            
            // 使用 lerp 平滑变大
            blob.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
            
            blob.rotation.y += 0.02;
        }

        // 4. 处理全景监狱的其他部分（比如地板）
        // 让地板也慢慢透明消失
        if (panopticon) {
            panopticon.children.forEach(child => {
                // 排除掉已经隐藏的墙壁
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
    
    // // ⭐ Transmutation 阶段：重生
    // if (phase === 'transmutation') {
    //     if (!transmutationStarted) {
    //         transmutationStarted = true;
    //         ruptureStartTime = null;
    //         console.log('Transmutation started - resetting blob');
            
    //         // 重置 blob
    //         if (blob) {
    //             blob.visible = true;
    //             blob.position.set(0, -5, 0); // 从下方开始
    //             blob.rotation.set(0, 0, 0);
    //             blob.scale.set(1, 1, 1);
                
    //             // 重置形态键
    //             if (morphTargets) {
    //                 for (let i = 0; i < morphTargets.length; i++) {
    //                     morphTargets[i] = 0;
    //                 }
    //             }
    //         }
            
    //         // 清除所有粒子
    //         particles.forEach(particle => {
    //             scene.remove(particle.system);
    //         });
    //         particles = [];
    //     }
        
    //     // 物体上升
    //     if (blob && blob.position.y < 0) {
    //         blob.position.y += 0.05;
    //     }
        
    //     // Panopticon 逐渐恢复
    //     if (panopticon) {
    //         panopticon.children.forEach(child => {
    //             if (child.material && child.material.opacity !== undefined) {
    //                 child.material.opacity = Math.min(1.0, child.material.opacity + 0.01);
    //             }
                
    //             // 重置位置
    //             if (child.geometry.type === 'CylinderGeometry') {
    //                 child.position.x = 0;
    //                 child.position.z = 0;
    //             }
    //         });
    //     }
        
    //     // 缓慢旋转
    //     if (blob) {
    //         blob.rotation.y += 0.002;
    //     }
    // }
    
    // // 其他阶段重置标志
    // if (phase !== 'rupture') {
    //     ruptureStartTime = null;
    // }
    // if (phase !== 'transmutation') {
    //     transmutationStarted = false;
    // }
    
    // // 更新粒子
    // if (particles.length > 0) {
    //     updateExplosionParticles();
    // }
    
    // ========== Phase 4: Transmutation (重生/自由) ==========
    if (phase === 'transmutation') {
        
        // 1. 初始化（只执行一次）
        if (!transmutationStarted) {
            transmutationStarted = true;
            switchToWarmWorld();
            
        //     // 重置 Blob 的位置和旋转，让它优雅地悬浮
        //     if (blob) {
        //         // 如果之前位置乱了，这里平滑归位（可选，这里直接设置也行）
        //         blob.position.set(0, 0, 0); 
        //         blob.scale.set(1, 1, 1);
        //     }
        // }
        
        // 重置 Blob
            if (blob) {
                blob.position.set(0, 0, 0); 
                // 👇 这里要改回 BASE_SCALE，而不是 1, 1, 1
                blob.scale.set(1, 1, 1); 
            }
        }
        
        // 2. 持续动画：优雅地旋转
        if (blob) {
            // 慢慢自转，展示完美的形态
            blob.rotation.y += 0.005; 
            
            // 微微上下浮动（呼吸感）
            const time = Date.now() * 0.001;
            blob.position.y = Math.sin(time) * 0.5;
        }
    }

    // 重置标志位（如果回退到其他阶段）
    if (phase !== 'transmutation') {
        transmutationStarted = false;
        // 如果想让它能回退到黑暗模式，这里其实还需要写一个 resetToDarkWorld()
        // 但通常这种体验是单向的，不需要回退。
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