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
  let kick = 0;              // 손맛용 반동(탬핑 등) — 0으로 감쇠

  function init(cam, e) {
    camera = cam; env = e;
    camera.rotation.order = 'YXZ';
    handGroup = new THREE.Group();
    handGroup.position.set(0.34, -0.36, -0.62);
    camera.add(handGroup);

    document.addEventListener('keydown', ev => { keys[ev.code] = true; });
    document.addEventListener('keyup', ev => { keys[ev.code] = false; });
    document.addEventListener('mousemove', ev => {
      if (!enabled || document.pointerLockElement === null) return;
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
  }
  function punch(a) { kick = Math.max(kick, a); }

  /* 조준 중인 상호작용 대상 */
  function aim() {
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = ray.intersectObjects(env.interactables, false);
    return hits.length ? hits[0].object.userData.interact : null;
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

  /* 손에 든 메시 교체 */
  function setHeld(mesh) {
    if (heldMesh) handGroup.remove(heldMesh);
    heldMesh = mesh;
    if (mesh) {
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, -0.35, 0);
      handGroup.add(mesh);
    }
  }

  return {
    init, update, aim, aimSurface, setHeld, reset, punch,
    get position() { return pos; },
    set enabled(v) { enabled = v; },
    get enabled() { return enabled; },
  };
})();
