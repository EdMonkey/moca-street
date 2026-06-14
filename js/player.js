/* ============================================================
 * player.js — 1인칭 플레이어 (이동 · 충돌 · 시점 · 손)
 * ============================================================ */
const Player = (() => {
  const EYE = 1.62, RADIUS = 0.32, SPEED = 3.4;
  let camera, env;
  let yaw = Math.PI, pitch = 0;          // 처음엔 손님 쪽(+z)을 바라봄
  const pos = new THREE.Vector3(0, EYE, -2.6);
  const keys = {};
  const ray = new THREE.Raycaster();
  ray.far = 2.8;
  let handGroup = null;      // 카메라에 붙는 손 그룹
  let heldMesh = null;
  let bobT = 0;
  let enabled = false;
  let look = true;           // 시점 조작 허용 — 라떼아트 미니게임 중엔 꺼서 마우스를 피처에 양보
  let kick = 0;              // 손맛용 반동(탬핑 등) — 0으로 감쇠
  let equipT = 0;            // 물건 장착 애니메이션 진행(초). EQUIP_DUR 동안 손 위치로 끌려옴
  let equipFrom = null;      // 물건이 있던 월드 위치(끌어당기는 시작점). null이면 애니메이션 없음
  const EQUIP_DUR = 0.28;
  const _equipV = new THREE.Vector3();

  function init(cam, e) {
    camera = cam; env = e;
    camera.rotation.order = 'YXZ';
    handGroup = new THREE.Group();
    handGroup.position.set(0.34, -0.36, -0.62);
    camera.add(handGroup);

    document.addEventListener('keydown', ev => { keys[ev.code] = true; });
    document.addEventListener('keyup', ev => { keys[ev.code] = false; });
    document.addEventListener('mousemove', ev => {
      if (!enabled || !look || document.pointerLockElement === null) return;
      yaw -= ev.movementX * 0.0021;
      pitch -= ev.movementY * 0.0021;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
    });
    applyCam();
  }

  function reset() {
    pos.set(0, EYE, -2.6);
    yaw = Math.PI; pitch = 0;
    applyCam();
  }

  function applyCam() {
    camera.position.copy(pos);
    camera.rotation.set(pitch, yaw, 0);
  }

  /* AABB 충돌 — x/z축 분리 이동 */
  function collide(nx, nz) {
    for (const c of env.colliders) {
      if (nx > c.x0 - RADIUS && nx < c.x1 + RADIUS && nz > c.z0 - RADIUS && nz < c.z1 + RADIUS)
        return true;
    }
    return false;
  }

  function update(dt) {
    if (!enabled) return;
    let fx = 0, fz = 0;
    if (keys['KeyW']) fz += 1;
    if (keys['KeyS']) fz -= 1;
    if (keys['KeyA']) fx -= 1;
    if (keys['KeyD']) fx += 1;
    const moving = fx !== 0 || fz !== 0;
    if (moving) {
      const len = Math.hypot(fx, fz);
      fx /= len; fz /= len;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const vx = (fz * -sin + fx * cos) * SPEED * dt;
      const vz = (fz * -cos - fx * sin) * SPEED * dt;
      if (!collide(pos.x + vx, pos.z)) pos.x += vx;
      if (!collide(pos.x, pos.z + vz)) pos.z += vz;
      bobT += dt * 9;
    } else {
      bobT += dt * 1.2;
    }
    // 헤드 밥 + 손 흔들림
    const bobY = moving ? Math.abs(Math.sin(bobT)) * 0.035 : Math.sin(bobT) * 0.006;
    pos.y = EYE + bobY;
    // 탬핑 등 손맛용 반동(kick): 카메라가 살짝 아래로 꺾였다 복귀
    if (kick > 0.0001) kick += (0 - kick) * Math.min(1, dt * 13); else kick = 0;
    camera.position.copy(pos);
    camera.rotation.set(pitch - kick * 0.06, yaw, 0);
    if (handGroup) {
      handGroup.position.y = -0.36 - kick * 0.05 + (moving ? Math.sin(bobT * 2) * 0.012 : Math.sin(bobT) * 0.004);
      handGroup.position.x = 0.34 + (moving ? Math.sin(bobT) * 0.008 : 0);
    }
    // 물건 장착 애니메이션: 물건이 있던 월드 위치 → 손 위치로 끌어당김 (원근으로 크기는 자연히 커짐)
    if (heldMesh && equipFrom && equipT < EQUIP_DUR) {
      equipT += dt;
      const e = 1 - Math.pow(1 - Math.min(1, equipT / EQUIP_DUR), 3);   // easeOutCubic
      handGroup.updateWorldMatrix(true, false);                        // 현재 손 위치 기준으로 변환
      _equipV.copy(equipFrom);
      handGroup.worldToLocal(_equipV);                                 // 시작점을 손 그룹 로컬 좌표로
      heldMesh.position.set(_equipV.x * (1 - e), _equipV.y * (1 - e), _equipV.z * (1 - e));
      // 끌려오며 부드럽게 한 바퀴 가까이 돌아 정면(-0.35)으로 안착
      heldMesh.rotation.set(0.4 * (1 - e), -0.35 + Math.PI * 0.85 * (1 - e), 0.25 * (1 - e));
    }
  }
  function punch(a) { kick = Math.max(kick, a); }

  /* 조준 중인 상호작용 대상 */
  let lastAimHit = null;        // 마지막으로 조준한 히트박스 메시 (아웃라인 하이라이트용)
  const PLACED_PRIORITY = 0.5;  // 표면에 놓인 아이템이 가장 가까운 히트와 이 거리(m) 내면 우선 선택
  function aim() {
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = ray.intersectObjects(env.interactables, false);   // 거리 오름차순 정렬
    let chosen = hits.length ? hits[0] : null;
    // 표면에 내려놓은 컵(placedItem)은 작은 히트박스라 픽업대·계산대 같은 큰 카운터 박스에
    // 가려진다. 가장 가까운 히트와 거의 겹쳐 있으면 컵을 우선해 외곽선·집기가 컵에 걸리게 한다.
    if (chosen && (!chosen.object.userData.interact || chosen.object.userData.interact.id !== 'placedItem')) {
      const pi = hits.find(h => h.object.userData.interact && h.object.userData.interact.id === 'placedItem');
      if (pi && pi.distance - hits[0].distance < PLACED_PRIORITY) chosen = pi;
    }
    lastAimHit = chosen ? chosen.object : null;
    return lastAimHit ? lastAimHit.userData.interact : null;
  }

  /* 조준 중인 배치 가능 표면의 윗면 지점 (없으면 null) */
  function aimSurface() {
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = ray.intersectObjects(env.surfaces, false);
    for (const h of hits) {
      if (h.face && h.face.normal.y > 0.7) return h.point; // 윗면만 허용
    }
    return null;
  }

  /* 손에 든 메시 교체. animate=true면 물건이 있던 위치(조준 대상)에서 손으로 끌려오는 연출 */
  function setHeld(mesh, animate) {
    if (heldMesh) handGroup.remove(heldMesh);
    heldMesh = mesh;
    if (mesh) {
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, -0.35, 0);
      mesh.userData.restScale = mesh.scale.clone();   // 잡을 때 기본 크기 저장(애니메이션 복원용)
      if (animate && lastAimHit) {
        // 방금 조준하던 대상의 월드 위치 = 물건이 있던 곳. 거기서부터 끌어당긴다.
        equipFrom = lastAimHit.getWorldPosition(new THREE.Vector3());
        equipFrom.y -= 0.28;   // 시작점을 대상보다 살짝 아래로 — 화면 중앙 위가 아닌 아래에서 끌려오게
        equipT = 0;
      } else {
        equipFrom = null;
        equipT = EQUIP_DUR;                            // 애니메이션 없이 즉시 정자세
      }
      handGroup.add(mesh);
    }
  }

  return {
    init, update, aim, aimSurface, setHeld, reset, punch,
    setLook(on) { look = on; },
    get aimedObject() { return lastAimHit; },
    get position() { return pos; },
    set enabled(v) { enabled = v; },
    get enabled() { return enabled; },
  };
})();
