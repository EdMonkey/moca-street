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
    let c = new THREE.Color(d.milk ? 0xc89a6b : (d.water ? 0x3a2410 : 0x2b1708));
    if (d.syrup) c.lerp(new THREE.Color(SYRUP_TINT[d.syrup]), 0.45);
    return c.getHex();
  }

  // drink: {cup:'hot'|'ice'|'espresso', ice, espresso, water, milk, foam, syrup, whip}
  function makeDrinkMesh(drink) {
    const g = new THREE.Group();
    const isIce = drink.cup === 'ice';
    const isEsp = drink.cup === 'espresso';
    const H = isIce ? 0.16 : isEsp ? 0.06 : 0.12;
    const R = isIce ? 0.05 : isEsp ? 0.032 : 0.052;
    const base = isEsp ? 0.01 : 0;              // 데미타세는 받침접시 위에 올라감
    const cupMat = isIce ? M().cupClear : M().cupWhite;
    if (isEsp) { // 받침접시
      const saucer = cyl(0.052, 0.04, 0.009, M().cupWhite, 0, 0.0045, 0, 18);
      saucer.castShadow = false;
      g.add(saucer);
    }
    const cup = cyl(R, R * 0.78, H, cupMat, 0, base + H / 2, 0, 20);
    cup.castShadow = false;
    g.add(cup);
    if (!isIce) { // 손잡이 (머그/데미타세)
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(isEsp ? 0.016 : 0.03, isEsp ? 0.005 : 0.008, 8, 16), M().cupWhite);
      handle.position.set(R + (isEsp ? 0.007 : 0.012), base + H / 2, 0);
      g.add(handle);
    }
    const filled = drink.espresso || drink.water || drink.milk;
    if (filled) {
      const fillH = H * 0.74;
      const liq = cyl(R * 0.86, R * 0.7, fillH, new THREE.MeshStandardMaterial({
        color: drinkColor(drink), roughness: 0.15
      }), 0, base + fillH / 2 + 0.008, 0, 16);
      liq.castShadow = false;
      g.add(liq);
      // 크레마 (순수 에스프레소 샷일 때)
      if (drink.espresso && !drink.milk && !drink.water) {
        const crema = cyl(R * 0.84, R * 0.84, 0.005, new THREE.MeshStandardMaterial({
          color: 0xc4924e, roughness: 0.5
        }), 0, base + fillH + 0.01, 0, 14);
        crema.castShadow = false;
        g.add(crema);
      }
    }
    if (drink.ice) {
      for (let i = 0; i < 3; i++) {
        const ic = box(0.022, 0.022, 0.022, M().ice, (i - 1) * 0.02, H * 0.78, (i % 2 - 0.5) * 0.03);
        ic.rotation.set(i, i * 2, 0); ic.castShadow = false;
        g.add(ic);
      }
    }
    if (drink.foam) {
      const fo = cyl(R * 0.84, R * 0.84, 0.018, M().milkLiquid, 0, base + H * 0.8, 0, 16);
      fo.castShadow = false; g.add(fo);
    }
    if (drink.whip) {
      const wh = cyl(0.012, R * 0.7, 0.05, M().milkLiquid, 0, base + H * 0.86 + 0.025, 0, 12);
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
    used: new THREE.MeshStandardMaterial({ color: 0x241307, roughness: 0.95 }),
  };

  // 포터필터 (손에 들기 / 머신 장착 / 그라인더 공용) — 상태: empty | filled | used
  function makePortafilterMesh(state = 'filled') {
    const g = new THREE.Group();
    const basket = cyl(0.052, 0.045, 0.05, M().steelDark, 0, 0, 0, 14);
    const grounds = cyl(0.045, 0.045, 0.014, GROUNDS_MAT.filled, 0, 0.028, 0, 12);
    const handle = cyl(0.017, 0.02, 0.17, M().woodDark, 0, 0, 0.135, 10);
    handle.rotation.x = Math.PI / 2;
    const spout = cyl(0.012, 0.018, 0.045, M().steel, 0, -0.045, 0.04, 8);
    g.add(basket, grounds, handle, spout);
    g.userData.grounds = grounds;
    setPortafilterState(g, state);
    return g;
  }

  // 포터필터 메시의 상태별 표시 갱신
  //   none  → 그룹 자체를 숨김(장착 안 됨)
  //   empty → 보이되 원두가루 숨김
  //   filled/used → 보이고 가루 색을 상태에 맞게 교체
  function setPortafilterState(group, state) {
    const grounds = group.userData.grounds;
    if (state === 'none') { group.visible = false; return; }
    group.visible = true;
    if (grounds) {
      grounds.visible = (state !== 'empty');
      grounds.material = GROUNDS_MAT[state === 'used' ? 'used' : 'filled'];
    }
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
      machines: {}, steamEmitters: [],
      registerPos: new THREE.Vector3(2.5, 1.0, -1.0),
      pickupPos: new THREE.Vector3(-0.6, 1.0, -1.0),
      doorPos: new THREE.Vector3(5.5, 0, 8),
      spawnPos: new THREE.Vector3(5.5, 0, 11),
      queueSpots: [[2.5, 0.25], [2.5, 1.5], [2.5, 2.75], [2.5, 4.0], [2.5, 5.2]],
      pickupSpots: [[-0.6, 0.35], [-1.8, 0.5], [-3.0, 0.4], [-1.2, 1.6]],
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
      s.scale.set(0.4, 0.1, 1);
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
      scene.add(box(18, 0.9, 0.25, M().counterWoodDark, 0, 0.45, z));      // 하단 패널
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
      // 출입문(항상 열린 상태로 비스듬히)
      scene.add(box(0.14, ROOM.h, 0.2, M().woodDark, 4.7, ROOM.h / 2, z));
      scene.add(box(0.14, ROOM.h, 0.2, M().woodDark, 6.3, ROOM.h / 2, z));
      const door = new THREE.Group();
      const dframe = box(0.74, 2.6, 0.06, M().woodDark, 0.37, 1.3, 0);
      const dglass = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 2.1), M().glass);
      dglass.position.set(0.37, 1.45, 0.04);
      const knob = cyl(0.02, 0.02, 0.12, M().steel, 0.66, 1.25, 0.05, 10);
      knob.rotation.x = Math.PI / 2;
      door.add(dframe, dglass, knob);
      door.position.set(4.75, 0, z - 0.1);
      door.rotation.y = -0.9;
      scene.add(door);
      // OPEN 팻말
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), textLabel('OPEN', 160, 80, '700 44px Georgia', '#7fb069', '#23291f'));
      sign.position.set(5.5, 2.35, z - 0.15); sign.rotation.y = Math.PI;
      scene.add(sign);
    })();

    // 충돌: 외벽 + 앞벽(문 구간 제외 — 손님만 통과, 플레이어도 영업중엔 매장 안에)
    addCol(ROOM.x0 - 1, ROOM.x0, ROOM.z0 - 1, ROOM.z1 + 1);
    addCol(ROOM.x1, ROOM.x1 + 1, ROOM.z0 - 1, ROOM.z1 + 1);
    addCol(ROOM.x0 - 1, ROOM.x1 + 1, ROOM.z0 - 1, ROOM.z0);
    addCol(ROOM.x0 - 1, ROOM.x1 + 1, ROOM.z1, ROOM.z1 + 1);

    /* ---------- 외부 거리 ---------- */
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), M().backdrop);
    bd.position.set(0, 10, 26); bd.rotation.y = Math.PI;
    bd.castShadow = bd.receiveShadow = false;
    scene.add(bd);
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(70, 18),
      new THREE.MeshStandardMaterial({ color: 0x9a9288, roughness: 0.95 }));
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(0, -0.01, 17);
    sidewalk.receiveShadow = true;
    scene.add(sidewalk);

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
      const body = box(0.4, 0.12, 0.34, M().blackMatte, 0, 0.06, 0);
      const screen = box(0.36, 0.26, 0.03, M().blackMatte, 0, 0.3, -0.06);
      screen.rotation.x = -0.25;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x9adfff, emissive: 0x3a8aaa, emissiveIntensity: 0.9 }));
      scr.position.set(0, 0.305, -0.03); scr.rotation.x = -0.25;
      g.add(body, screen, scr);
      scene.add(g);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), textLabel('ORDER', 256, 70, '700 44px Georgia', '#e8b86d'));
      sign.position.set(2.5, 1.95, -0.9);
      scene.add(sign);
      const cord1 = cyl(0.01, 0.01, 0.6, M().blackMatte, 2.3, 2.36, -0.9, 6, { cast: false });
      const cord2 = cyl(0.01, 0.01, 0.6, M().blackMatte, 2.7, 2.36, -0.9, 6, { cast: false });
      scene.add(cord1, cord2);
      addI(hitbox(0.9, 0.9, 0.8, 2.5, 1.3, -1.0, { id: 'register' }));
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
      addI(hitbox(1.6, 0.8, 0.7, -0.6, 1.35, -1.0, { id: 'pickup' }));
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
        addI(hitbox(0.55, 0.6, 0.7, dx, 1.35, -1.0, { id: 'dessert', kind: k }));
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
      r.add(box(0.62, 0.5, 0.55, M().steel, 0, 0.25, 0));
      r.add(box(0.56, 0.1, 0.46, M().steelDark, 0, 0.52, 0));
      // 얼음 보이는 개구부
      r.add(box(0.46, 0.18, 0.06, M().blackMatte, 0, 0.18, 0.28, { cast: false }));
      for (let i = 0; i < 6; i++)
        r.add(box(0.05, 0.05, 0.05, M().ice, -0.15 + (i % 3) * 0.15, 0.16 + Math.floor(i / 3) * 0.05, 0.27 + (i % 2) * 0.02, { cast: false }));
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), textLabel('얼음', 192, 60, '700 32px "Malgun Gothic"'));
      lbl.position.set(0, 0.68, 0.3);
      r.add(lbl);
      childHitbox(st, 0.65, 0.7, 0.6, 0, 0.3, 0.1, { id: 'ice' });
    })();

    /* ---------- 에스프레소 머신 (메인) ---------- */
    (function espresso() {
      const st = station('espresso', '에스프레소 머신', -3.1, -4.25, 1.45, 0.8);
      const g = st.root;
      const body = box(1.25, 0.52, 0.58, M().steel, 0, 0.33, 0);
      const topTray = box(1.27, 0.05, 0.6, M().steelDark, 0, 0.62, 0);
      const front = box(1.1, 0.26, 0.04, M().blackMatte, 0, 0.4, 0.3);
      g.add(body, topTray, front);
      // 원목 사이드 패널(본체 측면과 동일 평면 회피: 안쪽 면을 본체 내부로) + 상단 레일
      g.add(box(0.06, 0.5, 0.56, M().woodDark, -0.64, 0.33, 0));
      g.add(box(0.06, 0.5, 0.56, M().woodDark, 0.64, 0.33, 0));
      g.add(box(1.29, 0.02, 0.04, M().steel, 0, 0.66, 0.28, { cast: false }));
      // 브랜드 플레이트
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.07),
        textLabel('MOCHA ST.', 256, 52, 'italic 700 30px Georgia', '#e8b86d', '#1c1815'));
      plate.position.set(0, 0.55, 0.335);
      g.add(plate);
      // 크롬 그룹 커버(전면 패널 면 0.32보다 앞으로 빼서 z-fighting 방지)
      [-0.3, 0.3].forEach(ox => g.add(box(0.2, 0.14, 0.12, M().steel, ox, 0.42, 0.27)));
      // 상단 데코 컵들 (트레이 윗면과 동일 평면 회피)
      for (let i = 0; i < 4; i++)
        g.add(cyl(0.045, 0.038, 0.07, M().cupWhite, -0.45 + i * 0.3, 0.684, 0, 12, { cast: false }));
      // 그룹헤드 2개 + 장착식 포터필터 + 드립트레이
      // 그룹헤드를 충분히 높여(y 0.30) 아이스컵(0.16m)도 추출구 아래에 들어가게 함
      env.machines.espressoSlots = [];
      [-0.3, 0.3].forEach((ox, i) => {
        g.add(cyl(0.07, 0.08, 0.1, M().steelDark, ox, 0.30, 0.26, 14));            // 그룹헤드
        // 포터필터(기본 '빈' 상태로 장착되어 있음)
        const pf = makePortafilterMesh('empty');
        pf.position.set(ox, 0.235, 0.26);
        g.add(pf);
        // 추출 중 커피 줄기(애니메이션용)
        const stream = cyl(0.006, 0.006, 0.12, M().coffeeLiquid, ox, 0.1, 0.3, 6, { cast: false });
        stream.visible = false;
        g.add(stream);
        env.machines.espressoSlots.push({
          st, localPos: new THREE.Vector3(ox, 0.03, 0.3),
          progress: makeProgress(g, ox, 0.52, 0.42),
          stream, pf, pfState: 'empty', busy: false, cupMesh: null, done: false, drink: null, t: 0
        });
      });
      const drip = box(0.9, 0.025, 0.3, M().steelDark, 0, 0.016, 0.3);
      g.add(drip);
      // 압력 게이지 (다이얼 페이스) + 전원 LED
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
      g.add(gauge, gring, led);
      // 스팀 분출구(장식)
      const pipe = cyl(0.018, 0.018, 0.3, M().steel, 0.68, 0.3, 0.1, 8);
      pipe.rotation.z = 0.5;
      g.add(pipe);
      env.machines.espressoGroup = g;
      env.steamEmitters.push({ st, local: new THREE.Vector3(0, 0.66, 0) });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), textLabel('에스프레소 머신', 320, 60, '700 30px "Malgun Gothic"'));
      lbl.position.set(0, 0.85, 0.25);
      g.add(lbl);
      childHitbox(st, 0.62, 0.75, 0.75, -0.3, 0.3, 0.1, { id: 'espresso', slot: 0 });
      childHitbox(st, 0.62, 0.75, 0.75, 0.3, 0.3, 0.1, { id: 'espresso', slot: 1 });
    })();

    /* ---------- 밀크 스티머 ---------- */
    (function steamer() {
      const st = station('steamer', '밀크 스티머', -1.7, -4.3, 0.62, 0.55);
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
      env.steamEmitters.push({ st, local: new THREE.Vector3(0.2, 0.2, 0.15) });
      childHitbox(st, 0.6, 0.7, 0.6, 0, 0.3, 0.05, { id: 'steamer' });
      env.machines.steamerJob = {
        kind: 'steamer',
        st, localPos: new THREE.Vector3(0.2, 0, 0.22),
        progress: makeProgress(g, 0, 0.72, 0.18),
        busy: false, done: false, t: 0, dur: 0, drink: null, cupMesh: null, makingFoam: false, sound: null
      };
    })();

    /* ---------- 온수/냉수 디스펜서 ---------- */
    env.machines.waterJobs = {};
    (function water() {
      [['waterHot', -0.55, '온수', 0xd9534f], ['waterCold', 0.15, '냉수', 0x5a9adf]].forEach(([id, x, name, dot]) => {
        const st = station(id, name + ' 디스펜서', x, -4.3, 0.32, 0.35);
        const r = st.root;
        r.add(box(0.22, 0.5, 0.24, M().steel, 0, 0.25, 0));
        const spout = cyl(0.014, 0.014, 0.14, M().steelDark, 0, 0.32, 0.16, 8);
        spout.rotation.x = 0.9;
        r.add(spout);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8),
          new THREE.MeshStandardMaterial({ color: dot, emissive: dot, emissiveIntensity: 1.2 }));
        led.position.set(0, 0.42, 0.13);
        r.add(led);
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), textLabel(name, 128, 56, '700 30px "Malgun Gothic"'));
        lbl.position.set(0, 0.6, 0.15);
        r.add(lbl);
        childHitbox(st, 0.32, 0.7, 0.55, 0, 0.3, 0.1, { id });
        env.machines.waterJobs[id] = {
          kind: 'water', waterType: id === 'waterHot' ? 'hot' : 'cold',
          st, localPos: new THREE.Vector3(0, 0, 0.22),
          progress: makeProgress(r, 0, 0.68, 0.18),
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
      // 어두운 무광 통 + 위를 가로지르는 고무 바
      r.add(box(0.26, 0.22, 0.3, M().blackMatte, 0, 0.11, 0));
      r.add(cyl(0.13, 0.13, 0.03, M().steelDark, 0, 0.225, 0, 16));        // 상단 림
      const bar = cyl(0.014, 0.014, 0.26, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }), 0, 0.255, 0, 10);
      bar.rotation.z = Math.PI / 2;
      r.add(bar);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), textLabel('넉박스', 160, 52, '700 28px "Malgun Gothic"'));
      lbl.position.set(0, 0.42, 0.12);
      r.add(lbl);
      childHitbox(st, 0.4, 0.5, 0.55, 0, 0.22, 0.05, { id: 'knockbox' });
    })();

    /* ---------- 쓰레기통 (바닥 기구) ---------- */
    (function trash() {
      const st = station('trash', '쓰레기통', 3.6, -4.1, 0.55, 0.55, { floor: true });
      const r = st.root;
      r.add(cyl(0.22, 0.18, 0.62, M().steelDark, 0, 0.31, 0, 16));
      r.add(cyl(0.23, 0.23, 0.04, M().blackMatte, 0, 0.64, 0, 16));
      childHitbox(st, 0.5, 0.9, 0.5, 0, 0.45, 0, { id: 'trash' });
      st.colliderRef = addCol(3.6 - 0.3, 3.6 + 0.3, -4.1 - 0.3, -4.1 + 0.3);
    })();

    /* ---------- 창고 선반 (재고 보충) ---------- */
    (function storage() {
      const x = -8.55;
      scene.add(box(0.7, 2.2, 4.6, M().woodDark, x, 1.1, -1.2));
      const shelf1 = box(0.75, 0.06, 4.7, M().woodLight, x, 0.7, -1.2, { cast: false });
      const shelf2 = box(0.75, 0.06, 4.7, M().woodLight, x, 1.5, -1.2, { cast: false });
      scene.add(shelf1, shelf2);
      env.surfaces.push(shelf1, shelf2);
      addCol(x - 0.5, x + 0.5, -3.6, 1.2);
      const kinds = [['beans', -2.8], ['milk', -1.7], ['cups', -0.6], ['dessert', 0.5]];
      kinds.forEach(([k, z]) => {
        const bm = makeBoxMesh(k);
        bm.position.set(x + 0.12, 0.73, z);
        bm.rotation.y = Math.PI / 2;
        scene.add(bm);
        const bm2 = makeBoxMesh(k);
        bm2.position.set(x + 0.12, 1.53, z);
        bm2.rotation.y = Math.PI / 2;
        bm2.scale.setScalar(0.9);
        scene.add(bm2);
        addI(hitbox(0.8, 1.6, 0.9, x, 1.2, z, { id: 'restock', kind: k }));
      });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), textLabel('창 고', 256, 64, '700 40px "Malgun Gothic"'));
      lbl.position.set(x + 0.4, 2.45, -1.2);
      lbl.rotation.y = Math.PI / 2;
      scene.add(lbl);
    })();

    /* ---------- 원두 그라인더 (분쇄 → 포터필터) ---------- */
    (function grinder() {
      const st = station('grinder', '그라인더', -6.95, -4.3, 0.45, 0.5);
      const g = st.root;
      g.add(cyl(0.13, 0.15, 0.05, M().blackMatte, 0, 0.025, 0, 16));      // 받침
      g.add(box(0.2, 0.34, 0.22, M().blackMatte, 0, 0.22, 0));            // 본체
      g.add(box(0.16, 0.05, 0.18, M().steelDark, 0, 0.415, 0));           // 상단
      const hopper = cyl(0.1, 0.07, 0.17, new THREE.MeshPhysicalMaterial({
        color: 0x8a6a48, transparent: true, opacity: 0.55, roughness: 0.1
      }), 0, 0.53, 0, 14);
      g.add(hopper);
      g.add(cyl(0.072, 0.05, 0.1, new THREE.MeshStandardMaterial({ color: 0x3e2814, roughness: 0.95 }), 0, 0.5, 0, 12)); // 호퍼 속 원두
      g.add(cyl(0.11, 0.11, 0.02, M().blackMatte, 0, 0.625, 0, 14));      // 뚜껑
      g.add(box(0.05, 0.06, 0.08, M().steelDark, 0, 0.3, 0.13));          // 배출구
      g.add(box(0.12, 0.02, 0.1, M().steel, 0, 0.12, 0.13));              // 포터필터 받침
      const glbl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.13), textLabel('그라인더', 192, 56, '700 30px "Malgun Gothic"'));
      glbl.position.set(0, 0.78, 0.18);
      g.add(glbl);
      childHitbox(st, 0.42, 0.85, 0.6, 0, 0.35, 0.05, { id: 'grinder' });
      // 삽입된 포터필터가 받침 위에 표시됨 (초기엔 숨김)
      const pfOut = makePortafilterMesh('none');
      pfOut.position.set(0, 0.145, 0.13);
      g.add(pfOut);
      env.machines.grinderJob = {
        kind: 'grinder',
        st, pfMesh: pfOut, hasPf: false,
        progress: makeProgress(g, 0, 0.68, 0.22),
        busy: false, done: false, t: 0, dur: 0, sound: null
      };
    })();

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

    /* ---------- 좌석 (테이블 · 의자 · 소파) ---------- */
    (function seating() {
      function table(x, z) {
        const top = cyl(0.45, 0.45, 0.04, M().marble, x, 0.78, z, 24);
        scene.add(top); env.surfaces.push(top);
        scene.add(cyl(0.035, 0.035, 0.76, M().steelDark, x, 0.39, z, 12));
        scene.add(cyl(0.22, 0.26, 0.03, M().steelDark, x, 0.015, z, 16));
        addCol(x - 0.5, x + 0.5, z - 0.5, z - 0.5 + 1.0);
      }
      function chair(x, z, ry) {
        const g = new THREE.Group();
        g.position.set(x, 0, z); g.rotation.y = ry;
        g.add(box(0.4, 0.05, 0.4, M().woodMid, 0, 0.46, 0));
        g.add(box(0.4, 0.5, 0.05, M().woodMid, 0, 0.73, -0.18));
        [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].forEach(([lx, lz]) =>
          g.add(cyl(0.02, 0.02, 0.46, M().woodDark, lx, 0.23, lz, 8)));
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
      g.add(cyl(0.2, 0.15, 0.35, M().pot, 0, 0.175, 0, 12));
      g.add(cyl(0.18, 0.18, 0.04, new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1 }), 0, 0.36, 0, 12, { cast: false }));
      const r = TEX.rng((x * 13 + z * 7 + 100) | 0);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1 + r() * 0.08, 0.5 + r() * 0.45, 6), r() > 0.5 ? M().plant : M().plantDark);
        const a = r() * Math.PI * 2, d = r() * 0.1;
        leaf.position.set(Math.cos(a) * d, 0.55 + r() * 0.25, Math.sin(a) * d);
        leaf.rotation.set((r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7);
        g.add(leaf);
      }
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

    /* ---------- 조명 ---------- */
    (function lights() {
      scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a3826, 0.55));
      const sun = new THREE.DirectionalLight(0xffeed0, 3.0);
      sun.position.set(7, 11, 17);
      sun.target.position.set(-1, 0, -1);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
      sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
      sun.shadow.camera.near = 2; sun.shadow.camera.far = 45;
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

  return { build, makeDrinkMesh, makeDessertMesh, makeBoxMesh, makePortafilterMesh, setPortafilterState, drinkColor, ROOM };
})();
