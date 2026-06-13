/* ============================================================
 * game.js — 게임 상태 · 주문/제조/서빙 · 하루 사이클 · 경제 · UI
 * ============================================================ */
const $ = id => document.getElementById(id);

/* ---------------- 사운드 (WebAudio 물리 모델링 신스) ---------------- */
const AudioFX = (() => {
  let ctx = null, master = null, noiseBuf = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5;
      comp.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      // 공용 화이트노이즈 버퍼 (2초, 루프 재생용)
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ----- 빌딩 블록 ----- */
  function tone(f, dur, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
    const a = ensure();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    const t0 = a.currentTime + when;
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // 루프 노이즈 소스 (랜덤 오프셋에서 시작)
  function noiseSrc(a) {
    const s = a.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    return s;
  }
  // 짧은 노이즈 버스트 (충돌·튐 소리)
  function burst(when, freq, dur = 0.03, vol = 0.1, q = 1.5, type = 'bandpass') {
    const a = ensure();
    const src = noiseSrc(a);
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(when, Math.random() * 1.5);
    src.stop(when + dur + 0.05);
  }
  // 지속음 핸들: stop()으로 조기 중단 가능, dur 후 자동 종료
  function sustainedHandle(stopFn, dur) {
    const h = { stopped: false, stop() { if (h.stopped) return; h.stopped = true; stopFn(); } };
    setTimeout(() => h.stop(), dur * 1000);
    return h;
  }

  /* ----- 도자기 컵 클링크 (배음 모달 합성) ----- */
  function cupClink(vol = 0.5) {
    const a = ensure(), t0 = a.currentTime;
    [1900, 2750, 3620, 5150].forEach((f, i) => {
      const o = a.createOscillator();
      o.frequency.value = f * (0.99 + Math.random() * 0.02);
      const g = a.createGain();
      const t = t0 + i * 0.0045;
      g.gain.setValueAtTime(vol * 0.09 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + Math.random() * 0.07);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.25);
    });
    burst(t0, 6200, 0.012, vol * 0.1, 0.7, 'highpass'); // 접촉 트랜지언트
  }

  /* ----- 그라인더: 모터 험 + 분쇄 크래클 + 스핀다운 ----- */
  function grind(dur = 1.6) {
    const a = ensure(), t0 = a.currentTime;
    const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 88;
    const osc2 = a.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 179;
    const lfo = a.createOscillator(); lfo.frequency.value = 9;
    const lfoG = a.createGain(); lfoG.gain.value = 4;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const mLP = a.createBiquadFilter(); mLP.type = 'lowpass'; mLP.frequency.value = 340;
    const mG = a.createGain();
    mG.gain.setValueAtTime(0, t0);
    mG.gain.linearRampToValueAtTime(0.085, t0 + 0.07);
    osc.connect(mLP); osc2.connect(mLP); mLP.connect(mG); mG.connect(master);
    // 원두 갈리는 노이즈 (대역 통과 + 크래클 LFO)
    const n = noiseSrc(a);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 0.9;
    const nG = a.createGain();
    nG.gain.setValueAtTime(0, t0);
    nG.gain.linearRampToValueAtTime(0.11, t0 + 0.1);
    const crk = a.createOscillator(); crk.type = 'square'; crk.frequency.value = 27;
    const crkG = a.createGain(); crkG.gain.value = 0.035;
    crk.connect(crkG); crkG.connect(nG.gain);
    n.connect(bp); bp.connect(nG); nG.connect(master);
    // 원두 알갱이 튀는 소리
    for (let i = 0; i < 9; i++)
      burst(t0 + 0.1 + Math.random() * Math.max(0.1, dur - 0.4), 1500 + Math.random() * 2600, 0.02, 0.05, 2);
    [osc, osc2, lfo, crk, n].forEach(x => x.start(t0));
    return sustainedHandle(() => {
      const t = a.currentTime;
      osc.frequency.setTargetAtTime(50, t, 0.1);          // 스핀다운
      mG.gain.setTargetAtTime(0, t, 0.09);
      nG.gain.setTargetAtTime(0, t, 0.04);
      [osc, osc2, lfo, crk, n].forEach(x => x.stop(t + 0.5));
    }, dur);
  }

  /* ----- 물 따르는 소리: 노이즈 스윕 + 버블 ----- */
  function pourWater(dur = 0.9) {
    const a = ensure(), t0 = a.currentTime;
    const n = noiseSrc(a);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(620, t0);
    bp.frequency.linearRampToValueAtTime(1080, t0 + dur);   // 컵이 차며 음높이 상승
    const g = a.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.08);
    g.gain.setValueAtTime(0.14, t0 + dur - 0.12);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    n.connect(bp); bp.connect(g); g.connect(master);
    // 보글거림
    const n2 = noiseSrc(a);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g2 = a.createGain(); g2.gain.value = 0.05;
    const wob = a.createOscillator(); wob.frequency.value = 12;
    const wobG = a.createGain(); wobG.gain.value = 0.03;
    wob.connect(wobG); wobG.connect(g2.gain);
    n2.connect(lp); lp.connect(g2); g2.connect(master);
    burst(t0 + 0.02, 1300, 0.07, 0.07, 1);                   // 첫 물줄기 스플래시
    [n, n2, wob].forEach(x => x.start(t0));
    return sustainedHandle(() => {
      const t = a.currentTime;
      g.gain.setTargetAtTime(0, t, 0.04);
      g2.gain.setTargetAtTime(0, t, 0.04);
      [n, n2, wob].forEach(x => x.stop(t + 0.25));
    }, dur);
  }

  /* ----- 스팀: 강한 히스 + 흔들림 ----- */
  function steam(dur = 2.4) {
    const a = ensure(), t0 = a.currentTime;
    const n = noiseSrc(a);
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.06);
    const flut = a.createOscillator(); flut.frequency.value = 6;
    const flutG = a.createGain(); flutG.gain.value = 0.025;
    flut.connect(flutG); flutG.connect(g.gain);
    n.connect(hp); hp.connect(g); g.connect(master);
    const n2 = noiseSrc(a);                                   // 고역 쇳소리
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 2.2;
    const g2 = a.createGain(); g2.gain.value = 0.04;
    n2.connect(bp); bp.connect(g2); g2.connect(master);
    [n, n2, flut].forEach(x => x.start(t0));
    return sustainedHandle(() => {
      const t = a.currentTime;
      g.gain.setTargetAtTime(0, t, 0.07);
      g2.gain.setTargetAtTime(0, t, 0.07);
      [n, n2, flut].forEach(x => x.stop(t + 0.4));
    }, dur);
  }

  /* ----- 에스프레소 추출: 펌프 험 + 드립 ----- */
  function brewing(dur = 3.4) {
    const a = ensure(), t0 = a.currentTime;
    const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 51;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 210;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.09, t0 + 0.12);
    osc.connect(lp); lp.connect(g); g.connect(master);
    const n = noiseSrc(a);                                    // 추출 히스
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 1.4;
    const g2 = a.createGain(); g2.gain.value = 0.022;
    n.connect(bp); bp.connect(g2); g2.connect(master);
    for (let t = 0.7; t < dur - 0.1; t += 0.22 + Math.random() * 0.15)   // 커피 방울
      burst(t0 + t, 480 + Math.random() * 220, 0.04, 0.035, 2.5);
    [osc, n].forEach(x => x.start(t0));
    return sustainedHandle(() => {
      const t = a.currentTime;
      osc.frequency.setTargetAtTime(34, t, 0.1);
      g.gain.setTargetAtTime(0, t, 0.08);
      g2.gain.setTargetAtTime(0, t, 0.05);
      [osc, n].forEach(x => x.stop(t + 0.5));
    }, dur);
  }

  /* ----- 단발 효과음 ----- */
  function ice() {
    const a = ensure(), t0 = a.currentTime;
    for (let i = 0; i < 4; i++)
      burst(t0 + i * 0.07 + Math.random() * 0.04, 2500 + Math.random() * 1800, 0.04, 0.09, 3);
    tone(190, 0.12, 'sine', 0.1, 0.02, 95);                  // 낮은 덜그럭
  }
  function syrupPump() {
    tone(290, 0.16, 'sine', 0.09, 0, 140);
    burst(ensure().currentTime + 0.02, 420, 0.13, 0.07, 1, 'lowpass');
  }
  function whipSpray() {
    const a = ensure(), t0 = a.currentTime;
    const n = noiseSrc(a);
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = a.createGain();
    g.gain.setValueAtTime(0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
    const wob = a.createOscillator(); wob.frequency.value = 33;
    const wobG = a.createGain(); wobG.gain.value = 0.04;
    wob.connect(wobG); wobG.connect(g.gain);
    n.connect(hp); hp.connect(g); g.connect(master);
    n.start(t0); wob.start(t0);
    n.stop(t0 + 0.45); wob.stop(t0 + 0.45);
  }
  function trashThud() {
    tone(105, 0.22, 'sine', 0.2, 0, 42);
    burst(ensure().currentTime, 190, 0.1, 0.1, 1, 'lowpass');
  }
  function metalClack() {
    const t0 = ensure().currentTime;
    burst(t0, 3300, 0.035, 0.12, 3);
    tone(760, 0.07, 'sine', 0.07);
    tone(1130, 0.05, 'sine', 0.05, 0.005);
  }
  // 넉박스: 통을 두드려 가루를 털어내는 낮은 소리 2회
  function knock() {
    const t0 = ensure().currentTime;
    [0, 0.13].forEach(d => {
      tone(95, 0.12, 'sine', 0.16, d, 40);
      burst(t0 + d, 220, 0.09, 0.1, 1, 'lowpass');
    });
  }
  // 서빙 완료: 저음 펀치(타격감) + 밝은 상승 3음 + 반짝
  function serveSuccess() {
    const t0 = ensure().currentTime;
    tone(165, 0.16, 'sine', 0.2, 0, 58);              // 저음 임팩트 슬라이드다운
    burst(t0, 240, 0.09, 0.12, 1, 'lowpass');          // 펀치 노이즈
    [784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'sine', 0.13, 0.05 + i * 0.05));  // 띠링 상승
    tone(1760, 0.32, 'sine', 0.07, 0.18);              // 반짝 꼬리
  }

  return {
    ensure,
    // 신규 사운드
    cupClink, grind, pourWater, steam, brewing, ice, syrupPump, whipSpray, trashThud, metalClack, knock, serveSuccess,
    // 기존 UI/이벤트 음
    ding: () => { tone(880, 0.12, 'sine', 0.14); tone(1320, 0.28, 'sine', 0.1, 0.09); },
    cash: () => { tone(1180, 0.06, 'square', 0.06); tone(1568, 0.22, 'sine', 0.13, 0.05); tone(2093, 0.3, 'sine', 0.08, 0.12); },
    err: () => tone(150, 0.3, 'sawtooth', 0.1),
    pick: () => tone(540, 0.08, 'triangle', 0.1),
    put: () => tone(380, 0.08, 'triangle', 0.1),
    levelup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.13, i * 0.1)),
    bell: () => { tone(1760, 0.4, 'sine', 0.1); tone(2217, 0.5, 'sine', 0.06, 0.02); },
  };
})();

