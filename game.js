// ジオラマアイランド / Diorama Island
// 中身は3D、見た目はドット絵の浮島街づくりタイクーン
import * as THREE from 'three';

/* =========================================================
   設定（言語など。セーブデータとは別に保存）
   ========================================================= */
const SETTINGS_KEY = 'di_settings_v1';
const SET = Object.assign(
  {lang: (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en', icons:'auto', alerts:true, sound:true, pixel:3, shake:true, shadows:true, ui:1},
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch(e){ return {}; } })()
);
function saveSettings(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SET)); } catch(e){} }
const L = (ja, en) => SET.lang === 'en' ? en : ja;          // その場で日英を切り替える
const N = x => Array.isArray(x) ? (SET.lang === 'en' ? x[1] : x[0]) : x;
const TOUCH = matchMedia('(pointer: coarse)').matches;

/* =========================================================
   調整パラメーター（数値はここに集約）
   ========================================================= */
const P = {
  pixelScale: 3, dayLen: 100, dayFrac: 0.72,
  startGold: 350, wage: 10, hireBase: 50, hireGrow: 1.16,
  walk: 1.7, chopTime: 1.5, quarryTime: 1.8, digTime: 2.0,
  treeHP: 4, rockHP: 8, saplingTime: 45, regrowTick: 4, regrowP: 0.0035,
  satDrop: 0.02, satRecover: 0.008, satFloor: 0.3,
  goal: 12000, haulCap: 4, moveTime: 10, moveCost: 10, buildTime: 3,
  reserveOre: 300, ugRows: 5,              // 地下の鉄鉱石（大量だが無尽蔵ではない）。断面図の段数
  balloonEvery: 28,                        // 交易気球が来る間隔（秒）
  farFrom: 3, farK: 0.12,                  // 持ち場から3マスを超えると急に効率が落ちる
};
/* =========================================================
   島ごとの設定（空の島 → 酪農の島：放牧 → 農耕の島：川と四季）
   セーブは島ごとに持ち、いま居る島（cur）だけを動かす
   ========================================================= */
const SAVE_KEY = 'di_save_v2', OLD_KEY = 'di_save_v1';
let saveBox = (() => { try { const o = JSON.parse(localStorage.getItem(SAVE_KEY)); if (o && o.ver === 2 && o.islands) return o; } catch(e){} return {ver:2, cur:'sky', islands:{}}; })();
const ISLANDS = {
  sky: {n:['空の島','Sky Island'], items:['log','plank','furn','ore','ingot','gear'], tree:'log', rock:'ore', chop:'camp',
    treeN:['木','Trees'], sapN:['苗木','saplings'], forestN:['森','forest'], goal:12000, costMap:{}, tiles:[0x86c95e, 0x7bbd56], rockCol:[0xa070c8, 0xd8a8f0],
    craft:['furn','gear'], forest:['plank','furn'], mid:'plank', hi:'furn', top:'gear', axInd:[['gear',0.5],['ingot',0.1]], axCraft:[['furn',0.06]],
    contract:() => countB('workshop') ? 'furn' : countB('sawmill') ? 'plank' : 'log', sapT:45, spread:1, seedP:0},
  dairy: {n:['酪農の島','Dairy Island'], items:['hay','milk','butter','cheese','aged','salt'], tree:'hay', rock:'salt', chop:'mower',
    treeN:['牧草','Grass'], sapN:['芽','sprouts'], forestN:['牧草地','meadows'], goal:140000, treeHP:6, costMap:{ore:'salt', ingot:'cheese'}, tiles:[0x9cd06a, 0x90c460], rockCol:[0xe8a8c0, 0xfff0f4],
    craft:['cheese','aged'], forest:['milk','butter'], mid:'milk', hi:'cheese', top:'aged', axInd:[['aged',0.5],['butter',0.05]], axCraft:[['cheese',0.3]],
    contract:() => countB('creamery') ? 'cheese' : countB('churn') ? 'butter' : countB('barn') ? 'milk' : 'hay', sapT:30, spread:2, seedP:0.6},
  farm: {n:['農耕の島','Farm Island'], items:['wheat','rice','veg','flour','cake','pickle','sake'], tree:'wheat', rock:null, chop:'farmhut',
    treeN:['実り','Crops'], sapN:['種','seeds'], forestN:['田畑','fields'], goal:200000, treeHP:4, costMap:{ore:'wheat', ingot:'cake'}, tiles:[0x93cc5c, 0x87c052], rockCol:[0x3f8fd0, 0x8fd0f8],
    craft:['cake','sake'], forest:['rice','veg','pickle'], mid:'flour', hi:'cake', top:'sake', axInd:[['flour',0.03],['sake',0.12]], axCraft:[['cake',0.12]],
    contract:() => countB('patisserie') ? 'cake' : countB('picklery') ? 'pickle' : countB('windmill') ? 'flour' : 'wheat', sapT:45, spread:0, seedP:0},
};
/* 訪問リンク：#visit=<島の形>。サーバーは使わず、URLそのものに島が入っている */
const SH_VER = 1, SH_ISL = ['sky','dairy','farm'];
const SH_TYPES = ['warehouse','camp','quarry','forester','sawmill','workshop','smelter','factory','recycle','house','bakery','park','bath','fun','mower','saltpit','seeder','barn','churn','creamery','cellar','farmhut','windmill','picklery','patisserie','brewery'];
const SH_NAME_MAX = 16, VISIT = (() => {
  const m = /^#visit=([A-Za-z0-9_-]{100,1200})$/.exec(location.hash); if (!m) return null;
  try {
    const bin = atob(m[1].replace(/-/g,'+').replace(/_/g,'/')), b = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    if (b[0] !== SH_VER || !ISLANDS[SH_ISL[b[1]]]) return null;
    let p = 2; const u8 = () => { if (p >= b.length) throw 0; return b[p++]; };
    const v = {isl:SH_ISL[b[1]], day:(u8() << 8 | u8()) || 1, upg:u8(), mode:u8(), land:[u8(),u8(),u8(),u8()], cows:Math.min(24, u8()), bell:u8(), cells:[]};
    const n = u8(); if (n > SH_NAME_MAX*4 || p + n > b.length) return null;
    v.name = [...new TextDecoder().decode(b.slice(p, p+n))].slice(0, SH_NAME_MAX).join(''); p += n;
    if (v.land.some(x => x > 11) || v.bell > 143) return null;
    for (let i=0;i<144;i++){
      const c = u8();
      if (c < 16){ if (c > 14) return null; v.cells.push({c}); continue; }
      const type = SH_TYPES[Math.floor((c-16)/5)]; if (!type) return null;
      v.cells.push({c, type, lvl:(c-16)%5 + 1, look:type === 'house' ? u8() : 0});
    }
    return v;
  } catch(e){ return null; }
})();
const ISLAND = (() => { if (VISIT) return VISIT.isl; const q = /debug/.test(location.search) ? /[?&]isl=(\w+)/.exec(location.search)?.[1] : null; const k = q || saveBox.cur || 'sky'; return ISLANDS[k] ? k : 'sky'; })();
const ISL = ISLANDS[ISLAND];
P.goal = ISL.goal; if (ISL.treeHP) P.treeHP = ISL.treeHP;
const islName = k => ISLANDS[k]?.n || ['？','?'];
const ISL_ORDER = ['sky','dairy','farm'];
const isFarm = ISLAND === 'farm';
const ITEMS = {
  wheat: {n:['小麦','Wheat'],          p:11,  c:0xe8c040},
  rice:  {n:['米','Rice'],             p:14,  c:0xf4f0d0},
  veg:   {n:['かぼちゃ','Pumpkins'],   p:13,  c:0xf08030},
  flour: {n:['小麦粉','Flour'],        p:30,  c:0xfff8e8},
  cake:  {n:['焼き菓子','Cakes'],      p:115, c:0xd89058},
  pickle:{n:['保存食','Preserves'],    p:85,  c:0xc05030},
  sake:  {n:['地酒','Rice Wine'],      p:500, c:0x9ad0e8},
  hay:   {n:['干し草','Hay'],           p:9,   c:0xd8c060},
  milk:  {n:['牛乳','Milk'],            p:24,  c:0xf4f4ee},
  butter:{n:['バター','Butter'],        p:110, c:0xf0d860},
  cheese:{n:['チーズ','Cheese'],        p:170, c:0xf0b040},
  aged:  {n:['熟成チーズ','Aged Cheese'], p:640, c:0xc88a30},
  salt:  {n:['岩塩','Rock Salt'],       p:30,  c:0xf0b8c8},
  log:   {n:['丸太','Logs'],            p:10,  c:0x9a6a3a},
  plank: {n:['板材','Planks'],          p:35,  c:0xe0be80},
  furn:  {n:['高級家具','Furniture'],   p:150, c:0xb84a3a},
  ore:   {n:['鉄鉱石','Iron Ore'],      p:30,  c:0x8a5aa8},
  ingot: {n:['鉄インゴット','Ingots'],  p:200, c:0xd8e0ea},
  gear:  {n:['歯車','Gears'],           p:800, c:0xe8b840},
};
const ITEM_KEYS = ISL.items;
const BUILD = {
  warehouse:{n:['市場と桟橋','Market & Dock'], cost:{g:200}, hidden:true, light:true,
    d:['品物を貯めて交易気球に売る。運搬係はここから出かける','Stores goods and trades with balloons. Haulers start here.']},
  camp:     {n:['木こり小屋','Lumber Camp'], isl:'sky', cost:{g:60}, job:'chop', cat:'res',
    d:['近くの木を伐って小屋に貯める。遠い木ほど時間がかかる','Chops nearby trees and stores the logs. Far trees take much longer.']},
  quarry:   {n:['採掘場','Mine'], isl:'sky', cost:{g:300}, job:'quarry', ind:true, cat:'res',
    d:['近くの岩を割って鉄鉱石を貯める。坑道が開けば地下を掘る','Breaks nearby rocks into iron ore. Digs underground once a shaft opens.']},
  forester: {n:['植林小屋','Forester'], isl:'sky', cost:{g:250}, plant:true, cat:'res',
    d:['まわりに苗木を植える','Plants saplings around it.']},
  sawmill:  {n:['製材所','Sawmill'], isl:'sky', cost:{g:150}, in:'log', out:'plank', time:3, ind:true, partner:'workshop', cat:'proc',
    d:['丸太→板材。家具工房の隣だと速い','Logs → Planks. Faster next to a Workshop.']},
  workshop: {n:['家具工房','Workshop'], isl:'sky', cost:{g:750, ore:5}, in:'plank', out:'furn', time:6, ind:true, partner:'sawmill', light:true, cat:'proc',
    d:['板材→高級家具。製材所の隣だと速い','Planks → Furniture. Faster next to a Sawmill.']},
  smelter:  {n:['製鉄所','Smelter'], isl:'sky', cost:{g:2600, ore:20}, in:'ore', out:'ingot', time:5, ind:true, partner:'factory', light:true, cat:'proc',
    d:['鉄鉱石→鉄インゴット。歯車工場の隣だと速い','Iron Ore → Ingots. Faster next to Gear Works.']},
  factory:  {n:['歯車工場','Gear Works'], isl:'sky', cost:{g:4600, ingot:6}, in:'ingot', out:'gear', time:8, ind:true, partner:'smelter', light:true, cat:'proc',
    d:['インゴット→歯車。製鉄所の隣だと速い','Ingots → Gears. Faster next to a Smelter.']},
  recycle:  {n:['リサイクル工場','Recycling Plant'], isl:'sky', cost:{g:1600}, gen:'ore', time:7, ind:true, upkeep:15, cat:'proc',
    d:['古い道具やガラクタから鉄鉱石を取り出す。ゆっくりだが尽きない（毎日15G）','Recovers iron ore from scrap. Slow, but never runs out (15G/day).']},
  house:    {n:['住宅','House'], cost:{g:120}, housing:3, light:true, near:true, cat:'life',
    d:['3人住める。近くの職場は通勤が速い。工場の隣はうるさい','Homes 3. Nearby workplaces get faster commutes. Noisy next to factories.']},
  bakery:   {n:['パン屋','Bakery'], cost:{g:480}, mood:6, moodCap:30, upkeep:20, light:true, near:true, cat:'life',
    d:['みんなの幸福が上がる（毎日20G）','Raises happiness (20G/day).']},
  park:     {n:['花の公園','Flower Park'], cost:{g:180}, mood:5, moodCap:15, near:true, size:2, cat:'life',
    d:['2×2マスの花と噴水。幸福が上がる（維持費なし）','A 2×2 garden with a fountain. Raises happiness, no upkeep.']},
  bath:     {n:['浴場','Bathhouse'], cost:{g:900, ore:10}, mood:5, moodCap:20, upkeep:25, bath:true, light:true, near:true, cat:'life',
    d:['幸福が上がり、夜勤の疲れが半分になる（毎日25G）','Raises happiness and halves night-shift fatigue (25G/day).']},
  fun:      {n:['空の遊園地','Sky Fair'], cost:{g:20000, ingot:20}, mood:8, moodCap:40, fun:true, size:2, req:'airport', light:true, cat:'life',
    d:['観光客が毎朝お金を落としていく。レベルを上げると乗り物が増える','Tourists spend money every morning. Levels add more rides.']},
};
// 酪農の島の建物
Object.assign(BUILD, {
  mower:    {n:['草刈り小屋','Mowing Hut'], isl:'dairy', cost:{g:60}, job:'chop', cat:'res',
    d:['近くの牧草を刈って干し草にし、小屋に貯める。遠い草ほど時間がかかる','Cuts nearby grass into hay and stores it. Far grass takes much longer.']},
  saltpit:  {n:['岩塩場','Salt Pit'], isl:'dairy', cost:{g:300}, job:'quarry', ind:true, cat:'res',
    d:['近くの岩塩を割って貯める。チーズづくりの建物に使う','Breaks nearby salt rocks. Needed to build cheese workshops.']},
  seeder:   {n:['種まき小屋','Seed Shed'], isl:'dairy', cost:{g:250}, plant:true, cat:'res',
    d:['まわりに牧草の種をまく','Sows grass seed around it.']},
  barn:     {n:['牛舎','Cow Barn'], isl:'dairy', cost:{g:150}, in:'hay', out:'milk', herd:true, time:3, ind:true, partner:'churn', cat:'proc', light:true,
    d:['乳の張った牛が帰ってきて、住民が搾る。牛を増やせる。干し草は草がないときと夜のエサ','Cows with full udders come here to be milked. Buy more cows here. Hay feeds them when grass runs out and at night.']},
  churn:    {n:['バター小屋','Churn House'], isl:'dairy', cost:{g:700, salt:5}, in:'milk', out:'butter', time:4, ind:true, partner:'barn', cat:'proc', light:true,
    d:['牛乳→バター。牛舎の隣だと速い','Milk → Butter. Faster next to a Barn.']},
  creamery: {n:['チーズ工房','Creamery'], isl:'dairy', cost:{g:2400, salt:15}, in:'milk', out:'cheese', time:6, ind:true, partner:'cellar', cat:'proc', light:true,
    d:['牛乳→チーズ。熟成蔵の隣だと速い','Milk → Cheese. Faster next to an Aging Cellar.']},
  cellar:   {n:['熟成蔵','Aging Cellar'], isl:'dairy', cost:{g:4500, salt:25}, in:'cheese', out:'aged', time:14, ind:true, partner:'creamery', cat:'proc', light:true,
    d:['チーズ→熟成チーズ（とても高い）。チーズ工房の隣だと速い','Cheese → Aged Cheese (very valuable). Faster next to a Creamery.']},
});
// 農耕の島の建物
Object.assign(BUILD, {
  farmhut:   {n:['農家','Farmhouse'], isl:'farm', cost:{g:60}, job:'chop', cat:'res',
    d:['近くの実った作物を刈り取って貯める。刈った畑には同じ作物がまた育つ','Harvests nearby ripe crops and stores them. Fields regrow the same crop.']},
  windmill:  {n:['風車','Windmill'], isl:'farm', cost:{g:150}, in:'wheat', out:'flour', time:3, ind:true, partner:'patisserie', cat:'proc', light:true,
    d:['小麦→小麦粉。菓子工房の隣だと速い','Wheat → Flour. Faster next to a Patisserie.']},
  picklery:  {n:['保存食の蔵','Preserve House'], isl:'farm', cost:{g:500, veg:8}, in:'veg', out:'pickle', time:4, ind:true, partner:'brewery', cat:'proc', light:true,
    d:['かぼちゃ→保存食。酒蔵の隣だと速い','Pumpkins → Preserves. Faster next to a Brewery.']},
  patisserie:{n:['菓子工房','Patisserie'], isl:'farm', cost:{g:1200, flour:8}, in:'flour', out:'cake', time:6, ind:true, partner:'windmill', cat:'proc', light:true,
    d:['小麦粉→焼き菓子。風車の隣だと速い','Flour → Cakes. Faster next to a Windmill.']},
  brewery:   {n:['酒蔵','Brewery'], isl:'farm', cost:{g:2800, rice:24}, in:'rice', out:'sake', time:8, ind:true, partner:'picklery', cat:'proc', light:true,
    d:['米→地酒（高い）。保存食の蔵の隣だと速い','Rice → Rice wine (valuable). Faster next to a Preserve House.']},
});
const islOk = d => !d.isl || d.isl === ISLAND;
const CATS = [...(isFarm ? [['field',['田畑','Fields']]] : []), ['res',['資源','Resources']], ['proc',['加工','Crafting']], ['life',['暮らし','Living']]];
const UPGS = [
  {id:'route', n:['交易気球の定期便','Trade Balloon Route'], cost:[400],
    d:['気球が来るたびに、選んだ品物を自動で売る','Each balloon visit auto-sells the goods you choose.']},
  {id:'dog',   n:['牧羊犬','Sheepdog'], isl:'dairy', cost:[6000],
    d:['輪の中の草がなくなると、鐘を近くの草地へ運んでくれる（いちばん良い場所とは限らない）','When the ring runs out of grass, the dog carries the bell to pasture nearby (not always the best spot).']},
  {id:'pump',  n:['揚水水車','Waterwheel'], isl:'farm', cost:[500,1500,3500,7000,12000],
    d:['上げるたびに川が自分で伸びる。建物はよけて曲がり、島の端で滝になり、次は枝分かれする','Each level makes the river grow by itself. It bends around buildings, falls off the edge, then branches.']},
  {id:'axe',   n:['よく切れる道具','Sharp Tools'], cost:[200,1200,5000],
    d:['クリックの収穫+1・伐採と採掘が速くなる','+1 per click; faster chopping and mining.']},
  {id:'carry', n:['運ぶ道具','Hauling Gear'], cost:[300,1500,6000], tiers:[
    [['丈夫な背負子','Sturdy Packs'], ['みんなが一度に運べる量が増える','Everyone carries more at once.']],
    [['人力車','Rickshaw'], ['運搬係が荷車を引く。一度に10個・足も15%速く','Haulers pull carts: 10 at once and 15% faster.']],
    [['馬車','Horse Carriage'], ['運搬係が馬車に。一度に16個・足も35%速く','Haulers drive carriages: 16 at once and 35% faster.']]]},
  {id:'road',  n:['道','Roads'], cost:[800,3000], tiers:[
    [['石畳の道','Cobblestone'], ['よく通る道が石畳になり、その上は速く歩ける','Worn paths get paved, and walking on them is faster.']],
    [['街灯のある道','Lamplit Roads'], ['石畳に街灯が立ち、さらに速く歩ける。夜の作業と移動 +30%','Street lamps line the paving for faster walking. Night work and walking +30%.']]]},
];
// 働き方：幸福を削って、効率ともうけを取る（1日1回だけ変えられる）
const DRIVE = [
  {n:['ふつうに働く','Normal'],              work:1,    sale:1,    mood:0,   d:['幸福そのまま','No change']},
  {n:['ノルマの掲示板','Quota Board'],       work:1.25, sale:1,    mood:-8,  d:['作業 +25%、幸福 -8','Work +25%, happiness -8']},
  {n:['鬼監督と鐘','Slave-driver’s Bell'],   work:1.6,  sale:1.1,  mood:-18, d:['作業 +60%、売値 +10%、幸福 -18','Work +60%, sales +10%, happiness -18']},
  {n:['金の豚さま','The Golden Pig'],        work:2.1,  sale:1.25, mood:-30, d:['作業 +110%、売値 +25%、幸福 -30。緑の再生が半分、空がくすみ、毎朝15%で機械が壊れる','Work +110%, sales +25%, happiness -30. Regrowth halved, hazy skies, 15% chance of a breakdown each morning']},
];
const HOUSE_WALLS = [0xf2d9b0, 0xd9e6f2, 0xf2c9c9, 0xd8f0c8, 0xf0e6a8, 0xe4e4e4, 0xc9b8e8];
const HOUSE_ROOFS = [0xd05a4a, 0x4a6ab0, 0x3a8a6a, 0xa05ac0, 0xd08a3a, 0x5a5a5a, 0x2a8ab0];
const HOUSE_STYLES = [['三角屋根','Hip roof'], ['切妻屋根','Gable roof'], ['とんがり屋根','Spire'], ['平屋根と花','Flat & flowers']];
const LOOK_COST = {s:5, w:2, r:2};   // 屋根の形5G・色2G
const W = 12, WH = 5 + 10*W;   // 盤面は12×12。最初は中央の10×10が島。市場は(5,10)
const DEBUG = /debug/.test(location.search);

/* ========================================================= 汎用 */
const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random()*(b-a);
const fmt = n => { n = Math.floor(n); return Math.abs(n) >= 1e6 ? (n/1e6).toFixed(2)+'M' : n.toLocaleString(SET.lang === 'en' ? 'en-US' : 'ja-JP'); };
// 金額の「G」：数字と少し離して金色にする（HTMLに入れる文字列はすべてこれを通す）
const gfix = s => String(s).replace(/(\d|M)G(?![A-Za-z])/g, '$1<i class="gu">G</i>');
const cx = i => i % W, cz = i => Math.floor(i / W);
const wpos = i => ({x: cx(i) - (W-1)/2, z: cz(i) - (W-1)/2});
const cellAt = (x, z) => clamp(Math.floor(z + W/2), 0, W-1)*W + clamp(Math.floor(x + W/2), 0, W-1);
const cheb = (a,b) => Math.max(Math.abs(cx(a)-cx(b)), Math.abs(cz(a)-cz(b)));
// 2×2マスの建物（公園・遊園地）：左上のマスが本体で、ほかの3マスは {t:'occ', of:本体}
const bSize = i => S.cells[i]?.t === 'b' ? (BUILD[S.cells[i].b.type]?.size || 1) : 1;
const bCenter = i => { const p = wpos(i), k = (bSize(i) - 1)/2; return {x:p.x + k, z:p.z + k}; };
const footCells = (i, sz) => { const r = []; for (let dz=0; dz<sz; dz++) for (let dx=0; dx<sz; dx++) r.push(i + dz*W + dx); return r; };
const ownerOf = i => S.cells[i]?.t === 'occ' ? S.cells[i].of : i;
const neigh8 = i => { const r=[]; for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dz)continue; const x=cx(i)+dx,z=cz(i)+dz; if(x>=0&&x<W&&z>=0&&z<W) r.push(z*W+x);} return r; };
const neigh4 = i => { const r=[]; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=cx(i)+dx,z=cz(i)+dz; if(x>=0&&x<W&&z>=0&&z<W) r.push(z*W+x); } return r; };
const hash = (a, b=0) => { const s = Math.sin(a*127.1 + b*311.7 + 13.13) * 43758.5453; return s - Math.floor(s); };

/* ========================================================= 状態 */
let S;
// どの島も同じ条件（350G・住民0）から始める
function newState(isl = ISLAND){
  const I = ISLANDS[isl], dairy = isl === 'dairy', farm = isl === 'farm';
  const s = {
    v:2, seed:Math.random()*1000, gold:P.startGold, items:{}, sat:{}, auto:{}, seen:{[I.tree]:true}, satCap:{},
    day:1, time:P.dayLen*P.dayFrac*3/14, mood:65, speed:1, idle:0,
    tut:isl === 'sky' ? 0 : -1, flags:{mine:false, sacred:false, steam:false, craft:false, forest:false, protectUntil:0, holidayDay:0, wageBonus:0, crack:false, stoneSafeUntil:0},
    upg:{route:0, axe:0, carry:0, road:0}, nightShift:false, nightUsed:false, nsStreak:0,
    contracts:[], loans:[], story:[], doneEvents:{}, lastEvent:'', airport:false,
    land:{x0:1,x1:10,z0:1,z1:10}, expand:0, routes:{}, res:{ore:P.reserveOre}, resTotal:P.reserveOre, ugRows:P.ugRows,
    airLvl:0, nightOrder:null, boostDay:0, strikeDay:0,
    festDay:0, rainDay:0, whaleDay:0, meteorNight:0,
    stats:{earned:0, sold:0, soldBy:{}, made:{}, treesCut:0, planted:0, nightShifts:0, festivals:0, holidays:0, contractsDone:0, contractsFail:0, loans:0, quits:0, moodSum:0, moodN:0, clicks:0, collects:0, pets:0},
    cells:[],
  };
  for (const k of I.items){ s.items[k]=0; s.sat[k]=1; s.auto[k]=false; s.stats.made[k]=0; s.stats.soldBy[k]=0; }
  for (let i=0;i<W*W;i++){ const x = cx(i), z = cz(i); s.cells.push(x>=1 && x<=10 && z>=1 && z<=10 ? {t:'grass', r:Math.random()} : {t:'void'}); }
  const centers = [[2.5,3],[8.5,2.5],[2.5,7.5],[9,7]].sort(()=>Math.random()-.5).slice(0, dairy ? 4 : 3);
  for (let i=0;i<W*W;i++){
    if (s.cells[i].t === 'void' || cheb(i,WH) <= 1) continue;
    let best = 99; for (const [x,z] of centers) best = Math.min(best, Math.hypot(cx(i)-x, cz(i)-z));
    if (!farm && best < 2.4 && Math.random() < 0.62) s.cells[i] = {t:'tree', hp:P.treeHP, r:Math.random()};
  }
  let rocks = 0, guard = 0;
  while (!farm && rocks < (dairy ? 7 : 8) && guard++ < 500){
    const i = Math.floor(Math.random()*W*W);
    if (s.cells[i].t !== 'grass' || cheb(i,WH) <= 2) continue;
    s.cells[i] = {t:'rock', hp:P.rockHP, r:Math.random()}; rocks++;
  }
  s.cells[WH] = {t:'b', r:.5, b:{type:'warehouse', lvl:1, workers:0, inb:0, st:{}, prog:0, build:0}};
  if (farm){
    // 湧き水と短い川、はじめの田畑
    const at = (x,z) => z*W + x, put = (x,z,c) => s.cells[at(x,z)] = {r:Math.random(), ...c};
    put(3,4,{t:'water', spring:true}); put(4,4,{t:'water', river:1}); put(5,4,{t:'water', river:1}); s.riverV = 1; s.riverTip = at(5,4);
    for (const [x,z] of [[4,3],[5,3],[4,5]]) put(x,z,{t:'sapling', crop:'rice', g:0.55});
    for (const [x,z] of [[7,6],[8,6],[7,7],[8,7],[9,7]]) put(x,z,{t:'tree', crop:'wheat', hp:4});
    for (const [x,z] of [[2,7],[3,7]]) put(x,z,{t:'sapling', crop:'veg', g:0.7});
  }
  return s;
}

/* =========================================================
   レンダラ（3D → 低解像度 → ドット絵に拡大）
   ========================================================= */
const renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance'});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.prepend(renderer.domElement);

// 星：実在の星座（オリオン座・北斗七星・カシオペヤ座・夏の大三角・さそり座・すばる・北極星）の並びを参考にまばらに配置
// [方位(度), 高さ0〜1, 明るさ0〜1, 色 0=白 1=赤 2=青]
const STAR_DATA = [
  [172,.62,1,1],[186,.60,.75,0],[177,.50,.7,2],[180,.505,.72,2],[183,.51,.66,2],[174,.38,.68,0],[188,.37,1,2],[180,.70,.45,0],
  [30,.78,.86,0],[31,.70,.76,0],[38,.69,.7,0],[39,.76,.58,0],[45,.78,.8,0],[50,.79,.76,0],[56,.75,.8,2],
  [310,.80,.72,0],[315,.73,.76,0],[320,.79,.7,0],[325,.72,.64,0],[330,.80,.6,0],
  [95,.86,1,2],[110,.80,.86,0],[101,.60,.9,0],
  [250,.45,1,1],[245,.55,.6,0],[247,.50,.55,0],[254,.40,.6,0],[257,.34,.55,0],[255,.28,.6,0],[250,.25,.5,0],
  [204,.72,.42,2],[205.2,.735,.38,2],[206,.72,.42,2],[205,.705,.36,2],[204.4,.74,.32,2],
  [0,.92,.72,0],
  [140,.55,.4,0],[150,.82,.35,0],[160,.30,.38,0],[215,.45,.35,0],[230,.88,.3,0],[270,.70,.36,0],[285,.40,.4,0],[295,.60,.3,0],
  [345,.50,.38,0],[10,.40,.35,0],[65,.55,.38,0],[75,.88,.3,0],[125,.42,.34,0],[195,.92,.3,0],[355,.75,.32,0],[85,.30,.35,0],
];
const STARS = STAR_DATA.map(([az, alt, m, c]) => new THREE.Vector4(az*Math.PI/180, alt, m, c));
const postMat = new THREE.ShaderMaterial({
  uniforms:{ tColor:{value:null}, tDepth:{value:null}, res:{value:new THREE.Vector2()},
    skyTop:{value:new THREE.Color()}, skyBot:{value:new THREE.Color()}, night:{value:0}, time:{value:0}, edgeTh:{value:0.0016},
    stars:{value:STARS}, yaw:{value:0}, meteor:{value:Array.from({length:6}, ()=>new THREE.Vector4(0,0,0,2))}, mLen:{value:28}, outline:{value:1} },
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader:`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res;
    uniform vec3 skyTop; uniform vec3 skyBot; uniform float night; uniform float time; uniform float edgeTh; uniform float outline;
    #define NSTAR ${STARS.length}
    uniform vec4 stars[NSTAR]; uniform float yaw; uniform vec4 meteor[6]; uniform float mLen;
    varying vec2 vUv;
    float B2(vec2 a){ a=floor(a); return fract(a.x/2.+a.y*a.y*.75); }
    float B4(vec2 a){ return B2(.5*a)*.25 + B2(a); }
    void main(){
      vec2 px = 1.0/res;
      vec2 pp = floor(vUv*res);
      float d  = texture2D(tDepth, vUv).x;
      vec3 col;
      if (d > 0.9999) {
        col = mix(skyBot, skyTop, smoothstep(0.0, 1.0, vUv.y));
        if (night > 0.05){
          for (int k=0; k<NSTAR; k++){
            vec4 st = stars[k];
            float da = mod(st.x - yaw + 3.14159, 6.28318) - 3.14159;
            vec2 dpx = (vUv - vec2(0.5 + da/1.75, 0.3 + st.y*0.68)) * res;
            float dd = length(dpx);
            float a = (dd < 0.8 ? 1.0 : 0.0) + ((st.z > 0.84 && min(abs(dpx.x),abs(dpx.y)) < 0.5 && max(abs(dpx.x),abs(dpx.y)) < 1.7) ? 0.4 : 0.0);
            vec3 sc = st.w > 1.5 ? vec3(0.72,0.84,1.0) : (st.w > 0.5 ? vec3(1.0,0.66,0.5) : vec3(1.0,0.98,0.9));
            col += sc * a * st.z * (0.78 + 0.22*sin(time*2.3 + float(k)*1.7)) * night;
          }
          for (int k=0; k<6; k++){
            vec4 me = meteor[k];
            if (me.w < 1.0){
              vec2 D = normalize(vec2(cos(me.z), sin(me.z)) * res);
              vec2 rel = vUv*res - (me.xy + vec2(cos(me.z), sin(me.z))*me.w*0.3)*res;
              float along = dot(rel, D), perp = abs(rel.x*D.y - rel.y*D.x);
              float fade = night * (1.0 - me.w) * min(1.0, me.w*8.0 + 0.2);
              if (along < 0.0 && along > -mLen && perp < 0.75 + 0.6*step(40.0, mLen)*(1.0 + along/mLen)) col += vec3(1.0,0.95,0.8) * (1.0 + along/mLen) * fade * 1.3;
              if (along >= 0.0 && along < 1.5 && perp < 1.2) col += vec3(1.0) * fade;
            }
          }
        }
      } else {
        col = texture2D(tColor, vUv).rgb;
        col = pow(max(col, 0.0), vec3(1.0/2.2));
        float dl = texture2D(tDepth, vUv - vec2(px.x,0.)).x;
        float dr = texture2D(tDepth, vUv + vec2(px.x,0.)).x;
        float du = texture2D(tDepth, vUv + vec2(0.,px.y)).x;
        float dd2 = texture2D(tDepth, vUv - vec2(0.,px.y)).x;
        float m = max(max(dl,dr), max(du,dd2));
        float edge = step(edgeTh, m - d) * outline;
        col = mix(col, col*0.25 + vec3(0.03,0.02,0.07), edge);
      }
      float b = B4(pp) - 0.5;
      col = floor(col*15.0 + b*0.85 + 0.5) / 15.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest:false, depthWrite:false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), postMat));
let rt;
const VIEW = {w:0, h:0};          // 0 なら画面の大きさ
function makeRT(){
  if (rt){ rt.depthTexture.dispose(); rt.dispose(); }
  const VW = VIEW.w || innerWidth, VH = VIEW.h || innerHeight;
  const sc = VIEW.w ? 2 : Math.min(VW, VH) < 600 ? Math.max(2, SET.pixel - 1) : SET.pixel;
  const w = Math.max(64, Math.floor(VW / sc)), h = Math.max(64, Math.floor(VH / sc));
  const dt = new THREE.DepthTexture(w, h); dt.type = THREE.UnsignedIntType;
  rt = new THREE.WebGLRenderTarget(w, h, {minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthTexture:dt, depthBuffer:true});
  postMat.uniforms.tColor.value = rt.texture; postMat.uniforms.tDepth.value = rt.depthTexture; postMat.uniforms.res.value.set(w, h);
}
makeRT();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const cam = new THREE.OrthographicCamera(-1,1,1,-1,5,95);
const Z0 = TOUCH && innerHeight > innerWidth ? 1.35 : 1;
const camS = {yaw:Math.PI/4, tyaw:Math.PI/4, pitch:0.6, zoom:Z0, tzoom:Z0, shake:0, tx:0, tz:0, x:0, z:0};
function updateCam(){
  const a = (VIEW.w || innerWidth) / (VIEW.h || innerHeight), h = Math.max(13, 16 / a) / camS.zoom;
  cam.left = -h*a/2; cam.right = h*a/2; cam.top = h/2; cam.bottom = -h/2; cam.updateProjectionMatrix();
  postMat.uniforms.edgeTh.value = Math.max(0.0016, 3.2 * h / postMat.uniforms.res.value.y / (cam.far - cam.near));
  const d = 45, ty = -0.6;
  const sh = SET.shake ? camS.shake : 0;
  const sx = sh ? rnd(-1,1)*sh : 0, sy = sh ? rnd(-1,1)*sh : 0;
  cam.position.set(camS.x + Math.sin(camS.yaw)*Math.cos(camS.pitch)*d + sx, ty + Math.sin(camS.pitch)*d + sy, camS.z + Math.cos(camS.yaw)*Math.cos(camS.pitch)*d);
  cam.lookAt(camS.x + sx, ty + sy, camS.z);
}

/* ---- ライト：固定数で作り、強さだけ変える（夕暮れにシェーダーを作り直さないため） */
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5a4a30, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = SET.shadows; sun.shadow.mapSize.set(1024,1024);
Object.assign(sun.shadow.camera, {left:-9,right:9,top:9,bottom:-9,near:1,far:50});
sun.shadow.bias = -0.002;
scene.add(sun); scene.add(sun.target);
const festLight = new THREE.PointLight(0xff9040, 0, 4, 2); scene.add(festLight);
const LIGHT_N = 8, lightPool = [];
// 光だまりは中心が明るく、ふちへ向かって消える
function glowGeo(r){
  const g = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI/2), n = g.attributes.position.count, c = new Float32Array(n*3);
  c[0] = c[1] = c[2] = 1;
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
const glowMat = new THREE.MeshBasicMaterial({vertexColors:true, color:0xffffff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false});
const glowMesh = new THREE.InstancedMesh(glowGeo(0.55), glowMat, 160); glowMesh.count = 0; glowMesh.setColorAt(0, new THREE.Color(0xffa848)); scene.add(glowMesh);
for (let i=0;i<LIGHT_N;i++){ const l = new THREE.PointLight(0xffb060, 0, 2.6, 2); l.position.set(0,-10,0); scene.add(l); lightPool.push({l, cell:-1, fire:false}); }

/* ---- マテリアルと形 */
const gradTex = new THREE.DataTexture(new Uint8Array([80,80,80,255, 165,165,165,255, 255,255,255,255]), 3, 1);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true;
const matCache = {};
const MT = hex => matCache[hex] || (matCache[hex] = new THREE.MeshToonMaterial({color:hex, gradientMap:gradTex}));
const winMat  = new THREE.MeshToonMaterial({color:0x3a4868, emissive:0xffc860, emissiveIntensity:0, gradientMap:gradTex});
const fireMat = new THREE.MeshToonMaterial({color:0x902a10, emissive:0xff6a1a, emissiveIntensity:0.7, gradientMap:gradTex});
// ちょうちん・ランタン：昼はくすみ、夜に光る（色ごとに1つのマテリアルを共有）
const lampMats = [], LM = {};
const lampMat = hex => { if (!LM[hex]){ const m = new THREE.MeshBasicMaterial({color:hex}); m.userData.base = new THREE.Color(hex); lampMats.push(m); LM[hex] = m; } return LM[hex]; };
const ghostOk = new THREE.MeshBasicMaterial({color:0x7ee08a, transparent:true, opacity:0.55, depthWrite:false});
const ghostNg = new THREE.MeshBasicMaterial({color:0xff6b6b, transparent:true, opacity:0.55, depthWrite:false});
const G = {
  box: new THREE.BoxGeometry(1,1,1), cyl: new THREE.CylinderGeometry(1,1,1,8), cyl6: new THREE.CylinderGeometry(1,1,1,6), cyl3: new THREE.CylinderGeometry(1,1,1,3),
  ico1: new THREE.IcosahedronGeometry(1,1), cone4: new THREE.ConeGeometry(1,1,4), cone6: new THREE.ConeGeometry(1,1,6),
  ico: new THREE.IcosahedronGeometry(1,0), torus: new THREE.TorusGeometry(1, 0.06, 4, 28), dod: new THREE.DodecahedronGeometry(1,0), sph: new THREE.IcosahedronGeometry(1,2),
};
function part(geo, hex, sx,sy,sz, x,y,z, mat){
  const m = new THREE.Mesh(geo, mat || MT(hex)); m.scale.set(sx,sy,sz); m.position.set(x,y,z);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function roof(g, w, h, y, hex){ const r = part(G.cone4, hex, w*0.78, h, w*0.78, 0, y+h/2, 0); r.rotation.y = Math.PI/4; g.add(r); return r; }
function win(g, x, y, z, ry=0){ const m = part(G.box, 0, 0.11,0.11,0.03, x,y,z, winMat); m.rotation.y = ry; m.castShadow=false; g.add(m); }

/* =========================================================
   島と空の見た目
   ========================================================= */
const floaters = [];
const tileMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,0.3,1), MT(0xffffff), W*W);
tileMesh.receiveShadow = true; scene.add(tileMesh);
const islandDirt = part(G.box, 0x5a3c2a, 8, 1.5, 8, 0, -1.05, 0); islandDirt.castShadow = false; scene.add(islandDirt);
const rockBase = part(G.cone6, 0x6a4c3c, 5.6, 4.2, 5.6, 0, -3.9, 0); rockBase.rotation.x = Math.PI; rockBase.rotation.y = 0.3; scene.add(rockBase);
const rb2 = part(G.cone6, 0x55402f, 3.0, 2.6, 3.0, 0.6, -6.9, -0.4); rb2.rotation.x = Math.PI; scene.add(rb2);
let leviY = -7.2;
for (let k=0;k<5;k++){ const a=k/5*Math.PI*2+0.4, r=8+k%2; const f = part(G.dod, 0x6a4c3c, 0.28+k%3*0.1, 0.22, 0.28, Math.cos(a)*r, -2.8-k%3, Math.sin(a)*r); f.userData.float = k; scene.add(f); floaters.push(f); }

// 地面：市松の芝
const TILE_A = new THREE.Color(ISL.tiles[0]), TILE_B = new THREE.Color(ISL.tiles[1]);
function updateTiles(){
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0,0,0), col = new THREE.Color();
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t === 'void'){ tileMesh.setMatrixAt(i, zero); continue; }
    const p = wpos(i); m4.makeTranslation(p.x, -0.15, p.z); tileMesh.setMatrixAt(i, m4);
    col.copy(((cx(i)+cz(i))%2) ? TILE_A : TILE_B); col.offsetHSL(0, 0, ((i*37)%7-3)*0.006); tileMesh.setColorAt(i, col);
  }
  tileMesh.instanceMatrix.needsUpdate = true; tileMesh.instanceColor.needsUpdate = true;
  const Ld = S.land, w = Ld.x1-Ld.x0+1, h = Ld.z1-Ld.z0+1, rows = S.ugRows || P.ugRows, yb = -0.3 - rows*0.3;
  const ccx = (Ld.x0+Ld.x1)/2 - (W-1)/2, ccz = (Ld.z0+Ld.z1)/2 - (W-1)/2;
  islandDirt.scale.set(Math.max(0.1, w-2), rows*0.3, Math.max(0.1, h-2));
  islandDirt.position.set(ccx, -0.3 - rows*0.15, ccz);
  const R0 = Math.max(w, h)/2 * 1.08;
  rockBase.scale.set(R0, 4.2, R0); rockBase.position.set(ccx, yb - 2.1, ccz);
  rb2.position.set(ccx + 0.6, yb - 5.1, ccz - 0.4); leviY = yb - 5.4;
  buildStrata(); buildDock();
}

// 自動でできる細い道：住民が実際に歩いた「まっすぐなルート」が、よく通るほど濃く太くなる
const ROUTE_MAX = 240;
const PATH_PIECES = 700, PATH_Y = 0.002;          // 道は地面のすぐ上＝ほかのどの物よりも下
const pathMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,0.002,1), MT(0xffffff), PATH_PIECES);
pathMesh.frustumCulled = false;
pathMesh.receiveShadow = true; pathMesh.count = 0; scene.add(pathMesh);
const PATH_C = new THREE.Color(0xcfb27a), PAVE_C = new THREE.Color(0xb3afa8);
const q2 = v => Math.round(v*2)/2;
const simNow = () => (S.day-1)*P.dayLen + S.time;
const routeUsed = new Map();           // 道を最後に誰かが歩いた時刻（保存しない）
function routeKey(x1, z1, x2, z2){
  const a = [q2(x1), q2(z1)], b = [q2(x2), q2(z2)];
  if (a[0] === b[0] && a[1] === b[1]) return null;
  return (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a.concat(b) : b.concat(a)).join(',');
}
function wearRoute(key, len, dt){ S.routes[key] = Math.min(1, (S.routes[key] || 0) + dt * 0.05 / Math.max(1, len)); routeUsed.set(key, simNow()); }

// となり合う同じ種類の建物はひとかたまり：道の入口は市場にいちばん近い1つだけ。中は建物づたいに歩く
let entryMap = {};
const entryOf = i => entryMap[i] ?? i;
function nodePt(i){ return S.cells[i].t === 'b' ? bCenter(i) : wpos(i); }          // 道の端は建物の中心
// 人が歩くのは道の上。ただし建物の中までは入らず、手前で止まる
function roadEnd(p, q, i){
  if (i !== undefined && S.cells[i].t !== 'b') return {x:p.x, z:p.z};
  const d = Math.hypot(q.x - p.x, q.z - p.z), k = Math.min(0.46*(i === undefined ? 1 : bSize(i)), d*0.4) / (d || 1);
  return {x:p.x + (q.x - p.x)*k, z:p.z + (q.z - p.z)*k};
}
function regroup(){
  entryMap = {};
  const seen = new Set(), m = wpos(WH), far = i => { const p = bCenter(i); return Math.hypot(p.x - m.x, p.z - m.z); };
  for (const i of allB()){
    if (i === WH || seen.has(i)) continue;
    const type = S.cells[i].b.type, grp = [i]; seen.add(i);
    for (let q=0; q<grp.length; q++) for (const f of footCells(grp[q], bSize(grp[q]))) for (const n of neigh8(f)){
      const j = ownerOf(n); if (!seen.has(j) && j !== WH && isB(j, type)){ seen.add(j); grp.push(j); }
    }
    let best = i; for (const j of grp) if (far(j) < far(best)) best = j;
    for (const j of grp) entryMap[j] = best;
  }
}
// 離れて建つ同じ種類の建物（家と家、小屋と小屋…）は、いちばん短いつなぎ方で全部が道でつながる
let socialEdges = [];
function wearSocial(){
  socialEdges = [];
  const byType = {};
  for (const i of allB()) if (i !== WH && S.cells[i].b.build <= 0) (byType[S.cells[i].b.type] ||= new Set()).add(entryOf(i));
  for (const type in byType){
    const rest = [...byType[type]], done = rest.splice(0, 1);
    while (rest.length){
      let best = null;
      for (const a of done) for (const b of rest){ const p = nodePt(a), q = nodePt(b), len = Math.hypot(p.x - q.x, p.z - q.z); if (!best || len < best.len) best = {b, p, q, len, night: type === 'house'}; }
      done.push(best.b); rest.splice(rest.indexOf(best.b), 1); socialEdges.push(best);
    }
  }
  for (const e of socialEdges){
    const k = routeKey(e.p.x, e.p.z, e.q.x, e.q.z); if (!k) continue;
    if ((S.routes[k] || 0) < 0.5) S.routes[k] = Math.min(0.5, (S.routes[k] || 0) + 0.04);
    routeUsed.set(k, simNow());
  }
}
// 行き先のなくなった道（引っ越し・撤去・木を伐った跡）は早く、歩かれなくなった道はゆっくり薄れて消える
function decayRoutes(){
  const live = new Set(), add = p => live.add(q2(p.x)+','+q2(p.z)), now = simNow(), e = dockEdge();
  for (const i of allB()){ add(nodePt(i)); add(bCenter(i)); }
  for (let i=0;i<W*W;i++) if (S.cells[i].t === 'tree' || S.cells[i].t === 'rock' || S.cells[i].crop) add(wpos(i));
  add(PLAZA); add({x:e.x, z:e.z + 1.3}); add({x:e.x, z:e.z - 0.25});
  for (const k in S.routes){
    const [a, b, c, d] = k.split(',');
    if (!routeUsed.has(k)) routeUsed.set(k, now);
    const f = !live.has(a+','+b) || !live.has(c+','+d) ? 0.9 : now - routeUsed.get(k) > 100 ? 0.97 : 0.995;
    S.routes[k] *= f;
    if (S.routes[k] < 0.03){ delete S.routes[k]; routeUsed.delete(k); }
  }
  const left = Object.keys(S.routes);
  if (left.length > ROUTE_MAX) left.sort((a,b)=>S.routes[a]-S.routes[b]).slice(0, left.length - ROUTE_MAX).forEach(k=>delete S.routes[k]);
}

// 街灯（石畳の次の段階）：よく通る道に沿って立つ
const POST_MAX = 90;
const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035,0.5,0.035), MT(0x3a3a44), POST_MAX);
const postHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1,0.1,0.1), lampMat(0xffe6a0), POST_MAX);
const postGlow = new THREE.InstancedMesh(glowGeo(0.7), glowMat, POST_MAX);
for (const m of [postMesh, postHead, postGlow]){ m.count = 0; m.frustumCulled = false; scene.add(m); }
postGlow.setColorAt(0, new THREE.Color(0xffc870));

const GRASS_C = TILE_A.clone().lerp(TILE_B, 0.5);
function updatePaths(){
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0,1,0), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), glow = new THREE.Color(0xffc870);
  let n = 0, rk = 0; const posts = [], ground = isFarm ? SEASON_TILE[season()][0] : GRASS_C;
  // 作物と水の上：そこだけ線を切る（下にもぐって見える）
  const under = (x, z) => { if (Math.abs(x) >= W/2 || Math.abs(z) >= W/2) return false; const c = S.cells[cellAt(x, z)]; return !!c.crop || c.t === 'water'; };
  for (const k in S.routes){
    const wv = S.routes[k]; if (wv < 0.14 || n >= PATH_PIECES) continue;
    const [x1, z1, x2, z2] = k.split(',').map(Number), dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    if (len < 1.45) continue;                                  // となり同士の短い線は描かない（塗りつぶしたようになるため）
    const vis = clamp((wv - 0.14)/0.3, 0, 1), paved = S.upg.road && wv > 0.45;
    q.setFromAxisAngle(up, Math.atan2(dx, dz));
    col.copy(ground).lerp(paved ? PAVE_C : PATH_C, vis);
    const width = (0.035 + Math.min(0.075, wv*0.075)) * Math.min(1, len/2.5), y = PATH_Y + (rk++ % 6)*0.0005, steps = Math.ceil(len/0.05);
    let from = -1;
    for (let j=0; j<=steps; j++){
      const t = (j + 0.5)/steps, open = j < steps && !under(x1 + dx*t, z1 + dz*t);
      if (open && from < 0) from = j/steps;
      if (open || from < 0) continue;
      const to = j/steps, mid = (from + to)/2, piece = (to - from)*len;
      if (piece > 0.1 && n < PATH_PIECES){
        sc.set(width, 1, piece); ps.set(x1 + dx*mid, y, z1 + dz*mid);
        m4.compose(ps, q, sc); pathMesh.setMatrixAt(n, m4); pathMesh.setColorAt(n, col); n++;
      }
      from = -1;
    }
    if (S.upg.road < 2 || !paved) continue;
    const num = Math.max(1, Math.floor(len/1.5));
    for (let j=0; j<num && posts.length < POST_MAX; j++) for (const side of [1,-1]){
      const t = (j+0.5)/num, x = x1 + dx*t + dz/len*0.2*side, z = z1 + dz*t - dx/len*0.2*side;
      if (Math.abs(x) >= W/2 || Math.abs(z) >= W/2) continue;
      const pc = S.cells[cellAt(x, z)]; if (pc.crop || (pc.t !== 'grass' && pc.t !== 'sapling')) continue;
      if (!posts.some(([a, b]) => Math.hypot(a-x, b-z) < 1.2)) posts.push([x, z]);
      break;
    }
  }
  pathMesh.count = n; pathMesh.instanceMatrix.needsUpdate = true; if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;
  posts.forEach(([x, z], k) => {
    postMesh.setMatrixAt(k, m4.makeTranslation(x, 0.25, z));
    postHead.setMatrixAt(k, m4.makeTranslation(x, 0.54, z));
    postGlow.setMatrixAt(k, m4.makeTranslation(x, 0.02, z)); postGlow.setColorAt(k, glow);
  });
  for (const m of [postMesh, postHead, postGlow]){ m.count = posts.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

// 島の断面：まわりの崖は地層。桟橋（南）の両隣の面は「断面図」になっていて、
// 地下の鉄鉱石（残りの量がそのまま見える）・掘った坑道・働く鉱夫が見える
const UG_FACES = ['e', 'w'];
const strataMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1), MT(0xffffff), 800);
strataMesh.receiveShadow = true; strataMesh.count = 0; scene.add(strataMesh);
const oreMesh = new THREE.InstancedMesh(G.dod, MT(0xffffff), 400); oreMesh.count = 0; scene.add(oreMesh);
const beamMesh = new THREE.InstancedMesh(G.box, MT(0xb07838), 600); beamMesh.count = 0; scene.add(beamMesh);
const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08,0.09,0.08), new THREE.MeshBasicMaterial({color:0xffe090}), 160); lampMesh.count = 0; scene.add(lampMesh);
const ROCK_COL = [0x8a5a3a, 0x7a6252, 0x6e5a4c, 0x655246, 0x5c4a40, 0x544438, 0x4c3e34, 0x463a30];
let UG = null, ugDug = -1;
// 掘り進める順番：入口（上段の中央）から、横に長い坑道を中心に広がっていく
function digOrder(nc, nr, seed){
  let st = (seed * 9301 + 49297) >>> 0; const rand = () => (st = (st * 1664525 + 1013904223) >>> 0) / 4294967296;
  const start = Math.floor(nc/2), taken = new Set([start]), order = [{c:start, r:0, p:-1}];
  while (order.length < nc*nr){
    const cand = [];
    order.forEach((o, oi) => { for (const [dc, dr, w] of [[1,0,3],[-1,0,3],[0,1,1.1],[0,-1,0.3]]){ const c = o.c+dc, r = o.r+dr; if (c<0||c>=nc||r<0||r>=nr||taken.has(r*nc+c)) continue; cand.push({c, r, p:oi, w}); } });
    let x = rand() * cand.reduce((a,cd)=>a+cd.w, 0), pk = cand[0];
    for (const cd of cand){ x -= cd.w; if (x <= 0){ pk = cd; break; } }
    taken.add(pk.r*nc + pk.c); order.push(pk);
  }
  return order;
}
// 面の情報：外側の面の位置・外向き・面に沿った方向・面に並ぶマス
function faceInfo(f){
  const Ld = S.land, h = (W-1)/2, rng = (a, b) => { const r = []; for (let v=a; v<=b; v++) r.push(v); return r; };
  if (f === 'e') return {f, n:[1,0],  t:[0,1], plane: Ld.x1 - h + 0.5, cols: rng(Ld.z0, Ld.z1).map(z=>({u:z-h, cell:z*W+Ld.x1}))};
  if (f === 'w') return {f, n:[-1,0], t:[0,-1], plane: Ld.x0 - h - 0.5, cols: rng(Ld.z0, Ld.z1).reverse().map(z=>({u:z-h, cell:z*W+Ld.x0}))};
  if (f === 's') return {f, n:[0,1],  t:[-1,0], plane: Ld.z1 - h + 0.5, cols: rng(Ld.x0, Ld.x1).reverse().map(x=>({u:x-h, cell:Ld.z1*W+x}))};
  return {f, n:[0,-1], t:[1,0], plane: Ld.z0 - h - 0.5, cols: rng(Ld.x0, Ld.x1).map(x=>({u:x-h, cell:Ld.z0*W+x}))};
}
// 面上の点（d：面から内側への深さ、u：面に沿った位置、y：高さ）→ 世界座標
function facePt(F, u, d, y){ return F.n[0] ? {x: F.plane - F.n[0]*d, y, z: u} : {x: u, y, z: F.plane - F.n[1]*d}; }
function buildStrata(){
  const rows = S.ugRows || P.ugRows;
  const faces = UG_FACES.map((f, k) => { const F = faceInfo(f); F.order = digOrder(F.cols.length, rows, Math.floor(S.seed*1000) + k*7); return F; });
  const secCells = new Set(); for (const F of faces) for (const c of F.cols) secCells.add(c.cell);
  const plain = [];
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t === 'void' || secCells.has(i)) continue;
    const x = cx(i), z = cz(i), Ld = S.land;
    if (x !== Ld.x0 && x !== Ld.x1 && z !== Ld.z0 && z !== Ld.z1) continue;
    for (let r=0; r<rows; r++) plain.push({i, r});
  }
  UG = {rows, faces, plain}; ugDug = -1; updateStrata();
}
function dugCount(){
  if (!UG || !S.flags.mine) return 0;
  const tot = UG.faces.reduce((a,F)=>a + F.order.length, 0);
  return Math.round(tot * clamp(1 - S.res.ore / Math.max(1, S.resTotal), 0, 1));
}
function updateStrata(){
  if (!UG) return;
  const dn = dugCount(); if (dn === ugDug) return; ugDug = dn;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  let ns = 0, no = 0, nb = 0, nl = 0;
  const box = (x, y, z, sx, sy, sz, hex, dl) => { m4.compose(ps.set(x,y,z), q.identity(), sc.set(sx,sy,sz)); strataMesh.setMatrixAt(ns, m4); col.set(hex); if (dl) col.offsetHSL(0,0,dl); strataMesh.setColorAt(ns, col); ns++; };
  const beam = (x, y, z, sx, sy, sz) => { m4.compose(ps.set(x,y,z), q.identity(), sc.set(sx,sy,sz)); beamMesh.setMatrixAt(nb++, m4); };
  for (const v of UG.plain){ const p = wpos(v.i); box(p.x, -0.45 - v.r*0.3, p.z, 1, 0.3, 1, ROCK_COL[v.r], ((v.i*7+v.r*3)%5-2)*0.012); }
  UG.faces.forEach((F, fi) => {
    const nDug = fi === 0 ? Math.ceil(dn/2) : Math.floor(dn/2), dug = new Set(); F.dugN = nDug;
    for (let k=0;k<nDug;k++){ const o = F.order[k]; dug.add(o.r*F.cols.length + o.c); }
    const along = (sxT, sxN) => F.n[0] ? [sxN, sxT] : [sxT, sxN];   // [x方向の大きさ, z方向の大きさ]
    F.cols.forEach((c, ci) => {
      for (let r=0; r<UG.rows; r++){
        const y = -0.45 - r*0.3, hh = hash(c.cell*13 + r, S.seed);
        if (dug.has(r*F.cols.length + ci)){
          // 掘った坑道：奥の壁だけ残してくぼませ、支柱とランタンを立てる
          const P0 = facePt(F, c.u, 0.75, y), [ax, az] = along(1, 0.5);
          box(P0.x, P0.y, P0.z, ax, 0.3, az, 0x34221a, (hh-0.5)*0.04);
          const below = r+1 < UG.rows && !dug.has((r+1)*F.cols.length + ci);
          if (below || r+1 >= UG.rows){ const Pf = facePt(F, c.u, 0.25, y - 0.14), [fx, fz] = along(1, 0.5); box(Pf.x, Pf.y, Pf.z, fx, 0.02, fz, 0xb08a58); }
          for (const du of [-0.46, 0.46]){ const Pb = facePt(F, c.u + du*(F.t[0]+F.t[1]), 0.06, y), [bx, bz] = along(0.05, 0.05); beam(Pb.x, Pb.y, Pb.z, bx, 0.3, bz); }
          const Pl = facePt(F, c.u, 0.06, y + 0.135), [lx, lz] = along(1, 0.05); beam(Pl.x, Pl.y, Pl.z, lx, 0.03, lz);
          if (hh < 0.45 && nl < 160){ const Pm = facePt(F, c.u + 0.3*(F.t[0]+F.t[1]), 0.1, y + 0.07); m4.makeTranslation(Pm.x, Pm.y, Pm.z); lampMesh.setMatrixAt(nl++, m4); }
        } else {
          // まだ掘っていない岩：外の面に鉄鉱石が顔を出している（数＝残りの量）
          const P0 = facePt(F, c.u, 0.5, y); box(P0.x, P0.y, P0.z, 1, 0.3, 1, ROCK_COL[r], ((c.cell*7+r*3)%5-2)*0.012);
          const nOre = r === 0 ? (hh < 0.4 ? 1 : 0) : 1 + (hh > 0.55 ? 1 : 0);
          for (let k=0;k<nOre && no < 400;k++){
            const h2 = hash(c.cell*31 + r*5 + k, S.seed + 3), uo = (k ? 0.22 : -0.18) + (h2-0.5)*0.12;
            const Po = facePt(F, c.u + uo*(F.t[0]+F.t[1]), -0.01, y + (h2-0.5)*0.12), s0 = 0.1 + h2*0.04;
            m4.compose(ps.set(Po.x, Po.y, Po.z), q.setFromAxisAngle(sc.set(0,1,0), h2*6), new THREE.Vector3(s0, s0*0.8, s0)); oreMesh.setMatrixAt(no, m4);
            col.set(ISL.rockCol[h2 > 0.6 ? 1 : 0]); oreMesh.setColorAt(no, col); no++;
          }
        }
      }
    });
  });
  strataMesh.count = ns; oreMesh.count = no; beamMesh.count = nb; lampMesh.count = nl;
  for (const m of [strataMesh, oreMesh, beamMesh, lampMesh]){ m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
// 地下で働く鉱夫：入口から坑道を通って掘り場へ行き、つるはしを振り、鉱石を担いで戻る
function ugSlotPt(F, o, d){ const c = F.cols[o.c]; return facePt(F, c.u, d, -0.6 - o.r*0.3); }
function ugPose(w, k, dt){
  if (!UG) return null;
  const F = UG.faces[k % UG.faces.length]; if (!F.dugN) return null;
  const tgt = Math.max(0, F.dugN - 1 - (Math.floor(k / UG.faces.length) % 3));
  const path = []; for (let j = tgt; j >= 0; j = F.order[j].p) path.unshift(ugSlotPt(F, F.order[j], 0.16));
  let len = 0; for (let j=1;j<path.length;j++) len += Math.hypot(path[j].x-path[j-1].x, path[j].y-path[j-1].y, path[j].z-path[j-1].z);
  const T = len / 0.45, cyc = 2*T + 4.5;
  w.ugT = ((w.ugT || 0) + dt) % cyc; const ph = w.ugT;
  const at = dist => { let d = dist; for (let j=1;j<path.length;j++){ const a = path[j-1], b = path[j], sl = Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z); if (d <= sl){ const f = sl ? d/sl : 0; return {x:a.x+(b.x-a.x)*f, y:a.y+(b.y-a.y)*f, z:a.z+(b.z-a.z)*f, dx:b.x-a.x, dz:b.z-a.z}; } d -= sl; } const e = path[path.length-1]; return {x:e.x, y:e.y, z:e.z, dx:F.t[0], dz:F.t[1]}; };
  if (ph < 3) { const e = at(len); return {...e, dx: F.t[0]*(tgt % 2 ? 1 : -1), dz: F.t[1]*(tgt % 2 ? 1 : -1), swing:true, carry:false}; }
  if (ph < 3 + T){ const e = at(len - (ph-3)*0.45); return {...e, dx:-e.dx, dz:-e.dz, carry:true}; }
  if (ph < 4.5 + T){ const e = at(0); return {...e, carry:false}; }
  return {...at((ph - 4.5 - T)*0.45), carry:false};
}

// まるい雲
const clouds = [];
function makeClouds(){
  for (let k=0;k<8;k++){
    const g = new THREE.Group(), n = 4 + Math.floor(Math.random()*3);
    for (let j=0;j<n;j++){ const r = j === Math.floor(n/2) ? rnd(0.75,0.95) : rnd(0.45,0.7); g.add(part(G.ico1, 0xffffff, r*1.15, r*0.8, r, (j - (n-1)/2)*0.62, r*0.25 + rnd(-0.05,0.08), rnd(-0.25,0.25))); }
    const ca = rnd(0, Math.PI*2), cr = rnd(10, 18); g.position.set(Math.cos(ca)*cr, rnd(-3, 1.5), Math.sin(ca)*cr); g.userData.v = rnd(0.15,0.35);
    g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = false; }});
    scene.add(g); clouds.push(g);
  }
}

// 気球（交易気球・遠くを漂う気球）
function makeBalloon(cA, cB, s){
  const g = new THREE.Group();
  const env = new THREE.Mesh(G.sph, MT(cA)); env.scale.set(0.5, 0.6, 0.5); env.position.y = 0.75; env.castShadow = true; g.add(env);
  const band = new THREE.Mesh(G.sph, MT(cB)); band.scale.set(0.51, 0.61, 0.16); band.position.y = 0.75; g.add(band);
  const band2 = new THREE.Mesh(G.sph, MT(cB)); band2.scale.set(0.16, 0.61, 0.51); band2.position.y = 0.75; g.add(band2);
  g.add(part(G.box, 0x8a5a2e, 0.26,0.18,0.26, 0,0.05,0));
  for (const [x,z] of [[-.1,-.1],[.1,-.1],[-.1,.1],[.1,.1]]) g.add(part(G.box, 0x5a4a3a, 0.015,0.32,0.015, x,0.3,z));
  g.scale.setScalar(s); return g;
}
const bgBalloons = [];
[[0xe05050,0xf0d040],[0x4a8ad0,0xf4f4f4],[0x50b060,0xf0a040]].forEach(([a,b],k)=>{
  const g = makeBalloon(a, b, 1.4); g.userData = {a: k*2.1, r: 20 + k*3, h: 2 + k*1.6, v: 0.02 + k*0.008}; scene.add(g); bgBalloons.push(g);
});
// 交易気球：市場の桟橋に定期的にやってくる
const tradeBalloon = makeBalloon(0xd86a3a, 0xf6ecc9, 0.85); scene.add(tradeBalloon);
// 桟橋（空港があれば空港の先端）。島の崖から斜めの支柱で支える
const dockG = new THREE.Group(); scene.add(dockG);
const dockTip = () => S.airport ? 2.6 : 0;
const dockEdge = () => ({x: wpos(WH).x, z: S.land.z1 - (W-1)/2 + 0.5});
function strut(g, hex, x1,y1,z1, x2,y2,z2, t){
  const d = new THREE.Vector3(x2-x1, y2-y1, z2-z1), Ln = d.length();
  const m = part(G.box, hex, t, Ln, t, (x1+x2)/2, (y1+y2)/2, (z1+z2)/2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize()); g.add(m); return m;
}
function buildDock(){
  dockG.clear();
  const e = dockEdge(); dockG.position.set(e.x, 0, e.z);
  const g = dockG, tip = dockTip();
  if (S.airport){
    g.add(part(G.box, 0x9a9aa2, 2.4,0.16,2.4, 0,-0.08,1.3));
    g.add(part(G.box, 0x6e6e76, 2.5,0.06,2.5, 0,-0.19,1.3));
    g.add(part(G.box, 0x8a8a92, 0.9,0.12,0.25, 0,-0.06,0.0));
    for (let k=0;k<8;k++){ const a = k/8*Math.PI*2; g.add(part(G.box, 0xffd35a, 0.14,0.02,0.14, Math.cos(a)*0.8, 0.01, 1.3 + Math.sin(a)*0.8)); }
    g.add(part(G.box, 0xf4f4f4, 0.5,0.02,0.08, 0,0.01,1.3)); g.add(part(G.box, 0xf4f4f4, 0.08,0.02,0.5, 0,0.01,1.3));
    // 島の崖から伸びる支え（斜めの梁と、根元の岩の張り出し）
    for (const sx of [-1.0, -0.35, 0.35, 1.0]) strut(g, 0x6a4a2a, sx,-1.3,-0.08, sx*0.95,-0.22,2.3, 0.09);
    for (const sx of [-1.0, 1.0]) strut(g, 0x6a4a2a, sx,-0.9,-0.08, sx,-0.22,1.0, 0.07);
    strut(g, 0x5a3a20, -1.05,-0.78,1.0, 1.05,-0.78,1.0, 0.05); strut(g, 0x5a3a20, -1.0,-0.5,1.7, 1.0,-0.5,1.7, 0.05);
    strut(g, 0x5a3a20, -1.0,-0.78,1.0, 0.35,-0.5,1.7, 0.04); strut(g, 0x5a3a20, 1.0,-0.78,1.0, -0.35,-0.5,1.7, 0.04);
    const ledge = part(G.dod, 0x6a4c3c, 1.3,0.45,0.5, 0,-1.35,-0.05); g.add(ledge);
    g.add(part(G.cyl, 0xd8d8e0, 0.12,0.9,0.12, -0.85,0.45,0.45)); g.add(part(G.box, 0, 0.36,0.22,0.36, -0.85,1.0,0.45, winMat));
    g.add(part(G.cone4, 0x4a6ab0, 0.3,0.2,0.3, -0.85,1.21,0.45));
    g.add(part(G.cyl, 0xeeeeee, 0.03,1.6,0.03, 0.9,0.8,0.5));
    const sock = part(G.cone6, 0xff6a3a, 0.08,0.3,0.08, 1.07,1.4,0.5); sock.rotation.z = -Math.PI/2; g.add(sock);
  }
  // 桟橋（空港があれば、その先端）
  const y0 = S.airport ? -0.2 : -0.8;
  g.add(part(G.box, 0x8a6a40, 0.5,0.06,1.1, 0.1,-0.03,tip+0.5));
  for (const sx of [-0.08, 0.28]) strut(g, 0x6a4a2a, sx,y0,tip-0.06, sx,-0.07,tip+0.9, 0.05);
  for (const sx of [-0.12, 0.32]) g.add(part(G.cyl, 0x5a3a20, 0.04,0.14,0.04, sx,0.05,tip+1.0));
  g.add(part(G.cyl, 0xdddddd, 0.02,0.7,0.02, 0.32,0.32,tip+0.15)); g.add(part(G.box, 0xe04040, 0.22,0.13,0.02, 0.44,0.6,tip+0.15));
  g.traverse(o=>{ if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
}
function dockPoint(){ const e = dockEdge(); return new THREE.Vector3(e.x + 0.1, 0.95, e.z + dockTip() + 1.3); }
const trade = {state:'away', t:8};

// となりの島（遠くに見える）：次は酪農、その次は農耕の島
const leviMat = new THREE.MeshToonMaterial({color:0x4a8af0, emissive:0x3a7ae0, emissiveIntensity:0.9, gradientMap:gradTex});
const farIslands = [];
function makeFarIsland(kind){
  const g = new THREE.Group();
  g.add(part(G.box, kind === 'dairy' ? 0x8cd060 : 0xa8d468, 6, 0.4, 6, 0, -0.2, 0));
  g.add(part(G.box, 0x9a6440, 5.8, 0.7, 5.8, 0, -0.75, 0));
  const c = part(G.cone6, 0x7a5a44, 3.6, 2.0, 3.6, 0, -2.1, 0); c.rotation.x = Math.PI; g.add(c);
  const st = new THREE.Mesh(new THREE.OctahedronGeometry(1,0), leviMat); st.scale.set(0.45,0.7,0.45); st.position.set(0,-3.6,0); g.add(st);
  for (let k=0;k<9;k++){ const a = k/9*Math.PI*2; g.add(part(G.ico1, 0xffffff, 0.9,0.5,0.9, Math.cos(a)*3.1, -1.05 + (k%2)*0.15, Math.sin(a)*3.1)); }   // 雲のすそ
  const tree = (x, z, s=1) => { g.add(part(G.cyl6, 0x7a4a2a, 0.1*s,0.4*s,0.1*s, x,0.2*s,z)); g.add(part(G.ico1, 0x3a9a48, 0.42*s,0.42*s,0.42*s, x,0.6*s,z)); };
  if (kind === 'dairy'){
    g.add(part(G.box, 0xc83a2a, 1.6, 1.0, 1.2, -1.2, 0.5, -1.2));
    const r = part(G.cyl3, 0xf4f0e0, 0.72, 1.7, 0.72, -1.2, 1.2, -1.2); r.rotation.z = Math.PI/2; r.rotation.y = Math.PI/2; g.add(r);
    g.add(part(G.box, 0xf4f0e0, 0.5, 0.6, 0.04, -1.2, 0.3, -0.58));
    g.add(part(G.cyl, 0xe0e0e8, 0.38, 1.8, 0.38, 0.0, 0.9, -1.6)); g.add(part(G.sph, 0x4a6ab0, 0.38, 0.28, 0.38, 0.0, 1.8, -1.6));
    for (let k=0;k<14;k++) g.add(part(G.box, 0xf4ecd8, 0.06, 0.3, 0.06, -2.6 + k*0.4, 0.15, 2.5));
    g.add(part(G.box, 0xf4ecd8, 5.4, 0.05, 0.04, 0, 0.24, 2.5));
    for (let k=0;k<6;k++){ const cw = new THREE.Group(); cw.add(part(G.box, 0xf8f8f8, 0.55,0.3,0.3, 0,0.32,0)); cw.add(part(G.box, 0x222222, 0.2,0.2,0.31, 0.06,0.36,0)); cw.add(part(G.box, 0xf8f8f8, 0.2,0.2,0.2, 0.36,0.42,0)); for (const [x,z] of [[-.2,-.1],[.2,-.1],[-.2,.1],[.2,.1]]) cw.add(part(G.box, 0x333333, 0.06,0.18,0.06, x,0.09,z)); cw.position.set(0.2 + (k%3)*0.9, 0, 0.4 + Math.floor(k/3)*0.9); cw.rotation.y = k*1.3; g.add(cw); }
    tree(2.2, -2.0, 1.2); tree(1.4, -2.4); tree(-2.4, 1.4);
  } else if (kind === 'sky'){   // 残してきた空の島：家並みと森
    for (const [x,z,col] of [[-1.6,0.6,0xd05a4a],[-0.6,1.4,0x4a6ab0],[0.6,0.5,0xd08a3a],[1.6,1.5,0x3a8a6a],[-0.2,-0.4,0xa05ac0]]){
      g.add(part(G.box, 0xf2d9b0, 0.8,0.6,0.8, x,0.3,z)); const r = roof(g, 0.9,0.55,0.6,col); r.position.x = x; r.position.z = z;
    }
    g.add(part(G.cyl, 0x666666, 0.12,1.5,0.12, 1.9,0.75,-0.4));
    for (let k=0;k<9;k++) tree(-2.4 + (k%5)*1.1, -1.5 - Math.floor(k/5)*0.9, 0.9 + (k%3)*0.15);
  } else {
    for (let k=0;k<7;k++) g.add(part(G.box, k%2 ? 0xe8c840 : 0x6aaa3a, 0.66, 0.1, 3.6, -2.2 + k*0.72, 0.05, 0.7));
    g.add(part(G.cyl, 0xf0e4c8, 0.42, 2.0, 0.48, 1.7, 1.0, -1.8)); g.add(part(G.cone6, 0x9a4a3a, 0.55, 0.55, 0.55, 1.7, 2.27, -1.8));
    const blades = new THREE.Group(); blades.position.set(1.7, 1.75, -1.25);
    for (let k=0;k<4;k++){ const b = part(G.box, 0xf8f4e8, 0.16, 1.3, 0.04, Math.cos(k*Math.PI/2)*0.62, Math.sin(k*Math.PI/2)*0.62, 0); b.rotation.z = k*Math.PI/2 + Math.PI/2; blades.add(b); }
    g.add(blades); g.userData.blades = blades;
    g.add(part(G.box, 0xf4e4c8, 0.9, 0.6, 0.8, -1.4, 0.3, -2.0)); roof(g, 0.95, 0.5, 0.6, 0x3a7ac0).position.set(-1.4, 0.85, -2.0);
    tree(-2.4, -0.9); tree(2.4, 2.4, 1.1);
  }
  return g;
}
{
  const d = makeFarIsland(ISLAND === 'sky' ? 'dairy' : 'sky'); d.position.set(18, -2.2, -18); d.scale.setScalar(0.8); d.rotation.y = 0.6; scene.add(d); farIslands.push(d);
  const f = makeFarIsland(isFarm ? 'dairy' : 'farm'); f.position.set(-23, -3.2, -11); f.scale.setScalar(0.7); f.rotation.y = -0.4; scene.add(f); farIslands.push(f);
}

// 雲クジラ（遠くから泳いできて、夕方には去っていく。出入りは少しずつ透ける）
const whale = new THREE.Group(), whaleMats = [];
{
  const WM = hex => { const m = new THREE.MeshToonMaterial({color:hex, gradientMap:gradTex, transparent:true, opacity:0}); whaleMats.push(m); return m; };
  const wb = WM(0xf4f8ff), wl = WM(0xdde6f2), wd = WM(0x2e3450);
  const add = (par, geo, mat, sx,sy,sz, x,y,z) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx,sy,sz); m.position.set(x,y,z); m.castShadow = true; par.add(m); return m; };
  add(whale, G.sph, wb, 2.2,1.0,1.05, 0.3,0,0);                // 胴
  add(whale, G.sph, wb, 1.35,0.78,0.86, 1.55,-0.06,0);         // 丸い頭
  add(whale, G.sph, wl, 2.0,0.52,0.86, 0.6,-0.44,0);           // おなか
  for (let k=0;k<4;k++) add(whale, G.box, wl, 1.2,0.03,0.04, 1.1,-0.7,-0.3+k*0.2);   // のどのしわ
  for (const z of [-0.83, 0.83]) add(whale, G.sph, wd, 0.065,0.065,0.03, 1.55,-0.1,z); // 目（体の表面に）
  for (const z of [-0.9, 0.9]){ const f = add(whale, G.sph, wb, 0.7,0.08,0.3, 0.9,-0.55,z*1.05); f.rotation.y = z > 0 ? -0.5 : 0.5; f.rotation.x = z > 0 ? 0.4 : -0.4; }
  const tail = new THREE.Group(); tail.position.set(-1.6, 0.05, 0); whale.add(tail);
  add(tail, G.sph, wb, 1.3,0.48,0.5, -0.7,0.05,0);             // 尾のつけ根（細くなる）
  for (const z of [-0.5, 0.5]){ const f = add(tail, G.sph, wb, 0.62,0.07,0.42, -1.85,0.1,z); f.rotation.y = z > 0 ? -0.45 : 0.45; }  // 尾びれ
  whale.userData.tail = tail;
  whale.visible = false; scene.add(whale);
}
const rain = []; for (let k=0;k<60;k++){ const m = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({color:0xbfe0ff})); m.scale.set(0.02,0.25,0.02); m.visible = false; scene.add(m); rain.push(m); }
// 島を浮かべている浮遊石
const leviStone = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshToonMaterial({color:0x4a8af0, emissive:0x3a7ae0, emissiveIntensity:0.8, gradientMap:gradTex}));
leviStone.scale.set(0.9,1.4,0.9); leviStone.position.set(0, -7.2, 0); scene.add(leviStone);

/* =========================================================
   建物・木・岩・住民の見た目
   ========================================================= */
// 部品の集まりを、頂点に色を持たせた1つの形にまとめる
function mergeParts(list){
  const pos = [], nor = [], col = [];
  for (const m of list){
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix);
    const p = g.attributes.position, n = g.attributes.normal, c = m.material.color;
    for (let i=0;i<p.count;i++){ pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
const meadowMat = new THREE.MeshToonMaterial({vertexColors:true, gradientMap:gradTex}), meadowCache = {};
function meadowGeo(v, gold, clover){
  if (clover && !gold) return cloverGeo(v);
  const key = v + (gold ? 'g' : ''); if (meadowCache[key]) return meadowCache[key];
  const cols = gold ? [0xf4d040, 0xe8b830] : [0xa8dc58, 0xc8e878, 0x8cc848], list = [part(G.ico1, gold ? 0xe0b030 : 0x78b840, 0.36,0.17,0.34, 0,0.07,0)];
  for (let k=0;k<7;k++){
    const a = k*0.9, d = k ? 0.23 : 0, h = 0.3 + hash(k, v*17)*0.2, x = Math.cos(a), z = Math.sin(a);
    const bl = part(G.cone6, cols[k%cols.length], 0.14, h, 0.14, x*d, h/2 + 0.08, z*d);
    bl.rotation.z = -x*0.3; bl.rotation.x = z*0.3; list.push(bl);
    if (k % 3 === 0) list.push(part(G.ico, 0xf0dc80, 0.07,0.1,0.07, x*d*1.3, h + 0.1, z*d*1.3));   // 穂
  }
  if (v < 3) for (let k=0;k<3;k++){ const a = k*2.1 + v; list.push(part(G.ico, [0xffffff,0xffe060,0xf090b8][(k+v)%3], 0.06,0.05,0.06, Math.cos(a)*0.3,0.25,Math.sin(a)*0.3)); }
  return meadowCache[key] = mergeParts(list);
}
function cloverGeo(v){
  const key = v + 'c'; if (meadowCache[key]) return meadowCache[key];
  const list = [part(G.ico1, 0x2f9a50, 0.4,0.15,0.38, 0,0.08,0)];
  for (let k=0;k<8;k++){
    const a = k*0.85, d = k ? 0.26 : 0, h = 0.2 + hash(k, v*11)*0.14, x = Math.cos(a)*d, z = Math.sin(a)*d;
    list.push(part(G.ico, k%2 ? 0x46b860 : 0x3aa858, 0.15,0.08,0.15, x,h*0.7,z));
    if (k%2 === 0) list.push(part(G.ico1, (k+v)%3 ? 0xf890c8 : 0xffffff, 0.09,0.11,0.09, x,h+0.13,z));
  }
  return meadowCache[key] = mergeParts(list);
}
function makeTree(c){
  const g = new THREE.Group();
  if (ISLAND === 'dairy'){   // 背の高い牧草と野の花（描画が重くならないよう、1株を1つの形にまとめて使い回す）
    const m = new THREE.Mesh(meadowGeo(Math.floor(c.r*6), !!c.gold, !!c.clover), meadowMat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    g.rotation.y = c.r*6.28; g.userData.base = 0.85 + c.r*0.3;
    return g;
  }
  const tones = c.gold ? [0xd8a820, 0xf4d040] : [[0x2f8f4a,0x46ad5c],[0x2a8044,0x3e9e52],[0x3a9a48,0x5cbf62]][Math.floor(c.r*3)];
  g.add(part(G.cyl6, 0x7a4a2a, 0.08, 0.36, 0.08, 0, 0.18, 0));
  g.add(part(G.cone6, tones[0], 0.36, 0.55, 0.36, 0, 0.58, 0));
  g.add(part(G.cone6, tones[1], 0.27, 0.45, 0.27, 0, 0.88, 0));
  g.rotation.y = c.r * 6.28; g.userData.base = 0.85 + c.r*0.3;
  return g;
}
function makeRock(c){
  const g = new THREE.Group();
  if (ISLAND === 'dairy'){   // 岩塩の結晶
    g.add(part(G.dod, 0xc8a0a8, 0.34,0.14,0.3, 0,0.08,0));
    for (const [x,z,h,col] of [[0,0,0.32,0xf0b8c8],[-0.2,0.08,0.2,0xfff0f4],[0.18,-0.06,0.22,0xe8a0b8],[0.1,0.2,0.14,0xfff0f4]]){
      const m = part(G.ico, col, h*0.5,h,h*0.5, x,0.12+h*0.4,z); m.rotation.z = -x*1.5; g.add(m);
    }
    g.rotation.y = c.r*6.28; return g;
  }
  g.add(part(G.dod, 0x8a9098, 0.36, 0.28, 0.32, 0, 0.18, 0));
  g.add(part(G.dod, 0x9aa2aa, 0.18, 0.15, 0.18, 0.25, 0.1, 0.18));
  g.rotation.y = c.r*6.28; return g;
}
function houseLook(b, r){ return b && b.look ? b.look : {s: Math.floor(r*4)%4, w: Math.floor(r*HOUSE_WALLS.length), r: Math.floor(r*7)%HOUSE_ROOFS.length}; }
function makeBuilding(type, r=0.5, b=null){
  const g = new THREE.Group(); const u = g.userData; u.spin = []; u.smoke = null; u.light = null;
  switch(type){
    case 'warehouse':
      g.add(part(G.box, 0xb08860, 0.9,0.5,0.75, 0,0.25,0)); roof(g, 0.98, 0.34, 0.5, 0x4a6aa8);
      g.add(part(G.box, 0x5a3a20, 0.3,0.32,0.03, 0,0.16,-0.38));
      g.add(part(G.box, 0xc8a060, 0.2,0.2,0.2, -0.32,0.1,-0.5)); g.add(part(G.box, 0xd8b070, 0.15,0.15,0.15, -0.12,0.075,-0.52));
      g.add(part(G.cyl, 0xdddddd, 0.02,0.6,0.02, 0.38,0.8,0.25)); g.add(part(G.box, 0xe04040, 0.22,0.13,0.02, 0.5,1.02,0.25));
      g.add(part(G.box, 0x7a5a3a, 0.5,0.12,0.12, 0.1,0.06,0.45));   // 荷さばき台
      win(g, 0.28,0.3,-0.385); win(g,-0.28,0.3,-0.385); u.light = [0,0.6,-0.6];
      break;
    case 'camp':
      g.add(part(G.box, 0x8a5a2e, 0.55,0.36,0.5, 0,0.18,0)); roof(g, 0.6, 0.3, 0.36, 0xb0503a);
      for (let k=0;k<3;k++){ const l = part(G.cyl6, 0x9a6a3a, 0.06,0.45,0.06, 0.38, 0.06+ (k===2?0.1:0), -0.05+(k===2?0:(k?0.12:-0.12))); l.rotation.x = Math.PI/2; g.add(l); }
      g.add(part(G.cyl6, 0x7a4a2a, 0.1,0.12,0.1, -0.35,0.06,0.3)); g.add(part(G.box, 0xcccccc, 0.03,0.1,0.08, -0.33,0.18,0.3));
      g.add(part(G.box, 0x4a2a1a, 0.14,0.22,0.03, 0,0.11,0.26)); win(g, 0.17,0.22,0.255); u.light=[0,0.5,0.5];
      break;
    case 'quarry': {
      g.add(part(G.dod, 0x7a7a82, 0.38,0.3,0.34, -0.1,0.16,-0.1)); g.add(part(G.dod, 0x9aa2aa, 0.2,0.16,0.2, 0.25,0.1,-0.25));
      g.add(part(G.box, 0x8a5a2e, 0.05,0.6,0.05, 0.3,0.3,0.15));
      const arm = part(G.box, 0x8a5a2e, 0.5,0.05,0.05, 0.1,0.58,0.15); arm.rotation.z = -0.3; g.add(arm);
      g.add(part(G.box, 0x555560, 0.2,0.1,0.14, -0.25,0.08,0.32)); g.add(part(G.box, 0xa8aeb8, 0.16,0.06,0.1, -0.25,0.15,0.32));
      g.add(part(G.box, 0x1a1210, 0.2,0.18,0.04, -0.05,0.1,0.15)); u.light=[0,0.35,0.6];
      break; }
    case 'sawmill': {
      g.add(part(G.box, 0xd0aa70, 0.75,0.4,0.6, -0.05,0.2,0));
      const rf = part(G.box, 0x6a4a2a, 0.88,0.06,0.72, -0.05,0.48,0); rf.rotation.x = 0.22; g.add(rf);
      const saw = part(G.cyl, 0xd8d8e0, 0.24,0.03,0.24, 0.38,0.28,0.25); saw.rotation.x = Math.PI/2; g.add(saw); u.spin.push([saw,'y',14]);
      g.add(part(G.box, 0x8a6a40, 0.25,0.1,0.35, 0.38,0.05,0.25));
      const lg = part(G.cyl6, 0x9a6a3a, 0.06,0.4,0.06, 0.38,0.13,0.05); lg.rotation.x = Math.PI/2; g.add(lg);
      win(g, -0.2,0.25,0.305);
      break; }
    case 'workshop':
      g.add(part(G.box, 0xeadcc0, 0.68,0.5,0.62, 0,0.25,0)); roof(g, 0.72, 0.36, 0.5, 0x9a3a3a);
      g.add(part(G.box, 0x777777, 0.12,0.4,0.12, 0.2,0.75,-0.12)); u.smoke = [0.2,0.98,-0.12];
      g.add(part(G.box, 0x5a3a20, 0.16,0.26,0.03, -0.15,0.13,0.315)); win(g, 0.16,0.3,0.315); win(g,-0.345,0.3,0.1,Math.PI/2);
      g.add(part(G.box, 0xb84a3a, 0.16,0.08,0.16, 0.42,0.14,0.3)); g.add(part(G.box, 0xb84a3a, 0.16,0.2,0.03, 0.42,0.22,0.23));
      u.light=[0,0.45,0.55];
      break;
    case 'house': {
      const lk = houseLook(b, r), wc = HOUSE_WALLS[lk.w % HOUSE_WALLS.length], rc = HOUSE_ROOFS[lk.r % HOUSE_ROOFS.length];
      g.add(part(G.box, wc, 0.5,0.4,0.5, 0,0.2,0));
      if (lk.s === 0) roof(g, 0.56, 0.36, 0.4, rc);
      else if (lk.s === 1){ const rf = part(G.cyl3, rc, 0.34, 0.6, 0.34, 0, 0.52, 0); rf.rotation.set(Math.PI/2, 0, Math.PI/2); g.add(rf); }
      else if (lk.s === 2){ const rf = part(G.cone4, rc, 0.42, 0.62, 0.42, 0, 0.71, 0); rf.rotation.y = Math.PI/4; g.add(rf); }
      else { g.add(part(G.box, rc, 0.56, 0.06, 0.56, 0, 0.43, 0)); for (let k=0;k<3;k++) g.add(part(G.ico, [0xff6a8a,0xffd35a,0xffffff][k], 0.05,0.05,0.05, -0.12 + k*0.12, 0.5, 0.18)); }
      g.add(part(G.box, 0x6a4020, 0.13,0.22,0.03, -0.1,0.11,0.255)); win(g, 0.12,0.25,0.255); win(g, 0.255,0.25,0, Math.PI/2);
      if (lk.s !== 2) g.add(part(G.box, 0x777777, 0.08,0.2,0.08, -0.15,0.62,-0.1));
      u.light=[0,0.4,0.5];
      break; }
    case 'bakery':
      g.add(part(G.box, 0xf4e6c8, 0.62,0.42,0.56, 0,0.21,0)); roof(g, 0.66, 0.32, 0.42, 0xd08040);
      for (let k=0;k<4;k++) g.add(part(G.box, k%2?0xffffff:0xd84040, 0.155,0.04,0.2, -0.233+k*0.155,0.36,0.36));
      g.add(part(G.box, 0x888888, 0.1,0.3,0.1, 0.2,0.7,-0.1)); u.smoke=[0.2,0.88,-0.1];
      g.add(part(G.ico, 0xd8a050, 0.14,0.09,0.09, 0,0.52,0.3));
      win(g, -0.15,0.22,0.285); win(g, 0.15,0.22,0.285); u.light=[0,0.4,0.55];
      break;
    case 'park': {   // 2×2マス（座標は -0.95〜0.95）
      g.add(part(G.box, 0x5aa84a, 1.9,0.04,1.9, 0,0.02,0));
      g.add(part(G.box, 0xd8c8a0, 1.9,0.045,0.2, 0,0.022,0.1)); g.add(part(G.box, 0xd8c8a0, 0.2,0.045,1.9, 0.1,0.022,0));
      g.add(part(G.cyl, 0xb8b8c0, 0.36,0.12,0.36, 0.1,0.08,0.1)); g.add(part(G.cyl, 0x6ac0f0, 0.3,0.02,0.3, 0.1,0.145,0.1));
      g.add(part(G.cyl, 0xb8b8c0, 0.14,0.1,0.14, 0.1,0.2,0.1)); g.add(part(G.cyl, 0x8ad0f8, 0.11,0.02,0.11, 0.1,0.255,0.1));
      g.add(part(G.cyl, 0xb8b8c0, 0.035,0.2,0.035, 0.1,0.33,0.1)); g.add(part(G.sph, 0xbfe6ff, 0.06,0.05,0.06, 0.1,0.44,0.1));
      const FL = [0xff6a8a, 0xffd35a, 0xffffff, 0xc87af0, 0xff9a40];
      for (const [x, z, k0] of [[-0.5,-0.5,0],[0.62,0.62,2],[-0.5,0.62,3]]){
        g.add(part(G.box, 0x7a5030, 0.6,0.06,0.5, x,0.045,z));
        for (let k=0;k<9;k++) g.add(part(G.ico, FL[(k + k0) % 5], 0.05,0.05,0.05, x + (k%3-1)*0.17, 0.11, z + (Math.floor(k/3)-1)*0.14));
      }
      g.add(part(G.cyl, 0x4aa0d8, 0.34,0.03,0.26, 0.6,0.035,-0.5)); g.add(part(G.cyl, 0x6ac0f0, 0.3,0.02,0.22, 0.6,0.05,-0.5));   // 池と蓮
      for (const [x,z] of [[0.5,-0.55],[0.7,-0.45]]) g.add(part(G.cyl, 0x4aa85a, 0.06,0.01,0.06, x,0.065,z));
      const tr = (x, z, s=1) => { g.add(part(G.cyl6, 0x7a4a2a, 0.05*s,0.3*s,0.05*s, x,0.15*s,z)); g.add(part(G.ico1, 0x4aa85a, 0.22*s,0.22*s,0.22*s, x,0.42*s,z)); };
      tr(-0.8,-0.05, 1.1); tr(0.82,0.12); tr(-0.15,-0.82, 0.9);
      for (const [x, z, ry] of [[-0.3,0.4,0],[0.45,-0.12,Math.PI/2]]){ const bn = new THREE.Group(); bn.position.set(x,0,z); bn.rotation.y = ry;
        bn.add(part(G.box, 0x8a5a2e, 0.3,0.03,0.09, 0,0.1,0)); bn.add(part(G.box, 0x8a5a2e, 0.3,0.09,0.02, 0,0.15,-0.04)); g.add(bn); }
      for (const [x, z] of [[-0.12,0.85],[0.32,-0.85]]){ g.add(part(G.cyl, 0x3a3a44, 0.02,0.42,0.02, x,0.21,z)); g.add(part(G.box, 0, 0.07,0.08,0.07, x,0.45,z, lampMat(0xffe0a0))); }
      u.light = [0.1,0.4,0.95];
      break; }
    case 'bath':
      g.add(part(G.box, 0xc8a070, 0.7,0.42,0.55, 0,0.21,0)); roof(g, 0.76, 0.3, 0.42, 0x4a5a6a);
      g.add(part(G.box, 0x4a2a1a, 0.2,0.24,0.02, 0,0.12,0.28)); g.add(part(G.box, 0x2a3a8a, 0.26,0.12,0.02, 0,0.3,0.29));
      g.add(part(G.box, 0xd84a3a, 0.12,0.12,0.02, 0.24,0.3,0.285));
      g.add(part(G.cyl, 0x8a7a6a, 0.06,0.55,0.06, -0.25,0.62,-0.15)); u.smoke = [-0.25,0.92,-0.15];
      g.add(part(G.cyl, 0x8a8a8a, 0.15,0.06,0.15, 0.38,0.03,0.32)); g.add(part(G.cyl, 0x9ad8f0, 0.12,0.02,0.12, 0.38,0.065,0.32));
      win(g, -0.22,0.26,0.28); u.light = [0,0.4,0.5];
      break;
    case 'fun': {   // 2×2マス。レベルが上がるほど乗り物が増える
      const lv = b ? b.lvl : 1;
      g.add(part(G.box, 0xe8d8b0, 1.9,0.05,1.9, 0,0.025,0));
      for (let k=0;k<16;k++){ const x = -0.71 + (k%4)*0.475, z = -0.71 + Math.floor(k/4)*0.475; if ((k + Math.floor(k/4)) % 2) g.add(part(G.box, 0xf0c8b8, 0.47,0.052,0.47, x,0.026,z)); }
      // 入場門
      for (const x of [-0.3, 0.3]) g.add(part(G.box, 0xd84a6a, 0.07,0.5,0.07, x,0.25,0.88));
      g.add(part(G.box, 0xf0c040, 0.7,0.12,0.06, 0,0.54,0.88)); g.add(part(G.box, 0xd84a6a, 0.74,0.03,0.08, 0,0.61,0.88));
      for (const x of [-0.3, 0.3]) g.add(part(G.sph, 0, 0.05,0.05,0.05, x,0.53,0.92, lampMat(0xffe08a)));
      // 回転木馬
      const car = new THREE.Group(); car.position.set(-0.45,0,0.3);
      car.add(part(G.cyl, 0xd84a6a, 0.42,0.08,0.42, 0,0.08,0)); car.add(part(G.cyl, 0xf0e0c0, 0.05,0.5,0.05, 0,0.36,0));
      car.add(part(G.cone6, 0xf0c040, 0.48,0.24,0.48, 0,0.72,0)); car.add(part(G.cone6, 0xd84a6a, 0.5,0.08,0.5, 0,0.61,0));
      for (let k=0;k<8;k++){ const a = k/8*Math.PI*2; car.add(part(G.cyl, 0xf8f8f8, 0.012,0.46,0.012, Math.cos(a)*0.32,0.37,Math.sin(a)*0.32)); car.add(part(G.box, [0xffffff,0x8ab0e0,0xf0a0a0,0xf0d080][k%4], 0.1,0.08,0.05, Math.cos(a)*0.32,0.24 + (k%2)*0.06,Math.sin(a)*0.32)); }
      for (let k=0;k<6;k++){ const a = k/6*Math.PI*2; car.add(part(G.sph, 0, 0.03,0.03,0.03, Math.cos(a)*0.46,0.6,Math.sin(a)*0.46, lampMat([0xffd35a,0xff7a9a,0x7ee0ff][k%3]))); }
      g.add(car); u.spin.push([car, 'y', 1.0]);
      if (lv >= 2){ // 観覧車
        for (const z0 of [-0.62,-0.38]){ strut(g, 0x8a8a92, 0.15,0,z0, 0.45,0.82,-0.5, 0.04); strut(g, 0x8a8a92, 0.75,0,z0, 0.45,0.82,-0.5, 0.04); }
        const fw = new THREE.Group(); fw.position.set(0.45,0.82,-0.5);
        for (let k=0;k<10;k++){ const a = k/10*Math.PI*2; const sp = part(G.box, 0xf4f4f4, 0.025,0.66,0.025, Math.cos(a)*0.33,Math.sin(a)*0.33,0); sp.rotation.z = a - Math.PI/2; fw.add(sp);
          const rim = part(G.box, 0xf4f4f4, 0.025,0.21,0.025, Math.cos(a+0.31)*0.64,Math.sin(a+0.31)*0.64,0); rim.rotation.z = a + 0.31; fw.add(rim);
          fw.add(part(G.box, [0xff5a5a,0xffd35a,0x7ee0ff,0x9aff7a,0xff9af0][k%5], 0.11,0.1,0.11, Math.cos(a)*0.66,Math.sin(a)*0.66,0)); }
        fw.add(part(G.cyl, 0xd0d0d8, 0.07,0.12,0.07, 0,0,0)).children; g.add(fw); u.spin.push([fw, 'z', 0.4]);
      }
      if (lv >= 3){ // 旗の列と売店
        for (const [x, z] of [[-0.9,-0.9],[0.9,-0.9],[-0.9,0.6],[0.9,0.6]]) g.add(part(G.cyl, 0xf4f4f4, 0.015,0.6,0.015, x,0.3,z));
        for (let k=0;k<12;k++) g.add(part(G.cone4, [0xff5a5a,0xffd35a,0x7ee0ff][k%3], 0.05,0.08,0.01, -0.9 + k*0.164, 0.55 - Math.sin(k/11*Math.PI)*0.08, -0.9));
        g.add(part(G.box, 0xf4ecd8, 0.3,0.26,0.24, 0.62,0.13,0.45)); g.add(part(G.box, 0xd84a4a, 0.36,0.04,0.3, 0.62,0.28,0.47));
        for (let k=0;k<4;k++) g.add(part(G.box, k%2?0xffffff:0xd84a4a, 0.09,0.06,0.03, 0.49+k*0.09,0.31,0.62));
      }
      if (lv >= 4){ // ジェットコースター
        for (let k=0;k<12;k++){ const x = -0.88 + k*0.16, y = 0.18 + Math.abs(Math.sin(k/11*Math.PI*1.5))*0.55; g.add(part(G.box, 0xd84a3a, 0.17,0.03,0.1, x, y, -0.86)); g.add(part(G.box, 0x8a8a92, 0.025,y,0.025, x, y/2, -0.86)); }
        g.add(part(G.box, 0x4a6ab0, 0.14,0.08,0.09, -0.4,0.18 + Math.abs(Math.sin(3/11*Math.PI*1.5))*0.55 + 0.05,-0.86));
      }
      if (lv >= 5){ // コーヒーカップと風船
        const cups = new THREE.Group(); cups.position.set(-0.45,0,-0.45);
        cups.add(part(G.cyl, 0x9ad8f0, 0.34,0.03,0.34, 0,0.04,0));
        for (let k=0;k<4;k++){ const a = k/4*Math.PI*2; cups.add(part(G.cyl, [0xff9af0,0xffd35a,0x9aff7a,0xff7a5a][k], 0.09,0.1,0.09, Math.cos(a)*0.2,0.11,Math.sin(a)*0.2)); }
        g.add(cups); u.spin.push([cups, 'y', 1.6]);
        for (let k=0;k<6;k++){ const a = k/6*Math.PI*2; g.add(part(G.cyl, 0xdddddd, 0.005,0.5,0.005, 0.1 + Math.cos(a)*0.06,0.3,0.55 + Math.sin(a)*0.06)); g.add(part(G.sph, [0xff6a8a,0xffd35a,0x7ee0ff,0x9aff7a,0xc87af0,0xff9a40][k], 0.07,0.085,0.07, 0.1 + Math.cos(a)*0.12, 0.6 + (k%2)*0.08, 0.55 + Math.sin(a)*0.12)); }
      }
      u.light = [0,0.4,0.95];
      break; }
    case 'forester':
      g.add(part(G.box, 0x9a7a50, 0.45,0.34,0.45, -0.1,0.17,-0.05)); roof(g, 0.5, 0.3, 0.34, 0x3a8a4a);
      for (let k=0;k<3;k++){ g.add(part(G.box, 0xa05a30, 0.1,0.08,0.1, 0.32,0.04,-0.25+k*0.22)); g.add(part(G.cone6, 0x4aa85a, 0.07,0.16,0.07, 0.32,0.16,-0.25+k*0.22)); }
      win(g, -0.1,0.2,0.18);
      break;
    case 'smelter':
      g.add(part(G.box, 0x9a5a4a, 0.7,0.5,0.6, 0,0.25,0));
      g.add(part(G.box, 0x5a4a4a, 0.74,0.06,0.64, 0,0.53,0));
      g.add(part(G.cyl, 0x6a5a5a, 0.08,0.8,0.08, 0.2,0.9,-0.15)); u.smoke=[0.2,1.32,-0.15];
      g.add(part(G.box, 0, 0.26,0.2,0.04, -0.1,0.14,0.31, fireMat));
      win(g, 0.2,0.32,0.305); u.light=[-0.1,0.3,0.55]; u.fire = true;
      break;
    case 'factory': {
      g.add(part(G.box, 0x8a9098, 0.9,0.42,0.8, 0,0.21,0));
      for (let k=0;k<3;k++){ const s2 = part(G.box, 0x5a6a8a, 0.3,0.05,0.8, -0.3+k*0.3, 0.5, 0); s2.rotation.z = 0.45; g.add(s2); }
      g.add(part(G.box, 0x5a3a20, 0.22,0.28,0.03, 0.15,0.14,0.405));                       // 搬入口
      g.add(part(G.box, 0xe8b840, 0.12,0.05,0.12, 0.38,0.05,0.48)); g.add(part(G.box, 0xd8a830, 0.1,0.05,0.1, 0.36,0.1,0.47)); // 箱詰めの歯車
      g.add(part(G.cyl, 0x666666, 0.07,0.6,0.07, -0.3,0.75,-0.25)); u.smoke=[-0.3,1.06,-0.25];
      win(g, -0.2,0.25,0.405); win(g, 0.1,0.25,0.405); u.light=[0,0.4,0.6];
      break; }
    case 'recycle': {
      g.add(part(G.box, 0x6a8a6a, 0.62,0.4,0.55, -0.1,0.2,-0.05));
      const rf = part(G.box, 0x4a6a4a, 0.72,0.05,0.65, -0.1,0.44,-0.05); rf.rotation.x = -0.18; g.add(rf);
      g.add(part(G.box, 0x3a2a1a, 0.24,0.24,0.03, -0.1,0.12,0.23));
      for (let k=0;k<6;k++) g.add(part([G.dod, G.box, G.cyl][k%3], [0x8a8a92,0xa05a3a,0x6a6a72][k%3], 0.09,0.07,0.09, 0.3 + (k%3)*0.08 - 0.08, 0.04 + Math.floor(k/3)*0.06, 0.25 + (k%2)*0.08));
      g.add(part(G.box, 0x5a5a60, 0.05,0.62,0.05, 0.38,0.31,-0.25));
      const arm = part(G.box, 0xe8b840, 0.42,0.05,0.05, 0.28,0.62,-0.1); arm.rotation.y = 0.9; g.add(arm);
      g.add(part(G.cyl, 0x3a3a44, 0.06,0.04,0.06, 0.2,0.48,0.05));
      g.add(part(G.cyl, 0x666666, 0.06,0.5,0.06, -0.3,0.65,-0.2)); u.smoke = [-0.3,0.92,-0.2];
      win(g, 0.1,0.26,0.235); u.light = [0,0.4,0.5];
      break; }
    case 'mower': {
      g.add(part(G.box, 0xb88a54, 0.55,0.36,0.5, -0.05,0.18,0)); roof(g, 0.62,0.3,0.36,0x5a9a3a);
      for (let k=0;k<3;k++){ const h = part(G.cyl, 0xd8c060, 0.12,0.2,0.12, 0.37,k === 2 ? 0.3 : 0.12,k === 2 ? 0 : k ? 0.15 : -0.15); h.rotation.z = Math.PI/2; g.add(h); }
      const st = part(G.box, 0x7a4a2a, 0.03,0.5,0.03, -0.38,0.26,0.28); st.rotation.z = 0.3; g.add(st);
      g.add(part(G.box, 0xd8d8e0, 0.22,0.03,0.07, -0.36,0.5,0.28));
      g.add(part(G.box, 0x4a2a1a, 0.14,0.22,0.03, -0.1,0.11,0.26)); win(g, 0.12,0.22,0.255); u.light = [0,0.5,0.5];
      break; }
    case 'saltpit':
      g.add(part(G.dod, 0xc8a0a8, 0.4,0.2,0.34, -0.1,0.1,-0.12));
      for (const [x,z,h] of [[-0.2,-0.15,0.3],[0.02,-0.05,0.22],[-0.02,-0.3,0.18]]) g.add(part(G.ico, 0xf0b8c8, h*0.5,h,h*0.5, x,h*0.7,z));
      g.add(part(G.box, 0x8a5a2e, 0.05,0.6,0.05, 0.3,0.3,0.15)); g.add(part(G.box, 0x8a5a2e, 0.5,0.05,0.05, 0.1,0.58,0.15));
      g.add(part(G.box, 0x555560, 0.22,0.12,0.16, -0.25,0.09,0.32)); g.add(part(G.ico, 0xfff0f4, 0.11,0.07,0.08, -0.25,0.18,0.32));
      u.light = [0,0.35,0.6];
      break;
    case 'seeder':
      g.add(part(G.box, 0xc09a68, 0.45,0.34,0.45, -0.1,0.17,-0.05)); roof(g, 0.5,0.3,0.34,0x8ab840);
      for (let k=0;k<3;k++){ g.add(part(G.ico, 0xe8dcb0, 0.09,0.11,0.08, -0.3+k*0.17,0.09,0.3)); g.add(part(G.cone4, 0x6ab840, 0.06,0.14,0.06, 0.32,0.07,-0.25+k*0.22)); }
      win(g, -0.1,0.2,0.18); u.light = [0,0.4,0.4];
      break;
    case 'barn': {
      g.add(part(G.box, 0xc03a2c, 0.74,0.46,0.58, -0.08,0.23,0));
      const rf = part(G.cyl3, 0xf0ead8, 0.4,0.82,0.4, -0.08,0.62,0); rf.rotation.set(Math.PI/2,0,Math.PI/2); g.add(rf);
      g.add(part(G.box, 0xf4f0e0, 0.28,0.3,0.03, -0.12,0.15,0.3));
      for (const r of [0.75,-0.75]){ const x = part(G.box, 0xc03a2c, 0.035,0.32,0.035, -0.12,0.15,0.31); x.rotation.z = r; g.add(x); }
      g.add(part(G.cyl, 0xd0d0d8, 0.16,0.8,0.16, 0.42,0.4,-0.14)); g.add(part(G.sph, 0x4a6ab0, 0.16,0.13,0.16, 0.42,0.8,-0.14));
      g.add(part(G.box, 0xd8c060, 0.2,0.14,0.18, 0.36,0.07,0.3));
      win(g, 0.16,0.3,0.295); u.light = [0,0.4,0.55];
      break; }
    case 'churn':
      g.add(part(G.box, 0xf4e6c8, 0.56,0.4,0.5, -0.1,0.2,-0.05)); roof(g, 0.64,0.32,0.42,0xf0c040);
      g.add(part(G.cyl, 0xa87a4a, 0.14,0.32,0.14, 0.35,0.16,0.25)); g.add(part(G.cyl, 0x5a3a20, 0.15,0.04,0.15, 0.35,0.22,0.25));
      g.add(part(G.cyl, 0xd8c8a0, 0.025,0.3,0.025, 0.35,0.43,0.25));
      g.add(part(G.box, 0xf8e070, 0.16,0.11,0.12, -0.3,0.07,0.3));
      g.add(part(G.box, 0x5a3a20, 0.14,0.24,0.03, -0.1,0.12,0.205)); win(g, 0.09,0.26,0.21); u.light = [0,0.4,0.5];
      break;
    case 'creamery':
      g.add(part(G.box, 0xf6f2ea, 0.72,0.46,0.58, -0.05,0.23,-0.05)); roof(g, 0.78,0.34,0.48,0x4a7ac0);
      g.add(part(G.cyl, 0x888888, 0.06,0.45,0.06, 0.22,0.72,-0.15)); u.smoke = [0.22,0.96,-0.15];
      for (let k=0;k<3;k++) g.add(part(G.cyl, k === 1 ? 0xf8cc58 : 0xf0b040, 0.15,0.08,0.15, 0.38,0.04+k*0.085,0.3));
      g.add(part(G.box, 0x5a3a20, 0.16,0.26,0.03, -0.1,0.13,0.245)); win(g, 0.14,0.28,0.245); win(g, -0.32,0.28,0.245); u.light = [0,0.45,0.55];
      break;
    case 'cellar': {
      g.add(part(G.dod, 0x6aa84a, 0.5,0.4,0.42, 0,0.2,-0.12));
      g.add(part(G.box, 0x9a968a, 0.5,0.4,0.14, 0,0.2,0.2));
      const top = part(G.cyl, 0x9a968a, 0.25,0.14,0.25, 0,0.4,0.2); top.rotation.x = Math.PI/2; g.add(top);
      g.add(part(G.box, 0x5a3a20, 0.26,0.32,0.03, 0,0.16,0.28)); g.add(part(G.box, 0, 0.1,0.1,0.02, 0,0.25,0.3, winMat));
      for (const x of [-0.4,0.4]){ g.add(part(G.cyl, 0xa87a4a, 0.12,0.22,0.12, x,0.11,0.3)); g.add(part(G.cyl, 0xc88a30, 0.1,0.07,0.1, x,0.25,0.3)); }
      u.light = [0,0.4,0.55];
      break; }
    case 'farmhut':
      g.add(part(G.box, 0xd8b888, 0.58,0.34,0.5, -0.05,0.17,0)); roof(g, 0.7,0.42,0.34,0xa88a48);
      g.add(part(G.box, 0x4a2a1a, 0.14,0.22,0.03, -0.1,0.11,0.26)); win(g, 0.12,0.22,0.255);
      g.add(part(G.box, 0xb88a54, 0.22,0.1,0.18, 0.38,0.06,0.25)); g.add(part(G.ico, 0xe8c040, 0.12,0.07,0.1, 0.38,0.13,0.25));
      g.add(part(G.box, 0x7a4a2a, 0.03,0.5,0.03, -0.4,0.25,0.3)); g.add(part(G.box, 0x8a9098, 0.12,0.1,0.03, -0.4,0.05,0.3));
      u.light = [0,0.5,0.5];
      break;
    case 'windmill': {
      g.add(part(G.cyl, 0xf0e4c8, 0.27,0.72,0.27, 0,0.36,-0.05)); g.add(part(G.cone6, 0xb04a3a, 0.32,0.32,0.32, 0,0.88,-0.05));
      g.add(part(G.box, 0x5a3a20, 0.15,0.24,0.04, 0,0.12,0.22)); win(g, 0,0.42,0.22);
      g.add(part(G.box, 0x5a3a20, 0.06,0.06,0.2, 0,0.74,0.22));
      const bl = new THREE.Group(); bl.position.set(0,0.74,0.34);
      for (let k=0;k<4;k++){ const a = k*Math.PI/2, b = part(G.box, 0xfff8e8, 0.13,0.42,0.02, Math.cos(a)*0.23,Math.sin(a)*0.23,0); b.rotation.z = a + Math.PI/2; bl.add(b); }
      bl.add(part(G.box, 0x8a5a2e, 0.1,0.1,0.06, 0,0,0.01)); g.add(bl); u.spin.push([bl,'z',1.8]);
      g.add(part(G.ico, 0xf4ecd8, 0.1,0.12,0.09, 0.35,0.07,0.25));
      u.light = [0,0.4,0.55];
      break; }
    case 'picklery':
      g.add(part(G.box, 0xe8e0d0, 0.62,0.42,0.52, -0.08,0.21,-0.05)); g.add(part(G.box, 0x5a4a44, 0.66,0.14,0.56, -0.08,0.07,-0.05)); roof(g, 0.7,0.3,0.44,0xd87030);
      for (let k=0;k<4;k++){ g.add(part(G.cyl, k%2 ? 0xd85a30 : 0xa87a4a, 0.1,0.18,0.1, 0.36,0.09,-0.2+k*0.17)); g.add(part(G.cyl, 0xf4ecd8, 0.105,0.03,0.105, 0.36,0.19,-0.2+k*0.17)); }
      g.add(part(G.box, 0x5a3a20, 0.16,0.24,0.03, -0.12,0.12,0.235)); win(g, 0.1,0.28,0.22); u.light = [0,0.4,0.5];
      break;
    case 'patisserie':
      g.add(part(G.box, 0xf8d8d8, 0.66,0.44,0.56, -0.05,0.22,-0.03)); roof(g, 0.74,0.34,0.46,0x8a4a3a);
      for (let k=0;k<5;k++) g.add(part(G.box, k%2 ? 0xffffff : 0xe87898, 0.14,0.04,0.18, -0.32+k*0.14,0.36,0.32));
      g.add(part(G.cyl, 0xd89058, 0.15,0.1,0.15, 0.38,0.12,0.28)); g.add(part(G.ico1, 0xfff0f0, 0.14,0.08,0.14, 0.38,0.2,0.28)); g.add(part(G.sph, 0xe83a4a, 0.04,0.04,0.04, 0.38,0.3,0.28));
      g.add(part(G.cyl, 0x888888, 0.06,0.4,0.06, 0.2,0.75,-0.12)); u.smoke = [0.2,0.96,-0.12];
      g.add(part(G.box, 0x5a3a20, 0.15,0.24,0.03, -0.12,0.12,0.255)); win(g, 0.12,0.22,0.255); u.light = [0,0.45,0.55];
      break;
    case 'brewery': {
      g.add(part(G.box, 0xf4f0e8, 0.74,0.5,0.56, -0.04,0.25,-0.05)); g.add(part(G.box, 0x3a3440, 0.78,0.2,0.6, -0.04,0.1,-0.05)); roof(g, 0.84,0.32,0.52,0x3a3a50);
      for (const [x,y] of [[0.34,0.11],[0.34,0.3],[0.08,0.11]]){ const b = part(G.cyl, 0xb07838, 0.12,0.2,0.12, x,y,0.36); b.rotation.x = Math.PI/2; g.add(b); }
      g.add(part(G.sph, 0x7a8a3a, 0.11,0.11,0.11, -0.22,0.42,0.3));
      g.add(part(G.box, 0x2a3a8a, 0.2,0.12,0.02, -0.22,0.24,0.26)); win(g, 0.1,0.34,0.235); u.light = [0,0.45,0.55];
      break; }
  }
  // 夜のランタン（建物ごとに色と場所がちがう）
  const LANT = {
    warehouse:[[-0.3,0.42,0.42,0xff7a5a],[-0.1,0.38,0.44,0xffd35a],[0.1,0.38,0.44,0x7ee0ff],[0.3,0.42,0.42,0x9aff7a]],
    house:[[-0.22,0.25,0.27,0xffd890]], camp:[[-0.42,0.34,0.32,0xffa040,1]], quarry:[[0.02,0.45,0.15,0xffc060]],
    sawmill:[[-0.44,0.3,0.32,0xffb860,1]], forester:[[0.12,0.26,0.25,0xd8ff90]], workshop:[[0.3,0.33,0.33,0xffe0a0]],
    factory:[[0.42,0.44,0.42,0xe0f0ff]], bakery:[[-0.3,0.3,0.32,0xff9a50]], bath:[[-0.14,0.37,0.3,0xff5a3a],[0.14,0.37,0.3,0xff5a3a]],
    recycle:[[0.0,0.46,0.25,0xa8ffa0]],
    mower:[[-0.44,0.36,0.3,0xffc050,1]], saltpit:[[0.02,0.45,0.15,0xffa0c0]], seeder:[[0.12,0.26,0.22,0xd8ff90]], barn:[[0.1,0.38,0.32,0xffb060]],
    churn:[[-0.3,0.32,0.22,0xffe880]], creamery:[[-0.05,0.4,0.27,0xd8f0ff]], cellar:[[0.0,0.46,0.3,0xff9040]],
    farmhut:[[-0.4,0.54,0.3,0xffc860]], windmill:[[0.2,0.34,0.26,0xfff0c0]], picklery:[[-0.3,0.32,0.25,0xff9a40]], patisserie:[[-0.34,0.28,0.3,0xff90b8]], brewery:[[-0.4,0.36,0.3,0xff5a3a]],
    smelter:[[0.3,0.36,0.32,0xffb060]],
  }[type] || [];
  for (const [x, y, z, hex, post] of LANT){
    g.add(part(G.box, 0, 0.06,0.07,0.06, x,y,z, lampMat(hex)));
    if (post) g.add(part(G.box, 0x3a3a44, 0.02,y,0.02, x,y/2-0.03,z));
  }
  // 隣の建物とのあいだに隙間をあける（住民が通るのが見えるように）
  const BS = type === 'house' ? 0.9 : BUILD[type]?.size === 2 ? 1 : 0.8;
  const inner = new THREE.Group(); inner.scale.setScalar(BS);
  while (g.children.length) inner.add(g.children[0]);
  g.add(inner); u.inner = inner;
  if (u.light) u.light = u.light.map(v=>v*BS); if (u.smoke) u.smoke = u.smoke.map(v=>v*BS);
  // 工事中の足場（建設・移動のあいだだけ見える）
  const sc = new THREE.Group();
  for (const [x,z] of [[-.4,-.4],[.4,-.4],[-.4,.4],[.4,.4]]) sc.add(part(G.box, 0xc8a060, 0.04,0.8,0.04, x,0.4,z));
  for (const y of [0.3, 0.7]) for (const [x,z,sx,sz] of [[0,-.4,.84,.04],[0,.4,.84,.04],[-.4,0,.04,.84],[.4,0,.04,.84]]) sc.add(part(G.box, 0xc8a060, sx,0.04,sz, x,y,z));
  if (BUILD[type]?.size === 2) sc.scale.set(2.2, 1.2, 2.2);
  sc.visible = false; g.add(sc); u.scaffold = sc;
  return g;
}
function makeWorkerMesh(job){
  const g = new THREE.Group();
  const col = {chop:0x3a7a3a, quarry:0x5a5a7a, proc:0x3a5ab0, haul:0xd0802a, tour:[0xe07ab0,0x4ab0a0,0xe0a040,0x9a6ad0][Math.floor(Math.random()*4)]}[job] || 0x3a5ab0;
  const body = part(G.box, col, 0.14,0.15,0.1, 0,0.13,0);
  const head = part(G.box, 0xf0c8a0, 0.13,0.12,0.12, 0,0.27,0);
  const hat  = part(G.box, job==='chop'?0xd04030:job==='quarry'?0xe8c030:job==='haul'?0x3a6ab0:0xf0f0f0, 0.15,0.04,0.14, 0,0.35,0);
  const legL = part(G.box, 0x3a2a1a, 0.05,0.07,0.06, -0.035,0.035,0), legR = part(G.box, 0x3a2a1a, 0.05,0.07,0.06, 0.035,0.035,0);
  const carry = part(G.box, 0xffffff, 0.12,0.08,0.12, 0,0.43,0); carry.visible = false;
  g.add(body, head, hat, legL, legR, carry);
  g.userData = {body, carry, legL, legR, head, hat};
  return g;
}

// 運ぶ道具の見た目：背負子（全員）→ 人力車 → 馬車（運搬係）
function setGear(m, job, tier){
  const u = m.userData; if (u.tier === tier) return;
  u.tier = tier;
  if (u.gear) m.remove(u.gear);
  const g = new THREE.Group(); u.gear = g; u.cargo = null; u.wheels = []; u.horse = null;
  m.add(g);
  if (!tier) return;
  if (job !== 'haul' || tier === 1){
    g.add(part(G.box, 0x7a4a2a, 0.15,0.2,0.05, 0,0.19,-0.085)); g.add(part(G.box, 0xc8a060, 0.11,0.12,0.06, 0,0.2,-0.12));
    return;
  }
  const car = tier === 3, cz0 = car ? -0.36 : -0.36;
  const wheel = (x, z, r) => { const h = new THREE.Group(); h.position.set(x, r, z); const ty = part(G.cyl, 0x3a2a1a, r,0.035,r, 0,0,0); ty.rotation.z = Math.PI/2; h.add(ty); h.add(part(G.box, 0xe8c070, 0.04,r*1.5,0.03, 0,0,0)); g.add(h); u.wheels.push(h); };
  g.add(part(G.box, car ? 0xa03a2a : 0xb88a54, car ? 0.28 : 0.22,0.1,car ? 0.4 : 0.28, 0,0.17,cz0));
  u.cargo = new THREE.Group();
  for (let k=0; k<(car?4:2); k++) u.cargo.add(part(G.box, 0xffffff, 0.12,0.12,0.12, (k%2 ? 0.07 : -0.07),0.28,cz0 + (car ? (k < 2 ? -0.09 : 0.09) : 0)));
  g.add(u.cargo);
  if (!car){
    wheel(-0.14, cz0, 0.13); wheel(0.14, cz0, 0.13);
    for (const x of [-0.09, 0.09]) g.add(part(G.box, 0x7a4a2a, 0.025,0.025,0.42, x,0.17,-0.1));
    return;
  }
  for (const z of [cz0-0.13, cz0+0.13]){ wheel(-0.17, z, 0.11); wheel(0.17, z, 0.11); }
  for (const x of [-0.11, 0.11]) g.add(part(G.box, 0x7a4a2a, 0.025,0.025,0.6, x,0.2,0.05));
  const ho = new THREE.Group(); ho.position.z = 0.34; u.horse = ho;
  ho.add(part(G.box, 0x9a6038, 0.16,0.17,0.3, 0,0.25,0));
  const neck = part(G.box, 0x9a6038, 0.09,0.22,0.1, 0,0.37,0.16); neck.rotation.x = 0.4; ho.add(neck);
  ho.add(part(G.box, 0x9a6038, 0.1,0.1,0.18, 0,0.48,0.24)); ho.add(part(G.box, 0x3a2418, 0.04,0.2,0.06, 0,0.42,0.1));
  ho.add(part(G.box, 0x3a2418, 0.04,0.16,0.04, 0,0.22,-0.17));
  for (const [x,z] of [[-.06,-.11],[.06,-.11],[-.06,.11],[.06,.11]]) ho.add(part(G.box, 0x6a4028, 0.04,0.18,0.04, x,0.09,z));
  g.add(ho);
}

/* ---- セルのメッシュ管理 */
const CM = [];
let pickables = [];
function rebuildPickables(){ pickables = []; for (const g of CM) if (g) pickables.push(g); }
function setCellMesh(i){
  if (CM[i]) { scene.remove(CM[i]); CM[i] = null; }
  const c = S.cells[i], p = c.t === 'b' ? bCenter(i) : wpos(i); let g = null;
  if (c.t === 'tree' || c.t === 'sapling') g = isFarm ? makeCrop(c) : makeTree(c);
  else if (c.t === 'water') g = makeWater(i, c);
  else if (c.t === 'rock') g = makeRock(c);
  else if (c.t === 'b') g = makeBuilding(c.b.type, c.r, c.b);
  if (g){ g.position.set(p.x, 0, p.z); g.userData.cell = i; g.userData.hit = 0; scene.add(g); CM[i] = g; }
  rebuildPickables();
}

/* =========================================================
   ゲームロジック
   ========================================================= */
const workers = [];
const reserved = {}, haulRes = {};
const isB = (i, type) => S.cells[i].t === 'b' && (!type || S.cells[i].b.type === type);
const allB = type => { const r=[]; for (let i=0;i<W*W;i++) if (isB(i,type)) r.push(i); return r; };
const countB = type => allB(type).length;
const treeCount = () => S.cells.filter(c=>c.t==='tree').length;
const workerCount = () => workers.length;
const driveOf = () => DRIVE[S.drive || 0];
const lampNight = () => S.upg.road >= 2 && isNight() ? 1.3 : 1;
const workF = () => driveOf().work * lampNight();
const pop = () => workerCount() + (S.idle || 0);          // 働いている人＋手の空いた移住者
const canHire = b => b.workers < slots(b) && (S.idle > 0 || (S.gold >= hireCost() && pop() < housing()));
const hireTxt = () => L('雇う','Hire') + ' ' + (S.idle > 0 ? L('無料','free') : fmt(hireCost())+'G');
const housing = () => 3 + allB('house').reduce((a,i)=>a + 3 + (S.cells[i].b.lvl-1)*2, 0);
const hourOf = t => { const d = P.dayLen*P.dayFrac; return t < d ? 5 + 14*t/d : 19 + 10*(t-d)/(P.dayLen-d); };
const isNight = () => { const h = hourOf(S.time); return h >= 19.25 || h < 5.5; };
const workTime = () => (!isNight() || (S.nightShift && S.meteorNight !== S.day)) && S.flags.holidayDay !== S.day && S.strikeDay !== S.day;
const festActive = () => S.festDay === S.day && hourOf(S.time) >= 17;
const FEST_STILL_AFTER = 8;          // 祭りばやしが流れてから絵が出るまで（実時間の秒）
let festHeard = 0;
function showFestStill(){
  if (!S.festStill) return;
  S.festStill = 0; festHeard = 0;
  eventQueue.unshift({result:true, quiet:true, img:'festival_go', title:L('収穫祭、たけなわ！','The festival is in full swing!'), text:L('祭りばやしに合わせて、みんなが輪になって踊っている。空には花火も上がった。','Everyone dances in a ring to the music while fireworks burst overhead.')});
}
const holidayNow = () => S.flags.holidayDay === S.day && !isNight();
const starWatch = () => S.meteorNight === S.day && isNight() && hourOf(S.time) >= 19 && hourOf(S.time) < 23.5;   // 流れ星の夜はみんなで広場から空を見る
const moodF = () => (0.5 + S.mood/100) * (S.boostDay === S.day ? 1.4 : 1);
const carryCap = () => 2 + S.upg.carry;
const HAUL_CAP = [4, 6, 10, 16], HAUL_SPD = [1, 1, 1.15, 1.35];
const haulCap = () => HAUL_CAP[S.upg.carry] ?? 16;
const bufCap = b => b.type === 'barn' ? 18 + 8*b.lvl : 6 + 3*b.lvl;
const staffed = d => !!(d.job || d.in || d.gen);          // 住民が働く建物
const slots = b => (b.type === 'warehouse' || staffed(BUILD[b.type])) ? Math.min(6, b.lvl + 1) : 0;
const hireCost = () => Math.round(P.hireBase * Math.pow(P.hireGrow, workerCount()));
const stTotal = b => { let n = 0; for (const k in b.st || {}) n += b.st[k]; return n; };
const stCap = b => (BUILD[b.type].in || BUILD[b.type].gen) ? bufCap(b) : 12 + 12*b.lvl;   // 木こり小屋・採掘場はレベルで大きく増える
function stAdd(b, it, n){ b.st = b.st || {}; b.st[it] = (b.st[it] || 0) + n; }
function stMain(b){ let best = null, bn = 0; for (const k in b.st || {}) if (b.st[k] >= 1 && b.st[k] > bn){ bn = b.st[k]; best = k; } return best; }
function buildCost(type){
  const d = BUILD[type], n = countB(type), k = Math.pow(type==='house'?1.25:type==='park'?1.2:1.35, n), c = {};
  for (const key in d.cost) c[ISL.costMap[key] || key] = Math.round(d.cost[key] * k);
  return c;
}
const lvlCost = b => Math.round(BUILD[b.type].cost.g * 1.5 * Math.pow(1.8, b.lvl-1));
function price(it){
  let m = S.sat[it]; const cap = S.satCap[it]; if (cap && S.day < cap.until) m = Math.min(m, cap.v);
  const craft = (S.flags.craft && ISL.craft.includes(it) ? 1.3 : 1) * (S.flags.forest && ISL.forest.includes(it) ? 1.2 : 1) * (S.flags.jersey && ['butter','cheese','aged'].includes(it) ? 1.25 : 1);
  if (S.flags.miller && (it === 'flour' || it === 'cake')) m *= 1.25;
  return ITEMS[it].p * m * craft * driveOf().sale;
}
function partnerAdj(i){ const d = BUILD[S.cells[i].b.type]; return !!d.partner && neigh8(i).some(j => isB(j, d.partner)); }
function nearBonus(i){ for (let j=0;j<W*W;j++) if (j!==i && S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.near && cheb(i,j) <= 2) return true; return false; }
function noisePairs(){ let n = 0; for (const h of allB().filter(i=>BUILD[S.cells[i].b.type]?.near)) for (const j of neigh8(h)) if (S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.ind) n++; return n; }
function speedMult(i){
  const b = S.cells[i].b; let m = Math.pow(1.4, b.lvl-1) * moodF() * workF();
  if (partnerAdj(i)) m *= 1.3; if (S.flags.steam) m *= 1.35; if (S.flags.forest) m *= 0.9;
  return m;
}
function moodBreakdown(){
  const Lst = [[L('基本','Base'), 50]];
  const t = treeCount(); Lst.push([L(ISL.treeN[0]+'の数', ISL.treeN[1])+'('+t+')', Math.min(18, t*0.7) * (S.flags.forest?1.5:1)]);
  for (const [k, d] of Object.entries(BUILD)) if (d.mood){
    const v = allB(k).reduce((a,i)=>a + d.mood + (S.cells[i].b.lvl-1)*Math.ceil(d.mood/2), 0);
    if (v) Lst.push([N(d.n), Math.min(d.moodCap || 30, v)]);
  }
  if (S.drive) Lst.push([N(driveOf().n), driveOf().mood]);
  if (S.flags.sisters) Lst.push([L('寄り添う畑','Companion fields'), 6]);
  if (S.flags.skycow) Lst.push([L('ふわふわの空牛','Fluffy sky-cows'), 6]);
  if (S.flags.sacred) Lst.push([L('聖なる岩山','Sacred rocks'), 8]);
  if (S.flags.craft) Lst.push([L('職人の誇り','Craft pride'), 4]);
  if (S.flags.steam) Lst.push([L('工場の煙','Factory smoke'), -8]);
  const np = noisePairs(); if (np) Lst.push([L('工場の騒音','Factory noise')+'('+np+')', -Math.min(20, 3*np)]);
  const hl = Math.max(0, pop() - housing()); if (hl) Lst.push([L('家なし','Homeless')+'('+hl+')', -6*hl]);
  if (S.nightShift && isNight() && workerCount()) Lst.push([L('夜勤中','Night shift')+(countB('bath') ? L('（浴場で半分）',' (bath: half)') : ''), countB('bath') ? -6 : -12]);
  return Lst;
}
const moodTarget = () => clamp(moodBreakdown().reduce((a,[,v])=>a+v, 0), 0, 100);
function addMood(v){ S.mood = clamp(S.mood + v, 0, 100); }
function story(ja, en){ S.story.push({d:S.day, t:[ja, en]}); }

/* ---- 売買 */
function sell(it, n, silent){
  n = Math.min(n, Math.floor(S.items[it])); if (n <= 0) return 0;
  let earn = 0;
  for (let k=0;k<n;k++){ earn += price(it); S.sat[it] = Math.max(P.satFloor, S.sat[it]*(1-P.satDrop)); }
  earn = Math.round(earn);
  S.items[it] -= n; S.gold += earn; S.stats.earned += earn; S.stats.sold += n; S.stats.soldBy[it] += n;
  if (!silent){ popAt(wpos(WH).x, 1.2, wpos(WH).z, '+'+fmt(earn)+'G', 'g'); coinBurst(Math.min(8, 1+Math.floor(earn/60))); sfx('coin'); }
  return earn;
}
// 建設費：お金＋一部は鉄（鉄鉱石・インゴット）
function canPay(c){ return S.gold >= (c.g || 0) && Object.keys(c).every(k => k === 'g' || (S.items[k] || 0) >= c[k]); }
function pay(cost){ if (!canPay(cost)) return false; for (const k in cost){ if (k === 'g') S.gold -= cost.g; else S.items[k] -= cost[k]; } return true; }
function costTxt(c){ return fmt(c.g || 0)+'G' + Object.keys(c).filter(k=>k!=='g').map(k=>' + '+N(ITEMS[k].n)+c[k]).join(''); }
function lackTxt(c){ if (S.gold < (c.g || 0)) return L('お金が足りない','Not enough gold'); const k = Object.keys(c).find(k => k !== 'g' && (S.items[k] || 0) < c[k]); return k ? L(N(ITEMS[k].n)+'が足りない（市場に'+c[k]+'個必要）','Not enough '+N(ITEMS[k].n)+' (need '+c[k]+' at the market)') : ''; }
const reqOk = d => !d.req || (d.req === 'airport' ? S.airport : !!S.flags[d.req]);

/* ---- 建設・移動・撤去 */
function canPlace(type, i, sz){
  sz = sz || (type ? BUILD[type].size || 1 : 1);
  if (cx(i) + sz > W || cz(i) + sz > W) return L('島の外です（新エリアで島を広げられる）','Outside the island (expand it from New Areas)');
  for (const j of footCells(i, sz)){
    const c = S.cells[j];
    if (c.t === 'void') return L('島の外です（新エリアで島を広げられる）','Outside the island (expand it from New Areas)') + (sz > 1 ? L('（2×2マス必要）',' (needs 2×2)') : '');
    if (c.t === 'water') return L('川がある','The river is here');
    if (c.t === 'b' || c.t === 'occ') return L('すでに建物がある','Already built here') + (sz > 1 ? L('（2×2マス必要）',' (needs 2×2)') : '');
    if (c.t === 'rock') return L('岩がある','A rock is here');
  }
  if (type && !reqOk(BUILD[type])) return L('まだ建てられない','Not unlocked yet');
  if (type && !canPay(buildCost(type))) return lackTxt(buildCost(type));
  return '';
}
function newB(type){ return {type, lvl:1, workers:0, inb:0, st:{}, prog:0, build:P.buildTime, buildMax:P.buildTime}; }
function clearSpot(i){
  const c = S.cells[i];
  if (c.t === 'tree'){ const n = c.hp * (c.gold ? 3 : 1), it = c.crop || ISL.tree; S.items[it] += n; S.seen[it] = true; S.stats.treesCut++; popAt(wpos(i).x, 0.8, wpos(i).z, '+'+n+' '+N(ITEMS[it].n)); }
  if (reserved[i]) delete reserved[i];
  if (S.soil) delete S.soil[i];
}
function place(type, i){
  if (canPlace(type, i)) return false;
  pay(buildCost(type));
  const sz = BUILD[type].size || 1; for (const j of footCells(i, sz)){ clearSpot(j); if (j !== i){ S.cells[j] = {t:'occ', of:i}; setCellMesh(j); } }
  const b = newB(type); if (type === 'house') b.look = houseLook(null, Math.random());
  S.cells[i] = {t:'b', r:Math.random(), b};
  setCellMesh(i); CM[i].userData.pop = 0.35; sfx('build'); shake(0.06);
  burst(bCenter(i).x, 0.3, bCenter(i).z, 'stone', 6);
  assignLights();
  if (type === 'fun' && countB('fun') === 1) eventQueue.push({result:true, img:'skyfair', title:L('空の遊園地、開園！','The Sky Fair opens!'), text:L('回転木馬がまわりはじめた。飛行船の観光客たちが、さっそく列をつくっている。レベルを上げると乗り物が増える。','The carousel starts to turn, and airship tourists are already lining up. Level it up for more rides.')});
  return true;
}
function moveWhy(from, to){
  const sz = bSize(from);
  if (from === to) return L('同じ場所','Same spot');
  if (S.gold < P.moveCost) return L('お金が足りない','Not enough gold');
  if (cx(to) + sz > W || cz(to) + sz > W) return L('島の外です','Outside the island');
  const mine = new Set(footCells(from, sz));
  for (const j of footCells(to, sz)){ if (mine.has(j)) continue; const c = S.cells[j];
    if (c.t === 'void') return L('島の外です','Outside the island'); if (c.t === 'water') return L('川がある','The river is here'); if (c.t === 'b' || c.t === 'occ') return L('すでに建物がある','Already built here'); if (c.t === 'rock') return L('岩がある','A rock is here'); }
  return '';
}
function moveBuilding(from, to){
  if (moveWhy(from, to)) return false;
  S.gold -= P.moveCost;
  const src = S.cells[from], b = src.b, sz = bSize(from), oldF = footCells(from, sz);
  for (const j of oldF) S.cells[j] = {t:'grass', r:Math.random()};
  for (const j of footCells(to, sz)){ clearSpot(j); if (j !== to) S.cells[j] = {t:'occ', of:to}; }
  b.build = P.moveTime; b.buildMax = P.moveTime;
  S.cells[to] = {t:'b', r:src.r, b};
  for (const j of oldF) if (S.cells[j].t === 'grass') setCellMesh(j);
  for (const w of workers) if (oldF.includes(w.at)) w.at = undefined;
  for (const w of workers) if (w.bi === from){ release(w); w.bi = to; w.tasks = []; w.under = false; }
  delete haulRes[from];
  setCellMesh(from); setCellMesh(to); CM[to].userData.pop = 0.35;
  sfx('build'); assignLights(); if (selCell === from) select(to);
  toast(L('移動中…（'+P.moveTime+'秒ほどで再開）', 'Moving… (back to work in ~'+P.moveTime+'s)'));
  return true;
}
// 解体：すばやく崩れて土ぼこりと破片が飛ぶ
const razes = [], RAZE_T = 0.45;
function razeFx(i){
  const g = CM[i]; if (!g) return;
  CM[i] = null;                                  // setCellMesh に消されないように預かる
  if (g.userData.scaffold) g.userData.scaffold.visible = true;
  if (g.userData.pile) g.userData.pile.visible = false;
  const p = g.position, big = bSize(i) > 1;
  razes.push({g, x:p.x, t:0, s:g.scale.x});
  burst(p.x, 0.5, p.z, 'log', big ? 12 : 7); burst(p.x, 0.3, p.z, 'stone', big ? 12 : 7);
  for (let k=0; k<(big?9:5); k++) puff(p.x + rnd(-.35,.35), 0.15, p.z + rnd(-.35,.35));
  sfx('build'); shake(0.08);
}
function updateRaze(dt){
  for (let k = razes.length-1; k >= 0; k--){
    const R = razes[k]; R.t += dt; const f = R.t / RAZE_T;
    if (f >= 1){ scene.remove(R.g); razes.splice(k, 1); continue; }
    R.g.scale.set(R.s*(1 + f*0.2), R.s*Math.max(0.02, 1 - f*f), R.s*(1 + f*0.2));
    R.g.position.x = R.x + Math.sin(R.t*70)*0.04; R.g.rotation.z = Math.sin(R.t*38)*0.1*f;
  }
}
function demolish(i){
  const b = S.cells[i].b; if (!b || b.type === 'warehouse') return;
  while (b.workers > 0) removeWorker(i);
  S.gold += Math.round(BUILD[b.type].cost.g * 0.4);
  if (BUILD[b.type].in) S.items[BUILD[b.type].in] += b.inb;
  for (const k in b.st || {}) S.items[k] += Math.floor(b.st[k]);
  const foot = footCells(i, bSize(i));
  razeFx(i);
  for (const w of workers) if (foot.includes(w.at)) w.at = undefined;
  for (const j of foot){ S.cells[j] = {t:'grass', r:Math.random()}; setCellMesh(j); }
  assignLights(); select(-1);
}
function hire(i){
  const b = S.cells[i].b;
  if (b.workers >= slots(b)) return toast(L('満員です（レベルを上げると枠が増える）','Full (level up for more slots)'),'bad');
  if (S.idle > 0){ S.idle--; addWorker(i); sfx('hire'); return; }
  if (pop() >= housing()) return toast(L('住む家が足りない！住宅を建てよう','No room! Build a House.'),'bad');
  const c = hireCost(); if (S.gold < c) return toast(L('お金が足りない','Not enough gold'),'bad');
  S.gold -= c; addWorker(i); sfx('hire');
}
function levelUp(i){
  const b = S.cells[i].b; if (b.lvl >= 5) return;
  const c = lvlCost(b); if (S.gold < c) return;
  S.gold -= c; b.lvl++; if (BUILD[b.type].fun) setCellMesh(i); CM[i].userData.pop = 0.35; sfx('build'); burst(wpos(i).x, 0.6, wpos(i).z, 'coin', 8);
}
function changeLook(i, key){
  const b = S.cells[i].b; if (S.gold < LOOK_COST[key]) return;
  b.look = houseLook(b, S.cells[i].r);
  const max = {s:HOUSE_STYLES.length, w:HOUSE_WALLS.length, r:HOUSE_ROOFS.length}[key];
  b.look = {...b.look, [key]: (b.look[key] + 1) % max};
  S.gold -= LOOK_COST[key]; setCellMesh(i); CM[i].userData.pop = 0.3; sfx('hire');
}

/* ---- 住民
   木こり：近くの木を伐って小屋に貯める／採石：岩を割る（坑道が開けば地下を掘る）
   加工：持ち場で機械を動かす／運搬係：作った物を次の加工所へ直接、余りは市場へ */
function addWorker(bi){
  const b = S.cells[bi].b; b.workers++;
  const job = b.type === 'warehouse' ? 'haul' : (BUILD[b.type].job || 'proc');
  const p = wpos(WH);
  const w = {bi, job, x:p.x + rnd(-.2,.2), z:p.z - 0.5, tasks:[], carry:null, n:0, sleep:false, under:false, at:WH, t:0, ox:rnd(-.22,.22), mesh:makeWorkerMesh(job), face:0, walk:0, work:false, dance:0};
  w.mesh.position.set(w.x, 0, w.z); scene.add(w.mesh); workers.push(w); assignHomes();
}
function release(w){ for (const m of [reserved, haulRes]) for (const k in m) if (m[k] === w) delete m[k]; }
function removeWorker(bi){
  const idx = workers.map(w=>w.bi).lastIndexOf(bi); if (idx < 0) return;
  const w = workers[idx];
  if (w.carry) S.items[w.carry] += w.n;
  release(w); scene.remove(w.mesh); workers.splice(idx, 1); S.cells[bi].b.workers--; assignHomes();
}
const whPt = w => ({x: wpos(WH).x + w.ox, z: wpos(WH).z - 0.5});
const bPt = (i, w) => { const p = bCenter(i), k = bSize(i); return {x:p.x + w.ox, z: Math.min(W/2 - 0.15, p.z + 0.42*k)}; };
const goB = (i, w) => ({k:'go', ...bPt(i, w), at:i}), goWH = w => ({k:'go', ...whPt(w), at:WH});
const PLAZA = {x: wpos(WH).x, z: wpos(WH).z - 1.7};
// 住まい：職場に近い家から順に、空きのある家へ（あふれた人は市場で寝る）
function assignHomes(){
  const hs = allB('house').map(i=>({i, cap: 3 + (S.cells[i].b.lvl-1)*2}));
  for (const w of workers.slice().sort((a,b)=>a.bi-b.bi)){
    let best = null, bd = 1e9;
    for (const h of hs){ if (h.cap <= 0) continue; const d = cheb(h.i, w.bi); if (d < bd){ bd = d; best = h; } }
    if (best){ best.cap--; w.home = best.i; } else w.home = WH;
  }
}
function homeOf(w){ const h = w.home; return h !== undefined && S.cells[h]?.t === 'b' && (h === WH || S.cells[h].b.type === 'house') ? h : WH; }
function homePt(w){ const h = homeOf(w); return h === WH ? whPt(w) : bPt(h, w); }
// 仕事を切り上げる時刻：暗くなる（19:15）までに家に着くよう、家が遠い人ほど早く帰る
const SEC_H = P.dayLen*P.dayFrac/14;
function offDuty(w){
  if (!workTime()) return true;
  if (isNight() || (S.nightShift && S.meteorNight !== S.day)) return false;
  const h = hourOf(S.time); if (h < 15) return false;
  const hp = homePt(w), wp = bPt(w.bi, w), walk = Math.hypot(hp.x - wp.x, hp.z - wp.z) / (P.walk * moodF() * 0.85) + (w.job === 'haul' ? 7 : 3);
  return (19.25 - h) * SEC_H < walk;
}
function findNearest(kind, from){
  let best = -1, bd = 1e9;
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t !== kind || reserved[i]) continue;
    const d = Math.hypot(cx(i)-cx(from), cz(i)-cz(from)); if (d < bd){ bd = d; best = i; }
  }
  return best;
}
const upIf = w => w.under ? [{k:'up'}] : [];
const canDig = () => S.flags.mine && S.res.ore > 0 && ISLAND === 'sky';
const outItems = () => [...new Set(Object.values(BUILD).filter(d => islOk(d) && (d.out || d.gen)).map(d => d.out || d.gen))];
// 鉄（鉄鉱石・インゴット）を使う建物で、まだ1つも建てていないものがあるか
const ironWanted = () => Object.entries(BUILD).some(([k, d]) => !d.hidden && islOk(d) && Object.keys(d.cost).length > 1 && reqOk(d) && !countB(k)) && !countB('recycle');
function plan(w){
  const c = S.cells[w.bi]; if (!c || c.t !== 'b') return [{k:'wait', d:1}];
  const b = c.b;
  if (festActive() && w.job === 'haul' && S.upg.carry >= 2) return [...upIf(w), {k:'parade'}];          // 荷車は踊らず、輪の外をゆっくり回る
  if (festActive()){ const a = Math.random()*Math.PI*2, r = 0.5 + Math.random()*0.4; return [...upIf(w), {k:'go', x:PLAZA.x + Math.cos(a)*r, z:PLAZA.z + Math.sin(a)*r}, {k:'dance', d:rnd(3,6)}]; }
  if (starWatch()){ const a = Math.random()*Math.PI*2, r = 0.6 + Math.random()*0.9; return [...upIf(w), {k:'go', x:PLAZA.x + Math.cos(a)*r, z:PLAZA.z + Math.sin(a)*r}, {k:'dance', d:rnd(5,9), calm:true, star:true}]; }
  if (holidayNow()){ const land = S.cells.map((c,i)=>c.t==='void'||c.t==='water'||c.t==='b'||c.t==='occ'?-1:i).filter(i=>i>=0), p = wpos(land[Math.floor(Math.random()*land.length)]); return [...upIf(w), {k:'go', x:p.x + rnd(-.3,.3), z:p.z + rnd(-.3,.3)}, {k:'dance', d:rnd(2,4), calm:true}]; }
  if (offDuty(w)) return [...upIf(w), {k:'go', ...homePt(w), at:homeOf(w), home:true}, {k:'sleep'}];
  if (b.broken || b.build > 0) return [...upIf(w), goB(w.bi, w), {k:'wait', d:1.5, in:b.build <= 0}];
  if (w.job === 'haul') return planHaul(w);
  if (w.job === 'chop'){
    if (S.day < S.flags.protectUntil || stTotal(b) >= stCap(b)) return idleAt(w, 2);
    const tgt = findNearest('tree', w.bi);
    if (tgt < 0) return idleAt(w, 2);
    reserved[tgt] = w;
    const tp = wpos(tgt), dx = w.x - tp.x, dz = w.z - tp.z, Ln = Math.hypot(dx,dz) || 1;
    return [{k:'go', x:tp.x + dx/Ln*0.32, z:tp.z + dz/Ln*0.32, at:tgt}, {k:'work', cell:tgt, kind:'tree'}, goB(w.bi, w), {k:'store'}];
  }
  if (w.job === 'quarry'){
    if (stTotal(b) >= stCap(b)) return [...upIf(w), ...idleAt(w, 2)];
    if (canDig()) return [...(w.under ? [] : [goB(w.bi, w), {k:'down'}]), {k:'dig', t:0}];
    const tgt = findNearest('rock', w.bi);
    if (tgt < 0) return [...upIf(w), ...idleAt(w, 3)];
    reserved[tgt] = w;
    const tp = wpos(tgt), dx = w.x - tp.x, dz = w.z - tp.z, Ln = Math.hypot(dx,dz) || 1;
    return [...upIf(w), {k:'go', x:tp.x + dx/Ln*0.34, z:tp.z + dz/Ln*0.34, at:tgt}, {k:'work', cell:tgt, kind:'rock'}, goB(w.bi, w), {k:'store'}];
  }
  const door = goB(w.bi, w), op = [door, {k:'op', d:2}];
  // ふだんは中で働き、たまに荷物を抱えて外へ用事に出る（用事中も働いている扱い）
  if (Math.random() >= 0.14) return op;
  const out = BUILD[b.type].out || BUILD[b.type].gen;
  return [...op, {k:'go', ...outPt(w), shift:true, show:out}, {k:'wait', d:rnd(0.8,1.8), shift:true}, {...goB(w.bi, w), shift:true}];
}
// 手が空いた人は建物の中で待つ。たまに近所を歩く
function idleAt(w, d){
  const r = [w.job === 'haul' ? goWH(w) : goB(w.bi, w), {k:'wait', d, in:true}];
  return Math.random() < 0.18 ? [...r, {k:'go', ...outPt(w)}, {k:'wait', d:rnd(0.8,1.8)}] : r;
}
// 祭りの荷車：踊りの輪の外を周回。建物のある方角では半径を変えてよける
const PARADE_R = [1.6, 1.4, 1.25, 1.9];
function paradePt(a){
  const N0 = 24, u = ((a / (Math.PI*2)) % 1 + 1) % 1 * N0, k = Math.floor(u), f = u - k;
  const radius = j => {
    const an = j/N0*Math.PI*2;
    for (const r of PARADE_R){
      const x = PLAZA.x + Math.cos(an)*r, z = PLAZA.z + Math.sin(an)*r*0.82;
      if (Math.abs(x) >= W/2 || Math.abs(z) >= W/2) continue;
      if (!['b','occ','void','water','rock'].includes(S.cells[cellAt(x, z)].t)) return r;
    }
    return 1.3;
  };
  const r = radius(k)*(1-f) + radius((k+1) % N0)*f;
  return {x:PLAZA.x + Math.cos(a)*r, z:PLAZA.z + Math.sin(a)*r*0.82};
}
// ちょっとした用事の行き先：となりの空きマスか、近所の建物の戸口
function outPt(w){
  const near = allB().filter(j => j !== w.bi && cheb(j, w.bi) <= 2);
  if (near.length && Math.random() < 0.6) return bPt(near[Math.floor(Math.random()*near.length)], w);
  const open = neigh4(w.bi).filter(j => ['grass','sapling'].includes(S.cells[j].t));
  if (!open.length) return bPt(w.bi, w);
  const p = wpos(open[Math.floor(Math.random()*open.length)]);
  return {x:p.x + rnd(-.25,.25), z:p.z + rnd(-.25,.25)};
}
// 運搬係：できた物は「必要としている加工所」へ直接運ぶ。行き先がなければ市場へ
function planHaul(w){
  const cap = haulCap(); let best = null, bs = 0;
  const consumer = (it, from) => { let c = -1, bd = 1e9; for (const j of allB()){ const bj = S.cells[j].b, dj = BUILD[bj.type]; if (dj.in !== it || bj.build > 0 || bj.broken || bj.inb >= bufCap(bj) - 1) continue; const d = cheb(j, from) + 6*bj.inb/bufCap(bj) + (bj.workers ? 0 : 20); if (d < bd){ bd = d; c = j; } } return c; };
  for (const i of allB()){
    if (i === WH || haulRes[i]) continue;
    const b = S.cells[i].b, d = BUILD[b.type];
    if (b.build > 0) continue;
    const tot = Math.floor(stTotal(b));
    if (tot >= 1){
      const it = stMain(b), dest = consumer(it, i), to = dest >= 0 ? dest : WH;
      const dist = 1 + cheb(WH, i) + cheb(i, to);
      const sc = (tot >= stCap(b) ? 3 : 1) * Math.min(tot, cap) / dist * (dest >= 0 ? 1.3 : 1);
      if (sc > bs){ bs = sc; best = {i, kind:'pick', it, to}; }
    }
    if (d.in && b.workers && !b.broken && S.items[d.in] >= 1 && b.inb < bufCap(b) - 1){
      const sc = (b.inb < 2 ? 2.5 : 0.8) * Math.min(cap, bufCap(b) - b.inb) / (1 + 2*cheb(WH, i));
      if (sc > bs){ bs = sc; best = {i, kind:'supply'}; }
    }
  }
  if (!best) return idleAt(w, 1);
  haulRes[best.i] = w;
  if (best.kind === 'pick'){
    if (best.to === WH) return [goB(best.i, w), {k:'take', i:best.i, it:best.it}, {k:'rel'}, goWH(w), {k:'dep'}];
    return [goB(best.i, w), {k:'take', i:best.i, it:best.it, room:best.to}, {k:'rel'}, goB(best.to, w), {k:'putIn', i:best.to}];
  }
  return [goWH(w), {k:'takeIn', i:best.i}, goB(best.i, w), {k:'putIn', i:best.i}, {k:'rel'}];
}
// 持ち場から遠いほど急に遅くなる（遠い木・遠い建物は極端に非効率）
function farPenalty(w){ const d = cheb(cellAt(w.x, w.z), w.bi); return d > P.farFrom ? 1 / (1 + P.farK * (d - P.farFrom) ** 2) : 1; }
function walkSpeed(w, t){
  const paved = S.upg.road && t && t.key && S.routes[t.key] > 0.45;
  return P.walk * moodF() * (1 + (driveOf().work - 1)*0.4) * lampNight() * (w.job === 'haul' ? HAUL_SPD[S.upg.carry] ?? 1 : 1) * (nearBonus(w.bi) ? 1.25 : 1) * (paved ? 1 + 0.25*S.upg.road : 1) * farPenalty(w);
}
function updateWorker(w, dt){
  w.work = false; w.dance = 0;
  if (w.sleep){ if (!offDuty(w) || festActive() || holidayNow() || starWatch()){ w.sleep = false; w.mesh.visible = true; w.tasks = []; } else return; }
  if (!w.tasks.length) w.tasks = plan(w);
  const t = w.tasks[0]; if (!t) return;
  // 帰る時間になったら、手ぶらなら作業を切り上げて家へ
  if (!t.home && t.k !== 'sleep' && t.k !== 'dance' && t.k !== 'parade' && !w.carry && offDuty(w) && !festActive() && !holidayNow() && !starWatch()){ if (t.k === 'go') w.at = undefined; release(w); w.tasks = []; return; }
  const cb = S.cells[w.bi]; if (cb.t !== 'b'){ w.tasks = []; return; }
  const b = cb.b;
  // 建物の中にいるか（go は実際に歩きだしたときに外へ出る。その場への go で一瞬だけ見えることがないように）
  if (t.k !== 'go') w.inside = t.k === 'op' || (t.k === 'wait' && !!t.in);
  switch (t.k){
    case 'go': {
      if (!t.begun){
        // 道は「入口から入口へ」の1本だけ。かたまりの中は建物づたいに歩く
        t.begun = true;
        if (w.at !== undefined && t.at !== undefined){
          const A = entryOf(w.at), B = entryOf(t.at);
          if (A !== B){
            const a = nodePt(A), c = nodePt(B), key = routeKey(a.x, a.z, c.x, c.z), len = Math.hypot(a.x - c.x, a.z - c.z);
            // 建物どうしの道はすぐ付く。木や岩への道は通い詰めたときだけ
            const wm = [A, B].some(n => ['tree','rock'].includes(S.cells[n].t)) ? 0.8 : 2;
            const legs = [], on = roadEnd(a, c, A), off = roadEnd(c, a, B);
            if (S.cells[A].t === 'b') legs.push({...t, ...on, at:A});
            if (S.cells[B].t === 'b') legs.push({...t, ...off, at:B, key, len, wm}, {...t});
            else legs.push({...t, key, len, wm});
            w.tasks.splice(0, 1, ...legs);
            break;
          }
        }
      }
      const dx = t.x - w.x, dz = t.z - w.z, Ln = Math.hypot(dx, dz), st = walkSpeed(w, t)*dt;
      if (Ln <= st){ w.x = t.x; w.z = t.z; w.at = t.at; w.tasks.shift(); }
      else { w.inside = false; w.x += dx/Ln*st; w.z += dz/Ln*st; w.face = Math.atan2(dx, dz); w.walk += dt*14; if (t.key) wearRoute(t.key, t.len, dt*(t.wm || 1)); }
      break; }
    case 'wait': t.d -= dt; if (t.d <= 0) w.tasks.shift(); break;
    case 'op': t.d -= dt; w.work = true; w.t += dt; if (t.d <= 0) w.tasks.shift(); break;
    case 'dance': t.d -= dt; w.dance = t.calm ? 1 : 2; if (Math.random() < dt*0.25) popAt(w.x, 0.7, w.z, t.star ? '☆' : '♪'); if (t.d <= 0) w.tasks.shift(); break;
    case 'parade': {
      if (!festActive()){ w.tasks = []; break; }
      const cars = workers.filter(v => v.job === 'haul'), a = simNow()*0.45 + cars.indexOf(w)/Math.max(1, cars.length)*Math.PI*2;
      const g = paradePt(a), dx = g.x - w.x, dz = g.z - w.z, d = Math.hypot(dx, dz), st = 1.6*dt;
      w.at = undefined; w.dance = 3;
      if (d > 1e-4){ const m = Math.min(d, st); w.x += dx/d*m; w.z += dz/d*m; w.walk += m*9; if (d > 0.004) w.face = Math.atan2(dx, dz); }
      break; }
    case 'sleep': w.sleep = true; w.mesh.visible = false; w.tasks = []; break;
    case 'down': w.under = true; w.tasks.shift(); break;
    case 'up': { w.under = false; w.at = w.bi; const p = bPt(w.bi, w); w.x = p.x; w.z = p.z; w.tasks.shift(); break; }
    case 'work': {
      const c = S.cells[t.cell];
      if (c.t !== t.kind || (t.kind === 'tree' && S.day < S.flags.protectUntil)){ delete reserved[t.cell]; if (w.n > 0) w.tasks.shift(); else w.tasks = []; break; }
      const tp = wpos(t.cell); w.face = Math.atan2(tp.x - w.x, tp.z - w.z); w.work = true;
      w.t += dt * moodF() * workF() * (1 + 0.25*S.upg.axe) * (1 + 0.2*(b.lvl-1));
      if (w.t >= (t.kind === 'tree' ? P.chopTime : P.quarryTime)){
        w.t = 0; c.hp--;
        if (t.kind === 'tree'){ w.carry = c.crop || ISL.tree; w.n += c.gold ? 3 : 1; if (CM[t.cell]) CM[t.cell].userData.hit = 0.18; fellCheck(t.cell); }
        else { w.carry = ISL.rock; w.n += 1; if (CM[t.cell]) CM[t.cell].userData.hit = 0.18; rockCheck(t.cell); }
        if (w.n >= carryCap() || S.cells[t.cell].t !== t.kind){ delete reserved[t.cell]; w.tasks.shift(); }
      }
      break; }
    case 'dig': {
      if (!canDig()){ w.tasks.shift(); break; }
      w.work = true; t.t += dt * moodF() * workF() * (1 + 0.25*S.upg.axe) * (1 + 0.2*(b.lvl-1));
      if (t.t >= P.digTime){
        const n = Math.min(1, S.res.ore);
        S.res.ore -= n; stAdd(b, 'ore', n); S.stats.made.ore += n; S.seen.ore = true;
        if (CM[w.bi]) CM[w.bi].userData.hit = 0.1;
        if (S.res.ore <= 0) toast(L('地下の鉱脈を掘り尽くした…','The underground vein is exhausted…'),'bad');
        w.tasks.shift();
      }
      break; }
    case 'store':
      if (w.carry){ stAdd(b, w.carry, w.n); S.stats.made[w.carry] += w.n; }
      w.carry = null; w.n = 0; w.tasks.shift(); break;
    case 'take': {
      const c = S.cells[t.i]; if (c.t !== 'b'){ w.tasks.shift(); break; }
      const tb = c.b, it = t.it && tb.st[t.it] >= 1 ? t.it : stMain(tb);
      if (it){
        let n = Math.min(Math.floor(tb.st[it]), haulCap());
        if (t.room !== undefined && S.cells[t.room].t === 'b'){ const rb = S.cells[t.room].b; n = Math.min(n, bufCap(rb) - rb.inb); }
        if (n > 0){ tb.st[it] -= n; w.carry = it; w.n = n; }
      }
      w.tasks.shift(); break; }
    case 'rel': release(w); w.tasks.shift(); break;
    case 'takeIn': {
      const c = S.cells[t.i]; if (c.t !== 'b'){ release(w); w.tasks = []; break; }
      const tb = c.b, d = BUILD[tb.type];
      const n = Math.min(Math.floor(S.items[d.in]), haulCap(), bufCap(tb) - tb.inb);
      if (n > 0){ S.items[d.in] -= n; w.carry = d.in; w.n = n; w.tasks.shift(); } else { release(w); w.tasks = []; }
      break; }
    case 'putIn': {
      const c = S.cells[t.i];
      if (w.carry && c.t === 'b' && BUILD[c.b.type].in === w.carry){ const room = bufCap(c.b) - c.b.inb, n = Math.min(room, w.n); c.b.inb += n; w.n -= n; if (!w.n) w.carry = null; }
      if (w.carry){ w.tasks = [goWH(w), {k:'dep'}]; break; }   // 入りきらなかった分は市場へ
      w.tasks.shift(); break; }
    case 'dep':
      if (w.carry){ S.items[w.carry] += w.n; S.seen[w.carry] = true; }
      w.carry = null; w.n = 0; w.tasks.shift(); break;
  }
}
function fellCheck(i){
  const c = S.cells[i];
  if (c.t === 'tree' && c.hp <= 0){ S.cells[i] = c.crop ? {t:'sapling', crop:c.crop, g:0, r:c.r} : {t:'grass', r:Math.random()}; setCellMesh(i); S.stats.treesCut++; burst(wpos(i).x, 0.5, wpos(i).z, 'leaf', 6); }
}
function rockCheck(i){
  const c = S.cells[i];
  if (c.t !== 'rock') return;
  if (c.hp <= 0){ S.cells[i] = {t:'grass', r:Math.random()}; setCellMesh(i); burst(wpos(i).x, 0.3, wpos(i).z, 'stone', 8); }
}
// 建物をクリック：貯まった物を市場へ回収し、加工所には材料を補充する
function collect(i){
  const b = S.cells[i].b, d = BUILD[b.type], p = wpos(i), got = [];
  for (const k in b.st || {}){
    const n = Math.floor(b.st[k]); if (n < 1) continue;
    b.st[k] -= n; S.items[k] += n; S.seen[k] = true; got.push(N(ITEMS[k].n)+' +'+n);
    burst(p.x, 0.6, p.z, k === 'log' ? 'log' : k === ISL.rock ? 'stone' : 'item', Math.min(5, n), ITEMS[k].c);
  }
  if (d.in && S.items[d.in] >= 1 && b.inb < bufCap(b)){
    const n = Math.min(Math.floor(S.items[d.in]), bufCap(b) - b.inb); S.items[d.in] -= n; b.inb += n; got.push(L(N(ITEMS[d.in].n)+'を'+n+'個補充', 'Supplied '+n+' '+N(ITEMS[d.in].n)));
  }
  if (got.length){ popAt(p.x, 1.1, p.z, got.join(' / ')); sfx('coinS'); hitStop = 0.03; if (CM[i]) CM[i].userData.hit = 0.15; S.stats.collects++; }
  return got.length > 0;
}

/* =========================================================
   放牧（酪農の島ならではの仕組み）
   ・鐘のまわり5×5マス（輪）の草を、牛が自分で食べに行く。乳が張ると牛舎へ帰って搾られる（タップでも搾れる）
   ・輪の中では草が再生しない。鐘を移して休ませた食べ跡には、乳が2倍濃くなるクローバーが生える
   ・草がなくなったのに居座ると泥地になり、しばらく生えない
   ========================================================= */
const COW = {first:3, max:20, full:4, biteT:3, yield:0.5, hay:0.6, speed:0.75, ring:2, mud:9, trample:0.06, rest:40, mudRest:220, price:220, grow:1.28};
const COW_NAMES = [['ミルク','Milky'],['こむぎ','Wheat'],['まめ','Bean'],['わたあめ','Cotton'],['おもち','Mochi'],['きなこ','Kinako'],['だいふく','Daifuku'],['あずき','Azuki'],['ぷりん','Pudding'],['しらたま','Pearl'],['くるみ','Walnut'],['もなか','Monaka'],['はなこ','Daisy'],['ゆず','Yuzu'],['ごま','Sesame'],['つくし','Clover'],['もも','Peach'],['すず','Bell'],['こはる','Sunny'],['そら','Sky'],['ちょこ','Cocoa'],['ぽてと','Potato'],['むぎ','Barley'],['ゆき','Snow']];
const isDairy = ISLAND === 'dairy';
const inRing = i => cheb(i, S.bell) <= COW.ring;
const isMud = i => !!S.soil && (S.soil[i]?.v || 0) >= COW.mud;
const pastureAt = at => { let n = 0; for (let i=0;i<W*W;i++) if (S.cells[i].t === 'tree' && cheb(i, at) <= COW.ring) n++; return n; };
const cowCap = () => Math.min(COW.max, COW.first + allB('barn').reduce((a,i) => a + 2 + S.cells[i].b.lvl, 0));
const cowCost = () => Math.round(COW.price * Math.pow(COW.grow, Math.max(0, S.herd.length - COW.first)));
const isFull = c => c.belly >= COW.full;
const starCow = () => S.herd?.reduce((a,c) => !a || c.total > a.total ? c : a, null);
let soilAcc = 0, ringWasEmpty = false;

function newCow(near){
  const used = new Set(S.herd.map(c => c.name)); let name = 0;
  while (used.has(name) && name < COW_NAMES.length-1) name++;
  const p = wpos(near);
  const c = {name, x:p.x + rnd(-.6,.6), z:p.z + rnd(.2,.8), face:Math.random()*6, belly:0, load:0, total:0, tgt:-1, wait:-1, t:0};
  S.herd.push(c); return c;
}
function initHerd(){
  if (!isDairy) return false;
  S.soil ??= {}; S.upg.dog ??= 0;
  if (S.herd) return false;
  let best = WH, bn = -1;
  for (let i=0;i<W*W;i++) if (S.cells[i].t !== 'void' && S.cells[i].t !== 'b'){ const n = pastureAt(i) - cheb(i, WH)*0.3; if (n > bn){ bn = n; best = i; } }
  S.bell = best; S.herd = [];
  for (let k=0;k<COW.first;k++) newCow(best);
  return true;
}
function setBell(i, byDog){
  if (!isDairy || S.cells[i].t === 'void') return;
  const from = S.bell; S.bell = i;
  for (const c of S.herd){ c.tgt = -1; c.t = 0; c.roam = null; }
  for (const k in S.soil) if (cheb(+k, from) <= COW.ring) S.soil[k].t = simNow();   // ここから休ませはじめる
  S.stats.bellMoves = (S.stats.bellMoves || 0) + 1; ringWasEmpty = false;
  const p = wpos(i); popAt(p.x, 1, p.z, byDog ? L('ワン！','Woof!') : L('カラン♪','Clang♪')); sfx('pet');
}
function milkAmount(c){ return Math.max(1, Math.round(c.load * COW.yield * (S.flags.holstein ? 1.3 : 1))); }
function emptyCow(c, n){ c.total += n; c.belly = 0; c.load = 0; c.wait = -1; c.t = 0; }
function milkByHand(c){
  if (!isFull(c)) return false;
  const n = milkAmount(c); emptyCow(c, n);
  S.items.milk += n; S.stats.made.milk += n; S.seen.milk = true; S.stats.clicks++;
  popAt(c.x, 0.9, c.z, '+'+n+' '+N(ITEMS.milk.n)); burst(c.x, 0.4, c.z, 'leaf', 4, ITEMS.milk.c); sfx('coinS');
  return true;
}
function buyCow(i){
  const c = cowCost();
  if (!isB(i, 'barn') || S.herd.length >= cowCap() || S.gold < c) return false;
  S.gold -= c; const cw = newCow(i);
  popAt(cw.x, 0.9, cw.z, L(COW_NAMES[cw.name][0]+'がやってきた','Say hello to '+COW_NAMES[cw.name][1])); sfx('hire');
  return true;
}
function herdStep(dt){
  const night = isNight(), barns = allB('barn').filter(i => S.cells[i].b.build <= 0 && !S.cells[i].b.broken), busy = {};
  for (const c of S.herd) if (c.tgt >= 0) busy[c.tgt] = (busy[c.tgt] || 0) + 1;
  const nearBarn = (c, ok) => { let b = -1, bd = 1e9; for (const i of barns){ if (ok && !ok(S.cells[i].b)) continue; const p = wpos(i), d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd){ bd = d; b = i; } } return b; };
  S.herd.forEach((c, k) => {
    let goal, barn = -1, graze = false;
    c.eating = false;
    if (isFull(c) || night){
      c.tgt = -1;
      barn = isFull(c) ? nearBarn(c, b => b.workers > 0) : nearBarn(c, b => b.inb >= 1);
      if (barn < 0) barn = nearBarn(c);
    } else {
      if (c.tgt >= 0 && (S.cells[c.tgt].t !== 'tree' || !inRing(c.tgt))){ busy[c.tgt]--; c.tgt = -1; }
      if (c.tgt < 0){
        let bd = 1e9;
        for (let dz=-COW.ring; dz<=COW.ring; dz++) for (let dx=-COW.ring; dx<=COW.ring; dx++){
          const x = cx(S.bell)+dx, z = cz(S.bell)+dz; if (x<0||z<0||x>=W||z>=W) continue;
          const j = z*W+x; if (S.cells[j].t !== 'tree' || (busy[j] || 0) >= 2) continue;
          const p = wpos(j), d = Math.hypot(p.x - c.x, p.z - c.z) - (S.cells[j].clover ? 1 : 0);
          if (d < bd){ bd = d; c.tgt = j; }
        }
        if (c.tgt >= 0) busy[c.tgt] = (busy[c.tgt] || 0) + 1;
      }
      if (c.tgt >= 0) graze = true;
      else barn = nearBarn(c, b => b.inb >= 1);
    }
    if (graze){ const p = wpos(c.tgt), side = k % 2 ? 1 : -1; goal = {x:p.x + side*0.36, z:p.z + 0.12}; }
    else if (barn >= 0){ const p = wpos(barn); goal = {x:p.x + ((k%5) - 2)*0.26, z:Math.min(W/2 - 0.15, p.z + 0.5 + (Math.floor(k/5)%3)*0.17)}; }
    else {
      if (!c.roam || Math.random() < dt*0.12){ const b = wpos(S.bell); c.roam = {x:b.x + rnd(-1,1), z:b.z + rnd(-1,1)}; }
      goal = c.roam;
    }
    c.wait = -1;
    const dx = goal.x - c.x, dz = goal.z - c.z, d = Math.hypot(dx, dz);
    if (d > 0.04){
      const st = Math.min(d, COW.speed * dt);
      c.x += dx/d*st; c.z += dz/d*st; c.face = Math.atan2(dx, dz); c.moving = true; return;
    }
    c.moving = false;
    if (isFull(c)){ c.wait = barn; return; }
    if (!graze && barn < 0) return;
    const hay = !graze && S.cells[barn].b;
    if (hay && hay.inb < 1) return;
    c.eating = true;
    if (graze){ const p = wpos(c.tgt); c.face = Math.atan2(p.x - c.x, p.z - c.z); }
    c.t += dt; if (c.t < COW.biteT) return;
    c.t = 0; c.belly++;
    if (hay){ hay.inb--; c.load += COW.hay; return; }
    const j = c.tgt, g = S.cells[j], so = S.soil[j] || (S.soil[j] = {v:0, t:0});
    c.load += g.gold ? 3 : g.clover ? 2 : 1;
    so.v = Math.min(COW.mud - 1, so.v + 1); so.t = simNow();
    g.hp--; if (CM[j]) CM[j].userData.hit = 0.1;
    if (g.hp <= 0){ S.cells[j] = {t:'grass', r:Math.random()}; setCellMesh(j); c.tgt = -1; }
  });
  soilAcc += dt;
  if (soilAcc >= 1){ soilStep(soilAcc, night); soilAcc = 0; }
}
// 輪の外で休んだ食べ跡はクローバーに。草のない輪に居座ると泥に
function soilStep(dt, night){
  const now = simNow(), left = pastureAt(S.bell), hungry = !night && !left && S.herd.length > 0;
  for (const k in S.soil){
    const i = +k, so = S.soil[k], c = S.cells[i];
    if (c.t === 'b' || c.t === 'occ' || c.t === 'void'){ delete S.soil[k]; continue; }
    if (c.t !== 'grass') continue;
    if (inRing(i)){
      so.t = now;
      if (hungry && so.v < COW.mud){
        so.v += dt * COW.trample * (S.flags.skycow ? 0.5 : 1);
        if (so.v >= COW.mud){
          const p = wpos(i); popAt(p.x, 0.6, p.z, L('泥地に…','Mud…'));
          if (S.mudToast !== S.day){ S.mudToast = S.day; toast(L('草のない場所に居座ったので泥地になってきた。鐘を移そう','The herd lingered on bare ground and it is turning to mud. Move the bell'),'bad'); }
        }
      }
    } else if (so.v >= COW.mud){ if (now - so.t > COW.mudRest) delete S.soil[k]; }
    else if (now - so.t > COW.rest){
      delete S.soil[k];
      S.cells[i] = {t:'sapling', g:0.3, r:Math.random(), clover:true}; setCellMesh(i);
      S.stats.clover = (S.stats.clover || 0) + 1;
    }
  }
  if (left || night){ ringWasEmpty = false; return; }
  if (S.upg.dog){
    let best = -1, bd = 1e9;
    for (let i=0;i<W*W;i++){ if (S.cells[i].t === 'void') continue; const n = pastureAt(i); if (n < 2) continue; const d = cheb(i, S.bell) - Math.min(n, 5)*0.4; if (d < bd){ bd = d; best = i; } }
    if (best >= 0){ setBell(best, true); return; }
  }
  if (!ringWasEmpty){ ringWasEmpty = true; toast(L('輪の中の草を食べ尽くした。鐘を移すと、食べ跡はクローバーになる','The ring is grazed bare. Move the bell and clover will follow'), 'ev'); }
}

// 鐘と輪・土の色
const bellG = new THREE.Group(), ringG = new THREE.Group(); scene.add(bellG, ringG); bellG.visible = ringG.visible = false;
const ringMat = new THREE.MeshBasicMaterial({color:0xffe070});
function bellModel(){
  const g = new THREE.Group();
  for (const x of [-0.17,0.17]) g.add(part(G.box, 0x7a4a2a, 0.05,0.75,0.05, x,0.37,0));
  g.add(part(G.box, 0x7a4a2a, 0.46,0.07,0.1, 0,0.77,0));
  const b = new THREE.Group(); b.position.y = 0.72;
  b.add(part(G.cone6, 0xf0c040, 0.14,0.27,0.14, 0,-0.18,0)); b.add(part(G.sph, 0x8a6a20, 0.035,0.035,0.035, 0,-0.33,0));
  g.add(b); g.userData.bell = b; return g;
}
let bellBody = null, bellDog = null, paintAcc = 1;
function updateBell(dt){
  if (!isDairy || !S.herd) return;
  if (!bellBody){
    bellBody = bellModel(); bellG.add(bellBody);
    bellDog = new THREE.Group(); bellDog.position.set(0.42,0,0.2); bellDog.rotation.y = 0.8;
    bellDog.add(part(G.box, 0x3a3230, 0.12,0.12,0.22, 0,0.13,0)); bellDog.add(part(G.box, 0xf4f0e8, 0.1,0.1,0.1, 0,0.22,0.13)); bellDog.add(part(G.box, 0xf4f0e8, 0.03,0.1,0.03, 0,0.2,-0.12));
    for (const [x,z] of [[-.04,-.07],[.04,-.07],[-.04,.07],[.04,.07]]) bellDog.add(part(G.box, 0xf4f0e8, 0.03,0.09,0.03, x,0.045,z));
    bellG.add(bellDog);
    const R = COW.ring + 0.5;
    for (let k=0;k<10;k++) for (let side=0;side<4;side++){
      const t = -R + (k+0.5)*R*2/10, m = new THREE.Mesh(G.box, ringMat);
      m.scale.set(side<2 ? 0.28 : 0.05, 0.025, side<2 ? 0.05 : 0.28);
      m.position.set(side<2 ? t : (side===2 ? -R : R), 0.04, side<2 ? (side ? R : -R) : t); ringG.add(m);
    }
  }
  const picking = mode?.kind === 'bell' && hoverCell >= 0, p = wpos(S.bell), rp = picking ? wpos(hoverCell) : p;
  bellG.visible = ringG.visible = true;
  bellG.position.set(p.x, 0, p.z); ringG.position.set(rp.x, 0, rp.z);
  bellG.scale.setScalar(S.cells[S.bell].t === 'b' ? 1.2 : 1);
  const empty = !pastureAt(picking ? hoverCell : S.bell);
  ringMat.color.set(empty ? 0xff6b5b : 0xffe070);
  bellBody.userData.bell.rotation.z = Math.sin(elapsed*(empty ? 8 : 2))*(empty ? 0.4 : 0.1);
  bellDog.visible = !!S.upg.dog;
  paintAcc += dt;
  if (paintAcc < 1) return;
  paintAcc = 0;
  const col = new THREE.Color(), worn = new THREE.Color(0xc8c478), mud = new THREE.Color(0x7a5638);
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t === 'void') continue;
    col.copy(((cx(i)+cz(i))%2) ? TILE_A : TILE_B); col.offsetHSL(0, 0, ((i*37)%7-3)*0.006);
    const v = S.soil[i]?.v || 0;
    if (v >= COW.mud) col.copy(mud).offsetHSL(0, 0, ((i*13)%5-2)*0.015); else if (v) col.lerp(worn, 0.2 + 0.6*v/COW.mud);
    tileMesh.setColorAt(i, col);
  }
  if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
}

/* =========================================================
   川と四季（農耕の島ならではの仕組み）
   ・揚水水車のLv（5まで）で川が自分で伸びる。建物はよけて曲がり、端に届けば滝、次のLvは枝分かれ。夏は先の方が干上がる
   ・稲は水ぎわ、小麦は乾いた土、かぼちゃは違う作物の隣でよく育つ
   ・四季は2日ずつ。作物には得意な季節があり、冬はどれも育たない（貯めて加工でしのぐ）
   ========================================================= */
const SEASON_DAYS = 2;
const SEASONS = [['春','Spring'],['夏','Summer'],['秋','Autumn'],['冬','Winter']];
const RIVER = {step:6, dry:0.25};          // 1Lvで伸びる長さ・夏に干上がる割合
const CROPS = {
  wheat:{n:['小麦','Wheat'],       seed:4, T:95, s:[1.4,0.7,1.2,0], wet:0.25, dry:1,   d:['乾いた土が好き。春と秋に伸びる。川のとなりは苦手','Likes dry soil, spring and autumn. Hates being next to water.']},
  rice: {n:['稲','Rice'],          seed:6, T:95, s:[0.8,1.6,1.1,0], wet:1.4,  dry:0.08, d:['流れのある川のとなりで育つ。夏に伸びる','Grows beside flowing water. Loves summer.']},
  veg:  {n:['かぼちゃ','Pumpkins'], seed:5, T:105, s:[1,0.8,1.6,0],   wet:1.2,  dry:0.55, d:['違う作物のとなりだと速い。秋に伸びる','Faster next to a different crop. Loves autumn.']},
};
const CROP_KEYS = Object.keys(CROPS);
const seasonOf = day => Math.floor((day-1)/SEASON_DAYS) % 4;
const season = () => seasonOf(S.day);
let waterLive = new Set(), waterSig = '', waterAll = [];
function riverCells(){          // 湧き水からつながる川（近い順）
  const src = S.cells.findIndex(c => c.t === 'water' && c.spring); if (src < 0) return [];
  const q = [src], seen = new Set(q);
  for (let k=0; k<q.length; k++) for (const j of neigh4(q[k])) if (S.cells[j].t === 'water' && !seen.has(j)){ seen.add(j); q.push(j); }
  return q;
}
const dryCount = (n, se = season()) => se === 1 ? Math.floor(n * RIVER.dry) : 0;
function calcFlow(){
  waterLive = new Set(); waterAll = [];
  if (!isFarm) return;
  waterAll = riverCells();
  const n = waterAll.length - dryCount(waterAll.length - 1);          // 夏は遠い方から干上がる
  for (let k=0; k<n; k++) waterLive.add(waterAll[k]);
}
function refreshWater(){
  if (!isFarm) return;
  calcFlow();
  for (let i=0;i<W*W;i++) if (S.cells[i].t === 'water') setCellMesh(i);
  paintAccF = 1;
}
const atEdge = i => { const n = neigh4(i); return n.length < 4 || n.some(j => S.cells[j].t === 'void'); };
// 次に川が通るマス。流せる場所がなければ null
function planRiver(){
  const river = riverCells(); if (!river.length) return null;
  const inRiver = new Set(river), lv = S.upg.pump || 0, jig = j => hash(j + lv*151, S.seed);
  const open = j => ['grass','sapling','tree','rock'].includes(S.cells[j].t);          // 建物・島の外・今ある川は通れない
  function search(srcs, heading){
    const cost = new Map(), prev = new Map(), len = new Map(), todo = new Set(srcs);
    for (const i of srcs){ cost.set(i, 0); len.set(i, 0); }
    while (todo.size){
      let u = -1; for (const i of todo) if (u < 0 || cost.get(i) < cost.get(u)) u = i;
      todo.delete(u);
      if (len.get(u) && atEdge(u)) continue;          // 端に着いたら、そこで滝
      const dir = prev.has(u) ? u - prev.get(u) : heading;
      for (const v of neigh4(u)){
        if (!open(v)) continue;
        let c = 1 + jig(v)*0.2;
        if (dir && v - u !== dir) c += 0.45;                                          // なるべく真っすぐ
        if (S.cells[v].crop) c += 3;                                                  // 田畑はなるべく避ける
        if (neigh4(v).some(j => j !== u && inRiver.has(j))) c += 2.5;                 // 今ある川に沿わない
        if (cheb(v, WH) <= 1) c += 4;                                                 // 市場の前は空ける
        c += cost.get(u);
        if (c < (cost.get(v) ?? Infinity) - 1e-6){ cost.set(v, c); prev.set(v, u); len.set(v, len.get(u) + 1); todo.add(v); }
      }
    }
    return {prev, cells:[...prev.keys()], cost, len};
  }
  const pathTo = (R, t) => { const p = []; for (let j = t; R.prev.has(j) && p.length < W*W; j = R.prev.get(j)) p.unshift(j); return p; };
  function toEdge(R){
    let best = null, bv = Infinity;
    for (const t of R.cells){
      if (!atEdge(t)) continue;
      const p = pathTo(R, t), away = Math.min(...river.map(j => cheb(j, t)));
      const v = Math.abs(p.length - RIVER.step) + p.filter(j => S.cells[j].crop).length*1.5 - Math.min(away, 5)*0.6 + jig(t)*0.5 + (R.cost.get(t) - p.length)*0.25;
      if (v < bv){ bv = v; best = p; }
    }
    return best;
  }
  const tip = S.riverTip;
  let path = null;
  if (inRiver.has(tip) && !atEdge(tip)){          // 先端からつづける
    const back = neigh4(tip).find(j => inRiver.has(j));
    path = toEdge(search([tip], back === undefined ? 0 : tip - back));
  }
  if (!path){                                     // 滝になった・堰き止められた → 途中から枝分かれ
    const R = search(river.filter(j => !atEdge(j) || S.cells[j].spring), 0);
    path = toEdge(R);
    if (!path && R.cells.length) path = pathTo(R, R.cells.reduce((a,b) => R.len.get(b) > R.len.get(a) ? b : a));
  }
  if (!path || !path.length) return null;
  const cells = path.slice(0, RIVER.step), last = cells[cells.length-1];
  return {cells, fall:atEdge(last)};
}
function growRiver(plan){
  for (const i of plan.cells){
    const c = S.cells[i];
    if (c.t === 'sapling' && c.crop) S.gold += CROPS[c.crop].seed;          // 川になった畑の種代は戻す
    clearSpot(i);
    S.cells[i] = {t:'water', r:Math.random(), river:1};
  }
  const last = plan.cells[plan.cells.length-1];
  if (plan.fall) S.cells[last].fall = 1;
  S.riverTip = last; S.stats.dug = (S.stats.dug || 0) + plan.cells.length;
  refreshWater();
  for (const i of plan.cells){ const p = wpos(i); burst(p.x, 0.2, p.z, 'leaf', 3, 0x6ac0f0); if (CM[i]) CM[i].userData.pop = 0.35; }
  const p = wpos(last);
  popAt(p.x, 0.9, p.z, plan.fall ? L('滝になった！','A waterfall!') : L('川が '+plan.cells.length+'マス伸びた','River +'+plan.cells.length), 'g');
  toast(plan.fall ? L('川が島の端に届いて滝になった。次のLvでは途中から枝分かれする','The river reached the edge and became a waterfall. The next level branches off') : L('川が '+plan.cells.length+'マス伸びた','The river grew '+plan.cells.length+' tiles'), 'good');
}
// 手で掘っていたころのセーブ：今ある手掘りの流れはそのまま川に。買ってあった水車のぶんは伸ばす
function migrateRiver(){
  if (S.riverV) return;
  S.riverV = 1;
  const all = riverCells();
  S.riverTip = all[all.length-1];
  const lv = S.upg.pump || 0;
  for (let k=0; k<lv && riverCells().length - 1 < 2 + RIVER.step*lv; k++){ const p = planRiver(); if (!p) break; growRiver(p); }
}
const isWet = i => neigh4(i).some(j => waterLive.has(j));
const hasMate = (i, crop) => neigh4(i).some(j => S.cells[j].crop && S.cells[j].crop !== crop);
// 今そのマスにその作物を植えたときの育つ速さ（1が標準）
function growRate(i, crop, se = season(), wet = isWet(i)){
  const C = CROPS[crop]; if (!C) return 0;
  let r = C.s[se] * (wet ? C.wet : C.dry);
  if (crop === 'veg' && hasMate(i, crop)) r *= S.flags.sisters ? 1.9 : 1.45;
  if (crop === 'rice' && S.flags.heirloom) r *= 1.3;
  return r * (S.flags.forest ? 1.3 : 1) * (S.flags.steam ? 0.8 : 1) * (S.drive === 3 ? 0.6 : 1) * (S.rainDay === S.day ? 2 : 1);
}
function growField(i, c, dt){
  if (!c.crop){ c.g = 1; } else c.g += dt / CROPS[c.crop].T * growRate(i, c.crop);
  if (c.g < 1) return;
  S.cells[i] = {t:'tree', hp:P.treeHP, r:c.r, crop:c.crop}; setCellMesh(i); if (CM[i]) CM[i].userData.pop = 0.3;
}
const fieldCount = () => S.cells.filter(c => c.crop).length;
function toolWhy(tool, i){
  const c = S.cells[i];
  if (c.t === 'void') return L('島の外です','Outside the island');
  if (c.t === 'b' || c.t === 'occ') return L('建物がある','A building is here');
  if (c.spring) return L('湧き水は動かせない','The spring cannot be changed');
  if (tool === 'clear'){
    if (c.t === 'water' && c.river) return L('川は動かせない','The river cannot be moved');
    return c.crop || c.t === 'water' || c.t === 'tree' ? '' : L('戻すものがない','Nothing to clear');
  }
  if (c.t === 'water') return L('川には植えられない','Cannot plant in the river');
  if (season() === 3) return L('冬は植えられない。春になったら種をまこう','You can’t plant in winter. Sow when spring comes');
  if (c.crop === tool) return L('もう植えてある','Already planted');
  return S.gold < CROPS[tool].seed ? L('お金が足りない','Not enough gold') : '';
}
function useTool(tool, i){
  if (tool !== 'clear' && !CROPS[tool]) return false;
  const why = toolWhy(tool, i);
  if (why){ toast(why, 'bad'); return false; }
  const was = S.cells[i], p = wpos(i);
  clearSpot(i);
  if (tool === 'clear') S.cells[i] = {t:'grass', r:Math.random()};
  else { S.gold -= CROPS[tool].seed; S.cells[i] = {t:'sapling', crop:tool, g:0, r:Math.random()}; S.stats.planted++; }
  setCellMesh(i); if (CM[i]) CM[i].userData.pop = 0.3;
  if (was.t === 'water') refreshWater();
  paintAccF = 1;
  burst(p.x, 0.15, p.z, 'leaf', 4, 0x8a5a3a); sfx('ui');
  if (CROPS[tool]){ const r = growRate(i, tool); popAt(p.x, 0.7, p.z, N(SEASONS[season()])+' '+Math.round(r*100)+'%', r >= 1 ? 'g' : ''); }
  return true;
}
// 季節の変わり目と救済（毎朝）
function farmDawn(){
  if (!isFarm) return;
  const se = season();
  if (se !== seasonOf(S.day - 1)){
    refreshWater();
    toast(N([['春が来た。種まきの季節、小麦がよく伸びる','Spring: time to sow, and wheat shoots up'],['夏が来た。稲が伸びる。川は先の方が干上がる','Summer: rice thrives, but the far end of the river dries up'],['秋が来た。かぼちゃがよく育つ','Autumn: pumpkins thrive'],['冬が来た。作物は育たない。貯めた分を加工しよう','Winter: nothing grows. Process what you stored']][se]), 'ev');
  } else if (seasonOf(S.day + 1) === 3 && se === 2) toast(L('明日から冬。今日のうちに収穫を貯めておこう','Winter starts tomorrow. Stock up today'), 'ev');
  if (S.gold >= 150 || S.cells.some(c => c.t === 'tree')) return;
  let n = 0;
  for (let i=0;i<W*W && n<5;i++){ const c = S.cells[i]; if (c.t === 'sapling' && c.crop){ S.cells[i] = {t:'tree', hp:P.treeHP, r:c.r, crop:c.crop}; setCellMesh(i); n++; } }
  if (n) toast(L('見かねた長老が、蔵から育った苗を分けてくれた','The elder shared grown seedlings from the granary'), 'good');
}
const SEASON_TILE = [[0x93cc5c,0x87c052],[0x70b84c,0x66ae46],[0xd0b860,0xc4ac58],[0xeaf0f8,0xd8e2ee]].map(a => a.map(x => new THREE.Color(x)));
const SOIL_DRY = new THREE.Color(0xa87850), SOIL_WET = new THREE.Color(0x6a4a3c), SOIL_SNOW = new THREE.Color(0xc8c4c8);
let paintAccF = 1;
function updateFarm(dt){
  if (!isFarm) return;
  const sig = season() + ',' + (S.upg.pump || 0);
  if (sig !== waterSig){ waterSig = sig; refreshWater(); }
  for (const i of waterAll){
    const u = CM[i]?.userData; if (!u?.streaks) continue;
    for (const m of u.streaks) m.position.y = -((elapsed*1.7 + m.userData.phase) % 2.3);
    for (const wh of u.wheels) wh.rotation.x += dt*(0.8 + (S.upg.pump || 0)*0.25);
  }
  paintAccF += dt;
  if (paintAccF < 0.8) return;
  paintAccF = 0;
  const col = new THREE.Color(), se = season(), T = SEASON_TILE[se];
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; if (c.t === 'void') continue;
    if (c.crop){ col.copy(isWet(i) ? SOIL_WET : SOIL_DRY); if (se === 3) col.lerp(SOIL_SNOW, 0.55); }
    else col.copy(T[(cx(i)+cz(i))%2]);
    col.offsetHSL(0, 0, ((i*37)%7-3)*0.006); tileMesh.setColorAt(i, col);
  }
  if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
}
function farmLine(){
  const se = season(), left = SEASON_DAYS - (S.day-1) % SEASON_DAYS, n = Math.max(0, waterAll.length - 1), dry = dryCount(n);
  return '<b style="color:var(--hi);font-weight:normal">'+N(SEASONS[se])+'</b>'+L('（あと'+left+'日）',' ('+left+'d left)')+'・'+L('田畑 ','Fields ')+fieldCount()+'<br>'+
    L('水車 Lv','Waterwheel Lv')+(S.upg.pump || 0)+'/5・<span class="g">'+L('川 ','River ')+n+L('マス','')+'</span>'+(dry ? ' <span class="r">'+L('先の'+dry+'マスが干上がり中',dry+' dried up')+'</span>' : '');
}
function wheelHTML(){
  const u = UPGS.find(u => u.id === 'pump'), lv = S.upg.pump || 0, c = u.cost[lv], max = c === undefined;
  let info = L('川はこれ以上なく伸びきった','The river has grown to its fullest'), ok = false;
  if (!max){
    const p = planRiver(); ok = !!p && S.gold >= c;
    info = p ? (p.fall ? L('上げると川が '+p.cells.length+'マス伸びて、島の端で滝になる','Upgrading adds '+p.cells.length+' tiles, ending in a waterfall') : L('上げると川が '+p.cells.length+'マス伸びる','Upgrading adds '+p.cells.length+' tiles'))
      : '<span class="r">'+L('流せる場所がない（建物を動かすか、島を広げる）','No room to flow (move a building or expand the island)')+'</span>';
  }
  return '<button class="opt hot wheel" data-act="upg:pump" '+(ok ? '' : 'disabled')+'><div class="n">'+L('川を伸ばす：揚水水車 Lv','Extend the river: Waterwheel Lv')+lv+(max ? ' MAX' : ' → '+(lv+1))+'</div>'+(max ? '' : '<div class="c">'+fmt(c)+'G</div>')+'<div class="d">'+info+'</div></button>';
}
function renderRiver(i){
  const c = S.cells[i];
  setHTML(bpanelEl, '<div class="ph"><span>'+(c.spring ? L('湧き水と揚水水車','Spring & waterwheel') : L('川','River'))+'</span><button class="btn x" data-act="unselect">×</button></div>' +
    '<div class="kv">'+farmLine()+'<br>'+(waterLive.has(i) ? '<span class="g">'+L('流れている。となりのマスは稲向き','Flowing. Tiles beside it suit rice')+'</span>' : '<span class="r">'+L('干上がっている','Dried up')+'</span>')+
    '<br>'+L('夏は先の1/4が干上がる','In summer the far quarter dries up')+'</div><div class="seeds">'+wheelHTML()+'</div>' +
    (!c.spring && !c.river ? '<div class="btns"><button class="btn" data-act="clearPlot">'+L('埋め戻す','Fill in')+'</button></div>' : ''), 'b');
}
function toolInfo(i){
  const tool = mode.tool, why = toolWhy(tool, i), Lst = why ? ['<span class="r">× '+why+'</span>'] : [];
  let name, cost = '';
  if (tool === 'clear') name = L('更地に戻す','Clear');
  else {
    name = N(CROPS[tool].n); cost = CROPS[tool].seed+'G';
    const wet = isWet(i);
    Lst.push((wet ? L('水ぎわ','Beside water') : L('乾いた土','Dry soil')) + (tool === 'veg' && hasMate(i, tool) ? L('・相棒あり',' · companion') : ''));
    Lst.push(SEASONS.map((n, se) => { const r = growRate(i, tool, se, wet); return '<span class="'+(r >= 1 ? 'g' : r < 0.45 ? 'r' : '')+'">'+(se === season() ? '▶' : '')+N(n)+' '+Math.round(r*100)+'%</span>'; }).join(' '));
  }
  return '<b>'+name+'</b>　'+cost+'<div class="kv">'+Lst.join('<br>')+'</div>';
}

/* ---- 見た目：作物と川 */
function cropGeo(crop, v, ripe){
  const key = crop + v + ripe; if (meadowCache[key]) return meadowCache[key];
  const list = [];
  if (crop === 'wheat') for (let k=0;k<12;k++){
    const x = -0.3 + (k%4)*0.2 + (hash(k,v)-0.5)*0.07, z = -0.24 + Math.floor(k/4)*0.24, ht = 0.34 + hash(v,k)*0.12;
    list.push(part(G.cone4, ripe ? 0xd8a830 : 0x88c048, 0.06,ht,0.06, x,ht/2,z));
    if (ripe) list.push(part(G.ico, (k+v)%2 ? 0xf8d860 : 0xeec040, 0.07,0.12,0.07, x,ht,z));
  } else if (crop === 'rice') for (let k=0;k<9;k++){
    const x = -0.28 + (k%3)*0.28, z = -0.28 + Math.floor(k/3)*0.28, ht = 0.3 + hash(k,v)*0.1;
    list.push(part(G.cone6, ripe ? 0xa8c050 : 0x48b858, 0.1,ht,0.1, x,ht/2,z));
    if (ripe){ const e = part(G.ico, 0xf8f0b0, 0.14,0.06,0.07, x+0.07,ht*0.9,z); e.rotation.z = -0.5; list.push(e); }
  } else for (let k=0;k<4;k++){
    const x = (k%2 ? 0.2 : -0.2) + (hash(k,v)-0.5)*0.1, z = k < 2 ? -0.2 : 0.2;
    list.push(part(G.ico, 0x3a9a48, 0.24,0.07,0.2, x-0.05,0.08,z-0.05));
    if (ripe){ list.push(part(G.ico1, (k+v)%3 ? 0xf07a28 : 0xf8a840, 0.17,0.14,0.17, x+0.04,0.16,z+0.04)); list.push(part(G.box, 0x4a6a2a, 0.04,0.08,0.04, x+0.04,0.31,z+0.04)); }
    else list.push(part(G.cone4, 0x58b850, 0.09,0.18,0.09, x,0.14,z));
  }
  return meadowCache[key] = mergeParts(list);
}
function makeCrop(c){
  const g = new THREE.Group(), v = Math.floor(c.r*4);
  let m;
  if (c.crop) m = new THREE.Mesh(cropGeo(c.crop, v, c.t === 'tree'), meadowMat);
  else m = new THREE.Mesh(meadowGeo(v, !!c.gold), meadowMat);
  m.castShadow = true; m.receiveShadow = true; g.add(m);
  g.userData.base = 0.95;
  return g;
}
function makeWater(i, c){
  const g = new THREE.Group(), on = waterLive.has(i), WET = 0x3aa8e8, BED = 0x8a6a50, col = on ? WET : BED, bank = on ? 0x5a4638 : 0x6a5442;
  const u = g.userData; u.streaks = []; u.wheels = [];
  g.add(part(G.box, bank, 0.6,0.03,0.6, 0,0.015,0)); g.add(part(G.box, col, 0.44,0.03,0.44, 0,0.03,0));
  if (!on) for (const [x,z] of [[-.1,.06],[.09,-.1],[.12,.12]]) g.add(part(G.dod, 0xa89c90, 0.06,0.04,0.06, x,0.05,z));          // 干上がった川底
  const nw = neigh4(i).filter(j => S.cells[j].t === 'water');
  for (const j of nw){
    const dx = cx(j)-cx(i), dz = cz(j)-cz(i), lit = on && waterLive.has(j) ? WET : BED;
    g.add(part(G.box, bank, dx ? 0.3 : 0.6,0.028,dz ? 0.3 : 0.6, dx*0.36,0.014,dz*0.36));
    g.add(part(G.box, lit, dx ? 0.3 : 0.44,0.03,dz ? 0.3 : 0.44, dx*0.36,0.029,dz*0.36));
    if (on && (dx + dz) > 0) g.add(part(G.box, 0xbfe8ff, dx ? 0.18 : 0.04,0.01,dz ? 0.18 : 0.04, dx*0.3,0.05,dz*0.3));
  }
  if (c.fall && atEdge(i)){          // 滝：流れてきた向きの先へ落ちる
    const off = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dz]) => { const x = cx(i)+dx, z = cz(i)+dz; return x<0 || z<0 || x>=W || z>=W || S.cells[z*W+x].t === 'void'; });
    const from = nw[0], [dx, dz] = off.find(([dx,dz]) => from !== undefined && cx(from) === cx(i)-dx && cz(from) === cz(i)-dz) || off[0];
    g.add(part(G.box, bank, dx ? 0.34 : 0.6,0.028,dz ? 0.34 : 0.6, dx*0.37,0.014,dz*0.37));
    g.add(part(G.box, col, dx ? 0.36 : 0.44,0.03,dz ? 0.36 : 0.44, dx*0.38,0.031,dz*0.38));
    if (on){
      const H = 2.5, fp = (hex, along, t, y, side, h, out) => part(G.box, hex, dx ? t : along, h, dz ? t : along, dx*out + (dz ? side : 0), y, dz*out + (dx ? side : 0));
      g.add(fp(0x4ab4f0, 0.44, 0.08, 0.04-H/2, 0, H, 0.57));
      for (let k=0;k<9;k++){
        const m = fp(k%3 ? 0xd8f4ff : 0x9adcff, 0.06, 0.03, 0, -0.16 + (k%4)*0.105, 0.34, 0.625);
        m.userData.phase = k*0.29; m.castShadow = false; m.position.y = -(k*0.29 % (H-0.2)); g.add(m); u.streaks.push(m);
      }
      for (let k=0;k<5;k++){ const s0 = (k-2)*0.15; g.add(part(G.ico1, k%2 ? 0xffffff : 0xd8f4ff, 0.2,0.14,0.2, dx*(0.66 + k%2*0.1) + (dz ? s0 : 0), -H + k%2*0.07, dz*(0.66 + k%2*0.1) + (dx ? s0 : 0))); }
    }
  }
  if (c.spring){
    for (let k=0;k<8;k++){ const a = k/8*Math.PI*2; g.add(part(G.dod, 0x9a9aa4, 0.14,0.12,0.14, Math.cos(a)*0.36,0.06,Math.sin(a)*0.36)); }
    g.add(part(G.cone6, 0x9adcff, 0.12,0.4,0.12, 0,0.22,0)); g.add(part(G.ico1, 0xe8f8ff, 0.1,0.08,0.1, 0,0.43,0));
    const lv = S.upg.pump || 0;
    if (lv){          // 揚水水車：Lvが上がるほど大きく
      const r = 0.22 + lv*0.06, wh = new THREE.Group(), hub = r + 0.03, WOOD = lv >= 5 ? 0xe8b840 : 0x8a5a2e;
      wh.position.set(-0.42, hub, -0.08);
      const rim = part(G.torus, WOOD, r, r, r, 0,0,0); rim.rotation.y = Math.PI/2; wh.add(rim);
      for (let k=0;k<4+lv;k++){
        const a = k/(4+lv)*Math.PI*2, sp = part(G.box, 0xb88a54, 0.05,r,0.035, 0, Math.cos(a)*r/2, Math.sin(a)*r/2); sp.rotation.x = a; wh.add(sp);
        const pad = part(G.box, 0xd8b070, 0.14,0.04,0.11, 0, Math.cos(a)*r, Math.sin(a)*r); pad.rotation.x = a; wh.add(pad);
      }
      g.add(wh); u.wheels.push(wh);
      for (const x of [-0.52,-0.32]) g.add(part(G.box, 0x5a3a20, 0.04,hub+0.05,0.06, x,(hub+0.05)/2,-0.08));
    }
  }
  return g;
}

/* ---- クリック（手作業） */
function clickCell(i){
  if (S.cells[i].t === 'occ') i = S.cells[i].of;
  const c = S.cells[i], p = wpos(i);
  if (c.t === 'tree'){
    const n = (1 + S.upg.axe) * (c.gold ? 3 : 1);
    const it = c.crop || ISL.tree, wood = it === 'log';
    S.items[it] += n; S.seen[it] = true; c.hp--; S.stats.clicks++; if (c.crop) S.stats.made[it] += n;
    CM[i].userData.hit = 0.2; shake(0.035); hitStop = 0.045;
    burst(p.x, 0.6, p.z, wood ? 'log' : 'leaf', 1 + Math.min(3, n), wood ? undefined : ITEMS[it].c); popAt(p.x, 1.1, p.z, '+'+n+' '+N(ITEMS[it].n)); sfx('chop');
    if (reserved[i] && c.hp <= 0) delete reserved[i];
    fellCheck(i); return true;
  }
  if (c.t === 'rock'){
    const n = (1 + S.upg.axe) * (S.flags.sacred ? 2 : 1);
    const R = ISL.rock; S.items[R] += n; S.seen[R] = true; S.stats.made[R] += n; c.hp--; S.stats.clicks++;
    CM[i].userData.hit = 0.2; shake(0.04); hitStop = 0.05;
    burst(p.x, 0.4, p.z, 'stone', 3, ITEMS[R].c); popAt(p.x, 0.9, p.z, '+'+n+' '+N(ITEMS[R].n)); sfx('rock');
    if (reserved[i] && c.hp <= 0) delete reserved[i];
    rockCheck(i); return true;
  }
  if (c.t === 'water'){ select(i); sfx('ui'); return true; }
  if (isFarm && (c.t === 'grass' || (c.t === 'sapling' && c.crop))){ select(i); sfx('ui'); return true; }          // 空き地か畑をタップ → 種えらび
  if (c.t === 'sapling'){ popAt(p.x, 0.7, p.z, (ISL.tree === 'log' ? L('まだ若木…','Still a sapling…') : L('まだ芽…','Still sprouting…'))); return true; }
  if (c.t === 'b'){ if (c.b.type === 'warehouse') openPanel('market'); else { collect(i); select(i); } sfx('ui'); return true; }
  return false;
}

/* ---- 1日の区切り */
// 救済：緑がほぼ尽きたら翌朝に少し生える。お金も尽きていれば、すぐ使える大きさで
function greenRescue(){
  if (S.cells.filter(c => c.t === 'tree' || c.t === 'sapling').length >= 2) return;
  if (S.soil) S.soil = {};                        // 泥地もいったん流される
  const poor = S.gold < 300, g = S.cells.map((c,i) => c.t === 'grass' && i !== WH ? i : -1).filter(i=>i>=0).sort(()=>Math.random()-.5).slice(0, poor ? 6 : 3);
  for (const i of g){ S.cells[i] = {...(poor ? {t:'tree', hp:P.treeHP} : {t:'sapling', g:0}), r:Math.random(), ...(isFarm && {crop:'wheat'})}; setCellMesh(i); if (CM[i]) CM[i].userData.pop = 0.4; }
  if (g.length) toast(L('風に乗って種が届き、'+ISL.treeN[0]+'が少し生えてきた','The wind carried seeds in: some '+ISL.treeN[1].toLowerCase()+' is growing'), 'good');
}
// 救済：お金がなく、輪の草も尽きたままなら、長老が鐘を草地へ運んでくれる
function herdRescue(){
  if (!isDairy || !S.herd || S.gold >= 300 || pastureAt(S.bell)) return;
  let best = -1, bn = 0;
  for (let i=0;i<W*W;i++) if (S.cells[i].t !== 'void'){ const n = pastureAt(i); if (n > bn){ bn = n; best = i; } }
  if (best < 0) return;
  setBell(best);
  toast(L('見かねた長老が、鐘を草地へ運んでくれた','The elder took pity and carried the bell to fresh pasture'), 'good');
}
// 救済：お金が尽きて修理もできないなら、住民たちが朝に1棟だけ直してくれる
function repairRescue(){
  if (S.gold >= 100) return;
  const i = allB().find(j => { const b = S.cells[j].b; return b.broken && S.gold < Math.round(BUILD[b.type].cost.g*0.4); });
  if (i === undefined) return;
  S.cells[i].b.broken = false; if (CM[i]) CM[i].rotation.z = 0;
  const nm = BUILD[S.cells[i].b.type].n;
  toast(L('見かねた住民たちが、'+nm[0]+'を直してくれた','The residents pitched in and fixed the '+nm[1]), 'good');
}
function onDawn(){
  S.yday = {}; for (const k of ITEM_KEYS) S.yday[k] = S.stats.made[k] - (S.madePrev?.[k] || 0);
  S.madePrev = {...S.stats.made};
  S.day++;
  if (S.nightUsed){ S.stats.nightShifts++; S.nsStreak++; } else S.nsStreak = 0;
  S.nightUsed = false;
  const wages = workerCount() * (P.wage + S.flags.wageBonus) + allB().reduce((a,i)=>{ const b = S.cells[i].b; return a + (BUILD[b.type].upkeep || 0)*b.lvl; }, 0);
  if (wages > 0){
    if (S.gold >= wages){ S.gold -= wages; toast(L('Day '+S.day+' 朝：給料・維持費 -'+fmt(wages)+'G', 'Day '+S.day+': wages & upkeep -'+fmt(wages)+'G')); }
    else { S.gold = 0; addMood(-15); toast(L('給料が払えなかった…幸福 -15','Could not pay wages… happiness -15'),'bad'); }
  }
  for (const Ln of S.loans.slice()) if (S.day >= Ln.due){
    S.gold -= Ln.repay; S.loans.splice(S.loans.indexOf(Ln),1);
    toast(L('借金を返済 -','Loan repaid -')+fmt(Ln.repay)+'G', S.gold<0?'bad':'');
    if (S.gold < 0){ addMood(-10); story('返済で赤字に陥った','Fell into the red repaying a loan'); }
  }
  for (const C of S.contracts.slice()) if (S.day >= C.due){
    S.contracts.splice(S.contracts.indexOf(C),1);
    const back = Math.round(C.got * ITEMS[C.it].p);
    S.gold += back - C.penalty; addMood(-5); S.stats.contractsFail++;
    toast(L('契約失敗… 違約金 -','Order failed… penalty -')+fmt(C.penalty)+'G','bad');
    eventQueue.push({result:true, img:'contract_fail', title:L('大口注文、間に合わず…','The big order fell short…'), text:L(N(ITEMS[C.it].n)+' '+C.got+'/'+C.need+'個で期限が来てしまった。<b>違約金 -'+fmt(C.penalty)+'G</b>（納めた分の代金 +'+fmt(back)+'G）・幸福 -5', 'Only '+C.got+'/'+C.need+' '+N(ITEMS[C.it].n)+' by the deadline. <b>Penalty -'+fmt(C.penalty)+'G</b> (paid +'+fmt(back)+'G for what arrived), happiness -5')});
    story(ITEMS[C.it].n[0]+'の大口注文を守れなかった', 'Failed a big order of '+ITEMS[C.it].n[1]);
  }
  if (S.mood < 20 && workerCount() > 0 && Math.random() < 0.6){
    const w = workers[Math.floor(Math.random()*workers.length)]; removeWorker(w.bi); S.stats.quits++;
    eventQueue.push({result:true, img:'leave', title:L('不満が爆発…','Fed up…'), text:L('不満をつのらせた住民が1人、気球に乗って島を去った。幸福を上げないと、また誰かが出ていくかもしれない。','An unhappy resident left on a balloon. Raise happiness, or others may follow.')});
  }
  // 聖地を守ると、岩が少しずつ戻ってくる
  if (S.flags.sacred && S.day % 2 === 0 && S.cells.filter(c=>c.t==='rock').length < 10){
    const g = S.cells.map((c,i)=>c.t==='grass' && !allB().some(j=>cheb(i,j)<=1) ? i : -1).filter(i=>i>=0);
    if (g.length){ const i = g[Math.floor(Math.random()*g.length)]; S.cells[i] = {t:'rock', hp:P.rockHP, r:Math.random()}; setCellMesh(i); CM[i].userData.pop = 0.4; }
  }
  // 鉄がいる建物をまだ建てていないのに鉄鉱石の出どころが尽きたら、岩がわずかに戻ってくる
  if (ISL.rock && !S.cells.some(c=>c.t==='rock') && !canDig() && ironWanted()){
    const g = S.cells.map((c,i)=>c.t==='grass' && i !== WH && !allB().some(j=>cheb(i,j)<=1) ? i : -1).filter(i=>i>=0).sort(()=>Math.random()-.5).slice(0, 2);
    for (const i of g){ S.cells[i] = {t:'rock', hp:P.rockHP, r:Math.random()}; setCellMesh(i); CM[i].userData.pop = 0.4; }
    if (g.length) toast(ISL.rock === 'salt' ? L('島のどこかに、新しい岩塩が顔を出した','Some rock salt has surfaced on the island') : L('島のどこかに、新しい岩が顔を出した','A few new rocks have surfaced on the island'), 'good');
  }
  if (S.meteorNight === S.day - 1){
    addMood(12);
    const gift = Math.random() < 0.5 ? Math.round(rnd(200, 600)) : 0;
    if (gift){ S.gold += gift; eventQueue.push({result:true, img:'meteor_wish', title:L('願いがかなった！','A wish came true!'), text:L('朝、広場に光る「流れ星のかけら」が落ちていた。<b>+'+fmt(gift)+'G・幸福 +12</b>','A glowing star shard lay in the square at dawn. <b>+'+fmt(gift)+'G, happiness +12</b>')}); }
    else eventQueue.push({result:true, img:'meteor', title:L('星降る夜のあとで','After the starry night'), text:L('願いはひみつ。でも、みんな晴れやかな顔をしている。<b>幸福 +12</b>','The wishes are secret, but everyone looks happy. <b>Happiness +12</b>')});
  }
  if (S.drive){
    S.stats.driveDays = (S.stats.driveDays || 0) + S.drive;
    const c = allB().filter(i => BUILD[S.cells[i].b.type].ind && !S.cells[i].b.broken && S.cells[i].b.workers);
    if (S.drive === 3 && c.length && Math.random() < 0.15){
      const i = c[Math.floor(Math.random()*c.length)], nm = BUILD[S.cells[i].b.type].n;
      S.cells[i].b.broken = true; if (CM[i]) CM[i].rotation.z = 0.12;
      eventQueue.push({result:true, img:'storm_lose', title:L('働かせすぎて故障！','Worked to breaking point!'), text:L('休みなく回し続けた'+nm[0]+'が壊れた。修理するまで止まる。','The '+nm[1]+' broke down from overwork. It stops until repaired.')});
      story(nm[0]+'を働かせすぎて壊した', 'Overworked the '+nm[1]+' until it broke');
    }
  }
  repairRescue();
  greenRescue();
  farmDawn();
  herdRescue();
  if (S.festStill && S.festStill < S.day) showFestStill();          // 見そびれても朝には出す
  const NO = S.nightOrder;
  if (NO && S.day > NO.day){
    S.nightShift = NO.prev; S.nightOrder = null;
    let n = 0, v = 0; if (NO.snap) for (const k of outItems()){ const d = S.stats.made[k] - (NO.snap[k] || 0); n += d; v += d * ITEMS[k].p; }
    const bonus = Math.round(v * 0.45); S.gold += bonus; S.stats.earned += bonus;
    eventQueue.push({result:true, img:'nightorder_ok', title:L('特急便、出発！','The dawn express departs!'), text: n ? L('夜のうちに作った加工品 '+n+'個を積みこんだ。<b>ボーナス +'+fmt(bonus)+'G</b>（品物は市場に残る）', n+' crafted goods made overnight were loaded. <b>Bonus +'+fmt(bonus)+'G</b> (you keep the goods)') : L('残念、夜のあいだに加工品はできなかった……。','Sadly, nothing was crafted overnight…')});
  }
  if (S.tut < 0) queueEvent();
  backup('dawn');
}

/* ---- 毎フレームの経済 */
let regrowAcc = 0, moodAcc = 0, wearAcc = 0, homeAcc = 0;
function sim(dt){
  S.time += dt;
  if (S.time >= P.dayLen){ S.time -= P.dayLen; onDawn(); }
  if (S.nightShift && isNight() && workerCount()) S.nightUsed = true;
  wearAcc += dt; if (wearAcc >= 2){ wearAcc = 0; decayRoutes(); wearSocial(); }
  for (const k of ITEM_KEYS) S.sat[k] += (1 - S.sat[k]) * (S.sat[k] < 1 ? P.satRecover : 0.004) * dt;
  regrowAcc += dt;
  const regMul = (S.drive === 3 ? 0.5 : 1) * (S.flags.skycow ? 1.5 : 1) * (S.flags.steam ? 0.5 : 1) * (S.flags.forest ? 2 : 1) * (S.day < S.flags.protectUntil ? 3 : 1) * (S.rainDay === S.day ? 3 : 1);
  for (let i=0;i<W*W;i++){
    const c = S.cells[i];
    if (c.t === 'sapling'){
      if (isFarm){ growField(i, c, dt); continue; }
      if (isDairy && S.herd && inRing(i)) continue;   // 輪の中の芽は牛に踏まれて育たない
      c.g += dt / ISL.sapT * (S.flags.forest ? 1.5 : 1) * (c.clover ? 1.5 : 1); if (c.g >= 1){ S.cells[i] = {t:'tree', hp:P.treeHP, r:c.r, clover:c.clover}; setCellMesh(i); CM[i].userData.pop = 0.3; } }
  }
  if (regrowAcc >= P.regrowTick){
    regrowAcc -= P.regrowTick;
    for (let i=0;i<W*W;i++){
      if (isFarm || S.cells[i].t !== 'grass' || i === WH) continue;
      if (isDairy && (S.soil?.[i] || (S.herd && inRing(i)))) continue;
      const n = neigh8(i).filter(j=>S.cells[j].t==='tree').length * ISL.spread + ISL.seedP;
      if (n && Math.random() < P.regrowP * n * regMul) sprout(i);
    }
  }
  // 施設
  const ops = {}; for (const w of workers) if (!w.sleep && w.job === 'proc' && (w.tasks[0]?.k === 'op' || w.tasks[0]?.shift)) ops[w.bi] = (ops[w.bi] || 0) + 1;
  homeAcc += dt; if (homeAcc >= 2){ homeAcc = 0; assignHomes(); }
  if (S.nightOrder && !S.nightOrder.snap && S.nightOrder.day === S.day && isNight()) S.nightOrder.snap = {...S.stats.made};
  const canWork = workTime() && !festActive();
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; if (c.t !== 'b') continue; const b = c.b, d = BUILD[b.type]; b._working = false;
    if (b.build > 0){ b.build = Math.max(0, b.build - dt); if (!b.build){ if (CM[i]) CM[i].userData.pop = 0.3; sfx('hire'); } continue; }
    // 満杯が長く続いたときだけ注意を出す（運搬が一時的に追いつかないだけなら出さない）
    if (staffed(d)) b._fullT = stTotal(b) >= stCap(b) ? (b._fullT || 0) + dt : 0;
    if (d.gen){
      if (b.broken || !ops[i] || !canWork || stTotal(b) >= stCap(b)) continue;
      b._working = true; b.prog += dt * speedMult(i) * (1 + 0.5*(ops[i]-1));
      if (b.prog >= d.time){ b.prog -= d.time; stAdd(b, d.gen, 1); S.stats.made[d.gen]++; S.seen[d.gen] = true; S.stats.recycled = (S.stats.recycled || 0) + 1; if (CM[i]) CM[i].userData.hit = 0.12; }
    } else if (d.herd){
      if (b.broken || !ops[i] || !canWork || !S.herd) continue;
      const cow = S.herd.find(w => w.wait === i && isFull(w));
      if (!cow || stTotal(b) >= bufCap(b)){ b.prog = 0; continue; }
      b._working = true; b.prog += dt * speedMult(i) * (1 + 0.5*(ops[i]-1));
      if (b.prog >= d.time){
        b.prog = 0; const n = milkAmount(cow); emptyCow(cow, n);
        stAdd(b, 'milk', n); S.stats.made.milk += n; S.seen.milk = true;
        if (CM[i]) CM[i].userData.hit = 0.12;
      }
    } else if (d.in){
      if (b.broken || !ops[i] || !canWork) continue;
      if (b.inb >= 1 && stTotal(b) < bufCap(b)){
        b._working = true; b.prog += dt * speedMult(i) * (1 + 0.5*(ops[i]-1));
        if (b.prog >= d.time){ b.prog -= d.time; b.inb--; stAdd(b, d.out, 1); S.stats.made[d.out]++; S.seen[d.out] = true; if (CM[i]) CM[i].userData.hit = 0.12; }
      }
    } else if (d.plant){
      b.prog += dt * Math.pow(1.4, b.lvl-1) * (S.flags.forest?1.5:1);
      if (b.prog >= 14){
        b.prog = 0;
        const cand = []; for (let j=0;j<W*W;j++) if (S.cells[j].t === 'grass' && j !== WH && cheb(i,j) <= 2) cand.push(j);
        if (cand.length){ sprout(cand[Math.floor(Math.random()*cand.length)]); S.stats.planted++; }
      }
    } else if (d.job) b._working = b.workers > 0 && canWork;
    else if (d.fun || d.bath) b._working = true;
  }
  for (const w of workers) updateWorker(w, dt);
  if (isDairy && S.herd) herdStep(dt);
  // 大口注文への納品（相場の影響を受けない）
  for (const C of S.contracts.slice()){
    const n = Math.min(Math.floor(S.items[C.it]), C.need - C.got);
    if (n > 0){ S.items[C.it] -= n; C.got += n; }
    if (C.got >= C.need){
      S.contracts.splice(S.contracts.indexOf(C),1); S.gold += C.reward; S.stats.earned += C.reward; S.stats.contractsDone++;
      popAt(wpos(WH).x, 1.4, wpos(WH).z, '+'+fmt(C.reward)+'G','g'); coinBurst(10); sfx('fanfare');
      story(ITEMS[C.it].n[0]+C.need+'個の大口注文をやり遂げた', 'Delivered a big order of '+C.need+' '+ITEMS[C.it].n[1]);
      eventQueue.push({result:true, img:'contract_ok', title:L('大口注文、達成！','Big order complete!'), text:L(N(ITEMS[C.it].n)+' '+C.need+'個を納めきった。<b>'+fmt(C.reward)+'G</b> が支払われた。', 'All '+C.need+' '+N(ITEMS[C.it].n)+' delivered. You were paid <b>'+fmt(C.reward)+'G</b>.')});
    }
  }
  // 交易気球の行き来（定期便があれば、来るたびに自動で売る）
  trade.t -= dt;
  if (trade.t <= 0){
    if (trade.state === 'away'){ trade.state = 'arrive'; trade.t = 4; }
    else if (trade.state === 'arrive'){ trade.state = 'docked'; trade.t = 8; onBalloonDock(); }
    else if (trade.state === 'docked'){ trade.state = 'leave'; trade.t = 4; }
    else { trade.state = 'away'; trade.t = P.balloonEvery; }
  }
  if (S.airport) tourCheck();
  moodAcc += dt;
  if (moodAcc >= 0.5){
    const tgt = moodTarget(), d = tgt - S.mood; S.mood += Math.sign(d) * Math.min(Math.abs(d), 0.12*moodAcc);
    S.stats.moodSum += S.mood * moodAcc; S.stats.moodN += moodAcc; moodAcc = 0;
  }
  if (S.tut >= 0) tutCheck();
}
function onBalloonDock(){
  if (!S.upg.route) return;
  let earn = 0;
  for (const k of ITEM_KEYS) if (S.auto[k] && S.items[k] >= 1 && !S.contracts.some(c=>c.it===k)) earn += sell(k, S.items[k], true);
  if (earn){ popAt(wpos(WH).x, 1.6, wpos(WH).z + 1, '+'+fmt(earn)+'G', 'g'); coinBurst(6); sfx('coin'); }
}
function plannedCells(){
  if (!mode || mode.kind === 'bell' || mode.kind === 'tool') return [];
  const at = TOUCH ? pending : hoverCell; if (at < 0) return [];
  const sz = mode.kind === 'build' ? BUILD[mode.type].size || 1 : bSize(mode.from);
  return cx(at) + sz <= W && cz(at) + sz <= W ? footCells(at, sz) : [];
}
function sprout(i){ if (plannedCells().includes(i) || (isDairy && isMud(i))) return; if (S.soil) delete S.soil[i]; S.cells[i] = {t:'sapling', g:0, r:Math.random(), ...(isFarm && {crop:'wheat'})}; setCellMesh(i); }

/* =========================================================
   毎朝の相談ごと（正解のないジレンマ）
   ========================================================= */
let eventQueue = []; const queuedIds = {};
function estPerDay(it){
  let r = 0; for (const i of allB()){ const b = S.cells[i].b, d = BUILD[b.type]; if (d.out === it && b.workers) r += P.dayLen*P.dayFrac / d.time * speedMult(i); }
  if (it === ISL.tree) r = allB(ISL.chop).reduce((a,i)=>a + S.cells[i].b.workers*16, 0);
  const y = S.yday?.[it];          // 前日の実績があればそれを使う（理論値は材料不足を考えないので甘い）
  return y > 0 ? Math.min(y, r || y) : r * 0.5;
}
const EVENTS = [
  {id:'vein', fixed:3, isl:'sky', make:()=>({img:'vein', title:L('岩山に鉄の鉱脈！','An iron vein in the rocks!'), text:L('調査隊が島の地下に大きな鉄の鉱脈を見つけた。一方、長老は「岩山は島の守り神じゃ」と首を振る。','Surveyors found a big iron vein under the island. But the elder shakes his head: "The rocks protect our island."'), opts:[
    {l:L('坑道を掘る','Open a mine shaft'), d:L('採掘場が地下の鉄鉱石を掘るようになる（量は多いが無限ではない）。島の側面に坑道が見える。幸福 -5','Mines dig iron ore underground (plenty, but not endless). Tunnels show in the island’s side. Happiness -5'), f:()=>{
      S.flags.mine = true; addMood(-5); ugDug = -1; story('長老を説得し、坑道を掘ると決めた','Convinced the elder and opened a shaft');
      return {img:'mine', title:L('坑道を掘る！','Into the mine!'), text:L('つるはしの音が島に響きはじめた。島の側面の断面に、坑道と鉱夫たちが見えるようになる。','Pickaxes ring across the island. The cutaway in the island’s side now shows tunnels and miners.')}; }},
    {l:L('聖地として守る','Keep it sacred'), d:L('地下は掘らない。そのかわり幸福 +8（ずっと）、岩をクリックした時の鉄鉱石 ×2、岩が少しずつ戻ってくる','No digging. Instead: happiness +8 forever, double ore from clicking rocks, and rocks slowly return.'), f:()=>{
      S.flags.sacred = true; story('岩山を聖地として守ると誓った','Vowed to keep the rocks sacred');
      return {img:'sacred', title:L('岩山は島の守り神','The rocks are sacred'), text:L('しめ縄を張り、みんなで手を合わせた。島は静かな誇りに包まれている。','A sacred rope was tied and everyone prayed. The island is filled with quiet pride.')}; }},
  ]})},
  {id:'policy', fixed:5, make:()=> isFarm ? ({img:'f_policy', title:L('村の進む道','The village’s path'), text:L('田畑が広がり、住民集会が開かれた。これからのやり方を決めよう。この決定はずっと続く。','The fields have spread and a town meeting is held. Choose how it will grow. This lasts forever.'), opts:[
    {l:L('蒸気の脱穀機','Steam threshers'), d:L('加工の速度 +35%。ただし煙で幸福 -8、作物の育ち -20%','Crafting +35%. Smoke: happiness -8, crop growth -20%'), f:()=>{ S.flags.steam = true; story('蒸気の脱穀機を入れた','Brought in steam threshers'); return {img:'steam', title:L('機械の農村','A machine village'), text:L('もくもくと煙を上げて、脱穀機がうなる。','Threshers roar under billowing smoke.')}; }},
    {l:L('手仕事の味','Handmade flavors'), d:L('焼き菓子・地酒の売値 +30%、幸福 +4','Cakes & rice wine sell +30%, happiness +4'), f:()=>{ S.flags.craft = true; story('手仕事の味を守ると決めた','Chose handmade flavors'); return {img:'f_craft', title:L('手仕事の味','Handmade flavors'), text:L('粉をひき、麹を育てる。この村の味は本土で評判になった。','Grinding flour, tending koji. The village’s flavors became the talk of the mainland.')}; }},
    {l:L('土を育てる','Tend the soil'), d:L('作物の育ち +30%、田畑による幸福 ×1.5、米・かぼちゃ・保存食の売値 +20%。加工の速度 -10%','Crop growth +30%, field happiness x1.5, rice, pumpkins & preserves sell +20%. Crafting -10%'), f:()=>{ S.flags.forest = true; story('土を育てる道を選んだ','Chose to tend the soil'); return {img:'f_field', title:L('黒い土','Rich dark soil'), text:L('落ち葉をすき込み、畑はふかふかになった。','Leaves are ploughed in and the soil turns soft and dark.')}; }},
  ]}) : ISLAND === 'dairy' ? ({img:'d_policy', title:L('牧場の進む道','The ranch’s path'), text:L('牧場が大きくなり、住民集会が開かれた。これからのやり方を決めよう。この決定はずっと続く。','The ranch has grown and a town meeting is held. Choose how it will grow. This lasts forever.'), opts:[
    {l:L('搾乳機と蒸気の工場','Milking machines & steam'), d:L('加工の速度 +35%。ただし煙で幸福 -8、牧草の再生が半分に','Crafting +35%. Smoke: happiness -8, grass regrowth halved'), f:()=>{ S.flags.steam = true; story('搾乳機と蒸気の工場を入れた','Brought in milking machines'); return {img:'steam', title:L('機械の牧場','A machine ranch'), text:L('煙突から煙が上がり、搾乳機がリズムよく動きだした。','Chimneys smoke and the milking machines start their rhythm.')}; }},
    {l:L('職人チーズの誇り','Pride in craft cheese'), d:L('チーズ・熟成チーズの売値 +30%、幸福 +4','Cheese & aged cheese sell +30%, happiness +4'), f:()=>{ S.flags.craft = true; story('職人チーズの道を選んだ','Chose the way of craft cheese'); return {img:'d_craft', title:L('職人の誇り','Craft pride'), text:L('ひと玉ずつ、ていねいに。この島のチーズは本土で高く売れるようになった。','Wheel by wheel, with care. The island’s cheese now fetches a high price.')}; }},
    {l:L('のびのび放牧','Free-range grazing'), d:L('牧草の再生・種まき ×2、牧草による幸福 ×1.5、牛乳・バターの売値 +20%。加工の速度 -10%','Grass regrowth & sowing x2, grass happiness x1.5, milk & butter sell +20%. Crafting -10%'), f:()=>{ S.flags.forest = true; story('のびのび放牧の道を選んだ','Chose free-range grazing'); return {img:'d_meadow', title:L('のびのび放牧','Free range'), text:L('牛たちは好きな場所で草をはみ、昼寝をする。島じゅうが花の香りに包まれた。','The cows graze and nap wherever they like. The whole island smells of flowers.')}; }},
  ]}) : ({img:'policy', title:L('島の進む道','The island’s path'), text:L('島が大きくなり、住民集会が開かれた。これからのやり方を決めよう。この決定はずっと続く。','The island has grown and a town meeting is held. Choose how it will grow. This lasts forever.'), opts:[
    {l:L('蒸気機関を入れる','Bring in steam engines'), d:L('加工の速度 +35%。ただし煙で幸福 -8、木の自然再生が半分に','Crafting +35%. Smoke: happiness -8, tree regrowth halved'), f:()=>{ S.flags.steam = true; story('蒸気機関を導入した','Brought in steam engines'); return {img:'steam', title:L('蒸気機関、始動！','Steam engines roar!'), text:L('もくもくと煙が上がり、歯車がうなる。','Smoke billows and gears hum.')}; }},
    {l:L('職人の誇りを守る','Keep the craft pride'), d:L('高級家具・歯車の売値 +30%、幸福 +4','Furniture & gears sell +30%, happiness +4'), f:()=>{ S.flags.craft = true; story('職人の道を選んだ','Chose the way of craft'); return {img:'craft', title:L('職人の誇り','Craft pride'), text:L('ひとつひとつ、ていねいに。この島の品は本土で高く売れるようになった。','Carefully, one by one. The island’s goods now fetch a high price.')}; }},
    {l:L('森と共に生きる','Live with the forest'), d:L('木の再生・植林 ×2、木による幸福 ×1.5、板材・家具の売値 +20%。加工の速度 -10%','Regrowth & planting x2, tree happiness x1.5, planks & furniture sell +20%. Crafting -10%'), f:()=>{ S.flags.forest = true; story('森と共に生きる道を選んだ','Chose to live with the forest'); return {img:'forest', title:L('森と共に','With the forest'), text:L('苗木を植え、森を育てる。小鳥やリスが戻ってきた。','Saplings are planted and birds return to the island.')}; }},
  ]})},
  // ---- 農耕の島だけの相談ごと
  {id:'seed', fixed:3, isl:'farm', make:()=>({img:'f_seed', title:L('どの種を受け継ぐ？','Which seeds to pass down?'), text:L('長老が古い種つぼを3つ並べた。「受け継げるのはひとつだけじゃ」。この決定はずっと続く。','The elder lays out three old seed jars: "Only one can be passed down." This lasts forever.'), opts:[
    {l:L('古代米','Ancient rice'), d:L('稲の育ち +30%','Rice grows +30% faster'), f:()=>{ S.flags.heirloom = true; story('古代米を受け継いだ','Inherited the ancient rice'); return {img:'f_rice', title:L('水面に揺れる稲','Rice upon the water'), text:L('赤みをおびた稲が、水ぎわに並んだ。','Reddish rice now lines the river.')}; }},
    {l:L('粉ひきの小麦','Miller’s wheat'), d:L('小麦粉・焼き菓子の売値 +25%','Flour & cakes sell +25%'), f:()=>{ S.flags.miller = true; story('粉ひきの小麦を受け継いだ','Inherited the miller’s wheat'); return {img:'f_wheat', title:L('こがね色の穂','Golden ears'), text:L('香りのよい小麦が、風車へ運ばれていく。','Fragrant wheat heads for the windmills.')}; }},
    {l:L('寄り添う種','Companion seeds'), d:L('かぼちゃの「となりボーナス」が2倍。幸福 +6（ずっと）','Pumpkin companion bonus doubled. Happiness +6 forever'), f:()=>{ S.flags.sisters = true; story('寄り添う種を受け継いだ','Inherited the companion seeds'); return {img:'f_field', title:L('寄り添う畑','Companion fields'), text:L('違う作物どうしが、助け合って育ちはじめた。','Different crops begin to help one another grow.')}; }},
  ]})},
  {id:'sparrow', w:2.5, isl:'farm', cond:()=>S.cells.filter(c=>c.t==='tree').length >= 3, make:()=>{
    const cost = 60 + 12*S.day, n = Math.ceil(S.cells.filter(c=>c.t==='tree').length/2);
    return {img:'f_sparrow', title:L('スズメの大群','A cloud of sparrows'), text:L('実った田畑を、スズメの大群がねらっている。','A cloud of sparrows has its eyes on the ripe fields.'), opts:[
      {l:L('かかしを立てる（'+fmt(cost)+'G）','Put up scarecrows ('+fmt(cost)+'G)'), d:L('確実に守れる','The crops are safe'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; }},
      {l:L('みんなで追い払う','Chase them off together'), d:L('50%：追い払って幸福 +6／50%：実った田畑の半分（'+n+'枚）が食べられ、育て直し','50%: success, happiness +6 / 50%: half the ripe fields ('+n+') are eaten and must regrow'), f:()=>{
        if (Math.random() < 0.5){ addMood(6); story('スズメの大群を追い払った','Chased off the sparrows'); return {img:'f_field', title:L('追い払った！','Chased off!'), text:L('鍋をたたいて走り回り、田畑は無事だった。<b>幸福 +6</b>','Banging pots and running about, they saved the fields. <b>Happiness +6</b>')}; }
        const hit = S.cells.map((c,i)=>c.t==='tree'?i:-1).filter(i=>i>=0).sort(()=>Math.random()-.5).slice(0, n);
        for (const i of hit){ const c = S.cells[i]; S.cells[i] = c.crop ? {t:'sapling', crop:c.crop, g:0.25, r:c.r} : {t:'grass', r:c.r}; setCellMesh(i); }
        story('スズメに田畑を食べられた','Lost fields to the sparrows');
        return {img:'f_sparrow', title:L('食べられた…','Eaten…'), text:L('田畑 '+hit.length+'枚の実りが食べられてしまった。','The sparrows ate '+hit.length+' fields of crops.')}; }},
    ]};
  }},
  // ---- 酪農の島だけの相談ごと
  {id:'breed', fixed:3, isl:'dairy', make:()=>({img:'d_breed', title:L('どの牛を育てる？','Which cows to raise?'), text:L('本土の牧場主が「この島に合う牛を選んでおくれ」と、3種類の牛を連れてきた。この決定はずっと続く。','A mainland rancher brought three kinds of cows: "Pick the ones that suit your island." This lasts forever.'), opts:[
    {l:L('ホルスタイン','Holsteins'), d:L('たくさん乳を出す。1頭から搾れる乳 +30%','Lots of milk. +30% milk from every cow'), f:()=>{ S.flags.holstein = true; story('ホルスタインを育てると決めた','Chose Holstein cows'); return {img:'d_holstein', title:L('白黒の大群','A black-and-white herd'), text:L('大きなホルスタインたちが、さっそく牛舎の前に並んだ。','Big Holsteins are already lining up at the barns.')}; }},
    {l:L('ジャージー','Jerseys'), d:L('濃くておいしい乳。バター・チーズ・熟成チーズの売値 +25%','Rich, tasty milk. Butter, cheese & aged cheese sell +25%'), f:()=>{ S.flags.jersey = true; story('ジャージー牛を迎えた','Welcomed Jersey cows'); return {img:'d_jersey', title:L('こがね色のミルク','Golden milk'), text:L('ジャージー牛の乳は、ほんのり黄色くて甘い。','Jersey milk is faintly golden and sweet.')}; }},
    {l:L('島の空牛（そらうし）','The island’s sky-cows'), d:L('昔から島にいる、ふわふわの牛。幸福 +6（ずっと）、牧草の再生 ×1.5、泥地になりにくい','Fluffy cows native to the island. Happiness +6 forever, grass regrowth x1.5, pasture resists turning to mud'), f:()=>{ S.flags.skycow = true; story('島の空牛を守ると決めた','Vowed to keep the native sky-cows'); return {img:'d_meadow', title:L('ふわふわの空牛','Fluffy sky-cows'), text:L('雲のような毛並みの空牛たちが、うれしそうに草原を跳ねまわる。','Cloud-fleeced sky-cows bounce happily across the meadow.')}; }},
  ]})},
  {id:'calf', w:2, isl:'dairy', cond:()=>countB('barn') && S.day >= 4, make:()=>{
    const price = 300 + 40*S.day, i = allB('barn').sort((a,b)=>S.cells[a].b.lvl - S.cells[b].b.lvl)[0];
    return {img:'d_calf', title:L('子牛が生まれた！','A calf is born!'), text:L('夜明け前、牛舎で元気な子牛が生まれた。本土の牧場が「ぜひ譲ってほしい」と言ってきている。','Before dawn a healthy calf was born in the barn. A mainland ranch wants to buy it.'), opts:[
      {l:L('名前をつけて島で育てる','Name it and raise it here'), d:L('牛が1頭増える。幸福 +5','One more cow. Happiness +5'), f:()=>{ const nc = S.herd.length < COW_NAMES.length ? newCow(isB(i, 'barn') ? i : S.bell) : starCow(); addMood(5); story('子牛に名前をつけて育てた','Named and raised a calf'); return {img:'d_calf', title:L('島の新しい仲間','A new islander'), text:L('子牛は「'+COW_NAMES[nc.name][0]+'」と名づけられ、みんなの人気者になった。','The calf was named “'+COW_NAMES[nc.name][1]+'” and became everyone’s favorite.')}; }},
      {l:L('本土の牧場に譲る（+'+fmt(price)+'G）','Sell it to the mainland (+'+fmt(price)+'G)'), d:L('お金が入る。幸福 -3','You get the money. Happiness -3'), f:()=>{ S.gold += price; S.stats.earned += price; addMood(-3); }},
    ]};
  }},
  {id:'tasting', w:1.5, isl:'dairy', cond:()=>S.stats.made.cheese + S.stats.made.butter >= 10, make:()=>{
    const it = S.stats.made.cheese >= 5 ? 'cheese' : 'butter', nm = N(ITEMS[it].n);
    return {img:'contract', title:L('旅の食通がやってきた','A traveling gourmet'), text:L('本土で有名な食通が「この島の'+nm+'を5個、試させてもらえないか」と言っている。評判しだいで値段が大きく動きそうだ。','A famous mainland gourmet asks to taste 5 of your '+nm+'. The review could move prices a lot.'), opts:[
      {l:L(nm+'を5個ふるまう','Serve 5 '+nm), d:L('60%：絶賛され、'+nm+'の相場が150%に・幸福 +5／40%：酷評され、3日間 '+nm+'の売値が最大70%に','60%: rave review, '+nm+' price to 150%, happiness +5 / 40%: harsh review, '+nm+' sells at most 70% for 3 days'), dis:()=>S.items[it] < 5, f:()=>{
        S.items[it] -= 5;
        if (Math.random() < 0.6){ S.sat[it] = 1.5; addMood(5); story('食通に'+ITEMS[it].n[0]+'を絶賛された','A gourmet raved about the '+ITEMS[it].n[1]); return {img:'contract_ok', title:L('「すばらしい！」','“Magnificent!”'), text:L('食通は目を閉じて、ゆっくりうなずいた。本土の新聞に大きく載り、'+nm+'の値段が上がった。<b>相場150%・幸福 +5</b>','The gourmet closed their eyes and nodded slowly. The mainland papers ran the story. <b>Price 150%, happiness +5</b>')}; }
        S.satCap[it] = {v:0.7, until:S.day+3}; addMood(-3); story('食通に酷評された','A gourmet panned the island');
        return {img:'contract_fail', title:L('「……ふむ」','“…Hmm.”'), text:L('食通は首をかしげて帰っていった。しばらく'+nm+'が売れにくくなりそうだ。<b>3日間 売値最大70%</b>','The gourmet tilted their head and left. '+nm+' won’t sell well for a while. <b>At most 70% for 3 days</b>')}; }},
      {l:L('丁重に断る','Politely decline'), d:L('何も起きない','Nothing happens'), f:()=>{}},
    ]};
  }},
  {id:'contract', w:3, cond:()=>S.contracts.length < 2, make:()=>{
    const it = ISL.contract();
    const est = Math.max(3, estPerDay(it)), need = Math.max(5, Math.round(est * rnd(1.0, 1.8)));
    const mult = Math.round(rnd(1.4, 2.8)*10)/10, reward = Math.round(need * ITEMS[it].p * mult), penalty = Math.round(need * ITEMS[it].p * rnd(0.4, 0.9));
    const tag = mult >= 2.4 ? L('（かなりお得！）',' (a great deal!)') : mult <= 1.7 ? L('（ちょっと渋い）',' (a bit stingy)') : '';
    return {img:'contract', title:L('大口の注文','A big order'), text:L('本土の商会から「'+N(ITEMS[it].n)+'を'+need+'個、2日後の朝までに」と注文が来た。報酬は相場の約'+mult+'倍'+tag+'。今のペースは1日およそ'+Math.round(est)+'個。', 'A mainland guild wants '+need+' '+N(ITEMS[it].n)+' within 2 days, paying about '+mult+'× market'+tag+'. You make about '+Math.round(est)+' a day.'), opts:[
      {l:L('引き受ける','Accept'), d:L('市場に入った分から自動で納品。成功で '+fmt(reward)+'G。失敗すると違約金 '+fmt(penalty)+'G と幸福 -5', 'Goods reaching the market are delivered automatically. Success: '+fmt(reward)+'G. Failure: '+fmt(penalty)+'G penalty, happiness -5'),
        f:()=>{ S.contracts.push({it, need, got:0, reward, penalty, due:S.day+2, start:(S.day-1)*P.dayLen + S.time}); }},
      {l:L('断る','Decline'), d:L('何も起きない','Nothing happens'), f:()=>{}},
    ]};
  }},
  {id:'festival', w:2, cond:()=>workerCount() >= 2, make:()=>{
    const cost = 80 + 30*workerCount();
    return {img:'festival', title:L('収穫祭をやりたい！','Let’s have a festival!'), text:L('住民たちが「たまには祭りで騒ぎたい」と言っている。今の幸福度は '+Math.round(S.mood)+'。','The residents want a harvest festival. Happiness is '+Math.round(S.mood)+'.'), opts:[
      {l:L('祭りを開く（'+fmt(cost)+'G）','Hold it ('+fmt(cost)+'G)'), d:L('幸福 +20。今夜は広場で踊りと花火（夕方から仕事は休み）','Happiness +20. Dancing and fireworks tonight (work stops at dusk)'), dis:()=>S.gold < cost, f:()=>{
        S.gold -= cost; addMood(20); S.stats.festivals++; S.festDay = S.day; S.festStill = S.day; festHeard = 0; story('Day'+S.day+'、にぎやかな収穫祭を開いた','Held a lively harvest festival on day '+S.day);
        toast(L('今夜は収穫祭！ 夕方から広場で踊りと花火','Festival tonight! Dancing and fireworks from dusk'), 'good'); }},
      {l:L('今は働くとき','Keep working'), d:L('お金は残る。幸福 -6','Save the gold. Happiness -6'), f:()=>{ addMood(-6); }},
    ]};
  }},
  {id:'storm', w:2, cond:()=>allB().some(i=>BUILD[S.cells[i].b.type]?.ind), make:()=>{
    // 補強費は「壊れたときの修理代」から決める（所持金の割合にはしない）
    const ind = allB().filter(i=>BUILD[S.cells[i].b.type]?.ind);
    const avg = Math.round(ind.reduce((a,i)=>a + BUILD[S.cells[i].b.type].cost.g*0.4, 0) / Math.max(1, ind.length));
    const nb = ind.length >= 4 ? 2 : 1, cost = Math.max(80, Math.round(avg*nb*0.45/10)*10), logs = 10 + 2*S.day, cargo = Math.round(avg*nb*0.35/10)*10;
    return {img:'storm', title:L('嵐が近づいている','A storm is coming'), text:L('今夜は大荒れらしい。工場の屋根が心配だ。壊れたら修理に1棟あたり約 '+fmt(avg)+'G かかる。','A big storm tonight. A broken workshop costs about '+fmt(avg)+'G to repair.'), opts:[
      {l:L('補強する（'+fmt(cost)+'G）','Reinforce ('+fmt(cost)+'G)'), d:L('確実に被害なし','Guaranteed safe'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; }},
      {l:L('運を天に任せる','Leave it to luck'), d:L('50%：工場が'+nb+'棟壊れる／50%：流れ着いた'+N(ITEMS[ISL.tree].n)+' +'+logs+'、漂流した積み荷 +'+fmt(cargo)+'G','50%: '+nb+' workshop(s) break / 50%: '+logs+' drifted '+N(ITEMS[ISL.tree].n)+' and '+fmt(cargo)+'G of salvage'), f:()=>{
        if (Math.random() < 0.5){
          const c = ind.filter(i=>S.cells[i].t === 'b').sort(()=>Math.random()-.5).slice(0, nb), names = [];
          for (const i of c){ S.cells[i].b.broken = true; if (CM[i]) CM[i].rotation.z = 0.12; names.push(N(BUILD[S.cells[i].b.type].n)); }
          story('嵐の賭けに負けた','Lost the storm gamble');
          return {img:'storm_lose', title:L('嵐の爪あと','Storm damage'), text:L(names.join('と')+'が壊れた。クリックして修理しよう。', names.join(' and ')+' broke. Click to repair.')}; }
        S.items[ISL.tree] += logs; S.gold += cargo; story('嵐の賭けに勝った','Won the storm gamble'); const tn = N(ITEMS[ISL.tree].n);
        return {img:'storm_win', title:L('嵐のおくりもの','A gift from the storm'), text:L('島のはしに'+tn+'と積み荷が流れ着いていた。<b>'+tn+' +'+logs+'・'+fmt(cargo)+'G</b>',tn+' and cargo drifted ashore. <b>'+tn+' +'+logs+', '+fmt(cargo)+'G</b>')}; }},
    ]};
  }},
  {id:'loan', w:1.5, cond:()=>S.day >= 3 && !S.loans.length, make:()=>{
    const amt = Math.round((1200 + 500*S.day) * rnd(0.8, 1.3) / 50) * 50, rate = Math.round(rnd(0.2, 0.75)*20)/20, repay = Math.round(amt*(1+rate));
    const tag = rate <= 0.3 ? L('（かなり良い条件）',' (a great deal)') : rate >= 0.6 ? L('（かなり割高）',' (pricey)') : '';
    return {img:'loan', title:L('投資家からの申し出','An investor’s offer'), text:L('「今すぐ '+fmt(amt)+'G 貸しましょう。3日後に '+fmt(repay)+'G 返してくれれば結構」　利息 '+Math.round(rate*100)+'%'+tag,'"I’ll lend you '+fmt(amt)+'G now. Pay back '+fmt(repay)+'G in 3 days." Interest '+Math.round(rate*100)+'%'+tag), opts:[
      {l:L('借りる','Borrow'), d:L('今すぐ +'+fmt(amt)+'G。3日後に -'+fmt(repay)+'G','+'+fmt(amt)+'G now, -'+fmt(repay)+'G in 3 days'), f:()=>{ S.gold += amt; S.loans.push({repay, due:S.day+3, start:(S.day-1)*P.dayLen + S.time}); S.stats.loans++; story(fmt(amt)+'Gを借りて勝負に出た','Borrowed '+fmt(amt)+'G to take a chance'); }},
      {l:L('断る','Decline'), d:L('堅実にいく','Play it safe'), f:()=>{}},
    ]};
  }},
  {id:'protect', w:3, isl:'sky', cond:()=>treeCount() < 12 && !S.flags.forest && S.day >= S.flags.protectUntil && countB('camp'), make:()=>({img:'protect', title:L('森が減っている','The forest is shrinking'), text:L('木が '+treeCount()+' 本まで減った。森の保護団体が「2日間だけ伐採を休んで」と頼んできた。','Only '+treeCount()+' trees left. Forest keepers ask you to stop logging for 2 days.'), opts:[
    {l:L('約束する','Promise'), d:L('2日間、木こり小屋が休む。木の再生 ×3、助成金 +250G、幸福 +8','Lumber camps rest 2 days. Regrowth x3, grant +250G, happiness +8'), f:()=>{ S.flags.protectUntil = S.day + 2; S.gold += 250; addMood(8); story('森を休ませる約束をした','Let the forest rest'); return {img:'forest', title:L('森を休ませる','Resting the forest'), text:L('2日間、斧の音が止む。若木がぐんぐん伸びていく。','For 2 days the axes fall silent and saplings shoot up.')}; }},
    {l:L('断る','Refuse'), d:L('伐採は続く。幸福 -10','Keep logging. Happiness -10'), f:()=>{ addMood(-10); story('森の保護団体の頼みを断った','Refused the forest keepers'); }},
  ]})},
  {id:'tired', w:5, cond:()=>S.nsStreak >= 2, make:()=>({img:'tired', title:L('みんなヘトヘトだ','Everyone is exhausted'), text:L('夜勤が続いて住民がフラフラだ。「今日1日だけ休ませてほしい」','Night after night of work. "Please, just one day off."'), opts:[
    {l:L('今日は休日にする','Make today a holiday'), d:L('今日は誰も働かない。幸福 +22','No work today. Happiness +22'), f:()=>{ S.flags.holidayDay = S.day; addMood(22); S.nsStreak = 0; S.stats.holidays++; story('Day'+S.day+'を島の休日にした','Made day '+S.day+' a holiday'); return {img:'holiday', title:L('島の休日','Island holiday'), text:L('ピクニックに昼寝、凧あげ。今日はみんな思い思いに過ごす。','Picnics, naps and kites. Everyone relaxes today.')}; }},
    {l:L('却下する','Refuse'), d:L('幸福 -10。40%で住民が1人去る','Happiness -10. 40%: a resident leaves'), f:()=>{ addMood(-10); story('休みの願いを却下した','Refused a day off');
      if (Math.random() < 0.4 && workers.length){ removeWorker(workers[0].bi); S.stats.quits++; return {img:'leave', title:L('住民が島を去った…','A resident left…'), text:L('荷物をまとめた住民が、気球に乗って島を離れていった。','A resident packed up and left on a balloon.')}; }
      return {img:'tired', title:L('しぶしぶ仕事へ','Back to work, reluctantly'), text:L('みんな目をこすりながら、持ち場へ戻っていった。','Rubbing their eyes, everyone went back to work.')}; }},
  ]})},
  {id:'artisan', w:1.5, cond:()=>allB().some(i=>BUILD[S.cells[i].b.type]?.in && S.cells[i].b.lvl < 5), make:()=>{
    const c = allB().filter(i=>BUILD[S.cells[i].b.type]?.in && S.cells[i].b.lvl < 5); const i = c[Math.floor(Math.random()*c.length)];
    return {img:'artisan', title:L('腕利きの職人一家','A family of master crafters'), text:L('職人一家が「'+N(BUILD[S.cells[i].b.type].n)+'で働きたい。ただし給料は上げてほしい」と言っている。','A crafter family wants to work at the '+N(BUILD[S.cells[i].b.type].n)+', if wages go up.'), opts:[
      {l:L('迎え入れる','Welcome them'), d:L(N(BUILD[S.cells[i].b.type].n)+'がタダでレベル+1。全員の日給 +3G（ずっと）。幸福 +4', N(BUILD[S.cells[i].b.type].n)+' +1 level free. Everyone’s wage +3G forever. Happiness +4'), f:()=>{ S.cells[i].b.lvl++; S.flags.wageBonus += 3; addMood(4); story('職人一家を迎え入れた','Welcomed the crafter family'); }},
      {l:L('丁重に断る','Politely decline'), d:L('何も起きない','Nothing happens'), f:()=>{}},
    ]};
  }},
  {id:'rival', w:1.5, cond:()=>S.stats.made[ISL.hi] + S.stats.made[ISL.mid] > 12, make:()=>{
    const it = S.stats.made[ISL.hi] > 4 ? ISL.hi : ISL.mid, cost = 300 + S.day*60;
    return {img:'rival', title:L('ライバル島の安売り','A rival island’s sale'), text:L('隣の島が'+N(ITEMS[it].n)+'を安売りし始めた。','A rival island started dumping cheap '+N(ITEMS[it].n)+'.'), opts:[
      {l:L('宣伝で対抗（'+fmt(cost)+'G）','Advertise ('+fmt(cost)+'G)'), d:L(N(ITEMS[it].n)+'の相場が125%に上がる', N(ITEMS[it].n)+' price rises to 125%'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; S.sat[it] = 1.25; story('宣伝合戦に打って出た','Fought back with ads'); }},
      {l:L('受け流す','Let it be'), d:L('3日間、'+N(ITEMS[it].n)+'の売値が最大60%に','For 3 days, '+N(ITEMS[it].n)+' sells at most 60%'), f:()=>{ S.satCap[it] = {v:0.6, until:S.day+3}; }},
    ]};
  }},
  {id:'whale', w:2, cond:()=>S.day >= 3, make:()=>{
    const cost = 60 + 15*workerCount();
    return {img:'whale', title:L('雲クジラがやってきた','A cloud whale appears'), text:L('島のすぐ横を、雲でできた大きなクジラが泳いでいる。歌でもてなすと恵みの雨を降らせてくれるという。','A huge whale made of clouds swims beside the island. Legend says a song will bring blessed rain.'), opts:[
      {l:L('歌と宴でもてなす（'+fmt(cost)+'G）','Sing and feast ('+fmt(cost)+'G)'), d:L(N(ISL.sapN)+'がすべて育ちきり、今日は'+N(ISL.treeN)+'の再生 ×3。幸福 +8','All '+N(ISL.sapN)+' grow up, regrowth x3 today. Happiness +8'), dis:()=>S.gold < cost, f:()=>{
        S.gold -= cost; addMood(8); S.rainDay = S.day; S.whaleDay = S.day;
        for (let i=0;i<W*W;i++) if (S.cells[i].t === 'sapling'){ S.cells[i] = {t:'tree', hp:P.treeHP, r:S.cells[i].r, clover:S.cells[i].clover, crop:S.cells[i].crop}; setCellMesh(i); CM[i].userData.pop = 0.4; }
        story('雲クジラをもてなし、恵みの雨を受けた','Welcomed the cloud whale and its rain');
        return {img:'whale_rain', title:L('恵みの雨','Blessed rain'), text:L('雲クジラが潮を吹くと、やさしい雨が島に降りそそいだ。','The whale spouted, and gentle rain fell over the island.')}; }},
      {l:L('静かに見送る','Watch it pass'), d:L('雲クジラはどこかへ泳いでいく','The whale swims away'), f:()=>{ S.whaleDay = S.day; }},
    ]};
  }},
  {id:'levistone', w:2, cond:()=>S.day >= 5 && S.day >= (S.flags.stoneSafeUntil||0), make:()=>{
    const need = 150 + 30*S.day;
    return {img:'levistone', title:L('浮遊石にひびが…','A crack in the floatstone'), text:L('島を空に浮かべている青い浮遊石に、小さなひびが見つかった。','A small crack appeared in the blue stone that keeps the island aloft.'), opts:[
      {l:L('修繕する（'+fmt(need)+'G）','Repair it ('+fmt(need)+'G)'), d:L('確実に直る。幸福 +3','Fixed for sure. Happiness +3'), dis:()=>S.gold < need, f:()=>{
        S.gold -= need; addMood(3); S.flags.stoneSafeUntil = S.day + 6; S.flags.crack = false; story('浮遊石を修繕した','Repaired the floatstone');
        return {img:'stone_ok', title:L('浮遊石、ふたたび輝く','The floatstone shines again'), text:L('職人たちが足場を組み、ひびをていねいに埋めた。島はまっすぐに戻った。','Crafters built scaffolds and sealed the crack. The island is level again.')}; }},
      {l:L('様子を見る','Wait and see'), d:L('50%：何も起きない／50%：島が揺れ、貯蔵の半分がこぼれ、施設がひとつ壊れる。幸福 -8','50%: nothing / 50%: a quake spills half of all storage and breaks a building. Happiness -8'), f:()=>{
        S.flags.crack = true;
        if (Math.random() < 0.5){ S.flags.stoneSafeUntil = S.day + 3; return {img:'crack_held', title:L('ひびは持ちこたえた','The crack held'), text:L('ひびは広がらなかった。今のところは……。でも、いつまで持つだろう。','The crack did not spread. For now… but for how long?')}; }
        quake(); story('浮遊石のひびを放っておき、島が揺れた','Ignored the crack and the island shook');
        return {img:'quake', title:L('島が揺れた！','The island shook!'), text:L('島全体が傾き、貯まっていた物が半分こぼれ落ちた。修繕を考えたほうがいい。','The whole island tilted and half of the stored goods fell. Better repair it soon.')}; }},
    ]};
  }},
  {id:'pirates', w:1.5, cond:()=>S.day >= 5 && S.gold >= 1500 && S.day >= (S.flags.pirateFree || 0), make:()=>{
    const toll = Math.round(S.gold*0.15);
    return {img:'pirates', title:L('空賊の影','Sky pirates!'), text:L('ドクロの帆の飛行船が近づいてきた。「通行料に '+fmt(toll)+'G よこしな」','A skull-sailed airship approaches. "Pay '+fmt(toll)+'G, or else."'), opts:[
      {l:L('通行料を払う','Pay the toll'), d:L('確実に去っていく','They leave for sure'), f:()=>{ S.gold -= toll; story('空賊に通行料を払った','Paid the sky pirates'); }},
      {l:L('見張りを立てて追い返す','Stand guard'), d:L('60%：撃退。お金は払わずにすみ、幸福 +8、しばらく空賊は来ない／40%：市場の品物を3割奪われる','60%: drive them off. No toll, happiness +8, and they stay away for a while / 40%: lose 30% of market goods'), f:()=>{
        if (Math.random() < 0.6){ addMood(8); S.flags.pirateFree = S.day + 7; story('空賊を追い返した','Drove off the sky pirates');
          return {img:'pirates_win', title:L('空賊を撃退！','Pirates repelled!'), text:L('見張りの合図で鐘を鳴らし、みんなで追い返した。空賊は慌てて逃げていった。<b>通行料はゼロ・幸福 +8</b>。しばらくは近づいてこないだろう。','The lookout rang the bell and everyone drove them off. <b>No toll paid, happiness +8.</b> They won’t be back for a while.')}; }
        const lost = []; for (const k of ITEM_KEYS){ const n = Math.floor(S.items[k]) - Math.floor(S.items[k]*0.7); if (n > 0) lost.push(N(ITEMS[k].n)+' -'+n); S.items[k] = Math.floor(S.items[k]*0.7); }
        addMood(-4); story('空賊に市場を荒らされた','Pirates raided the market');
        return {img:'pirates_lose', title:L('市場が荒らされた…','The market was raided…'), text:L('見張りの隙をつかれ、市場の品物が持ち去られた。','They slipped past the guard and carried off goods.')+'<br><b>'+(lost.join('・') || L('（品物はほとんどなかった）','(there was little to take)'))+'</b>'}; }},
    ]};
  }},
  {id:'traveler', w:1.5, cond:()=>S.day >= 3, make:()=>({img:'balloon', title:L('気球の旅人','A balloon traveler'), text:L('旅人が「金色の'+N(ISL.sapN)+'を'+N(ITEMS[ISL.mid].n)+'10個と交換しませんか？'+N(ITEMS[ISL.tree].n)+'が3倍とれますよ」と言う。','A traveler offers golden '+N(ISL.sapN)+' for 10 '+N(ITEMS[ISL.mid].n)+'. "Triple '+N(ITEMS[ISL.tree].n)+'!"'), opts:[
    {l:L(N(ITEMS[ISL.mid].n)+'10個と交換','Trade 10 '+N(ITEMS[ISL.mid].n)), d:L('空き地に金色の'+N(ISL.treeN)+'が育つ','A golden '+N(ISL.treeN)+' appears'), dis:()=>S.items[ISL.mid] < 10 || !S.cells.some(c=>c.t==='grass'), f:()=>{
      S.items[ISL.mid] -= 10; const g = S.cells.map((c,i)=>c.t==='grass'?i:-1).filter(i=>i>=0); const i = g[Math.floor(Math.random()*g.length)];
      S.cells[i] = {t:'tree', hp:P.treeHP, r:Math.random(), gold:true}; setCellMesh(i); CM[i].userData.pop = 0.5; story('金色の'+ISL.sapN[0]+'を譲り受けた','Received golden '+ISL.sapN[1]);
      return {img:'balloon', title:L('金の木','A golden tree'), text:L('みるみる金色に育った。刈り取るかどうかはあなた次第。','It grew golden in no time. Whether to harvest it is up to you.')}; }},
    {l:L('断る','Decline'), d:L('旅人は次の島へ','The traveler drifts on'), f:()=>{}},
  ]})},
  {id:'meteor', w:1.5, cond:()=>S.day >= 2, make:()=>({img:'meteor', title:L('流れ星の夜','A night of shooting stars'), text:L('今夜は流れ星がたくさん降るらしい。「みんなで願い事をしたい！」','Shooting stars tonight! "Let’s make wishes together!"'), opts:[
    {l:L('みんなで夜空を見る','Watch together'), d:L('今夜は夜勤なし。明日の朝、幸福 +12 と願いがかなうかも','No night shift tonight. Tomorrow: happiness +12 and maybe a wish comes true'), f:()=>{ S.meteorNight = S.day; story('みんなで流れ星に願い事をした','Wished upon shooting stars'); }},
    {l:L('ふだんどおり','Business as usual'), d:L('何も起きない','Nothing happens'), f:()=>{}},
  ]})},
  {id:'cheer', w:2.5, cond:()=>S.mood >= 75 && S.day >= 4 && workerCount() >= 3, make:()=>({img:'cheer', title:L('上機嫌の住民たち','Cheerful residents'), text:L('「この島が大好き！なにか手伝わせて！」住民たちがやる気に満ちている。今の幸福度は '+Math.round(S.mood)+'。','"We love this island! Let us help!" Everyone is fired up. Happiness is '+Math.round(S.mood)+'.'), opts:[
    {l:L('今日は張り切ってもらう','Let them go all out today'), d:L('今日1日、作業と移動が +40%。そのぶん疲れて幸福 -10','Today: work and walking +40%. Afterwards they are tired: happiness -10'), f:()=>{ S.boostDay = S.day; addMood(-10); story('上機嫌の住民たちが大いに働いた','Cheerful residents worked extra hard');
      return {img:'overtime', title:L('島じゅうが大忙し！','The whole island is buzzing!'), text:L('鼻歌まじりに、いつもの倍の勢いで働いている。','Humming as they go, everyone works at double pace.')}; }},
    {l:L('島の手入れを頼む','Ask them to tend the island'), d:L('空き地に'+ISL.sapN[0]+'が6つ。よく通る道が踏み固められる。幸福 +3','6 '+ISL.sapN[1]+' on open land, busy paths get firmer. Happiness +3'), f:()=>{
      S.cells.map((c,i)=>c.t==='grass' && i !== WH ? i : -1).filter(i=>i>=0).sort(()=>Math.random()-.5).slice(0,6).forEach(i=>sprout(i));
      for (const k in S.routes) S.routes[k] = Math.min(1, S.routes[k] + 0.2); updatePaths(); addMood(3); story('住民と一緒に島を手入れした','Tended the island together');
      return {img:'forest', title:L('島の手入れ','Tending the island'), text:L(ISL.sapN[0]+'を植え、道をならした。島が少し、みんなの場所になった。','New '+ISL.sapN[1]+' planted, paths smoothed. The island feels more like home.')}; }},
  ]})},
  {id:'unrest', w:4, cond:()=>S.mood <= 35 && S.day >= 3 && workerCount() >= 2, make:()=>{
    const cost = 60 + 25*workerCount();
    return {img:'unrest', title:L('不満の声','Grumbling residents'), text:L('住民の代表が「暮らしを良くしてほしい」と詰め寄ってきた。今の幸福度は '+Math.round(S.mood)+'。','Residents demand a better life. Happiness is '+Math.round(S.mood)+'.'), opts:[
      {l:L('給料を上げる','Raise wages'), d:L('全員の日給 +2G（ずっと）。幸福 +12','Everyone’s wage +2G forever. Happiness +12'), f:()=>{ S.flags.wageBonus += 2; addMood(12); story('給料を上げて不満に応えた','Raised wages to calm the island');
        return {img:'wage_up', title:L('給料アップ！','A raise!'), text:L('住民たちの顔がぱっと明るくなった。','Faces light up all over the island.')}; }},
      {l:L('宴を開いて話を聞く（'+fmt(cost)+'G）','Hold a feast and listen ('+fmt(cost)+'G)'), d:L('幸福 +15（1回だけ）','Happiness +15 (once)'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; addMood(15);
        return {img:'festival_go', title:L('語り合いの宴','A feast of words'), text:L('料理を囲んで、ひと晩じゅう話し合った。','Over good food, everyone talked late into the night.')}; }},
      {l:L('突っぱねる','Refuse'), d:L('幸福 -5。50%：今日はストライキで誰も働かない','Happiness -5. 50%: a strike, no work today'), f:()=>{ addMood(-5);
        if (Math.random() < 0.5){ S.strikeDay = S.day; story('住民がストライキを起こした','The residents went on strike'); return {img:'strike', title:L('ストライキ！','Strike!'), text:L('今日は誰も働かない。家の前でプラカードを掲げている。','No one works today. Signs are up in front of the houses.')}; }
        return {img:'unrest', title:L('しぶしぶ仕事へ','Grudgingly back to work'), text:L('ぶつぶつ言いながらも、みんな持ち場に戻った。','Muttering, everyone went back to work.')}; }},
    ]};
  }},
  {id:'nightorder', w:1.5, cond:()=>!S.nightShift && !S.nightOrder && S.day >= 4 && allB().some(i=>BUILD[S.cells[i].b.type]?.in && S.cells[i].b.workers), make:()=>({img:'nightorder', title:L('夜明けの特急便','The dawn express'), text:L('商人が「明日の朝いちばんの気球に、夜のうちに作った品を積みたい。いつもの1.45倍で買うよ」と言っている。','A merchant says: "Load what you craft tonight on tomorrow’s first balloon. I’ll pay 1.45× the usual."'), opts:[
    {l:L('今夜は夜勤！','Night shift tonight!'), d:L('今夜だけ夜勤ON。夜のあいだに作った加工品の値段の45%がボーナスで入る（品物は手元に残る）','Night shift ON just for tonight. Bonus: 45% of the value of goods crafted overnight (you keep the goods)'), f:()=>{
      S.nightOrder = {day:S.day, prev:S.nightShift, snap:null}; S.nightShift = true; story('夜明けの特急便に挑んだ','Took on the dawn express');
      return {img:'nightorder', title:L('今夜は夜なべ','Working through the night'), text:L('ランタンを灯して、夜通し機械を回す。浴場があると疲れが軽くなる。','Lanterns lit, the machines will run all night. A bathhouse eases the fatigue.')}; }},
    {l:L('夜はしっかり休む','Rest at night'), d:L('幸福 +2','Happiness +2'), f:()=>{ addMood(2); }},
  ]})},
  {id:'bigvein', w:3, isl:'sky', cond:()=>S.flags.mine && S.res.ore < S.resTotal*0.5 && !S.doneEvents.bigvein, make:()=>{
    const cost = 600 + S.day*40;
    return {img:'vein', title:L('眠れる大鉱脈','A sleeping great vein'), text:L('坑道の奥で、さらに大きな鉱脈が見つかった。掘り進めるには支柱を組む必要がある。','Deep in the shaft lies a much bigger vein. Shoring it up costs money.'), opts:[
      {l:L('掘り進める（'+fmt(cost)+'G）','Dig deeper ('+fmt(cost)+'G)'), d:L('地下の鉄鉱石 +180（断面図が深くなる）','Underground ore +180 (the cutaway gets deeper)'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; S.res.ore += 180; S.resTotal += 180; S.ugRows = 8; updateTiles(); story('大鉱脈を掘り当てた','Struck the great vein'); return {img:'mine', title:L('大鉱脈！','The great vein!'), text:L('坑道がさらに奥へ伸びた。しばらくは鉄に困らない。','The tunnels reach deeper. Iron will flow for a while.')}; }},
      {l:L('このままにする','Leave it'), d:L('今ある分だけを掘る','Mine only what remains'), f:()=>{}},
    ]};
  }},
];
function quake(){
  shake(0.35); sfx('build');
  for (const i of allB()){ const b = S.cells[i].b; for (const k in b.st || {}) b.st[k] = Math.floor(b.st[k]/2); }
  const c = allB().filter(i=>S.cells[i].b.type !== 'warehouse' && S.cells[i].b.type !== 'house');
  if (c.length){ const i = c[Math.floor(Math.random()*c.length)]; S.cells[i].b.broken = true; CM[i].rotation.z = 0.12; }
  addMood(-8);
}
function queueEvent(){
  let ev = null;
  for (const e of EVENTS) if (e.fixed && islOk(e) && !S.doneEvents[e.id] && !queuedIds[e.id] && S.day >= e.fixed){ ev = e; break; }
  if (!ev && Math.random() < 0.85){
    const pool = EVENTS.filter(e => !e.fixed && islOk(e) && e.id !== S.lastEvent && (!e.cond || e.cond()));
    const tot = pool.reduce((a,e)=>a+e.w, 0); let r = Math.random()*tot;
    for (const e of pool){ r -= e.w; if (r <= 0){ ev = e; break; } }
  }
  if (!ev) return;
  S.lastEvent = ev.id; queuedIds[ev.id] = true;
  const E = ev.make(); E.id = ev.id; eventQueue.push(E);
}
const evImg = n => n ? '<img class="evimg" src="assets/ev/'+n+'.jpg" alt="">' : '';
let curEvent = null;
function showEvent(E){
  const box = $('#modal .mbox');
  if (E.result){
    if (!E.quiet) sfx('fanfare');
    box.innerHTML = gfix(evImg(E.img) + '<h2>'+E.title+'</h2><p>'+E.text+'</p><div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('つづける','Continue')+'</div></button></div>');
    curEvent = null; $('#modal').hidden = false; return;
  }
  sfx('event');
  box.innerHTML = gfix('<div class="day">'+L('Day '+S.day+' の朝','Morning of day '+S.day)+'</div>' + evImg(E.img) + '<h2>'+E.title+'</h2><p>'+E.text+'</p><div class="opts">' +
    E.opts.map((o,k)=>'<button class="opt" data-act="ev:'+k+'" '+(o.dis && o.dis() ? 'disabled':'')+'><div class="n">▶ '+o.l+'</div><div class="d">'+o.d+'</div></button>').join('') + '</div>');
  curEvent = E; $('#modal').hidden = false;
}
function chooseEvent(k){
  const E = curEvent; if (!E) return; const o = E.opts[k]; if (o.dis && o.dis()) return;
  const res = o.f(); S.doneEvents[E.id] = true; curEvent = null; $('#modal').hidden = true; sfx('ui');
  if (res) eventQueue.unshift({result:true, ...res}); else if (E.id !== 'festival' || S.festStill !== S.day) toast('「'+o.l+'」','ev');
}

/* =========================================================
   チュートリアル（ここだけ一本道）
   ========================================================= */
const TUT = [
  {m:['光っている<b>木をクリック</b>して伐ってみよう！丸太を3本集めよう。','<b>Click the glowing tree</b> to chop it! Collect 3 logs.'], ok:()=>S.items.log >= 3 || S.stats.sold > 0, mark:'tree'},
  {m:['上の<b>「丸太」</b>を押すと、気球の商人にまとめて売れる。','Press <b>Logs</b> at the top to sell them to the balloon trader.'], ok:()=>S.stats.sold > 0, el:'#chip-log'},
  {m:['<b>建設</b>から<b>木こり小屋</b>を建てよう。森のそばがおすすめ。','Open <b>Build</b> and place a <b>Lumber Camp</b> near the forest.'], ok:()=>countB('camp') > 0, el:'#btnBuild'},
  {m:['木こり小屋をタップして住民を<b>雇おう</b>。丸太は小屋に貯まっていく。','Tap the camp and <b>hire</b> a worker. Logs pile up at the camp.'], ok:()=>allB('camp').some(i=>S.cells[i].b.workers), mark:'camp'},
  {m:['丸太が貯まったら、<b>小屋をタップして回収</b>しよう。','When logs pile up, <b>tap the camp to collect</b> them.'], ok:()=>S.stats.collects > 0, mark:'camp'},
  {m:['回収は人に任せられる。<b>市場（青い屋根）をタップ</b>して<b>運搬係を雇おう</b>。','Let others haul. <b>Tap the Market (blue roof)</b> and <b>hire a hauler</b>.'], ok:()=>S.cells[WH].b.workers > 0, mark:'warehouse'},
  {m:['<b>製材所</b>を建てて住民を雇おう。運搬係が丸太を直接届けてくれる。','Build a <b>Sawmill</b> and hire. Haulers bring logs straight to it.'], ok:()=>allB('sawmill').some(i=>S.cells[i].b.workers), el:'#btnBuild', mark:'sawmill'},
  {m:['板材が市場に届いたら、上の<b>「板材」で売ろう</b>。加工するほど高い！','When planks reach the market, <b>sell Planks</b> at the top. Crafted goods pay more!'], ok:()=>S.stats.soldBy.plank > 0, el:'#chip-plank'},
];
function tutCheck(){
  const T = TUT[S.tut]; if (!T) return;
  if (T.ok()){ S.tut++; sfx('fanfare'); if (S.tut >= TUT.length) endTutorial(); }
}
function endTutorial(){
  S.tut = -1; $('#tut').hidden = true;
  $('#modal .mbox').innerHTML = gfix('<h2>'+L('ここからが本番！','Now the real game begins!')+'</h2>' +
    '<p>'+L('ここからは<b>あなたの島</b>です。','From here on, it’s <b>your island</b>.')+'</p><p class="kv">' +
    L('・毎朝、島に相談ごとが届きます。正解はありません。<br>・木も岩もいつかは尽きます。<br>・持ち場から遠い仕事ほど、ぐんと時間がかかります。<br>・建物は「移動」でいつでも動かせます（10G・少し時間がかかる）。<br>・目標は <b>'+fmt(P.goal)+'G で空港を開き、飛行船を呼ぶ</b>こと。',
      '• Every morning brings a dilemma. There is no right answer.<br>• Trees and rocks run out eventually.<br>• Work far from a building takes much longer.<br>• Buildings can be moved any time (10G, takes a little time).<br>• Goal: <b>open an airport for '+fmt(P.goal)+'G and call an airship</b>.') +
    '</p><div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('はじめる','Start')+'</div></button></div>');
  $('#modal').hidden = false;
}

/* =========================================================
   エンディング：島の称号
   ========================================================= */
const TITLES = {
  sky: {
    nature:  [['森と共に生きる島','Island of the Living Forest'], ['木々のざわめきが聞こえる、緑の楽園になった。','A green haven where the trees whisper.']],
    industry:[['煙突と歯車の都','City of Chimneys and Gears'], ['昼も夜も機械の音が響く、工業の都になった。','An industrial city humming day and night.']],
    craft:   [['名工の里','Home of Master Crafters'], ['この島の家具は、本土でも名品として知られている。','Its furniture is famous on the mainland.']],
    merchant:[['商いの港町','Merchant’s Harbor'], ['約束と勝負で富を築いた、したたかな港町になった。','A shrewd harbor built on deals and bold bets.']],
    happy:   [['笑顔あふれる村','Village of Smiles'], ['忙しくても、みんなが笑っている村になった。','Busy, but everyone is smiling.']],
    grind:   [['眠らない島','The Sleepless Island'], ['明かりの消えない島。たくさん稼いだ……たぶん。','The lights never go out. Lots of money… probably.']],
  },
  dairy: {
    nature:  [['花咲く放牧の丘','Hills of the Free Herd'], ['牛たちがのんびり草をはむ、花いっぱいの丘になった。','Cows graze lazily across hills full of flowers.']],
    industry:[['ミルク工場の島','Island of Milk Works'], ['搾乳機と蔵の扉が休みなく動く、乳製品の都になった。','A dairy capital where machines and cellar doors never rest.']],
    craft:   [['チーズ職人の里','Home of Cheesemakers'], ['この島のチーズは、本土の食卓のあこがれだ。','Its cheese is the envy of mainland tables.']],
    merchant:[['乳製品の交易港','Dairy Trading Port'], ['約束と勝負で本土に販路を広げた、したたかな港になった。','A shrewd port that won the mainland with deals and bets.']],
    happy:   [['牛と笑顔の村','Village of Cows and Smiles'], ['人も牛も、みんなごきげんな村になった。','A village where people and cows are all content.']],
    grind:   [['眠らない牧場','The Sleepless Ranch'], ['牛も人も寝不足。たくさん稼いだ……たぶん。','Cows and people alike are short on sleep. Lots of money… probably.']],
  },
};
TITLES.farm = {
  nature:  [['水めぐる千の田畑','Land of a Thousand Fields'], ['川が光り、季節ごとに色を変える美しい里になった。','A village of shining rivers that changes color with every season.']],
  industry:[['風車と酒蔵の町','Town of Mills and Breweries'], ['風車と蔵が休みなく働く、実りの工業都市になった。','Mills and breweries never rest in this town of plenty.']],
  craft:   [['菓子職人の里','Home of Pastry Masters'], ['この村の焼き菓子は、本土の祝いの席に欠かせない。','No mainland celebration is complete without its cakes.']],
  merchant:[['実りの大問屋','Granary of the Skies'], ['約束と勝負で本土の食卓を握った、豊かな問屋街になった。','A rich market town that feeds the mainland through deals and bets.']],
  happy:   [['四季を祝う村','Village of Four Seasons'], ['種まきも雪の日も、みんなで笑っている村になった。','From sowing to snowfall, everyone here is smiling.']],
  grind:   [['眠らない田んぼ','The Sleepless Paddies'], ['月明かりで稲を刈る。たくさん稼いだ……たぶん。','Reaping by moonlight. Lots of money… probably.']],
};
function evaluate(){
  const st = S.stats, avg = st.moodN ? st.moodSum/st.moodN : S.mood;
  const ind = allB().filter(i=>BUILD[S.cells[i].b.type]?.ind).length;
  const made = list => list.reduce((a,[k,m]) => a + st.made[k]*m, 0);
  const ax = {
    nature:  (isFarm ? Math.min(20, fieldCount()*0.35) + Math.min(15, (st.dug || 0)*0.5) : 0) + Math.min(15, (st.clover || 0)*0.05) + Math.min(30, treeCount()*0.8) + Math.min(15, st.planted*0.15) + (S.flags.sacred || S.flags.skycow || S.flags.sisters ? 15 : 0) + (S.flags.forest?30:0),
    industry:Math.min(45, made(ISL.axInd)) + (S.flags.steam?30:0) + ind*2,
    craft:   Math.min(40, made(ISL.axCraft)) + (S.flags.craft?30:0),
    merchant:st.contractsDone*12 + st.loans*8 + Math.min(20, st.earned/5000),
    happy:   Math.max(0, avg-50)*1.5 + st.festivals*8 + st.holidays*8 + Math.min(10, st.pets*0.5),
    grind:   (st.driveDays || 0)*3 + st.nightShifts*7 + (st.nightShifts ? Math.max(0, 45-avg)*0.6 : 0) + st.quits*6,
  };
  const sorted = Object.entries(ax).sort((a,b)=>b[1]-a[1]), T = TITLES[ISLAND];
  return {main:T[sorted[0][0]], sub:T[sorted[1][0]], ax, avg};
}
function endingScore(){
  const R = calcScore(ISLAND);
  return '<img class="rankimg" src="'+rankImg(ISLAND, R.rk)+'" alt="'+R.rk+'"><div class="scorehead"><span class="rk rk'+R.rk+'">'+R.rk+'</span><span><b>'+fmt(R.total)+'</b> / '+fmt(R.max)+'<br>『'+N(RANK_NAME[ISLAND][R.rk])+'』</span></div>';
}
function showEnding(){
  const r = evaluate(), st = S.stats, sky = ISLAND === 'sky', next = ISL_ORDER[ISL_ORDER.indexOf(ISLAND) + 1];
  $('#modal .mbox').innerHTML = gfix('<div class="day">'+(sky ? L('Day '+S.day+'　空港に飛行船がやってきた！','Day '+S.day+' — An airship arrives at your airport!') : (isFarm ? L('Day '+S.day+'　収穫祭の飛行船がやってきた！','Day '+S.day+' — The harvest airship arrives!') : L('Day '+S.day+'　品評会の飛行船がやってきた！','Day '+S.day+' — The fair airship arrives!')))+'</div>' + endingScore() +
    '<h2>'+L('あなたの島の称号','Your island’s title')+'</h2><div class="title-big">『'+N(r.main[0])+'』</div>' +
    '<p style="text-align:center">'+N(r.main[1])+'<br><small style="color:var(--sub)">'+L('ちょっぴり「'+N(r.sub[0])+'」の気配も。','With a hint of "'+N(r.sub[0])+'".')+'</small></p>' +
    '<div class="kv">'+L('稼いだ総額','Total earned')+'：'+fmt(st.earned)+'G／'+L('残った'+ISL.treeN[0], ISL.treeN[1]+' left')+'：'+treeCount()+'／'+L('平均幸福','Avg happiness')+'：'+Math.round(r.avg)+'<br>' +
    N(ITEMS[ISL.hi].n)+' '+st.made[ISL.hi]+'・'+N(ITEMS[ISL.top].n)+' '+st.made[ISL.top]+'／'+L('注文 達成','Orders done')+' '+st.contractsDone+'・'+L('失敗','failed')+' '+st.contractsFail+'／'+L('祭り','Festivals')+' '+st.festivals+'・'+L('夜勤','Night shifts')+' '+st.nightShifts+'</div>' +
    '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('島の歩み','Your story')+'</h4><div class="kv">' + (S.story.length ? S.story.slice(-10).map(s=>'Day'+s.d+'：'+N(s.t)).join('<br>') : L('（大きな決断はしなかった）','(No big decisions)')) + '</div>' +
    '<p class="kv" style="color:var(--sub)">'+(next ? L('飛行船の船長「次は<b>'+islName(next)[0]+'</b>へ案内しよう。この島はこのまま残しておくから安心してくれ」','Captain: "Next I’ll take you to the <b>'+islName(next)[1]+'</b>. This island will stay just as you leave it."') : L('飛行船の船長「3つの島を渡りきったな。みごとだ」','Captain: "You have crossed all three islands. Magnificent."'))+'</p>' +
    '<p class="kv">'+L('このあとは：<b>飛行船の改装</b>（新エリア）と<b>『空の遊園地』</b>（建設→暮らし）で観光客を呼べる。','What’s next: <b>refit the airship</b> (New Areas) and build a <b>Sky Fair</b> (Build → Living) to draw tourists.')+'</p>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('このまま島を育てる','Keep building this island')+'</div></button>' +
    (next ? '<button class="opt" data-act="travelMenu:'+next+'"><div class="n">▶ '+L(islName(next)[0]+'へ渡る','Travel to the '+islName(next)[1])+'</div><div class="d">'+L('新エリアからいつでも渡れる','Also available any time from New Areas')+'</div></button>' : '') +
    '<button class="opt" data-act="score"><div class="n">▶ '+L('スコアを見る','See the score')+'</div><div class="d">'+L('島ごと・3島の総合・Xへのポスト','Each island, all three, post on X')+'</div></button>' +
    '<button class="opt" data-act="share"><div class="n">▶ '+L('この島をシェアする','Share this island')+'</div><div class="d">'+L('絵はがき・訪問リンク・Xへのポスト','Postcard, visit link, post on X')+'</div></button>' +
    '<div style="height:14px"></div><button class="opt" data-act="confirmReset"><div class="n">▶ '+L('この島を最初からやり直して別の道を試す','Start this island over and try another path')+'</div><div class="d">'+L('選択が違えば、称号も変わる（今の島は「前のセーブに戻す」で戻せる）','Different choices, different title (you can restore this island later)')+'</div></button></div>');
  $('#modal').hidden = false; sfx('fanfare');
}

/* =========================================================
   動物（島の住人たち）
   ========================================================= */
const critters = [];
const dropMat = new THREE.MeshBasicMaterial({color:0xfffff0});
function makeCritter(type){
  const g = new THREE.Group(); const u = g.userData; u.critter = type;
  if (type === 'rabbit'){
    const c = Math.random() < 0.5 ? 0xf4f0ea : 0xb08a6a;
    g.add(part(G.box, c, 0.11,0.09,0.15, 0,0.06,0)); g.add(part(G.box, c, 0.08,0.08,0.08, 0,0.12,0.08));
    g.add(part(G.box, c, 0.02,0.08,0.02, -0.02,0.19,0.07)); g.add(part(G.box, c, 0.02,0.08,0.02, 0.02,0.19,0.07));
    g.add(part(G.box, 0xffffff, 0.04,0.04,0.04, 0,0.08,-0.08));
  } else if (type === 'sheep'){
    const b = new THREE.Mesh(G.ico1, MT(0xf4f2ec)); b.scale.set(0.13,0.1,0.16); b.position.y = 0.13; b.castShadow = true; g.add(b);
    const head = part(G.box, 0x2a2a2a, 0.07,0.07,0.08, 0,0.15,0.15); g.add(head); u.head = head;
    for (const [x,z] of [[-.06,-.08],[.06,-.08],[-.06,.08],[.06,.08]]) g.add(part(G.box, 0x2a2a2a, 0.025,0.07,0.025, x,0.035,z));
  } else if (type === 'cow'){
    const fluffy = !!S.flags.skycow, body = S.flags.jersey ? 0xc88a50 : fluffy ? 0xe8f4ff : 0xf8f8f4, spot = S.flags.jersey ? 0x9a6030 : fluffy ? 0xb8d0ec : 0x2a2a2a;
    if (fluffy) g.add(part(G.ico1, body, 0.18,0.15,0.24, 0,0.23,0)); else g.add(part(G.box, body, 0.23,0.2,0.36, 0,0.22,0));
    g.add(part(G.box, spot, 0.24,0.11,0.14, 0,0.27,-0.05));
    const head = new THREE.Group(); head.position.set(0,0.3,0.23);
    head.add(part(G.box, body, 0.15,0.15,0.12, 0,0,0)); head.add(part(G.box, 0xf0a8a0, 0.13,0.06,0.05, 0,-0.05,0.07));
    for (const x of [-0.06,0.06]) head.add(part(G.cone4, 0xe8dcb0, 0.02,0.07,0.02, x,0.1,0));
    for (const x of [-0.04,0.04]) head.add(part(G.box, 0x222222, 0.025,0.03,0.02, x,0.02,0.062));
    g.add(head); u.head = head;
    u.udder = part(G.box, 0xf0a0a8, 0.12,0.08,0.12, 0,0.11,-0.05); g.add(u.udder);
    u.drop = new THREE.Group(); u.drop.position.y = 0.68;
    u.drop.add(new THREE.Mesh(G.ico1, dropMat)); u.drop.children[0].scale.set(0.09,0.1,0.09);
    const tip = new THREE.Mesh(G.cone6, dropMat); tip.scale.set(0.075,0.14,0.075); tip.position.y = 0.1; u.drop.add(tip);
    g.add(u.drop);
    const hit = part(G.box, 0, 0.42,0.5,0.5, 0,0.25,0, dropMat); hit.visible = false; g.add(hit);   // 指でも押しやすい当たり判定
    for (const [x,z] of [[-.07,-.12],[.07,-.12],[-.07,.12],[.07,.12]]) g.add(part(G.box, spot, 0.045,0.13,0.045, x,0.065,z));
  } else if (type === 'cat'){
    const c = 0xe8964a;
    g.add(part(G.box, c, 0.07,0.07,0.15, 0,0.07,0)); g.add(part(G.box, c, 0.08,0.07,0.07, 0,0.12,0.09));
    g.add(part(G.cone4, c, 0.02,0.04,0.02, -0.025,0.17,0.09)); g.add(part(G.cone4, c, 0.02,0.04,0.02, 0.025,0.17,0.09));
    const tail = part(G.box, c, 0.02,0.02,0.12, 0,0.12,-0.12); tail.rotation.x = -0.6; g.add(tail); u.tail = tail;
  } else if (type === 'bird'){
    const c = [0x4a7ad0, 0xe0503a, 0xf0c040][Math.floor(Math.random()*3)];
    g.add(part(G.box, c, 0.06,0.05,0.11, 0,0,0));
    const beak = part(G.cone4, 0xf0a030, 0.015,0.04,0.015, 0,0,0.07); beak.rotation.x = Math.PI/2; g.add(beak);
    const wl = part(G.box, c, 0.12,0.01,0.06, -0.08,0.01,0), wr = part(G.box, c, 0.12,0.01,0.06, 0.08,0.01,0); g.add(wl, wr); u.wl = wl; u.wr = wr;
  }
  return g;
}
function landCells(pred){ const r = []; for (let i=0;i<W*W;i++){ const c = S.cells[i]; if (c.t !== 'void' && c.t !== 'b' && c.t !== 'occ' && c.t !== 'rock' && c.t !== 'water' && (!pred || pred(i))) r.push(i); } return r; }
function spawnCritters(){
  const add = (type, n) => { for (let k=0;k<n;k++){ const m = makeCritter(type); const Lc = landCells(); const i = Lc[Math.floor(Math.random()*Lc.length)], p = wpos(i);
    const c = {type, mesh:m, x:p.x, z:p.z, tx:p.x, tz:p.z, t:rnd(0,3), y:0, vy:0, ph:Math.random()*6, a:Math.random()*6, r:rnd(2.5,6), h:rnd(1.8,3)};
    m.position.set(c.x, 0, c.z); scene.add(m); critters.push(c); } };
  add('rabbit', 3); add('sheep', 2); add('cat', 1); add('bird', 4);
}
// 放牧中の牛の見た目（動きは herdStep）
let herdLook = '';
function updateHerd(){
  if (!isDairy || !S.herd) return;
  const look = S.flags.skycow ? 'sky' : S.flags.jersey ? 'jersey' : 'holstein';
  let shown = critters.filter(c => c.type === 'cow');
  if (look !== herdLook || shown.some((c,k) => c.ref !== S.herd[k]) || shown.length > S.herd.length){
    herdLook = look;
    for (const c of shown){ scene.remove(c.mesh); critters.splice(critters.indexOf(c), 1); }
    shown = [];
  }
  while (shown.length < S.herd.length){
    const ref = S.herd[shown.length], m = makeCritter('cow'), c = {type:'cow', mesh:m, ref};
    scene.add(m); critters.push(c); shown.push(c);
  }
}
function poseCow(c){
  const r = c.ref, u = c.mesh.userData;
  c.mesh.position.set(r.x, r.moving ? Math.abs(Math.sin(elapsed*8 + r.name))*0.03 : 0, r.z);
  c.mesh.rotation.y = r.face;
  u.head.position.y = r.eating ? 0.15 + Math.abs(Math.sin(elapsed*5 + r.name))*0.05 : 0.3;
  u.udder.scale.setScalar(0.07 + 0.11*Math.min(1, r.belly/COW.full));
  u.drop.visible = isFull(r);
  u.drop.position.y = 0.66 + Math.sin(elapsed*4 + r.name)*0.06;
}
function updateCritters(dt){
  updateHerd();
  const trees = treeCount(), night = isNight();
  for (const c of critters){
    const m = c.mesh;
    if (c.type === 'bird'){
      m.visible = !night; c.a += dt * 0.5; c.ph += dt*14;
      m.position.set(Math.cos(c.a)*c.r, c.h + Math.sin(c.a*2.3)*0.3, Math.sin(c.a)*c.r); m.rotation.y = -c.a;
      m.userData.wl.rotation.z = Math.sin(c.ph)*0.7; m.userData.wr.rotation.z = -Math.sin(c.ph)*0.7;
      continue;
    }
    if (c.type === 'cow'){ poseCow(c); continue; }
    m.visible = !(c.type === 'rabbit' && trees < 5);   // うさぎは森が減ると姿を見せない
    if (!m.visible || !dt) continue;
    c.vy -= 9*dt; c.y = Math.max(0, c.y + c.vy*dt); if (c.y === 0) c.vy = 0;
    if (night){ m.position.set(c.x, c.y, c.z); continue; }
    c.t -= dt;
    const dx = c.tx - c.x, dz = c.tz - c.z, Ln = Math.hypot(dx, dz), sp = {rabbit:0.9, sheep:0.22, cat:0.45}[c.type];
    if (Ln > 0.03){
      c.x += dx/Ln*Math.min(Ln, sp*dt); c.z += dz/Ln*Math.min(Ln, sp*dt); m.rotation.y = Math.atan2(dx, dz);
      c.ph += dt*10; if (c.type === 'rabbit' && c.y === 0) c.vy = 1.3;
    } else if (c.t <= 0){
      let pool;
      if (c.type === 'rabbit') pool = landCells(i => S.cells.some((d,j)=>d.t==='tree' && cheb(i,j)<=1));
      else if (c.type === 'cat'){ const hs = allB('house'); pool = hs.length ? landCells(i => hs.some(h=>cheb(i,h)<=1)) : landCells(); }
      else pool = landCells(i => S.cells[i].t === 'grass');
      if (!pool.length) pool = landCells();
      const here = cellAt(c.x, c.z), near = pool.filter(i => cheb(i, here) <= 3), pk = near.length ? near : pool;
      const p = wpos(pk[Math.floor(Math.random()*pk.length)]);
      c.tx = p.x + rnd(-.35,.35); c.tz = p.z + rnd(-.35,.35); c.t = rnd(1.5, 5);
    }
    if (c.type === 'sheep') m.userData.head.position.y = Ln > 0.03 ? 0.15 : 0.1 + Math.abs(Math.sin(c.ph*0.3))*0.03;
    if (c.type === 'cat') m.userData.tail.rotation.y = Math.sin(elapsed*3)*0.5;
    m.position.set(c.x, c.y, c.z);
  }
}
// 観光客：着いた飛行船からおりて、遊園地・公園・広場を見物し、夕方に飛行船へ戻る（歩いたところは道になる）
const tourists = []; let tourSpawnDay = -1;
function tourSpots(){
  const r = [];
  for (const i of allB('fun')) for (let k=0;k<3;k++) r.push(bCenter(i));
  for (const i of allB('park')) r.push(bCenter(i));
  for (const i of [...allB('bakery'), ...allB('bath')]) r.push({...bPt(i, {ox:0}), node:bCenter(i)});
  r.push(PLAZA);
  return r;
}
function updateTourists(dt){
  const ph = S.airport ? airPhase() : {st:'away'}, e = dockEdge(), pad = {x:e.x, z:e.z + 1.3}, gate = {x:e.x, z:e.z - 0.25};
  if (ph.st !== 'docked'){ while (tourists.length) scene.remove(tourists.pop().m); }   // 出発した＝全員乗りこんだ
  if (ph.st === 'docked' && !ph.board && S.tourDay === S.day && tourSpawnDay !== S.day && S.day !== S.airFirst){
    tourSpawnDay = S.day;
    const n = Math.min(10, S.tourN || 3);
    for (let k=0;k<n;k++){ const m = makeWorkerMesh('tour'); m.visible = false; scene.add(m); tourists.push({m, x:pad.x + rnd(-.3,.3), z:pad.z + rnd(-.3,.3), from:pad, path:[gate], wait:k*1.2, back:false, ph:Math.random()*6}); }
  }
  for (let q = tourists.length-1; q >= 0; q--){
    const T = tourists[q], u = T.m.userData;
    if (T.wait > 0){ T.wait -= dt; continue; }
    T.m.visible = true;
    if (ph.board && !T.back){ if (T.path.length) T.from = null; T.back = true; T.path = [gate, pad]; T.key = undefined; }
    const tg = T.path[0];
    let mv = false;
    if (tg){
      if (T.key === undefined){ const a = T.from, c = tg.node || tg; T.key = a ? routeKey(a.x, a.z, c.x, c.z) : null; T.len = a ? Math.hypot(c.x - a.x, c.z - a.z) : 1; }
      const dx = tg.x - T.x, dz = tg.z - T.z, Ln = Math.hypot(dx, dz), st = 0.8*dt;
      if (Ln <= st){ T.x = tg.x; T.z = tg.z; T.from = tg.node || tg; T.path.shift(); T.key = undefined; if (!T.path.length) T.wait = T.back ? 0 : rnd(3, 7); }
      else { T.x += dx/Ln*st; T.z += dz/Ln*st; T.m.rotation.y = Math.atan2(dx, dz); T.ph += dt*14; mv = true; if (T.key) wearRoute(T.key, T.len, dt*0.6); }
    } else if (T.back){ scene.remove(T.m); tourists.splice(q, 1); continue; }
    else { const sp = tourSpots(), p = sp[Math.floor(Math.random()*sp.length)]; T.path = [{x:p.x + rnd(-.35,.35), z:p.z + rnd(-.35,.35), node:p.node || p}]; }
    const bob = mv ? Math.abs(Math.sin(T.ph))*0.035 : 0;
    u.body.position.y = 0.13 + bob; u.head.position.y = 0.27 + bob; u.hat.position.y = 0.35 + bob;
    u.legL.position.z = mv ? Math.sin(T.ph)*0.035 : 0; u.legR.position.z = -u.legL.position.z;
    T.m.position.set(T.x, 0, T.z);
  }
}
// 散歩する人：同じ種類の建物をつなぐ道を、用もなく行き来する（家どうしは夜に提灯を持って、ほかは昼）
const strollers = []; let strollT = 0;
function updateStrollers(dt){
  if (!dt) return;
  const h = hourOf(S.time), night = h >= 18.5 && h < 24.5, day = h >= 7 && h < 17.5;
  const es = night || day ? socialEdges.filter(e => e.night === night && e.len >= 1.45) : [];
  const ppl = VISIT ? 6 : workerCount(), want = ppl ? Math.min(6, Math.ceil(es.length*0.8), ppl) : 0;
  strollT -= dt;
  if (strollers.length < want && strollT <= 0){
    strollT = 0.9;
    const e = es[Math.floor(Math.random()*es.length)], ends = [roadEnd(e.p, e.q), roadEnd(e.q, e.p)], [a, b] = Math.random() < 0.5 ? ends : [ends[1], ends[0]];
    const m = makeWorkerMesh('tour'), u = m.userData;
    if (night){ u.carry.material = lampMat(0xffd070); u.carry.scale.set(0.09,0.11,0.09); u.carry.position.set(0.12,0.14,0.05); u.carry.visible = true; }
    scene.add(m); strollers.push({m, x:a.x, z:a.z, path:[b, a], wait:0, ph:Math.random()*6, night, sp:rnd(0.6,0.85)});
  }
  for (let k = strollers.length-1; k >= 0; k--){
    const T = strollers[k], u = T.m.userData, tg = T.path[0];
    if (!tg || (T.night ? !night : !day)){ scene.remove(T.m); strollers.splice(k, 1); continue; }
    let mv = false;
    if (T.wait > 0) T.wait -= dt;
    else {
      const dx = tg.x - T.x, dz = tg.z - T.z, Ln = Math.hypot(dx, dz), st = T.sp*dt;
      if (Ln <= st){ T.x = tg.x; T.z = tg.z; T.path.shift(); T.wait = rnd(1, 3); }
      else { T.x += dx/Ln*st; T.z += dz/Ln*st; T.m.rotation.y = Math.atan2(dx, dz); T.ph += dt*13; mv = true; }
    }
    const bob = mv ? Math.abs(Math.sin(T.ph))*0.035 : 0;
    u.body.position.y = 0.13 + bob; u.head.position.y = 0.27 + bob; u.hat.position.y = 0.35 + bob;
    u.legL.position.z = mv ? Math.sin(T.ph)*0.035 : 0; u.legR.position.z = -u.legL.position.z;
    T.m.position.set(T.x, 0, T.z);
  }
}
let petCool = 0;
function critterAt(){
  const hits = raycaster.intersectObjects(critters.filter(c=>c.mesh.visible).map(c=>c.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object; while (o && !o.userData.critter) o = o.parent;
  return critters.find(c => c.mesh === o) || null;
}
function petCritter(c){
  if (c.ref){
    if (!VISIT && milkByHand(c.ref)) return;
    const r = c.ref; popAt(r.x, 0.8, r.z, N(COW_NAMES[r.name])+'　'+L('乳 ','Milk ')+r.belly+'/'+COW.full);
  }
  const say = {rabbit:L('ぴょん！','Hop!'), sheep:L('メェ〜','Baa~'), cat:L('にゃー','Meow'), cow:L('モォ〜','Moo~'), bird:L('ピピッ','Tweet!')}[c.type];
  const p = c.mesh.position; popAt(p.x, p.y + 0.5, p.z, say); c.vy = 2.2; c.t = 0; if (c.type === 'bird') c.h += 0.4;
  sfx('pet'); S.stats.pets++;
  if (performance.now() > petCool){ petCool = performance.now() + 20000; addMood(1); }
}

/* =========================================================
   演出（パーティクル・花火・ポップアップ・音）
   ========================================================= */
const parts = []; const PART_MAX = 90;
const partGeo = {log:G.cyl6, coin:G.cyl, stone:G.dod, leaf:G.box};
function burst(x, y, z, kind, n, col){
  for (let k=0;k<n;k++){
    let p = parts.find(p=>!p.alive);
    if (!p){ if (parts.length >= PART_MAX) return; p = {mesh:new THREE.Mesh(G.box, MT(0xffffff)), alive:false}; p.mesh.castShadow = true; scene.add(p.mesh); parts.push(p); }
    const m = p.mesh; m.geometry = partGeo[kind] || G.box; m.visible = true;
    const sc = {log:[0.05,0.18,0.05], coin:[0.08,0.025,0.08], stone:[0.06,0.06,0.06], leaf:[0.07,0.07,0.07]}[kind] || [0.07,0.07,0.07];
    m.material = MT(col ?? ({log:0x9a6a3a, coin:0xffd040, stone:0xa8aeb8, leaf:0x46ad5c}[kind] || 0xffffff));
    p.sc = sc; m.scale.set(...sc); m.position.set(x, y, z);
    p.vx = rnd(-1.4,1.4); p.vz = rnd(-1.4,1.4); p.vy = rnd(2.4,4.2); p.rx = rnd(-10,10); p.rz = rnd(-10,10); p.life = 1.1; p.alive = true;
  }
}
function coinBurst(n){ const p = wpos(WH); burst(p.x, 0.7, p.z, 'coin', n); }
const sparks = [], sparkMats = {};
function firework(){
  const x = rnd(-4,4), y = rnd(4.5,6.5), z = rnd(-4,4), hex = [0xff5a5a,0xffd35a,0x7ee0ff,0x9aff7a,0xff9af0][Math.floor(Math.random()*5)];
  const mat = sparkMats[hex] || (sparkMats[hex] = new THREE.MeshBasicMaterial({color:hex}));
  for (let k=0;k<16;k++){
    let p = sparks.find(p=>!p.alive);
    if (!p){ if (sparks.length >= 96) break; p = {mesh:new THREE.Mesh(G.box, mat)}; scene.add(p.mesh); sparks.push(p); }
    const a = k/16*Math.PI*2, e = rnd(-0.6,0.9), sp = rnd(1.6,2.4);
    p.mesh.material = mat; p.alive = true; p.life = 1.3; p.mesh.visible = true; p.mesh.position.set(x,y,z); p.mesh.scale.setScalar(0.07);
    p.vx = Math.cos(a)*Math.cos(e)*sp; p.vy = Math.sin(e)*sp; p.vz = Math.sin(a)*Math.cos(e)*sp;
  }
  sfx('fw');
}
const puffs = [];
function puff(x, y, z){
  let p = puffs.find(p=>!p.alive);
  if (!p){ if (puffs.length > 40) return; p = {mesh:new THREE.Mesh(G.ico, MT(0xe8e8f0))}; scene.add(p.mesh); puffs.push(p); }
  p.alive = true; p.life = 2.2; p.mesh.visible = true; p.mesh.position.set(x + rnd(-.03,.03), y, z); p.mesh.scale.setScalar(0.05);
}
function updateFx(dt){
  for (const p of parts) if (p.alive){
    p.life -= dt; const m = p.mesh;
    p.vy -= 11*dt; m.position.x += p.vx*dt; m.position.y += p.vy*dt; m.position.z += p.vz*dt;
    m.rotation.x += p.rx*dt; m.rotation.z += p.rz*dt;
    if (m.position.y < 0.03 && m.position.y > -0.2 && Math.abs(m.position.x) < W/2 && Math.abs(m.position.z) < W/2 && S.cells[cellAt(m.position.x, m.position.z)].t !== 'void'){ m.position.y = 0.03; p.vy *= -0.45; p.vx *= 0.6; p.vz *= 0.6; p.rx *= 0.5; p.rz *= 0.5; }
    const s = p.life < 0.25 ? p.life/0.25 : 1; m.scale.set(p.sc[0]*s, p.sc[1]*s, p.sc[2]*s);
    if (p.life <= 0){ p.alive = false; m.visible = false; }
  }
  for (const p of sparks) if (p.alive){
    p.life -= dt; const m = p.mesh; p.vy -= 1.6*dt; p.vx *= 0.985; p.vz *= 0.985;
    m.position.x += p.vx*dt; m.position.y += p.vy*dt; m.position.z += p.vz*dt; m.scale.setScalar(0.07 * Math.min(1, p.life/0.5));
    if (p.life <= 0){ p.alive = false; m.visible = false; }
  }
  for (const p of puffs) if (p.alive){
    p.life -= dt; const m = p.mesh; m.position.y += dt*0.35; m.position.x += dt*0.12;
    const a = 1 - p.life/2.2; m.scale.setScalar(0.05 + a*0.12 * (p.life < 0.5 ? p.life/0.5 : 1));
    if (p.life <= 0){ p.alive = false; m.visible = false; }
  }
}
const popPool = [], popsEl = $('#pops');
function popAt(x, y, z, text, cls=''){
  let p = popPool.find(p=>!p.alive);
  if (!p){ if (popPool.length > 30) return; const el = document.createElement('div'); el.className = 'pop'; popsEl.appendChild(el); p = {el}; popPool.push(p); }
  p.alive = true; p.life = 1.0; p.v = new THREE.Vector3(x, y, z); p.el.innerHTML = gfix(text); p.el.className = 'pop ' + cls; p.el.style.display = 'block';
}
const _v = new THREE.Vector3();
function toScreen(x, y, z){ _v.set(x, y, z).project(cam); return [(_v.x+1)/2*innerWidth, (1-_v.y)/2*innerHeight]; }
function updatePops(dt){
  for (const p of popPool) if (p.alive){
    p.life -= dt; p.v.y += dt*0.9;
    const [sx, sy] = toScreen(p.v.x, p.v.y, p.v.z), t = 1 - p.life, s = t < 0.12 ? 0.6 + t/0.12*0.6 : t < 0.2 ? 1.2 - (t-0.12)/0.08*0.2 : 1;
    p.el.style.left = sx + 'px'; p.el.style.top = sy + 'px';
    p.el.style.transform = 'translate(-50%,-50%) scale('+s+')'; p.el.style.opacity = p.life < 0.3 ? p.life/0.3 : 1;
    if (p.life <= 0){ p.alive = false; p.el.style.display = 'none'; }
  }
}
function shake(v){ if (SET.shake) camS.shake = Math.max(camS.shake, v); }
let AC = null; const sfxLast = {};
function sfx(type){
  if (!SET.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const now = AC.currentTime; if (sfxLast[type] && now - sfxLast[type] < 0.05) return; sfxLast[type] = now;
    const tone = (f, t0, dur, wave='square', vol=0.06, f2) => {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = wave; o.frequency.setValueAtTime(f, now+t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, now+t0+dur);
      g.gain.setValueAtTime(vol, now+t0); g.gain.exponentialRampToValueAtTime(0.0001, now+t0+dur);
      o.connect(g).connect(AC.destination); o.start(now+t0); o.stop(now+t0+dur+0.02);
    };
    const noise = (t0, dur, vol=0.12, hp=800) => {
      const len = Math.floor(AC.sampleRate*dur), buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
      for (let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
      const s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
      s.buffer = buf; g.gain.value = vol; s.connect(f).connect(g).connect(AC.destination); s.start(now+t0);
    };
    if (type==='chop'){ noise(0, 0.07, 0.25, 600); tone(220, 0, 0.08, 'square', 0.07, 90); }
    else if (type==='rock'){ noise(0, 0.06, 0.2, 1800); tone(140, 0, 0.07, 'square', 0.06, 70); }
    else if (type==='coin'){ tone(988, 0, 0.06, 'square', 0.05); tone(1319, 0.06, 0.16, 'square', 0.05); }
    else if (type==='coinS'){ tone(1319, 0, 0.05, 'square', 0.025); }
    else if (type==='build'){ noise(0, 0.15, 0.2, 200); tone(160, 0, 0.18, 'triangle', 0.15, 60); }
    else if (type==='hire'){ tone(523, 0, 0.06); tone(784, 0.07, 0.1); }
    else if (type==='ui'){ tone(660, 0, 0.04, 'square', 0.03); }
    else if (type==='pet'){ tone(1047, 0, 0.05, 'triangle', 0.06); tone(1568, 0.05, 0.08, 'triangle', 0.05); }
    else if (type==='fw'){ tone(80, 0, 0.35, 'sine', 0.035, 40); }
    else if (type==='event'){ [523,659,784,1047].forEach((f,k)=>tone(f, k*0.08, 0.12, 'square', 0.04)); }
    else if (type==='fanfare'){ [784,988,1175,1568].forEach((f,k)=>tone(f, k*0.07, 0.14, 'square', 0.045)); }
  } catch(e){}
}

// 祭りばやし（ヨナ抜き音階の笛と太鼓。音は小さめ）
const FEST_MEL = [7,-1,9,7, 5,-1,2,-1, 0,2,5,-1, 7,-1,-1,-1, 9,-1,12,9, 7,-1,5,7, 9,7,5,2, 0,-1,-1,-1];
let musicNext = 0, musicStep = 0;
function musicTick(){
  if (!SET.sound || !AC) return;
  try {
    const now = AC.currentTime; if (musicNext < now) musicNext = now + 0.05;
    while (musicNext < now + 0.3){
      const t0 = musicNext, st = musicStep++ % FEST_MEL.length, n = FEST_MEL[st];
      if (n >= 0){ const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(587.33*Math.pow(2, n/12), t0);
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.03, t0+0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0+0.36); o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0+0.4); }
      if (st % 4 === 0 || st % 8 === 7){ const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(48, t0+0.25);
        g.gain.setValueAtTime(st % 8 === 0 ? 0.09 : 0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0+0.3); o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0+0.35); }
      musicNext += 0.22;
    }
  } catch(e){}
}

/* =========================================================
   昼夜と光
   ========================================================= */
const SKY = {day:[new THREE.Color(0x5fb4f0),new THREE.Color(0xd2f0ff)], dusk:[new THREE.Color(0x5a4a9a),new THREE.Color(0xffa070)], night:[new THREE.Color(0x070a24),new THREE.Color(0x1c2350)]};
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const HAZE_C = new THREE.Color(0x7a6a5c);
let nightAmt = 0;
// 夜の明かり：どの建物も「窓の灯り＋足もとの光だまり」で同じように光る。色と大きさ、ランタンの形で個性を出す。
// 点光源（8個）は種類ではなく島全体にばらけるように配る（隅の家だけ暗い、ということがないように）
const LSTYLE = {
  warehouse:{c:0xffd070, r:1.25}, house:{c:0xffc860, r:1.05}, camp:{c:0xffa040, r:1.0}, quarry:{c:0xffc060, r:0.9}, forester:{c:0xd8ff90, r:0.8},
  sawmill:{c:0xffb860, r:0.9}, workshop:{c:0xffe0a0, r:1.0}, smelter:{c:0xff6a30, r:1.25}, factory:{c:0xe0f0ff, r:1.15}, recycle:{c:0xa8ffa0, r:1.0},
  mower:{c:0xffc050, r:1.0}, saltpit:{c:0xffa0c0, r:0.9}, seeder:{c:0xd8ff90, r:0.8}, barn:{c:0xffb060, r:1.15},
  churn:{c:0xffe880, r:1.0}, creamery:{c:0xd8f0ff, r:1.1}, cellar:{c:0xff9040, r:1.0},
  farmhut:{c:0xffc860, r:1.0}, windmill:{c:0xfff0c0, r:1.1}, picklery:{c:0xff9a40, r:1.0}, patisserie:{c:0xff90b8, r:1.1}, brewery:{c:0xff7050, r:1.15},
  bakery:{c:0xff9a50, r:1.15}, park:{c:0xffe8b0, r:1.6}, bath:{c:0xff7a5a, r:1.15}, fun:{c:0xffb0e8, r:1.7},
};
function assignLights(){
  regroup();
  const cand = allB();
  const m4 = new THREE.Matrix4(), col = new THREE.Color(); let ng = 0;
  for (const i of cand){
    if (ng >= 160) break;
    const t = S.cells[i].b.type, st = LSTYLE[t] || {c:0xffc070, r:1}, p = bCenter(i), k = bSize(i), o = CM[i]?.userData.light || [0,0.5,0.4];
    m4.makeScale(st.r, 1, st.r).setPosition(p.x + o[0]*0.6, 0.012, p.z + clamp(o[2], -0.45*k, 0.45*k)); glowMesh.setMatrixAt(ng, m4); glowMesh.setColorAt(ng, col.set(st.c)); ng++;
  }
  glowMesh.count = ng; glowMesh.instanceMatrix.needsUpdate = true; if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  // 点光源：まず火のある製鉄所（なければ市場）、あとは今ある光からいちばん遠い建物を順に
  const pts = cand.map(i => ({i, p:bCenter(i)})), picked = [];
  const first = pts.find(q => S.cells[q.i].b.type === 'smelter') || pts.find(q => q.i === WH) || pts[0];
  if (first) picked.push(first);
  while (picked.length < LIGHT_N && picked.length < pts.length){
    let best = null, bd = -1;
    for (const q of pts){ if (picked.includes(q)) continue; const d = Math.min(...picked.map(r => Math.hypot(r.p.x - q.p.x, r.p.z - q.p.z))); if (d > bd){ bd = d; best = q; } }
    picked.push(best);
  }
  lightPool.forEach((Lp,k)=>{
    const q = picked[k]; Lp.cell = q ? q.i : -1;
    if (!q){ Lp.l.position.set(0,-10,0); return; }
    const o = CM[q.i]?.userData.light || [0,0.5,0.5], t = S.cells[q.i].b.type;
    Lp.l.position.set(q.p.x + o[0], o[1], q.p.z + o[2]); Lp.fire = !!CM[q.i]?.userData.fire;
    Lp.l.color.set(Lp.fire ? 0xff7a30 : (LSTYLE[t]?.c ?? 0xffc070)); Lp.l.distance = 2.6 * (bSize(q.i) > 1 ? 1.5 : 1);
  });
}
function updateDayNight(t){
  const h = hourOf(S.time);
  nightAmt = h < 5 ? 1 : h < 6.2 ? 1 - (h-5)/1.2 : h < 17.8 ? 0 : h < 19.2 ? (h-17.8)/1.4 : 1;
  const duskAmt = h >= 5 && h < 7 ? 1 - Math.abs(h-5.8)/1.2 : h > 16.5 && h < 19.5 ? 1 - Math.abs(h-18.2)/1.3 : 0;
  if (h >= 5 && h <= 19){
    const a = (h-5)/14*Math.PI, el = Math.sin(a);
    sun.position.set(Math.cos(a)*14, Math.max(1.5, el*16), 6);
    sun.color.setHSL(0.09, 0.9, 0.5 + 0.45*Math.min(1, el*1.8));
    sun.intensity = 2.8 * clamp(el*2.2, 0, 1) + 0.25*nightAmt;
  } else { sun.position.set(-6, 14, -8); sun.color.set(0x8a9aff); sun.intensity = 0.45; }
  sun.target.position.set(0,0,0);
  hemi.intensity = 1.15 - 0.6*nightAmt;
  hemi.color.set(0xbfe3ff).lerp(_c1.set(0x3a4a90), nightAmt);
  _c1.copy(SKY.day[0]).lerp(SKY.night[0], nightAmt).lerp(SKY.dusk[0], Math.max(0,duskAmt)*0.7);
  _c2.copy(SKY.day[1]).lerp(SKY.night[1], nightAmt).lerp(SKY.dusk[1], Math.max(0,duskAmt)*0.85);
  if (S.drive === 3){ const haze = 0.36*(1 - nightAmt); _c1.lerp(HAZE_C, haze); _c2.lerp(HAZE_C, haze); }
  postMat.uniforms.skyTop.value.copy(_c1); postMat.uniforms.skyBot.value.copy(_c2);
  postMat.uniforms.night.value = nightAmt; postMat.uniforms.time.value = t; postMat.uniforms.yaw.value = camS.yaw;
  // 流れ星：ふだんはまれに1つ。「流れ星の夜」は空いっぱいに、長く明るく何本も流れる
  const shower = S.meteorNight === S.day && nightAmt > 0.4;
  postMat.uniforms.mLen.value = shower ? 52 : 28;
  for (const mt of postMat.uniforms.meteor.value){
    if (mt.w < 1){ mt.w += 1/60 * (shower ? 1.1 : 1.4); continue; }
    if (nightAmt > 0.4 && Math.random() < (shower ? 0.03 : 0.00025)) mt.set(rnd(0.1,0.95), rnd(0.6,0.98), Math.PI + rnd(0.3,0.8), 0);
  }
  winMat.emissiveIntensity = nightAmt * 1.6; glowMat.opacity = nightAmt * 0.62;
  for (const m of lampMats) m.color.copy(m.userData.base).multiplyScalar(0.32 + 0.68*nightAmt);
  fireMat.emissiveIntensity = 0.6 + nightAmt*1.2 + Math.sin(t*9)*0.15;
  for (const Lp of lightPool) Lp.l.intensity = Lp.cell < 0 ? 0 : nightAmt * (Lp.fire ? 2.2 + Math.sin(t*11)*0.4 : 1.4);
}

/* =========================================================
   入力：マウスは左ドラッグで回転・右ドラッグで移動、スマホは1本指で移動・2本指で拡大と回転
   ========================================================= */
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let mouseIn = false, mx = 0, my = 0, drag = null, hoverCell = -1, selCell = -1, hitStop = 0;
let mode = null, ghost = null, pending = -1;   // mode = {kind:'build', type} | {kind:'move', from}
const pointers = new Map();
const cvs = renderer.domElement;
function panBy(dx, dy){
  const h = Math.max(13, 16 / (innerWidth/innerHeight)) / camS.zoom, k = h / innerHeight;
  const rx = Math.cos(camS.yaw), rz = -Math.sin(camS.yaw), fx = -Math.sin(camS.yaw), fz = -Math.cos(camS.yaw);
  camS.tx = clamp(camS.tx - rx*dx*k + fx*dy*k/Math.sin(camS.pitch), -7, 7);
  camS.tz = clamp(camS.tz - rz*dx*k + fz*dy*k/Math.sin(camS.pitch), -7, 7);
}
cvs.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pointers.size === 2){ const [a,b] = [...pointers.values()]; drag = {two:true, dist:Math.hypot(a.x-b.x, a.y-b.y), ang:Math.atan2(b.y-a.y, b.x-a.x), z:camS.tzoom, yaw:camS.tyaw, moved:true}; return; }
  drag = {x:e.clientX, y:e.clientY, lx:e.clientX, ly:e.clientY, moved:false, yaw:camS.tyaw, btn:e.button, touch:e.pointerType === 'touch'};
  cvs.setPointerCapture(e.pointerId);
});
cvs.addEventListener('pointermove', e => {
  mx = e.clientX; my = e.clientY; mouseIn = e.pointerType !== 'touch';
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (drag && drag.two && pointers.size === 2){
    const [a,b] = [...pointers.values()];
    camS.tzoom = clamp(drag.z * Math.hypot(a.x-b.x, a.y-b.y) / drag.dist, 0.45, 2.8);
    camS.tyaw = drag.yaw - (Math.atan2(b.y-a.y, b.x-a.x) - drag.ang);
    return;
  }
  if (drag && !drag.two){
    if (Math.abs(e.clientX - drag.x) > 8 || Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
    if (drag.moved){
      if (drag.touch || drag.btn === 2 || drag.btn === 1) panBy(e.clientX - drag.lx, e.clientY - drag.ly);
      else camS.tyaw = drag.yaw - (e.clientX - drag.x) * 0.008;
    }
    drag.lx = e.clientX; drag.ly = e.clientY;
  }
});
cvs.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && !drag.two){
    if (e.button === 2) cancelMode();
    else { mx = e.clientX; my = e.clientY; const i = pick(); const cr = mode ? null : critterAt(); if (cr) petCritter(cr); else onClickCell(i, e.pointerType === 'touch'); }
  }
  if (!pointers.size) drag = null;
});
cvs.addEventListener('pointerleave', () => { mouseIn = false; });
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('wheel', e => { e.preventDefault(); camS.tzoom = clamp(camS.tzoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.45, 2.8); }, {passive:false});
const keys = {};
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;          // 名前の入力中にカメラを動かさない
  keys[e.key] = true;
  if (e.key === 'Escape'){ if (mode) cancelMode(); else { closePanel(); select(-1); } }
  if (DEBUG && e.key === 'F8'){ S.gold += 5000; }
});
addEventListener('keyup', e => { keys[e.key] = false; });
const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0), _gp = new THREE.Vector3();
function pick(){
  mouse.set(mx/innerWidth*2-1, -(my/innerHeight)*2+1);
  raycaster.setFromCamera(mouse, cam);
  if (mode){
    // 木や若木は、上の方を押してもその木のマスを選ぶ（1つ奥のマスにずれない）
    const h = raycaster.intersectObjects(pickables, true)[0];
    if (h){ let o = h.object; while (o && o.userData.cell === undefined) o = o.parent; if (o && ['tree','sapling'].includes(S.cells[o.userData.cell].t)) return o.userData.cell; }
  } else {
    for (const h of raycaster.intersectObjects(pickables, true)){
      let o = h.object; while (o && o.userData.cell === undefined) o = o.parent;
      if (o) return o.userData.cell;
    }
  }
  if (raycaster.ray.intersectPlane(groundPlane, _gp)){
    const x = Math.floor(_gp.x + W/2), z = Math.floor(_gp.z + W/2);
    if (x >= 0 && x < W && z >= 0 && z < W && S.cells[z*W + x].t !== 'void') return mode ? z*W + x : ownerOf(z*W + x);
  }
  return -1;
}
const modeSize = () => mode.kind === 'bell' || mode.kind === 'tool' ? 1 : mode.kind === 'build' ? BUILD[mode.type].size || 1 : bSize(mode.from);
function modeWhy(i){ if (mode.kind === 'bell') return ''; if (mode.kind === 'tool') return toolWhy(mode.tool, i); return mode.kind === 'build' ? canPlace(mode.type, i) : moveWhy(mode.from, i); }
function doMode(i){
  const why = modeWhy(i); if (why){ toast(why, 'bad'); sfx('ui'); return; }
  if (mode.kind === 'bell'){ setBell(i); cancelMode(); return; }
  if (mode.kind === 'tool'){ useTool(mode.tool, i); return; }          // 続けて何マスでも置ける
  if (mode.kind === 'build'){ const t = mode.type; place(t, i); if (!keys.Shift) cancelMode(); select(i); }
  else { moveBuilding(mode.from, i); cancelMode(); }
}
function onClickCell(i, touch){
  if (VISIT) return;
  if (mode){
    if (i < 0) return;
    if (touch && mode.kind === 'tool'){ pending = -1; doMode(i); return; }          // 田畑と川は確認なしで次々に
    if (touch){ pending = i; showConfirm(); return; }   // スマホは「置く場所を選ぶ → ✓で決定」の2段階
    doMode(i); return;
  }
  if (i < 0){ select(-1); return; }
  if (!clickCell(i)) select(-1);
}
function showConfirm(){
  const el = $('#confirm'); el.style.display = 'flex';
  $('#confirmTxt').textContent = mode.kind === 'bell' ? L('ここへ群れを導く？','Lead the herd here?') : mode.kind === 'build' ? L('ここに建てる？','Build here?') : L('ここへ移動？','Move here?');
}
function cancelMode(){ document.body.classList.remove('placing', 'tooling'); mode = null; pending = -1; if (ghost){ scene.remove(ghost); ghost = null; } $('#tip').style.display = 'none'; $('#confirm').style.display = 'none'; }
function startMode(m){
  cancelMode(); closePanel(); mode = m; document.body.classList.add('placing');
  if (m.kind === 'tool'){
    select(-1); document.body.classList.add('tooling');
    ghost = new THREE.Group(); ghost.add(part(G.box, 0, 0.5,0.06,0.5, 0,0.03,0));
    ghost.traverse(o=>{ if (o.isMesh){ o.material = ghostOk; o.castShadow = false; }});
    ghost.visible = false; scene.add(ghost);
    const nm = m.tool === 'clear' ? L('更地に戻す','Clear') : N(CROPS[m.tool].n);
    $('#confirm').style.display = 'flex'; $('#confirmTxt').textContent = nm + L('：続けてタップ',': keep tapping');
    return;
  }
  if (m.kind === 'bell'){
    select(-1);
    ghost = bellModel();
    ghost.traverse(o=>{ if (o.isMesh){ o.material = ghostOk; o.castShadow = false; }});
    ghost.visible = false; scene.add(ghost);
    toast(L('鐘を置く場所を選ぶ（まわり5×5マスで放牧）','Choose a spot for the bell (cows graze the 5×5 around it)'));
    return;
  }
  const type = m.kind === 'build' ? m.type : S.cells[m.from].b.type;
  ghost = makeBuilding(type, 0.5, m.kind === 'move' ? S.cells[m.from].b : null);
  ghost.userData.scaffold.visible = false;
  ghost.traverse(o=>{ if (o.isMesh){ o.material = ghostOk; o.castShadow = false; }});
  ghost.visible = false; scene.add(ghost);
  if (m.kind === 'move') select(-1);
  toast(m.kind === 'build' ? L(N(BUILD[type].n)+'：置きたい場所を選ぶ', N(BUILD[type].n)+': choose a spot') : L('移動先を選ぶ（'+P.moveCost+'G・'+P.moveTime+'秒ほど止まる）','Choose a new spot ('+P.moveCost+'G, pauses ~'+P.moveTime+'s)'));
}
function bellInfo(i){
  let n = 0, cl = 0, mud = 0, rest = 0;
  for (let j=0;j<W*W;j++) if (cheb(i,j) <= COW.ring){ const c = S.cells[j]; if (c.t === 'tree'){ n++; if (c.clover) cl++; } else if (c.t === 'grass' && S.soil[j]){ if (isMud(j)) mud++; else rest++; } }
  const bs = allB('barn'), dist = bs.length ? Math.min(...bs.map(b => cheb(i,b))) : -1;
  return '<b>'+L('放牧の鐘','Grazing bell')+'</b><div class="kv">' + (n ? '<span class="g">'+L('食べられる草 ','Grass to graze ')+n+(cl ? L('（クローバー '+cl+'）',' (clover '+cl+')') : '')+'</span>' : '<span class="r">'+L('食べられる草がない','Nothing to graze')+'</span>') +
    (rest ? '<br><span class="r">'+L('休ませ中の食べ跡 '+rest+'（輪に入れると生えない）','Resting patches '+rest+' (no regrowth inside the ring)')+'</span>' : '') +
    (mud ? '<br><span class="r">'+L('泥地 ','Mud ')+mud+'</span>' : '') +
    (dist >= 0 ? '<br>'+(dist <= 3 ? '<span class="g">' : dist >= 6 ? '<span class="r">' : '<span>')+L('牛舎まで ','Barn distance ')+dist+'</span>' : '') + '</div>';
}
function placementInfo(i){
  if (mode.kind === 'bell') return bellInfo(i);
  if (mode.kind === 'tool') return toolInfo(i);
  const type = mode.kind === 'build' ? mode.type : S.cells[mode.from].b.type, d = BUILD[type], Lst = [];
  const why = modeWhy(i); if (why) Lst.push('<span class="r">× '+why+'</span>');
  const planned = footCells(i, mode.kind === 'build' ? d.size || 1 : bSize(mode.from)).filter(j => j < W*W).map(j => S.cells[j].t);
  if (isFarm && (planned.includes('sapling') || planned.includes('tree'))) Lst.push(L('田畑をつぶして建てる','The field will be built over'));
  else if (planned.includes('sapling')) Lst.push('<span class="g">'+(ISL.tree === 'log' ? L('若木は抜いて建てられる（丸太は増えない）','Saplings are simply cleared (no logs)') : L('芽は抜いて建てられる（干し草は増えない）','Sprouts are simply cleared (no hay)'))+'</span>');
  if (!isFarm && planned.includes('tree')) Lst.push(ISL.tree === 'log' ? L('木を伐って建てる','The tree will be cut') : L('牧草を刈って建てる','The grass will be cut'));
  if (d.partner && neigh8(i).some(j=>isB(j, d.partner))) Lst.push('<span class="g">'+L('隣接ボーナス：速い','Neighbor bonus: faster')+'</span>');
  if (d.ind && neigh8(i).some(j=>S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.near)) Lst.push('<span class="r">'+L('隣の家がうるさがる','Noisy for the neighbors')+'</span>');
  if (d.near && neigh8(i).some(j=>S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.ind)) Lst.push('<span class="r">'+L('工場の隣はうるさい','Factory next door is noisy')+'</span>');
  const nearCount = kind => S.cells.filter((c,j)=>c.t===kind && cheb(i,j)<=P.farFrom).length;
  if (d.job === 'chop'){ const n = nearCount('tree') + (isFarm ? nearCount('sapling') : 0); Lst.push((n>=8?'<span class="g">':n<4?'<span class="r">':'<span>')+L('近くの'+ISL.treeN[0]+' ','Nearby '+ISL.treeN[1]+' ')+n+'</span>'); }
  if (d.job === 'quarry' && !S.flags.mine){ const n = nearCount('rock'); Lst.push((n>=2?'<span class="g">':'<span class="r">')+L('近くの岩 ','Nearby rocks ')+n+'</span>'); }
  if (!d.near && !d.plant && type !== 'fun'){ const dist = cheb(i, WH); Lst.push(dist <= 3 ? '<span class="g">'+L('市場に近い','Close to the market')+'</span>' : dist >= 6 ? '<span class="r">'+L('市場から遠い（運ぶのがとても遅い）','Far from the market (slow hauling)')+'</span>' : L('市場まで ','Market distance ')+dist); }
  return '<b>'+N(d.n)+'</b>　'+(mode.kind === 'build' ? costTxt(buildCost(type)) : L('移動：','Move: ')+P.moveCost+'G')+'<div class="kv">'+Lst.join('<br>')+'</div>';
}

/* =========================================================
   UI
   ========================================================= */
const panelEl = $('#panel'), bpanelEl = $('#bpanel');
let panelName = null, buildTab = isFarm ? 'field' : 'res', lastPanelHTML = '', lastBHTML = '';
function openPanel(n){ if (panelName === n){ closePanel(); return; } panelName = n; panelEl.hidden = false; document.body.classList.add('panel-open'); lastPanelHTML = ''; renderPanel(); }
function closePanel(){ panelName = null; panelEl.hidden = true; document.body.classList.remove('panel-open'); }
function select(i){ selCell = i; document.body.classList.toggle('bpanel-open', i >= 0); bpanelEl.hidden = i < 0; lastBHTML = ''; if (i >= 0) renderBPanel(); }
function setHTML(el, html, key){ if (key === 'p' ? html === lastPanelHTML : html === lastBHTML) return; el.innerHTML = gfix(html); if (key === 'p') lastPanelHTML = html; else lastBHTML = html; }
function neighborHTML(){
  return ISL_ORDER.filter(to => to !== ISLAND).map(to => {
    const ok = canTravel(to), been = !!saveBox.islands[to], before = ISL_ORDER[ISL_ORDER.indexOf(to)-1];
    const what = {sky:L('森と鉱石','Forest and ore'), dairy:L('放牧','Grazing'), farm:L('川と四季','River and seasons')}[to];
    const note = !ok ? L(islName(before)[0]+'で空港を開くと渡れる','Open an airport on the '+islName(before)[1]+' to travel there')
      : been ? L('今の島はこのまま残り、いつでも行き来できる','This island stays as it is, and you can come back any time')
      : L('350G・住民0人からの新しい島。この島はこのまま残り、いつでも戻れる','A fresh island: 350G and no residents. This island stays, and you can return any time');
    return '<div class="row"><span class="grow">'+N(islName(to))+'<small style="color:var(--sub)">　'+what+'</small><br><small>'+note+'</small></span><button class="btn hot w" data-act="travelMenu:'+to+'" '+(ok?'':'disabled')+'>'+(been ? L('行く','Go') : L('渡る','Travel'))+'</button></div>';
  }).join('');
}
function fieldHTML(){
  const winter = season() === 3;
  const opt = (k, nm, c, d, ok) => '<button class="opt" data-act="tool:'+k+'" '+(ok ? '' : 'disabled')+'><div class="n">'+nm+'</div><div class="c">'+(c ? c+'G' : L('無料','free'))+'</div><div class="d">'+d+'</div></button>';
  const mark = v => v >= 1.2 ? '◎' : v >= 1 ? '○' : v ? '△' : '×';
  return '<div class="kv" style="margin-bottom:6px">'+farmLine()+'<br>'+(winter ? '<span class="r">'+L('冬は植えられない。春になったら種をまこう','You can’t plant in winter. Sow when spring comes')+'</span>' : L('選んでから地面をタップ。空き地を直接タップしてもまける','Pick one, then tap the ground. You can also tap open ground directly'))+'</div><div class="seeds" style="margin:0 0 6px">'+wheelHTML()+'</div><div class="grid">' +
    CROP_KEYS.map(k => opt(k, N(CROPS[k].n), CROPS[k].seed, N(CROPS[k].d)+'<br>'+SEASONS.map((n, q) => '<span class="'+(CROPS[k].s[q] >= 1.2 ? 'g' : CROPS[k].s[q] ? '' : 'r')+'">'+N(n)+mark(CROPS[k].s[q])+'</span>').join(' '), !winter && S.gold >= CROPS[k].seed)).join('') +
    opt('clear', L('更地に戻す','Clear'), 0, L('田畑をなくす','Remove fields'), true) + '</div>';
}
function driveHTML(){
  if (S.tut >= 0) return '';
  const cur = S.drive || 0, locked = S.driveDay === S.day;
  return '<h4 style="color:var(--hi);font-weight:normal;margin:12px 0 4px">'+L('もうけ第一：幸福と引きかえ','Profit first: paid in happiness')+'</h4>' +
    '<div class="kv" style="color:var(--sub);margin-bottom:6px">'+(locked ? L('今日はもう変えた。明日また変えられる','Already changed today. Try again tomorrow') : L('1日1回変えられる。きつくすると幸福はすぐ下がり、ゆるめても少しずつしか戻らない。幸福が20を切ると住民が島を去る','Change once a day. Pushing harder lowers happiness at once; easing off recovers it slowly. Below 20, residents leave'))+'</div><div class="grid">' +
    DRIVE.map((D, k) => '<button class="opt" data-act="drive:'+k+'" '+(k === cur || locked ? 'disabled' : '')+'><div class="n">'+(k === cur ? '● ' : '')+N(D.n)+'</div><div class="d">'+N(D.d)+'</div></button>').join('') + '</div>';
}
function setDrive(k){
  const cur = S.drive || 0;
  if (k === cur || !DRIVE[k] || S.driveDay === S.day || S.tut >= 0) return;
  if (DRIVE[k].mood < DRIVE[cur].mood) addMood(DRIVE[k].mood - DRIVE[cur].mood);
  S.drive = k; S.driveDay = S.day;
  toast(L('働き方：','Work style: ')+N(DRIVE[k].n), k > cur ? 'bad' : 'good');
  story('働き方を「'+DRIVE[k].n[0]+'」に変えた', 'Switched to “'+DRIVE[k].n[1]+'”');
  sfx(k > cur ? 'event' : 'hire');
}
// 働き方は市場の屋根に現れる：掲示板 → 鐘 → 金の豚
const driveG = new THREE.Group(); scene.add(driveG);
let driveShown = 0, driveBell = null;
function updateDrive(){
  const lv = S.drive || 0;
  if (driveShown !== lv){
    driveShown = lv; driveG.clear(); driveBell = null;
    const g = driveG, p = wpos(WH); g.position.set(p.x, 0.6, p.z);
    if (lv === 1){
      for (const x of [-0.17,0.17]) g.add(part(G.box, 0x5a3a20, 0.03,0.3,0.03, x,0.1,0));
      g.add(part(G.box, 0xf4f0e0, 0.46,0.3,0.03, 0,0.32,0));
      for (const z of [-0.025,0.025]) for (let k=0;k<3;k++) g.add(part(G.box, 0xd83a2a, 0.07,0.07+k*0.07,0.02, -0.12+k*0.12,0.24+k*0.035,z));
    } else if (lv === 2){
      for (const x of [-0.19,0.19]) g.add(part(G.box, 0x5a3a20, 0.05,0.55,0.05, x,0.24,0));
      g.add(part(G.box, 0xd83a2a, 0.5,0.07,0.14, 0,0.54,0));
      driveBell = new THREE.Group(); driveBell.position.y = 0.5;
      driveBell.add(part(G.cone6, 0xe8b840, 0.15,0.28,0.15, 0,-0.17,0)); driveBell.add(part(G.sph, 0x8a6a20, 0.04,0.04,0.04, 0,-0.33,0));
      g.add(driveBell);
    } else if (lv === 3){
      const GD = 0xf4c430, DK = 0xb88a18;
      g.add(part(G.box, 0x4a3a30, 0.42,0.12,0.36, 0,0.1,0));
      g.add(part(G.sph, GD, 0.27,0.22,0.22, 0,0.42,0)); g.add(part(G.sph, GD, 0.15,0.15,0.15, 0.25,0.5,0));
      g.add(part(G.box, DK, 0.07,0.1,0.12, 0.39,0.47,0));
      for (const z of [-0.09,0.09]){ g.add(part(G.cone4, DK, 0.05,0.12,0.05, 0.25,0.66,z)); g.add(part(G.box, 0x222222, 0.03,0.04,0.03, 0.36,0.56,z*0.7)); }
      for (const [x,z] of [[-.13,-.1],[.13,-.1],[-.13,.1],[.13,.1]]) g.add(part(G.box, DK, 0.07,0.16,0.07, x,0.22,z));
      g.add(part(G.box, 0x4a3a20, 0.12,0.04,0.04, 0,0.64,0));
      for (const z of [-0.23,0.23]){ const coin = part(G.cyl, 0xfff0a0, 0.08,0.03,0.08, 0,0.42,z); coin.rotation.x = Math.PI/2; g.add(coin); }
    }
  }
  if (driveBell) driveBell.rotation.z = isNight() && !S.nightShift ? 0 : Math.sin(elapsed*6)*0.35;
}
const head = t => '<div class="ph"><span>'+t+'</span><button class="btn x" data-act="closePanel">×</button></div>';
const segBtn = (act, label, on) => '<button class="btn '+(on?'on':'')+'" data-act="'+act+'">'+label+'</button>';
function renderPanel(){
  if (!panelName) return;
  let h = '';
  if (panelName === 'build'){
    h = head(L('建設','Build')) + '<div class="tabs">' + CATS.map(([k,n])=>segBtn('tab:'+k, N(n), buildTab===k)).join('') + '</div>' + (buildTab === 'field' ? fieldHTML() : '') + '<div class="grid">' +
      Object.entries(BUILD).filter(([k,d])=>!d.hidden && islOk(d) && d.cat === buildTab && reqOk(d)).map(([k,d])=>{
        const c = buildCost(k);
        return '<button class="opt" data-act="build:'+k+'" '+(canPay(c)?'':'disabled')+'><div class="n">'+N(d.n)+'</div><div class="c">'+costTxt(c)+'</div><div class="d">'+N(d.d)+'</div></button>';
      }).join('') + '</div>' + (buildTab === 'life' && !S.airport ? '<div class="kv" style="color:var(--sub);margin-top:6px">'+L('？？？：空港が開くと、もっと大きな楽しみが…','??? When the airport opens, something big awaits…')+'</div>' : '');
  } else if (panelName === 'farm'){
    h = head(L('種をまく','Plant seeds')) + fieldHTML();
  } else if (panelName === 'upg'){
    h = head(L('アップグレード','Upgrades')) + '<div class="grid">' + UPGS.filter(islOk).map(u=>{
      const lv = S.upg[u.id] || 0, c = u.cost[lv], max = c === undefined, T = u.tiers && u.tiers[Math.min(lv, u.tiers.length-1)];
      const chain = u.tiers ? '<div class="d">'+u.tiers.map(([n], k) => k < lv ? '<span class="g">'+N(n)+'</span>' : N(n)).join(' → ')+'</div>' : '';
      return '<button class="opt" data-act="upg:'+u.id+'" '+(max || S.gold < c ? 'disabled' : '')+'><div class="n">'+(T ? N(T[0]) : N(u.n)+(u.cost.length>1?' Lv'+lv+'/'+u.cost.length:''))+'</div><div class="c">'+(max?L('取得済み','Owned'):fmt(c)+'G')+'</div><div class="d">'+N(T ? T[1] : u.d)+'</div>'+chain+'</button>';
    }).join('') + '</div>' + driveHTML();
  } else if (panelName === 'market'){
    const wh = S.cells[WH].b, lc = lvlCost(wh);
    const tb = trade.state === 'docked' ? L('交易気球：停泊中','Trade balloon: docked') : trade.state === 'away' ? L('交易気球：あと'+Math.ceil(trade.t)+'秒','Trade balloon: in '+Math.ceil(trade.t)+'s') : L('交易気球：移動中','Trade balloon: flying');
    h = head(L('市場と桟橋','Market & Dock')) +
      '<div class="row"><span class="grow">'+L('運搬係','Haulers')+' <b style="color:var(--hi)">'+wh.workers+'/'+slots(wh)+'</b><br><small>'+L('できた物を次の加工所へ直接運ぶ。余りは市場へ','Carry goods straight to the next workshop; extras to the market')+'</small></span>' +
      '<button class="btn hot w" data-act="hireWH" '+(canHire(wh) ? '' : 'disabled')+'>'+hireTxt()+'</button>' +
      '<button class="btn" data-act="fireWH" '+(wh.workers?'':'disabled')+'>'+L('減らす','Remove')+'</button>' +
      (wh.lvl < 5 ? '<button class="btn w" data-act="lvlWH" '+(S.gold>=lc?'':'disabled')+'>'+L('枠+1','+1 slot')+' '+fmt(lc)+'G</button>' : '<button class="btn w" disabled>'+L('枠 MAX','Max slots')+'</button>') + '</div>' +
      (S.idle ? '<div class="kv g">'+L('手の空いた移住者 '+S.idle+'人：無料で働いてもらえる','Free settlers: '+S.idle+'. They work without a hiring fee')+'</div>' : pop() >= housing() ? '<div class="kv r">'+L('家が満員：住宅を建てると雇える','Houses are full: build a House to hire')+'</div>' : '') +
      '<div class="kv" style="color:var(--sub)">'+tb+'　'+L('同じ物を売り続けると値が下がり、時間で戻る','Prices drop as you sell and recover over time')+'</div>' +
      ITEM_KEYS.filter(k=>S.seen[k]).map(k=>{
        const pr = price(k), pct = Math.round(pr/ITEMS[k].p*100);
        return '<div class="row"><span class="grow">'+N(ITEMS[k].n)+' <b style="color:var(--hi)">'+fmt(S.items[k])+'</b><br><small>'+fmt(pr)+'G（'+pct+'%）</small></span>' +
          '<button class="btn" data-act="sell1:'+k+'" '+(S.items[k]>=1?'':'disabled')+'>'+L('1個','1')+'</button>' +
          '<button class="btn" data-act="sellAll:'+k+'" '+(S.items[k]>=1?'':'disabled')+'>'+L('全部','All')+'</button>' +
          (S.upg.route ? '<button class="btn '+(S.auto[k]?'on':'')+'" data-act="auto:'+k+'">'+L('定期便','Auto')+' '+(S.auto[k]?'ON':'OFF')+'</button>' : '') + '</div>';
      }).join('');
  } else if (panelName === 'area'){
    const r = evaluate();
    const xb = Object.keys(EXPAND_DIRS).map(k=>'<button class="btn" data-act="expand:'+k+'" '+(canExpand(k) && S.gold >= expandCost() ? '' : 'disabled')+'>'+N(EXPAND_DIRS[k][0])+'</button>').join('');
    h = head(L('新エリア','New Areas')) + (S.airport ?
      '<p>'+L('空港は開港している。島の称号：','The airport is open. Title: ')+'<b style="color:var(--hi)">『'+N(r.main[0])+'』</b></p><div class="btns"><button class="btn" data-act="ending">'+L('称号を見る','See title')+'</button></div>' +
      '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('飛行船を改装する','Refit the airship')+' Lv'+S.airLvl+'/'+AIR_COST.length+'</h4>' +
      '<div class="kv">'+L('大きく豪華になるほど、毎朝たくさんの観光客を連れてくる。『空の遊園地』（暮らし）があると、観光客はもっと増えてお金を落とす。','A bigger, grander airship brings more tourists each morning. A Sky Fair (Living) draws even more, and they spend more.')+'<br>'+L('これまでの観光客 ','Tourists so far ')+fmt(S.stats.tourists || 0)+L('人','')+'</div>' +
      (S.airLvl < AIR_COST.length ? '<div class="btns"><button class="btn hot" data-act="airup" '+(S.gold >= AIR_COST[S.airLvl] ? '' : 'disabled')+'>'+L('改装する','Refit')+' '+fmt(AIR_COST[S.airLvl])+'G</button></div>' : '<div class="kv g">'+L('これ以上ない豪華な飛行船だ！','The grandest airship in the skies!')+'</div>')
      : '<p>'+L('空港を開いて飛行船を呼ぶと、島の歩みに応じた<b>称号</b>が決まる。','Open an airport and call an airship to earn your island’s <b>title</b>.')+'</p><div class="kv">'+L('費用','Cost')+'：<b style="color:var(--hi)">'+fmt(P.goal)+'G</b>（'+L('いま','now')+' '+fmt(S.gold)+'G）<br>'+L('今の雰囲気','Current mood')+'：『'+N(r.main[0])+'』</div>' +
        '<div class="btns"><button class="btn hot" data-act="airport" '+(S.gold >= P.goal ? '' : 'disabled')+'>'+L('空港を開く','Open airport')+'（'+fmt(P.goal)+'G）</button></div>') +
      '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('島を広げる','Expand the island')+'</h4><div class="kv">'+L('1列ぶん陸地が増える。費用 ','Adds one row of land. Cost ')+fmt(expandCost())+'G</div><div class="btns">'+xb+'</div>' +
      '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('となりの島','Neighboring islands')+'</h4>' + neighborHTML();
  } else if (panelName === 'settings'){
    const row = (label, html) => '<div class="row"><span class="grow">'+label+'</span><div class="seg">'+html+'</div></div>';
    h = head(L('設定','Settings')) +
      row(L('言語 / Language','Language / 言語'), segBtn('set:lang:ja','日本語',SET.lang==='ja') + segBtn('set:lang:en','English',SET.lang==='en')) +
      row(L('建物のアイコン','Building icons'), segBtn('set:icons:auto',L('自動','Auto'),SET.icons==='auto') + segBtn('set:icons:on',L('いつも','Always'),SET.icons==='on') + segBtn('set:icons:warn',L('注意だけ','Alerts'),SET.icons==='warn') + segBtn('set:icons:off',L('なし','Off'),SET.icons==='off')) +
      '<div class="kv" style="color:var(--sub)">'+L('自動：チュートリアル中だけ表示。「注意だけ」は満杯や人手なしのときだけ出る','Auto: shown only during the tutorial. Alerts: only when full or unstaffed')+'</div>' +
      row(L('注意の矢印','Alert arrows'), segBtn('set:alerts:1','ON',SET.alerts) + segBtn('set:alerts:0','OFF',!SET.alerts)) +
      '<div class="kv" style="color:var(--sub)">'+L('壊れた・人がいない・しばらく満杯のままの建物の上に赤い矢印が出る','Red arrows over broken or unstaffed buildings, and ones that stay full for a long time')+'</div>' +
      row(L('音','Sound'), segBtn('set:sound:1','ON',SET.sound) + segBtn('set:sound:0','OFF',!SET.sound)) +
      row(L('ドットの粗さ','Pixel size'), segBtn('set:pixel:2',L('細かい','Fine'),SET.pixel==2) + segBtn('set:pixel:3',L('ふつう','Normal'),SET.pixel==3) + segBtn('set:pixel:4',L('粗い','Chunky'),SET.pixel==4)) +
      row(L('画面の揺れ','Screen shake'), segBtn('set:shake:1','ON',SET.shake) + segBtn('set:shake:0','OFF',!SET.shake)) +
      row(L('影（重いときはOFF）','Shadows (off = faster)'), segBtn('set:shadows:1','ON',SET.shadows) + segBtn('set:shadows:0','OFF',!SET.shadows)) +
      row(L('文字の大きさ','UI size'), segBtn('set:ui:0.9',L('小','S'),SET.ui==0.9) + segBtn('set:ui:1',L('中','M'),SET.ui==1) + segBtn('set:ui:1.15',L('大','L'),SET.ui==1.15)) +
      '<div class="kv" style="color:var(--sub);margin-top:6px">'+(TOUCH ? L('操作：1本指で移動・2本指で拡大と回転・⟲⟳で回転','Controls: 1 finger pans, 2 fingers zoom & rotate, ⟲⟳ rotate') : L('操作：左ドラッグで回転・右ドラッグで移動・ホイールで拡大','Controls: left-drag rotate, right-drag pan, wheel zoom'))+'</div>' +
      '<div class="btns"><button class="btn" data-act="restoreMenu">'+L('前のセーブに戻す','Restore a save')+'</button><button class="btn" data-act="confirmReset">'+L('この島を最初からやり直す','Start this island over')+'</button></div>';
  }
  setHTML(panelEl, h, 'p');
}
const plotMark = new THREE.Group();
for (let k=0;k<4;k++){ const m = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({color:0xffd35a})); m.scale.set(k<2?0.96:0.07, 0.04, k<2?0.07:0.96); m.position.set(k<2?0:(k===2?-0.45:0.45), 0.04, k<2?(k===0?-0.45:0.45):0); plotMark.add(m); }
plotMark.visible = false; scene.add(plotMark);
// 種えらび：そのマスに今まいたときの育つ速さを、作物ごとに見せる
function renderPlot(i){
  const c = S.cells[i], se = season(), wet = isWet(i), winter = se === 3, pct = r => Math.round(r*100)+'%';
  const rates = CROP_KEYS.map(k => [k, growRate(i, k, se, wet)]), best = rates.reduce((a, b) => b[1] > a[1] ? b : a)[0];
  const opts = rates.map(([k, r]) => '<button class="opt seed" data-act="plant:'+k+'" '+(toolWhy(k, i) ? 'disabled' : '')+'><div class="n">'+(c.crop === k ? '● ' : '')+N(CROPS[k].n)+' <span class="c">'+CROPS[k].seed+'G</span></div>' +
    '<div class="d">'+L('今の育ち ','Growth now ')+'<span class="'+(r >= 1 ? 'g' : r < 0.45 ? 'r' : '')+'">'+pct(r)+'</span>'+(k === best && !winter ? ' <span style="color:var(--hi)">'+L('おすすめ','best here')+'</span>' : '')+'<br>'+
    SEASONS.map((n, q) => N(n)+pct(growRate(i, k, q, wet))).join(' ')+'</div></button>').join('');
  setHTML(bpanelEl, '<div class="ph"><span>'+(c.crop ? N(CROPS[c.crop].n)+L('の畑',' field')+' '+Math.floor((c.g || 0)*100)+'%' : L('種をまく','Plant seeds'))+'</span><button class="btn x" data-act="unselect">×</button></div>' +
    '<div class="kv">'+N(SEASONS[se])+'・'+(wet ? L('水ぎわ（稲向き）','Beside water (good for rice)') : L('乾いた土（小麦向き）','Dry soil (good for wheat)')) +
    (winter ? '<br><span class="r">'+L('冬は植えられない。春になったら種をまこう','You can’t plant in winter. Sow when spring comes')+'</span>' : '<br>'+L('選ぶとここにまかれ、続けてほかのマスもタップでまける','Pick one to plant here, then keep tapping to plant more'))+'</div>' +
    '<div class="seeds">'+opts+'</div>' + (c.crop ? '<div class="btns"><button class="btn" data-act="clearPlot">'+L('更地に戻す','Clear')+'</button></div>' : ''), 'b');
}
function renderBPanel(){
  if (selCell < 0) return;
  const c = S.cells[selCell];
  if (isFarm && (c.t === 'grass' || (c.crop && c.t === 'sapling'))){ renderPlot(selCell); return; }
  if (c.t === 'water'){ renderRiver(selCell); return; }
  if (c.t !== 'b'){ select(-1); return; }
  const b = c.b, d = BUILD[b.type], Lst = [];
  let status = '';
  if (b.build > 0) status = '<span style="color:var(--hi)">'+L('工事中… あと','Under construction… ')+Math.ceil(b.build)+L('秒','s')+'</span>';
  else if (b.broken) status = '<span class="r">'+L('故障中','Broken')+'</span>';
  else if (!workTime() && staffed(d)) status = L('夜は休み','Resting at night');
  else if (d.gen) status = b._working ? '<span class="g">'+L('稼働中','Working')+'</span>' : !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : stTotal(b) >= stCap(b) ? '<span class="r">'+L('満杯','Full')+'</span>' : L('待機','Idle');
  else if (d.herd) status = b._working ? '<span class="g">'+L('搾乳中','Milking')+'</span>' : !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : stTotal(b) >= bufCap(b) ? '<span class="r">'+L('牛乳が満杯','Milk storage full')+'</span>' : L('乳の張った牛を待っている','Waiting for cows with full udders');
  else if (d.in) status = b._working ? '<span class="g">'+L('稼働中','Working')+'</span>' : !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : b.inb < 1 ? '<span class="r">'+L('材料待ち','Waiting for materials')+'</span>' : stTotal(b) >= bufCap(b) ? '<span class="r">'+L('完成品が満杯','Output full')+'</span>' : L('待機','Idle');
  else if (d.job) status = !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : stTotal(b) >= stCap(b) ? '<span class="r">'+L('貯蔵が満杯','Storage full')+'</span>' : '<span class="g">'+L('作業中','Working')+'</span>';
  if (status) Lst.push(status);
  if (d.herd && S.herd) Lst.push(L('牛 ','Cows ')+S.herd.length+'/'+cowCap()+L('頭','')+'　'+L('エサの干し草 ','Hay feed ')+b.inb+'/'+bufCap(b)+'<br>'+N(ITEMS.milk.n)+' '+Math.floor(stTotal(b))+'/'+bufCap(b));
  else if (d.in) Lst.push(N(ITEMS[d.in].n)+' '+b.inb+'/'+bufCap(b)+' → '+N(ITEMS[d.out].n)+' '+Math.floor(stTotal(b))+'/'+bufCap(b));
  if (d.job){ const it = Object.keys(b.st||{}).filter(k=>b.st[k]>=1).map(k=>N(ITEMS[k].n)+' '+Math.floor(b.st[k])).join('・'); Lst.push(L('貯蔵','Stored')+' '+Math.floor(stTotal(b))+'/'+stCap(b)+(it?'（'+it+'）':'')); }
  if (d.job === 'quarry') Lst.push(S.flags.mine && ISLAND === 'sky' ? L('地下の鉄鉱石：残り ','Underground ore left: ')+fmt(S.res.ore)+' / '+fmt(S.resTotal) : ISL.rock === 'salt' ? L('近くの岩塩を割っている','Breaking nearby salt rocks') : L('近くの岩を割っている','Breaking nearby rocks'));
  if (d.gen) Lst.push(N(ITEMS[d.gen].n)+' '+Math.floor(stTotal(b))+'/'+stCap(b));
  if (staffed(d)) Lst.push(L('住民 ','Workers ')+b.workers+'/'+slots(b));
  if (d.housing) Lst.push(L('住める人数 +','Homes +')+(3+(b.lvl-1)*2)+'（'+L('島全体 ','island ')+pop()+'/'+housing()+'）');
  if (d.mood) Lst.push(L('幸福 +','Happiness +')+(d.mood+(b.lvl-1)*Math.ceil(d.mood/2)) + (d.upkeep ? '／'+L('維持費 ','upkeep ')+(d.upkeep*b.lvl)+'G' : ''));
  if (d.fun) Lst.push(L('観光客が毎朝お金を落とす（空港の飛行船で来る）','Tourists spend money each morning (they come by airship)'));
  // ボタンは決まった枠に並べる（押せないときも消さずに灰色にして、位置がずれないように）
  const rc = Math.round(d.cost.g*0.4), lc = b.lvl < 5 ? lvlCost(b) : 0;
  const B = (act, label, ok, hot) => '<button class="btn'+(hot?' hot':'')+'" data-act="'+act+'" '+(ok?'':'disabled')+'>'+label+'</button>';
  const repairB = B('repair', L('修理','Repair')+' '+fmt(rc)+'G', S.gold >= rc, true);
  const lvlB = b.lvl < 5 ? B('lvl', 'Lv'+(b.lvl+1)+' '+fmt(lc)+'G', S.gold >= lc) : B('lvl', 'Lv MAX', false);
  const moveB = B('move', L('移動','Move')+' '+P.moveCost+'G', S.gold >= P.moveCost), demB = B('demolish', L('撤去','Demolish'), true);
  let slotsH;
  if (staffed(d)){
    slotsH = [b.broken ? repairB : B('collect', L(d.in?'回収・補充':'回収', d.in?'Collect & supply':'Collect'), stTotal(b) >= 1 || (d.in && S.items[d.in] >= 1 && b.inb < bufCap(b)), true),
      B('hire', hireTxt(), canHire(b), true),
      B('fire', L('減らす','Remove'), b.workers > 0), lvlB, moveB, demB];
  } else slotsH = [b.broken ? repairB : lvlB, moveB, demB];
  if (d.herd && S.herd){
    const cc = cowCost(), room = S.herd.length < cowCap();
    slotsH.push(B('buyCow', room ? L('牛を迎える','Buy a cow')+' '+fmt(cc)+'G' : L('牛 満員','Herd full'), room && S.gold >= cc, true), B('bell', L('鐘を移す','Move bell'), true));
  }
  const btns = slotsH.join('');
  let look = '';
  if (b.type === 'house'){
    const lk = houseLook(b, c.r);
    const lb = k => '<button class="btn" data-act="look:'+k+'" '+(S.gold>=LOOK_COST[k]?'':'disabled')+'>▶ '+LOOK_COST[k]+'G</button>';
    look = '<div class="row"><span class="grow">'+L('屋根の形','Roof')+'：'+N(HOUSE_STYLES[lk.s])+'</span>'+lb('s')+'</div>' +
      '<div class="row"><span class="grow">'+L('壁の色','Walls')+' <span class="swatch" style="background:#'+HOUSE_WALLS[lk.w].toString(16).padStart(6,'0')+'"></span></span>'+lb('w')+'</div>' +
      '<div class="row"><span class="grow">'+L('屋根の色','Roof color')+' <span class="swatch" style="background:#'+HOUSE_ROOFS[lk.r].toString(16).padStart(6,'0')+'"></span></span>'+lb('r')+'</div>';
  }
  const extra = (!S.idle && pop() >= housing() && staffed(d)) ? '<div class="kv r">'+L('家が満員：住宅を建てると雇える','Houses full: build a House to hire')+'</div>' : '';
  setHTML(bpanelEl, '<div class="ph"><span>'+N(d.n)+' Lv'+b.lvl+'</span><button class="btn x" data-act="unselect">×</button></div><div class="kv">'+N(d.d)+'<br>'+Lst.join('<br>')+'</div>'+look+'<div class="bgrid">'+btns+'</div>'+extra, 'b');
}
// ボタン操作：指を離したとき、ほとんど動いていなければ押したことにする（パネルのスクロールと区別）
let press = null;
document.addEventListener('pointerdown', e => {
  const a = e.target.closest('[data-act]'); if (!a || a.disabled){ press = null; return; }
  press = {act:a.dataset.act, x:e.clientX, y:e.clientY, el:a};
});
document.addEventListener('pointerup', e => {
  if (!press) return; const pr = press; press = null;
  if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 10) return;
  if (pr.el.disabled) return;
  doAct(pr.act, pr.el);
});
function buyUpg(id){
  const u = UPGS.find(u => u.id === id); if (!u || !islOk(u)) return false;
  const lv = S.upg[id] || 0, c = u.cost[lv];
  if (c === undefined || S.gold < c) return false;
  const plan = id === 'pump' ? planRiver() : null;
  if (id === 'pump' && !plan){ toast(L('流せる場所がない（建物を動かすか、島を広げる）','No room to flow (move a building or expand the island)'), 'bad'); return false; }
  S.gold -= c; S.upg[id] = lv + 1;
  if (!plan) toast(N(u.tiers ? u.tiers[lv][0] : u.n)+(u.cost.length > 1 && !u.tiers ? ' Lv'+(lv+1) : '')+L(' を手に入れた！',' acquired!'), 'good');
  if (plan) growRiver(plan);
  sfx('fanfare');
  if (id === 'road') updatePaths();
  return true;
}
function doAct(actStr, el){
  const [act, ...rest] = actStr.split(':'), arg = rest.join(':');
  if (VISIT && !['rotL','rotR','visitExit'].includes(act)) return;
  sfx('ui');
  switch (act){
    case 'share': showShare(arg || 'photo'); return;
    case 'score': showScore(arg || ISLAND); return;
    case 'scoreX': if (arg === 'total' || ISLANDS[arg]) openX(scoreText(arg), scoreURL(arg)); return;
    case 'shareX': case 'shareNative': case 'shareCopyImg': case 'shareSave': case 'shareLink': shareAct(act); return;
    case 'visitExit': location.href = location.pathname + location.search; return;
    case 'panel': openPanel(arg); break;
    case 'closePanel': closePanel(); break;
    case 'tab': buildTab = arg; break;
    case 'build': startMode({kind:'build', type:arg}); break;
    case 'upg': buyUpg(arg); break;
    case 'sell1': sell(arg, 1); break;
    case 'sellAll': case 'sellchip': sell(arg, S.items[arg]); break;
    case 'auto': S.auto[arg] = !S.auto[arg]; break;
    case 'hire': hire(selCell); break;
    case 'fire': removeWorker(selCell); break;
    case 'collect': collect(selCell); break;
    case 'hireWH': hire(WH); break;
    case 'fireWH': removeWorker(WH); break;
    case 'lvlWH': levelUp(WH); break;
    case 'lvl': levelUp(selCell); break;
    case 'move': startMode({kind:'move', from:selCell}); break;
    case 'look': changeLook(selCell, arg); break;
    case 'repair': { const b = S.cells[selCell].b, rc = Math.round(BUILD[b.type].cost.g*0.4); if (S.gold >= rc){ S.gold -= rc; b.broken = false; CM[selCell].rotation.z = 0; sfx('build'); } break; }
    case 'demolish': demolish(selCell); break;
    case 'unselect': select(-1); break;
    case 'ev': chooseEvent(+arg); break;
    case 'closeModal': $('#modal').hidden = true; break;
    case 'skipTut': if (isFarm){ S.farmHintOff = 1; break; } S.tut = TUT.length; endTutorial(); break;
    case 'airport': if (S.gold >= P.goal && !S.airport){ S.gold -= P.goal; S.airport = true; S.goalDay = S.day; story('空港を開き、飛行船を迎えた','Opened an airport and welcomed an airship'); closePanel(); buildDock(); buildAirship(false); } break;
    case 'drive': setDrive(+arg); break;
    case 'expand': expandIsland(arg); break;
    case 'airup': if (S.airport && S.airLvl < AIR_COST.length && S.gold >= AIR_COST[S.airLvl]){ S.gold -= AIR_COST[S.airLvl]; S.airLvl++; buildAirship(true); sfx('fanfare'); burst(airship.pad.x, 1.2, airship.pad.z, 'coin', 12);
      eventQueue.push({result:true, img:'airship_up', title:L('飛行船、改装完了！','The airship is refitted!'), text:L('Lv'+S.airLvl+'の飛行船になった。明日の朝から、もっと多くの観光客がやってくる。','Now a Lv'+S.airLvl+' airship. More tourists will come from tomorrow morning.')}); } break;
    case 'ending': showEnding(); break;
    case 'confirmReset': confirmResetModal(); return;
    case 'restoreMenu': showRestore(); return;
    case 'restore': restoreBackup(+arg); return;
    case 'backTitle': showTitle(); return;
    case 'plant': if (isFarm && CROPS[arg] && selCell >= 0 && useTool(arg, selCell)){ pending = -1; startMode({kind:'tool', tool:arg}); } break;
    case 'clearPlot': if (isFarm && selCell >= 0){ useTool('clear', selCell); } break;
    case 'farm': if (isFarm){ if (mode?.kind === 'tool') cancelMode(); openPanel('farm'); } break;
    case 'tool': if (isFarm && (arg === 'clear' || CROPS[arg])) startMode({kind:'tool', tool:arg}); break;
    case 'bell': if (isDairy){ if (mode?.kind === 'bell') cancelMode(); else startMode({kind:'bell'}); } break;
    case 'buyCow': buyCow(selCell); break;
    case 'travelMenu': showTravel(arg); return;
    case 'travel': travel(arg); return;
    case 'reset': resetGame(); break;
    case 'confirmYes': if (mode && pending >= 0){ doMode(pending); } break;
    case 'confirmNo': cancelMode(); break;
    case 'rotL': camS.tyaw -= Math.PI/4; break;
    case 'rotR': camS.tyaw += Math.PI/4; break;
    case 'set': { const [k, v] = arg.split(':'); SET[k] = (k === 'lang') ? v : (k === 'icons') ? v : (k === 'pixel' || k === 'ui') ? +v : v === '1'; saveSettings(); applySettings(); break; }
    case 'lang': SET.lang = arg; saveSettings(); applySettings(); showTitle(); return;
  }
  lastPanelHTML = ''; lastBHTML = ''; renderPanel(); renderBPanel(); renderTop();
}
$('#nsBtn').onclick = () => { S.nightShift = !S.nightShift; sfx('ui'); toast(S.nightShift ? L('夜勤ON：夜も働く。夜のあいだ幸福が下がる','Night shift ON: work at night, happiness drops') : L('夜勤OFF：夜は眠る','Night shift OFF: everyone sleeps'), S.nightShift?'bad':''); renderTop(); };
const SPEEDS = DEBUG ? [1,2,4,20] : [1,2,4];
$('#spdBtn').onclick = () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed)+1) % SPEEDS.length]; renderTop(); };
const chipsEl = $('#chips');
const chipEls = {};
for (const k of ITEM_KEYS){ const el = document.createElement('div'); el.className = 'chip item'; el.id = 'chip-'+k; el.dataset.act = 'sellchip:'+k; el.innerHTML = '<span></span> <b></b> <small></small>'; chipEls[k] = el; }
function orderChips(){ S.seenOrder = (S.seenOrder || []).filter(k => ITEM_KEYS.includes(k)); for (const k of ITEM_KEYS) if (S.seen[k] && !S.seenOrder.includes(k)) S.seenOrder.push(k); for (const k of [...S.seenOrder, ...ITEM_KEYS.filter(k=>!S.seenOrder.includes(k))]) chipsEl.appendChild(chipEls[k]); }
function applySettings(){
  document.documentElement.lang = SET.lang;
  document.documentElement.style.setProperty('--ui', SET.ui);
  sun.castShadow = SET.shadows; renderer.shadowMap.needsUpdate = true;
  makeRT();
  $('#rot').style.display = TOUCH ? 'flex' : 'none';
  $('#btnBuild').textContent = L('建設','Build'); $('#btnUpg').textContent = L('アップグレード','Upgrades'); $('#btnMarket').textContent = L('市場','Market'); $('#btnArea').textContent = L('新エリア','New Areas');
  $('#shareBtn').textContent = L('シェア','Share'); $('#scoreBtn').textContent = L('スコア','Score');
  $('#moodLbl').textContent = L('幸福','Happiness');
  $('#tutH').textContent = L('チュートリアル','Tutorial'); $('#tutSkip').textContent = L('スキップ','Skip');
  $('#goalH').textContent = ISLAND === 'sky' ? L('目標：空港を開いて飛行船を呼ぶ','Goal: open an airport for the airship') : isFarm ? L('目標：空港を開いて収穫祭の飛行船を呼ぶ','Goal: open an airport for the harvest airship') : L('目標：空港を開いて品評会の飛行船を呼ぶ','Goal: open an airport for the fair airship');
  for (const k of ITEM_KEYS){ const el = document.getElementById('chip-'+k); el.children[0].textContent = N(ITEMS[k].n); el.title = L('クリックで全部売る','Click to sell all'); }
  lastPanelHTML = ''; lastBHTML = '';
}
function herdLine(){
  const full = S.herd.filter(isFull).length, n = pastureAt(S.bell);
  return L('牛 ','Cows ')+S.herd.length+(full ? L('（搾れる '+full+'）',' ('+full+' ready)') : '')+'・'+'<span class="'+(n ? 'g' : 'r')+'">'+(n ? L('輪の草 ','Grass in ring ')+n : L('鐘を移そう','Move the bell'))+'</span>';
}
function renderTop(){
  if (isFarm){ const fb = $('#farmBtn'); fb.hidden = false; fb.textContent = L('種をまく','Plant seeds'); fb.classList.toggle('pulse', season() !== 3 && (!S.stats.planted || fieldCount() < 4)); }
  if (isDairy){ const bb = $('#bellBtn'); bb.hidden = false; bb.textContent = L('鐘で放牧','Herd bell'); bb.classList.toggle('pulse', !!S.herd && !isNight() && !pastureAt(S.bell)); }
  $('#gold').textContent = fmt(S.gold);
  // 上のバーが何段になっても、その下に注文バー・回転ボタンを置く
  const tb = $('#top').offsetHeight + 14;
  if (tb !== renderTop.tb){ renderTop.tb = tb; $('#missions').style.top = tb + 'px'; if (innerWidth <= 700) $('#rot').style.top = (tb + 4) + 'px'; else $('#rot').style.top = ''; }
  // 品物のチップは「はじめて手に入れた順」に右へ足していく（途中に割りこんで位置がずれないように）
  S.seenOrder ??= [];
  for (const k of ITEM_KEYS) if (S.seen[k] && !S.seenOrder.includes(k)){ S.seenOrder.push(k); chipsEl.appendChild(document.getElementById('chip-'+k)); }
  for (const k of ITEM_KEYS){
    const el = document.getElementById('chip-'+k); el.hidden = !S.seen[k];
    if (S.seen[k]){ el.children[1].textContent = fmt(S.items[k]); const pt = '@'+fmt(price(k)); if (el.children[2].dataset.v !== pt){ el.children[2].dataset.v = pt; el.children[2].innerHTML = gfix(pt+'G'); } }
  }
  const h = hourOf(S.time) % 24, hh = Math.floor(h), mm = Math.floor((h-hh)*6)*10;
  $('#clock').textContent = 'Day '+S.day+' '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+' '+(isNight()?'☾':'☀');
  const md = Math.round(S.mood), tgt = Math.round(moodTarget());
  $('#mood').textContent = md + (tgt > md+1 ? '↑' : tgt < md-1 ? '↓' : '');
  $('#moodChip').title = L('幸福度（目標 ','Happiness (target ')+tgt+')\n' + moodBreakdown().map(([k,v])=>k+' '+(v>=0?'+':'')+Math.round(v)).join('\n');
  $('#nsBtn').textContent = L('夜勤 ','Night ')+(S.nightShift ? 'ON' : 'OFF'); $('#nsBtn').classList.toggle('on', S.nightShift);
  $('#spdBtn').textContent = '▶ x'+S.speed;
  $('#goalTxt').innerHTML = gfix(S.airport ? L('空港が開港！','Airport open!')+'『'+N(evaluate().main[0])+'』' : fmt(S.gold)+' / '+fmt(P.goal)+'G<br><small style="color:var(--sub)">'+L('住民 ','Residents ')+pop()+'/'+housing()+'・'+N(ISL.treeN)+' '+treeCount()+(isFarm ? '<br>'+farmLine() : '')+(isDairy && S.herd ? '<br>'+herdLine() : '')+(S.idle ? '<br>'+L('手の空いた移住者 '+S.idle+'人（雇用無料）','Free settlers: '+S.idle+' (no hiring fee)') : '')+'</small>');
  $('#goalBar').style.width = (S.airport ? 100 : clamp(S.gold/P.goal*100, 0, 100)) + '%';
  // 進行中の注文・借金：達成率と期日までの残り時間をバーで
  const now = (S.day-1)*P.dayLen + S.time;
  const tbar = (start, due) => { const end = (due-1)*P.dayLen, f = clamp((end - now)/Math.max(1, end - start), 0, 1); return '<div class="mbar t'+(f < 0.25 ? ' late' : '')+'"><i style="width:'+(f*100)+'%"></i></div>'; };
  $('#missions').innerHTML = gfix(S.contracts.map(C=>'<div class="mis">📦 '+N(ITEMS[C.it].n)+' '+C.got+'/'+C.need+'　'+L('期限 Day','Due day ')+C.due+L('の朝','')+'　+'+fmt(C.reward)+'G<div class="bars"><div class="mbar"><i style="width:'+(C.got/C.need*100)+'%"></i></div>'+tbar(C.start ?? now, C.due)+'</div></div>').join('') +
    S.loans.map(Ln=>'<div class="mis">💰 '+L('返済','Repay')+' '+fmt(Ln.repay)+'G　Day'+Ln.due+'<div class="bars">'+tbar(Ln.start ?? now, Ln.due)+'</div></div>').join(''));
  // チュートリアル
  const tutEl = $('#tut');
  document.querySelectorAll('.pulse:not(#farmBtn):not(#bellBtn)').forEach(e=>e.classList.remove('pulse'));
  if (S.tut >= 0 && TUT[S.tut]){
    let msg = N(TUT[S.tut].m);
    if (S.tut === 6 && countB('sawmill') && workerCount() >= housing()) msg = L('住む家が満員で雇えない！<b>住宅</b>を建てるか、木こり小屋の住民を<b>減らそう</b>。','No room to hire! Build a <b>House</b> or <b>remove</b> a worker from the camp.');
    tutEl.hidden = false; tutEl.querySelector('.msg').innerHTML = '<small style="color:var(--sub)">'+(S.tut+1)+'/'+TUT.length+'</small><br>'+msg;
    const T = TUT[S.tut]; if (T.el){ const e = $(T.el); if (e) e.classList.add('pulse'); }
  } else if (isFarm && !S.farmHintOff && S.stats.planted && !S.upg.pump){
    tutEl.hidden = false;
    tutEl.querySelector('.msg').innerHTML = L('<b>川を伸ばす</b>には、<b>湧き水か川をタップ</b>して揚水水車を上げよう（Lv5まで）。','To <b>extend the river</b>, <b>tap the spring or river</b> and upgrade the waterwheel (up to Lv5).');
  } else if (isFarm && !S.farmHintOff && !S.stats.planted){
    tutEl.hidden = false;
    tutEl.querySelector('.msg').innerHTML = season() === 3
      ? L('冬は種をまけない。<b>春になったら</b>、空いている地面をタップしよう。','No planting in winter. <b>When spring comes</b>, tap any open ground.')
      : L('<b>空いている地面をタップ</b>すると、小麦・稲・かぼちゃの種をまける。<br>「種をまく」ボタンや、建設の「田畑」からでもOK。','<b>Tap any open ground</b> to plant wheat, rice or pumpkins.<br>The Plant seeds button and Build → Fields work too.');
  } else tutEl.hidden = true;
}
function toast(msg, cls=''){
  const el = document.createElement('div'); el.className = 'toast '+cls; el.innerHTML = gfix(msg);
  const box = $('#toasts'); box.appendChild(el); while (box.children.length > 5) box.firstChild.remove();
  setTimeout(()=>el.remove(), 4500);
}
// 建物の看板アイコン（UIの下に表示。チュートリアル中だけ／設定で変更）
const ICONS = {warehouse:'💰', camp:'🌲', quarry:'⛏️', sawmill:'🔨', workshop:'🛋️', bakery:'🍞', forester:'🌱', smelter:'🔥', factory:'⚙️', house:'🏠', park:'🌷', bath:'♨️', fun:'🎡', recycle:'♻️', mower:'🌾', saltpit:'🧂', seeder:'🌱', barn:'🐄', churn:'🧈', creamery:'🧀', cellar:'🏺', farmhut:'🌾', windmill:'🌀', picklery:'🎃', patisserie:'🍰', brewery:'🍶'};
const badgeEls = {};
function updateBadges(){
  const box = $('#badges'), mode2 = SET.icons === 'auto' ? (S.tut >= 0 ? 'on' : 'off') : SET.icons;
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; let el = badgeEls[i];
    if (c.t !== 'b' || mode2 === 'off'){ if (el) el.style.display = 'none'; continue; }
    const b = c.b, d = BUILD[b.type];
    const warn = needsCare(b);
    const show = b.build > 0 || (mode2 === 'on') || (mode2 === 'warn' && warn);
    if (!show){ if (el) el.style.display = 'none'; continue; }
    if (!el){ el = badgeEls[i] = document.createElement('div'); el.className = 'badge'; box.appendChild(el); }
    const icon = b.build > 0 ? '🏗️' : ICONS[b.type];
    if (el.dataset.t !== icon){ el.dataset.t = icon; el.textContent = icon; el.classList.toggle('small', b.type === 'house'); }
    el.classList.toggle('warn', !!warn && b.build <= 0); el.classList.toggle('build', b.build > 0);
    const p = bCenter(i), [sx, sy] = toScreen(p.x, b.type === 'house' ? 0.9 : bSize(i) > 1 ? 1.7 : 1.15, p.z);
    el.style.display = 'flex'; el.style.left = sx + 'px'; el.style.top = sy + 'px';
  }
}

/* ---- マーカー・ホバー枠 */
const marker = new THREE.Mesh(G.cone4, new THREE.MeshBasicMaterial({color:0xffd35a})); marker.scale.set(0.15,0.25,0.15); marker.rotation.x = Math.PI; scene.add(marker);
const hover = new THREE.Group();
for (let k=0;k<4;k++){ const m = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({color:0xffffff})); m.scale.set(k<2?1:0.06, 0.03, k<2?0.06:1); m.position.set(k<2?0:(k===2?-0.47:0.47), 0.02, k<2?(k===0?-0.47:0.47):0); hover.add(m); }
scene.add(hover);
// 早急に対処すべき建物（壊れた・人がいない・満杯）に赤い矢印
const alertMat = new THREE.MeshBasicMaterial({color:0xff5a5a}), alertMarks = [];
const FULL_ALERT = 45;   // 満杯がこの秒数つづいたら注意
function needsCare(b){
  const d = BUILD[b.type];
  if (b.type === 'warehouse' || b.build > 0) return false;
  return !!(b.broken || (staffed(d) && !b.workers) || (staffed(d) && (b._fullT || 0) >= FULL_ALERT));
}
function urgentCells(){
  if (VISIT || !SET.alerts || S.tut >= 0) return [];
  return allB().filter(i => needsCare(S.cells[i].b)).slice(0, 10);
}
function updateAlerts(){
  const u = urgentCells();
  while (alertMarks.length < u.length){ const m = new THREE.Mesh(G.cone4, alertMat); m.scale.set(0.17,0.3,0.17); m.rotation.x = Math.PI; scene.add(m); alertMarks.push(m); }
  alertMarks.forEach((m, k) => { const i = u[k]; m.visible = i !== undefined; if (!m.visible) return; const p = bCenter(i); m.position.set(p.x, (bSize(i) > 1 ? 1.8 : 1.2) + Math.abs(Math.sin(elapsed*5 + k))*0.18, p.z); m.rotation.y = elapsed*2; });
}
function markerTarget(){
  const T = S.tut >= 0 ? TUT[S.tut] : null; if (!T || !T.mark) return -1;
  if (T.mark === 'tree'){ let best=-1, bd=99; for (let i=0;i<W*W;i++) if (S.cells[i].t==='tree'){ const d = cheb(i,WH); if (d<bd){bd=d;best=i;} } return best; }
  const l = allB(T.mark); return l.length ? l[0] : -1;
}

/* ---- 島を広げる */
const AIR_COST = [6000, 15000, 40000];
const EXPAND_DIRS = {n:[['北（奥）へ','North'], 'z0', -1], s:[['南（手前）へ','South'], 'z1', 1], w:[['西へ','West'], 'x0', -1], e:[['東へ','East'], 'x1', 1]};
const expandCost = () => Math.round(1500 * Math.pow(2, S.expand));
function canExpand(dir){ const [, k, d] = EXPAND_DIRS[dir], v = S.land[k] + d; return v >= 0 && v <= W-1; }
function expandIsland(dir){
  if (!canExpand(dir) || S.gold < expandCost()) return;
  S.gold -= expandCost(); S.expand++;
  const [, k, d] = EXPAND_DIRS[dir]; S.land[k] += d; const Ld = S.land;
  for (let i=0;i<W*W;i++){
    const x = cx(i), z = cz(i);
    if (S.cells[i].t !== 'void' || x < Ld.x0 || x > Ld.x1 || z < Ld.z0 || z > Ld.z1) continue;
    const r = Math.random();
    S.cells[i] = isFarm ? {t:'grass', r:Math.random()} : r < 0.35 ? {t:'tree', hp:P.treeHP, r:Math.random()} : r < 0.43 ? {t:'rock', hp:P.rockHP, r:Math.random()} : {t:'grass', r:Math.random()};
    setCellMesh(i); if (CM[i]) CM[i].userData.pop = 0.4;
  }
  updateTiles(); if (isFarm) refreshWater(); if (S.airport) buildAirship(true); sfx('build'); shake(0.12);
  story('島を広げた','Expanded the island'); toast(L('島が広がった！','The island grew!'),'good');
}

/* ---- 空港と飛行船（ゴール演出） */
let airship = null;
// 飛行船：改装するほど大きく豪華に（Lv0 素朴 → Lv1 金の飾りとエンジン → Lv2 縞の気嚢と2階建てゴンドラ・ちょうちん → Lv3 王室の青と金）
function buildAirship(docked){
  if (airship){ scene.remove(airship.g); airship = null; }
  const lv = S.airLvl || 0, e = dockEdge();
  const a = new THREE.Group(), props = [];
  const ENV = [0xe8d8b0, 0xf4ecd8, 0xf6f0e4, 0x3a4ab0][lv], TRIM = [0xc84a3a, 0xe8b840, 0xd84a4a, 0xf0c848][lv], GOLD = 0xe8b840;
  const LX = 1.5 + lv*0.12, R = 0.55 + lv*0.04;
  const bal = new THREE.Mesh(G.sph, MT(ENV)); bal.scale.set(LX, R, R); bal.castShadow = true; a.add(bal);
  const rAt = x => R * Math.sqrt(Math.max(0, 1 - (x/LX)**2)) + 0.012;
  const ring = (x, hex, w=0.06) => { const r = rAt(x) + 0.01, m = part(G.torus, hex, r, r, r * (w > 0.08 ? 1.6 : 1), x, 0, 0); m.rotation.y = Math.PI/2; a.add(m); };
  if (lv === 0){ for (const z of [-1, 1]) a.add(part(G.box, TRIM, 2.2,0.04,0.02, 0,0.1, z*0.52)); }
  else { const xs = lv >= 2 ? [-1.1,-0.7,-0.3,0.1,0.5,0.9] : [-0.9, 0, 0.9]; xs.forEach((x,k)=>ring(x, lv === 2 ? (k%2 ? 0xd84a4a : 0x4a6ab0) : TRIM, lv >= 2 ? 0.12 : 0.05)); }
  if (lv >= 1){ const nose = part(G.sph, GOLD, 0.12,0.12,0.12, LX-0.02,0,0); a.add(nose); }
  // 尾翼
  const fin = lv >= 3 ? 0xf0c848 : 0xc84a3a, fs = 1 + lv*0.15;
  a.add(part(G.box, fin, 0.45*fs,0.55*fs,0.04, -LX+0.1,0,0)); a.add(part(G.box, fin, 0.45*fs,0.04,0.55*fs, -LX+0.1,0,0));
  if (lv >= 3) for (const z of [-1,1]) a.add(part(G.box, GOLD, 0.5,0.03,0.02, -LX+0.1, 0, z*0.28*fs));
  // ゴンドラ
  const gw = 0.7 + lv*0.25, gy = -R - 0.18;
  a.add(part(G.box, lv >= 3 ? 0xf4ecd8 : 0x8a5a2e, gw,0.22,0.3, 0,gy,0)); a.add(part(G.box, 0, gw-0.2,0.08,0.31, 0,gy+0.04,0, winMat));
  for (const x of [-gw/2+0.05, gw/2-0.05]) a.add(part(G.box, 0x5a4a3a, 0.02,0.2,0.02, x,gy+0.2,0));
  if (lv >= 2){ // 2階のゴンドラと手すり
    a.add(part(G.box, lv >= 3 ? 0xf4ecd8 : 0x9a6a3a, gw*0.8,0.18,0.28, 0,gy-0.21,0)); a.add(part(G.box, 0, gw*0.8-0.16,0.07,0.29, 0,gy-0.2,0, winMat));
    a.add(part(G.box, GOLD, gw+0.1,0.02,0.36, 0,gy-0.12,0));
    for (let k=0;k<7;k++) a.add(part(G.box, GOLD, 0.015,0.08,0.015, -gw/2 + k*gw/6, gy-0.08, 0.18));
    a.add(part(G.box, GOLD, gw,0.015,0.015, 0,gy-0.04,0.18));
  }
  // エンジンとプロペラ
  props.push(part(G.box, 0x444444, 0.04,0.5,0.06, gw/2+0.08,gy,0));
  if (lv >= 1) for (const z of (lv >= 3 ? [-0.62,-0.42,0.42,0.62] : [-0.45, 0.45])){ const en = part(G.cyl, lv >= 3 ? GOLD : 0x6a6a72, 0.08,0.3,0.08, -0.3,gy+0.25,z); en.rotation.z = Math.PI/2; a.add(en); const pr = part(G.box, 0x444444, 0.03,0.32,0.05, -0.12,gy+0.25,z); props.push(pr); }
  // 旗・ちょうちん・飾り
  if (lv >= 1){ // 気嚢の下に張った旗の列
    const n = 6 + lv*2, x0 = LX*0.7, x1 = -LX*0.7, yy = x => -rAt(x) - 0.04;
    for (let k=0;k<n;k++){ const x = x0 + (x1-x0)*k/(n-1); const fl = part(G.cone4, [0xff5a5a,0xffd35a,0x7ee0ff,0x9aff7a,0xff9af0][k%5], 0.05,0.1,0.012, x, yy(x) - 0.06, 0); fl.rotation.x = Math.PI; a.add(fl); } }
  if (lv >= 2) for (let k=0;k<9;k++){ const x = -gw/2 - 0.3 + k*(gw+0.6)/8; a.add(part(G.sph, 0, 0.035,0.045,0.035, x, gy+0.13 + Math.sin(k/8*Math.PI)*-0.05, -0.2, lampMat([0xffd35a,0xff7a5a,0x7ee0ff][k%3]))); }
  if (lv >= 2){ a.add(part(G.cyl, 0xdddddd, 0.015,0.55,0.015, -LX*0.6,R+0.2,0)); a.add(part(G.box, TRIM, 0.28,0.15,0.01, -LX*0.6+0.15,R+0.38,0)); }
  if (lv >= 3){ // 王冠の飾りと金の紋章
    a.add(part(G.cyl, GOLD, 0.16,0.08,0.16, 0.2,R+0.02,0));
    for (let k=0;k<5;k++){ const an = k/5*Math.PI*2; a.add(part(G.cone4, GOLD, 0.03,0.12,0.03, 0.2+Math.cos(an)*0.13, R+0.1, Math.sin(an)*0.13)); }
    a.add(part(G.sph, 0xd84a6a, 0.05,0.05,0.05, 0.2,R+0.1,0));
    for (const z of [-1,1]){ const em = part(G.torus, GOLD, 0.14,0.14,0.2, 0.4,0,z*(rAt(0.4)+0.005)); a.add(em); a.add(part(G.sph, 0xd84a6a, 0.05,0.05,0.03, 0.4,0,z*(rAt(0.4)+0.01))); }
    a.add(part(G.cyl, 0xdddddd, 0.015,0.55,0.015, LX*0.5,R+0.2,0)); a.add(part(G.box, 0xffffff, 0.26,0.14,0.01, LX*0.5+0.14,R+0.38,0));
  }
  props.forEach(pr => a.add(pr));
  a.scale.setScalar(1 + lv*0.08);
  scene.add(a);
  const first = !docked;
  airship = {g:a, props, pad:new THREE.Vector3(e.x, 0.95 + lv*0.12 + lv*0.08, e.z + 1.3), t: docked ? 1 : 0, ended: docked};
  if (first) S.airFirst = S.day;
  if (docked) a.position.copy(airship.pad); else { sfx('fanfare'); shake(0.1); toast(L('空港が完成！飛行船がやってくる…','Airport built! An airship is coming…'),'good'); }
}
// 飛行船の時刻表：朝7時に観光客を乗せて着き、15時半から乗りこみ、17時半に出発。夜は本土へ戻っている
// （空港を開いた日だけは、そのまま停泊している）
function airPhase(){
  if (!airship || !airship.ended || S.day === S.airFirst) return {st:'docked', k:0};
  const h = hourOf(S.time);
  if (h >= 7 && h < 8) return {st:'arrive', k:h-7};
  if (h >= 8 && h < 17.5) return {st:'docked', k:0, board:h >= 15.5};
  if (h >= 17.5 && h < 18.5) return {st:'leave', k:h-17.5};
  return {st:'away', k:0};
}
// 着いたら観光客がおりて、お金を落としていく（sim から呼ぶ）
function tourCheck(){
  const ph = airPhase();
  if (!airship || !airship.ended || ph.st !== 'docked' || ph.board || S.day === S.airFirst || S.tourDay === S.day) return;
  S.tourDay = S.day;
  const fl = allB('fun').reduce((a,i)=>a + S.cells[i].b.lvl, 0);
  const n = Math.max(1, Math.round((2 + 3*S.airLvl) * (1 + 0.6*fl) * (0.5 + S.mood/100))), inc = n * (15 + 12*fl);
  S.gold += inc; S.stats.earned += inc; S.stats.tourists = (S.stats.tourists || 0) + n; S.tourN = n;
  popAt(airship.pad.x, 1.6, airship.pad.z, '+'+fmt(inc)+'G', 'g'); sfx('coin');
  toast(L('飛行船が到着：観光客 '+n+'人 +'+fmt(inc)+'G', 'Airship landed: '+n+' tourists +'+fmt(inc)+'G'), 'good');
}
function updateAirship(dt, t){
  if (!airship) return;
  const A = airship;
  if (A.t < 1){
    A.t = Math.min(1, A.t + dt/6); const k = 1 - Math.pow(1 - A.t, 3);
    A.g.position.set(A.pad.x - 22*(1-k), A.pad.y + 6*(1-k), A.pad.z + 8*(1-k)); A.g.visible = true;
    if (A.t >= 1 && !A.ended){ A.ended = true; burst(A.pad.x, 1, A.pad.z, 'coin', 16); showEnding(); }
  } else {
    const ph = airPhase(), far = new THREE.Vector3(A.pad.x - 24, A.pad.y + 7, A.pad.z + 10), far2 = new THREE.Vector3(A.pad.x + 24, A.pad.y + 8, A.pad.z + 12);
    A.g.visible = ph.st !== 'away';
    if (ph.st === 'arrive'){ const k = 1 - Math.pow(1 - ph.k, 3); A.g.position.lerpVectors(far, A.pad, k); }
    else if (ph.st === 'leave'){ const k = Math.pow(ph.k, 2); A.g.position.lerpVectors(A.pad, far2, k); }
    else A.g.position.set(A.pad.x, A.pad.y + Math.sin(t*1.2)*0.06, A.pad.z);
  }
  for (const pr of A.props) pr.rotation.x += dt*20;
}
function updateTradeBalloon(t){
  const D = dockPoint(), A1 = new THREE.Vector3(D.x + 14, D.y + 5, D.z + 10), A2 = new THREE.Vector3(D.x - 12, D.y + 6, D.z + 10);
  const st = trade.state;
  tradeBalloon.visible = st !== 'away';
  if (st === 'arrive'){ const k = 1 - Math.pow(trade.t/4, 2); tradeBalloon.position.lerpVectors(A1, D, k); }
  else if (st === 'docked'){ tradeBalloon.position.set(D.x, D.y + Math.sin(t*1.5)*0.04, D.z); }
  else if (st === 'leave'){ const k = Math.pow(1 - trade.t/4, 2); tradeBalloon.position.lerpVectors(D, A2, k); }
}

/* =========================================================
   保存
   ========================================================= */
let noSave = false;
const OWNER_KEY = 'di_owner', SID = Math.random().toString(36).slice(2);
function claimSave(){ try { localStorage.setItem(OWNER_KEY, SID); } catch(e){} }
function isOwner(){ try { const o = localStorage.getItem(OWNER_KEY); return !o || o === SID; } catch(e){ return true; } }
function catchUp(){ if (noSave || isOwner()) return; noSave = true; location.reload(); }
if (VISIT) noSave = true; else claimSave();          // 訪問中は自分のセーブに一切書かない
addEventListener('pointerdown', catchUp, true);
// ほかのタブで更新された分を消さないよう、書く直前に読み直して「今の島」だけを差しかえる
function latestBox(){
  try { const o = JSON.parse(localStorage.getItem(SAVE_KEY)); if (o && o.ver === 2 && o.islands) return o; } catch(e){}
  return saveBox;
}
function save(){
  if (noSave || !isOwner()) return;   // ほかのタブに引き継いだ古い画面からは書かない
  try {
    const box = latestBox();
    box.cur = ISLAND; box.islands[ISLAND] = S; saveBox = box;
    localStorage.setItem(SAVE_KEY, JSON.stringify(box));
  } catch(e){}
}
// v1（石材あり）のセーブを今の形に直す
function migrate(o){
  for (const k of ['items','sat','auto','seen','satCap']) if (o[k]) delete o[k].stone;
  if (o.stats){ delete o.stats.made?.stone; delete o.stats.soldBy?.stone; }
  for (const c of o.cells || []) if (c.t === 'b' && c.b.st) delete c.b.st.stone;
  const big = !!o.doneEvents?.bigvein && o.flags?.mine;
  o.ugRows = big ? 8 : P.ugRows;
  o.resTotal = P.reserveOre + (big ? 180 : 0);
  o.res = {ore: clamp(Math.round((o.res?.ore ?? P.reserveOre) / 280 * 300), 0, o.resTotal)};
  o.routes = {}; delete o.wear;
  o.airLvl ??= 0; o.boostDay ??= 0; o.strikeDay ??= 0; o.nightOrder ??= null;
  o.v = 2; return o;
}
function load(){
  try {
    if (saveBox.islands[ISLAND]) return saveBox.islands[ISLAND];
    if (ISLAND !== 'sky') return null;
    const old = localStorage.getItem(OLD_KEY);
    if (old){ const o = JSON.parse(old); if (o && o.v === 1) return migrate(o); }
  } catch(e){}
  return null;
}
// 古いセーブ：1マスだった公園・遊園地を2×2に広げる（周りが埋まっていれば近くの空き地へ移す）
function fixFootprints(){
  const free = q => ['grass','tree','sapling'].includes(S.cells[q].t);
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; if (c.t !== 'b') continue; const sz = BUILD[c.b.type]?.size || 1; if (sz < 2) continue;
    if (cx(i)+sz <= W && cz(i)+sz <= W && footCells(i, sz).every(q => q === i || (S.cells[q].t === 'occ' && S.cells[q].of === i))) continue;
    const fits = j => cx(j)+sz <= W && cz(j)+sz <= W && footCells(j, sz).every(q => q === i || free(q));
    let to = -1, bd = 99; for (let j=0;j<W*W;j++) if (fits(j) && cheb(i, j) < bd){ bd = cheb(i, j); to = j; }
    if (to < 0){ S.gold += c.b.type === 'fun' ? BUILD.fun.cost.g : BUILD[c.b.type].cost.g; S.cells[i] = {t:'grass', r:Math.random()}; continue; }
    if (to !== i){ S.cells[i] = {t:'grass', r:Math.random()}; }
    for (const q of footCells(to, sz)) if (q !== to) S.cells[q] = {t:'occ', of:to};
    S.cells[to] = c;
  }
  for (let i=0;i<W*W;i++){ const c = S.cells[i]; if (c.t === 'occ' && (S.cells[c.of]?.t !== 'b' || !footCells(c.of, bSize(c.of)).includes(i))) S.cells[i] = {t:'grass', r:Math.random()}; }
}
function initWorld(){
  if (S.routeV !== 2){ S.routes = {}; S.routeV = 2; }          // 道の端が「戸口」だったころの線は引き継がない
  fixFootprints();
  for (let i=0;i<W*W;i++) setCellMesh(i);
  for (const w of workers.splice(0)) scene.remove(w.mesh);
  for (const m of [reserved, haulRes]) for (const k in m) delete m[k];
  for (let i=0;i<W*W;i++) if (S.cells[i].t === 'b'){ const b = S.cells[i].b, n = b.workers; b.workers = 0; for (let k=0;k<n;k++) addWorker(i); if (b.broken) CM[i].rotation.z = 0.12; }
  updateTiles(); updatePaths(); assignLights(); if (S.airport) buildAirship(true);
}
// バックアップ：毎朝（最新3日ぶん）と、やり直し・島の移動の直前に保存しておき、いつでも戻せる
const BACKUP_KEY = 'di_backup_v1';
function backups(){ try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || []; } catch(e){ return []; } }
function backup(why){
  if (noSave || !S || !isOwner()) return;
  try {
    let list = backups().filter(b => !(why === 'dawn' && b.why === 'dawn' && b.isl === ISLAND && b.day === S.day));
    list.unshift({t:Date.now(), isl:ISLAND, day:S.day, gold:Math.floor(S.gold), why, data:JSON.stringify(S)});
    const dawn = list.filter(b => b.why === 'dawn' && b.isl === ISLAND).slice(3);   // 毎朝の分は島ごとに3つまで
    list = list.filter(b => !dawn.includes(b)).slice(0, 12);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
  } catch(e){
    try { const list = backups().slice(0, 3); localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); } catch(e2){}
  }
}
function restoreBackup(k){
  const b = backups()[k]; if (!b) return;
  backup('restore');
  noSave = true;
  try { saveBox = latestBox(); saveBox.islands[b.isl] = JSON.parse(b.data); saveBox.cur = b.isl; localStorage.setItem(SAVE_KEY, JSON.stringify(saveBox)); } catch(e){}
  location.reload();
}
const WHY = {dawn:['朝の自動保存','Morning autosave'], reset:['やり直す前','Before starting over'], travel:['島を移る前','Before traveling'], restore:['復元する前','Before restoring']};
function showRestore(){
  const list = backups(), d = new Date();
  $('#modal .mbox').innerHTML = gfix('<h2>'+L('前のセーブに戻す','Restore a save')+'</h2><p class="kv">'+L('毎朝の自動保存と、やり直し・島の移動の直前の状態が残っています。','Morning autosaves and the state right before starting over or traveling are kept here.')+'</p><div class="opts">' +
    (list.length ? list.map((b, k) => { d.setTime(b.t); const tm = (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      return '<button class="opt" data-act="restore:'+k+'"><div class="n">▶ '+N(islName(b.isl))+'　Day '+b.day+'　'+fmt(b.gold)+'G</div><div class="d">'+N(WHY[b.why] || ['',''])+'（'+tm+'）</div></button>'; }).join('') : '<div class="kv">'+L('まだありません','Nothing yet')+'</div>') +
    '<button class="opt" data-act="backTitle"><div class="n">◀ '+L('もどる','Back')+'</div></button></div>');
  $('#modal').hidden = false;
}
// やり直しの確認：誤タップしないよう、別の画面で、少し待ってから押せるようにする
function confirmResetModal(){
  $('#modal .mbox').innerHTML = gfix('<h2>'+L('この島を最初からやり直す？','Start this island over?')+'</h2><p>'+L('今の'+N(islName(ISLAND))+'（Day '+S.day+'・'+fmt(S.gold)+'G）は「前のセーブに戻す」からいつでも戻せます。','Your current '+N(islName(ISLAND))+' (day '+S.day+', '+fmt(S.gold)+'G) can be restored any time from “Restore a save”.')+'</p>' +
    '<div class="opts"><button class="opt" data-act="backTitle"><div class="n">◀ '+L('やめる（このまま続ける）','No, keep playing')+'</div></button>' +
    '<div style="height:28px"></div><button class="opt" id="resetYes" data-act="reset" disabled><div class="n">▶ '+L('やり直す','Start over')+'</div></button></div>');
  $('#modal').hidden = false;
  setTimeout(() => { const b = $('#resetYes'); if (b) b.disabled = false; }, 1200);
}
function resetGame(){
  backup('reset');
  noSave = true;
  try {
    saveBox = latestBox();
    delete saveBox.islands[ISLAND];
    saveBox.cur = ISLAND; localStorage.setItem(SAVE_KEY, JSON.stringify(saveBox));
    if (ISLAND === 'sky') localStorage.removeItem(OLD_KEY);
  } catch(e){}
  location.reload();
}

/* ---- 島の移動：お金も住民も持ちこさない。どの島もゼロから始め、それぞれ残る */
function canTravel(to){
  if (!ISLANDS[to] || to === ISLAND) return false;
  if (to === 'sky' || saveBox.islands[to]) return true;
  const before = ISL_ORDER[ISL_ORDER.indexOf(to) - 1];          // ひとつ前の島で空港を開いていること
  return before === ISLAND ? !!S.airport : !!saveBox.islands[before]?.airport;
}
function showTravel(to){
  if (!canTravel(to)) return;
  const first = !saveBox.islands[to], nm = N(islName(to));
  closePanel();
  $('#modal .mbox').innerHTML = gfix('<h2>'+L(nm+'へ渡る','Travel to the '+nm)+'</h2>' + evImg('airship') +
    '<p>'+(first ? L('新しい島は<b>'+fmt(P.startGold)+'G・住民0人</b>からのスタート。','The new island starts with <b>'+fmt(P.startGold)+'G and no residents</b>.') : L('前に離れたときのまま待っている。','It waits just as you left it.'))+'</p>' +
    '<p class="kv" style="color:var(--sub)">'+L('お金も住民も持ちこさない。今の島はこのまま残り、いつでも戻れる（留守のあいだ時間は止まる）。','Gold and residents stay here. This island remains as it is and you can return any time (time stops while you are away).')+'</p>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">◀ '+L('やめる','Stay here')+'</div></button><div style="height:10px"></div>' +
    '<button class="opt" data-act="travel:'+to+'"><div class="n">▶ '+L('渡る','Set off')+'</div></button></div>');
  $('#modal').hidden = false;
}
function travel(to){
  if (noSave || !canTravel(to)) return;
  backup('travel');
  saveBox = latestBox();
  const first = !saveBox.islands[to], T = first ? newState(to) : saveBox.islands[to];
  T.arrived = {first};
  saveBox.islands[ISLAND] = S; saveBox.islands[to] = T; saveBox.cur = to;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveBox)); }
  catch(e){ toast(L('保存できなかったため、移動を中止した','Could not save, so travel was cancelled'),'bad'); $('#modal').hidden = true; return; }
  noSave = true;
  location.href = location.pathname + location.search.replace(/([?&])isl=\w+&?/, '$1').replace(/[?&]$/, '');
}
function showArrival(){
  const A = S.arrived, nm = N(islName(ISLAND)); delete S.arrived; save();
  $('#modal .mbox').innerHTML = gfix(evImg('airship') + '<h2>'+L(nm+'に着いた！','Welcome to the '+nm+'!')+'</h2>' +
    '<p>'+(A.first ? L('<b>'+fmt(P.startGold)+'G・住民0人</b>からのスタート。','You start with <b>'+fmt(P.startGold)+'G and no residents</b>.') : L('離れたときのまま、みんなが待っていた。','Everything is just as you left it.'))+'</p>' +
    (A.first && ISLAND === 'dairy' ? dairyGuide() : A.first && isFarm ? farmGuide() : '') +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('はじめる','Start')+'</div></button></div>');
  $('#modal').hidden = false;
}
function farmGuide(){
  return '<p class="kv">'+L(
    '<b>この島は水と四季で育てる</b><br>・<b>空いている地面をタップ</b>して種をまく（「種をまく」ボタンでも）<br>・<b>稲は川のとなり</b>、<b>小麦は乾いた土</b>、<b>かぼちゃは違う作物のとなり</b>が好き<br>・<b>湧き水か川をタップ</b>して揚水水車を上げると、<b>川が自分で伸びる</b>（Lv5まで）。夏は先の方が干上がる<br>・季節は2日ずつ。<b>冬は何も育たない</b>ので、秋に貯めて加工でしのぐ<br>・実った畑はタップか<b>農家</b>で刈り取る。目標は <b>'+fmt(P.goal)+'G</b>',
    '<b>This island runs on water and seasons</b><br>• <b>Tap open ground</b> to plant (or use the Plant seeds button)<br>• <b>Rice likes the river</b>, <b>wheat likes dry soil</b>, <b>pumpkins like a different crop next door</b><br>• <b>Tap the spring or river</b> to upgrade the waterwheel and <b>the river grows by itself</b> (up to Lv5). Its far end dries up in summer<br>• Seasons last 2 days. <b>Nothing grows in winter</b>, so stock up in autumn and craft<br>• Tap ripe fields, or staff a <b>Farmhouse</b>. Goal: <b>'+fmt(P.goal)+'G</b>')+'</p>';
}
function dairyGuide(){
  return '<p class="kv">'+L(
    '<b>この島は放牧で育てる</b><br>・<b>鐘</b>のまわり5×5マスの草を、牛が自分で食べに行く<br>・乳が張った牛（白いしずく）は<b>タップで搾れる</b>。<b>牛舎</b>を建てて雇えば任せられる<br>・輪の中では草が生えない。<b>鐘を移して休ませると、食べ跡がクローバーに</b>（乳が2倍濃い）<br>・草のない場所に居座ると<b>泥地</b>になる<br>・干し草は夜と草不足のときのエサ。牛舎に運ばれる<br>・加工所を建てるには<b>岩塩</b>（ピンクの岩）がいる。目標は <b>'+fmt(P.goal)+'G</b>',
    '<b>This island runs on grazing</b><br>• Cows graze the 5×5 around the <b>bell</b> by themselves<br>• <b>Tap a cow with a white drop to milk it</b>, or build and staff a <b>Cow Barn</b><br>• Nothing regrows inside the ring. <b>Move the bell to rest the pasture and it returns as clover</b> (twice as rich)<br>• Lingering on bare ground turns it to <b>mud</b><br>• Hay is feed for nights and lean times, hauled to barns<br>• Workshops take <b>rock salt</b> (the pink rocks) to build. Goal: <b>'+fmt(P.goal)+'G</b>')+'</p>';
}
addEventListener('beforeunload', save);
// スマホは beforeunload が来ないことが多い
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else catchUp(); });
setInterval(save, 10000);

/* =========================================================
   メインループ
   ========================================================= */
let last = performance.now(), uiAcc = 0, elapsed = 0, fwAcc = 0, pathAcc = 0;
const bonfire = new THREE.Group();
for (let k=0;k<4;k++){ const l = part(G.cyl6, 0x7a4a2a, 0.04,0.32,0.04, 0,0.06,0); l.rotation.z = Math.PI/2; l.rotation.y = k*Math.PI/4; bonfire.add(l); }
bonfire.add(part(G.cone6, 0, 0.14,0.3,0.14, 0,0.22,0, fireMat)); bonfire.visible = false; scene.add(bonfire);
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last)/1000); last = now; elapsed += dt;
  let wdt = dt; if (hitStop > 0){ hitStop -= dt; wdt = 0; }   // ヒットストップ
  if (!$('#modal').hidden) wdt = 0;
  else if (eventQueue.length && !curEvent && hitStop <= 0) showEvent(eventQueue.shift());
  const gdt = wdt * S.speed;
  if (VISIT){ if (wdt) S.time = (S.time + wdt) % P.dayLen; }          // 見て回るだけ。時刻だけが流れる
  else if (gdt > 0){ const n = Math.ceil(gdt / 0.05); for (let k=0;k<n;k++) sim(gdt/n); }
  // カメラ
  if (keys.ArrowLeft || keys.a || keys.A) camS.tyaw -= dt*1.8;
  if (keys.ArrowRight || keys.d || keys.D) camS.tyaw += dt*1.8;
  if (keys.ArrowUp || keys.w || keys.W) camS.tzoom = clamp(camS.tzoom*(1+dt), 0.45, 2.8);
  if (keys.ArrowDown || keys.s || keys.S) camS.tzoom = clamp(camS.tzoom*(1-dt), 0.45, 2.8);
  camS.yaw += (camS.tyaw - camS.yaw) * Math.min(1, dt*12);
  camS.zoom += (camS.tzoom - camS.zoom) * Math.min(1, dt*10);
  camS.x += (camS.tx - camS.x) * Math.min(1, dt*12); camS.z += (camS.tz - camS.z) * Math.min(1, dt*12);
  camS.shake = Math.max(0, camS.shake - dt*0.4); if (camS.shake < 0.004) camS.shake = 0;
  updateCam(); updateDayNight(elapsed); updateStrata();
  // 建物・木・岩のアニメ
  const planned = new Set(ghost && ghost.visible ? plannedCells() : []);
  for (let i=0;i<W*W;i++){
    const g = CM[i]; if (!g) continue; const c = S.cells[i], u = g.userData;
    let s = 1;
    if (c.t === 'tree') s = u.base * (isDairy || isFarm ? 0.55 + 0.45*Math.min(1, c.hp/P.treeHP) : 1); else if (c.t === 'sapling') s = u.base * (0.25 + 0.6*c.g);
    else if (c.t === 'rock') s = 0.45 + 0.55*c.hp/P.rockHP;
    if (u.pop > 0){ u.pop -= dt; s *= 1 + Math.sin((0.35-u.pop)/0.35*Math.PI)*0.25; }
    if (u.hit > 0){
      u.hit -= dt; const k = u.hit/0.2;
      if (k > 0.75) g.scale.set(s*1.15, s*0.82, s*1.15); else { g.scale.setScalar(s); g.rotation.z = Math.sin(u.hit*60)*0.18*k; }
    } else { g.scale.setScalar(s); if (!(c.t==='b' && c.b.broken)) g.rotation.z = 0; }
    // 置き場所を選ぶあいだ、草木は低くなり、予定地の草木は隠れる
    if (c.t === 'tree' || c.t === 'sapling'){ if (mode) g.scale.y *= 0.45; g.visible = !planned.has(i); }
    if (c.t === 'b'){
      const b = c.b;
      if (u.scaffold) u.scaffold.visible = b.build > 0;
      if (b.build > 0) g.scale.y = s * (0.35 + 0.65*(1 - b.build/(b.buildMax || 1)));
      if (b.type !== 'warehouse'){
        const tot = stTotal(b), n = tot >= 1 ? Math.min(6, Math.ceil(tot / stCap(b) * 6)) : 0, it = stMain(b);
        if (n !== u.pileN || it !== u.pileIt){
          u.pileN = n; u.pileIt = it;
          if (!u.pile){ u.pile = new THREE.Group(); for (let k=0;k<6;k++) u.pile.add(part(G.box, 0xffffff, 0.13,0.11,0.13, -0.38 + (k%2)*0.15, 0.055 + Math.floor(k/2)*0.11, 0.38)); g.add(u.pile); }
          u.pile.children.forEach((m,k)=>{ m.visible = k < n; if (it) m.material = MT(ITEMS[it].c); });
        }
      }
      if (b._working && wdt) for (const [m,ax,sp] of u.spin) m.rotation[ax] += sp*dt*S.speed;
      if (b._working && u.smoke && Math.random() < dt*2.2*Math.min(2,S.speed)){ const p = wpos(i); puff(p.x + u.smoke[0], u.smoke[1], p.z + u.smoke[2]); }
    }
  }
  // 住民（坑道にいる人は崖のトンネルに見える）
  let underK = 0;
  for (const w of workers){
    const m = w.mesh, u = m.userData;
    setGear(m, w.job, S.upg.carry || 0);
    u.gear.visible = !w.under;
    if (w.under){
      const v = w.sleep ? null : ugPose(w, underK, wdt ? dt*S.speed : 0); underK++;
      m.visible = !!v; if (!v) continue;
      m.position.set(v.x, v.y, v.z); m.scale.setScalar(0.8); m.rotation.y = Math.atan2(v.dx, v.dz);
      const mv = !v.swing && wdt > 0, bob = mv ? Math.abs(Math.sin(elapsed*12))*0.03 : 0;
      u.body.position.y = 0.13 + bob; u.head.position.y = 0.27 + bob; u.hat.position.y = 0.35 + bob; u.carry.position.y = 0.43 + bob;
      u.legL.position.z = mv ? Math.sin(elapsed*12)*0.035 : 0; u.legR.position.z = -u.legL.position.z;
      u.body.rotation.x = v.swing ? Math.max(0, Math.sin(elapsed*9))*0.6 : 0;
      u.carry.visible = !!v.carry; if (v.carry) u.carry.material = MT(ITEMS[ISL.rock].c); continue;
    }
    m.scale.setScalar(1);
    m.visible = !w.sleep && !w.inside;
    if (!m.visible) continue;
    m.position.set(w.x, w.dance === 2 ? Math.abs(Math.sin(elapsed*8 + w.ox*20))*0.12 : 0, w.z);
    if (w.dance === 2) w.face = (w.face + dt*4) % (Math.PI*2);
    const turn = (((w.face - m.rotation.y) % (Math.PI*2)) + Math.PI*3) % (Math.PI*2) - Math.PI;          // 近い方へ向きを変える
    m.rotation.y += turn * Math.min(1, dt*(w.dance === 3 ? 5 : 14));
    const moving = w.tasks[0]?.k === 'go' || w.tasks[0]?.k === 'parade', bob = moving ? Math.abs(Math.sin(w.walk))*0.035 : 0;
    u.body.position.y = 0.13 + bob; u.head.position.y = 0.27 + bob; u.hat.position.y = 0.35 + bob; u.carry.position.y = 0.43 + bob;
    u.legL.position.z = moving ? Math.sin(w.walk)*0.035 : 0; u.legR.position.z = -u.legL.position.z;
    u.body.rotation.x = w.work ? Math.max(0, Math.sin(w.t*9))*0.6 : 0;
    const held = w.carry || w.tasks[0]?.show;
    if (u.cargo){
      u.carry.visible = false; u.cargo.visible = !!held;
      if (held) for (const b of u.cargo.children) b.material = MT(ITEMS[held].c);
      if (moving){ for (const h of u.wheels) h.rotation.x = w.walk*0.8; }
      if (u.horse) u.horse.position.y = moving ? Math.abs(Math.sin(w.walk))*0.04 : 0;
    } else { u.carry.visible = !!held; if (held) u.carry.material = MT(ITEMS[held].c); }
  }
  // 空のものたち
  for (const c of clouds){ const a = Math.atan2(c.position.z, c.position.x) + c.userData.v*dt*0.05, r = Math.hypot(c.position.x, c.position.z); c.position.x = Math.cos(a)*r; c.position.z = Math.sin(a)*r; }
  for (const f of floaters) f.position.y += Math.sin(elapsed*0.8 + f.userData.float)*0.002;
  for (const g of bgBalloons){ const u = g.userData; u.a += dt*u.v; g.position.set(Math.cos(u.a)*u.r, u.h + Math.sin(elapsed*0.4 + u.r)*0.4, Math.sin(u.a)*u.r); }
  for (const f of farIslands){ f.position.y += Math.sin(elapsed*0.5 + f.position.x)*0.0015; if (f.userData.blades) f.userData.blades.rotation.z += dt*0.8; }
  updateTradeBalloon(elapsed);
  if (S.whaleDay === S.day && !isNight()){
    const k = clamp((hourOf(S.time) - 5) / 14, 0, 1), a = k*Math.PI*2 + 0.8;
    const ein = clamp(k/0.16, 0, 1), eout = clamp((1-k)/0.16, 0, 1), e = Math.min(ein, eout), ease = e*e*(3-2*e);
    const r = 11 + 26*(1 - ease), op = clamp(Math.min(k, 1-k)/0.07, 0, 1);
    whale.visible = op > 0.01;
    whale.position.set(Math.cos(a)*r, 3.2 + (1-ease)*2.5 + Math.sin(elapsed*0.6)*0.25, Math.sin(a)*r); whale.rotation.y = -a - Math.PI/2;
    whale.userData.tail.rotation.z = Math.sin(elapsed*1.5)*0.22;
    for (const m of whaleMats){ m.opacity = op; m.transparent = op < 0.99; m.depthWrite = op >= 0.99; }
  } else whale.visible = false;
  const raining = S.rainDay === S.day && !isNight();
  const snowing = isFarm && season() === 3;          // 冬は雪
  for (const m of rain){
    if (!raining && !snowing){ m.visible = false; continue; }
    if (!m.visible || m.position.y < 0){ m.visible = true; m.position.set(rnd(-6,6), rnd(3,7), rnd(-6,6)); m.scale.set(snowing ? 0.07 : 0.02, snowing ? 0.07 : 0.25, snowing ? 0.07 : 0.02); m.material.color.set(snowing ? 0xffffff : 0xbfe0ff); }
    m.position.y -= dt*(snowing ? 1.1 : 9); if (snowing) m.position.x += Math.sin(elapsed*1.5 + m.position.y*2)*dt*0.3;
  }
  leviStone.rotation.y += dt*0.3; leviStone.position.y = leviY + Math.sin(elapsed*0.8)*0.1;
  leviStone.material.emissiveIntensity = S.flags.crack ? 0.3 + Math.abs(Math.sin(elapsed*7))*0.5 : 0.8 + Math.sin(elapsed*1.5)*0.15;
  if (festActive()){
    festLight.position.set(PLAZA.x, 0.5, PLAZA.z); festLight.intensity = 2.6 + Math.sin(elapsed*13)*0.5;
    if (!bonfire.visible){ bonfire.visible = true; bonfire.position.set(PLAZA.x, 0, PLAZA.z); }
    if (nightAmt > 0.3 && wdt){ fwAcc += dt; if (fwAcc > 1.1){ fwAcc = 0; firework(); } }
    if (wdt || !curEvent) musicTick();          // 絵が出ているあいだも祭りばやしは続く
    if (wdt && S.festStill === S.day){ festHeard += dt; if ((festHeard >= FEST_STILL_AFTER && nightAmt > 0.5) || hourOf(S.time) >= 27.5) showFestStill(); }
  } else if (bonfire.visible){ bonfire.visible = false; festLight.intensity = 0; }
  plotMark.visible = isFarm && selCell >= 0 && S.cells[selCell].t !== 'b';
  if (plotMark.visible){ const pp = wpos(selCell); plotMark.position.set(pp.x, 0, pp.z); }
  updateFarm(dt); updateBell(dt); updateRaze(dt); updateDrive(); updateStrollers(wdt ? dt*Math.min(4, S.speed) : 0);
  updateFx(wdt ? dt : 0); updatePops(dt); updateAirship(dt, elapsed); updateCritters(wdt ? dt : 0); updateBadges(); updateAlerts(); updateTourists(wdt ? dt*Math.min(4, S.speed) : 0);
  // マーカー・ホバー・置き場所プレビュー
  const mt = markerTarget();
  if (mt >= 0){ const p = wpos(mt); marker.visible = true; marker.position.set(p.x, 1.35 + Math.abs(Math.sin(elapsed*5))*0.2, p.z); } else marker.visible = false;
  hoverCell = mode && TOUCH ? pending : (mouseIn && !drag) ? pick() : -1;
  if (hoverCell >= 0){
    const hs = mode ? modeSize() : bSize(hoverCell), p = wpos(hoverCell), k = (hs-1)/2;
    hover.visible = true; hover.position.set(p.x + k, 0, p.z + k); hover.scale.set(hs, 1, hs);
  } else hover.visible = false;
  if (mode && ghost){
    const tip = $('#tip');
    if (hoverCell >= 0){
      const p = wpos(hoverCell), ok = !modeWhy(hoverCell);
      const gk = (modeSize() - 1)/2;
      ghost.visible = true; ghost.position.set(p.x + gk, 0.02, p.z + gk);
      ghost.traverse(o=>{ if (o.isMesh) o.material = ok ? ghostOk : ghostNg; });
      tip.style.display = 'block'; tip.innerHTML = gfix(placementInfo(hoverCell));
      const [sx, sy] = TOUCH ? toScreen(p.x, 1.4, p.z) : [mx, my];
      tip.style.left = clamp(sx + 16, 8, innerWidth - 270) + 'px'; tip.style.top = clamp(sy + 12, 8, innerHeight - 160) + 'px';
    } else { ghost.visible = false; tip.style.display = 'none'; }
  }
  pathAcc += dt; if (pathAcc > 1){ pathAcc = 0; updatePaths(); }
  uiAcc += dt; if (uiAcc > 0.2){ uiAcc = 0; renderTop(); renderPanel(); renderBPanel(); }
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); makeRT(); });

/* =========================================================
   シェア：島に名前 → 絵はがき（画像）・訪問リンク・Xへの投稿画面
   ========================================================= */
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanName = t => [...String(t || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069@＠#＃]/g,'')].slice(0, SH_NAME_MAX).join('').trim();
const myName = () => cleanName(S.name) || N(islName(ISLAND));
function visitURL(){
  const U = S.upg, b = [SH_VER, SH_ISL.indexOf(ISLAND), S.day >> 8 & 255, S.day & 255,
    Math.min(3, U.carry || 0) | Math.min(3, U.road || 0) << 2 | (S.drive || 0) << 4 | Math.min(3, S.airLvl || 0) << 6,
    (S.airport ? 1 : 0) | (S.flags.skycow ? 2 : 0) | (S.flags.jersey ? 4 : 0) | (U.dog ? 8 : 0) | Math.min(5, U.pump || 0) << 4,
    S.land.x0, S.land.x1, S.land.z0, S.land.z1, Math.min(24, S.herd?.length || 0), S.bell ?? WH];
  const nm = new TextEncoder().encode(cleanName(S.name)); b.push(nm.length, ...nm);
  S.cells.forEach((c, i) => {
    if (c.t === 'b'){
      const k = SH_TYPES.indexOf(c.b.type); if (k < 0){ b.push(0); return; }
      b.push(16 + k*5 + clamp(c.b.lvl, 1, 5) - 1);
      if (c.b.type === 'house'){ const L0 = houseLook(c.b, c.r); b.push(L0.s%4 | (L0.w%8) << 2 | (L0.r%8) << 5); }
    } else if (c.crop) b.push(7 + CROP_KEYS.indexOf(c.crop)*2 + (c.t === 'tree' ? 1 : 0));
    else if (c.t === 'water') b.push(c.spring ? 14 : 13);
    else b.push(c.t === 'tree' ? (c.clover ? 6 : 1) : c.t === 'sapling' ? 2 : c.t === 'rock' ? 3 : c.t === 'void' ? 4 : c.t === 'occ' ? 5 : 0);
  });
  return location.origin + location.pathname + '#visit=' + btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function visitState(){
  const V = VISIT, s = newState(ISLAND);
  s.name = cleanName(V.name); s.day = s.airFirst = V.day; s.time = P.dayLen*P.dayFrac*0.4; s.tut = -1; s.seed = V.cells.reduce((a,c,i) => (a*31 + c.c + i) % 1000, 7) + 0.5;
  s.upg.carry = V.upg & 3; s.upg.road = Math.min(2, V.upg >> 2 & 3); s.drive = V.upg >> 4 & 3; s.airLvl = V.upg >> 6;
  s.airport = !!(V.mode & 1); s.flags.skycow = !!(V.mode & 2); s.flags.jersey = !!(V.mode & 4); if (V.mode & 8) s.upg.dog = 1; s.upg.pump = Math.min(5, V.mode >> 4 & 7);
  const [x0,x1,z0,z1] = V.land; s.land = {x0,x1,z0,z1};
  s.cells = V.cells.map((c, i) => {
    const r = hash(i, 5);
    if (i === WH) return {t:'b', r, b:{type:'warehouse', lvl:1, workers:0, inb:0, st:{}, prog:0, build:0}};
    if (isFarm && !c.type && c.c >= 7){
      if (c.c >= 13) return {t:'water', r, spring:c.c === 14};
      const crop = CROP_KEYS[Math.floor((c.c-7)/2)];
      return (c.c-7) % 2 ? {t:'tree', hp:P.treeHP, r, crop} : {t:'sapling', g:0.6, r, crop};
    }
    if (!c.type || c.type === 'warehouse' || !BUILD[c.type] || !islOk(BUILD[c.type]))
      return c.c === 1 || c.c === 6 ? {t:'tree', hp:P.treeHP, r, clover:c.c === 6} : c.c === 2 ? {t:'sapling', g:0.5, r} : c.c === 3 ? {t:'rock', hp:P.rockHP, r} : c.c === 4 ? {t:'void'} : {t:'grass', r};
    const b = {type:c.type, lvl:c.lvl, workers:0, inb:0, st:{}, prog:0, build:0};
    if (c.type === 'house') b.look = {s:c.look & 3, w:(c.look >> 2 & 7) % HOUSE_WALLS.length, r:(c.look >> 5) % HOUSE_ROOFS.length};
    return {t:'b', r, b};
  });
  // 端で終わる川は滝
  if (isFarm) s.cells.forEach((c, i) => {
    if (c.t !== 'water' || c.spring) return;
    const n = neigh4(i);
    c.river = 1;
    if ((n.length < 4 || n.some(j => s.cells[j].t === 'void')) && n.filter(j => s.cells[j].t === 'water').length === 1) c.fall = 1;
  });
  // 2×2の建物のふさぎマスは、ここで正しく組み直す
  s.cells.forEach((c, i) => {
    if (c.t !== 'b' || (BUILD[c.b.type].size || 1) < 2) return;
    if (cx(i)+2 > W || cz(i)+2 > W || footCells(i,2).some(j => j !== i && s.cells[j].t !== 'grass')){ s.cells[i] = {t:'grass', r:c.r}; return; }
    for (const j of footCells(i,2)) if (j !== i) s.cells[j] = {t:'occ', of:i};
  });
  if (ISLAND === 'dairy'){
    s.bell = s.cells[V.bell].t === 'void' ? WH : V.bell; s.soil = {}; s.herd = [];
    const bp = wpos(s.bell);
    for (let k=0;k<V.cows;k++){ const a = k*2.4, r = 0.7 + (k%4)*0.45; s.herd.push({name:k % COW_NAMES.length, x:clamp(bp.x + Math.cos(a)*r, -5, 5), z:clamp(bp.z + Math.sin(a)*r, -5, 5), face:a, belly:k%5, load:0, total:0, tgt:-1, wait:-1, t:0, eating:k%2 === 0}); }
  }
  return s;
}
// いまの角度のまま、島全体が収まる構図で撮る
function snapIsland(w, h){
  const keep = {...camS}, off = [hover, marker, ringG, ...alertMarks].map(o => [o, o.visible]);
  for (const [o] of off) o.visible = false;
  if (ghost) ghost.visible = false;
  VIEW.w = w; VIEW.h = h;
  Object.assign(camS, {zoom:1.14, x:0, z:0.5, shake:0});
  renderer.setSize(w, h, false); makeRT(); updateCam();
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(cvs, 0, 0);          // 描いた直後でないと空になる
  VIEW.w = VIEW.h = 0; Object.assign(camS, keep);
  renderer.setSize(innerWidth, innerHeight); makeRT(); updateCam();
  for (const [o, v] of off) o.visible = v;
  return c;
}
/* ---- スコア：島ごと1000点（開拓・速さ・幸福・にぎわい・その島ならでは）。総合は3島の平均でランク */
const RANK_AT = [['S',900],['A',760],['B',560],['C',300],['D',0]];
const RANK_NAME = {
  sky:  {S:['天空の森の都','Forest Capital of the Sky'], A:['雲上の名所','Wonder above the Clouds'], B:['木もれ日の村','Village of Dappled Light'], C:['きこりの開拓地','Woodcutters’ Outpost'], D:['はじまりの一本','A Single Tree']},
  dairy:{S:['天空の牧場王国','Dairy Kingdom of the Sky'], A:['雲上の名牧場','Celebrated Cloud Ranch'], B:['鐘の鳴る牧場','Ranch of the Ringing Bell'], C:['小さな牛舎','A Little Barn'], D:['はじまりの一頭','A Single Cow']},
  farm: {S:['天空の黄金郷','Golden Land of the Sky'], A:['水めぐる名村','Celebrated River Village'], B:['風車のまわる村','Village of Turning Mills'], C:['開墾中の畑','Fresh-tilled Fields'], D:['はじまりの一粒','A Single Seed']},
  total:{S:['空を統べる者','Sovereign of the Skies'], A:['空の名領主','Celebrated Sky Lord'], B:['島々の世話役','Keeper of the Isles'], C:['駆け出しの島主','Fledgling Islander'], D:['空への第一歩','First Step into the Sky']},
};
const SCORE_PAR = {sky:12, dairy:14, farm:18};
const CRAFT_NAME = {sky:['森づくり','Forestry'], dairy:['放牧','Grazing'], farm:['川と田畑','River & fields']};
const rankOf = v => RANK_AT.find(([, at]) => v >= at)[0];
const rankImg = (kind, rk) => 'assets/rank/'+kind+'_'+rk+'.png';
function islandState(isl){ return isl === ISLAND ? S : (latestBox().islands[isl] || null); }
function calcScore(isl){
  const s = islandState(isl); if (!s) return null;
  const I = ISLANDS[isl], st = s.stats, f = v => clamp(v || 0, 0, 1), count = pred => s.cells.filter(pred).length;
  const bs = s.cells.filter(c => c.t === 'b').map(c => c.b), par = SCORE_PAR[isl];
  const avg = st.moodN ? st.moodSum/st.moodN : s.mood, gd = s.goalDay ?? s.airFirst ?? s.day;
  const kinds = Object.keys(BUILD).filter(k => !BUILD[k].hidden && (!BUILD[k].isl || BUILD[k].isl === isl));
  const built = new Set(bs.filter(b => b.type !== 'warehouse').map(b => b.type)).size, ppl = bs.reduce((a,b) => a + (b.workers || 0), 0);
  const craft = isl === 'sky' ? 75*f(count(c => c.t === 'tree' || c.t === 'sapling')/24) + 75*f(st.planted/70)
    : isl === 'dairy' ? 100*f((st.clover || 0)/320) + 50*f((s.herd?.length || 0)/16)
    : 75*f(count(c => c.t === 'water' && !c.spring)/24) + 75*f(count(c => !!c.crop)/52);
  const parts = [
    {n:['開拓','Progress'], max:250, v:s.airport ? 250 : 150*f(st.earned/I.goal), tip:['空港を開く','Open the airport']},
    {n:['速さ','Speed'], max:250, v:s.airport ? 250*f(1 - (gd - par)/(par*1.5)) : 0, tip:['空港を早く開く（Day '+par+'で満点）','Open the airport early (full marks by day '+par+')']},
    {n:['幸福','Happiness'], max:200, v:200*f((avg - 15)/65)*f((s.day - 1)/6), tip:['平均幸福を80に近づける','Raise average happiness toward 80']},
    {n:['にぎわい','Bustle'], max:150, v:90*f(built/(kinds.length*0.7)) + 60*f(ppl/24), tip:['いろいろな建物と住民を増やす','More kinds of buildings, more residents']},
    {n:CRAFT_NAME[isl], max:150, v:craft, tip:{sky:['木を植え、森を残す','Plant trees and keep the forest'], dairy:['鐘を移してクローバーを増やし、牛を増やす','Move the bell for clover, grow the herd'], farm:['水車で川を伸ばし、田畑を増やす','Grow the river, add fields']}[isl]},
  ];
  for (const p of parts) p.v = Math.round(p.v);
  const total = parts.reduce((a,p) => a + p.v, 0);
  return {kind:isl, parts, total, max:1000, rk:rankOf(total), day:s.day, name:cleanName(s.name)};
}
function totalScore(){
  const parts = ISL_ORDER.map(k => { const r = calcScore(k); return {n:islName(k), max:1000, v:r ? r.total : 0, rk:r?.rk, tip:[islName(k)[0]+'を育てる','Grow the '+islName(k)[1]]}; });
  const total = parts.reduce((a,p) => a + p.v, 0);
  return {kind:'total', parts, total, max:3000, rk:rankOf(total/3)};
}
const scoreOf = kind => kind === 'total' ? totalScore() : calcScore(kind);
const scoreTitle = kind => kind === 'total' ? L('総合スコア','Total score') : N(islName(kind));
function showScore(kind){
  if (VISIT) return;
  if (kind !== 'total' && !ISLANDS[kind]) kind = ISLAND;
  closePanel(); select(-1); cancelMode();
  const R = scoreOf(kind);
  let body;
  if (!R) body = '<p>'+L('まだ渡っていない島です。','You have not sailed to this island yet.')+'</p>';
  else {
    const unit = kind === 'total' ? 3 : 1, up = RANK_AT[RANK_AT.findIndex(([k]) => k === R.rk) - 1];
    const weak = R.parts.reduce((a,p) => p.max - p.v > a.max - a.v ? p : a);
    body = '<img class="rankimg" src="'+rankImg(kind, R.rk)+'" alt="'+R.rk+'">' +
      '<div class="scorehead"><span class="rk rk'+R.rk+'">'+R.rk+'</span><span><b>'+fmt(R.total)+'</b> / '+fmt(R.max)+'<br>『'+N(RANK_NAME[kind][R.rk])+'』</span></div>' +
      R.parts.map(p => '<div class="srow"><span>'+N(p.n)+(p.rk ? ' '+p.rk : '')+'</span><div class="bar"><i style="width:'+(p.v/p.max*100)+'%"></i></div><em>'+fmt(p.v)+'</em></div>').join('') +
      '<div class="kv" style="color:var(--sub);margin-top:6px">'+(up ? L('次の'+up[0]+'ランクまで あと'+fmt(Math.ceil(up[1]*unit - R.total))+'点。伸びしろ：'+N(weak.tip), fmt(Math.ceil(up[1]*unit - R.total))+' points to rank '+up[0]+'. Most to gain: '+N(weak.tip)) : L('最高ランク！','The highest rank!'))+'</div>' +
      '<div class="bgrid"><button class="btn hot" data-act="scoreX:'+kind+'">'+L('Xにポスト','Post on X')+'</button><button class="btn hot" data-act="share:'+kind+'">'+L('画像でシェア','Share as image')+'</button></div>';
  }
  $('#modal .mbox').innerHTML = '<h2>'+L('スコア','Score')+'：'+scoreTitle(kind)+'</h2><div class="seg">' +
    [...ISL_ORDER, 'total'].map(k => segBtn('score:'+k, k === 'total' ? L('総合','Total') : N(islName(k)), k === kind)).join('') + '</div>' + body +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">◀ '+L('もどる','Back')+'</div></button></div>';
  $('#modal').hidden = false;
}
function scoreText(kind){
  const R = scoreOf(kind), ja = SET.lang !== 'en', nm = RANK_NAME[kind][R.rk];
  return ja
    ? (kind === 'total' ? 'ジオラマアイランド 総合スコア' : (R.name ? '「'+R.name+'」' : islName(kind)[0]+'のスコア'))+' '+fmt(R.total)+'/'+fmt(R.max)+'\nランク'+R.rk+'『'+nm[0]+'』\n#ジオラマアイランド'
    : (kind === 'total' ? 'Diorama Island total score' : (R.name ? '“'+R.name+'”' : islName(kind)[1]+' score'))+': '+fmt(R.total)+'/'+fmt(R.max)+'\nRank '+R.rk+', '+nm[1]+'\n#DioramaIsland';
}
// ランクの絵がカードに出る中継ページ（r/）。いま居る島なら、開いた人はそのまま訪問できる
const scoreURL = kind => new URL('r/'+kind+'_'+scoreOf(kind).rk+'.html', location.origin + location.pathname).href + (kind === ISLAND ? new URL(visitURL()).hash : '');
function openX(text, url){
  // 投稿画面を開くだけ。投稿するかどうかは本人が決める
  window.open('https://x.com/intent/post?text='+encodeURIComponent(text)+'&url='+encodeURIComponent(url), '_blank', 'noopener');
}
function loadImg(src){ return new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
async function paintScore(g, kind, X, w, line){
  const R = scoreOf(kind), art = await loadImg(rankImg(kind, R.rk)), PAP = '#f6ecc9', HI = '#ffd35a', SUB = '#a9b3e6';
  g.imageSmoothingEnabled = false;
  if (art) g.drawImage(art, 28, 28, 756, 425);
  line(L('ジオラマアイランド','Diorama Island'), 72, 24, SUB);
  line(R.name || scoreTitle(kind), 130, 42, '#fff');
  line(kind === 'total' ? L('3つの島の合計','All three islands') : N(islName(kind))+'　Day '+R.day, 168, 24, SUB);
  line(L('ランク ','Rank ')+R.rk, 250, 72, {S:'#ffe070', A:'#ffc860', B:'#d0e4f4', C:'#e0a070', D:'#a8b0c0'}[R.rk]);
  line('『'+N(RANK_NAME[kind][R.rk])+'』', 298, 30, HI);
  line(fmt(R.total)+' / '+fmt(R.max), 356, 46, PAP);
  if (kind === ISLAND && shareShot) g.drawImage(shareShot, X + 20, 380, 280, 229);
  line('sin1.studio/diorama', 642, 22, HI);
  const rowH = Math.min(38, 196/R.parts.length);
  R.parts.forEach((p, k) => {
    const y = 470 + k*rowH;
    g.font = '24px DotGothic16, monospace'; g.fillStyle = SUB; g.fillText(N(p.n)+(p.rk ? ' '+p.rk : ''), 40, y + 20);
    g.fillStyle = '#0b0f26'; g.fillRect(290, y + 2, 380, 20);
    g.fillStyle = p.v >= p.max*0.8 ? HI : '#7ee08a'; g.fillRect(290, y + 2, 380*p.v/p.max, 20);
    g.fillStyle = PAP; g.fillText(fmt(p.v), 688, y + 20);
  });
}
let shareShot = null, shareBlob = null, shareSeq = 0, shareKind = 'photo';
function fitText(g, text, w, px){ do { g.font = px+'px DotGothic16, monospace'; } while (g.measureText(text).width > w && --px > 14); g.fillText(text, 0, 0); }
async function drawCard(){
  const seq = ++shareSeq; shareBlob = null;
  try { await document.fonts.load('32px DotGothic16', 'ジオラマ島'+myName()); } catch(e){}
  if (seq !== shareSeq || !shareShot) return;
  const c = document.createElement('canvas'); c.width = 1200; c.height = 675;
  const g = c.getContext('2d'), PAP = '#f6ecc9', INK = '#1b1f3a', HI = '#ffd35a';
  g.fillStyle = PAP; g.fillRect(0, 0, 1200, 675);
  g.fillStyle = INK; g.fillRect(16, 16, 1168, 643);
  const X = 812, w = 356, line = (t, y, px, col) => { g.save(); g.translate(X, y); g.fillStyle = col; fitText(g, t, w, px); g.restore(); };
  if (shareKind !== 'photo'){
    await paintScore(g, shareKind, X, w, line);
    if (seq === shareSeq) publishCard(c, seq);
    return;
  }
  g.drawImage(shareShot, 28, 28);
  line(L('ジオラマアイランド','Diorama Island'), 78, 24, '#a9b3e6');
  line(myName(), 142, 46, '#fff');
  line(N(islName(ISLAND))+'　Day '+S.day, 186, 24, '#a9b3e6');
  g.fillStyle = '#4a5290'; g.fillRect(X, 210, w, 3);
  const st = S.stats, rows = [
    [L('称号','Title'), '『'+N(evaluate().main[0])+'』', HI],
    [L('稼いだ総額','Total earned'), fmt(st.earned)+' G', PAP],
    [L('平均幸福','Avg happiness'), String(Math.round(st.moodN ? st.moodSum/st.moodN : S.mood)), PAP],
  ];
  const star = starCow();
  if (star) rows.push([L('看板牛','Star cow'), N(COW_NAMES[star.name])+(star.total ? L('（乳 '+star.total+'）',' ('+star.total+' milk)') : ''), '#ffb8d8']);
  else if (S.story.length) rows.push([L('最近のできごと','Latest chapter'), N(S.story[S.story.length-1].t), PAP]);
  rows.forEach(([a, b, col], k) => { line(a, 256 + k*86, 20, '#a9b3e6'); line(b, 294 + k*86, 30, col); });
  line('sin1.studio/diorama', 630, 24, HI);
  publishCard(c, seq);
}
function publishCard(c, seq){
  c.toBlob(b => {
    if (!b || seq !== shareSeq) return;
    shareBlob = b;
    const im = $('#shareImg'); if (!im) return;
    if (im.dataset.u) URL.revokeObjectURL(im.dataset.u);
    im.src = im.dataset.u = URL.createObjectURL(b);
    for (const e of document.querySelectorAll('[data-needimg]')) e.disabled = false;
  }, 'image/png');
}
function showShare(kind = 'photo'){
  if (VISIT) return;
  shareKind = (kind === 'total' || (ISLANDS[kind] && calcScore(kind))) ? kind : 'photo';
  closePanel(); select(-1); cancelMode();
  shareShot = snapIsland(756, 618);
  let canFiles = false;
  try { canFiles = !!navigator.canShare?.({files:[new File(['x'], 'a.png', {type:'image/png'})]}); } catch(e){}
  const b = (act, label, img, hot) => '<button class="btn'+(hot?' hot':'')+'" data-act="'+act+'" '+(img?'data-needimg disabled':'')+'>'+label+'</button>';
  const ownScore = shareKind === ISLAND, named = shareKind === 'photo' || ownScore;
  $('#modal .mbox').innerHTML = '<h2>'+(shareKind === 'photo' ? L('島をシェア','Share your island') : L('スコアをシェア','Share your score'))+'</h2>' +
    '<div class="seg" style="margin-bottom:6px">'+segBtn('share:photo', L('絵はがき','Postcard'), shareKind === 'photo')+segBtn('share:'+ISLAND, L('この島のスコア','Island score'), ownScore)+segBtn('share:total', L('総合スコア','Total score'), shareKind === 'total')+'</div>' +
    '<label class="kv" '+(named?'':'hidden')+'>'+L('島の名前','Island name')+'<input id="nameIn" maxlength="'+SH_NAME_MAX+'" autocomplete="off"></label>' +
    '<img id="shareImg" class="shareimg" alt="">' +
    '<div class="bgrid">' + b('shareX', L('Xにポスト','Post on X'), true, true) + (canFiles ? b('shareNative', L('画像つきで共有','Share with image'), true, true) : '') + b('shareCopyImg', L('画像をコピー','Copy image'), true) +
    b('shareSave', L('画像を保存','Save image'), true) + b('shareLink', L('訪問リンクをコピー','Copy visit link'), false) + '</div>' +
    '<p class="kv" style="color:var(--sub)">'+L('リンクを開いた人は、いまのあなたの島を見て回れます（相手のセーブには影響しません）。Xにはランクの絵が自動で表示されます。上の画像を載せたいときは、コピーか保存をして貼ってください。','Anyone opening the link can look around your island as it is now (their save is untouched). X shows your rank illustration automatically. To post the image above instead, copy or save it and paste it in.')+'</p>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">◀ '+L('もどる','Back')+'</div></button></div>';
  const inp = $('#nameIn'); inp.value = cleanName(S.name); inp.placeholder = N(islName(ISLAND));
  inp.addEventListener('input', () => { S.name = cleanName(inp.value); for (const e of document.querySelectorAll('[data-needimg]')) e.disabled = true; drawCard(); });
  inp.addEventListener('change', save);
  $('#modal').hidden = false;
  drawCard();
}
const shareText = () => L('「'+myName()+'」Day '+S.day+'『'+evaluate().main[0][0]+'』\n空に浮かぶわたしの島、見に来てね！\n#ジオラマアイランド','“'+myName()+'” Day '+S.day+': '+evaluate().main[0][1]+'\nCome visit my island in the sky!\n#DioramaIsland');
function copyText(t){
  const done = () => toast(L('訪問リンクをコピーした','Visit link copied'), 'good');
  const manual = () => { const a = document.createElement('input'); a.value = t; a.readOnly = true; $('#modal .mbox').appendChild(a); a.select(); toast(L('このリンクをコピーしてください','Copy this link'), 'ev'); };
  try { navigator.clipboard.writeText(t).then(done, manual); } catch(e){ manual(); }
}
function shareAct(act){
  if (act === 'shareLink'){ copyText(visitURL()); return; }
  if (!shareBlob) return;
  const photo = shareKind === 'photo', text = photo ? shareText() : scoreText(shareKind), url = scoreURL(photo ? ISLAND : shareKind);
  if (act === 'shareX'){
    openX(text, url);
  } else if (act === 'shareNative'){
    navigator.share({files:[new File([shareBlob], 'diorama-island.png', {type:'image/png'})], text:text+'\n'+url}).catch(()=>{});
  } else if (act === 'shareCopyImg'){
    const ng = () => toast(L('コピーできなかった。「画像を保存」を使ってください','Could not copy. Use “Save image” instead'), 'bad');
    try { navigator.clipboard.write([new ClipboardItem({'image/png':shareBlob})]).then(() => toast(L('画像をコピーした。投稿画面に貼り付けられる','Image copied. Paste it into your post'), 'good'), ng); } catch(e){ ng(); }
  } else if (act === 'shareSave'){
    const a = document.createElement('a'); a.href = URL.createObjectURL(shareBlob); a.download = 'diorama-island-day'+S.day+'.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
function enterVisit(){
  document.body.classList.add('visiting');
  const el = $('#visit'); el.hidden = false;
  el.innerHTML = '<span><b>'+esc(cleanName(S.name) || N(islName(ISLAND)))+'</b><br><small>'+N(islName(ISLAND))+'　Day '+S.day+L('　を訪問中',' · visiting')+'</small></span><button class="btn hot" data-act="visitExit">'+L('自分の島で遊ぶ','Play my island')+'</button>';
  wearSocial();
  for (const e of socialEdges){ const k = routeKey(e.p.x, e.p.z, e.q.x, e.q.z); if (k) S.routes[k] = 0.9; }
  updatePaths();
}
addEventListener('hashchange', () => { if (VISIT || location.hash.startsWith('#visit=')){ if (!VISIT) save(); noSave = true; location.reload(); } });

/* =========================================================
   起動
   ========================================================= */
function showTitle(){
  const fresh = ISLAND === 'sky' && S.tut === 0 && S.stats.clicks === 0;
  $('#modal .mbox').innerHTML = gfix('<img src="assets/logo.png" alt="Diorama Island" style="display:block;width:min(300px,70vw);margin:0 auto">' +
    '<div style="text-align:center;color:var(--hi);font-size:20px;margin-top:4px">ジオラマアイランド</div>' +
    '<p style="text-align:center">'+L('中身は3D、見た目はドット絵。<br>空に浮かぶ島を、あなたのやり方で育てよう。','A 3D world in pixel art.<br>Grow your floating island your own way.')+'</p>' +
    '<div class="seg" style="justify-content:center">'+segBtn('lang:ja','日本語',SET.lang==='ja')+segBtn('lang:en','English',SET.lang==='en')+'</div>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+(fresh ? L('はじめる','Start') : L('つづきから（'+N(islName(ISLAND))+'・Day '+S.day+'）','Continue ('+N(islName(ISLAND))+', day '+S.day+')'))+'</div><div class="d">'+(TOUCH ? L('1本指で移動・2本指で拡大と回転・タップで伐採や建物を選ぶ','1 finger pans, 2 fingers zoom & rotate, tap to chop or select') : L('左ドラッグ：回転　右ドラッグ：移動　ホイール：拡大　クリック：伐採・建物を選ぶ','Left-drag rotate, right-drag pan, wheel zoom, click to chop or select'))+'</div></button>' +
    (fresh ? '' : '<div style="height:14px"></div><button class="opt" data-act="confirmReset"><div class="n">'+L('この島を最初からやり直す','Start this island over')+'</div></button>') +
    (backups().length ? '<button class="opt" data-act="restoreMenu"><div class="n">'+L('前のセーブに戻す','Restore a save')+'</div><div class="d">'+L('毎朝の自動保存・やり直す前の島','Morning autosaves and islands before a restart')+'</div></button>' : '') + '</div>');
  $('#modal').hidden = false;
}
S = VISIT ? visitState() : (load() || newState());
for (const k of ITEM_KEYS){ S.items[k] ??= 0; S.sat[k] ??= 1; S.stats.made[k] ??= 0; S.stats.soldBy[k] ??= 0; }
makeClouds();
orderChips();
const grazingIsNew = !VISIT && initHerd();
if (isFarm){ S.upg.pump ??= 0; calcFlow(); }
initWorld();
if (isFarm && !VISIT) migrateRiver();
spawnCritters();
// 放牧が入る前から遊んでいる酪農の島には、遊び方を一度だけ知らせる
if (grazingIsNew && !S.arrived && S.day > 1) eventQueue.push({result:true, img:'d_meadow', title:L('放牧がはじまった','Grazing begins'), text:dairyGuide()});
applySettings();
renderTop();
if (S.tut < 0) for (const e of EVENTS) if (e.fixed && islOk(e) && !S.doneEvents[e.id] && S.day >= e.fixed){ queuedIds[e.id] = true; const E = e.make(); E.id = e.id; eventQueue.push(E); }
if (VISIT){ enterVisit(); eventQueue.length = 0; } else if (S.arrived) showArrival(); else showTitle();
requestAnimationFrame(frame);

// テスト・デバッグ用の窓口
window.DTT = {get S(){return S;}, P, W, WH, place, hire, levelUp, sell, clickCell, collect, moveBuilding, chooseEvent, workers, allB, evaluate, treeCount, sim, onDawn, EVENTS, eventQueue, critters, expandIsland,
  buyUpg, planRiver, riverCells, dryCount, get waterAll(){return waterAll;},
  skipTut:()=>{S.tut=-1;$('#tut').hidden=true;}, reset:resetGame,
  screenOf:(i)=>{const p=wpos(i); return toScreen(p.x,0,p.z);},
  bench:(n=30)=>{const px=new Uint8Array(4);const gl=renderer.getContext();const t0=performance.now();for(let k=0;k<n;k++){renderer.setRenderTarget(rt);renderer.render(scene,cam);renderer.setRenderTarget(null);renderer.render(postScene,postCam);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}return (performance.now()-t0)/n;},
  calcScore, totalScore, showScore,
  visitURL, showShare, get shareBlob(){return shareBlob;}, VISIT,
  useTool, toolWhy, growRate, season, refreshWater, isWet, CROPS, get waterLive(){return waterLive;},
  setBell, milkByHand, buyCow, cowCost, cowCap, pastureAt, isMud,
  festActive, showFestStill, get festHeard(){return festHeard;},
  demolish, setDrive, updatePaths, regroup, entryOf, nodePt, strollers, razes, postMesh, pathMesh, get socialEdges(){return socialEdges;},
  ISL, ISLAND, BUILD, ITEMS, travel, save, showEnding, showTravel, pop, housing,
  get trade(){return trade;}, tourists, backups, airPhase, get airship(){return airship;}, camS, buildDock, buildAirship, updateTiles, moodBreakdown, offDuty, whale, get mode(){return mode;}, setLang:(l)=>{SET.lang=l; applySettings(); renderTop();}};
