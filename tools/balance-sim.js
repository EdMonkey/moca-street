#!/usr/bin/env node
/* ============================================================
 * balance-sim.js — 모카 스트리트 경제 밸런스 헤드리스 시뮬레이터
 *
 * js/game.js 의 실제 상수를 그대로 옮겨와, 하루 단위로
 *  - 손님 공급량(스폰 기반 상한)
 *  - 플레이어 처리량(손 속도 기반 추정 상한)
 *  - 레벨 진행(누적 XP)
 *  - 매출/팁/재료비/임대료/일일목표
 * 를 계산해 "난이도 곡선이 어디서 역전·붕괴되는지" 표로 출력한다.
 *
 * 사용법:  node tools/balance-sim.js
 * 주의:  게임플레이를 바꾸지 않는 순수 분석 도구다.
 * ============================================================ */

'use strict';

/* ---------- game.js 에서 복제한 상수 (단일 출처: js/game.js) ---------- */
const DAY_LEN = 300;                 // 실제 5분 = 게임 9시간
const MAX_LVL = 6;
const LEVEL_XP = [0, 120, 320, 620, 1050, 1600];
const RENT_BASE = 8000, RENT_PER_DAY = 2000;
const rentFor = day => RENT_BASE + (day - 1) * RENT_PER_DAY;
const dailyGoalFor = day => 5000 + day * 2500;

// 음료: price, 해금 레벨(lvl), 우유 사용 여부(milk)
const RECIPES = {
  espresso:    { price: 2500, lvl: 1, milk: false },
  americano:   { price: 3000, lvl: 1, milk: false },
  iceAmericano:{ price: 3500, lvl: 2, milk: false },
  latte:       { price: 4000, lvl: 2, milk: true  },
  iceLatte:    { price: 4500, lvl: 3, milk: true  },
  vanillaLatte:{ price: 4800, lvl: 3, milk: true  },
  cappuccino:  { price: 4500, lvl: 4, milk: true  },
  mocha:       { price: 5000, lvl: 4, milk: true  },
  caramelMac:  { price: 5300, lvl: 5, milk: true  },
};
const DESSERTS = {
  croissant: { price: 3500, lvl: 3 },
  muffin:    { price: 3000, lvl: 3 },
  cake:      { price: 5500, lvl: 5 },
};
const DESSERT_CHANCE = 0.32;

// 재료 원가 (창고 보충가 ÷ 수량)
const COST = {
  cup:     5000 / 40,   // 125 (음료마다 1)
  bean:    8000 / 30,   // ≈266.7 (음료마다 1샷)
  milk:    6000 / 20,   // 300 (우유 음료만)
  dessert: 9000 / 12,   // 750 (디저트 주문 시)
};

/* ---------- 스폰/완화 (game.js 로직 복제) ---------- */
// 초반 며칠 완화 (Task 3 반영)
const earlyEase = day => (day <= 3 ? [1.6, 1.3, 1.12][day - 1] : 1);

// 평균 스폰 간격(초). 랜덤 계수 (0.7 + rand*0.6) 의 기대값은 1.0
function avgSpawnInterval(day, { ads = false, rep = 50 } = {}) {
  let base = 15 - day * 0.6;
  base *= earlyEase(day);
  if (ads) base *= 0.72;
  base *= rep >= 70 ? 0.85 : rep <= 30 ? 1.3 : 1;
  return Math.max(5.5, base);
}

/* ---------- 레벨/메뉴 ---------- */
function levelForXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LVL && xp >= LEVEL_XP[lvl]) lvl++;
  return lvl;
}
const unlockedRecipes = lvl => Object.values(RECIPES).filter(r => r.lvl <= lvl);
const unlockedDesserts = lvl => Object.values(DESSERTS).filter(d => d.lvl <= lvl);

// 한 주문의 기대 구성값 (음료 1 + 32% 디저트)
function orderEconomics(lvl, { rep = 50, grinder = false, fracServed = 0.6, perfectRate = 0.5 } = {}) {
  const drinks = unlockedRecipes(lvl);
  const desserts = unlockedDesserts(lvl);
  const priceMul = grinder ? 1.15 : 1;

  const avgDrink = drinks.reduce((s, r) => s + r.price, 0) / drinks.length * priceMul;
  const milkFrac = drinks.filter(r => r.milk).length / drinks.length;
  const avgDessert = desserts.length ? desserts.reduce((s, d) => s + d.price, 0) / desserts.length : 0;

  const total = avgDrink + DESSERT_CHANCE * avgDessert;

  // 팁: total*0.3*frac*(0.7+rep/250)*master, 퍼펙트 +15%
  const master = lvl >= MAX_LVL ? 1.12 : 1;
  let tip = total * 0.3 * fracServed * (0.7 + rep / 250) * master;
  tip += total * 0.15 * perfectRate;          // 퍼펙트 탬핑 기대 보너스

  // 재료비: 컵 + 원두 + (우유 음료면 우유) + (디저트면 디저트)
  const cost = COST.cup + COST.bean + milkFrac * COST.milk + DESSERT_CHANCE * COST.dessert;

  return { total, tip, cost, xpPerOrder: avgDrink / priceMul / 100 };
}

