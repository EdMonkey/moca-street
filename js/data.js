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
  };
  const RESTOCK = {
    beans:   { name: '원두',   amount: 30, price: 8000 },
    milk:    { name: '우유',   amount: 20, price: 6000 },
    cups:    { name: '컵',     amount: 40, price: 5000 },
    dessert: { name: '디저트', amount: 12, price: 9000 },
  };
  const DAY_LEN = 300;            // 실제 5분 = 게임 9시간 (09:00~18:00)
  const SAVE_KEY = 'mochaStreetSave_v1';

  // 경영(Stage 3): 임대료 = 고정 지출, 일일 목표 = 동기, 폐업 = 소프트 실패
  const RENT_BASE = 8000, RENT_PER_DAY = 2000;
  const BANKRUPT_LIMIT = -50000;
  const rentFor = day => RENT_BASE + (day - 1) * RENT_PER_DAY;
  const dailyGoalFor = day => 5000 + day * 2500;   // 임대료 차감 후 목표 순이익

  // 탬핑 미니게임 밸런스
  const TAMP_DUR = 2.2;           // 게이지가 끝까지 차는 시간(초)
  const TAMP_MIN = 0.45;          // 이보다 일찍 떼면 약하게 눌림(재시도)
  const TAMP_PERF_W = 0.10;       // 퍼펙트 존 폭
  const TAMP_PERF_MIN = 0.55, TAMP_PERF_MAX = 0.80; // 퍼펙트 존 시작 위치 랜덤 범위

  // 라떼아트 미니게임 밸런스 (자유 푸어 — 우유를 흔들며 흐름을 만들어 무늬를 그린다)
  const ART_VOL = 3.2;            // 한 번에 부을 수 있는 우유 양(초). 다 떨어지면 판정.
  const ART_PERFECT = 0.70, ART_GOOD = 0.42;   // 종합 점수 임계값 (perfect / good)
  const ART_TIP_PERFECT = 0.15, ART_TIP_GOOD = 0.08;  // 팁 보너스 비율

  return {
    RECIPES, DESSERTS, LEVEL_XP, MAX_LVL, UPGRADES, EQUIPMENT, RESTOCK,
    DAY_LEN, SAVE_KEY, RENT_BASE, RENT_PER_DAY, BANKRUPT_LIMIT, rentFor, dailyGoalFor,
    TAMP_DUR, TAMP_MIN, TAMP_PERF_W, TAMP_PERF_MIN, TAMP_PERF_MAX,
    ART_VOL, ART_PERFECT, ART_GOOD, ART_TIP_PERFECT, ART_TIP_GOOD,
  };
})();
