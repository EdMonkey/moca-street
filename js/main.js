/* ============================================================
 * main.js — 부트스트랩 · 렌더러 · 파티클 · 메인 루프
 * ============================================================ */
(async () => {
  /* ---------- 렌더러 ---------- */
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;   // 전체 밝기(노출) — 낮출수록 눈부심 감소
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
    scene.environment = pmrem.fromScene(es, 0.04).texture;   // 즉시 폴백(절차적)
    pmrem.dispose();
  })();

  /* ---------- 실내 HDR 환경맵 (index.html 모듈이 RGBELoader 준비 후 호출) ----------
   * Poly Haven 'lythwood_room'(CC0, 1k)을 PMREM으로 변환해 절차적 폴백을 교체.
   * 실제 실내 광원(창문·조명)이 담겨 스테인리스/크롬 등 PBR 금속 반사가 살아난다. */
  window.__applyHDREnv = function (RGBELoaderClass) {
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      pm.compileEquirectangularShader();
      new RGBELoaderClass().load('assets/hdr/lythwood_room_1k.hdr', (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const rt = pm.fromEquirectangular(tex);
        const old = scene.environment;
        scene.environment = rt.texture;     // 절차적 폴백 → 실내 HDR로 교체
        if (old && old.dispose) old.dispose();
        tex.dispose(); pm.dispose();
      }, undefined, (err) => { console.error('[HDR] 환경맵 로드 실패:', err); pm.dispose(); });
    } catch (e) { console.error('[HDR] 환경맵 적용 오류:', e); }
  };

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
  scene.add(camera);

  /* ---------- 후처리 외곽선 컴포저 (index.html 모듈이 OutlinePass 등 준비 후 호출) ----------
   * RenderPass(씬) → OutlinePass(조준 대상 골드 외곽선) → OutputPass(ACES 톤매핑·sRGB 보존).
   * MSAA(samples:4) 멀티샘플 렌더타깃으로 antialias:true의 계단현상 완화를 유지한다. */
  let composer = null, outlinePass = null;
  window.__initOutline = function ({ EffectComposer, RenderPass, OutlinePass, OutputPass }) {
    try {
      const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      outlinePass = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
      outlinePass.edgeStrength = 4.0;
      outlinePass.edgeGlow = 0.3;
      outlinePass.edgeThickness = 1.4;
      outlinePass.pulsePeriod = 0;                 // 고정 외곽선(깜빡임 없음)
      outlinePass.visibleEdgeColor.set(0xffa000);  // 진한 노랑(주황빛) — 시인성 강화
      outlinePass.hiddenEdgeColor.set(0x6b4200);   // 가려진 부분은 어두운 주황
      composer.addPass(outlinePass);
      composer.addPass(new OutputPass());          // 톤매핑·색공간을 체인 끝에서 적용
      composer.setSize(innerWidth, innerHeight);   // DPR 반영해 타깃·패스 크기 정렬(이중적용 방지)
      Game.setOutlinePass(outlinePass);
      if (window.__dbg) { window.__dbg.composer = composer; window.__dbg.outlinePass = outlinePass; }
    } catch (e) { console.error('[outline] 후처리 초기화 실패:', e); composer = null; outlinePass = null; }
  };

  /* ---------- 월드 & 시스템 초기화 ---------- */
  const btnNew = $('btnNew');
  const btnContinue = $('btnContinue');
  const loadingNote = $('loadingNote');
  if (btnNew) btnNew.disabled = true;
  if (btnContinue) btnContinue.disabled = true;
  if (loadingNote) loadingNote.textContent = '에셋 로딩 중...';
  if (window.Assets && window.Assets.ready) {
    try {
      await window.Assets.ready;
      if (loadingNote) loadingNote.textContent = '로딩 완료. 게임을 시작할 수 있어요.';
    } catch (e) {
      if (loadingNote) loadingNote.textContent = '에셋 로딩 실패. 새로고침 후 다시 시도해주세요.';
      console.error('[Assets] 게임 시작 전 로딩 실패:', e);
      return;
    }
  }

  TEX.build();
  // 환경맵 반사 강도: 금속/대리석은 강하게, 무광 표면은 은은하게
  Object.values(TEX.M).forEach(m => { if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45; });
  TEX.M.steel.envMapIntensity = TEX.M.steelDark.envMapIntensity = 0.8;   // HDR 환경맵이 밝아 강도 낮춤(번쩍임 완화)
  TEX.M.marble.envMapIntensity = TEX.M.marbleDark.envMapIntensity = 0.8;
  TEX.M.coffeeLiquid.envMapIntensity = 1.0;
  const env = WORLD.build(scene);
  Player.init(camera, env);
  Game.init(scene, env);
  Weather.init(scene, env);   // 실외 날씨(하늘·안개·햇빛·비) — 하루마다 game.js가 갱신
  Customers.init(scene, env, {
    onAngryLeave: c => { if (Game.mode === 'playing' || Game.mode === 'closing') Game.onAngryLeave(c); },
  });
  Editor.init(scene, env, camera);
  if (btnNew) btnNew.disabled = false;
  if (btnContinue) btnContinue.disabled = false;

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
        // 뜨거운 음료(컵/샷잔/피처)에서 김 — 제조 후 30초 내(신선)에만, 30초 지나면 사라짐
        if ((Game.mode === 'playing' || Game.mode === 'closing') && Game.steamSources)
          Game.steamSources().forEach(p => { if (Math.random() < 0.6) emit(p, false); });
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
  $('btnCloseDayEnd').onclick = () => {   // 정산창 → 영업후 정리 계속
    AudioFX.ensure();
    Game.closeDayEndPanel();
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
    if ((Game.mode === 'playing' || Game.mode === 'closing' || Game.mode === 'prep' || Game.mode === 'after') && !document.pointerLockElement
      && !Game.prepPanelOpen && $('dayEnd').classList.contains('hidden')) lockPointer();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (Game.mode !== 'playing' && Game.mode !== 'closing' && Game.mode !== 'prep' && Game.mode !== 'after') return;
    if (locked) {
      paused = false;
      Player.enabled = true;
      $('pauseScreen').classList.add('hidden');
    } else if (Game.mode === 'prep' && Game.prepPanelOpen) {
      Player.enabled = false;   // 관리 패널이 마우스를 잡음 — 일시정지 아님
    } else if (Game.mode === 'after' && !$('dayEnd').classList.contains('hidden')) {
      Player.enabled = false;   // 정산창이 열려 있으면 일시정지 화면을 띄우지 않음
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
    if (composer) composer.setSize(innerWidth, innerHeight);   // 후처리 타깃·패스 크기도 갱신
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
      if (env.door) env.door.update(dt);   // 출입문 여닫힘 애니메이션 + 통과 충돌 토글
    }
    if (composer) composer.render(dt);   // 후처리(외곽선) 경로
    else renderer.render(scene, camera);  // 컴포저 준비 전 폴백
  }
  loop();
})();