/* ---------- 처리량 상한 (손 속도 추정) ----------
 * 정밀 측정이 아니라 보수적 추정치다. 단일 머신/수동일 때 1주문을
 * 효과적으로 ~14초에 처리(이동+분쇄+탬핑+추출+조립, 일부 비동기 겹침)한다고 보고,
 * 완비(듀얼헤드+고속추출+2번째 머신+자동스티머)면 처리 시간 절반으로 가정. */
function processingCap(equipped) {
  const secsPerOrder = equipped ? 7.5 : 14;
  return Math.floor(DAY_LEN / secsPerOrder);
}

/* ---------- 하루 시뮬레이션 ---------- */
function simulateDay(day, opts) {
  const lvl = levelForXp(opts.xp);
  const interval = avgSpawnInterval(day, opts);
  const supply = Math.floor(DAY_LEN / interval);        // 공급 상한(오는 손님 수)
  const cap = processingCap(opts.equipped);             // 처리 상한(손 속도)
  const served = Math.min(supply, cap);

  const e = orderEconomics(lvl, opts);
  const revenue = served * e.total;
  const tips = served * e.tip;
  const matCost = served * e.cost;
  const rent = rentFor(day);
  const net = revenue + tips - matCost - rent;
  const goal = dailyGoalFor(day);

  return {
    day, lvl, interval, supply, cap, served,
    revenue, tips, matCost, rent, net, goal,
    surplus: net - goal,
    xpGain: served * e.xpPerOrder,
  };
}

/* ---------- 시나리오 실행 ---------- */
function runScenario(name, baseOpts) {
  const rows = [];
  let xp = 0, cumNet = 0, bankruptDay = null, reversalDay = null;
  for (let day = 1; day <= 80; day++) {
    const r = simulateDay(day, { ...baseOpts, xp });
    xp += r.xpGain;
    cumNet += r.net;
    if (reversalDay === null && r.surplus < 0) reversalDay = day;  // 목표 미달 시작
    if (bankruptDay === null && cumNet <= -50000) bankruptDay = day;
    rows.push(r);
  }
  return { name, rows, reversalDay, bankruptDay };
}

/* ---------- 출력 ---------- */
const won = n => Math.round(n).toLocaleString('en-US');
const SHOW_DAYS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40, 50, 60, 70, 80];

function printScenario(s) {
  console.log(`\n### ${s.name}\n`);
  console.log('| Day | Lv | 간격(s) | 공급 | 처리상한 | 서빙 | 매출+팁 | 재료비 | 임대료 | 순이익 | 목표 | 목표대비 |');
  console.log('|----:|---:|------:|---:|-----:|---:|-------:|------:|------:|------:|-----:|-------:|');
  for (const r of s.rows) {
    if (!SHOW_DAYS.includes(r.day)) continue;
    const mark = r.surplus < 0 ? '🔴' : '🟢';
    console.log(`| ${r.day} | ${r.lvl} | ${r.interval.toFixed(1)} | ${r.supply} | ${r.cap} | ${r.served} | ${won(r.revenue + r.tips)} | ${won(r.matCost)} | ${won(r.rent)} | ${won(r.net)} | ${won(r.goal)} | ${mark} ${won(r.surplus)} |`);
  }
  console.log(`\n- 일일목표 첫 미달(역전) 시작일: **${s.reversalDay ? 'Day ' + s.reversalDay : '없음(80일 내)'}**`);
  console.log(`- 누적 −50,000 폐업 도달일: **${s.bankruptDay ? 'Day ' + s.bankruptDay : '없음(80일 내)'}**`);
}

console.log('# 모카 스트리트 — 밸런스 시뮬레이션 결과');
console.log(`\nDAY_LEN=${DAY_LEN}s · 임대료=${RENT_BASE}+${RENT_PER_DAY}/일 · 목표=5000+2500×일`);
console.log('가정: frac(서빙시 남은 인내심)=0.6, 퍼펙트율=0.5. 처리상한은 손속도 추정치(아래 본문 참조).');

const scenarios = [
  runScenario('A. 기본 — 업그레이드 없음 / 평판 50 / 미완비', { ads: false, rep: 50, grinder: false, equipped: false }),
  runScenario('B. 완비 — 광고+그라인더 / 평판 100 / 장비완비', { ads: true, rep: 100, grinder: true, equipped: true }),
];
scenarios.forEach(printScenario);
