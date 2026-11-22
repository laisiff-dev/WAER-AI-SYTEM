/* 輔英科技大學 3D 智慧水務 SCADA 引擎 (Three.js r128)
 * 包含四大互動 3D 數位孿生場景：
 * 1. SCADA 全廠 3D 淨水場數位孿生 (ScadaPlant3D)
 * 2. 3D 加氯 / 減氯反應槽與 HOCl/OCl⁻ 分子動態模擬器 (ChlorineReactor3D)
 * 3. 各單元系統 3D 即時用電量評估視圖 (EnergyUnits3D)
 * 4. 3D RS-485 / Modbus IoT 通訊架構透視 (IotComms3D)
 */

(function (global) {
  'use strict';

  // 輕量自建軌道攝影機控制器 (免外部 OrbitControls CDN，支援滑鼠拖曳旋轉、滾輪縮放、右鍵平移、平滑切換視角)
  class SimpleOrbitRig {
    constructor(camera, domElement, opts = {}) {
      this.camera = camera;
      this.domElement = domElement;
      this.target = new THREE.Vector3(...(opts.target || [0, 1.5, 0]));
      this.desiredTarget = this.target.clone();
      this.radius = opts.radius || 22;
      this.desiredRadius = this.radius;
      this.theta = opts.theta !== undefined ? opts.theta : 0.65;
      this.desiredTheta = this.theta;
      this.phi = opts.phi !== undefined ? opts.phi : 0.95;
      this.desiredPhi = this.phi;
      this.minRadius = opts.minRadius || 7;
      this.maxRadius = opts.maxRadius || 48;
      this.autoRotate = Boolean(opts.autoRotate);

      this.isDragging = false;
      this.dragButton = 0;
      this.lastX = 0;
      this.lastY = 0;

      this._bindEvents();
      this.update(1);
    }

    _bindEvents() {
      const el = this.domElement;
      el.addEventListener('pointerdown', (e) => {
        this.isDragging = true;
        this.dragButton = e.button;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.autoRotate = false;
        el.setPointerCapture?.(e.pointerId);
      });

      window.addEventListener('pointermove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (this.dragButton === 2 || e.shiftKey) {
          // Pan
          const panSpeed = this.radius * 0.0014;
          const forward = new THREE.Vector3();
          this.camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
          this.desiredTarget.addScaledVector(right, -dx * panSpeed);
          this.desiredTarget.addScaledVector(forward, dy * panSpeed);
        } else {
          // Orbit
          this.desiredTheta -= dx * 0.0075;
          this.desiredPhi = Math.max(0.18, Math.min(1.48, this.desiredPhi - dy * 0.0065));
        }
      });

      window.addEventListener('pointerup', () => {
        this.isDragging = false;
      });

      el.addEventListener('contextmenu', (e) => e.preventDefault());

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.09 : 0.92;
        this.desiredRadius = Math.max(this.minRadius, Math.min(this.maxRadius, this.desiredRadius * factor));
      }, { passive: false });
    }

    setPreset(theta, phi, radius, targetArr) {
      this.autoRotate = false;
      this.desiredTheta = theta;
      this.desiredPhi = phi;
      this.desiredRadius = radius;
      if (targetArr) this.desiredTarget.set(...targetArr);
    }

    update(lerpFactor = 0.09) {
      if (this.autoRotate && !this.isDragging) {
        this.desiredTheta += 0.0022;
      }
      this.theta += (this.desiredTheta - this.theta) * lerpFactor;
      this.phi += (this.desiredPhi - this.phi) * lerpFactor;
      this.radius += (this.desiredRadius - this.radius) * lerpFactor;
      this.target.lerp(this.desiredTarget, lerpFactor);

      const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
      const y = this.target.y + this.radius * Math.cos(this.phi);
      const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
      this.camera.position.set(x, y, z);
      this.camera.lookAt(this.target);
    }
  }

  // 共用輔助：投影 3D 世界座標至 2D HUD 標籤層
  function projectLabel(el, worldPos, camera, width, height) {
    if (!el) return;
    const v = worldPos.clone().project(camera);
    if (v.z > 1) {
      el.style.display = 'none';
      return;
    }
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    if (x < -40 || x > width + 40 || y < -20 || y > height + 40) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
  }

  function createRenderer(container) {
    if (!global.THREE) return null;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const w = Math.max(container.clientWidth, 320);
      const h = Math.max(container.clientHeight, 300);
      renderer.setSize(w, h);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.insertBefore(renderer.domElement, container.firstChild);
      return renderer;
    } catch (err) {
      console.warn('WebGL 初始化失敗:', err);
      return null;
    }
  }

  function createPipe(points, radius, color, opacity = 0.85) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, 36, radius, 12, false);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.35,
      roughness: 0.25,
      transparent: opacity < 1,
      opacity
    });
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, curve };
  }

  // =========================================================================
  // 場景 1：SCADA 全廠 3D 淨水場數位孿生 (ScadaPlant3D)
  // =========================================================================
  class ScadaPlant3D {
    constructor(containerId, labelsLayerId) {
      this.container = document.getElementById(containerId);
      this.labelsLayer = document.getElementById(labelsLayerId);
      if (!this.container || !global.THREE) return;

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x070e1c, 0.015);

      const w = Math.max(this.container.clientWidth, 400);
      const h = Math.max(this.container.clientHeight, 400);
      this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 150);
      this.renderer = createRenderer(this.container);
      if (!this.renderer) return;

      this.orbit = new SimpleOrbitRig(this.camera, this.renderer.domElement, {
        target: [0, 1.8, 0],
        radius: 25,
        theta: 0.55,
        phi: 1.02,
        minRadius: 9,
        maxRadius: 44
      });

      this.labels = [];
      this.flowParticles = [];
      this.rs485Packets = [];
      this.bubbles = [];
      this.clock = new THREE.Clock();

      this._setupLights();
      this._buildEnvironment();
      this._buildSedimentationTank();
      this._buildCleanWaterReservoir();
      this._buildFilterAndPumps();
      this._buildDosingStation();
      this._buildSmartBoxAndHubs();
      this._buildPipesAndFlows();
      this._buildAlarmBeacon();
      this._createHUDLabels();

      this.resize();
    }

    _setupLights() {
      const hemi = new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.85);
      this.scene.add(hemi);

      const dir = new THREE.DirectionalLight(0xffffff, 1.15);
      dir.position.set(14, 24, 16);
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      this.scene.add(dir);

      const cyanAccent = new THREE.PointLight(0x00f2fe, 0.85, 35);
      cyanAccent.position.set(0, 8, 6);
      this.scene.add(cyanAccent);
    }

    _buildEnvironment() {
      // Base industrial floor
      const floorGeo = new THREE.BoxGeometry(28, 0.5, 16);
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.25 });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.position.set(0, -0.25, 0);
      floor.receiveShadow = true;
      this.scene.add(floor);

      const grid = new THREE.GridHelper(36, 36, 0x0284c7, 0x16243d);
      grid.position.y = 0.02;
      this.scene.add(grid);

      // Process flow arrows on floor
      const padMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.3 });
      [[-8.5, 0.08, 1.5, 6.8, 6.2], [8.5, 0.08, 1.5, 6.8, 6.2], [0, 0.08, 2.2, 7.6, 5.2]].forEach(([x, y, z, w, d]) => {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), padMat);
        pad.position.set(x, y, z);
        pad.receiveShadow = true;
        this.scene.add(pad);
      });
    }

    _buildTankFrame(x, z, w, h, d, accentHex) {
      const group = new THREE.Group();
      group.position.set(x, 0.16, z);

      // Concrete base
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.35 })
      );
      base.position.y = 0.15;
      group.add(base);

      // Translucent glass tank walls
      const wallMat = new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.18,
        roughness: 0.12,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      const wallBox = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      wallBox.position.y = 0.3 + h / 2;
      group.add(wallBox);

      // Glowing wireframe rim
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: accentHex, transparent: true, opacity: 0.8 }));
      line.position.y = 0.3 + h / 2;
      group.add(line);

      // Top walkway rail
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3 });
      const topRim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.14, 0.2), rimMat);
      topRim.position.set(0, 0.3 + h + 0.05, -d / 2);
      group.add(topRim);

      this.scene.add(group);
      return group;
    }

    _buildProbe(parent, x, z, tipColor) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2.7, 12),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 })
      );
      rod.position.set(x, 2.35, z);
      parent.add(rod);

      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.12, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: tipColor, emissive: tipColor, emissiveIntensity: 0.55 })
      );
      tip.position.set(x, 0.95, z);
      parent.add(tip);

      // Air clean bubble particles around probe tip
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.8 })
        );
        b.position.set(x + (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 1.6, z + (Math.random() - 0.5) * 0.4);
        b.userData = { baseX: x, baseZ: z, speed: 0.8 + Math.random() * 1.2, offset: Math.random() * 6.28 };
        parent.add(b);
        this.bubbles.push(b);
      }
    }

    _buildSedimentationTank() {
      // Right side (Matches original Fig 4.1 right = 沉澱池, left = 清水池)
      this.sedGroup = this._buildTankFrame(8.5, 1.5, 5.6, 3.3, 4.6, 0x38bdf8);

      const waterGeo = new THREE.BoxGeometry(5.35, 2.4, 4.35);
      this.sedWaterMat = new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.72,
        roughness: 0.18,
        metalness: 0.1
      });
      this.sedWater = new THREE.Mesh(waterGeo, this.sedWaterMat);
      this.sedWater.position.y = 0.32 + 1.2;
      this.sedGroup.add(this.sedWater);

      // Sedimentation baffles
      const baffleMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.5 });
      [-1.3, 1.3].forEach(bx => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 4.2), baffleMat);
        b.position.set(bx, 1.5, 0);
        this.sedGroup.add(b);
      });

      this._buildProbe(this.sedGroup, -1.0, -0.5, 0x10b981); // pH485
      this._buildProbe(this.sedGroup, 1.1, -0.5, 0xf59e0b);  // ORP485
    }

    _buildCleanWaterReservoir() {
      this.cleanGroup = this._buildTankFrame(-8.5, 1.5, 5.6, 3.3, 4.6, 0x00f2fe);

      const waterGeo = new THREE.BoxGeometry(5.35, 2.5, 4.35);
      this.cleanWaterMat = new THREE.MeshPhysicalMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.74,
        roughness: 0.14,
        metalness: 0.12
      });
      this.cleanWater = new THREE.Mesh(waterGeo, this.cleanWaterMat);
      this.cleanWater.position.y = 0.32 + 1.25;
      this.cleanGroup.add(this.cleanWater);

      this._buildProbe(this.cleanGroup, -1.4, -0.5, 0x10b981); // pH485
      this._buildProbe(this.cleanGroup, 0.0, -0.5, 0xf59e0b);  // ORP485

      // 3D Float Water Level Switch (DI1)
      this.floatGroup = new THREE.Group();
      const floatStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8 })
      );
      floatStem.position.set(1.75, 2.1, 0.4);
      this.cleanGroup.add(floatStem);

      this.floatBuoy = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.4, roughness: 0.3 })
      );
      this.floatBuoy.position.set(1.75, 2.5, 0.4);
      this.cleanGroup.add(this.floatBuoy);
    }

    _buildFilterAndPumps() {
      // Two cylindrical Sand Filter Vessels behind pumps (Left = Filter A, Right = Filter B)
      const makeFilter = (fx) => {
        const vesselMat = new THREE.MeshStandardMaterial({
          color: 0x1e3a8a,
          emissive: 0x0284c7,
          emissiveIntensity: 0.15,
          metalness: 0.55,
          roughness: 0.35
        });
        const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 2.6, 20), vesselMat);
        vessel.position.set(fx, 1.5, 0.3);
        vessel.castShadow = true;
        this.scene.add(vessel);

        const capMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x00f2fe,
          emissiveIntensity: 0.2,
          metalness: 0.7,
          roughness: 0.25
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
        dome.position.set(fx, 2.8, 0.3);
        this.scene.add(dome);

        return { vesselMat, capMat };
      };

      this.filterA = makeFilter(-1.8);
      this.filterB = makeFilter(1.8);

      // Sand Filter Pump A (Left) & Pump B (Right) — Forward-facing (+Z) impellers & top beacons
      const makePump = (x, z) => {
        const g = new THREE.Group();
        g.position.set(x, 0.25, z);

        const base = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 0.28, 1.35),
          new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 })
        );
        base.position.y = 0.14;
        g.add(base);

        // Horizontal pump body oriented along Z so impeller faces the viewer (+Z)
        const motorMat = new THREE.MeshStandardMaterial({
          color: 0x0f766e,
          emissive: 0x10b981,
          emissiveIntensity: 0.35,
          metalness: 0.55,
          roughness: 0.3
        });
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.15, 22), motorMat);
        motor.rotation.x = Math.PI / 2;
        motor.position.set(0, 0.82, -0.05);
        g.add(motor);

        // Front glowing status ring facing +Z (clearly visible for both A and B)
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.08, 12, 28), ringMat);
        ring.position.set(0, 0.82, 0.55);
        g.add(ring);

        // Front spinning impeller blades facing +Z
        const impeller = new THREE.Group();
        impeller.position.set(0, 0.82, 0.62);
        const bladeMat = new THREE.MeshStandardMaterial({
          color: 0x00f2fe,
          emissive: 0x00f2fe,
          emissiveIntensity: 0.75
        });
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 0.08), bladeMat);
          b.rotation.z = (i * Math.PI) / 4;
          impeller.add(b);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12), bladeMat);
        hub.rotation.x = Math.PI / 2;
        impeller.add(hub);
        g.add(impeller);

        // Top glowing indicator lamp on motor housing
        const lampMat = new THREE.MeshStandardMaterial({
          color: 0x10b981,
          emissive: 0x10b981,
          emissiveIntensity: 0.9
        });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), lampMat);
        lamp.position.set(0, 1.48, 0);
        g.add(lamp);

        this.scene.add(g);
        return { group: g, baseY: 0.25, motorMat, ringMat, bladeMat, lampMat, impeller };
      };

      this.pumpA = makePump(-1.8, 3.0);
      this.pumpB = makePump(1.8, 3.0);
    }

    _buildDosingStation() {
      // NaOCl Dosing Tank & Pump
      const g = new THREE.Group();
      g.position.set(-4.3, 0.2, 3.8);

      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 1.85, 20),
        new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45, roughness: 0.15 })
      );
      tank.position.y = 0.95;
      g.add(tank);

      const liquid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.58, 1.35, 20),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 })
      );
      liquid.position.y = 0.72;
      g.add(liquid);

      // Dosing pump head on top
      this.doseHead = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.42, 0.55),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.45, metalness: 0.4 })
      );
      this.doseHead.position.set(0, 2.08, 0);
      g.add(this.doseHead);

      this.scene.add(g);
    }

    _buildSmartBoxAndHubs() {
      // Central Smart Box DO4-ABS-N Cabinet (Elevated at back center)
      const cabinet = new THREE.Group();
      cabinet.position.set(0, 0.2, -3.8);

      // Pedestal
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.3, 2.6, 12),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 })
      );
      stand.position.y = 1.3;
      cabinet.add(stand);

      // IP67 ABS Enclosure
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 2.5, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.45, roughness: 0.35 })
      );
      box.position.y = 3.6;
      cabinet.add(box);

      // Glowing Cyan Border
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(3.24, 2.54, 1.04)),
        new THREE.LineBasicMaterial({ color: 0x00f2fe })
      );
      frame.position.y = 3.6;
      cabinet.add(frame);

      // Screen panel
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 0.85),
        new THREE.MeshBasicMaterial({ color: 0x082f49 })
      );
      screen.position.set(0, 4.2, 0.52);
      cabinet.add(screen);

      // 4 Relay 3D LEDs
      this.relayLeds = [];
      [-1.05, -0.35, 0.35, 1.05].forEach((lx) => {
        const ledMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.0 });
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), ledMat);
        led.position.set(lx, 3.1, 0.54);
        cabinet.add(led);
        this.relayLeds.push(ledMat);
      });

      this.scene.add(cabinet);

      // Two RS-485 HUBs (HUB485-300-12V-6CH-N)
      const makeHub = (x) => {
        const hg = new THREE.Group();
        hg.position.set(x, 3.4, -3.5);
        const hbox = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 1.1, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.5, roughness: 0.35 })
        );
        hg.add(hbox);
        const hEdge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1.74, 1.14, 0.64)),
          new THREE.LineBasicMaterial({ color: 0x38bdf8 })
        );
        hg.add(hEdge);
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x475569 })
        );
        post.position.y = -1.7;
        hg.add(post);
        this.scene.add(hg);
      };
      makeHub(-7.8);
      makeHub(7.8);
    }

    _buildPipesAndFlows() {
      // Independent water pipe paths for Intake, Branch A (Left Pump/Filter), Branch B (Right Pump/Filter), and Dosing
      const pIntake = createPipe([[5.7, 1.0, 2.8], [3.6, 1.0, 3.0], [1.8, 0.9, 3.0]], 0.16, 0x38bdf8, 0.55);
      const pManifoldA = createPipe([[1.8, 0.9, 3.0], [0.0, 0.9, 3.0], [-1.8, 0.9, 3.0]], 0.15, 0x38bdf8, 0.55);
      const pBranchA = createPipe([[-1.8, 1.2, 2.4], [-1.8, 2.2, 0.3], [-4.2, 2.2, 0.3], [-5.7, 2.2, 1.2]], 0.16, 0x00f2fe, 0.62);
      const pBranchB = createPipe([[1.8, 1.2, 2.4], [1.8, 2.2, 0.3], [0.0, 2.55, 0.3], [-4.2, 2.55, 0.3], [-5.7, 2.2, 1.2]], 0.16, 0x10b981, 0.62);
      // Dosing feed pipe
      const pDose = createPipe([[-4.3, 2.2, 3.8], [-4.3, 2.5, 1.5], [-5.8, 2.5, 1.5]], 0.08, 0xf59e0b, 0.85);

      [pIntake, pManifoldA, pBranchA, pBranchB, pDose].forEach(p => this.scene.add(p.mesh));

      // Animated water particles along each independent branch
      const addFlowSet = (curve, count, color, tag) => {
        for (let i = 0; i < count; i++) {
          const orb = new THREE.Mesh(
            new THREE.SphereGeometry(tag === 'dose' ? 0.1 : 0.14, 8, 8),
            new THREE.MeshBasicMaterial({ color })
          );
          this.scene.add(orb);
          this.flowParticles.push({ mesh: orb, curve, t: i / count, speed: tag === 'dose' ? 0.38 : 0.30, tag });
        }
      };
      addFlowSet(pIntake.curve, 5, 0x7dd3fc, 'intake');
      addFlowSet(pManifoldA.curve, 5, 0x7dd3fc, 'pumpA');
      addFlowSet(pBranchA.curve, 8, 0x00f2fe, 'pumpA');
      addFlowSet(pBranchB.curve, 10, 0x34d399, 'pumpB');
      addFlowSet(pDose.curve, 5, 0xfbbf24, 'dose');

      // RS-485 Data Cables: HUBs -> DO4 Smart Box
      const rsL = createPipe([[-6.9, 3.4, -3.5], [-3.8, 3.6, -3.7], [-1.6, 3.6, -3.8]], 0.055, 0x10b981, 0.8);
      const rsR = createPipe([[6.9, 3.4, -3.5], [3.8, 3.6, -3.7], [1.6, 3.6, -3.8]], 0.055, 0x10b981, 0.8);
      this.scene.add(rsL.mesh);
      this.scene.add(rsR.mesh);

      [rsL.curve, rsR.curve].forEach(curve => {
        for (let i = 0; i < 4; i++) {
          const pkt = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x4ade80 })
          );
          this.scene.add(pkt);
          this.rs485Packets.push({ mesh: pkt, curve, t: i / 4 });
        }
      });
    }

    _buildAlarmBeacon() {
      // Industrial Red Strobe Beacon Tower mounted on top of Smart Box DO4
      const g = new THREE.Group();
      g.position.set(0, 5.15, -3.8);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.7, 10),
        new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7 })
      );
      pole.position.y = 0.25;
      g.add(pole);

      this.beaconMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.92
      });
      this.beaconDome = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.55, 16), this.beaconMat);
      this.beaconDome.position.y = 0.85;
      g.add(this.beaconDome);

      this.alarmPointLight = new THREE.PointLight(0xef4444, 0, 26);
      this.alarmPointLight.position.set(0, 1.1, 0.3);
      g.add(this.alarmPointLight);

      this.scene.add(g);
    }

    _createHUDLabels() {
      if (!this.labelsLayer) return;
      this.labelsLayer.innerHTML = '';
      const defs = [
        { id: 'lbl-sed', pos: new THREE.Vector3(8.5, 4.3, 1.5), html: '沉澱池 (原水)<br><strong id="hud3d-sed">pH 7.14 | 485 mV</strong>' },
        { id: 'lbl-clean', pos: new THREE.Vector3(-8.5, 4.3, 1.5), html: '清水池 (出水)<br><strong id="hud3d-clean">Cl₂ 0.58 mg/L | 710 mV</strong>' },
        { id: 'lbl-smartbox', pos: new THREE.Vector3(0, 6.4, -3.8), html: 'DO4-ABS-N Smart Box<br><strong id="hud3d-mode">AUTO 自動交替</strong>' },
        { id: 'lbl-pump-a', pos: new THREE.Vector3(-1.8, 2.5, 3.3), html: '砂濾泵 A (左)<br><strong id="hud3d-pump-a">🟢 運轉中</strong>' },
        { id: 'lbl-pump-b', pos: new THREE.Vector3(1.8, 2.5, 3.3), html: '砂濾泵 B (右)<br><strong id="hud3d-pump-b">⚫ 待機</strong>' },
        { id: 'lbl-dose', pos: new THREE.Vector3(-4.3, 2.9, 3.8), html: 'NaOCl 加藥系統<br><strong id="hud3d-dose">連動投藥中</strong>' }
      ];
      defs.forEach(d => {
        const el = document.createElement('div');
        el.className = 'label-3d';
        el.id = d.id;
        el.innerHTML = d.html;
        this.labelsLayer.appendChild(el);
        this.labels.push({ el, pos: d.pos });
      });
    }

    setCameraPreset(name) {
      if (!this.orbit) return;
      const presets = {
        overview: [0.55, 1.02, 25, [0, 1.8, 0]],
        sed: [0.25, 0.95, 12.5, [8.5, 1.8, 1.5]],
        clean: [-0.35, 0.95, 12.5, [-8.5, 1.8, 1.5]],
        pumps: [0.05, 1.12, 13.5, [-0.5, 1.6, 2.2]],
        smartbox: [0.0, 1.18, 11.5, [0, 3.5, -3.5]]
      };
      const p = presets[name] || presets.overview;
      this.orbit.setPreset(...p);
    }

    syncState(s) {
      if (!this.renderer) return;
      this._lastState = s;

      // Water level of clean water reservoir
      let levelScale = 0.85;
      if (s.cleanWaterLevel === 'HIGH') levelScale = 1.08;
      else if (s.cleanWaterLevel === 'LOW') levelScale = 0.48;
      this.cleanWater.scale.y = levelScale;
      this.cleanWater.position.y = 0.32 + (2.5 * levelScale) / 2;
      this.floatBuoy.position.y = 0.35 + 2.5 * levelScale;

      // Water color reflecting quality & chlorine alarm
      const cl = s.freeChlorine || 0.58;
      if (cl < s.alarmCriticalLow) {
        this.cleanWaterMat.color.setHex(0xd97706); // Murky amber warning
      } else if (cl > s.alarmHigh) {
        this.cleanWaterMat.color.setHex(0x9333ea); // Over-chlorinated purple
      } else {
        this.cleanWaterMat.color.setHex(0x06b6d4); // Crystal cyan
      }

      if (s.sedimentationOrp < 440) {
        this.sedWaterMat.color.setHex(0x92400e); // Turbid raw water
      } else {
        this.sedWaterMat.color.setHex(0x0284c7);
      }

      // Pump A & B distinct visual indicators (Ring, Blades, Lamp, Motor glow & Filter vessels)
      const aRun = s.pumpAStatus === 'RUNNING';
      const bRun = s.pumpBStatus === 'RUNNING';
      const dRun = s.dosingPumpStatus === 'RUNNING';

      const applyPumpStyle = (pump, filter, active, activeHex) => {
        pump.ringMat.color.setHex(active ? activeHex : 0x475569);
        pump.bladeMat.color.setHex(active ? activeHex : 0x64748b);
        pump.bladeMat.emissive.setHex(active ? activeHex : 0x000000);
        pump.bladeMat.emissiveIntensity = active ? 0.95 : 0;
        pump.motorMat.color.setHex(active ? 0x0f766e : 0x1e293b);
        pump.motorMat.emissive.setHex(active ? activeHex : 0x000000);
        pump.motorMat.emissiveIntensity = active ? 0.35 : 0;
        pump.lampMat.color.setHex(active ? 0x10b981 : 0x475569);
        pump.lampMat.emissive.setHex(active ? 0x10b981 : 0x000000);
        pump.lampMat.emissiveIntensity = active ? 1.2 : 0;
        if (filter) {
          filter.vesselMat.emissiveIntensity = active ? 0.45 : 0.04;
          filter.capMat.emissiveIntensity = active ? 0.55 : 0.05;
        }
      };

      applyPumpStyle(this.pumpA, this.filterA, aRun, 0x00f2fe);
      applyPumpStyle(this.pumpB, this.filterB, bRun, 0x34d399);
      this.doseHead.material.emissiveIntensity = dRun ? 0.9 : 0.1;

      // 4 Relay LEDs on 3D Smart Box
      const ledStates = [aRun, bRun, dRun, s.airCleanPulse];
      const ledColors = [0x10b981, 0x10b981, 0xf59e0b, 0x00f2fe];
      ledStates.forEach((on, idx) => {
        const m = this.relayLeds[idx];
        if (!m) return;
        m.color.setHex(on ? ledColors[idx] : 0x334155);
        m.emissive.setHex(on ? ledColors[idx] : 0x000000);
        m.emissiveIntensity = on ? 1.1 : 0;
      });

      // Update floating HUD text
      const hudSed = document.getElementById('hud3d-sed');
      const hudClean = document.getElementById('hud3d-clean');
      const hudMode = document.getElementById('hud3d-mode');
      const hudPumpA = document.getElementById('hud3d-pump-a');
      const hudPumpB = document.getElementById('hud3d-pump-b');
      const hudDose = document.getElementById('hud3d-dose');
      const lblPumpA = document.getElementById('lbl-pump-a');
      const lblPumpB = document.getElementById('lbl-pump-b');

      if (hudSed) hudSed.textContent = `pH ${s.sedimentationPh.toFixed(2)} | ${Math.round(s.sedimentationOrp)} mV`;
      if (hudClean) hudClean.textContent = `Cl₂ ${cl.toFixed(2)} mg/L | ${Math.round(s.cleanWaterOrp)} mV`;
      if (hudMode) hudMode.textContent = `${s.ctrlMode} | ${s.totalKw.toFixed(2)} kW`;
      if (hudPumpA) hudPumpA.textContent = aRun ? '🟢 運轉中 (2.20 kW)' : '⚫ 待機停止';
      if (hudPumpB) hudPumpB.textContent = bRun ? '🟢 運轉中 (2.20 kW)' : '⚫ 待機停止';
      if (lblPumpA) lblPumpA.className = 'label-3d' + (aRun ? ' green' : '');
      if (lblPumpB) lblPumpB.className = 'label-3d' + (bRun ? ' green' : '');
      if (hudDose) hudDose.textContent = dRun ? 'NaOCl 投藥中' : '停止待機';

      // Highlight alarm label
      const lblClean = document.getElementById('lbl-clean');
      if (lblClean) {
        lblClean.className = s.alarmSeverity === 'CRITICAL' ? 'label-3d alarm' : s.alarmSeverity === 'WARNING' ? 'label-3d amber' : 'label-3d green';
      }
    }

    resize() {
      if (!this.renderer || !this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 10 || h < 10) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    renderFrame() {
      if (!this.renderer) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      const s = this._lastState || {};

      this.orbit.update(0.09);

      // Spin active pump impellers (+Z axis for forward-facing impellers) & subtle vibration
      const aRunning = s.pumpAStatus === 'RUNNING';
      const bRunning = s.pumpBStatus === 'RUNNING';
      if (aRunning) {
        this.pumpA.impeller.rotation.z -= dt * 11.0;
        this.pumpA.group.position.y = this.pumpA.baseY + Math.sin(t * 28) * 0.015;
      } else {
        this.pumpA.group.position.y = this.pumpA.baseY;
      }
      if (bRunning) {
        this.pumpB.impeller.rotation.z -= dt * 11.0;
        this.pumpB.group.position.y = this.pumpB.baseY + Math.sin(t * 28 + 1.5) * 0.015;
      } else {
        this.pumpB.group.position.y = this.pumpB.baseY;
      }

      // Dosing pump vibration pulse
      if (s.dosingPumpStatus === 'RUNNING') {
        this.doseHead.scale.y = 1 + Math.sin(t * 14) * 0.08;
      } else {
        this.doseHead.scale.y = 1;
      }

      // Independent water flow particles per branch (Intake, Pump A left, Pump B right, Dose)
      const anyPump = aRunning || bRunning;
      const doseActive = s.dosingPumpStatus === 'RUNNING';
      this.flowParticles.forEach(fp => {
        let active = false;
        if (fp.tag === 'intake') active = anyPump;
        else if (fp.tag === 'pumpA') active = aRunning;
        else if (fp.tag === 'pumpB') active = bRunning;
        else if (fp.tag === 'dose') active = doseActive;
        fp.mesh.visible = active;
        if (active) {
          fp.t = (fp.t + dt * fp.speed) % 1;
          fp.mesh.position.copy(fp.curve.getPointAt(fp.t));
        }
      });

      // RS-485 Data packets
      this.rs485Packets.forEach(pk => {
        pk.t = (pk.t + dt * 0.55) % 1;
        pk.mesh.position.copy(pk.curve.getPointAt(pk.t));
      });

      // Air clean bubbles
      const airOn = Boolean(s.airCleanPulse);
      this.bubbles.forEach(b => {
        b.visible = airOn;
        if (airOn) {
          b.position.y += dt * b.userData.speed * 1.4;
          if (b.position.y > 2.7) b.position.y = 0.85;
          b.position.x = b.userData.baseX + Math.sin(t * 5 + b.userData.offset) * 0.18;
        }
      });

      // 3D Alarm Beacon Strobe
      if (s.alarmSeverity === 'CRITICAL') {
        const flash = 0.5 + 0.5 * Math.sin(t * 12);
        this.beaconMat.color.setHex(0xef4444);
        this.beaconMat.emissive.setHex(0xef4444);
        this.beaconMat.emissiveIntensity = 0.6 + flash * 1.8;
        this.alarmPointLight.color.setHex(0xef4444);
        this.alarmPointLight.intensity = flash * 3.2;
      } else if (s.alarmSeverity === 'WARNING') {
        const flash = 0.5 + 0.5 * Math.sin(t * 6);
        this.beaconMat.color.setHex(0xf59e0b);
        this.beaconMat.emissive.setHex(0xf59e0b);
        this.beaconMat.emissiveIntensity = 0.5 + flash * 1.0;
        this.alarmPointLight.color.setHex(0xf59e0b);
        this.alarmPointLight.intensity = flash * 1.6;
      } else {
        this.beaconMat.color.setHex(0x10b981);
        this.beaconMat.emissive.setHex(0x10b981);
        this.beaconMat.emissiveIntensity = 0.45;
        this.alarmPointLight.intensity = 0;
      }

      // Project crisp 3D HUD Labels
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.labels.forEach(item => projectLabel(item.el, item.pos, this.camera, w, h));

      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // 場景 2：3D 加氯 / 減氯化學反應器與 HOCl / OCl⁻ 分子動態模擬 (ChlorineReactor3D)
  // =========================================================================
  class ChlorineReactor3D {
    constructor(containerId, labelsLayerId) {
      this.container = document.getElementById(containerId);
      this.labelsLayer = document.getElementById(labelsLayerId);
      if (!this.container || !global.THREE) return;

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x060c1a, 0.018);

      const w = Math.max(this.container.clientWidth, 400);
      const h = Math.max(this.container.clientHeight, 360);
      this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 120);
      this.renderer = createRenderer(this.container);
      if (!this.renderer) return;

      this.orbit = new SimpleOrbitRig(this.camera, this.renderer.domElement, {
        target: [0, 2.3, 0],
        radius: 15.5,
        theta: 0.35,
        phi: 1.05,
        minRadius: 6,
        maxRadius: 28
      });

      this.clock = new THREE.Clock();
      this.labels = [];
      this.molecules = [];
      this.dropletsNaocl = [];
      this.dropletsNahso3 = [];
      this.dropletsAcidBase = [];
      this.bubbles = [];

      this._setupLights();
      this._buildReactorPlatform();
      this._buildCentralTank();
      this._buildChemicalStations();
      this._buildMolecules();
      this._createLabels();
      this.resize();
    }

    _setupLights() {
      this.scene.add(new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.9));
      const d = new THREE.DirectionalLight(0xffffff, 1.15);
      d.position.set(10, 18, 12);
      this.scene.add(d);

      this.tankGlowLight = new THREE.PointLight(0x00f2fe, 1.2, 20);
      this.tankGlowLight.position.set(0, 3.0, 0);
      this.scene.add(this.tankGlowLight);
    }

    _buildReactorPlatform() {
      const grid = new THREE.GridHelper(24, 24, 0x0ea5e9, 0x16243d);
      this.scene.add(grid);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(7.2, 7.6, 0.35, 36),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.45, roughness: 0.6 })
      );
      base.position.y = -0.18;
      this.scene.add(base);
    }

    _buildCentralTank() {
      // Stainless steel base pedestal
      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(3.15, 3.3, 0.4, 32),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.3 })
      );
      ped.position.y = 0.2;
      this.scene.add(ped);

      // Transparent acrylic disinfection reactor cylinder
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.16,
        roughness: 0.08,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      const glassWall = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 4.6, 36, 1, true), glassMat);
      glassWall.position.y = 2.7;
      this.scene.add(glassWall);

      // Top & bottom metallic rings
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.25 });
      [0.45, 5.0].forEach(ry => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(3.02, 0.08, 12, 48), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = ry;
        this.scene.add(ring);
      });

      // Dynamic water body inside reactor
      this.waterMat = new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.56,
        roughness: 0.15,
        metalness: 0.08
      });
      this.waterBody = new THREE.Mesh(new THREE.CylinderGeometry(2.88, 2.88, 3.65, 32), this.waterMat);
      this.waterBody.position.y = 2.25;
      this.scene.add(this.waterBody);

      // Animated wavy top water disc
      const surfGeo = new THREE.CircleGeometry(2.88, 32);
      this.waterSurface = new THREE.Mesh(
        surfGeo,
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65, roughness: 0.1, side: THREE.DoubleSide })
      );
      this.waterSurface.rotation.x = -Math.PI / 2;
      this.waterSurface.position.y = 4.08;
      this.scene.add(this.waterSurface);

      // Overhead bridge & motorized mixer
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(6.6, 0.22, 0.65),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.3 })
      );
      bridge.position.y = 5.15;
      this.scene.add(bridge);

      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.9, 18),
        new THREE.MeshStandardMaterial({ color: 0x0f766e, metalness: 0.6, roughness: 0.3 })
      );
      motor.position.y = 5.7;
      this.scene.add(motor);

      // Top Alarm Beacon on Mixer
      this.reactorAlarmMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.6 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), this.reactorAlarmMat);
      beacon.position.y = 6.32;
      this.scene.add(beacon);

      // Spinning Mixer Shaft & Pitched Impeller Blades
      this.mixerGroup = new THREE.Group();
      this.mixerGroup.position.y = 0;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 4.1, 12),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 })
      );
      shaft.position.y = 3.2;
      this.mixerGroup.add(shaft);

      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x00f2fe, emissive: 0x0284c7, emissiveIntensity: 0.35, metalness: 0.6 });
      [1.45, 2.55].forEach((by) => {
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.32), bladeMat);
          blade.position.y = by;
          blade.rotation.y = (i * Math.PI) / 2;
          blade.rotation.x = 0.35;
          this.mixerGroup.add(blade);
        }
      });
      this.scene.add(this.mixerGroup);

      // Submerged Cl2/ORP Probe & pH Probe
      const addProbe = (x, z, color) => {
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 3.6, 12),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85 })
        );
        rod.position.set(x, 3.4, z);
        this.scene.add(rod);
        const tip = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.12, 0.45, 14),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 })
        );
        tip.position.set(x, 1.5, z);
        this.scene.add(tip);
      };
      addProbe(-1.85, 0.4, 0x00f2fe); // Cl2/ORP
      addProbe(1.85, 0.4, 0x10b981);  // pH

      // Rising micro-bubbles
      for (let i = 0; i < 28; i++) {
        const b = new THREE.Mesh(
          new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.55 })
        );
        const angle = Math.random() * Math.PI * 2;
        const rad = 0.4 + Math.random() * 2.1;
        b.position.set(Math.cos(angle) * rad, 0.6 + Math.random() * 3.3, Math.sin(angle) * rad);
        b.userData = { angle, rad, speed: 0.5 + Math.random() * 0.9 };
        this.scene.add(b);
        this.bubbles.push(b);
      }
    }

    _buildChemicalStations() {
      const makeChemTank = (x, z, r, h, colorHex, pipePts, dropletList) => {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const shell = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, h, 20),
          new THREE.MeshPhysicalMaterial({ color: colorHex, transparent: true, opacity: 0.35, roughness: 0.15 })
        );
        shell.position.y = h / 2 + 0.1;
        g.add(shell);

        const liq = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.88, r * 0.88, h * 0.72, 20),
          new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 })
        );
        liq.position.y = h * 0.38 + 0.1;
        g.add(liq);

        const pump = new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 0.45, 0.65),
          new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.5, roughness: 0.3 })
        );
        pump.position.set(0, h + 0.32, 0);
        g.add(pump);
        this.scene.add(g);

        const pipe = createPipe(pipePts, 0.065, colorHex, 0.85);
        this.scene.add(pipe.mesh);

        const dropStart = pipePts[pipePts.length - 1];
        for (let i = 0; i < 6; i++) {
          const drop = new THREE.Mesh(
            new THREE.SphereGeometry(0.095, 10, 10),
            new THREE.MeshBasicMaterial({ color: colorHex })
          );
          drop.position.set(dropStart[0], dropStart[1] - i * 0.25, dropStart[2]);
          drop.userData = { startX: dropStart[0], startY: dropStart[1], startZ: dropStart[2], phase: i / 6 };
          this.scene.add(drop);
          dropletList.push(drop);
        }
        return { liq, pump };
      };

      // Left: NaOCl (12%)
      this.naoclStation = makeChemTank(
        -5.4, 0.2, 0.95, 2.8, 0x38bdf8,
        [[-5.4, 3.1, 0.2], [-5.4, 5.1, 0.2], [-1.35, 5.1, 0.2], [-1.35, 4.7, 0.2]],
        this.dropletsNaocl
      );

      // Right: NaHSO3 (Dechlorination)
      this.nahso3Station = makeChemTank(
        5.4, 0.2, 0.95, 2.8, 0x34d399,
        [[5.4, 3.1, 0.2], [5.4, 5.1, 0.2], [1.35, 5.1, 0.2], [1.35, 4.7, 0.2]],
        this.dropletsNahso3
      );

      // Rear Left: HCl Acid Titration
      makeChemTank(
        -2.6, -4.6, 0.55, 2.1, 0xf97316,
        [[-2.6, 2.5, -4.6], [-2.6, 4.9, -4.6], [-0.9, 4.9, -1.2], [-0.9, 4.65, -1.2]],
        this.dropletsAcidBase
      );

      // Rear Right: NaOH Alkali Titration
      makeChemTank(
        2.6, -4.6, 0.55, 2.1, 0x60a5fa,
        [[2.6, 2.5, -4.6], [2.6, 4.9, -4.6], [0.9, 4.9, -1.2], [0.9, 4.65, -1.2]],
        this.dropletsAcidBase
      );
    }

    _buildMolecules() {
      // 60 3D Molecular Speciation Particles representing HOCl (Cyan) vs OCl- (Green)
      const geo = new THREE.IcosahedronGeometry(0.14, 1);
      for (let i = 0; i < 60; i++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x00f2fe,
          emissive: 0x00f2fe,
          emissiveIntensity: 0.75,
          roughness: 0.2
        });
        const m = new THREE.Mesh(geo, mat);
        const angle = Math.random() * Math.PI * 2;
        const rad = 0.55 + Math.random() * 1.95;
        const y = 0.8 + Math.random() * 2.85;
        m.position.set(Math.cos(angle) * rad, y, Math.sin(angle) * rad);
        m.userData = { angle, rad, y, speed: 0.6 + Math.random() * 0.9, bobPhase: Math.random() * 6.28 };
        this.scene.add(m);
        this.molecules.push(m);
      }
    }

    _createLabels() {
      if (!this.labelsLayer) return;
      this.labelsLayer.innerHTML = '';
      const defs = [
        { id: 'cl3d-tank', pos: new THREE.Vector3(0, 6.7, 0), html: '3D 消毒反應槽<br><strong id="hud-cl3d-val">0.58 mg/L | pH 7.20</strong>' },
        { id: 'cl3d-naocl', pos: new THREE.Vector3(-5.4, 3.8, 0.2), html: 'NaOCl 加氯桶<br><strong id="hud-cl3d-naocl">35 mL/min</strong>' },
        { id: 'cl3d-nahso3', pos: new THREE.Vector3(5.4, 3.8, 0.2), html: 'NaHSO₃ 脫氯桶<br><strong id="hud-cl3d-nahso3">0 mL/min</strong>' },
        { id: 'cl3d-spec', pos: new THREE.Vector3(0, 0.6, 3.2), html: '3D 分子解離雲<br><strong id="hud-cl3d-spec">HOCl 68% / OCl⁻ 32%</strong>' }
      ];
      defs.forEach(d => {
        const el = document.createElement('div');
        el.className = 'label-3d';
        el.id = d.id;
        el.innerHTML = d.html;
        this.labelsLayer.appendChild(el);
        this.labels.push({ el, pos: d.pos });
      });
    }

    setCameraPreset(name) {
      if (!this.orbit) return;
      const presets = {
        overview: [0.35, 1.05, 15.5, [0, 2.3, 0]],
        molecules: [0.15, 1.25, 8.2, [0, 2.2, 0]],
        top: [0.0, 0.28, 13.5, [0, 2.0, 0]],
        dosing: [-0.55, 1.02, 13.5, [-2.2, 2.6, 0]]
      };
      this.orbit.setPreset(...(presets[name] || presets.overview));
    }

    syncState(gs, sp) {
      if (!this.renderer) return;
      this._gs = gs;
      this._sp = sp;

      // Water color based on chlorine & organic load
      if (gs.chlorine > 1.2) {
        this.waterMat.color.setHex(0x9333ea);
        this.tankGlowLight.color.setHex(0xa855f7);
        this.reactorAlarmMat.color.setHex(0xef4444);
        this.reactorAlarmMat.emissive.setHex(0xef4444);
      } else if (gs.chlorine < 0.2 || gs.organicLoad > 0.5) {
        this.waterMat.color.setHex(0xd97706);
        this.tankGlowLight.color.setHex(0xf59e0b);
        this.reactorAlarmMat.color.setHex(0xef4444);
        this.reactorAlarmMat.emissive.setHex(0xef4444);
      } else {
        this.waterMat.color.setHex(0x0284c7);
        this.tankGlowLight.color.setHex(0x00f2fe);
        this.reactorAlarmMat.color.setHex(0x10b981);
        this.reactorAlarmMat.emissive.setHex(0x10b981);
      }

      // Color 60 3D molecules accurately by HOCl % vs OCl- %
      const hoclCount = Math.round((sp.hoclPct / 100) * this.molecules.length);
      const visibleCount = Math.max(10, Math.min(60, Math.round(gs.chlorine * 36)));
      this.molecules.forEach((m, idx) => {
        m.visible = idx < visibleCount;
        const isHocl = idx < Math.round((sp.hoclPct / 100) * visibleCount);
        m.material.color.setHex(isHocl ? 0x00f2fe : 0x10b981);
        m.material.emissive.setHex(isHocl ? 0x00f2fe : 0x059669);
        const s = isHocl ? 1.12 : 0.85;
        m.scale.set(s, s, s);
      });

      const elVal = document.getElementById('hud-cl3d-val');
      const elNaocl = document.getElementById('hud-cl3d-naocl');
      const elNahso3 = document.getElementById('hud-cl3d-nahso3');
      const elSpec = document.getElementById('hud-cl3d-spec');
      if (elVal) elVal.textContent = `${gs.chlorine.toFixed(2)} mg/L | pH ${sp.ph.toFixed(2)}`;
      if (elNaocl) elNaocl.textContent = `${gs.naoclRate} mL/min`;
      if (elNahso3) elNahso3.textContent = `${gs.nahso3Rate} mL/min`;
      if (elSpec) elSpec.textContent = `HOCl ${sp.hoclPct}% / OCl⁻ ${sp.oclPct}% (${hoclCount}顆強效)`;
    }

    resize() {
      if (!this.renderer || !this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 10 || h < 10) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    renderFrame() {
      if (!this.renderer) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      const gs = this._gs || { naoclRate: 35, nahso3Rate: 0, inflow: 50, chlorine: 0.58 };
      const sp = this._sp || { hclDose: 0, naohDose: 0 };

      this.orbit.update(0.09);

      // Spin impeller proportional to activity
      const spinSpeed = 1.6 + (gs.inflow / 40) + (gs.naoclRate + gs.nahso3Rate) * 0.03;
      this.mixerGroup.rotation.y += dt * spinSpeed;

      // Water surface gentle bobbing
      this.waterSurface.position.y = 4.06 + Math.sin(t * 2.8) * 0.035;

      // Swirl 3D HOCl / OCl- molecules in vortex
      this.molecules.forEach(m => {
        if (!m.visible) return;
        m.userData.angle += dt * m.userData.speed * (0.8 + spinSpeed * 0.16);
        m.position.x = Math.cos(m.userData.angle) * m.userData.rad;
        m.position.z = Math.sin(m.userData.angle) * m.userData.rad;
        m.position.y = m.userData.y + Math.sin(t * 2.2 + m.userData.bobPhase) * 0.18;
        m.rotation.x += dt * 1.4;
        m.rotation.y += dt * 1.1;
      });

      // Rising micro-bubbles
      this.bubbles.forEach(b => {
        b.position.y += dt * b.userData.speed;
        b.userData.angle += dt * 0.4;
        b.position.x = Math.cos(b.userData.angle) * b.userData.rad;
        b.position.z = Math.sin(b.userData.angle) * b.userData.rad;
        if (b.position.y > 4.0) b.position.y = 0.65;
      });

      // Falling chemical droplets
      const animDrops = (list, activeRate) => {
        const speed = 0.8 + activeRate * 0.025;
        list.forEach(d => {
          d.visible = activeRate > 0;
          if (!d.visible) return;
          d.userData.phase = (d.userData.phase + dt * speed) % 1;
          d.position.y = d.userData.startY - d.userData.phase * 1.15;
        });
      };
      animDrops(this.dropletsNaocl, gs.naoclRate);
      animDrops(this.dropletsNahso3, gs.nahso3Rate);
      // First 6 are HCl, next 6 are NaOH
      animDrops(this.dropletsAcidBase.slice(0, 6), sp.hclDose * 2);
      animDrops(this.dropletsAcidBase.slice(6, 12), sp.naohDose * 2);

      // Alarm strobe pulse if chlorine out of bounds
      if (gs.chlorine < 0.2 || gs.chlorine > 1.0) {
        this.reactorAlarmMat.emissiveIntensity = 0.5 + 1.4 * (0.5 + 0.5 * Math.sin(t * 10));
      } else {
        this.reactorAlarmMat.emissiveIntensity = 0.5;
      }

      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.labels.forEach(item => projectLabel(item.el, item.pos, this.camera, w, h));

      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // 場景 3：各單元系統 3D 用電量評估視圖 (EnergyUnits3D)
  // =========================================================================
  class EnergyUnits3D {
    constructor(containerId, labelsLayerId) {
      this.container = document.getElementById(containerId);
      this.labelsLayer = document.getElementById(labelsLayerId);
      if (!this.container || !global.THREE) return;

      this.scene = new THREE.Scene();
      const w = Math.max(this.container.clientWidth, 400);
      const h = Math.max(this.container.clientHeight, 340);
      this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      this.renderer = createRenderer(this.container);
      if (!this.renderer) return;

      this.orbit = new SimpleOrbitRig(this.camera, this.renderer.domElement, {
        target: [0, 2.0, 0],
        radius: 17.5,
        theta: 0.35,
        phi: 1.02,
        minRadius: 8,
        maxRadius: 30,
        autoRotate: true
      });

      this.clock = new THREE.Clock();
      this.towers = [];
      this.labels = [];

      this.scene.add(new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.9));
      const d = new THREE.DirectionalLight(0xffffff, 1.1);
      d.position.set(10, 18, 12);
      this.scene.add(d);

      const grid = new THREE.GridHelper(24, 24, 0x00f2fe, 0x16243d);
      this.scene.add(grid);

      const unitConfigs = [
        { key: 'pumpA', name: '砂濾泵 A', color: 0x00f2fe, x: -6.2 },
        { key: 'pumpB', name: '砂濾泵 B', color: 0x38bdf8, x: -3.7 },
        { key: 'rawIntake', name: '原水進水單元', color: 0x3b82f6, x: -1.2 },
        { key: 'dosing', name: 'NaOCl 加藥泵', color: 0xf59e0b, x: 1.3 },
        { key: 'airClean', name: '電極空氣清洗', color: 0x10b981, x: 3.8 },
        { key: 'iotControl', name: 'IoT/SCADA 控制', color: 0xa855f7, x: 6.3 }
      ];

      if (this.labelsLayer) this.labelsLayer.innerHTML = '';

      unitConfigs.forEach(cfg => {
        const g = new THREE.Group();
        g.position.set(cfg.x, 0, 0);

        // Glowing pedestal ring
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.92, 0.06, 10, 32),
          new THREE.MeshBasicMaterial({ color: cfg.color })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.08;
        g.add(ring);

        // Translucent outer rated-power shell
        const shell = new THREE.Mesh(
          new THREE.CylinderGeometry(0.76, 0.76, 5.2, 24),
          new THREE.MeshPhysicalMaterial({ color: cfg.color, transparent: true, opacity: 0.14, roughness: 0.15 })
        );
        shell.position.y = 2.65;
        g.add(shell);

        // Live energy bar inside
        const barMat = new THREE.MeshStandardMaterial({
          color: cfg.color,
          emissive: cfg.color,
          emissiveIntensity: 0.65,
          roughness: 0.25,
          metalness: 0.3
        });
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.0, 24), barMat);
        bar.position.y = 0.55;
        g.add(bar);

        this.scene.add(g);

        let el = null;
        if (this.labelsLayer) {
          el = document.createElement('div');
          el.className = 'label-3d';
          el.innerHTML = `${cfg.name}<br><strong id="e3d-${cfg.key}">0.00 kW</strong>`;
          this.labelsLayer.appendChild(el);
        }

        const tower = { key: cfg.key, bar, ring, targetH: 0.4, currentH: 0.4, pos: new THREE.Vector3(cfg.x, 5.8, 0), el };
        this.towers.push(tower);
      });

      this.resize();
    }

    syncUnits(units) {
      if (!this.renderer) return;
      units.forEach(u => {
        const t = this.towers.find(tw => tw.key === u.key);
        if (!t) return;
        // Scale height cleanly (max 2.5 kW -> height 5.0)
        t.targetH = Math.max(0.25, Math.min(5.0, (u.liveKw / 2.4) * 4.8 + 0.25));
        t.active = u.liveKw > 0.05;
        const lblVal = document.getElementById(`e3d-${u.key}`);
        if (lblVal) {
          lblVal.textContent = `${u.liveKw.toFixed(2)} kW (${u.dailyKwh.toFixed(1)} kWh/日)`;
        }
      });
    }

    resize() {
      if (!this.renderer || !this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 10 || h < 10) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    renderFrame() {
      if (!this.renderer) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      this.orbit.update(0.08);

      const w = this.container.clientWidth;
      const h = this.container.clientHeight;

      this.towers.forEach((tw, i) => {
        tw.currentH += (tw.targetH - tw.currentH) * 0.1;
        tw.bar.scale.y = tw.currentH;
        tw.bar.position.y = tw.currentH / 2 + 0.05;
        if (tw.active) {
          tw.ring.rotation.z += dt * 1.4;
          tw.bar.material.emissiveIntensity = 0.55 + Math.sin(t * 4 + i) * 0.2;
        } else {
          tw.bar.material.emissiveIntensity = 0.15;
        }
        if (tw.el) projectLabel(tw.el, tw.pos, this.camera, w, h);
      });

      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // 場景 4：3D RS-485 / Modbus IoT 通訊架構透視 (IotComms3D)
  // =========================================================================
  class IotComms3D {
    constructor(containerId, labelsLayerId) {
      this.container = document.getElementById(containerId);
      this.labelsLayer = document.getElementById(labelsLayerId);
      if (!this.container || !global.THREE) return;

      this.scene = new THREE.Scene();
      const w = Math.max(this.container.clientWidth, 360);
      const h = Math.max(this.container.clientHeight, 260);
      this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      this.renderer = createRenderer(this.container);
      if (!this.renderer) return;

      this.orbit = new SimpleOrbitRig(this.camera, this.renderer.domElement, {
        target: [0, 1.4, 0],
        radius: 15.5,
        theta: 0.28,
        phi: 1.08,
        minRadius: 8,
        maxRadius: 26,
        autoRotate: true
      });

      this.clock = new THREE.Clock();
      this.packets = [];
      this.labels = [];
      this.streaming = true;

      this.scene.add(new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.9));
      const d = new THREE.DirectionalLight(0xffffff, 1.0);
      d.position.set(8, 15, 10);
      this.scene.add(d);
      this.scene.add(new THREE.GridHelper(20, 20, 0x0284c7, 0x16243d));

      const nodes = [
        { pos: [-6.0, 1.2, 1.2], color: 0x10b981, label: '沉澱池感測器<br><strong>pH/ORP 485</strong>' },
        { pos: [-6.0, 1.2, -1.6], color: 0x06b6d4, label: '清水池感測器<br><strong>pH/ORP + DI1</strong>' },
        { pos: [-2.2, 1.5, 0], color: 0x38bdf8, label: 'RS-485 集線器<br><strong>HUB485-6CH</strong>' },
        { pos: [1.8, 1.7, 0], color: 0x00f2fe, label: 'IoT 邏輯核心<br><strong>DO4 Smart Box</strong>' },
        { pos: [5.8, 2.2, 0], color: 0xa855f7, label: '3D 雲端 SCADA<br><strong>即時監控 / ALARM</strong>' }
      ];

      if (this.labelsLayer) this.labelsLayer.innerHTML = '';

      nodes.forEach(n => {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 1.2, 1.2),
          new THREE.MeshStandardMaterial({ color: n.color, emissive: n.color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.3 })
        );
        box.position.set(...n.pos);
        this.scene.add(box);

        if (this.labelsLayer) {
          const el = document.createElement('div');
          el.className = 'label-3d';
          el.innerHTML = n.label;
          this.labelsLayer.appendChild(el);
          this.labels.push({ el, pos: new THREE.Vector3(n.pos[0], n.pos[1] + 1.25, n.pos[2]) });
        }
      });

      const links = [
        [[-6.0, 1.2, 1.2], [-2.2, 1.5, 0], 0x10b981],
        [[-6.0, 1.2, -1.6], [-2.2, 1.5, 0], 0x06b6d4],
        [[-2.2, 1.5, 0], [1.8, 1.7, 0], 0x38bdf8],
        [[1.8, 1.7, 0], [5.8, 2.2, 0], 0xa855f7]
      ];

      links.forEach(([a, b, col]) => {
        const pipe = createPipe([a, b], 0.06, col, 0.75);
        this.scene.add(pipe.mesh);
        for (let i = 0; i < 3; i++) {
          const pkt = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), new THREE.MeshBasicMaterial({ color: col }));
          this.scene.add(pkt);
          this.packets.push({ mesh: pkt, curve: pipe.curve, t: i / 3 });
        }
      });

      this.resize();
    }

    setStreaming(on) { this.streaming = on; }

    resize() {
      if (!this.renderer || !this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 10 || h < 10) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    renderFrame() {
      if (!this.renderer) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.orbit.update(0.08);
      if (this.streaming) {
        this.packets.forEach(p => {
          p.t = (p.t + dt * 0.65) % 1;
          p.mesh.position.copy(p.curve.getPointAt(p.t));
        });
      }
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.labels.forEach(item => projectLabel(item.el, item.pos, this.camera, w, h));
      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // 統一 3D 場景管理器 (只渲染目前活躍分頁以確保極致效能)
  // =========================================================================
  const Water3DManager = {
    activeTab: 'tab-scada',
    scenes: {},

    init() {
      if (!global.THREE) {
        console.warn('Three.js 未載入，無法啟動 3D 視圖');
        return;
      }
      this.scenes['tab-scada'] = new ScadaPlant3D('scada-3d-viewport', 'scada-3d-labels');
      this.scenes['tab-chlorine-game'] = new ChlorineReactor3D('chlorine-3d-viewport', 'chlorine-3d-labels');
      this.scenes['tab-energy'] = new EnergyUnits3D('energy-3d-viewport', 'energy-3d-labels');
      this.scenes['tab-education'] = new IotComms3D('edu-3d-viewport', 'edu-3d-labels');

      window.addEventListener('resize', () => {
        Object.values(this.scenes).forEach(sc => sc?.resize?.());
      });

      const loop = () => {
        requestAnimationFrame(loop);
        const current = this.scenes[this.activeTab];
        if (current && current.renderFrame) {
          current.renderFrame();
        }
      };
      requestAnimationFrame(loop);
    },

    setActiveTab(tabId) {
      this.activeTab = tabId;
      setTimeout(() => {
        this.scenes[tabId]?.resize?.();
      }, 60);
    },

    syncScada(s) { this.scenes['tab-scada']?.syncState?.(s); },
    syncChlorine(gs, sp) { this.scenes['tab-chlorine-game']?.syncState?.(gs, sp); },
    syncEnergy(units) { this.scenes['tab-energy']?.syncUnits?.(units); },
    setModbusStreaming(on) { this.scenes['tab-education']?.setStreaming?.(on); },
    setScadaCamera(preset) { this.scenes['tab-scada']?.setCameraPreset?.(preset); },
    setChlorineCamera(preset) { this.scenes['tab-chlorine-game']?.setCameraPreset?.(preset); }
  };

  global.Water3DManager = Water3DManager;
})(window);
