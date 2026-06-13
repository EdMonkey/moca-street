/* ============================================================
 * audio.js — 사운드 (WebAudio 물리 모델링 신스)
 * 게임 로직과 독립적인 효과음 합성. 전역 AudioFX로 노출.
 * (오디오 파일 없이 모든 소리를 실시간 합성)
 * ============================================================ */
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

  /* ----- 탬핑: 누르는 동안 차오르는 험(음 상승) + 완료 '쿵' + 퍼펙트 차임 ----- */
  function tampHold(dur = 1.3) {
    const a = ensure(), t0 = a.currentTime;
    const o = a.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t0);
    o.frequency.linearRampToValueAtTime(150, t0 + dur);   // 게이지가 차오르며 음이 높아짐
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.06, t0 + 0.1);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t0);
    return sustainedHandle(() => { const t = a.currentTime; g.gain.setTargetAtTime(0, t, 0.05); o.stop(t + 0.2); }, dur + 0.3);
  }
  function tampDone() {
    const t0 = ensure().currentTime;
    tone(120, 0.14, 'sine', 0.18, 0, 58);          // 단단한 압착 임팩트
    burst(t0, 200, 0.07, 0.12, 1, 'lowpass');
    burst(t0, 1600, 0.03, 0.08, 2, 'bandpass');    // 가루 다져지는 사각거림
    tone(880, 0.05, 'sine', 0.05, 0.04);           // 마무리 클릭
  }
  // 퍼펙트 탬핑 보너스 차임
  function tampPerfectSfx() {
    [1047, 1319, 1568].forEach((f, i) => tone(f, 0.16, 'sine', 0.1, 0.04 + i * 0.05));
    tone(2093, 0.25, 'sine', 0.06, 0.17);
  }

  return {
    ensure,
    // 신규 사운드
    cupClink, grind, pourWater, steam, brewing, ice, syrupPump, whipSpray, trashThud, metalClack, knock, serveSuccess, tampHold, tampDone, tampPerfectSfx,
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
