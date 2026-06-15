/* ============================================================
 * world.js — 카페 월드 빌더 (인테리어 · 머신 · 조명 · 충돌)
 *
 * 좌표계: 바닥 y=0, 매장 x∈[-9,9], z∈[-5,8]
 *   z < -1.6 : 작업 공간(바리스타 구역)
 *   z > -0.4 : 손님 공간, 출입문은 (5.5, 8)
 * ============================================================ */
const WORLD = (() => {
  const M = () => TEX.M;
  const ROOM = { x0: -9, x1: 9, z0: -5, z1: 8, h: 4.3 };

  /* ---------- 헬퍼 ---------- */
  function box(w, h, d, mat, x, y, z, opt = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = opt.cast !== false;
    m.receiveShadow = opt.receive !== false;
    return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, seg = 24, opt = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!opt.open), mat);
    m.position.set(x, y, z);
    m.castShadow = opt.cast !== false;
    m.receiveShadow = opt.receive !== false;
    return m;
  }
  function hitbox(w, h, d, x, y, z, data) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    m.position.set(x, y, z);
    m.userData.interact = data;
    m.userData.isHitbox = true;
    m.castShadow = m.receiveShadow = false;
    return m;
  }
  function textLabel(txt, w = 256, h = 64, font = '700 34px "Malgun Gothic"', fg = '#f5ead8', bg = '#3a2a1e') {
    const [c, x] = TEX.canvas(w, h);
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#d99a4e'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
  }

  /* ============================================================
   * 음료 / 디저트 / 보급상자 메시 팩토리
   * ============================================================ */
  const SYRUP_TINT = { vanilla: 0xd8b078, caramel: 0xc08a52, choco: 0x7a4a2a };

  function drinkColor(d) {
    if (!d.espresso) return d.milk ? 0xf2ead8 : 0xbfd8e2; // 물/우유만
    let c = new THREE.Color(d.milk ? 0xc89a6b : (d.water ? 0x4a2c16 : 0x4a2a12)); // 순수 샷도 검게 묻히지 않도록 살짝 밝게
    if (d.syrup) c.lerp(new THREE.Color(SYRUP_TINT[d.syrup]), 0.45);
    return c.getHex();
  }

  // 크레마 표시 여부 — 에스프레소가 있고 우유가 없으며, "마지막 샷 이후에 물을 붓지 않았을" 때만.
  // 샷 위에 물을 부으면(드립) 크레마가 깨져 사라진다 → 제조 순서의 시각 신호.
  function cremaOnTop(d) {
    if (!d.espresso || d.milk) return false;
    const order = d.order;
    if (!order || !order.length) return true;          // 순서 정보 없으면 기존처럼 표시
    const lastEsp = order.lastIndexOf('espresso');
    if (lastEsp === -1) return true;
    for (let i = lastEsp + 1; i < order.length; i++)
      if (order[i] === 'water') return false;          // 샷 위에 물 → 크레마 깨짐
    return true;
  }

  // drink: {cup:'hot'|'ice'|'espresso', ice, espresso, water, milk, foam, syrup, whip}
  function makeDrinkMesh(drink) {
    const g = new THREE.Group();
    const isIce = drink.cup === 'ice';
    const isEsp = drink.cup === 'espresso';
    const isShot = drink.cup === 'shot';        // 샷잔(재사용 도구) — 작고 손잡이 없는 유리잔
    const H = isIce ? 0.16 : isEsp ? 0.06 : isShot ? 0.05 : 0.12;
    const R = isIce ? 0.05 : isEsp ? 0.032 : isShot ? 0.025 : 0.052;
    const base = isEsp ? 0.01 : 0;              // 데미타세는 받침접시 위에 올라감
    const cupMat = (isIce || isShot) ? M().cupClear : M().cupWhite;
    // 컵 셸: Blender 중공(안이 파인) glb 모델. 머그/아이스/에스프레소잔은 손잡이·받침까지 포함.
    // glb 미로드 시점이거나 샷잔은 기존 절차적 실린더로 폴백한다. 재질은 게임 재질로 덮어써
    // 라이브러리 인스턴스 공유를 깨지 않고(클론별 머티리얼 교체) 기존 음료 룩을 유지한다.
    const glbCup = isShot ? null : (isIce ? 'GlassTumbler' : isEsp ? 'EspressoCupSaucer' : 'CoffeeMug');
    let cupShell = null;
    if (glbCup && window.Assets && window.Assets.isReady()) {
      cupShell = window.Assets.spawn(glbCup, 0, 0, 0, 0);  // 베이스 y=0 정렬된 클론
      if (cupShell) {
        cupShell.traverse((n) => { if (n.isMesh) { n.material = cupMat; n.castShadow = false; } });
        g.add(cupShell);
      }
    }
    if (!cupShell) {  // ----- 절차적 폴백 (glb 미준비 / 샷잔) -----
      if (isEsp) { // 받침접시
        const saucer = cyl(0.052, 0.04, 0.009, M().cupWhite, 0, 0.0045, 0, 18);
        saucer.castShadow = false;
        g.add(saucer);
      }
      const cup = cyl(R, R * 0.78, H, cupMat, 0, base + H / 2, 0, 20);
      cup.castShadow = false;
      g.add(cup);
      if (!isIce && !isShot) { // 손잡이 (머그/데미타세) — 샷잔은 손잡이 없음
        const handle = new THREE.Mesh(
          new THREE.TorusGeometry(isEsp ? 0.016 : 0.03, isEsp ? 0.005 : 0.008, 8, 16), M().cupWhite);
        handle.position.set(R + (isEsp ? 0.007 : 0.012), base + H / 2, 0);
        g.add(handle);
      }
    }
    const filled = drink.espresso || drink.water || drink.milk;
    if (filled) {
      const fillH = H * 0.9;                          // 거의 가득 — 불투명 머그도 위에서 내용물 색이 보이게
      const liq = cyl(R * 0.9, R * 0.74, fillH, new THREE.MeshStandardMaterial({
        color: drinkColor(drink), roughness: 0.15
      }), 0, base + fillH / 2 + 0.004, 0, 18);
      liq.castShadow = false;
      g.add(liq);
      // 에스프레소(우유 없는) 음료엔 컵 림 위로 봉긋 솟은 황금빛 크레마 —
      // 불투명한 머그컵도 옆에서 황금빛이 보여 샷이 든 걸 한눈에 알 수 있게.
      // 단, 샷 위에 물을 부으면(잘못된 순서) 크레마가 깨져 표시하지 않는다.
      if (cremaOnTop(drink)) {
        const cremaH = 0.024;
        const crema = cyl(R * 0.5, R * 0.92, cremaH, new THREE.MeshStandardMaterial({
          color: 0xc99f56, roughness: 0.5
        }), 0, base + H + 0.012 - cremaH / 2, 0, 20);   // 윗면이 림보다 ~0.012 위로 솟음
        crema.castShadow = false;
        g.add(crema);
      }
    }
    if (drink.ice) {
      for (let i = 0; i < 3; i++) {
        const ic = box(0.022, 0.022, 0.022, M().ice, (i - 1) * 0.02, base + H * 0.82, (i % 2 - 0.5) * 0.03);
        ic.rotation.set(i, i * 2, 0); ic.castShadow = false;
        g.add(ic);
      }
    }
    if (drink.foam) {     // 우유 거품도 림 위로 봉긋 (카푸치노)
      const fo = cyl(R * 0.6, R * 0.9, 0.024, M().milkLiquid, 0, base + H + 0.012 - 0.012, 0, 20);
      fo.castShadow = false; g.add(fo);
    }
    if (drink.whip) {
      const wh = cyl(0.012, R * 0.7, 0.05, M().milkLiquid, 0, base + H + 0.03, 0, 12);
      wh.castShadow = false; g.add(wh);
    }
    return g;
  }

  function makeDessertMesh(kind) {
    const g = new THREE.Group();
    const plate = cyl(0.085, 0.07, 0.012, M().cream, 0, 0.006, 0, 20);
    g.add(plate);
    if (kind === 'croissant') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xc88a3e, roughness: 0.7 });
      const body = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.018, 8, 12, Math.PI * 1.4), mat);
      body.rotation.x = -Math.PI / 2; body.position.y = 0.03;
      g.add(body);
    } else if (kind === 'muffin') {
      const cup = cyl(0.032, 0.024, 0.035, new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 }), 0, 0.03, 0, 12);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), new THREE.MeshStandardMaterial({ color: 0x5a3520, roughness: 0.85 }));
      top.position.y = 0.055;
      g.add(cup, top);
    } else { // cheesecake
      const mat = new THREE.MeshStandardMaterial({ color: 0xf0dca0, roughness: 0.6 });
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 3, 1), mat);
      slice.position.y = 0.03;
      const crust = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.01, 3, 1), new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.8 }));
      crust.position.y = 0.008;
      g.add(slice, crust);
    }
    return g;
  }

  // 포터필터 원두가루 머티리얼 (filled: 신선 / used: 추출 후 젖은 가루)
  const GROUNDS_MAT = {
    filled: new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.95 }),
    tamped: new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.6 }),
    used: new THREE.MeshStandardMaterial({ color: 0x241307, roughness: 0.95 }),
  };

  // 포터필터 (손에 들기 / 머신 장착 / 그라인더 공용) — 상태: empty | filled | tamped | used
  function makePortafilterMesh(state = 'filled') {
    const g = new THREE.Group();
    g.userData.state = state;
    buildPortafilter(g);
    // glb 미준비로 절차적 폴백된 경우, 로드되면 같은 그룹에서 glb로 교체
    // (머신 장착·그라인더의 정적 포터필터도 자동 갱신 — 참조 유지, 현재 상태 재적용)
    if (!g.userData.glb && window.Assets && window.Assets.ready) {
      window.Assets.ready.then(() => { if (window.Assets.isReady() && !g.userData.glb) buildPortafilter(g); }).catch(() => {});
    }
    return g;
  }

  // 포터필터 그룹의 자식을 (재)구성: glb(준비 시) 또는 절차적 + 원두가루. 마지막 상태를 재적용.
  function buildPortafilter(g) {
    for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]);
    let groundsY = 0.028, usedGlb = false;
    if (window.Assets && window.Assets.isReady && window.Assets.isReady()) {
      const m = window.Assets.spawn('Portafilter', 0, 0, 0);   // 베이스 y=0
      if (m) {
        m.traverse(n => { if (n.isMesh) n.castShadow = false; });
        // 림 높이는 부모(머신)에 붙이기 전 = 로컬 기준으로 측정해야 함.
        // setFromObject는 월드 박스라, 이미 부착된 상태(업그레이드)에서 재면 월드 y로 오염돼 가루가 공중에 뜬다.
        groundsY = new THREE.Box3().setFromObject(m).max.y - 0.006;   // 가루 둔덕을 림 위로 봉긋(옆/앞/위 어디서나 보이게)
        g.add(m); usedGlb = true;
      }
    }
    if (!usedGlb) {   // 폴백: 절차적 포터필터 (glb 로드 전)
      const basket = cyl(0.052, 0.045, 0.05, M().steelDark, 0, 0, 0, 14);
      const handle = cyl(0.017, 0.02, 0.17, M().woodDark, 0, 0, 0.135, 10); handle.rotation.x = Math.PI / 2;
      const spout = cyl(0.012, 0.018, 0.045, M().steel, 0, -0.045, 0.04, 8);
      g.add(basket, handle, spout);
    }
    const grounds = cyl(0.029, 0.031, 0.026, GROUNDS_MAT.filled, 0, groundsY, 0, 16);   // 바스켓을 꽉 채우고 림 위로 봉긋한 커피가루 둔덕
    g.add(grounds);
    g.userData.grounds = grounds;
    g.userData.groundsY = groundsY;
    g.userData.groundsH = 0.026;
    g.userData.glb = usedGlb;
    setPortafilterState(g, g.userData.state || 'filled');
  }

  // 포터필터 메시의 상태별 표시 갱신
  //   none  → 그룹 자체를 숨김(장착 안 됨)
  //   empty → 보이되 원두가루 숨김
  //   filled/tamped/used → 보이고 가루 색을 상태에 맞게 교체 (tamped는 눌려 납작함)
  function setPortafilterState(group, state) {
    group.userData.state = state;   // 마지막 상태 기록(로드 후 glb 재구성 시 재적용)
    const grounds = group.userData.grounds;
    if (state === 'none') { group.visible = false; return; }
    group.visible = true;
    if (grounds) {
      grounds.visible = (state !== 'empty');
      grounds.material = GROUNDS_MAT[state === 'used' ? 'used' : state === 'tamped' ? 'tamped' : 'filled'];
      // 탬핑된 원두는 눌려 납작하고 윗면이 매끈해짐
      const tamped = state === 'tamped';
      const by = group.userData.groundsY != null ? group.userData.groundsY : 0.028;
      grounds.scale.y = tamped ? 0.6 : 1;
      grounds.position.y = tamped ? by - 0.002 : by;
    }
  }

  // 분쇄 중 커피가루가 바닥부터 차오르는 표현 (frac 0..1) — 그라인더에서 사용
  function setPortafilterFill(group, frac) {
    const grounds = group.userData.grounds;
    if (!grounds) return;
    group.visible = true;
    grounds.visible = true;
    grounds.material = GROUNDS_MAT.filled;
    frac = Math.max(0.02, Math.min(1, frac));
    const by = group.userData.groundsY != null ? group.userData.groundsY : 0.028;
    const h = group.userData.groundsH != null ? group.userData.groundsH : 0.024;
    grounds.scale.y = frac;                                   // 바닥 고정 후 위로 차오름
    grounds.position.y = (by - h / 2) + (h * frac) / 2;
  }

  // 추출 중 컵에 차오르는 에스프레소 — 컵 메시의 자식으로 넣고 setBrewFill로 높이를 키운다
  const CUP_DIM = {
    ice:       { R: 0.05,  H: 0.16, base: 0 },
    espresso:  { R: 0.032, H: 0.06, base: 0.01 },
    hot:       { R: 0.052, H: 0.12, base: 0 },
    shot:      { R: 0.025, H: 0.05, base: 0 },
  };
  function makeBrewLiquid(cup) {
    const d = CUP_DIM[cup] || CUP_DIM.hot;
    const fullH = d.H * 0.74;
    const m = cyl(d.R * 0.86, d.R * 0.7, fullH, M().coffeeLiquid, 0, 0, 0, 16);
    m.castShadow = false;
    m.userData = { base: d.base, fullH };
    setBrewFill(m, 0);
    return m;
  }
  function setBrewFill(m, frac) {
    frac = Math.max(0, Math.min(1, frac));
    const { base, fullH } = m.userData;
    m.scale.y = Math.max(0.001, frac);                 // 지오메트리 높이=fullH → scale.y가 곧 채움 비율
    m.position.y = base + 0.008 + fullH * frac / 2;    // 바닥은 고정한 채 위로 차오름
  }

  // 스팀 피처(밀크 저그) — 재사용 도구. Blender glTF 모델(MilkPitcher)을 쓰고, 미로드 시 절차적 폴백.
  // milk/foam이면 내용물(데운 우유/거품)을 모델 종류와 무관하게 안쪽에 표시.
  function makePitcherMesh(milk, foam) {
    const g = new THREE.Group();
    let usedGlb = false;
    if (window.Assets && window.Assets.isReady && window.Assets.isReady()) {
      const m = window.Assets.spawn('MilkPitcher', 0, 0, 0);   // 베이스를 y=0에 맞춰 복제
      if (m) {
        m.traverse(n => { if (n.isMesh) n.castShadow = false; });  // 손에 든 도구 — 그림자 끔(기존 동작 유지)
        g.add(m); usedGlb = true;
      }
    }
    if (!usedGlb) {   // 폴백: 기존 절차적 피처 (glb 로드 전 짧은 순간)
      const R = 0.046, H = 0.13;
      const body = cyl(R, R * 0.8, H, M().steel, 0, H / 2, 0, 20); body.castShadow = false; g.add(body);
      const spout = cyl(0.01, 0.028, 0.04, M().steel, 0, H - 0.005, R * 0.85, 8); spout.rotation.x = 0.6; spout.castShadow = false; g.add(spout);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 8, 16), M().steel); handle.position.set(R + 0.012, H * 0.55, 0); handle.castShadow = false; g.add(handle);
    }
    if (milk || foam) {   // 데운 우유 / 거품 — 피처 안쪽 내용물 (모델 종류 무관)
      const liq = cyl(0.033, 0.030, 0.07, M().milkLiquid, 0, 0.040, 0.01, 18); liq.castShadow = false; g.add(liq);
      if (foam) { const fo = cyl(0.022, 0.036, 0.018, M().milkLiquid, 0, 0.082, 0.01, 18); fo.castShadow = false; g.add(fo); }
    }
    return g;
  }

  function makeBoxMesh(kind) {
    const names = { beans: '원두', milk: '우유', cups: '컵', dessert: '디저트' };
    const g = new THREE.Group();
    const b = box(0.42, 0.3, 0.32, new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.85 }), 0, 0.15, 0);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), textLabel(names[kind], 192, 72, '700 40px "Malgun Gothic"', '#3a2a1e', '#e8d8b8'));
    lbl.position.set(0, 0.15, 0.165);
    g.add(b, lbl);
    return g;
  }

  /* ============================================================
   * 월드 빌드
   * ============================================================ */
  function build(scene) {
    const env = {
      interactables: [], colliders: [],
      surfaces: [],            // 아이템을 내려놓을 수 있는 표면(카운터·테이블·선반)
      stations: [],            // 편집 모드로 이동 가능한 기구들
      staticBlockers: [],      // 편집 시 설치 금지 구역(계산대·픽업대·쇼케이스)
      machines: {}, steamEmitters: [], deliveryViews: [],
      registerPos: new THREE.Vector3(2.5, 1.0, -1.0),
      pickupPos: new THREE.Vector3(-0.6, 1.0, -1.0),
      doorPos: new THREE.Vector3(5.5, 0, 8),
      spawnPos: new THREE.Vector3(5.5, 0, 11),
      queueSpots: [[2.5, 0.25], [2.5, 1.5], [2.5, 2.75], [2.5, 4.0], [2.5, 5.2]],
      pickupSpots: [[-0.6, 0.35], [-1.8, 0.5], [-3.0, 0.4], [-1.2, 1.6], [-2.4, 1.6]],
      entryWaypoint: [4.6, 4.5],
    };
    const addI = m => { env.interactables.push(m); scene.add(m); return m; };
    const addCol = (x0, x1, z0, z1) => {
      const c = { x0, x1, z0, z1 };
      env.colliders.push(c);
      return c;
    };

    /* 편집 가능한 기구(스테이션): 모델·라벨·히트박스를 한 그룹에 묶음 */
    function station(id, name, x, z, w, d, opt = {}) {
      const root = new THREE.Group();
      root.position.set(x, opt.floor ? 0 : 0.97, z);
      scene.add(root);
      const st = {
        id, name, root, w, d, floor: !!opt.floor, rotY: 0,
        home: { x, z, y: root.position.y, rotY: 0 }, colliderRef: null,
      };
      env.stations.push(st);
      return st;
    }
    function childHitbox(st, w, h, d, lx, ly, lz, data) {
      const m = hitbox(w, h, d, lx, ly, lz, data);
      m.userData.station = st;
      st.root.add(m);
      env.interactables.push(m);
      return m;
    }

    /* 머신 위 진행 상태 바 (빌보드 스프라이트) — 얇은 바, 완료 시 체크 아이콘만 */
    function makeProgress(parent, lx, ly, lz) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 32;
      const pctx = c.getContext('2d');
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      s.scale.set(0.34, 0.085, 1);
      s.position.set(lx, ly, lz);
      s.renderOrder = 5;
      s.visible = false;
      parent.add(s);
      return {
        draw(frac, done) {
          s.visible = true;
          pctx.clearRect(0, 0, 128, 32);
          if (done) {
            // 초록 원 + 흰색 체크만
            pctx.fillStyle = '#7fb069';
            pctx.beginPath(); pctx.arc(64, 16, 13, 0, 7); pctx.fill();
            pctx.strokeStyle = '#ffffff';
            pctx.lineWidth = 3.5;
            pctx.lineCap = 'round'; pctx.lineJoin = 'round';
            pctx.beginPath();
            pctx.moveTo(57, 16.5); pctx.lineTo(62, 21.5); pctx.lineTo(71, 11);
            pctx.stroke();
          } else {
            pctx.fillStyle = 'rgba(10,6,3,.75)';
            pctx.beginPath(); pctx.roundRect(14, 12, 100, 8, 4); pctx.fill();
            const w = Math.max(0, Math.min(1, frac)) * 96;
            if (w > 2) {
              pctx.fillStyle = '#e8b86d';
              pctx.beginPath(); pctx.roundRect(16, 14, w, 4, 2); pctx.fill();
            }
          }
          tex.needsUpdate = true;
        },
        hide() { s.visible = false; }
      };
    }

    /* ---------- 바닥 / 천장 / 벽 ---------- */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), M().floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 1.5);
    floor.receiveShadow = true;
    scene.add(floor);
    env.floorMesh = floor;

    const ceil = box(18, 0.2, 13, M().cream, 0, ROOM.h, 1.5, { cast: false });
    scene.add(ceil);
    // 천장 보
    for (let bx = -7; bx <= 7; bx += 3.5)
      scene.add(box(0.3, 0.26, 13, M().woodDark, bx, ROOM.h - 0.16, 1.5, { cast: false }));

    // 뒷벽(z=-5): 벽돌 + 메뉴보드
    scene.add(box(18, ROOM.h, 0.3, M().brick, 0, ROOM.h / 2, -5.15));
    const mb = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.5 * 0.625), M().menuBoard);
    mb.position.set(-1.4, 2.75, -4.97); scene.add(mb);
    scene.add(box(5.8, 0.1, 0.08, M().woodDark, -1.4, 2.75 + 1.14, -4.96));
    scene.add(box(5.8, 0.1, 0.08, M().woodDark, -1.4, 2.75 - 1.14, -4.96));

    // 좌/우 벽
    scene.add(box(0.3, ROOM.h, 13, M().brick, -9.15, ROOM.h / 2, 1.5));
    scene.add(box(0.3, ROOM.h, 13, M().plaster, 9.15, ROOM.h / 2, 1.5));

    // 앞벽(z=8): 큰 유리창 + 출입문
    (function frontWall() {
      const z = 8.05;
      // 하단 패널 — 출입문 구간(x 4.7~6.3)은 비워 통유리 문이 바닥까지 드러나게
      scene.add(box(13.7, 0.9, 0.25, M().counterWoodDark, -2.15, 0.45, z));   // 좌측 패널(−9 ~ 4.7)
      scene.add(box(2.7, 0.9, 0.25, M().counterWoodDark, 7.65, 0.45, z));     // 우측 패널(6.3 ~ 9)
      scene.add(box(18, 0.7, 0.25, M().plaster, 0, ROOM.h - 0.35, z));     // 상단 보
      // 유리 구간: x -8.6 ~ 4.3 / 문: 4.7~6.3 / 오른쪽 기둥
      const glassTop = ROOM.h - 0.7, glassH = glassTop - 0.9;
      const panes = [[-8.6, -4.6], [-4.3, -0.3], [0, 4.3], [6.6, 8.6]];
      panes.forEach(([a, b]) => {
        const w = b - a, cx = (a + b) / 2;
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, glassH - 0.1), M().glass);
        gl.position.set(cx, 0.9 + glassH / 2, z - 0.05);
        scene.add(gl);
        scene.add(box(0.14, glassH, 0.2, M().woodDark, a, 0.9 + glassH / 2, z));
        scene.add(box(0.14, glassH, 0.2, M().woodDark, b, 0.9 + glassH / 2, z));
        scene.add(box(w, 0.1, 0.18, M().woodDark, cx, 0.9 + glassH * 0.55, z, { cast: false })); // 가로 살
      });
      // 출입문 틀(좌/우 기둥)
      scene.add(box(0.14, ROOM.h, 0.2, M().woodDark, 4.7, ROOM.h / 2, z));
      scene.add(box(0.14, ROOM.h, 0.2, M().woodDark, 6.3, ROOM.h / 2, z));
      // 통유리 여닫이 출입문 — 좌측 기둥(x≈4.72)을 경첩축으로 바깥(거리)쪽으로 열림
      const door = new THREE.Group();
      const gmat = M().glass, fmat = M().steel;
      const DW = 1.5, DH = 2.5;                                       // 문짝 폭/높이(개구부 1.6 거의 채움)
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.08, DH - 0.08), gmat);  // 통유리 한 장
      leaf.position.set(DW / 2, DH / 2, 0);
      const railT = box(DW, 0.08, 0.05, fmat, DW / 2, DH - 0.02, 0);   // 상단 레일
      const railB = box(DW, 0.10, 0.05, fmat, DW / 2, 0.06, 0);        // 하단 레일
      const stileHinge = box(0.06, DH, 0.05, fmat, 0.03, DH / 2, 0);   // 경첩쪽 세로틀
      const stileFree  = box(0.06, DH, 0.05, fmat, DW - 0.03, DH / 2, 0); // 손잡이쪽 세로틀
      const handle = cyl(0.018, 0.018, 1.0, fmat, DW - 0.13, DH / 2, 0.07, 10);  // 세로 바 손잡이
      const hTop = cyl(0.014, 0.014, 0.07, fmat, DW - 0.13, DH / 2 + 0.48, 0.045, 8); hTop.rotation.x = Math.PI / 2;
      const hBot = cyl(0.014, 0.014, 0.07, fmat, DW - 0.13, DH / 2 - 0.48, 0.045, 8); hBot.rotation.x = Math.PI / 2;
      door.add(leaf, railT, railB, stileHinge, stileFree, handle, hTop, hBot);
      door.position.set(4.72, 0, z - 0.05);    // 경첩축 = 좌측 기둥
      scene.add(door);
      // 문 조준 히트박스(개구부) + 충돌체(닫힘 시 통과 차단) → game.js가 'door'로 여닫음
      addI(hitbox(1.6, 2.5, 0.6, 5.5, 1.3, z - 0.15, { id: 'door' })).userData.outlineRoot = door;
      const doorCol = addCol(4.7, 6.3, 7.85, 8.55);
      env.door = {
        group: door, open: false, angle: 0, openAngle: -1.82, col: doorCol,   // 영업 전 = 닫힘 (열면 바깥으로 ~104°)
        toggle() { this.open = !this.open; },
        update(dt) {
          const tgt = this.open ? this.openAngle : 0;
          this.angle += (tgt - this.angle) * Math.min(1, dt * 9);   // 부드럽게 여닫힘
          this.group.rotation.y = this.angle;
          const passable = this.angle < this.openAngle * 0.5;        // 절반 이상 열리면 통과 허용
          this.col.x0 = passable ? 1e6 : 4.7;
          this.col.x1 = passable ? 1e6 : 6.3;
        },
      };
      env.door.update(0);   // 시작 상태(열림) 적용
      // 출입문 상단 트랜섬 창(좌우 유리창과 동일 룩) — 문 개구부 위쪽을 유리로
      const txBot = 2.55;
      const txGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.6 - 0.16, glassTop - txBot - 0.08), M().glass);
      txGlass.position.set(5.5, (glassTop + txBot) / 2, z - 0.05);
      scene.add(txGlass);
      scene.add(box(1.6, 0.1, 0.18, M().woodDark, 5.5, txBot, z, { cast: false }));   // 트랜섬 하단 가로살(문 위 상인방)
      // OPEN/CLOSE 팻말 — 문 상단(트랜섬)에 매닮, 영업 상태에 따라 교체 (game.js가 env.doorSign.setOpen 호출)
      const openMat  = textLabel('OPEN',  160, 80, '700 44px Georgia', '#7fb069', '#23291f');
      const closeMat = textLabel('CLOSE', 160, 80, '700 40px Georgia', '#e0846c', '#2a1c18');
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), closeMat);   // 시작은 영업 전 = CLOSE
      sign.position.set(5.5, 2.95, z - 0.2); sign.rotation.y = Math.PI;
      scene.add(sign);
      [5.31, 5.69].forEach(hx => scene.add(cyl(0.006, 0.006, 0.46, M().steelDark, hx, 3.22, z - 0.2, 6, { cast: false })));  // 매다는 줄
      env.doorSign = { mesh: sign, setOpen(b) { sign.material = b ? openMat : closeMat; } };
    })();

    // 충돌: 외벽 + 앞벽(문 개구부 x4.7~6.3 제외 — 문으로 출입, 문 충돌체는 위 env.door가 토글)
    addCol(ROOM.x0 - 1, ROOM.x0, ROOM.z0 - 1, ROOM.z1 + 1);
    addCol(ROOM.x1, ROOM.x1 + 1, ROOM.z0 - 1, ROOM.z1 + 1);
    addCol(ROOM.x0 - 1, ROOM.x1 + 1, ROOM.z0 - 1, ROOM.z0);
    addCol(ROOM.x0 - 1, 4.7, ROOM.z1, ROOM.z1 + 1);
    addCol(6.3, ROOM.x1 + 1, ROOM.z1, ROOM.z1 + 1);

    /* ---------- 외부 거리 (문 열고 나가서 걸어다닐 수 있는 도로) ---------- */
    (function street() {
      // 원경 스카이라인(배경 그림)
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(90, 30), M().backdrop);
      bd.position.set(0, 12, 30); bd.rotation.y = Math.PI; bd.castShadow = bd.receiveShadow = false;
      scene.add(bd);
      // 보도(카페 앞 ~ 길 건너 넓게)
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(60, 34),
        new THREE.MeshStandardMaterial({ color: 0x9a9288, roughness: 0.96 }));
      walk.rotation.x = -Math.PI / 2; walk.position.set(0, -0.02, 20); walk.receiveShadow = true;
      scene.add(walk);
      // 차도(아스팔트)
      const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 6.4),
        new THREE.MeshStandardMaterial({ color: 0x37373d, roughness: 0.92 }));
      road.rotation.x = -Math.PI / 2; road.position.set(0, 0, 15.5); road.receiveShadow = true;
      scene.add(road);
      // 중앙 차선(노란 점선)
      const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8c258, roughness: 0.8 });
      for (let lx = -28; lx <= 28; lx += 3.2) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.16), lineMat);
        d.rotation.x = -Math.PI / 2; d.position.set(lx, 0.01, 15.5); scene.add(d);
      }
      // 연석(보도/차도 경계 띠 — 시각용, 충돌 없음)
      const curbMat = new THREE.MeshStandardMaterial({ color: 0xbcb4a8, roughness: 0.9 });
      [12.3, 18.7].forEach(cz => scene.add(box(60, 0.12, 0.22, curbMat, 0, 0.06, cz, { cast: false })));
      // 길 건너 건물 줄(3D, 높이 랜덤)
      const seed = s => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
      const bMats = [M().brick, M().plaster];
      let bx = -27, i = 0;
      while (bx < 27) {
        const w = 4 + seed(i) * 3.5, h = 5 + seed(i + 31) * 6.5;
        scene.add(box(w, h, 4, bMats[i % 2], bx + w / 2, h / 2, 24.6));
        bx += w + 0.3; i++;
      }
      // 좌우 측면 건물(거리 경계)
      [-1, 1].forEach(s => scene.add(box(5, 11, 34, M().plaster, s * 15.5, 5.5, 20)));
      // 가로등 2개 (일출/일몰·야간 조명과 어울리게 점등)
      [[-6, 10.6], [8, 10.6]].forEach(([lx, lz]) => {
        const g = new THREE.Group(); g.position.set(lx, 0, lz);
        g.add(cyl(0.06, 0.08, 3.4, M().steelDark, 0, 1.7, 0, 8));
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd98a, emissiveIntensity: 1.1 }));
        lamp.position.set(0, 3.42, 0); g.add(lamp);
        const pl = new THREE.PointLight(0xffd98a, 5, 8, 2); pl.position.set(0, 3.4, 0); g.add(pl);
        scene.add(g);
      });
      // 거리 경계 충돌체(플레이어가 도로 밖/건물로 못 나가게)
      addCol(-30, 30, 22.4, 23.4);     // 길 건너 건물 앞
      addCol(-14, -13, 8, 23);          // 좌측
      addCol(13, 14, 8, 23);            // 우측
    })();

    /* ---------- 메인 카운터 (z=-1) ---------- */
    (function counters() {
      const topY = 1.0;
      // 몸체(나무) + 대리석 상판, x -7 ~ 4
      scene.add(box(11, 0.95, 0.8, M().counterWoodMid, -1.5, 0.475, -1.0));
      const fcTop = box(11.3, 0.07, 1.0, M().counterTop, -1.5, topY, -1.0, { cast: false });
      fcTop.userData.counterTop = true;
      scene.add(fcTop); env.surfaces.push(fcTop);
      // 손님쪽 장식 패널
      for (let px = -6.6; px <= 3.6; px += 0.8)
        scene.add(box(0.55, 0.7, 0.05, M().woodDark, px, 0.5, -0.57, { cast: false }));
      addCol(-7.2, 4.2, -1.55, -0.45);

      // 백 카운터 (z=-4.2), x -7 ~ 4
      scene.add(box(11, 0.9, 0.8, M().counterWoodDark, -1.5, 0.45, -4.2));
      const bcTop = box(11.2, 0.06, 0.95, M().counterTopDark, -1.5, 0.94, -4.2, { cast: false });
      bcTop.userData.counterTop = true;
      scene.add(bcTop); env.surfaces.push(bcTop);
      addCol(-7.2, 4.2, -4.75, -3.65);

      // 주방 타일벽 (백카운터 뒤 하단)
      scene.add(box(11.2, 1.6, 0.08, M().tile, -1.5, 0.8, -4.93, { cast: false }));
    })();

    /* ---------- POS 계산대 ---------- */
    (function register() {
      const g = new THREE.Group();
      g.position.set(2.5, 1.03, -1.0);
      scene.add(g);
      // POS 단말기 — glb POSDualScreen(큰 화면이 모델 -z를 향함). 계산대는 직원이 z<-1(작업통로)에서
      // 조작하므로 rotY=0이면 큰 화면이 -z=직원쪽을 본다. 미로드 시 절차적 폴백.
      decorVisual(g, 'POSDualScreen', () => {
        const p = [];
        p.push(box(0.4, 0.12, 0.34, M().blackMatte, 0, 0.06, 0));
        const screen = box(0.36, 0.26, 0.03, M().blackMatte, 0, 0.3, -0.06); screen.rotation.x = -0.25; p.push(screen);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2),
          new THREE.MeshStandardMaterial({ color: 0x9adfff, emissive: 0x3a8aaa, emissiveIntensity: 0.9 }));
        scr.position.set(0, 0.305, -0.03); scr.rotation.x = -0.25; p.push(scr);
        return p;
      }, 0, 1.0);   // 180°·2배는 glb(POSDualScreen) 지오메트리에 baked됨 → 여기선 중립
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), textLabel('ORDER', 256, 70, '700 44px Georgia', '#e8b86d'));
      sign.position.set(2.5, 1.95, -0.9);
      scene.add(sign);
      const cord1 = cyl(0.01, 0.01, 0.6, M().blackMatte, 2.3, 2.36, -0.9, 6, { cast: false });
      const cord2 = cyl(0.01, 0.01, 0.6, M().blackMatte, 2.7, 2.36, -0.9, 6, { cast: false });
      scene.add(cord1, cord2);
      // 외곽선은 POS 기기 모델(본체+화면)에 그린다 — 빛나는 화면 평면은 collectOutlineTargets가 제외
      addI(hitbox(0.9, 0.9, 0.8, 2.5, 1.3, -1.0, { id: 'register' })).userData.outlineRoot = g;
      env.staticBlockers.push({ x: 2.5, z: -1.0, w: 1.0, d: 0.9 });
    })();

    /* ---------- 픽업대 ---------- */
    (function pickup() {
      const tray = box(1.6, 0.04, 0.55, M().woodLight, -0.6, 1.05, -1.0);
      scene.add(tray);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.22), textLabel('PICK UP', 256, 70, '700 40px Georgia', '#9fdc8a'));
      sign.position.set(-0.6, 1.95, -0.9);
      scene.add(sign);
      scene.add(cyl(0.01, 0.01, 0.6, M().blackMatte, -1.1, 2.36, -0.9, 6, { cast: false }));
      scene.add(cyl(0.01, 0.01, 0.6, M().blackMatte, -0.1, 2.36, -0.9, 6, { cast: false }));
      addI(hitbox(1.6, 0.8, 0.7, -0.6, 1.35, -1.0, { id: 'pickup' })).userData.outlineMeshes = [tray];
      env.machines.pickupTrayY = 1.07;
      env.staticBlockers.push({ x: -0.6, z: -1.0, w: 1.8, d: 0.7 });
    })();

    /* ---------- 디저트 쇼케이스 ---------- */
    (function dessertCase() {
      const cx = -4.8;
      const caseG = new THREE.Group();
      caseG.position.set(cx, 1.03, -1.0);
      const glassMat = M().glass;
      const gbox = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 0.72), glassMat);
      gbox.position.y = 0.31; gbox.castShadow = false;
      const frame = box(1.74, 0.04, 0.76, M().steelDark, 0, 0.62, 0);
      const shelf = box(1.6, 0.025, 0.6, M().steel, 0, 0.3, 0, { cast: false });
      caseG.add(gbox, frame, shelf);
      scene.add(caseG);
      // 디저트 진열 (아래칸/위칸)
      const kinds = ['croissant', 'muffin', 'cake'];
      env.machines.dessertDisplays = {};
      kinds.forEach((k, i) => {
        const dx = cx - 0.55 + i * 0.55;
        const slotG = new THREE.Group();
        for (let n = 0; n < 2; n++) {
          const d = makeDessertMesh(k);
          d.position.set(dx + (n - 0.5) * 0.2, 1.355, -1.0 + (n % 2 - 0.5) * 0.12);
          d.scale.setScalar(0.9);
          slotG.add(d);
        }
        scene.add(slotG);
        env.machines.dessertDisplays[k] = slotG;
        addI(hitbox(0.55, 0.6, 0.7, dx, 1.35, -1.0, { id: 'dessert', kind: k })).userData.outlineRoot = slotG;
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.2), textLabel('DESSERT', 256, 64, '700 38px Georgia', '#e8b86d'));
      sign.position.set(cx, 1.85, -0.85);
      scene.add(sign);
      env.staticBlockers.push({ x: cx, z: -1.0, w: 1.9, d: 0.85 });
    })();

    /* ============================================================
     * 백 카운터 머신들 (상판 y=0.97)
     * ============================================================ */
    const TY = 0.97;

    /* ---------- 컵 디스펜서 (머그 / 아이스 / 에스프레소 잔) ---------- */
    [
      ['cupHot', -6.5, '머그컵', M().cupWhite, { tubeR: 0.075, tubeH: 0.55, cupR: 0.06, cupH: 0.09, gap: 0.085, hb: 0.4 }],
      ['cupIce', -5.9, '아이스컵', M().cupClear, { tubeR: 0.075, tubeH: 0.55, cupR: 0.06, cupH: 0.09, gap: 0.085, hb: 0.4 }],
      ['cupEsp', -5.42, '에스프레소 잔', M().cupWhite, { tubeR: 0.052, tubeH: 0.36, cupR: 0.04, cupH: 0.05, gap: 0.052, hb: 0.34 }],
    ].forEach(([id, x, name, mat, o]) => {
      const st = station(id, name + ' 디스펜서', x, -4.25, o.tubeR * 2 + 0.12, 0.35);
      const r = st.root;
      r.add(cyl(o.tubeR, o.tubeR, o.tubeH, new THREE.MeshStandardMaterial({
        color: 0xc9cdd2, roughness: 0.25, metalness: 0.9, transparent: true, opacity: 0.5
      }), 0, o.tubeH / 2 + 0.03, 0, 16, { open: true }));
      for (let i = 0; i < 5; i++)
        r.add(cyl(o.cupR, o.cupR * 0.82, o.cupH, mat, 0, 0.06 + o.cupH / 2 + i * o.gap, 0, 14, { cast: false }));
      r.add(cyl(o.tubeR + 0.015, o.tubeR + 0.015, 0.03, M().steelDark, 0, 0.015, 0, 16));
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(id === 'cupEsp' ? 0.5 : 0.42, 0.13),
        textLabel(name, id === 'cupEsp' ? 256 : 192, 60, '700 30px "Malgun Gothic"'));
      lbl.position.set(0, 0.68, 0);
      r.add(lbl);
      childHitbox(st, o.hb, 0.8, 0.5, 0, 0.35, 0.05, { id });
    });

    /* ---------- 제빙기 ---------- */
    (function iceMachine() {
      const st = station('ice', '제빙기', -4.9, -4.3, 0.7, 0.65);
      const r = st.root;
      const vis = new THREE.Group(); r.add(vis);
      decorVisual(vis, 'IceMachine', () => {
        const p = [
          box(0.62, 0.5, 0.55, M().steel, 0, 0.25, 0),
          box(0.56, 0.1, 0.46, M().steelDark, 0, 0.52, 0),
          box(0.46, 0.18, 0.06, M().blackMatte, 0, 0.18, 0.28, { cast: false }),   // 얼음 개구부
        ];
        for (let i = 0; i < 6; i++)
          p.push(box(0.05, 0.05, 0.05, M().ice, -0.15 + (i % 3) * 0.15, 0.16 + Math.floor(i / 3) * 0.05, 0.27 + (i % 2) * 0.02, { cast: false }));
        return p;
      }, 0, 0.71);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), textLabel('얼음', 192, 60, '700 32px "Malgun Gothic"'));
      lbl.position.set(0, 0.68, 0.3);
      r.add(lbl);
      childHitbox(st, 0.65, 0.7, 0.6, 0, 0.3, 0.1, { id: 'ice' });
    })();

    /* 런타임에 추가 구매 가능한 머신은 배열로 관리 */
    env.machines.espressoSlots = [];
    env.machines.grinderJobs = [];
    env.machines.steamerJobs = [];

    /* ---------- 에스프레소 머신 (구매 시 재사용되는 빌더) ---------- */
    function buildEspresso(id, x, z, lockSecond) {
      const st = station(id, '에스프레소 머신', x, z, 1.45, 0.8);
      const g = st.root;
      // ---- 비주얼 셸: glb EspressoMachine(게임 앵커에 맞춰 새로 제작, ×1.0) 또는 절차적 폴백 ----
      const vis = new THREE.Group(); g.add(vis);
      decorVisual(vis, 'EspressoMachine', () => {
        const p = [];
        p.push(box(1.25, 0.52, 0.58, M().steel, 0, 0.33, 0));
        p.push(box(1.27, 0.05, 0.6, M().steelDark, 0, 0.62, 0));
        p.push(box(1.1, 0.26, 0.04, M().blackMatte, 0, 0.4, 0.3));
        p.push(box(0.06, 0.5, 0.56, M().woodDark, -0.64, 0.33, 0));
        p.push(box(0.06, 0.5, 0.56, M().woodDark, 0.64, 0.33, 0));
        p.push(box(1.29, 0.02, 0.04, M().steel, 0, 0.66, 0.28, { cast: false }));
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.07),
          textLabel('MOCHA ST.', 256, 52, 'italic 700 30px Georgia', '#e8b86d', '#1c1815'));
        plate.position.set(0, 0.55, 0.335); p.push(plate);
        [-0.3, 0.3].forEach(ox => p.push(box(0.2, 0.14, 0.12, M().steel, ox, 0.42, 0.27)));
        for (let i = 0; i < 4; i++)
          p.push(cyl(0.045, 0.038, 0.07, M().cupWhite, -0.45 + i * 0.3, 0.684, 0, 12, { cast: false }));
        [-0.3, 0.3].forEach(ox => p.push(cyl(0.07, 0.08, 0.1, M().steelDark, ox, 0.30, 0.26, 14)));   // 그룹헤드
        p.push(box(0.9, 0.025, 0.3, M().steelDark, 0, 0.016, 0.3));   // 드립트레이
        // 압력 게이지 + LED
        const [gc, gx] = TEX.canvas(128, 128);
        gx.fillStyle = '#f5f0e2'; gx.beginPath(); gx.arc(64, 64, 60, 0, 7); gx.fill();
        gx.strokeStyle = '#2a2520'; gx.lineWidth = 7;
        gx.beginPath(); gx.arc(64, 64, 56, 0, 7); gx.stroke();
        gx.lineWidth = 3;
        for (let a = -0.75 * Math.PI; a <= -0.25 * Math.PI + 1.6; a += 0.31) {
          gx.beginPath();
          gx.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44);
          gx.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
          gx.stroke();
        }
        gx.strokeStyle = '#c43e2e'; gx.lineWidth = 5;
        gx.beginPath(); gx.moveTo(64, 64); gx.lineTo(64 + 34, 64 - 30); gx.stroke();
        const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
        const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.052, 24),
          new THREE.MeshStandardMaterial({ map: gt, roughness: 0.25 }));
        gauge.position.set(0, 0.42, 0.34);
        const gring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 8, 24), M().steel);
        gring.position.copy(gauge.position);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0xff9a3e, emissive: 0xff7a1e, emissiveIntensity: 2 }));
        led.position.set(-0.48, 0.42, 0.34);
        p.push(gauge, gring, led);
        // 스팀봉 + 노브
        const steamBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 14), M().steel);
        steamBall.position.set(0.57, 0.4, 0.3);
        const steamWand = cyl(0.013, 0.013, 0.3, M().steel, 0.565, 0.255, 0.325, 12); steamWand.rotation.x = -0.22;
        const steamNozzle = cyl(0.019, 0.009, 0.055, M().steelDark, 0.562, 0.085, 0.36, 12); steamNozzle.rotation.x = -0.22;
        const knobBase = cyl(0.026, 0.026, 0.03, M().steel, 0.46, 0.44, 0.31, 16); knobBase.rotation.x = Math.PI / 2;
        const knobGrip = cyl(0.036, 0.033, 0.045, M().blackMatte, 0.46, 0.44, 0.345, 18); knobGrip.rotation.x = Math.PI / 2;
        const knobMark = box(0.005, 0.022, 0.006, M().cupWhite, 0.46, 0.44, 0.37, { cast: false });
        p.push(steamBall, steamWand, steamNozzle, knobBase, knobGrip, knobMark);
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), textLabel('에스프레소 머신', 320, 60, '700 30px "Malgun Gothic"'));
        lbl.position.set(0, 0.85, 0.25); p.push(lbl);
        return p;
      }, 0, 1.0);

      // ---- 기능부 (앵커는 유지 — 새 glb 그룹헤드 ±0.3 / 우측 스팀완드와 정렬) ----
      const slotBase = env.machines.espressoSlots.length;
      [-0.3, 0.3].forEach((ox, i) => {
        // 포터필터(기본 '빈' 상태) — glb 그룹헤드(z0.30 돌출) 아래 장착, 배출구가 컵 위로
        // 장착 높이는 그룹헤드 추출구에 맞춤(새 모델은 추출구가 베이스 위 0.225 → 이전 0.175에서 +0.05 상승)
        const pf = makePortafilterMesh('empty');
        pf.position.set(ox, 0.185, 0.30);
        g.add(pf);
        const stream = cyl(0.006, 0.006, 0.15, M().coffeeLiquid, ox, 0.115, 0.3, 6, { cast: false });   // 추출 줄기: 상단을 올라간 추출구(0.185)에 맞춤
        stream.visible = false;
        g.add(stream);
        env.machines.espressoSlots.push({
          st, localPos: new THREE.Vector3(ox, 0.047, 0.3),   // 컵 베이스를 받침판 윗면(0.045) 위에 올림(묻힘 방지)
          progress: makeProgress(g, ox, 0.27, 0.3),
          stream, pf, pfState: 'empty', tampPerfect: false, brewLiquid: null,
          locked: (i === 1 ? !!lockSecond : false),
          busy: false, cupMesh: null, done: false, drink: null, t: 0
        });
        const slotIdx = slotBase + i;
        // 추출 버튼(빨간 버튼) — 전면 상단, 그룹헤드 위
        const brewBtn = cyl(0.028, 0.028, 0.025, M().steelDark, ox, 0.46, 0.32, 14);
        brewBtn.rotation.x = Math.PI / 2;
        const brewLed = new THREE.Mesh(new THREE.CircleGeometry(0.017, 16),
          new THREE.MeshStandardMaterial({ color: 0xd9534f, emissive: 0xd9534f, emissiveIntensity: 1.3 }));
        brewLed.position.set(ox, 0.46, 0.346);
        g.add(brewBtn, brewLed);
        // 분리된 상호작용 히트박스 3종 (높이로 구분): 컵 자리(아래) · 포터필터+그룹헤드(중간) · 추출 버튼(위)
        // 컵 자리: 받침판 위 컵 영역(컵을 올리고 뺄 때 위 포터필터가 안 잡히게). 조준은 수직거리 기반(player.aim)
        childHitbox(st, 0.26, 0.20, 0.33, ox, 0.07, 0.33, { id: 'espCup', slot: slotIdx });
        // 포터필터+그룹헤드(A): 올라간 포터필터(0.185)에 맞춰 위로 — 컵 영역과 중심 분리
        childHitbox(st, 0.22, 0.18, 0.30, ox, 0.24, 0.30, { id: 'pfSlot', slot: slotIdx }).userData.outlineMeshes = [pf];
        childHitbox(st, 0.15, 0.14, 0.16, ox, 0.46, 0.33, { id: 'brew', slot: slotIdx }).userData.outlineMeshes = [brewBtn, brewLed];
      });
      // ---- 좌우 받침판 (glb에 머신 기준 제자리로 분리 모델링됨) ----
      // 원본 트랜스폼을 유지해 머신 시각 그룹(vis)에 얹고, 좌/우 컵 자리(espCup) 외곽선 대상으로 연결.
      if (window.Assets && window.Assets.ready) {
        window.Assets.ready.then(() => {
          [['EspressoPlateL', 0], ['EspressoPlateR', 1]].forEach(([nm, i]) => {
            const pl = window.Assets.spawnInPlace(nm);
            if (!pl) return;
            vis.add(pl);
            const slot = env.machines.espressoSlots[slotBase + i];
            if (slot) slot.plateMesh = pl;   // 컵이 없을 때 받침판에 외곽선 표시
          });
        }).catch(() => {});
      }
      env.machines.espressoGroup = g;
      env.steamEmitters.push({ st, local: new THREE.Vector3(0, 0.66, 0) });
      const steamJob = {
        kind: 'steamer', st, localPos: new THREE.Vector3(0.6, 0.03, 0.3),
        wandLocal: new THREE.Vector3(0.562, 0.045, 0.37), steamT: 0,
        progress: makeProgress(g, 0.6, 0.27, 0.3),
        busy: false, done: false, t: 0, dur: 0, drink: null, cupMesh: null, makingFoam: false, sound: null
      };
      env.machines.steamerJobs.push(steamJob);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), textLabel('에스프레소 머신', 320, 60, '700 30px "Malgun Gothic"'));
      lbl.position.set(0, 0.85, 0.25);
      g.add(lbl);
      // 스티머 분리 히트박스: 스팀봉(피처 데우기) + 노브(스팀 분사) — 시각물은 glb에 포함되어
      // 외곽선은 전체 머신 폴백으로 처리(개별 메시 참조 불가).
      childHitbox(st, 0.24, 0.4, 0.3, 0.6, 0.2, 0.34, { id: 'steamwand', job: steamJob });   // 스팀봉에 맞게 조임
      childHitbox(st, 0.14, 0.16, 0.16, 0.46, 0.44, 0.34, { id: 'steamknob', job: steamJob });
      return st;
    }
    buildEspresso('espresso', -3.1, -4.25, true);   // 원래 머신: 2번 슬롯은 듀얼헤드 잠금

    /* ---------- 밀크 스티머 (구매 시 재사용되는 빌더) ---------- */
    function buildSteamer(id, x, z) {
      const st = station(id, '밀크 스티머', x, z, 0.62, 0.55);
      const g = st.root;
      const body = box(0.3, 0.42, 0.3, M().steel, 0, 0.21, 0);
      const wand = cyl(0.012, 0.012, 0.26, M().steel, 0.16, 0.3, 0.12, 8);
      wand.rotation.z = 0.5; wand.rotation.x = 0.3;
      // 스테인리스 피처
      const pitcher = cyl(0.05, 0.04, 0.11, M().steel, 0.22, 0.055, 0.18, 14);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), M().blackMatte);
      knob.position.set(-0.12, 0.38, 0.16);
      g.add(body, wand, pitcher, knob);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), textLabel('밀크 스티머', 256, 60, '700 30px "Malgun Gothic"'));
      lbl.position.set(0, 0.62, 0.2);
      g.add(lbl);
      const job = {
        kind: 'steamer',
        st, localPos: new THREE.Vector3(0.2, 0, 0.22),
        wandLocal: new THREE.Vector3(0.2, 0.18, 0.18), steamT: 0,   // 스팀봉 끝(증기 분출). 노브 조작/스팀 중에만.
        progress: makeProgress(g, 0.2, 0.24, 0.22),   // 스팀 중인 컵 바로 위
        busy: false, done: false, t: 0, dur: 0, drink: null, cupMesh: null, makingFoam: false, sound: null
      };
      childHitbox(st, 0.6, 0.7, 0.6, 0, 0.3, 0.05, { id: 'steamwand', job });   // 구매용 스티머는 단일(스팀봉)
      env.machines.steamerJobs.push(job);
      return st;
    }
    // 기본 밀크 스티머는 에스프레소 머신에 통합됨(위 buildEspresso의 스팀 완드).
    // buildSteamer는 영업 준비 단계에서 '추가 스티머'를 구매·배치할 때 재사용된다.

    /* ---------- 스팀 피처 거치대 (재사용 무료 도구 — 우유를 데워 컵에 붓는다) ---------- */
    (function pitcherStand() {
      const x = -2.85, z = -4.05, y = 1.42;   // 에스프레소 머신 갈색 작업 받침대 위 — 우측
      const r = new THREE.Group();
      r.position.set(x, y, z);
      scene.add(r);
      r.add(makePitcherMesh(0, 0));        // 데모용 빈 피처 (머신 상판 위 — 이름표 불필요)
      addI(hitbox(0.18, 0.22, 0.2, x, y + 0.09, z, { id: 'pitcherrack' })).userData.outlineRoot = r;   // 피처 크기에 맞게
    })();

    /* ---------- 온수/냉수 디스펜서 ---------- */
    env.machines.waterJobs = {};
    (function water() {
      [['waterHot', -0.55, '온수', 0xd9534f], ['waterCold', 0.15, '냉수', 0x5a9adf]].forEach(([id, x, name, dot]) => {
        const st = station(id, name + ' 디스펜서', x, -4.3, 0.32, 0.35);
        const r = st.root;
        const vis = new THREE.Group(); r.add(vis);
        decorVisual(vis, 'WaterDispenser', () => {
          const spout = cyl(0.014, 0.014, 0.14, M().steelDark, 0, 0.32, 0.16, 8);
          spout.rotation.x = 0.9;
          return [box(0.22, 0.5, 0.24, M().steel, 0, 0.25, 0), spout];
        }, 0, 1.0);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8),
          new THREE.MeshStandardMaterial({ color: dot, emissive: dot, emissiveIntensity: 1.2 }));
        led.position.set(0, 0.42, 0.13);
        r.add(led);
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), textLabel(name, 128, 56, '700 30px "Malgun Gothic"'));
        lbl.position.set(0, 0.6, 0.15);
        r.add(lbl);
        childHitbox(st, 0.32, 0.7, 0.55, 0, 0.3, 0.1, { id });
        // 물줄기 — 받는 동안 표시 (스파웃 노즐 → 컵). 컵은 스파웃 바로 아래에 놓임
        const stream = cyl(0.006, 0.006, 0.11, new THREE.MeshStandardMaterial({
          color: 0xcfeaff, transparent: true, opacity: 0.6, roughness: 0.15
        }), 0, 0.18, 0.19, 6, { cast: false });
        stream.visible = false;
        r.add(stream);
        env.machines.waterJobs[id] = {
          kind: 'water', waterType: id === 'waterHot' ? 'hot' : 'cold',
          st, localPos: new THREE.Vector3(0, 0, 0.19), stream,
          progress: makeProgress(r, 0, 0.30, 0.19),   // 물 받는 컵 바로 위
          busy: false, done: false, t: 0, dur: 0, drink: null, cupMesh: null, sound: null
        };
      });
    })();

    /* ---------- 시럽 스테이션 (3병 한 묶음) ---------- */
    (function syrup() {
      const st = station('syrup', '시럽 스테이션', 1.47, -4.3, 1.3, 0.45);
      const r = st.root;
      const names = { vanilla: ['바닐라', 0xe8d8a8], caramel: ['카라멜', 0xc08a3e], choco: ['초코', 0x5a3520] };
      Object.keys(names).forEach((k, i) => {
        const lx = -0.42 + i * 0.42;
        const [nm, col] = names[k];
        r.add(cyl(0.055, 0.065, 0.3, new THREE.MeshPhysicalMaterial({
          color: col, transparent: true, opacity: 0.85, roughness: 0.2
        }), lx, 0.15, 0, 14));
        r.add(cyl(0.02, 0.03, 0.08, M().steelDark, lx, 0.34, 0, 10));
        r.add(box(0.025, 0.025, 0.1, M().steelDark, lx, 0.4, 0.04));
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.11), textLabel(nm, 128, 52, '700 28px "Malgun Gothic"'));
        lbl.position.set(lx, 0.52, 0.12);
        r.add(lbl);
        childHitbox(st, 0.4, 0.65, 0.55, lx, 0.28, 0.05, { id: 'syrup', kind: k });
      });
    })();

    /* ---------- 휘핑크림 ---------- */
    (function whip() {
      const st = station('whip', '휘핑크림', 2.6, -4.3, 0.3, 0.35);
      const r = st.root;
      r.add(cyl(0.05, 0.05, 0.24, new THREE.MeshStandardMaterial({ color: 0xd9534f, roughness: 0.3, metalness: 0.5 }), 0, 0.12, 0, 14));
      r.add(cyl(0.012, 0.025, 0.07, M().cream, 0, 0.27, 0, 10));
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.11), textLabel('휘핑크림', 160, 52, '700 26px "Malgun Gothic"'));
      lbl.position.set(0, 0.42, 0.12);
      r.add(lbl);
      childHitbox(st, 0.4, 0.55, 0.55, 0, 0.22, 0.05, { id: 'whip' });
    })();

    /* ---------- 넉박스 (사용한 포터필터 가루 비우기) ---------- */
    (function knockbox() {
      const st = station('knockbox', '넉박스', 3.2, -4.3, 0.35, 0.4);
      const r = st.root;
      // 어두운 무광 통 + 위를 가로지르는 고무 바 — glb KnockBox로 교체(로드 시)
      const vis = new THREE.Group(); r.add(vis);
      decorVisual(vis, 'KnockBox', () => {
        const bar = cyl(0.014, 0.014, 0.26, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }), 0, 0.255, 0, 10);
        bar.rotation.z = Math.PI / 2;
        return [
          box(0.26, 0.22, 0.3, M().blackMatte, 0, 0.11, 0),
          cyl(0.13, 0.13, 0.03, M().steelDark, 0, 0.225, 0, 16),   // 상단 림
          bar,
        ];
      }, 0, 1.8);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), textLabel('넉박스', 160, 52, '700 28px "Malgun Gothic"'));
      lbl.position.set(0, 0.42, 0.12);
      r.add(lbl);
      childHitbox(st, 0.4, 0.5, 0.55, 0, 0.22, 0.05, { id: 'knockbox' });
    })();

    /* ---------- 에스프레소 샷잔 (유리) — 에스프레소 머신 옆, 재사용 무료 도구 ---------- */
    (function shotGlass() {
      const x = -3.34, z = -4.05, y = 1.42;   // 에스프레소 머신 갈색 작업 받침대 위 — 좌측
      const r = new THREE.Group();
      r.position.set(x, y, z);
      scene.add(r);
      // 투명 유리 샷잔 1개 (위가 살짝 넓은 텀블러 형태)
      const glass = cyl(0.03, 0.023, 0.075, M().cupClear, 0, 0.0415, 0, 18, { cast: false });
      r.add(glass);
      r.add(cyl(0.026, 0.026, 0.008, M().cupClear, 0, 0.004, 0, 18, { cast: false }));   // 두꺼운 유리 굽 (머신 상판 위 — 이름표 불필요)
      addI(hitbox(0.13, 0.18, 0.15, x, y + 0.07, z, { id: 'shotrack' })).userData.outlineRoot = r;   // 샷잔 크기에 맞게
    })();

    /* ---------- 탬핑 스테이션 (분쇄된 원두를 평평하게 다짐) ---------- */
    (function tampStation() {
      const st = station('tamp', '탬핑 스테이션', -4.2, -4.3, 0.4, 0.4);
      const r = st.root;
      // 탬핑 매트(고무 패드)
      r.add(box(0.34, 0.02, 0.3, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }), 0, 0.01, 0, { cast: false }));
      // 탬퍼: 스틸 베이스 + 넥 + 원목 손잡이 (매트 한쪽에 세워둠)
      const tamper = new THREE.Group();
      tamper.add(cyl(0.03, 0.03, 0.02, M().steel, 0, 0.01, 0, 16));       // 베이스(평평한 디스크)
      tamper.add(cyl(0.014, 0.014, 0.05, M().steelDark, 0, 0.045, 0, 12)); // 넥
      tamper.add(cyl(0.024, 0.028, 0.07, M().woodDark, 0, 0.105, 0, 14));  // 손잡이
      tamper.position.set(0.09, 0.04, -0.02);
      r.add(tamper);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), textLabel('탬핑', 160, 56, '700 32px "Malgun Gothic"'));
      lbl.position.set(0, 0.4, 0.12);
      r.add(lbl);
      const tamp = { tamper };   // 타이밍 미니게임 UI는 HUD에서 처리
      childHitbox(st, 0.42, 0.6, 0.55, 0, 0.2, 0.05, { id: 'tamp', tamp });
      env.machines.tamp = tamp;
    })();

    /* ---------- 쓰레기통 (바닥 기구) ---------- */
    (function trash() {
      // 백 카운터 우측 끝 '너머' 코너에 배치(이전엔 카운터 캐비닛 안에 박혀 가려졌고,
      // 그 앞 통로에 두니 동선을 막았다). 카운터는 x≤4.2에서 끝나므로 그 오른쪽(x4.6) 뒷벽쪽에
      // 두어 잘 보이면서도 작업 동선(aisle z>-3.65)을 막지 않게 한다.
      const tx = 4.6, tz = -4.4;
      const st = station('trash', '쓰레기통', tx, tz, 0.55, 0.55, { floor: true });
      const r = st.root;
      r.add(cyl(0.22, 0.18, 0.62, M().steelDark, 0, 0.31, 0, 16));
      r.add(cyl(0.23, 0.23, 0.04, M().blackMatte, 0, 0.64, 0, 16));
      childHitbox(st, 0.5, 0.9, 0.5, 0, 0.45, 0, { id: 'trash' });
      st.colliderRef = addCol(tx - 0.3, tx + 0.3, tz - 0.3, tz + 0.3);
    })();

    /* ---------- 창고 선반 (재고 보충) ---------- */
    (function storage() {
      // 창고: ShelvingRack(glb) 4개를 좌측 벽 앞에 나란히. glb 랙은 원점이 형상 중심에서 벗어나
      // 있어(90° 회전 시 형상중심 = spawn + (-0.2,-0.42)), "형상 중심(Cx,cz)"을 기준으로 잡고
      // 랙은 spawn(Cx+0.2, cz+0.42)에, 박스/히트박스는 (Cx,cz)에 둬 박스가 랙 중앙에 오게 한다.
      const Cx = -8.7;                                   // 랙 형상 중심 X(벽 앞)
      // 형상 중심 Z — 박스를 랙 중앙에 정렬 + 전체를 오른쪽(-z)으로 렉하나(1.1)만큼 민 값
      const kinds = [['beans', -4.32], ['milk', -3.22], ['cups', -2.12], ['dessert', -1.02]];
      addCol(Cx - 0.35, Cx + 0.35, -4.85, -0.55);        // 창고 구역 진입 차단
      kinds.forEach(([k, cz]) => {
        // 재고 박스(보급) — 랙 아래(0.65)·중간(1.2) 선반 중앙에 적재. 박스 원점=베이스, 라벨이 +X(작업영역) 향함
        const bm = makeBoxMesh(k);  bm.position.set(Cx, 0.65, cz);  bm.rotation.y = Math.PI / 2; scene.add(bm);
        const bm2 = makeBoxMesh(k); bm2.position.set(Cx, 1.20, cz); bm2.rotation.y = Math.PI / 2; bm2.scale.setScalar(0.9); scene.add(bm2);
        addI(hitbox(0.85, 1.8, 0.9, Cx, 0.95, cz, { id: 'restock', kind: k })).userData.outlineMeshes = [bm, bm2];
      });
      // ShelvingRack(폭0.9 Z·깊이0.44 X, 90° 회전 정면 +X) — 형상 중심이 (Cx,cz)에 오도록 spawn 보정
      if (window.Assets && window.Assets.ready) {
        window.Assets.ready.then(() => {
          kinds.forEach(([, cz]) => { const r = window.Assets.spawn('ShelvingRack', Cx + 0.2, cz + 0.42, 0, Math.PI / 2); if (r) scene.add(r); });
        }).catch(() => {});
      }
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), textLabel('창 고', 256, 64, '700 40px "Malgun Gothic"'));
      lbl.position.set(Cx + 0.4, 2.45, -2.6);            // 새 창고 중앙 부근(상단)
      lbl.rotation.y = Math.PI / 2;
      scene.add(lbl);
    })();

    /* ---------- 원두 그라인더 (구매 시 재사용되는 빌더) ---------- */
    function buildGrinder(id, x, z) {
      const st = station(id, '그라인더', x, z, 0.45, 0.5);
      const g = st.root;
      const vis = new THREE.Group(); g.add(vis);
      decorVisual(vis, 'CoffeeGrinder', () => [
        cyl(0.13, 0.15, 0.05, M().blackMatte, 0, 0.025, 0, 16),      // 받침
        box(0.2, 0.34, 0.22, M().blackMatte, 0, 0.22, 0),            // 본체
        box(0.16, 0.05, 0.18, M().steelDark, 0, 0.415, 0),          // 상단
        cyl(0.1, 0.07, 0.17, new THREE.MeshPhysicalMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.55, roughness: 0.1 }), 0, 0.53, 0, 14),   // 호퍼
        cyl(0.072, 0.05, 0.1, new THREE.MeshStandardMaterial({ color: 0x3e2814, roughness: 0.95 }), 0, 0.5, 0, 12),   // 호퍼 속 원두
        cyl(0.11, 0.11, 0.02, M().blackMatte, 0, 0.625, 0, 14),      // 뚜껑
        box(0.05, 0.06, 0.08, M().steelDark, 0, 0.3, 0.13),          // 배출구
        box(0.12, 0.02, 0.1, M().steel, 0, 0.12, 0.13),            // 포터필터 받침
      ], 0, 1.0);
      const glbl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.13), textLabel('그라인더', 192, 56, '700 30px "Malgun Gothic"'));
      glbl.position.set(0, 0.78, 0.18);
      g.add(glbl);
      // 삽입된 포터필터가 받침 위에 표시됨 (초기엔 숨김)
      const pfOut = makePortafilterMesh('none');
      pfOut.position.set(0, 0.17, 0.15);   // 배출 깔때기(outlet ~y0.27) 바로 아래에 바스켓이 오도록
      g.add(pfOut);
      const job = {
        kind: 'grinder',
        st, pfMesh: pfOut, hasPf: false,
        progress: makeProgress(g, 0, 0.34, 0.15),   // 분쇄 중인 포터필터 바로 위
        busy: false, done: false, t: 0, dur: 0, sound: null
      };
      childHitbox(st, 0.42, 0.85, 0.6, 0, 0.35, 0.05, { id: 'grinder', job });
      env.machines.grinderJobs.push(job);
      return st;
    }
    buildGrinder('grinder', -6.95, -4.3);

    /* 구매로 추가 머신을 만들 수 있도록 빌더와 빈자리 탐색기 노출 */
    env.builders = { grinder: buildGrinder, steamer: buildSteamer, espresso: buildEspresso };
    env.findFreeSpot = function (w, d) {
      const fp = (cx, cz, fw, fd) => ({ x0: cx - fw / 2, x1: cx + fw / 2, z0: cz - fd / 2, z1: cz + fd / 2 });
      const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
      const occupied = (cx, cz) => {
        const me = fp(cx, cz, w + 0.05, d + 0.05);
        for (const s of env.stations) {
          if (s.floor) continue;
          const rot = s.rotY % 180 !== 0;
          if (overlap(me, fp(s.root.position.x, s.root.position.z, rot ? s.d : s.w, rot ? s.w : s.d))) return true;
        }
        for (const b of env.staticBlockers) if (overlap(me, fp(b.x, b.z, b.w, b.d))) return true;
        return false;
      };
      // 백 카운터(z=-4.3) → 앞 카운터(z=-1.0) 순으로 빈 칸 탐색
      for (const cz of [-4.3, -1.0]) {
        for (let cx = -6.9; cx <= 3.9; cx += 0.2) {
          if (cx - w / 2 < -7.0 || cx + w / 2 > 4.0) continue;
          if (!occupied(cx, cz)) return { x: Math.round(cx * 20) / 20, z: cz };
        }
      }
      return null;
    };

    env.clearDeliveryBoxes = function () {
      env.deliveryViews.forEach(v => {
        scene.remove(v.mesh);
        scene.remove(v.hitbox);
        const i = env.interactables.indexOf(v.hitbox);
        if (i >= 0) env.interactables.splice(i, 1);
      });
      env.deliveryViews = [];
    };
    env.syncDeliveryBoxes = function (boxes) {
      env.clearDeliveryBoxes();
      const spots = [[5.05, 9.35], [5.95, 9.35], [5.05, 10.05], [5.95, 10.05]];
      boxes.slice(0, spots.length).forEach((b, i) => {
        const [x, z] = spots[i];
        const mesh = makeBoxMesh(b.kind);
        mesh.position.set(x, 0, z);
        mesh.scale.setScalar(1.25);
        scene.add(mesh);
        const hb = hitbox(0.68, 0.52, 0.55, x, 0.28, z, { id: 'deliveryBox', boxId: b.id });
        hb.userData.outlineRoot = mesh;
        addI(hb);
        env.deliveryViews.push({ id: b.id, mesh, hitbox: hb });
      });
    };

    /* ---------- 장식 ---------- */
    (function deco() {
      // 뒷벽 선반 + 원두 항아리
      scene.add(box(3.6, 0.05, 0.3, M().woodLight, -7.0, 2.0, -4.95));
      scene.add(box(3.6, 0.05, 0.3, M().woodLight, 6.8, 2.0, -4.95));
      for (let i = 0; i < 5; i++) {
        const jx = -8.5 + i * 0.75;
        scene.add(cyl(0.1, 0.09, 0.26, new THREE.MeshPhysicalMaterial({
          color: 0x8a6a42, transparent: true, opacity: 0.75, roughness: 0.1
        }), jx, 2.16, -4.95, 12));
        scene.add(cyl(0.105, 0.105, 0.03, M().woodDark, jx, 2.3, -4.95, 12, { cast: false }));
      }
      for (let i = 0; i < 4; i++)
        scene.add(cyl(0.055, 0.045, 0.1, M().cupWhite, 5.6 + i * 0.55, 2.08, -4.95, 12, { cast: false }));
      // 오른쪽 벽 액자
      [[2.2, '☕'], [4.6, '♥'], [7.0, '✦']].forEach(([z, ch]) => {
        const [c, cx2] = TEX.canvas(128, 160);
        cx2.fillStyle = '#efe6d2'; cx2.fillRect(0, 0, 128, 160);
        cx2.font = '64px Georgia'; cx2.textAlign = 'center'; cx2.fillStyle = '#8a5f3a';
        cx2.fillText(ch, 64, 95);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        const art = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.75),
          new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
        art.position.set(8.95, 2.2, z); art.rotation.y = -Math.PI / 2;
        scene.add(art);
        scene.add(box(0.04, 0.85, 0.7, M().woodDark, 8.99, 2.2, z, { cast: false }));
      });
    })();

    /* 정적 데코: 절차적로 먼저 그리고, glb 로드되면 그 자리에서 교체 (surface·collider는 호출부에서 유지) */
    function decorVisual(parent, glbName, procFn, rotY = 0, scale = 1) {
      const proc = procFn();
      proc.forEach(m => parent.add(m));
      if (window.Assets && window.Assets.ready) {
        window.Assets.ready.then(() => {
          const m = window.Assets.spawn(glbName, 0, 0, 0, rotY);
          if (!m) return;
          if (scale !== 1) m.scale.multiplyScalar(scale);
          // 베이스를 부모 원점(카운터 상판/바닥)에 정확히 안착시킨다. glb 원점이
          // 베이스가 아니어도(스케일·회전 적용 후 측정) 바닥이 카운터에 파묻히거나
          // 뜨지 않게 함 — 기능 앵커(포터필터·스파웃 등)와 시각물 정렬을 일치시킨다.
          m.position.set(0, 0, 0);
          m.updateMatrixWorld(true);
          const bb = new THREE.Box3().setFromObject(m);
          if (isFinite(bb.min.y)) m.position.y = -bb.min.y;
          proc.forEach(pm => parent.remove(pm));
          parent.add(m);
        }).catch(() => {});
      }
    }

    /* ---------- 좌석 (테이블 · 의자 · 소파) ---------- */
    (function seating() {
      function table(x, z) {
        // 배치 표면: 투명 디스크(레이캐스트 전용) — glb 상판 높이(0.75)에 맞춤
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.02, 24),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        top.position.set(x, 0.74, z); top.castShadow = top.receiveShadow = false;
        scene.add(top); env.surfaces.push(top);
        addCol(x - 0.5, x + 0.5, z - 0.5, z - 0.5 + 1.0);
        // 비주얼: glb CafeTable(로드 시) 또는 절차적 폴백
        const vis = new THREE.Group(); vis.position.set(x, 0, z); scene.add(vis);
        decorVisual(vis, 'CafeTable', () => [
          cyl(0.45, 0.45, 0.04, M().marble, 0, 0.73, 0, 24),
          cyl(0.035, 0.035, 0.72, M().steelDark, 0, 0.37, 0, 12),
          cyl(0.22, 0.26, 0.03, M().steelDark, 0, 0.015, 0, 16),
        ]);
      }
      function chair(x, z, ry) {
        const g = new THREE.Group();
        g.position.set(x, 0, z); g.rotation.y = ry;
        decorVisual(g, 'CafeChair', () => {
          const p = [];
          p.push(box(0.4, 0.05, 0.4, M().woodMid, 0, 0.46, 0));
          p.push(box(0.4, 0.5, 0.05, M().woodMid, 0, 0.73, -0.18));
          [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].forEach(([lx, lz]) =>
            p.push(cyl(0.02, 0.02, 0.46, M().woodDark, lx, 0.23, lz, 8)));
          return p;
        });
        scene.add(g);
      }
      table(-5.2, 3.2); chair(-5.2, 2.45, 0); chair(-5.2, 3.95, Math.PI);
      table(-1.6, 4.9); chair(-2.35, 4.9, Math.PI / 2); chair(-0.85, 4.9, -Math.PI / 2);
      table(7.0, 2.6); chair(7.0, 1.85, 0);
      // 창가 벤치
      scene.add(box(6.5, 0.45, 0.55, M().woodMid, -4.5, 0.225, 7.45));
      const benchTop = box(6.5, 0.12, 0.5, M().sofa, -4.5, 0.51, 7.45, { cast: false });
      scene.add(benchTop); env.surfaces.push(benchTop);
      addCol(-7.8, -1.2, 7.1, 7.8);
      // 러그
      const rug = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), M().rug);
      rug.rotation.x = -Math.PI / 2; rug.position.set(-4.8, 0.012, 3.4);
      rug.receiveShadow = true; rug.castShadow = false;
      scene.add(rug);
    })();

    /* ---------- 화분 ---------- */
    function plant(x, z, s = 1) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.scale.setScalar(s);
      decorVisual(g, 'PottedPlant', () => {
        const p = [];
        p.push(cyl(0.2, 0.15, 0.35, M().pot, 0, 0.175, 0, 12));
        p.push(cyl(0.18, 0.18, 0.04, new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1 }), 0, 0.36, 0, 12, { cast: false }));
        const r = TEX.rng((x * 13 + z * 7 + 100) | 0);
        for (let i = 0; i < 7; i++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1 + r() * 0.08, 0.5 + r() * 0.45, 6), r() > 0.5 ? M().plant : M().plantDark);
          const a = r() * Math.PI * 2, d = r() * 0.1;
          leaf.position.set(Math.cos(a) * d, 0.55 + r() * 0.25, Math.sin(a) * d);
          leaf.rotation.set((r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7);
          p.push(leaf);
        }
        return p;
      });
      scene.add(g);
      addCol(x - 0.25 * s, x + 0.25 * s, z - 0.25 * s, z + 0.25 * s);
    }
    plant(8.2, -4.2, 1.25); plant(-8.2, 7.0, 1.1); plant(8.3, 7.2, 1.0); plant(4.2, -0.2, 0.7);

    /* ---------- 내려놓기 표시 (파란 반투명 인디케이터) ---------- */
    (function placeIndicator() {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24),
        new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.35, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.155, 28),
        new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      g.add(disc, ring);
      g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; o.renderOrder = 4; } });
      g.visible = false;
      scene.add(g);
      env.placeIndicator = g;
    })();

    /* ---------- 조준 중인 상호작용 대상 아웃라인 (빛나는 외곽선 박스) ---------- */
    (function aimHighlight() {
      const hi = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
      );
      hi.renderOrder = 7;
      hi.frustumCulled = false;
      hi.visible = false;
      scene.add(hi);
      env.aimHighlight = hi;
    })();

    /* ---------- 조명 ---------- */
    (function lights() {
      const hemi = new THREE.HemisphereLight(0xfff4e0, 0x4a3826, 0.55);
      scene.add(hemi); env.hemi = hemi;   // 날씨 모듈이 흐림·비에 환경광을 낮춤
      const sun = new THREE.DirectionalLight(0xffeed0, 3.0);
      sun.position.set(7, 11, 17);
      sun.target.position.set(-1, 0, -1);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;   // 해가 하루 동안 동→서로 움직여 범위를 넓힘
      sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
      sun.shadow.camera.near = 2; sun.shadow.camera.far = 55;
      sun.shadow.bias = -0.0004;
      scene.add(sun, sun.target);
      env.sun = sun;

      // 펜던트 조명 (메인 카운터 위 3개)
      [-4.8, -0.6, 2.5].forEach((x, i) => {
        const g = new THREE.Group();
        g.position.set(x, 0, -0.2);
        g.add(cyl(0.012, 0.012, 1.25, M().blackMatte, 0, ROOM.h - 0.7, 0, 6, { cast: false }));
        const shade = cyl(0.06, 0.26, 0.24, new THREE.MeshStandardMaterial({
          color: 0x2a2520, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide
        }), 0, ROOM.h - 1.4, 0, 18, { open: true, cast: false }); // 태양광 그림자 블롭 방지
        g.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12),
          new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb55e, emissiveIntensity: 3.2 }));
        bulb.position.y = ROOM.h - 1.48;
        g.add(bulb);
        const pl = new THREE.PointLight(0xffc98a, 10, 8, 2);
        pl.position.y = ROOM.h - 1.55;
        if (i === 1) { pl.castShadow = true; pl.shadow.mapSize.set(512, 512); }
        g.add(pl);
        scene.add(g);
      });
      // 작업 구역 조명
      [-5.5, -2.0, 1.5].forEach(x => {
        const pl = new THREE.PointLight(0xffe8c8, 7, 7, 2);
        pl.position.set(x, ROOM.h - 0.5, -4.0);
        scene.add(pl);
        const fix = cyl(0.12, 0.16, 0.08, M().blackMatte, x, ROOM.h - 0.18, -4.0, 14, { cast: false });
        scene.add(fix);
      });
      // 좌석 무드등
      const warm = new THREE.PointLight(0xffb87a, 5, 9, 2);
      warm.position.set(-4.5, 2.6, 4.5);
      scene.add(warm);
    })();

    return env;
  }

  return { build, makeDrinkMesh, makeDessertMesh, makeBoxMesh, makePitcherMesh, makePortafilterMesh, setPortafilterState, setPortafilterFill, makeBrewLiquid, setBrewFill, drinkColor, ROOM };
})();
