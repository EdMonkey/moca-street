/* ============================================================
 * main.js — 부트스트랩 · 렌더러 · 파티클 · 메인 루프
 * ============================================================ */
(() => {
  /* ---------- 렌더러 ---------- */
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8c8e0);
  scene.fog = new THREE.Fog(0xe8d8b8, 30, 70);

  /* ---------- 환경맵 (PBR 금속/대리석 반사) ---------- */
  (function buildEnvMap() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(12, 8, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a7460, roughness: 1, side: THREE.BackSide })
    );
    room.position.y = 3; es.add(room);
    const key = new THREE.PointLight(0xfff2dd, 120, 0, 2);
    key.position.set(0, 5.5, 0); es.add(key);
    // 창문(차가운 면광) + 천장(따뜻한 면광) — 반사 디테일용
    const winM = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ color: 0xcfe2ff }));
    winM.position.set(0, 3, 5.9); winM.rotation.y = Math.PI; es.add(winM);
    const warmM = new THREE.Mesh(new THREE.PlaneGeometry(5, 2), new THREE.MeshBasicMaterial({ color: 0xffd9a8 }));
    warmM.position.set(-5.9, 3, 0); warmM.rotation.y = Math.PI / 2; es.add(warmM);
    scene.environment = pmrem.fromScene(es, 0.04).texture;
    pmrem.dispose();
  })();

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
  scene.add(camera);

  /* ---------- 월드 & 시스템 초기화 ---------- */
  TEX.build();
  // 환경맵 반사 강도: 금속/대리석은 강하게, 무광 표면은 은은하게
  Object.values(TEX.M).forEach(m => { if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45; });
  TEX.M.steel.envMapIntensity = TEX.M.steelDark.envMapIntensity = 1.3;
  TEX.M.marble.envMapIntensity = TEX.M.marbleDark.envMapIntensity = 0.8;
  TEX.M.coffeeLiquid.envMapIntensity = 1.0;
  const env = WORLD.build(scene);
  Player.init(camera, env);
  Game.init(scene, env);
  Weather.init(scene, env);   // 실외 날씨(하늘·안개·햇빛·비) — 하루마다 game.js가 갱신
  Customers.init(scene, env, {
    onAngryLeave: c => { if (Game.mode === 'playing') Game.onAngryLeave(c); },
  });
  Editor.init(scene, env, camera);

  /* ---------- 증기 파티클 ---------- */
  const steam = (() => {
    const [c, x] = TEX.canvas(64, 64);
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const pool = [];
    for (let i = 0; i < 36; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false
      }));
      s.visible = false;
      s.userData = { life: 0, max: 1, vy: 0.3 };
      scene.add(s);
      pool.push(s);
    }
    let emitT = 0;
    function emit(pos, strong) {
      const s = pool.find(p => !p.visible);
      if (!s) return;
      s.visible = true;
      s.position.set(
        pos.x + (Math.random() - 0.5) * 0.08,
        pos.y,
        pos.z + (Math.random() - 0.5) * 0.08
      );
      s.userData.life = 0;
      s.userData.max = strong ? 1.4 : 1.9;
      s.userData.vy = strong ? 0.45 : 0.22;
      s.scale.setScalar(strong ? 0.16 : 0.1);
    }
    function update(dt) {
      // 스팀봉 분사 타이머 감소 (노브 조작 퍼지)
      env.machines.steamerJobs.forEach(j => { if (j.steamT > 0) j.steamT = Math.max(0, j.steamT - dt); });
      emitT -= dt;
      if (emitT <= 0) {
        emitT = 0.22;
        env.steamEmitters.forEach(e => Math.random() < 0.5 && emit(e.st.root.localToWorld(e.local.clone()), false));
        if (Game.isBrewing())
          env.machines.espressoSlots.forEach(sl => {
            if (sl.busy && !sl.done)
              emit(sl.st.root.localToWorld(sl.localPos.clone()).add(new THREE.Vector3(0, 0.25, 0)), true);
          });
        // 스팀봉 끝 증기 — 노브 조작(퍼지) 또는 우유 스팀 중일 때만
        env.machines.steamerJobs.forEach(j => {
          if (j.wandLocal && ((j.busy && !j.done) || j.steamT > 0))
            emit(j.st.root.localToWorld(j.wandLocal.clone()), true);
        });
      }
      pool.forEach(s => {
        if (!s.visible) return;
        const u = s.userData;
        u.life += dt;
        if (u.life >= u.max) { s.visible = false; return; }
        const f = u.life / u.max;
        s.position.y += u.vy * dt;
        s.position.x += Math.sin(u.life * 5 + s.id) * 0.02 * dt;
        s.scale.setScalar(s.scale.x + dt * 0.12);
        s.material.opacity = 0.5 * (1 - f) * Math.min(1, f * 6);
      });
    }
    return { update };
  })();

  /* ---------- 화면 전환 / 포인터 락 ---------- */
  let paused = false;

  function lockPointer() { canvas.requestPointerLock && canvas.requestPointerLock(); }

  function enterGame(starter) {
    AudioFX.ensure();
    $('menuScreen').classList.add('hidden');
    $('pauseScreen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    starter();
    paused = false;
    lockPointer();
  }

  $('btnNew').onclick = () => enterGame(() => Game.newGame());
  $('btnContinue').onclick = () => enterGame(() => Game.continueGame());
  $('btnNextDay').onclick = () => {       // 정산 → 다음 날 준비
    AudioFX.ensure();
    Game.nextDay();
    paused = false;
    lockPointer();
  };
  $('btnStartService').onclick = () => {  // 준비 패널 → 영업 시작
    AudioFX.ensure();
    Game.beginOpen();
    paused = false;
    lockPointer();
  };
  $('btnClosePrep').onclick = () => {     // 준비 패널 닫고 계속 준비
    Game.closePrepPanel();
    paused = false;
    lockPointer();
  };
  $('btnResume').onclick = () => lockPointer();
  $('btnQuitToMenu').onclick = () => location.reload();
  $('btnRestart').onclick = () => location.reload();   // 폐업 → 새로 시작(저장은 이미 초기화됨)

  canvas.addEventListener('click', () => {
    if ((Game.mode === 'playing' || Game.mode === 'prep') && !document.pointerLockElement
      && !Game.prepPanelOpen) lockPointer();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (Game.mode !== 'playing' && Game.mode !== 'prep') return;
    if (locked) {
      paused = false;
      Player.enabled = true;
      $('pauseScreen').classList.add('hidden');
    } else if (Game.mode === 'prep' && Game.prepPanelOpen) {
      Player.enabled = false;   // 관리 패널이 마우스를 잡음 — 일시정지 아님
    } else {
      paused = true;
      Player.enabled = false;
      $('pauseScreen').classList.remove('hidden');
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ---------- 메인 루프 ---------- */
  window.__dbg = { scene, camera, renderer, env };

  const clock = new THREE.Clock();
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    if (!paused) {
      Player.update(dt);
      if (Editor.active) Editor.update(dt);   // 편집 중엔 게임 시간·손님 정지
      else Game.update(dt);
      steam.update(dt);
      Weather.update(dt);
    }
    renderer.render(scene, camera);
  }
  loop();
})();
