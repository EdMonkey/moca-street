/* ============================================================
 * receipts.js — 3D 주문 영수증 (POS에서 인쇄 → 바리스타 주문 레일에 걸림)
 *   주문 확정 시 종이 영수증이 POS에서 출력되어 작업대 위 레일로 슬라이드.
 *   영수증에 메뉴·레시피가 적히고, 하단 패션스 바(남은 시간)가 색으로 줄어든다.
 *   완료 시 위로 날아가며 사라지고, 손님이 화나서 떠나면 떨어지며 사라진다.
 *   Game이 add(order)/remove(order,served)/refresh(order)/update(dt)/clearAll() 호출.
 * ============================================================ */
const Receipts = (() => {
  const RECIPES = DATA.RECIPES, DESSERTS = DATA.DESSERTS;   // data.js 전역(DATA)에서 가져옴
  let scene = null, env = null, carried = null, ghost = null;
  const list = [];                 // {order, group, paper, tex, canvas, bar, barMat, slot, state, t, served}
  const PRINT = { x: 2.2, y: 1.17, z: -1.15 };   // 프린터 슬롯 폴백(출현 위치)
  const RW = 0.158, RH = 0.235;                  // 영수증 가로/세로(m)
  const CW = 256, CH = 380;                      // 캔버스 해상도
  const COUNTER_Y = 1.0;                          // 카운터 상판
  const _cGreen = new THREE.Color(0x53c98a), _cRed = new THREE.Color(0xff5a47), _cTmp = new THREE.Color();
  let outBase = null;              // 프린터 슬롯 월드 좌표(출력 영수증 정렬 기준)

  function init(s, e) {
    scene = s; env = e;
    const pr = e && e.machines && e.machines.receiptPrinter;
    outBase = pr && pr.slot ? pr.slot.clone() : new THREE.Vector3(PRINT.x, PRINT.y, PRINT.z);
    // 별도 주문 레일 없음 — 출력된 영수증은 프린터 앞 카운터에 세워 정렬된다.
  }

  // 프린터 앞 카운터에 세워둔 출력 영수증 위치(왼쪽·앞쪽으로 살짝씩 펼침)
  function slotPos(slot) {
    return {
      x: outBase.x - 0.02 - slot * 0.04,
      y: COUNTER_Y + RH / 2 + 0.006,
      z: outBase.z - 0.10 - slot * 0.02
    };
  }

  /* ----- 캔버스에 영수증 내용 그리기 ----- */
  function dashed(ctx, x0, y, x1) {
    ctx.strokeStyle = '#b9b0a0'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  function drawPaper(canvas, order) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);
    // 종이
    ctx.fillStyle = '#f6f1e4'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(0, 0, CW, 6);   // 상단 그림자
    // 헤더
    ctx.fillStyle = '#2a2a2a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 30px monospace'; ctx.fillText('MOCA ST.', CW / 2, 42);
    ctx.font = '600 20px monospace'; ctx.fillText('— ORDER —', CW / 2, 72);
    ctx.font = '700 34px monospace'; ctx.fillText('#' + order.num, CW / 2, 116);
    dashed(ctx, 16, 140, CW - 16);
    // 항목
    let y = 178;
    ctx.textAlign = 'left';
    order.items.forEach(it => {
      if (y > CH - 86) return;
      const done = !!it.done;
      const name = it.type === 'drink'
        ? RECIPES[it.recipeId].name + (it.extraShot ? ' +샷' : '')
        : DESSERTS[it.kind].name;
      ctx.fillStyle = done ? '#a59f93' : '#1c1c1c';
      ctx.font = '700 26px sans-serif';
      const label = '• ' + name;
      ctx.fillText(label, 20, y);
      if (done) {
        const w = ctx.measureText(label).width;
        ctx.strokeStyle = '#a59f93'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(18, y - 8); ctx.lineTo(22 + w, y - 8); ctx.stroke();
      }
      y += 32;
      if (!done && it.type === 'drink' && y < CH - 96) {
        const steps = RECIPES[it.recipeId].steps.slice();
        if (it.extraShot) steps.push('샷 1잔 더');
        ctx.fillStyle = '#6a6052'; ctx.font = '500 17px sans-serif';
        y = wrapText(ctx, steps.join(' › '), 26, y, CW - 44, 21) + 8;
      }
    });
    // 하단 — 남은 시간 라벨 + 바 트랙(채움은 별도 3D 바)
    dashed(ctx, 16, CH - 70, CW - 16);
    ctx.fillStyle = '#3a3a3a'; ctx.textAlign = 'center'; ctx.font = '600 17px monospace';
    ctx.fillText('남은 시간', CW / 2, CH - 44);
    ctx.fillStyle = '#ddd6c7'; ctx.fillRect(20, CH - 32, CW - 40, 14);
  }

  /* ----- 영수증 생성 ----- */
  function add(order) {
    const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
    drawPaper(canvas, order);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const group = new THREE.Group();
    group.rotation.y = Math.PI;                       // 앞면(텍스처)을 직원쪽(-z)으로
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(RW, RH),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));   // 항상 또렷하게 읽히도록 self-lit
    paper.castShadow = false;
    group.add(paper);
    // 패션스 바(남은 시간) — 종이 앞면(+z local) 살짝 위에. 트랙 위치(CH-25)에 맞춤.
    const barW = (CW - 40) / CW * RW;                 // ≈ 트랙 가로
    const barMat = new THREE.MeshBasicMaterial({ color: 0x53c98a, toneMapped: false });
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.0086), barMat);
    bar.position.set(0, RH * (0.5 - (CH - 25) / CH), 0.0015);
    group.add(bar);
    // 인쇄 시작점 — POS 옆 프린터 슬롯(있으면) 또는 폴백 PRINT
    const printer = env && env.machines && env.machines.receiptPrinter;
    const from = printer && printer.slot ? printer.slot : PRINT;
    group.position.set(from.x, from.y, from.z);
    group.scale.setScalar(0.2);
    scene.add(group);
    // 집기용 히트박스(그룹 자식 → 영수증과 함께 이동). 도킹/거치 상태에서만 조준 활성.
    const hb = new THREE.Mesh(new THREE.BoxGeometry(RW, RH, 0.04),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hb.castShadow = hb.receiveShadow = false;
    hb.userData.outlineRoot = paper;
    hb.userData.interactDisabled = true;   // 인쇄 애니 중엔 비활성
    group.add(hb);
    const r = { order, group, paper, tex, canvas, bar, barMat, hb, slot: 0, state: 'in', t: 0, served: false,
      from: { x: from.x, y: from.y, z: from.z } };
    hb.userData.interact = { id: 'receipt', ref: r };
    if (env && env.interactables) env.interactables.push(hb);
    list.push(r);
    reslot();
    if (typeof AudioFX !== 'undefined' && AudioFX.pick) AudioFX.pick();
    return r;
  }

  function setGrabbable(r, on) { r.hb.userData.interactDisabled = !on; }

  /* ----- 집어서 옮기기 ----- */
  function isCarrying() { return !!carried; }
  function freeBoardSlot(r) {
    if (r.board && r.boardSlot != null) { r.board.occupied[r.boardSlot] = null; r.board = null; r.boardSlot = null; }
  }
  function grab(r) {
    if (!r || carried) return;
    freeBoardSlot(r);                 // 머신 보드에 붙어 있었다면 자리 비움
    carried = r;
    r.state = 'held';
    setGrabbable(r, false);
    r.group.rotation.set(0, 0, 0);                       // 손에 들면 카메라를 향함
    if (typeof Player !== 'undefined' && Player.carryAttach) Player.carryAttach(r.group);
    reslot();                                            // 레일에서 빠졌으니 남은 것 정렬
    if (typeof AudioFX !== 'undefined' && AudioFX.pick) AudioFX.pick();
  }
  function dropAt(point) {
    if (!carried || !point) return false;
    const r = carried; carried = null;
    if (typeof Player !== 'undefined' && Player.carryDetach) Player.carryDetach(r.group);
    scene.add(r.group);
    r.group.position.set(point.x, point.y + 0.004, point.z);   // 표면에 납작하게 눕힘
    r.group.rotation.set(-Math.PI / 2, 0, 0);                  // 앞면이 위를 향하도록
    r.group.scale.setScalar(1);
    r.state = 'free';
    setGrabbable(r, true);
    if (typeof AudioFX !== 'undefined' && AudioFX.put) AudioFX.put();
    return true;
  }
  // 머신 보드에 붙이기 — 빈 슬롯에 클립처럼 부착(머신과 함께 이동)
  function attachToMachine(board) {
    if (!carried || !board) return false;
    const idx = board.occupied.findIndex(o => !o);
    if (idx < 0) return false;        // 자리 없음
    const r = carried; carried = null;
    if (typeof Player !== 'undefined' && Player.carryDetach) Player.carryDetach(r.group);
    board.st.root.add(r.group);       // 머신 로컬에 부착
    const sp = board.slots[idx];
    r.group.position.copy(sp);
    r.group.rotation.set(0, 0, 0);    // 앞면(+z) = 바리스타쪽
    r.group.scale.setScalar(1);
    r.state = 'board'; r.board = board; r.boardSlot = idx; board.occupied[idx] = r;
    setGrabbable(r, true);
    if (typeof AudioFX !== 'undefined' && AudioFX.put) AudioFX.put();
    return true;
  }

  // ----- 배치 고스트 (영수증을 들고 표면을 조준할 때 놓일 위치 미리보기) -----
  function showGhost(point) {
    if (!carried || !point) { hideGhost(); return; }
    if (!ghost) {
      ghost = new THREE.Mesh(new THREE.PlaneGeometry(RW, RH),
        new THREE.MeshBasicMaterial({ color: 0x66d9a8, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
      ghost.rotation.set(-Math.PI / 2, 0, 0); ghost.renderOrder = 5; ghost.visible = false;
      scene.add(ghost);
    }
    ghost.position.set(point.x, point.y + 0.004, point.z);   // dropAt과 동일하게 납작하게 눕힘
    ghost.visible = true;
  }
  function hideGhost() { if (ghost) ghost.visible = false; }

  function find(order) { return list.find(r => r.order === order); }

  function refresh(order) {
    const r = find(order); if (!r) return;
    drawPaper(r.canvas, order); r.tex.needsUpdate = true;
  }

  function remove(order, served) {
    const r = find(order); if (!r) return;
    if (r === carried || r.state === 'board') {   // 손/보드에 있으면 현재 월드 위치로 떼어내 애니메이션
      const wp = new THREE.Vector3(); r.group.getWorldPosition(wp);
      if (r === carried && typeof Player !== 'undefined' && Player.carryDetach) Player.carryDetach(r.group);
      freeBoardSlot(r);
      scene.add(r.group); r.group.position.copy(wp); r.group.rotation.set(0, Math.PI, 0); r.group.scale.setScalar(1);
      carried = null;
    }
    setGrabbable(r, false);
    r.state = 'out'; r.t = 0; r.served = !!served;
    if (!served) r.barMat.color.set(0xff5a47);   // 화나서 떠남 — 빨강
    reslot();
  }

  function reslot() {   // 레일에 걸린 것(in/docked)만 슬롯 차지 — held/free/out 제외
    let n = 0;
    list.forEach(r => { if (r.state === 'in' || r.state === 'docked') r.slot = n++; });
  }

  function dispose(r) {
    if (r === carried) carried = null;
    freeBoardSlot(r);
    if (r.group.parent) r.group.parent.remove(r.group);   // scene / carryGroup / 머신
    if (env && env.interactables) { const i = env.interactables.indexOf(r.hb); if (i >= 0) env.interactables.splice(i, 1); }
    r.hb.geometry.dispose(); r.hb.material.dispose();
    r.paper.geometry.dispose(); r.paper.material.dispose(); r.tex.dispose();
    r.bar.geometry.dispose(); r.barMat.dispose();
  }

  function clearAll() {
    while (list.length) { dispose(list.pop()); }
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.state === 'in') {   // 프린터에서 뽑혀 나와 카운터에 세워지는 출력 애니메이션
        r.t = Math.min(1, r.t + dt / 0.65);
        const e = 1 - Math.pow(1 - r.t, 3);
        const sp = slotPos(r.slot);
        const f = r.from;
        r.group.position.set(
          f.x + (sp.x - f.x) * e,
          f.y + (sp.y - f.y) * e,
          f.z + (sp.z - f.z) * e);
        // 폭은 먼저 들어오고, 높이는 종이가 뽑혀나오듯 길어진다 + 살짝 흔들리며 안착
        r.group.scale.set(0.5 + 0.5 * Math.min(1, e * 1.6), 0.12 + 0.88 * e, 1);
        r.group.rotation.z = Math.sin(e * Math.PI) * 0.12;
        updateBar(r);
        if (r.t >= 1) { r.state = 'docked'; r.group.scale.set(1, 1, 1); r.group.rotation.z = 0; setGrabbable(r, true); }
      } else if (r.state === 'docked') {
        const sp = slotPos(r.slot);
        const k = Math.min(1, dt * 8);
        r.group.position.x += (sp.x - r.group.position.x) * k;
        r.group.position.z += (sp.z - r.group.position.z) * k;
        updateBar(r);
      } else if (r.state === 'held' || r.state === 'free' || r.state === 'board') {
        updateBar(r);   // 위치는 손/배치/머신이 제어 — 바만 갱신
      } else if (r.state === 'out') {
        r.t = Math.min(1, r.t + dt / 0.5);
        r.group.scale.setScalar(Math.max(0.001, 1 - r.t));
        r.group.position.y += (r.served ? 0.7 : -0.6) * dt;
        r.group.rotation.z += (r.served ? 2.2 : -3.2) * dt;
        if (r.t >= 1) { dispose(r); list.splice(i, 1); reslot(); }
      }
    }
  }

  function updateBar(r) {
    const c = r.order.customer;
    if (!c || !c.patienceMax) return;
    const frac = Math.max(0, Math.min(1, c.patience / c.patienceMax));
    r.bar.scale.x = Math.max(0.001, frac);
    if (r.state !== 'out') {
      _cTmp.copy(_cRed).lerp(_cGreen, frac);   // 적음=빨강, 많음=초록
      r.barMat.color.copy(_cTmp);
    }
  }

  return { init, add, remove, refresh, update, clearAll, grab, dropAt, attachToMachine, isCarrying, showGhost, hideGhost };
})();
