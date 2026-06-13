/* ============================================================
 * editor.js — 기구 편집 모드 (B 토글 · 들기/회전/설치 · 레이아웃 저장)
 * ============================================================ */
const Editor = (() => {
  const LKEY = 'mochaLayout_v1';
  const GRID = 0.1;
  let scene, env, camera;
  let active = false;
  let carrying = null;          // 들고 있는 station
  let pickupState = null;       // 들기 전 위치 (취소용)
  let valid = false;
  let aimedSt = null;
  const savedMats = new Map();
  let ghostBlue, ghostRed, selBox;
  const ray = new THREE.Raycaster();
  ray.far = 3.4;
  let counterBoxes = [];        // 카운터 상판 월드 AABB

  /* ---------- 초기화 ---------- */
  function init(s, e, cam) {
    scene = s; env = e; camera = cam;
    ghostBlue = new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.5, depthWrite: false });
    ghostRed = new THREE.MeshBasicMaterial({ color: 0xff5a4d, transparent: true, opacity: 0.5, depthWrite: false });
    selBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x7fc4ff, depthTest: false })
    );
    selBox.renderOrder = 6;
    selBox.visible = false;
    scene.add(selBox);

    scene.updateMatrixWorld(true);
    counterBoxes = env.surfaces
      .filter(m => m.userData.counterTop)
      .map(m => new THREE.Box3().setFromObject(m));

    applyLayout();

    document.addEventListener('keydown', ev => {
      if (ev.code === 'KeyB') { toggle(); return; }
      if (!active) return;
      if (ev.code === 'KeyE') use();
      if (ev.code === 'KeyR') rotate();
      if (ev.code === 'KeyQ') cancel();
    });
    document.addEventListener('mousedown', ev => {
      if (active && document.pointerLockElement && ev.button === 0) use();
    });
    document.addEventListener('wheel', () => { if (active && carrying) rotate(); });

    const btn = document.getElementById('btnResetLayout');
    if (btn) btn.onclick = () => {
      resetLayout();
      btn.textContent = '✓ 기본 배치로 복원됨';
      setTimeout(() => { btn.textContent = '기구 기본 배치로 리셋'; }, 1800);
    };
  }

  /* ---------- 토글 ---------- */
  function toggle() {
    if (Game.mode !== 'prep') return;     // 기구 배치는 영업 준비 단계에서만
    active = !active;
    Game.notifyEditMode(active);
    document.getElementById('editBanner').classList.toggle('hidden', !active);
    if (!active) {
      if (carrying) cancel();
      selBox.visible = false;
      aimedSt = null;
      setPrompt(null);
    }
    AudioFX.ding();
  }

  /* ---------- 고스트 머티리얼 ---------- */
  function applyGhost(st, on) {
    if (on) {
      st.root.traverse(o => {
        if (o.isMesh && !o.userData.isHitbox) {
          savedMats.set(o, o.material);
          o.material = ghostBlue;
        }
      });
    } else {
      savedMats.forEach((mat, o) => { o.material = mat; });
      savedMats.clear();
    }
  }
  function setGhostColor(ok) {
    const m = ok ? ghostBlue : ghostRed;
    savedMats.forEach((_, o) => { o.material = m; });
  }

  /* ---------- 들기 / 설치 / 회전 / 취소 ---------- */
  function use() {
    if (carrying) { if (valid) place(); }
    else if (aimedSt) pick();
  }
  function pick() {
    carrying = aimedSt;
    aimedSt = null;
    selBox.visible = false;
    const p = carrying.root.position;
    pickupState = { x: p.x, y: p.y, z: p.z, rotY: carrying.rotY };
    applyGhost(carrying, true);
    AudioFX.pick();
  }
  function rotate() {
    if (!carrying) return;
    carrying.rotY = (carrying.rotY + 90) % 360;
    carrying.root.rotation.y = THREE.MathUtils.degToRad(carrying.rotY);
  }
  function cancel() {
    if (!carrying) return;
    carrying.root.position.set(pickupState.x, pickupState.y, pickupState.z);
    carrying.rotY = pickupState.rotY;
    carrying.root.rotation.y = THREE.MathUtils.degToRad(carrying.rotY);
    applyGhost(carrying, false);
    recomputeDeps(carrying);
    carrying = null;
    AudioFX.put();
  }
  function place() {
    applyGhost(carrying, false);
    recomputeDeps(carrying);
    saveLayout();
    carrying = null;
    AudioFX.put();
  }

  /* ---------- 풋프린트 / 겹침 ---------- */
  function footprint(st, x, z) {
    const rot = st.rotY % 180 !== 0;
    const w = rot ? st.d : st.w, d = rot ? st.w : st.d;
    return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
  }
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

  function checkValid(st, x, z, counterBox) {
    const fp = footprint(st, x, z);
    if (st.floor) {
      // 방 안 + 기존 충돌체(자기 자신 제외)와 겹침 금지
      if (fp.x0 < -8.7 || fp.x1 > 8.7 || fp.z0 < -4.7 || fp.z1 > 7.7) return false;
      for (const c of env.colliders) {
        if (c === st.colliderRef) continue;
        if (overlap(fp, c)) return false;
      }
    } else {
      // 카운터 상판 안에 완전히 들어가야 함
      if (!counterBox) return false;
      if (fp.x0 < counterBox.min.x || fp.x1 > counterBox.max.x ||
          fp.z0 < counterBox.min.z || fp.z1 > counterBox.max.z) return false;
      // 고정 구역(계산대·픽업대·쇼케이스)
      for (const b of env.staticBlockers) {
        if (overlap(fp, { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 })) return false;
      }
    }
    // 다른 기구와 겹침 금지
    for (const o of env.stations) {
      if (o === st) continue;
      if (o.floor !== st.floor) continue;
      const op = o.root.position;
      if (overlap(fp, footprint(o, op.x, op.z))) return false;
    }
    return true;
  }

  function recomputeDeps(st) {
    if (st.colliderRef) {
      const fp = footprint(st, st.root.position.x, st.root.position.z);
      Object.assign(st.colliderRef, fp);
    }
  }

  /* ---------- UI ---------- */
  function setPrompt(html) {
    const pr = document.getElementById('prompt');
    if (html) { pr.innerHTML = html; pr.classList.remove('hidden'); }
    else pr.classList.add('hidden');
    document.getElementById('crosshair').classList.toggle('active', !!html);
  }

  /* ---------- 메인 업데이트 ---------- */
  function update(dt) {
    if (!active) return;
    ray.setFromCamera({ x: 0, y: 0 }, camera);

    if (!carrying) {
      const hits = ray.intersectObjects(env.interactables, false);
      const hit = hits.find(h => h.object.userData.station);
      aimedSt = hit ? hit.object.userData.station : null;
      if (aimedSt) {
        const p = aimedSt.root.position;
        const rot = aimedSt.rotY % 180 !== 0;
        selBox.position.set(p.x, p.y + 0.45, p.z);
        selBox.scale.set((rot ? aimedSt.d : aimedSt.w) + 0.06, 0.9, (rot ? aimedSt.w : aimedSt.d) + 0.06);
        selBox.visible = true;
        setPrompt(`<b>[E]</b> ${aimedSt.name} 들기`);
      } else {
        selBox.visible = false;
        setPrompt('🔧 기구를 바라보고 <b>[E]</b>로 들어올리세요 · <b>[B]</b> 종료');
      }
      return;
    }

    // 운반 중: 표면 따라가기
    const targets = carrying.floor
      ? [env.floorMesh]
      : env.surfaces.filter(sf => sf.userData.counterTop);
    const hits = ray.intersectObjects(targets, false);
    let pt = null, hitMesh = null;
    for (const h of hits) {
      if (carrying.floor || (h.face && h.face.normal.y > 0.5)) { pt = h.point; hitMesh = h.object; break; }
    }
    if (pt) {
      const sx = Math.round(pt.x / GRID) * GRID;
      const sz = Math.round(pt.z / GRID) * GRID;
      carrying.root.position.set(sx, carrying.floor ? 0 : pt.y, sz);
      let cb = null;
      if (!carrying.floor) {
        const idx = env.surfaces.filter(sf => sf.userData.counterTop).indexOf(hitMesh);
        cb = counterBoxes[idx] || null;
      }
      valid = checkValid(carrying, sx, sz, cb);
      setGhostColor(valid);
      setPrompt(valid
        ? `<b>[E]</b> 설치 · <b>[R]</b> 회전 · <b>[Q]</b> 원위치`
        : `⛔ 설치 불가 — 겹치거나 벗어났어요 (<b>[R]</b> 회전 · <b>[Q]</b> 원위치)`);
    } else {
      valid = false;
      setGhostColor(false);
      setPrompt(carrying.floor ? '바닥을 바라보세요 · <b>[Q]</b> 원위치' : '카운터 상판을 바라보세요 · <b>[Q]</b> 원위치');
    }
  }

  /* ---------- 레이아웃 저장/복원 ---------- */
  function saveLayout() {
    const data = {};
    env.stations.forEach(st => {
      const p = st.root.position;
      data[st.id] = { x: +p.x.toFixed(2), y: +p.y.toFixed(3), z: +p.z.toFixed(2), r: st.rotY };
    });
    localStorage.setItem(LKEY, JSON.stringify(data));
  }
  function applyLayout() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LKEY)); } catch (e) { /* 무시 */ }
    if (!data) return;
    env.stations.forEach(st => {
      const e = data[st.id];
      if (!e) return;
      st.root.position.set(e.x, e.y, e.z);
      st.rotY = e.r || 0;
      st.root.rotation.y = THREE.MathUtils.degToRad(st.rotY);
      recomputeDeps(st);
    });
  }
  function resetLayout() {
    localStorage.removeItem(LKEY);
    if (carrying) cancel();
    env.stations.forEach(st => {
      st.root.position.set(st.home.x, st.home.y, st.home.z);
      st.rotY = st.home.rotY;
      st.root.rotation.y = 0;
      recomputeDeps(st);
    });
    AudioFX.ding();
  }

  return {
    init, update, toggle, resetLayout,
    get active() { return active; },
  };
})();