/* ---------------- 게임 본체 ---------------- */
const Game = (() => {

  /* ===== 메뉴 데이터 ===== */
  // target: {cup, ice, espresso, water, milk, foam, syrup, whip}
  const RECIPES = {
    espresso:   { name: '에스프레소',        price: 2500, lvl: 1, target: { cup: 'espresso', espresso: 1 },
      steps: ['에스프레소 잔', '에스프레소 샷'] },
    americano:  { name: '아메리카노',        price: 3000, lvl: 1, target: { cup: 'hot', espresso: 1, water: 'hot' },
      steps: ['머그컵', '에스프레소 샷', '온수'] },
    iceAmericano:{ name: '아이스 아메리카노', price: 3500, lvl: 2, target: { cup: 'ice', ice: 1, espresso: 1, water: 'cold' },
      steps: ['아이스컵', '얼음', '에스프레소 샷', '냉수'] },
    latte:      { name: '카페라떼',          price: 4000, lvl: 2, target: { cup: 'hot', espresso: 1, milk: 1 },
      steps: ['머그컵', '에스프레소 샷', '스팀밀크'] },
    iceLatte:   { name: '아이스 라떼',       price: 4500, lvl: 3, target: { cup: 'ice', ice: 1, espresso: 1, milk: 1 },
      steps: ['아이스컵', '얼음', '에스프레소 샷', '스팀밀크'] },
    vanillaLatte:{ name: '바닐라 라떼',      price: 4800, lvl: 3, target: { cup: 'hot', espresso: 1, milk: 1, syrup: 'vanilla' },
      steps: ['머그컵', '에스프레소 샷', '스팀밀크', '바닐라 시럽'] },
    cappuccino: { name: '카푸치노',          price: 4500, lvl: 4, target: { cup: 'hot', espresso: 1, milk: 1, foam: 1 },
      steps: ['머그컵', '에스프레소 샷', '스팀밀크', '우유 거품(스티머 1회 더)'] },
    mocha:      { name: '카페모카',          price: 5000, lvl: 4, target: { cup: 'hot', espresso: 1, milk: 1, syrup: 'choco', whip: 1 },
      steps: ['머그컵', '에스프레소 샷', '스팀밀크', '초코 시럽', '휘핑크림'] },
    caramelMac: { name: '카라멜 마끼아또',   price: 5300, lvl: 5, target: { cup: 'ice', ice: 1, espresso: 1, milk: 1, syrup: 'caramel' },
      steps: ['아이스컵', '얼음', '에스프레소 샷', '스팀밀크', '카라멜 시럽'] },
  };
  const DESSERTS = {
    croissant: { name: '크루아상',   price: 3500, lvl: 3 },
    muffin:    { name: '초코 머핀',  price: 3000, lvl: 3 },
    cake:      { name: '치즈케이크', price: 5500, lvl: 5 },
  };
  const LEVEL_XP = [0, 120, 320, 620, 1050, 1600];   // 누적 XP → 레벨 (최대 6)
  const MAX_LVL = 6;
  const UPGRADES = {
    fastShot:  { name: '고속 추출 보일러', desc: '에스프레소 추출 시간 -40%', price: 20000 },
    dualHead:  { name: '듀얼 그룹헤드',    desc: '에스프레소 2잔 동시 추출', price: 30000 },
    fastSteam: { name: '자동 밀크 스티머', desc: '우유 스팀 속도 2배', price: 18000 },
    interior:  { name: '인테리어 리모델링', desc: '손님 인내심 +35%', price: 25000 },
    ads:       { name: 'SNS 광고',         desc: '손님 방문 빈도 +30%', price: 15000 },
    grinder:   { name: '프리미엄 그라인더', desc: '모든 음료 가격 +15%', price: 22000 },
  };
  const RESTOCK = {
    beans:   { name: '원두',   amount: 30, price: 8000 },
    milk:    { name: '우유',   amount: 20, price: 6000 },
    cups:    { name: '컵',     amount: 40, price: 5000 },
    dessert: { name: '디저트', amount: 12, price: 9000 },
  };
  const DAY_LEN = 300;            // 실제 5분 = 게임 9시간 (09:00~18:00)
  const SAVE_KEY = 'mochaStreetSave_v1';

  /* ===== 상태 ===== */
  let env = null, scene = null;
  let mode = 'menu';              // menu | playing | dayEnd
  let S = null;                   // 저장되는 상태
  let held = null;                // {type:'drink',drink:{...}} | {type:'dessert',kind}
  let orders = [];                // {customer, items:[{type,recipeId|kind,done}], total}
  let spawnTimer = 3;
  let dayStats = null;
  let orderSeq = 0;
  let barTimer = 0;
  let placedItems = [];           // 표면에 내려놓은 아이템들 {item, mesh, hb}
  let indPulse = 0;

  function freshState() {
    return {
      money: 20000, day: 1, rep: 50, level: 1, xp: 0,
      stocks: { beans: 25, milk: 18, cups: 30, dessert: 8 },
      upgrades: {},
    };
  }
  function freshDayStats() {
    return { revenue: 0, tips: 0, served: 0, angry: 0, spent: 0 };
  }

  /* ===== 유틸 ===== */
  const fmt = n => '₩ ' + n.toLocaleString('ko-KR');
  function toast(msg, cls = '', dur = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), dur);
    setTimeout(() => el.remove(), dur + 600);
  }
  function drinkPrice(id) {
    const p = RECIPES[id].price;
    return S.upgrades.grinder ? Math.round(p * 1.15 / 100) * 100 : p;
  }
  function unlockedRecipes() { return Object.keys(RECIPES).filter(k => RECIPES[k].lvl <= S.level); }
  function unlockedDesserts() { return Object.keys(DESSERTS).filter(k => DESSERTS[k].lvl <= S.level); }

  /* ===== 음료 비교 ===== */
  function canonical(d) {
    return [d.cup, +!!d.ice, +!!d.espresso, d.water || '', +!!d.milk, +!!d.foam, d.syrup || '', +!!d.whip].join('|');
  }
  function matchesRecipe(drink, recipeId) {
    return canonical(drink) === canonical(RECIPES[recipeId].target);
  }

  /* ===== 손에 든 것 ===== */
  function setHeld(h) {
    held = h;
    if (!h) { Player.setHeld(null); }
    else if (h.type === 'drink') {
      const m = WORLD.makeDrinkMesh(h.drink);
      m.scale.setScalar(1.35);
      Player.setHeld(m);
    } else if (h.type === 'dessert') {
      const m = WORLD.makeDessertMesh(h.kind);
      m.scale.setScalar(1.3);
      Player.setHeld(m);
    } else if (h.type === 'portafilter') {
      const m = WORLD.makePortafilterMesh(h.state || 'empty');
      m.scale.setScalar(1.3);
      Player.setHeld(m);
    }
    updateHeldUI();
  }
  function drinkIngredients(d) {
    const out = [];
    out.push(d.cup === 'ice' ? '아이스컵' : d.cup === 'espresso' ? '에스프레소 잔' : '머그컵');
    if (d.ice) out.push('얼음');
    if (d.espresso) out.push('샷');
    if (d.water) out.push(d.water === 'hot' ? '온수' : '냉수');
    if (d.milk) out.push('우유');
    if (d.foam) out.push('거품');
    if (d.syrup) out.push({ vanilla: '바닐라', caramel: '카라멜', choco: '초코' }[d.syrup]);
    if (d.whip) out.push('휘핑');
    return out;
  }
  function updateHeldUI() {
    const el = $('held');
    if (!held) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (held.type === 'drink') {
      const match = Object.keys(RECIPES).find(k => matchesRecipe(held.drink, k));
      const name = match ? `<b style="color:var(--accent2)">${RECIPES[match].name}</b>` : '제조 중인 음료';
      el.innerHTML = `${name}<div class="ing">${drinkIngredients(held.drink).join(' + ')}</div>`;
    } else if (held.type === 'portafilter') {
      const info = held.state === 'filled' ? '원두 채움 — 머신에 장착하세요'
        : held.state === 'used' ? '사용한 가루 — 넉박스에 비우세요'
        : '비어 있음 — 그라인더에서 분쇄하세요';
      el.innerHTML = `<b style="color:var(--accent2)">포터필터</b><div class="ing">${info}</div>`;
    } else {
      el.innerHTML = `<b style="color:var(--accent2)">${DESSERTS[held.kind].name}</b>`;
    }
  }

  /* ===== 아이템 내려놓기 / 집기 ===== */
  function itemLabel(h) {
    if (h.type === 'drink') {
      const m = Object.keys(RECIPES).find(k => matchesRecipe(h.drink, k));
      return m ? RECIPES[m].name : '제조 중인 음료';
    }
    if (h.type === 'portafilter') {
      return h.state === 'filled' ? '포터필터 (원두 채움)'
        : h.state === 'used' ? '포터필터 (사용한 가루)'
        : '포터필터 (비어 있음)';
    }
    return DESSERTS[h.kind].name;
  }

  function placeBlocked(point) {
    return placedItems.some(p => p.mesh.position.distanceTo(point) < 0.2);
  }

  function placeItem(point) {
    const item = held;
    let mesh, yOff = 0.004;
    if (item.type === 'drink') mesh = WORLD.makeDrinkMesh(item.drink);
    else if (item.type === 'dessert') mesh = WORLD.makeDessertMesh(item.kind);
    else { mesh = WORLD.makePortafilterMesh(item.state || 'empty'); yOff = 0.03; }
    mesh.position.set(point.x, point.y + yOff, point.z);
    // 손잡이/컵이 플레이어 쪽을 향하도록
    mesh.rotation.y = Math.atan2(Player.position.x - point.x, Player.position.z - point.z);
    scene.add(mesh);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hb.position.set(point.x, point.y + 0.15, point.z);
    hb.castShadow = hb.receiveShadow = false;
    const rec = { item, mesh, hb };
    hb.userData.interact = { id: 'placedItem', rec };
    scene.add(hb);
    mesh.updateMatrixWorld(true);
    hb.updateMatrixWorld(true); // 같은 프레임에 바로 집을 수 있도록 행렬 즉시 갱신
    env.interactables.push(hb);
    placedItems.push(rec);
    setHeld(null);
    if (item.type === 'drink') AudioFX.cupClink(0.4); else AudioFX.put();
  }

  function removePlaced(rec) {
    scene.remove(rec.mesh);
    scene.remove(rec.hb);
    const i = env.interactables.indexOf(rec.hb);
    if (i >= 0) env.interactables.splice(i, 1);
    const j = placedItems.indexOf(rec);
    if (j >= 0) placedItems.splice(j, 1);
  }

  function clearPlacedItems() {
    while (placedItems.length) removePlaced(placedItems[0]);
  }

  /* ===== 주문 ===== */
  function generateOrder(customer) {
    // 튜토리얼 중에는 가장 단순한 메뉴(아메리카노)로 고정
    if (tut) {
      return { num: ++orderSeq, customer, items: [{ type: 'drink', recipeId: 'americano', done: false }], total: drinkPrice('americano') };
    }
    const pool = unlockedRecipes();
    const recipeId = pool[(Math.random() * pool.length) | 0];
    const items = [{ type: 'drink', recipeId, done: false }];
    let total = drinkPrice(recipeId);
    const dPool = unlockedDesserts();
    if (dPool.length && Math.random() < 0.32) {
      const kind = dPool[(Math.random() * dPool.length) | 0];
      items.push({ type: 'dessert', kind, done: false });
      total += DESSERTS[kind].price;
    }
    return { num: ++orderSeq, customer, items, total };
  }

  function itemName(it) {
    return it.type === 'drink' ? RECIPES[it.recipeId].name : DESSERTS[it.kind].name;
  }

  /* 티켓은 주문 시 1회만 생성하고, 이후엔 내용만 제자리 갱신
   * (매번 DOM을 재생성하면 슬라이드 애니메이션이 반복 재생되어 흔들림) */
  function addTicketEl(o) {
    const div = document.createElement('div');
    div.className = 'ticket panel';
    div.innerHTML =
      `<div class="tname">주문 #${o.num}</div><div class="titems"></div>` +
      `<div class="tbar"><div style="width:100%"></div></div>`;
    o.el = div;
    o.itemsEl = div.querySelector('.titems');
    o.barEl = div.querySelector('.tbar div');
    renderTicketItems(o);
    $('tickets').appendChild(div);
  }
  function renderTicketItems(o) {
    o.itemsEl.innerHTML = o.items.map(it => {
      const hint = (!it.done && it.type === 'drink')
        ? `<div class="thint">${RECIPES[it.recipeId].steps.join(' → ')}</div>` : '';
      return `<div class="${it.done ? 'done' : ''}">· ${itemName(it)}</div>${hint}`;
    }).join('');
  }
  function removeTicketEl(o) { if (o.el) { o.el.remove(); o.el = null; } }
  function updateTicketBars() {
    orders.forEach(o => {
      if (!o.el) return;
      const frac = Math.max(0, o.customer.patience / o.customer.patienceMax);
      o.barEl.style.width = (frac * 100) + '%';
      o.el.classList.toggle('angry', frac < 0.3);
    });
  }

  /* ===== 튜토리얼 ===== */
  const TUT_STEPS = [
    { text: '<b>W A S D</b>로 이동하고, 마우스로 주변을 둘러보세요',
      check: () => tut.startPos && Player.position.distanceTo(tut.startPos) > 2 },
    { text: '<b>ORDER</b> 팻말 아래 계산대에서 <b>[E]</b>를 눌러 손님의 주문을 받으세요',
      check: () => orders.length > 0 },
    { text: '<b>에스프레소 머신</b>에 빈손으로 다가가 <b>[E]</b>를 눌러 <b>포터필터</b>를 분리하세요',
      check: () => (held && held.type === 'portafilter') || env.machines.grinderJob.busy },
    { text: '<b>그라인더</b>에 포터필터를 가져가 <b>[E]</b>로 원두를 분쇄하세요 — 완료 후 <b>[E]</b>로 꺼내기',
      check: () => env.machines.grinderJob.busy || (held && held.type === 'portafilter' && held.state === 'filled') },
    { text: '분쇄된 포터필터를 들고 <b>에스프레소 머신</b>에 가서 <b>[E]</b>로 장착하세요',
      check: () => env.machines.espressoSlots.some(s => s.pfState === 'filled' || s.busy) },
    { text: '컵 디스펜서에서 <b>머그컵</b>을 집어 머신에 올려놓고 <b>[E]</b>로 추출을 시작하세요',
      check: () => env.machines.espressoSlots.some(s => s.busy) || (held && held.type === 'drink' && !!held.drink.espresso) },
    { text: '추출 완료! <b>[E]</b>로 컵을 꺼낸 뒤 주문표의 나머지 재료를 채우세요 — 모르면 <b>[R]</b> 레시피북',
      check: () => held && held.type === 'drink' && orders.some(o => o.items.some(it => !it.done && it.type === 'drink' && matchesRecipe(held.drink, it.recipeId))) },
    { text: '음료 완성! <b>PICK UP</b> 팻말 아래 픽업대에서 <b>[E]</b>로 손님에게 서빙하세요', event: 'served' },
  ];
  let tut = null;   // { step, startPos }

  function startTutorial() {
    tut = { step: 0, startPos: Player.position.clone() };
    showTutStep();
  }
  function showTutStep() {
    $('tutStep').textContent = `튜토리얼 ${tut.step + 1}/${TUT_STEPS.length}`;
    $('tutText').innerHTML = TUT_STEPS[tut.step].text;
    $('tutorial').classList.remove('hidden');
  }
  function tutAdvance() {
    tut.step++;
    AudioFX.ding();
    if (tut.step >= TUT_STEPS.length) { endTutorial(true); return; }
    showTutStep();
  }
  function endTutorial(completed) {
    tut = null;
    $('tutorial').classList.add('hidden');
    if (completed) { toast('🎓 튜토리얼 완료! 이제 진짜 영업 시작입니다', 'gold', 4000); AudioFX.levelup(); }
  }
  function tutEvent(name) {
    if (!tut) return;
    // 서빙 = 튜토리얼의 최종 목표 — 단계와 무관하게 완료 처리
    if (name === 'served') endTutorial(true);
  }
  function updateTutorial() {
    if (!tut) return;
    const st = TUT_STEPS[tut.step];
    if (st.check && st.check()) tutAdvance();
  }

  /* ===== 손님 훅 ===== */
  function onAngryLeave(c) {
    const i = orders.findIndex(o => o.customer === c);
    if (i >= 0) { removeTicketEl(orders[i]); orders.splice(i, 1); }
    S.rep = Math.max(0, S.rep - 4);
    dayStats.angry++;
    toast('손님이 화나서 떠났어요… (평판 -4)', 'bad');
    AudioFX.err();
    updateHUD();
  }

  /* ===== 상호작용 ===== */
  function patienceForNew() {
    let p = 80 - S.day * 1.5;
    if (S.upgrades.interior) p *= 1.35;
    return Math.max(45, p);
  }

  function interact(it) {
    if (!it) return;
    const id = it.id;
    // 준비 단계엔 재고 보충만 (제조·서빙은 영업 중에)
    if (mode === 'prep' && id !== 'restock') {
      toast('영업을 시작하면 사용할 수 있어요 — 지금은 재고 보충과 [B] 배치');
      return;
    }

    /* --- 주문 받기 --- */
    if (id === 'register') {
      const c = Customers.frontCustomer();
      if (!c) { toast('주문할 손님이 없습니다'); return; }
      const order = generateOrder(c);
      orders.push(order);
      Customers.takeOrder(c, order);
      addTicketEl(order);
      AudioFX.ding();
      toast(`주문 #${order.num} — ${order.items.map(itemName).join(', ')}`, 'gold');
      return;
    }

    /* --- 서빙 --- */
    if (id === 'pickup') { tryServe(); return; }

    /* --- 내려놓은 아이템 집기 --- */
    if (id === 'placedItem') {
      if (held) { toast('손이 비어있어야 집을 수 있어요'); return; }
      const rec = it.rec;
      removePlaced(rec);
      setHeld(rec.item);
      if (rec.item.type === 'drink') AudioFX.cupClink(0.4); else AudioFX.pick();
      return;
    }

    /* --- 컵 --- */
    if (id === 'cupHot' || id === 'cupIce' || id === 'cupEsp') {
      if (held) { toast('손이 비어있어야 컵을 잡을 수 있어요'); return; }
      if (S.stocks.cups <= 0) { toast('컵이 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      S.stocks.cups--;
      setHeld({ type: 'drink', drink: { cup: id === 'cupHot' ? 'hot' : id === 'cupIce' ? 'ice' : 'espresso' } });
      AudioFX.cupClink(0.55);
      updateHUD();
      return;
    }

    /* --- 얼음 --- */
    if (id === 'ice') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.cup !== 'ice') { toast('아이스컵에만 얼음을 담을 수 있어요'); AudioFX.err(); return; }
      if (held.drink.ice) { toast('이미 얼음이 들어있어요'); return; }
      held.drink.ice = 1;
      setHeld(held);
      AudioFX.ice();
      return;
    }

    /* --- 그라인더: 빈 포터필터 삽입 → 분쇄 → 완료되면 채워진 포터필터 꺼내기 --- */
    if (id === 'grinder') {
      const job = env.machines.grinderJob;
      if (job.busy) {
        if (!job.done) { toast('분쇄 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 포터필터를 꺼낼 수 있어요'); return; }
        resetJob(job);
        setHeld({ type: 'portafilter', state: 'filled' });
        AudioFX.metalClack();
        return;
      }
      // 빈손으로 유휴 그라인더 — 더 이상 무에서 포터필터 생성 금지
      if (!held) { toast('머신에서 포터필터를 분리해 가져오세요', 'bad'); AudioFX.err(); return; }
      if (held.type !== 'portafilter') { toast('포터필터를 들고 오세요'); return; }
      if (held.state === 'used') { toast('넉박스에 가루를 먼저 털어내세요', 'bad'); AudioFX.err(); return; }
      if (held.state === 'filled') { toast('이미 분쇄된 포터필터예요'); return; }
      if (S.stocks.beans <= 0) { toast('원두가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      // 빈 포터필터 삽입 + 분쇄 시작
      S.stocks.beans--;
      setHeld(null);
      job.busy = true; job.done = false; job.t = 0; job.dur = 1.6; job.hasPf = true;
      WORLD.setPortafilterState(job.pfMesh, 'empty');
      job.sound = AudioFX.grind(job.dur);
      AudioFX.metalClack();
      updateHUD();
      return;
    }

    /* --- 에스프레소 머신: 포터필터 분리/장착 → 컵 올려 추출 → 꺼내기 --- */
    if (id === 'espresso') {
      const slot = env.machines.espressoSlots[it.slot];
      if (it.slot === 1 && !S.upgrades.dualHead) { toast('🔒 듀얼 그룹헤드 업그레이드가 필요합니다'); return; }
      if (slot.busy) {
        if (!slot.done) { toast('추출 중입니다…'); return; }
        // 완료된 샷 꺼내기 — 포터필터(used)는 머신에 남는다
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        slot.st.root.remove(slot.cupMesh);
        slot.busy = slot.done = false;
        slot.stream.visible = false;
        const drink = slot.drink;
        slot.cupMesh = null; slot.drink = null;
        slot.progress.hide();
        setHeld({ type: 'drink', drink });
        AudioFX.cupClink(0.5);
        return;
      }
      // 포터필터를 들고 빈 슬롯에 장착 (상태 유지)
      if (held && held.type === 'portafilter') {
        if (slot.pfState !== 'none') { toast('이미 포터필터가 장착되어 있어요'); return; }
        slot.pfState = held.state || 'empty';
        WORLD.setPortafilterState(slot.pf, slot.pfState);
        setHeld(null);
        AudioFX.metalClack();
        return;
      }
      // 컵 올려 추출 시작 (filled 포터필터가 장착되어 있어야 함)
      if (held && held.type === 'drink') {
        if (held.drink.espresso) { toast('이미 샷이 추출된 컵이에요'); return; }
        if (slot.pfState === 'none') { toast('포터필터를 장착하세요', 'bad'); AudioFX.err(); return; }
        if (slot.pfState === 'used') { toast('사용한 가루가 있어요 — 분리해 넉박스에 비운 뒤 다시 분쇄하세요', 'bad'); AudioFX.err(); return; }
        if (slot.pfState === 'empty') { toast('빈 포터필터예요 — 분리해 그라인더에서 원두를 분쇄하세요', 'bad'); AudioFX.err(); return; }
        const drink = held.drink;
        setHeld(null);
        slot.busy = true; slot.done = false; slot.t = 0;
        slot.dur = S.upgrades.fastShot ? 2.0 : 3.4;
        slot.drink = drink;
        const cm = WORLD.makeDrinkMesh(drink);
        cm.position.copy(slot.localPos);
        slot.st.root.add(cm);
        slot.cupMesh = cm;
        slot.stream.visible = true;
        AudioFX.cupClink(0.35);
        slot.sound = AudioFX.brewing(slot.dur);
        return;
      }
      // 빈손 — 추출 중이 아니면 포터필터 분리
      if (slot.pfState === 'none') { toast('포터필터가 없어요'); return; }
      const state = slot.pfState;
      slot.pfState = 'none';
      WORLD.setPortafilterState(slot.pf, 'none');
      setHeld({ type: 'portafilter', state });
      AudioFX.metalClack();
      return;
    }

    /* --- 밀크 스티머: 컵 올려두기 → (자유 행동) → 완료되면 꺼내기 --- */
    if (id === 'steamer') {
      const job = env.machines.steamerJob;
      if (job.busy) {
        if (!job.done) { toast('스팀 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        const drink = job.drink;
        resetJob(job);
        setHeld({ type: 'drink', drink });
        AudioFX.cupClink(0.5);
        return;
      }
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.foam) { toast('이미 거품까지 올렸어요'); return; }
      if (S.stocks.milk <= 0) { toast('우유가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      S.stocks.milk--;
      const drink = held.drink;
      setHeld(null);
      job.busy = true; job.done = false; job.t = 0;
      job.dur = S.upgrades.fastSteam ? 1.2 : 2.4;
      job.makingFoam = !!drink.milk;
      job.drink = drink;
      const cm = WORLD.makeDrinkMesh(drink);
      cm.position.copy(job.localPos);
      job.st.root.add(cm);
      job.cupMesh = cm;
      job.sound = AudioFX.steam(job.dur);
      AudioFX.cupClink(0.35);
      updateHUD();
      return;
    }

    /* --- 온수/냉수: 컵 올려두기 → 물 받기 → 완료되면 꺼내기 --- */
    if (id === 'waterHot' || id === 'waterCold') {
      const job = env.machines.waterJobs[id];
      if (job.busy) {
        if (!job.done) { toast('물 받는 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        const drink = job.drink;
        resetJob(job);
        setHeld({ type: 'drink', drink });
        AudioFX.cupClink(0.5);
        return;
      }
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.water) { toast('이미 물이 들어있어요'); return; }
      const drink = held.drink;
      setHeld(null);
      job.busy = true; job.done = false; job.t = 0; job.dur = 1.2;
      job.drink = drink;
      const cm = WORLD.makeDrinkMesh(drink);
      cm.position.copy(job.localPos);
      job.st.root.add(cm);
      job.cupMesh = cm;
      job.sound = AudioFX.pourWater(job.dur);
      AudioFX.cupClink(0.35);
      return;
    }

    /* --- 시럽 --- */
    if (id === 'syrup') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.syrup) { toast('이미 시럽이 들어있어요'); return; }
      held.drink.syrup = it.kind;
      setHeld(held);
      AudioFX.syrupPump();
      return;
    }

    /* --- 휘핑크림 --- */
    if (id === 'whip') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.whip) { toast('이미 휘핑크림을 올렸어요'); return; }
      held.drink.whip = 1;
      setHeld(held);
      AudioFX.whipSpray();
      return;
    }

    /* --- 디저트 꺼내기 --- */
    if (id === 'dessert') {
      if (held) { toast('손이 비어있어야 디저트를 꺼낼 수 있어요'); return; }
      if (S.stocks.dessert <= 0) { toast('디저트가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      S.stocks.dessert--;
      setHeld({ type: 'dessert', kind: it.kind });
      AudioFX.pick();
      updateHUD();
      return;
    }

    /* --- 넉박스: 사용한 포터필터 가루 비우기 --- */
    if (id === 'knockbox') {
      if (!held || held.type !== 'portafilter') { toast('사용한 포터필터를 들고 오세요'); return; }
      if (held.state !== 'used') {
        toast(held.state === 'filled' ? '분쇄된 원두는 그냥 두세요 — 머신에 장착하면 돼요' : '비울 가루가 없어요');
        return;
      }
      held.state = 'empty';
      setHeld(held);
      toast('가루를 털어냈어요 — 다시 분쇄할 수 있어요');
      AudioFX.knock();
      return;
    }

    /* --- 쓰레기통 --- */
    if (id === 'trash') {
      if (!held) { toast('버릴 것이 없어요'); return; }
      // 포터필터는 영구 도구 — 버릴 수 없음 (used면 가루만 비움)
      if (held.type === 'portafilter') {
        if (held.state === 'used') {
          held.state = 'empty';
          setHeld(held);
          toast('가루를 털어냈어요 — 다시 분쇄할 수 있어요');
          AudioFX.trashThud();
        } else {
          toast('⛔ 포터필터는 버릴 수 없어요 — 넉박스에 가루만 비우세요', 'bad');
          AudioFX.err();
        }
        return;
      }
      setHeld(null);
      toast('버렸습니다');
      AudioFX.trashThud();
      return;
    }

    /* --- 재고 보충 (준비=정상가 / 영업중=비상 웃돈) --- */
    if (id === 'restock') {
      const r = RESTOCK[it.kind];
      const emergency = mode === 'playing';
      const price = emergency ? Math.round(r.price * 1.8 / 100) * 100 : r.price;
      if (S.money < price) { toast('돈이 부족해요!', 'bad'); AudioFX.err(); return; }
      S.money -= price;
      if (dayStats) dayStats.spent += price;
      S.stocks[it.kind] += r.amount;
      toast(`${r.name} +${r.amount} (${fmt(price)})${emergency ? ' · 비상 보충 ⚡' : ''}`, emergency ? 'bad' : 'good');
      AudioFX.cash();
      updateHUD();
      return;
    }
  }

  /* ===== 서빙 ===== */
  /* ===== 서빙 완료 연출 (컵 내려놓기 → 체크 팝 → 사라짐) ===== */
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
  function initServeFx() {
    checkTex = buildCheckTex();
    const sparkTex = buildSparkTex();
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sparkTex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0
      }));
      s.visible = false; s.renderOrder = 7;
      s.userData = { life: 0, max: 1, vx: 0, vy: 0, vz: 0 };
      scene.add(s);
      sparkPool.push(s);
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
  function spawnServeFx(worldPos, mesh) {
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
  function updateServeFx(dt) {
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
  function clearServeFx() {
    serveFxList.forEach(fx => { if (!fx.cupGone) scene.remove(fx.cup); scene.remove(fx.check); });
    serveFxList = [];
    sparkPool.forEach(s => { s.visible = false; s.material.opacity = 0; });
  }

  function tryServe() {
    if (!held) { toast('서빙할 음료나 디저트를 들고 오세요'); return; }
    for (const o of orders) {
      if (o.customer.state !== 'waitDrink' && o.customer.state !== 'toPickup') continue;
      for (const item of o.items) {
        if (item.done) continue;
        let match = false;
        if (held.type === 'drink' && item.type === 'drink') match = matchesRecipe(held.drink, item.recipeId);
        if (held.type === 'dessert' && item.type === 'dessert') match = held.kind === item.kind;
        if (!match) continue;
        // 서빙 성공
        item.done = true;
        const servedDrink = held.type === 'drink' ? held.drink : null;
        // 픽업대에 컵/디저트를 내려놓는 연출용 메시
        let fxMesh = null;
        if (held.type === 'drink') fxMesh = WORLD.makeDrinkMesh(held.drink);
        else if (held.type === 'dessert') fxMesh = WORLD.makeDessertMesh(held.kind);
        setHeld(null);
        if (fxMesh) {
          const px = env.pickupPos.x + (Math.random() - 0.5) * 0.5;
          spawnServeFx(new THREE.Vector3(px, env.machines.pickupTrayY || 1.07, env.pickupPos.z), fxMesh);
        }
        renderTicketItems(o);
        if (o.items.every(i => i.done)) completeOrder(o, servedDrink);
        else toast(`${itemName(item)} 전달! 나머지 항목도 준비하세요`, 'good');
        return;
      }
    }
    if (held.type === 'drink') {
      const match = Object.keys(RECIPES).find(k => matchesRecipe(held.drink, k));
      toast(match ? `${RECIPES[match].name}을(를) 기다리는 손님이 없어요` : '레시피와 일치하지 않는 음료예요. 쓰레기통에 버리세요', 'bad');
    } else if (held.type === 'portafilter') {
      toast('포터필터는 에스프레소 머신에 장착하세요 ☕', 'bad');
    } else {
      toast('이 디저트를 기다리는 손님이 없어요', 'bad');
    }
    AudioFX.err();
  }

  function completeOrder(o, servedDrink) {
    const c = o.customer;
    const frac = Math.max(0, c.patience / c.patienceMax);
    const tip = Math.floor(o.total * 0.3 * frac * (0.7 + S.rep / 250) / 100) * 100;
    S.money += o.total + tip;
    dayStats.revenue += o.total;
    dayStats.tips += tip;
    dayStats.served++;
    S.rep = Math.min(100, S.rep + (frac > 0.5 ? 2 : 1));
    gainXP(Math.round(o.total / 100));
    removeTicketEl(o);
    orders.splice(orders.indexOf(o), 1);
    // 컵은 픽업대 연출에서 사라지므로 손님은 빈손으로 만족하며 떠남
    Customers.serve(c, null);
    toast(`주문 #${o.num} 완료! +${fmt(o.total)}${tip > 0 ? ` (팁 +${fmt(tip)})` : ''}`, 'good');
    AudioFX.cash();
    updateHUD();
    tutEvent('served');
  }

  function gainXP(amount) {
    S.xp += amount;
    while (S.level < MAX_LVL && S.xp >= LEVEL_XP[S.level]) {
      S.level++;
      const newR = Object.keys(RECIPES).filter(k => RECIPES[k].lvl === S.level).map(k => RECIPES[k].name);
      const newD = Object.keys(DESSERTS).filter(k => DESSERTS[k].lvl === S.level).map(k => DESSERTS[k].name);
      const names = [...newR, ...newD];
      toast(`🎉 레벨 업! Lv.${S.level}${names.length ? ' — 신메뉴: ' + names.join(', ') : ''}`, 'gold', 4500);
      AudioFX.levelup();
      renderRecipeBook();
    }
    updateHUD();
  }

  /* ===== 머신 비동기 작업 (그라인더·스티머·온수/냉수) =====
   * 컵/재료를 올려두고 자리를 떠나도 진행되며, 머신 위 프로그레스 바로 상태 표시 */
  function machineJobs() {
    return [env.machines.grinderJob, env.machines.steamerJob,
      env.machines.waterJobs.waterHot, env.machines.waterJobs.waterCold];
  }
  function swapJobCup(job) {
    job.st.root.remove(job.cupMesh);
    const cm = WORLD.makeDrinkMesh(job.drink);
    cm.position.copy(job.localPos);
    job.st.root.add(cm);
    job.cupMesh = cm;
  }
  function updateJobs(dt) {
    machineJobs().forEach(job => {
      if (!job || !job.busy) return;
      if (!job.done) {
        job.t += dt;
        if (job.t >= job.dur) {
          job.done = true;
          if (job.sound) { job.sound.stop(); job.sound = null; }
          if (job.kind === 'steamer') {
            if (job.makingFoam) job.drink.foam = 1; else job.drink.milk = 1;
            swapJobCup(job);
          } else if (job.kind === 'water') {
            job.drink.water = job.waterType;
            swapJobCup(job);
          } else if (job.kind === 'grinder') {
            WORLD.setPortafilterState(job.pfMesh, 'filled');
          }
          AudioFX.ding();
        }
      }
      job.progress.draw(job.t / job.dur, job.done);
    });
  }
  function resetJob(job) {
    if (job.sound) { job.sound.stop(); job.sound = null; }
    if (job.cupMesh) { job.st.root.remove(job.cupMesh); job.cupMesh = null; }
    if (job.pfMesh) { WORLD.setPortafilterState(job.pfMesh, 'none'); job.hasPf = false; }
    job.busy = job.done = false;
    job.drink = null;
    job.progress.hide();
  }

  /* ===== 에스프레소 슬롯 업데이트 ===== */
  function updateSlots(dt) {
    env.machines.espressoSlots.forEach(slot => {
      if (!slot.busy || slot.done) return;
      slot.t += dt;
      slot.progress.draw(slot.t / slot.dur, false);
      if (slot.t >= slot.dur) {
        slot.done = true;
        if (slot.sound) { slot.sound.stop(); slot.sound = null; }
        slot.progress.draw(1, true);
        slot.stream.visible = false;
        slot.drink.espresso = 1;
        // 추출 완료 — 포터필터는 사용한 가루(used) 상태가 됨
        slot.pfState = 'used';
        WORLD.setPortafilterState(slot.pf, 'used');
        // 컵 메시를 채워진 버전으로 교체
        slot.st.root.remove(slot.cupMesh);
        const cm = WORLD.makeDrinkMesh(slot.drink);
        cm.position.copy(slot.localPos);
        slot.st.root.add(cm);
        slot.cupMesh = cm;
        AudioFX.bell();
      } else {
        // 커피 줄기 애니메이션
        const s = slot.stream;
        s.position.y = 0.1 + Math.sin(slot.t * 30) * 0.005;
      }
    });
  }

  /* ===== 조준 프롬프트 ===== */
  function promptFor(it) {
    if (!it) return null;
    const E = '<b>[E]</b> ';
    switch (it.id) {
      case 'register': return Customers.frontCustomer() ? E + '주문 받기' : '대기 중인 손님이 없습니다';
      case 'pickup': return held ? E + '서빙하기' : '완성된 음료를 들고 오세요';
      case 'placedItem': return held ? '손을 비우면 집을 수 있어요' : E + itemLabel(it.rec.item) + ' 집기';
      case 'cupHot': return E + '머그컵 잡기';
      case 'cupIce': return E + '아이스컵 잡기';
      case 'cupEsp': return E + '에스프레소 잔 잡기';
      case 'ice': return E + '얼음 담기';
      case 'grinder': {
        const job = env.machines.grinderJob;
        if (job.busy) {
          if (!job.done) return `분쇄 중… ${Math.ceil(job.dur - job.t)}s`;
          return held ? '손을 비우면 포터필터를 꺼낼 수 있어요' : E + '분쇄 완료 — 포터필터 꺼내기';
        }
        if (!held) return '머신에서 포터필터를 분리해 오세요';
        if (held.type !== 'portafilter') return '포터필터를 들고 오세요';
        if (held.state === 'used') return '넉박스에 가루를 먼저 비우세요';
        if (held.state === 'filled') return '이미 분쇄된 포터필터예요';
        if (S.stocks.beans <= 0) return '원두 없음 — 창고에서 보충하세요';
        return E + '원두 분쇄 시작';
      }
      case 'espresso': {
        if (it.slot === 1 && !S.upgrades.dualHead) return '🔒 듀얼 그룹헤드 (업그레이드 필요)';
        const slot = env.machines.espressoSlots[it.slot];
        if (slot.busy) return slot.done ? E + '에스프레소 꺼내기 ☕' : `추출 중… ${Math.ceil(slot.dur - slot.t)}s`;
        if (held && held.type === 'portafilter') return slot.pfState !== 'none' ? '이미 장착되어 있어요' : E + '포터필터 장착';
        if (held && held.type === 'drink' && !held.drink.espresso) {
          if (slot.pfState === 'filled') return E + '에스프레소 추출';
          if (slot.pfState === 'used') return '사용한 가루 — 분리 후 넉박스에 비우세요';
          if (slot.pfState === 'empty') return '빈 포터필터 — 분리 후 그라인더에서 분쇄하세요';
          return '포터필터를 먼저 장착하세요';
        }
        if (slot.pfState === 'none') return '포터필터 없음 — 그라인더에서 분쇄 후 장착하세요';
        if (slot.pfState === 'filled') return E + '포터필터 분리 (장착 완료 ✓ — 컵을 들고 오세요)';
        return E + `포터필터 분리 (${slot.pfState === 'used' ? '사용한 가루 — 넉박스에 비우세요' : '비어 있음 — 분쇄하세요'})`;
      }
      case 'steamer': {
        const job = env.machines.steamerJob;
        if (job.busy) {
          if (!job.done) return `스팀 중… ${Math.ceil(job.dur - job.t)}s`;
          return held ? '손을 비우면 컵을 꺼낼 수 있어요' : E + '컵 꺼내기';
        }
        if (held && held.type === 'drink')
          return held.drink.milk ? E + '컵 올려 우유 거품 만들기' : E + '컵 올려 우유 스팀';
        return '컵을 들고 오세요';
      }
      case 'waterHot': case 'waterCold': {
        const job = env.machines.waterJobs[it.id];
        const nm = it.id === 'waterHot' ? '온수' : '냉수';
        if (job.busy) {
          if (!job.done) return `${nm} 받는 중…`;
          return held ? '손을 비우면 컵을 꺼낼 수 있어요' : E + '컵 꺼내기';
        }
        if (held && held.type === 'drink' && !held.drink.water) return E + `컵 올려 ${nm} 받기`;
        return '물이 없는 컵을 들고 오세요';
      }
      case 'syrup': return E + { vanilla: '바닐라', caramel: '카라멜', choco: '초코' }[it.kind] + ' 시럽 넣기';
      case 'whip': return E + '휘핑크림 올리기';
      case 'dessert': return E + DESSERTS[it.kind].name + ' 꺼내기 (' + fmt(DESSERTS[it.kind].price) + ')';
      case 'knockbox': {
        if (held && held.type === 'portafilter') {
          if (held.state === 'used') return E + '사용한 가루 털어내기';
          return held.state === 'filled' ? '분쇄된 원두는 머신에 장착하세요' : '비울 가루가 없어요';
        }
        return '사용한 포터필터를 들고 오세요';
      }
      case 'trash': {
        if (held && held.type === 'portafilter')
          return held.state === 'used' ? E + '사용한 가루 털어내기 (포터필터는 유지됩니다)' : '⛔ 포터필터는 버릴 수 없어요';
        return E + '버리기';
      }
      case 'restock': {
        const r = RESTOCK[it.kind];
        return E + `${r.name} 보충 +${r.amount} (${fmt(r.price)})`;
      }
    }
    return null;
  }

  /* ===== HUD ===== */
  function updateHUD() {
    $('money').textContent = fmt(S.money);
    $('dayLabel').textContent = 'DAY ' + S.day;
    const stars = Math.round(S.rep / 20);
    $('repRow').firstChild.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars) + ' ';
    $('repVal').textContent = `평판 ${S.rep}`;
    $('lvl').textContent = S.level;
    const prev = LEVEL_XP[S.level - 1], next = LEVEL_XP[S.level];
    if (S.level >= MAX_LVL) {
      $('xpBar').style.width = '100%';
      $('xpTxt').textContent = 'MAX';
    } else {
      $('xpBar').style.width = ((S.xp - prev) / (next - prev) * 100) + '%';
      $('xpTxt').textContent = `${S.xp}/${next} XP`;
    }
    const st = S.stocks;
    $('stocks').innerHTML =
      `<span class="${st.beans <= 5 ? 'low' : ''}">☕ 원두 <span class="val">${st.beans}</span></span><br>` +
      `<span class="${st.milk <= 4 ? 'low' : ''}">🥛 우유 <span class="val">${st.milk}</span></span><br>` +
      `<span class="${st.cups <= 6 ? 'low' : ''}">🥤 컵 <span class="val">${st.cups}</span></span><br>` +
      `<span class="${st.dessert <= 2 ? 'low' : ''}">🍰 디저트 <span class="val">${st.dessert}</span></span>`;
  }

  function updateClock() {
    const os = $('openState');
    if (mode === 'prep') {
      $('clock').textContent = '08:00';
      os.textContent = '● 영업 준비 중'; os.className = 'closed';
      return;
    }
    const h = 9 + (timeSec / DAY_LEN) * 9;
    const hh = Math.min(18, h) | 0;
    const mm = Math.min(59, ((h - hh) * 60) | 0);
    $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    if (open) { os.textContent = '● 영업 중'; os.className = 'open'; }
    else { os.textContent = '● 마감 — 남은 손님 응대'; os.className = 'closed'; }
  }

  /* ===== 레시피북 ===== */
  function renderRecipeBook() {
    const grid = $('recipeGrid');
    grid.innerHTML = '';
    // 에스프레소 샷 추출 과정 안내 카드
    const guide = document.createElement('div');
    guide.className = 'recipe';
    guide.style.gridColumn = '1 / -1';
    guide.innerHTML =
      `<div class="rname"><span>⚙️ 에스프레소 샷 내리는 법</span></div>` +
      `<ol class="rsteps"><li><b>에스프레소 머신</b>에서 <b>[E]</b>로 포터필터를 분리하세요</li>` +
      `<li><b>그라인더</b>에 가져가 <b>[E]</b>로 원두를 분쇄하고 꺼내세요</li>` +
      `<li>분쇄된 포터필터를 머신에 <b>장착</b>하고, 컵을 들고 와 <b>[E]</b>로 추출을 시작하세요</li>` +
      `<li>추출이 끝나면 <b>[E]</b>로 컵을 꺼내세요 — 포터필터는 머신에 남아요</li>` +
      `<li>포터필터를 분리해 <b>넉박스</b>에서 <b>[E]</b>로 가루를 털어내면 다음 샷 준비 완료!</li></ol>`;
    grid.appendChild(guide);
    Object.keys(RECIPES).forEach(k => {
      const r = RECIPES[k];
      const locked = r.lvl > S.level;
      const div = document.createElement('div');
      div.className = 'recipe' + (locked ? ' locked' : '');
      div.innerHTML =
        `<div class="rname"><span>☕ ${r.name}</span><span>${locked ? `<span class="lockTag">🔒 Lv.${r.lvl}</span>` : fmt(drinkPrice(k))}</span></div>` +
        `<ol class="rsteps">${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>`;
      grid.appendChild(div);
    });
    Object.keys(DESSERTS).forEach(k => {
      const d = DESSERTS[k];
      const locked = d.lvl > S.level;
      const div = document.createElement('div');
      div.className = 'recipe' + (locked ? ' locked' : '');
      div.innerHTML =
        `<div class="rname"><span>🍰 ${d.name}</span><span>${locked ? `<span class="lockTag">🔒 Lv.${d.lvl}</span>` : fmt(d.price)}</span></div>` +
        `<ol class="rsteps"><li>쇼케이스에서 꺼내 바로 서빙</li></ol>`;
      grid.appendChild(div);
    });
  }

  /* ===== 하루 사이클 (준비 → 영업 → 정산) ===== */
  let timeSec = 0, open = false;
  let prepPanelOpen = false;
  let pendingTutorial = false;

  // 매장(머신·들고있는것·연출) 초기화 — 준비/영업 진입 시 공용
  function resetStations() {
    setHeld(null);
    clearPlacedItems();
    clearServeFx();
    env.placeIndicator.visible = false;
    env.machines.espressoSlots.forEach(s => {
      if (s.cupMesh) s.st.root.remove(s.cupMesh);
      if (s.sound) { s.sound.stop(); s.sound = null; }
      s.busy = s.done = false; s.cupMesh = null; s.drink = null; s.stream.visible = false;
      s.pfState = 'empty'; WORLD.setPortafilterState(s.pf, 'empty');
      s.progress.hide();
    });
    machineJobs().forEach(j => j && resetJob(j));
  }

  /* --- 영업 준비 단계: 손님 없음 · 시간 정지 · 배치/구매/보충 --- */
  function startPrep() {
    mode = 'prep';
    open = false; timeSec = 0;
    dayStats = freshDayStats();        // 준비~영업 지출이 누적되도록 여기서 1회 초기화
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    if (tut) endTutorial(false);
    Customers.clear();
    resetStations();
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
    $('prepBar').classList.remove('hidden');
    $('hud').classList.remove('hidden');
    mode = 'prep';
    Player.enabled = true;
    updateHUD(); updateClock();
    toast(`DAY ${S.day} 영업 준비 — 재고·배치를 마치고 [O]로 영업 시작 ☕`, 'gold', 4500);
  }

  /* --- 영업 시작: 손님 입장 · 시계 진행 --- */
  function beginOpen() {
    if (mode !== 'prep') return;
    if (typeof Editor !== 'undefined' && Editor.active) Editor.toggle();   // 편집 중이면 종료
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
    $('prepBar').classList.add('hidden');
    open = true; timeSec = 0;
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    spawnTimer = 2.5;
    resetStations();
    mode = 'playing';
    Player.enabled = true;
    updateHUD(); updateClock();
    toast(`DAY ${S.day} — 영업 시작! ☕`, 'gold', 3000);
    AudioFX.bell();
    if (pendingTutorial) { pendingTutorial = false; startTutorial(); }
  }

  function openPrepPanel() {
    if (mode !== 'prep') return;
    prepPanelOpen = true;
    $('ppTitle').textContent = `DAY ${S.day} 영업 준비`;
    renderUpgrades();
    $('prepPanel').classList.remove('hidden');
    Player.enabled = false;
    document.exitPointerLock && document.exitPointerLock();
  }
  function closePrepPanel() {
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
  }

  function spawnInterval() {
    let base = 15 - S.day * 0.6;
    if (S.upgrades.ads) base *= 0.72;
    base *= S.rep >= 70 ? 0.85 : S.rep <= 30 ? 1.3 : 1;
    base = Math.max(5.5, base);
    return base * (0.7 + Math.random() * 0.6);
  }

  function endDay() {
    mode = 'dayEnd';
    Player.enabled = false;
    env.placeIndicator.visible = false;
    document.exitPointerLock && document.exitPointerLock();
    const net = dayStats.revenue + dayStats.tips - dayStats.spent;
    $('deTitle').textContent = `DAY ${S.day} 마감`;
    $('deSub').textContent = dayStats.angry === 0 ? '완벽한 하루였어요! 화난 손님이 한 명도 없었습니다 👏' : '내일은 더 잘할 수 있어요!';
    $('statGrid').innerHTML = [
      [fmt(dayStats.revenue), '매출'],
      [fmt(dayStats.tips), '팁'],
      [fmt(dayStats.spent), '지출(재고)'],
      [(net >= 0 ? '+' : '−') + fmt(Math.abs(net)), '순이익'],
      [dayStats.served + '명', '서빙한 손님'],
      [dayStats.angry + '명', '화난 손님'],
    ].map(([v, l]) => `<div class="stat"><div class="sv">${v}</div><div class="sl">${l}</div></div>`).join('');
    $('prepBar').classList.add('hidden');
    $('dayEnd').classList.remove('hidden');
    $('hud').classList.add('hidden');
    S.day++;
    save();
  }

  function renderUpgrades() {
    const list = $('upgradeList');
    list.innerHTML = '';
    Object.keys(UPGRADES).forEach(k => {
      const u = UPGRADES[k];
      const owned = !!S.upgrades[k];
      const div = document.createElement('div');
      div.className = 'upg' + (owned ? ' owned' : '');
      div.innerHTML =
        `<div><div class="un">${u.name}</div><div class="ud">${u.desc}</div></div>` +
        (owned ? `<span class="ownedTag">보유 중 ✓</span>`
               : `<button class="btn" data-upg="${k}" ${S.money < u.price ? 'disabled' : ''}>${fmt(u.price)}</button>`);
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-upg]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.upg;
        if (S.money < UPGRADES[k].price) return;
        S.money -= UPGRADES[k].price;
        S.upgrades[k] = true;
        AudioFX.cash();
        save();
        renderUpgrades();
        updateHUD();
      };
    });
  }

  /* ===== 저장 ===== */
  function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
  function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && d.money !== undefined) { S = Object.assign(freshState(), d); return true; }
    } catch (e) { /* 손상된 저장 무시 */ }
    return false;
  }

  /* ===== 메인 업데이트 ===== */
  function updatePrep() {
    // 준비 단계: 재고 보충 프롬프트만 표시 (손님·시계 정지)
    const pr = $('prompt');
    if (prepPanelOpen) { pr.classList.add('hidden'); $('crosshair').classList.remove('active'); return; }
    const aimData = Player.aim();
    if (aimData && aimData.id === 'restock') {
      pr.innerHTML = promptFor(aimData);
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else {
      pr.classList.add('hidden'); $('crosshair').classList.remove('active');
    }
  }

  function update(dt) {
    if (mode === 'prep') { updatePrep(); return; }
    if (mode !== 'playing') return;

    // 시간
    timeSec += dt;
    if (open && timeSec >= DAY_LEN) {
      open = false;
      toast('영업 마감! 남은 손님을 응대하세요', 'gold', 3500);
      AudioFX.bell();
    }
    updateClock();

    // 손님 스폰
    if (open) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = spawnInterval();
        Customers.spawn(patienceForNew());
      }
    } else if (Customers.list.length === 0) {
      endDay();
      return;
    }

    Customers.update(dt);
    updateSlots(dt);
    updateJobs(dt);
    updateServeFx(dt);

    // 조준 & 프롬프트 (+ 내려놓기 파란 표시)
    const aimData = Player.aim();
    let p = promptFor(aimData);
    let placePoint = null;
    if (!aimData && held) {
      const pt = Player.aimSurface();
      if (pt) {
        if (placeBlocked(pt)) p = '여기엔 공간이 없어요';
        else { placePoint = pt; p = '<b>[E]</b> 내려놓기'; }
      }
    }
    const ind = env.placeIndicator;
    if (placePoint) {
      indPulse += dt * 5;
      ind.position.set(placePoint.x, placePoint.y + 0.012, placePoint.z);
      ind.scale.setScalar(1 + Math.sin(indPulse) * 0.07);
      ind.visible = true;
    } else {
      ind.visible = false;
    }
    const pr = $('prompt');
    if (p) { pr.innerHTML = p; pr.classList.remove('hidden'); $('crosshair').classList.add('active'); }
    else { pr.classList.add('hidden'); $('crosshair').classList.remove('active'); }

    // 인내심 바만 주기적으로 갱신 (티켓 DOM은 재생성하지 않음)
    barTimer -= dt;
    if (barTimer <= 0) { updateTicketBars(); barTimer = 0.25; }

    updateTutorial();
  }

  /* ===== 외부 API ===== */
  function init(s, e) {
    scene = s; env = e;
    S = freshState();
    initServeFx();
    if (hasSave()) $('btnContinue').classList.remove('hidden');
    renderRecipeBook();

    // E/클릭: 스테이션 상호작용 → 없으면 표면에 내려놓기
    function onUse() {
      const aimData = Player.aim();
      if (aimData) { interact(aimData); return; }
      if (held) {
        const pt = Player.aimSurface();
        if (pt && !placeBlocked(pt)) placeItem(pt);
      }
    }
    // const Editor는 window 속성이 아니므로 typeof로 확인해야 게이트가 작동함
    const editing = () => typeof Editor !== 'undefined' && Editor.active;
    document.addEventListener('keydown', ev => {
      if (mode !== 'playing' && mode !== 'prep') return;
      if (editing()) return;   // 편집 모드 중엔 에디터가 입력 처리
      // 준비 단계 전용 조작
      if (mode === 'prep') {
        if (prepPanelOpen) return;                       // 패널은 버튼으로 조작
        if (ev.code === 'KeyE') onUse();                 // 재고 보충
        else if (ev.code === 'KeyO') beginOpen();        // 영업 시작
        else if (ev.code === 'KeyM') openPrepPanel();    // 관리·업그레이드
        else if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
        return;
      }
      // 영업 중 조작
      if (ev.code === 'KeyE') onUse();
      if (ev.code === 'KeyQ' && held) {
        if (held.type === 'portafilter') { toast('⛔ 포터필터는 버릴 수 없어요', 'bad'); }
        else { setHeld(null); toast('버렸습니다'); }
      }
      if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
      if (ev.code === 'KeyT' && tut) endTutorial(false);
    });
    $('recipeBtn').onclick = () => { if (!editing()) $('recipeBook').classList.toggle('hidden'); };
    $('recipeBook').addEventListener('click', ev => {
      if (ev.target === $('recipeBook')) $('recipeBook').classList.add('hidden'); // 바깥 클릭으로 닫기
    });
    document.addEventListener('mousedown', ev => {
      if (mode === 'playing' && document.pointerLockElement && ev.button === 0 && !editing())
        onUse();
    });
  }

  function newGame() {
    S = freshState();
    renderRecipeBook();
    pendingTutorial = true;      // 튜토리얼은 첫 영업 시작 때 시작
    startPrep();
  }
  function continueGame() {
    load();
    renderRecipeBook();
    startPrep();
  }
  function nextDay() {
    $('dayEnd').classList.add('hidden');
    $('hud').classList.remove('hidden');
    startPrep();
  }

  return {
    init, update, newGame, continueGame, nextDay, hasSave, onAngryLeave,
    beginOpen, openPrepPanel, closePrepPanel,
    get mode() { return mode; },
    set mode(v) { mode = v; },
    get prepPanelOpen() { return prepPanelOpen; },
    get inTutorial() { return !!tut; },
    notifyEditMode(on) {
      if (on) {
        // 내려놓기 표시·레시피북 숨김 (머신 작업은 계속 표시되며 시간만 정지)
        env.placeIndicator.visible = false;
        $('prompt').classList.add('hidden');
        $('recipeBook').classList.add('hidden');
      }
    },
    isBrewing: () => env.machines.espressoSlots.some(s => s.busy && !s.done),
    _debug: { closeNow() { timeSec = DAY_LEN + 1; open = false; Customers.clear(); orders = []; $('tickets').innerHTML = ''; } },
  };
})();
