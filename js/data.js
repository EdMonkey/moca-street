/* ============================================================
 * data.js — 정적 데이터 · 밸런스 수치
 * 메뉴/디저트/업그레이드/장비/창고/경제/탬핑 등 "튜닝하는 값"을 모음.
 * 게임 로직(game.js)과 분리해 콘텐츠·밸런스 수정 시 충돌을 줄인다.
 * 전역 DATA로 노출. (game.js 상단에서 구조분해로 가져다 씀)
 * ============================================================ */
const DATA = (() => {

  // target: {cup, ice, espresso, water, milk, foam, syrup, whip}
  // seq: 정확한 제조 순서(재료 추가 순서). 지키면 추가 팁 + 평판. 컵 종류는 시작 용기라 제외.
  //   에스프레소+물 음료는 '물 먼저 → 샷 나중'이라야 크레마가 위에 살아남아 정답.
  const RECIPES = {
    espresso:   { name: '에스프레소',        price: 2500, lvl: 1, target: { cup: 'espresso', espresso: 1 },
      seq: ['espresso'], steps: ['에스프레소 잔', '에스프레소 샷'] },
    americano:  { name: '아메리카노',        price: 3000, lvl: 1, target: { cup: 'hot', espresso: 1, water: 'hot' },
      seq: ['water', 'espresso'], steps: ['머그컵', '온수', '에스프레소 샷 (크레마 유지)'] },
    iceAmericano:{ name: '아이스 아메리카노', price: 3500, lvl: 2, target: { cup: 'ice', ice: 1, espresso: 1, water: 'cold' },
      seq: ['ice', 'water', 'espresso'], steps: ['아이스컵', '얼음', '냉수', '에스프레소 샷 (크레마 유지)'] },
    latte:      { name: '카페라떼',          price: 4000, lvl: 2, target: { cup: 'hot', espresso: 1, milk: 1 },
      seq: ['espresso', 'milk'], steps: ['머그컵', '에스프레소 샷', '스팀밀크'] },
    iceLatte:   { name: '아이스 라떼',       price: 4500, lvl: 3, target: { cup: 'ice', ice: 1, espresso: 1, milk: 1 },
      seq: ['ice', 'espresso', 'milk'], steps: ['아이스컵', '얼음', '에스프레소 샷', '스팀밀크'] },
    vanillaLatte:{ name: '바닐라 라떼',      price: 4800, lvl: 3, target: { cup: 'hot', espresso: 1, milk: 1, syrup: 'vanilla' },
      seq: ['espresso', 'milk', 'syrup'], steps: ['머그컵', '에스프레소 샷', '스팀밀크', '바닐라 시럽'] },
    cappuccino: { name: '카푸치노',          price: 4500, lvl: 4, target: { cup: 'hot', espresso: 1, milk: 1, foam: 1 },
      seq: ['espresso', 'milk', 'foam'], steps: ['머그컵', '에스프레소 샷', '스팀밀크', '우유 거품(스티머 1회 더)'] },
    mocha:      { name: '카페모카',          price: 5000, lvl: 4, target: { cup: 'hot', espresso: 1, milk: 1, syrup: 'choco', whip: 1 },
      seq: ['espresso', 'milk', 'syrup', 'whip'], steps: ['머그컵', '에스프레소 샷', '스팀밀크', '초코 시럽', '휘핑크림'] },
    caramelMac: { name: '카라멜 마끼아또',   price: 5300, lvl: 5, target: { cup: 'ice', ice: 1, espresso: 1, milk: 1, syrup: 'caramel' },
      seq: ['ice', 'espresso', 'milk', 'syrup'], steps: ['아이스컵', '얼음', '에스프레소 샷', '스팀밀크', '카라멜 시럽'] },
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
  // 구매 가능한 추가 장비 (영업 준비 단계에서 구입 → 빈 카운터에 배치)
  const EQUIPMENT = {
    grinder:  { name: '추가 그라인더',      desc: '원두를 병렬로 분쇄해 병목 해소', price: 18000, w: 0.45, d: 0.5, max: 2 },
    espresso: { name: '2번째 에스프레소 머신', desc: '추출 슬롯 2개 추가',          price: 35000, w: 1.45, d: 0.8, max: 1 },
    steamer:  { name: '추가 밀크 스티머',    desc: '우유를 병렬로 스팀',            price: 15000, w: 0.62, d: 0.55, max: 2 },
    pitcher:  { name: '추가 스팀피처',      desc: '카운터 위 스팀피처 1개 추가',   price: 8000,  w: 0.18, d: 0.18, max: 3 },
  };
  const RESTOCK = {
    beans:   { name: '원두',   amount: 30, price: 8000 },
    milk:    { name: '우유',   amount: 20, price: 6000 },
    cups:    { name: '컵',     amount: 40, price: 5000 },
    dessert: { name: '디저트', amount: 12, price: 9000 },
  };
  const SAVE_KEY = 'mochaStreetSave_v1';
  // 하루 길이·임대료·목표·손님 흐름·인내심은 아래 BALANCE(economy/flow/patience)에 모음

  // ============================================================
  // BALANCE — 게임플레이 밸런스 단일 표. 여기 숫자만 고치면 튜닝됨.
  // ============================================================
  const BALANCE = {
    // ── 그라인더 분쇄도 (게이지 0 가늘 ~ 1 굵음) ──
    grind: {
      dur: 1.8,                        // 분쇄 게이지 시간(초)
      idealMin: 0.46, idealMax: 0.54,  // 이상 분쇄도 구간(눈금 ~4)
      qualityFalloff: 0.40,            // 이상 밖으로 이만큼 벗어나면 품질 0 → 만족도 감점
      speedFine: 1.5,                  // 가늚: (idealMin-grind)당 추출시간 ↑ 계수
      speedCoarse: 0.8,                // 굵음: (grind-idealMax)당 추출시간 ↓ 계수
      tipPerfect: 0.10,                // 이상 분쇄 팁 보너스(가격 대비)
    },
    // ── 탬핑 강도 (게이지 0~1, 위=강하게 다짐) ──
    tamp: {
      dur: 2.2,                        // 탬핑 게이지 시간(초)
      zoneW: 0.10,                     // 퍼펙트(초록) 존 폭
      zoneMin: 0.40, zoneMax: 0.50,    // 존 시작 위치 랜덤 범위(중앙)
      fail: 0.15,                      // 이보다 약하게 떼면 실패(재시도)
      strong1: 1.25, strong2: 1.6,     // 강함 1·2단계 추출시간 배율(느림)
      weak1: 0.82, weak2: 0.62,        // 약함 1·2단계 배율(빠름)
      strong2Over: 0.18,               // 존 위로 이만큼 넘으면 강 2단계
      weak2Under: 0.15,                // 존 아래로 이만큼이면 약 2단계
    },
    // ── 에스프레소 추출 ──
    extract: {
      baseDur: 3.4, fastDur: 2.0,      // 기본/고속보일러 추출시간(초)
      speedFloor: 0.4,                 // 추출시간 최소 배율(너무 빨라지지 않게)
      channelPenalty: 0.2,             // 탬핑 불완전(채널링) → 추출 컨디션 감점
      grindPenalty: 0.4,               // 분쇄 빗나감 최대 추출 컨디션 감점
    },
    // ── 손님 만족도 → 표정 + 평판 (만족도 0~1) ──
    satisfaction: {
      freshBase: 0.4,                  // 만족도 = 추출컨디션 × (freshBase + (1-freshBase)×신선도)
      shotMismatch: 0.55,              // 주문과 샷 수 다름 → 만족도 감점
      waitFrac: 0.25, waitPenalty: 0.2,   // 인내심 이 비율 미만이면 감점
      fastFrac: 0.6,  fastBonus: 0.05,    // 인내심 이 비율 초과면 가산
      moodGreat: 0.9, moodOk: 0.6,     // 표정 임계값(만족/보통, 그 외 불만)
      repGreat: 2, repOk: 1, repBad: -1, repTerrible: -2,  // 만족도 구간별 평판 변화
      repTerribleAt: 0.4,              // 만족도 이 미만이면 repTerrible
      repBonusOrder: 1, repBonusArt: 1,   // 정확 순서·라떼아트 퍼펙트 평판 보너스
    },
    // ── 팁 (가격 대비 비율) ──
    tip: {
      base: 0.3,                       // 기본 팁 = 가격 × base × 인내심 × 평판계수
      repCoef: 250,                    // 평판 팁 계수 (0.7 + rep/repCoef)
      masterBonus: 1.12,               // 마스터 바리스타(최대 레벨) 팁 배율
      perfect: 0.15, order: 0.15, foam: 0.15,  // 크레마·정확순서·마이크로폼 보너스
      artPerfect: 0.15, artGood: 0.08, // 라떼아트
      dosePerfect: 0.08,               // 시럽/휘핑 정량
      shotMismatch: 0.4,               // 샷 불일치 시 팁 배율(대폭 감소)
    },
    // ── 신선도 (음료가 식는 시간) ──
    freshness: { full: 30, dead: 90 }, // full초까지 신선 → dead초에 최저
    // ── 주문/메뉴 ──
    order: { extraShotPrice: 500, extraShotChance: 0.25, dessertChance: 0.32 },
    // ── 손님 흐름 (스폰 간격, 초) ──
    flow: {
      spawnBase: 20, spawnDayStep: 0.6,       // 기준 간격 = spawnBase − day×spawnDayStep
      spawnAds: 0.72,                          // SNS 광고 업그레이드 시 간격 배율
      spawnRepHigh: 0.85, spawnRepLow: 1.3,    // 평판 ≥70 / ≤30 간격 배율
      spawnFloor: 8,                           // 최소 간격(초)
      spawnRandMin: 0.7, spawnRandSpan: 0.6,   // 실제 간격 = 기준 × (min ~ min+span)
    },
    // ── 손님 인내심 (대기 가능 시간) ──
    patience: { base: 80, dayStep: 1.5, interiorBonus: 1.35, floor: 45 },
    // ── 경영 ──
    economy: {
      dayLen: 300,                             // 하루 길이(초) = 실제 5분
      rentBase: 8000, rentPerDay: 2000,        // 임대료 = rentBase + (day−1)×rentPerDay
      bankruptLimit: -50000,                   // 폐업 한도(원)
      goalBase: 5000, goalPerDay: 2500,        // 일일 목표 = goalBase + day×goalPerDay
    },
    // ── 기타 미니게임 (스팀·도징·라떼아트) ──
    minigame: {
      perfW: 0.10, perfMin: 0.55, perfMax: 0.80,    // 스팀·도징 공용 퍼펙트 존(폭/시작범위)
      doseDur: 1.6, doseMin: 0.30,                  // 도징 게이지(시간/최소)
      artVol: 3.2, artPerfect: 0.70, artGood: 0.42, // 라떼아트(우유양/점수 임계)
    },
  };

  // balance.html(밸런스 에디터)에서 저장한 오버라이드를 덮어씀 (알려진 숫자 키만 — 안전)
  try {
    if (typeof localStorage !== 'undefined') {
      const ov = JSON.parse(localStorage.getItem('mochaBalance') || 'null');
      if (ov) for (const sec in ov) if (BALANCE[sec]) for (const k in ov[sec])
        if (k in BALANCE[sec] && typeof ov[sec][k] === 'number' && isFinite(ov[sec][k])) BALANCE[sec][k] = ov[sec][k];
    }
  } catch (e) { /* 무시 — 기본값 사용 */ }

  // 평면 상수 → 모두 BALANCE를 가리킴 (하위 호환, 단일 소스)
  const TAMP_MIN = 0.45;   // (현재 탬핑은 BALANCE.tamp.fail 사용 — 미사용)
  const TAMP_PERF_W = BALANCE.minigame.perfW;
  const TAMP_PERF_MIN = BALANCE.minigame.perfMin, TAMP_PERF_MAX = BALANCE.minigame.perfMax;
  const ART_VOL = BALANCE.minigame.artVol, ART_PERFECT = BALANCE.minigame.artPerfect, ART_GOOD = BALANCE.minigame.artGood;
  const DOSE_DUR = BALANCE.minigame.doseDur, DOSE_MIN = BALANCE.minigame.doseMin;
  const TAMP_DUR = BALANCE.tamp.dur, GRIND_DUR = BALANCE.grind.dur;
  const GRIND_IDEAL_MIN = BALANCE.grind.idealMin, GRIND_IDEAL_MAX = BALANCE.grind.idealMax;
  const GRIND_TIP_PERFECT = BALANCE.grind.tipPerfect;
  const ART_TIP_PERFECT = BALANCE.tip.artPerfect, ART_TIP_GOOD = BALANCE.tip.artGood;
  const DOSE_TIP_PERFECT = BALANCE.tip.dosePerfect;
  // 경영·하루 (BALANCE.economy)
  const DAY_LEN = BALANCE.economy.dayLen;
  const RENT_BASE = BALANCE.economy.rentBase, RENT_PER_DAY = BALANCE.economy.rentPerDay;
  const BANKRUPT_LIMIT = BALANCE.economy.bankruptLimit;
  const rentFor = day => BALANCE.economy.rentBase + (day - 1) * BALANCE.economy.rentPerDay;
  const dailyGoalFor = day => BALANCE.economy.goalBase + day * BALANCE.economy.goalPerDay;

  return {
    RECIPES, DESSERTS, LEVEL_XP, MAX_LVL, UPGRADES, EQUIPMENT, RESTOCK,
    DAY_LEN, SAVE_KEY, RENT_BASE, RENT_PER_DAY, BANKRUPT_LIMIT, rentFor, dailyGoalFor,
    TAMP_DUR, TAMP_MIN, TAMP_PERF_W, TAMP_PERF_MIN, TAMP_PERF_MAX,
    ART_VOL, ART_PERFECT, ART_GOOD, ART_TIP_PERFECT, ART_TIP_GOOD,
    DOSE_DUR, DOSE_MIN, DOSE_TIP_PERFECT,
    GRIND_DUR, GRIND_IDEAL_MIN, GRIND_IDEAL_MAX, GRIND_TIP_PERFECT,
    BALANCE,
  };
})();
