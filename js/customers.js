/* ============================================================
 * customers.js — 손님 생성 · 대기열 · 이동 AI · 인내심
 * ============================================================ */
const Customers = (() => {
  let scene, env, hooks;
  const list = [];
  const WALK_SPEED = 1.7;

  const SKIN = [0xf5cba7, 0xe8b88a, 0xd9a06a, 0xc78b5a, 0xf2d6b8];
  const SHIRT = [0x7a9cc6, 0xc66a5a, 0x6aa07a, 0xb08ac6, 0xc6a85a, 0x5a8a9c, 0x9c6a8a, 0x708090];
  const PANTS = [0x3a4a5a, 0x4a3a2a, 0x2a2a35, 0x5a4a4a];
  const HAIR = [0x2a1a0a, 0x4a2a10, 0x6a4a20, 0x1a1a1a, 0x8a6a3a, 0xaaaaaa];

  /* ---------- 손님 모델 ---------- */
  function buildModel(seedRand) {
    const r = seedRand;
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[(r() * SKIN.length) | 0], roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: SHIRT[(r() * SHIRT.length) | 0], roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: PANTS[(r() * PANTS.length) | 0], roughness: 0.9 });
    const hairM = new THREE.MeshStandardMaterial({ color: HAIR[(r() * HAIR.length) | 0], roughness: 0.95 });

    // 다리
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 8), pants);
    legL.position.set(-0.1, 0.4, 0);
    const legR = legL.clone(); legR.position.x = 0.1;
    // 몸통
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.4, 4, 12), shirt);
    torso.position.y = 0.95;
    // 팔
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), shirt);
    armL.position.set(-0.27, 0.98, 0);
    const armR = armL.clone(); armR.position.x = 0.27;
    // 머리
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), skin);
    head.position.y = 1.5;
    // 머리카락(반구) 또는 모자
    let hairMesh;
    if (r() > 0.25) {
      hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      hairMesh.position.y = 1.52;
    } else {
      hairMesh = new THREE.Group();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 16), hairM);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.12, 16), hairM);
      brim.position.y = 1.58; top.position.y = 1.65;
      hairMesh.add(brim, top);
    }
    // 눈
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.4 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), eyeM);
    eyeL.position.set(-0.055, 1.53, 0.135);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.055;
    // 입 (행복: 웃는 호 / 화남: 뒤집힌 호)
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), eyeM);
    mouth.position.set(0, 1.45, 0.135);
    mouth.rotation.z = Math.PI; // 기본: 미소
    // 눈썹 (화남 표시용)
    const browM = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
    const browL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), browM);
    browL.position.set(-0.055, 1.575, 0.14); browL.visible = false;
    const browR = browL.clone(); browR.position.x = 0.055; browR.rotation.z = 0;
    browR.visible = false;

    g.add(legL, legR, torso, armL, armR, head, hairMesh, eyeL, eyeR, mouth, browL, browR);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return { group: g, legL, legR, armL, armR, head, mouth, browL, browR };
  }

  /* ---------- 머리 위 말풍선 + 인내심 바 ---------- */
  function makeBillboard() {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 96;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(0.85, 0.51, 1);
    s.position.y = 2.05;
    s.renderOrder = 5;
    return { sprite: s, canvas: c, ctx: c.getContext('2d'), dirty: true };
  }

  function drawBillboard(c, mode, frac) {
    const { ctx, canvas } = c.bb;
    ctx.clearRect(0, 0, 160, 96);
    if (mode === 'none') { c.bb.sprite.visible = false; return; }
    c.bb.sprite.visible = true;
    if (mode === 'bubble' || mode === 'happy' || mode === 'angry') {
      // 말풍선
      ctx.fillStyle = 'rgba(252,248,240,.95)';
      ctx.beginPath();
      ctx.roundRect(40, 4, 80, 56, 14);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(70, 58); ctx.lineTo(80, 74); ctx.lineTo(90, 58);
      ctx.fill();
      ctx.font = '34px "Segoe UI Emoji","Malgun Gothic"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3a2a1e';
      ctx.fillText(mode === 'bubble' ? '☕' : mode === 'happy' ? '😊' : '😠', 80, 34);
    }
    if (frac !== null && mode !== 'happy' && mode !== 'angry') {
      // 인내심 바
      ctx.fillStyle = 'rgba(10,6,3,.7)';
      ctx.beginPath(); ctx.roundRect(20, 78, 120, 12, 6); ctx.fill();
      const col = frac > 0.5 ? '#7fb069' : frac > 0.25 ? '#e8b86d' : '#d9534f';
      ctx.fillStyle = col;
      if (frac > 0.02) {
        ctx.beginPath(); ctx.roundRect(22, 80, 116 * frac, 8, 4); ctx.fill();
      }
    }
    c.bb.sprite.material.map.needsUpdate = true;
  }

  function setFace(c, mood) {
    if (mood === 'happy') {
      c.parts.mouth.rotation.z = Math.PI;
      c.parts.browL.visible = c.parts.browR.visible = false;
    } else if (mood === 'angry') {
      c.parts.mouth.rotation.z = 0;
      c.parts.browL.visible = c.parts.browR.visible = true;
      c.parts.browL.rotation.z = -0.5;
      c.parts.browR.rotation.z = 0.5;
    } else {
      c.parts.mouth.rotation.z = Math.PI;
      c.parts.browL.visible = c.parts.browR.visible = false;
    }
  }

  /* ---------- 대기열 관리 ----------
   * 입장 중('enter')인 손님도 자리를 점유한 것으로 계산해야
   * 같은 줄 자리에 두 명이 배정되어 겹치는 일이 없다 */
  function queueOccupied(i, except) {
    return list.some(c => c !== except && c.queueIdx === i &&
      (c.state === 'enter' || c.state === 'toQueue' || c.state === 'queue'));
  }
  function queueIndexFree() {
    for (let i = 0; i < env.queueSpots.length; i++)
      if (!queueOccupied(i, null)) return i;
    return -1;
  }
  function pickupSpotFree() {
    for (let i = 0; i < env.pickupSpots.length; i++)
      if (!list.some(c => c.pickupIdx === i && (c.state === 'waitDrink' || c.state === 'toPickup'))) return i;
    return -1;
  }

  /* ---------- 스폰 ---------- */
  let nextId = 1;
  function spawn(patienceSec) {
    const qi = queueIndexFree();
    if (qi < 0) return null; // 줄이 꽉 참
    const seed = TEX.rng((Math.random() * 1e9) | 0);
    const parts = buildModel(seed);
    const c = {
      id: nextId++,
      parts, group: parts.group,
      state: 'enter',
      path: [
        [env.spawnPos.x, env.spawnPos.z],
        [env.doorPos.x, env.doorPos.z - 0.6],
        [env.entryWaypoint[0], env.entryWaypoint[1]],
        env.queueSpots[qi],
      ],
      pathIdx: 0,
      queueIdx: qi, pickupIdx: -1,
      patience: patienceSec, patienceMax: patienceSec,
      order: null, walkT: 0, yaw: Math.PI,
      bb: makeBillboard(),
      bbTimer: 0,
      drinkMesh: null,
    };
    c.group.position.set(env.spawnPos.x, 0, env.spawnPos.z);
    c.group.add(c.bb.sprite);
    drawBillboard(c, 'none', null);
    scene.add(c.group);
    list.push(c);
    return c;
  }

  /* ---------- 이동 ---------- */
  function moveAlong(c, dt) {
    if (c.pathIdx >= c.path.length) return true;
    const [tx, tz] = c.path[c.pathIdx];
    const p = c.group.position;
    const dx = tx - p.x, dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) { c.pathIdx++; return c.pathIdx >= c.path.length; }
    const step = Math.min(WALK_SPEED * dt, dist);
    p.x += dx / dist * step;
    p.z += dz / dist * step;
    // 걷기 애니메이션
    c.walkT += dt * 9;
    const sw = Math.sin(c.walkT) * 0.45;
    c.parts.legL.rotation.x = sw; c.parts.legR.rotation.x = -sw;
    c.parts.armL.rotation.x = -sw * 0.7; c.parts.armR.rotation.x = sw * 0.7;
    c.group.position.y = Math.abs(Math.sin(c.walkT)) * 0.035;
    // 진행 방향으로 회전
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * Math.min(1, dt * 10);
    c.group.rotation.y = c.yaw;
    return false;
  }

  function standStill(c, faceZ = -1) {
    c.parts.legL.rotation.x = c.parts.legR.rotation.x = 0;
    c.parts.armL.rotation.x = c.parts.armR.rotation.x = 0;
    c.group.position.y = 0;
    // 카운터(−z) 방향 바라보기
    const targetYaw = faceZ < 0 ? Math.PI : 0;
    let dy = targetYaw - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * 0.08;
    c.group.rotation.y = c.yaw;
  }

  /* ---------- 메인 업데이트 ---------- */
  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.bbTimer -= dt;

      switch (c.state) {
        case 'enter':
          if (moveAlong(c, dt)) {
            c.state = 'queue';
          }
          break;

        case 'queue': {
          standStill(c);
          // 앞자리가 비면 전진
          if (c.queueIdx > 0 && !queueOccupied(c.queueIdx - 1, c)) {
            c.queueIdx--;
            c.state = 'toQueue';
            c.path = [env.queueSpots[c.queueIdx]];
            c.pathIdx = 0;
          }
          const isFront = c.queueIdx === 0;
          if (isFront) {
            c.patience -= dt;
            if (c.bbTimer <= 0) { drawBillboard(c, 'bubble', c.patience / c.patienceMax); c.bbTimer = 0.25; }
            if (c.patience <= 0) leaveAngry(c);
          } else {
            if (c.bbTimer <= 0) { drawBillboard(c, 'none', null); c.bbTimer = 0.25; }
          }
          break;
        }

        case 'toQueue':
          if (moveAlong(c, dt)) c.state = 'queue';
          break;

        case 'waitDrink': {
          standStill(c);
          c.patience -= dt;
          if (c.bbTimer <= 0) { drawBillboard(c, 'wait', c.patience / c.patienceMax); c.bbTimer = 0.25; }
          if (c.patience <= 0) leaveAngry(c);
          break;
        }

        case 'toPickup':
          if (moveAlong(c, dt)) c.state = 'waitDrink';
          break;

        case 'leave':
          if (moveAlong(c, dt)) {
            scene.remove(c.group);
            list.splice(i, 1);
          }
          break;
      }
    }
  }

  function leavePath(c) {
    return [
      [env.entryWaypoint[0], env.entryWaypoint[1]],
      [env.doorPos.x, env.doorPos.z - 0.6],
      [env.spawnPos.x, env.spawnPos.z + 1.5],
    ];
  }

  function leaveAngry(c) {
    c.state = 'leave';
    c.path = leavePath(c);
    c.pathIdx = 0;
    c.queueIdx = c.pickupIdx = -1;
    setFace(c, 'angry');
    drawBillboard(c, 'angry', null);
    setTimeout(() => { if (c.bb) drawBillboard(c, 'none', null); }, 2200);
    hooks.onAngryLeave && hooks.onAngryLeave(c);
  }

  /* ---------- 게임에서 호출하는 API ---------- */
  function frontCustomer() {
    return list.find(c => c.state === 'queue' && c.queueIdx === 0) || null;
  }

  function takeOrder(c, order) {
    c.order = order;
    c.queueIdx = -1;
    const pi = pickupSpotFree();
    c.pickupIdx = pi >= 0 ? pi : 0;
    const spot = pi >= 0 ? env.pickupSpots[pi] : [-1.5 + Math.random() * 2, 2.2];
    c.state = 'toPickup';
    c.path = [spot];
    c.pathIdx = 0;
    drawBillboard(c, 'wait', 1);
  }

  function serve(c, drinkMesh) {
    c.state = 'leave';
    c.path = leavePath(c);
    c.pathIdx = 0;
    c.pickupIdx = -1;
    setFace(c, 'happy');
    drawBillboard(c, 'happy', null);
    setTimeout(() => { if (c.bb) drawBillboard(c, 'none', null); }, 2200);
    if (drinkMesh) {
      drinkMesh.position.set(0.3, 1.05, 0.12);
      drinkMesh.scale.setScalar(0.9);
      c.group.add(drinkMesh);
    }
  }

  function waitingCustomers() {
    return list.filter(c => c.state === 'waitDrink' || c.state === 'toPickup');
  }

  function clear() {
    list.forEach(c => scene.remove(c.group));
    list.length = 0;
  }

  function init(s, e, h) { scene = s; env = e; hooks = h || {}; }

  return { init, spawn, update, frontCustomer, takeOrder, serve, waitingCustomers, clear, list };
})();
