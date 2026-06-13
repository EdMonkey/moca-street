/* ============================================================
 * effects.js — 서빙 완료 연출 (컵 드롭인 → 체크 팝 + 금색 파티클 → 컵 사라짐)
 * scene을 init으로 주입받아 동작. 게임 상태에 역참조 없음.
 * 전역 Effects로 노출:
 *   Effects.init(scene)            — 파티클 풀/텍스처 준비 (1회)
 *   Effects.spawnServe(pos, mesh)  — 서빙 연출 시작
 *   Effects.update(dt)             — 매 프레임 진행
 *   Effects.clear()                — 진행 중 연출 모두 정리
 * ============================================================ */
const Effects = (() => {
  let scene = null;
  let serveFxList = [];
  let sparkPool = [];
  let checkTex = null;

  function buildCheckTex() {
    const [c, x] = TEX.canvas(128, 128);
    x.fillStyle = '#7fb069';
    x.beginPath(); x.arc(64, 64, 44, 0, 7); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 5;
    x.beginPath(); x.arc(64, 64, 44, 0, 7); x.stroke();
    x.strokeStyle = '#ffffff'; x.lineWidth = 12; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(44, 66); x.lineTo(58, 82); x.lineTo(86, 46); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function buildSparkTex() {
    const [c, x] = TEX.canvas(64, 64);
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,244,210,1)');
    g.addColorStop(0.4, 'rgba(255,205,120,.85)');
    g.addColorStop(1, 'rgba(255,180,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function init(s) {
    scene = s;
    checkTex = buildCheckTex();
    const sparkTex = buildSparkTex();
    for (let i = 0; i < 28; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sparkTex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0
      }));
      sp.visible = false; sp.renderOrder = 7;
      sp.userData = { life: 0, max: 1, vx: 0, vy: 0, vz: 0 };
      scene.add(sp);
      sparkPool.push(sp);
    }
  }
  function emitSparks(pos, n) {
    let spawned = 0;
    for (const s of sparkPool) {
      if (s.visible) continue;
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.3;
      s.position.copy(pos);
      s.userData.vx = Math.cos(a) * sp;
      s.userData.vz = Math.sin(a) * sp;
      s.userData.vy = 0.9 + Math.random() * 1.5;
      s.userData.life = 0;
      s.userData.max = 0.4 + Math.random() * 0.3;
      s.scale.setScalar(0.06 + Math.random() * 0.05);
      s.material.opacity = 1;
      s.visible = true;
      if (++spawned >= n) break;
    }
  }
  function updateSparks(dt) {
    for (const s of sparkPool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life >= u.max) { s.visible = false; s.material.opacity = 0; continue; }
      u.vy -= 4 * dt;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      s.material.opacity = 1 - u.life / u.max;
    }
  }
  function flashServeBadge() {
    const b = $('serveBadge'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    const f = $('serveFlash'); f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  }
  function spawnServe(worldPos, mesh) {
    mesh.position.copy(worldPos);
    mesh.position.y += 0.12;     // 살짝 위에서 드롭인
    scene.add(mesh);
    const check = new THREE.Sprite(new THREE.SpriteMaterial({
      map: checkTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0
    }));
    check.renderOrder = 8;
    check.scale.setScalar(0.001);
    check.position.set(worldPos.x, worldPos.y + 0.34, worldPos.z);
    scene.add(check);
    serveFxList.push({ t: 0, cup: mesh, check, pos: worldPos.clone(), sparked: false, cupGone: false });
  }
  function update(dt) {
    updateSparks(dt);
    for (let i = serveFxList.length - 1; i >= 0; i--) {
      const fx = serveFxList[i];
      fx.t += dt;
      const T = fx.t;
      // 1) 드롭인: 컵이 트레이에 내려앉음
      fx.cup.position.y = T < 0.18 ? fx.pos.y + 0.12 * (1 - T / 0.18) : fx.pos.y;
      // 2) 임팩트: 체크 팝 + 파티클 + 사운드 + 화면 펀치 (1회)
      if (!fx.sparked && T >= 0.2) {
        fx.sparked = true;
        emitSparks(new THREE.Vector3(fx.pos.x, fx.pos.y + 0.06, fx.pos.z), 16);
        AudioFX.serveSuccess();
        flashServeBadge();
      }
      // 3) 체크 오버슛 스케일 + 상승 + 페이드아웃
      if (T >= 0.2) {
        const ct = T - 0.2;
        let s;
        if (ct < 0.16) s = 1.35 * (1 - Math.pow(1 - ct / 0.16, 3));   // 0→1.35 오버슛
        else if (ct < 0.26) s = 1.35 - 0.35 * ((ct - 0.16) / 0.1);    // 1.35→1.0 정착
        else s = 1;
        const op = ct > 0.62 ? Math.max(0, 1 - (ct - 0.62) / 0.28) : 1;
        fx.check.scale.set(0.3 * s, 0.3 * s, 1);
        fx.check.material.opacity = op;
        fx.check.position.y = fx.pos.y + 0.34 + Math.min(0.08, ct * 0.25);
      }
      // 4) 컵 사라짐: 살짝 떠오르며 줄어듦
      if (!fx.cupGone && T >= 0.28) {
        const vt = (T - 0.28) / 0.32;
        if (vt >= 1) { scene.remove(fx.cup); fx.cupGone = true; }
        else { fx.cup.scale.setScalar(1 - vt); fx.cup.position.y = fx.pos.y + vt * 0.16; }
      }
      // 정리
      if (T >= 1.05) {
        if (!fx.cupGone) scene.remove(fx.cup);
        scene.remove(fx.check);
        serveFxList.splice(i, 1);
      }
    }
  }
  function clear() {
    serveFxList.forEach(fx => { if (!fx.cupGone) scene.remove(fx.cup); scene.remove(fx.check); });
    serveFxList = [];
    sparkPool.forEach(s => { s.visible = false; s.material.opacity = 0; });
  }

  return { init, spawnServe, update, clear };
})();
