// ジオラマアイランド / Diorama Island
// 中身は3D、見た目はドット絵の浮島街づくりタイクーン
import * as THREE from 'three';

/* =========================================================
   設定（言語など。セーブデータとは別に保存）
   ========================================================= */
const SETTINGS_KEY = 'di_settings_v1';
const SET = Object.assign(
  {lang: (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en', icons:'auto', sound:true, pixel:3, shake:true, shadows:true, ui:1},
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
  walk: 1.7, chopTime: 1.5, quarryTime: 1.8, digTime: 1.6,
  treeHP: 4, rockHP: 15, saplingTime: 45, regrowTick: 4, regrowP: 0.0035,
  satDrop: 0.02, satRecover: 0.008, satFloor: 0.3,
  goal: 12000, stoneBuy: 15, haulCap: 4, moveTime: 10, buildTime: 3,
  reserveStone: 520, reserveOre: 280,      // 地下の埋蔵量（大量だが無尽蔵ではない）
  balloonEvery: 28,                        // 交易気球が来る間隔（秒）
  farFrom: 3, farK: 0.12,                  // 持ち場から3マスを超えると急に効率が落ちる
};
const ITEMS = {
  log:   {n:['丸太','Logs'],            p:10,  c:0x9a6a3a},
  plank: {n:['板材','Planks'],          p:35,  c:0xe0be80},
  furn:  {n:['高級家具','Furniture'],   p:150, c:0xb84a3a},
  stone: {n:['石材','Stone'],           p:6,   c:0xa8aeb8},
  ore:   {n:['鉄鉱石','Iron Ore'],      p:50,  c:0x7a5a7e},
  ingot: {n:['鉄インゴット','Ingots'],  p:200, c:0xd8e0ea},
  gear:  {n:['歯車・機械','Machinery'], p:800, c:0xe8b840},
};
const ITEM_KEYS = Object.keys(ITEMS);
const BUILD = {
  warehouse:{n:['市場と桟橋','Market & Dock'], cost:{g:200}, hidden:true, light:true,
    d:['品物を貯めて交易気球に売る。運搬係はここから出かける','Stores goods and trades with balloons. Haulers start here.']},
  camp:     {n:['木こり小屋','Lumber Camp'], cost:{g:60}, job:'chop', cat:'res',
    d:['近くの木を伐って小屋に貯める。遠い木ほど時間がかかる','Chops nearby trees and stores the logs. Far trees take much longer.']},
  quarry:   {n:['採石場','Quarry'], cost:{g:300}, job:'quarry', ind:true, cat:'res',
    d:['近くの岩を割って石材を貯める。坑道が開けば地下を掘る','Breaks nearby rocks into stone. Digs underground once a shaft opens.']},
  forester: {n:['植林小屋','Forester'], cost:{g:250}, plant:true, cat:'res',
    d:['まわりに苗木を植える','Plants saplings around it.']},
  sawmill:  {n:['製材所','Sawmill'], cost:{g:150}, in:'log', out:'plank', time:3, ind:true, partner:'workshop', cat:'proc',
    d:['丸太→板材。家具工房の隣だと速い','Logs → Planks. Faster next to a Workshop.']},
  workshop: {n:['家具工房','Workshop'], cost:{g:700,stone:3}, in:'plank', out:'furn', time:6, ind:true, partner:'sawmill', light:true, cat:'proc',
    d:['板材→高級家具。製材所の隣だと速い','Planks → Furniture. Faster next to a Sawmill.']},
  smelter:  {n:['製鉄所','Smelter'], cost:{g:2500,stone:6}, in:'ore', out:'ingot', time:5, ind:true, partner:'factory', req:'mine', light:true, cat:'proc',
    d:['鉄鉱石→鉄インゴット。機械工場の隣だと速い','Iron Ore → Ingots. Faster next to a Factory.']},
  factory:  {n:['機械工場','Factory'], cost:{g:4500,stone:10}, in:'ingot', out:'gear', time:8, ind:true, partner:'smelter', req:'mine', light:true, cat:'proc',
    d:['インゴット→歯車・機械。製鉄所の隣だと速い','Ingots → Machinery. Faster next to a Smelter.']},
  house:    {n:['住宅','House'], cost:{g:120}, housing:3, light:true, near:true, cat:'life',
    d:['3人住める。近くの職場は通勤が速い。工場の隣はうるさい','Homes 3. Nearby workplaces get faster commutes. Noisy next to factories.']},
  bakery:   {n:['パン屋','Bakery'], cost:{g:450,stone:2}, mood:6, upkeep:20, light:true, near:true, cat:'life',
    d:['みんなの幸福が上がる（毎日20G）','Raises happiness (20G/day).']},
};
const CATS = [['res',['資源','Resources']], ['proc',['加工','Crafting']], ['life',['暮らし','Living']]];
const UPGS = [
  {id:'route', n:['交易気球の定期便','Trade Balloon Route'], cost:[400],
    d:['気球が来るたびに、選んだ品物を自動で売る','Each balloon visit auto-sells the goods you choose.']},
  {id:'axe',   n:['よく切れる道具','Sharp Tools'], cost:[200,1200,5000],
    d:['クリックの収穫+1・伐採と採掘が速くなる','+1 per click; faster chopping and mining.']},
  {id:'carry', n:['丈夫な背負子','Sturdy Packs'], cost:[300,1500,6000],
    d:['一度に運べる量が増える','Workers carry more at once.']},
  {id:'road',  n:['石畳の道','Cobblestone'], cost:[800,3000],
    d:['よく通る道が石畳になり、その上は速く歩ける','Worn paths get paved, and walking on them is faster.']},
];
const HOUSE_WALLS = [0xf2d9b0, 0xd9e6f2, 0xf2c9c9, 0xd8f0c8, 0xf0e6a8, 0xe4e4e4, 0xc9b8e8];
const HOUSE_ROOFS = [0xd05a4a, 0x4a6ab0, 0x3a8a6a, 0xa05ac0, 0xd08a3a, 0x5a5a5a, 0x2a8ab0];
const HOUSE_STYLES = [['三角屋根','Hip roof'], ['切妻屋根','Gable roof'], ['とんがり屋根','Spire'], ['平屋根と花','Flat & flowers']];
const LOOK_COST = 20;
const W = 12, WH = 5 + 10*W;   // 盤面は12×12。最初は中央の10×10が島。市場は(5,10)
const DEBUG = /debug/.test(location.search);

/* ========================================================= 汎用 */
const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random()*(b-a);
const fmt = n => { n = Math.floor(n); return Math.abs(n) >= 1e6 ? (n/1e6).toFixed(2)+'M' : n.toLocaleString(SET.lang === 'en' ? 'en-US' : 'ja-JP'); };
const cx = i => i % W, cz = i => Math.floor(i / W);
const wpos = i => ({x: cx(i) - (W-1)/2, z: cz(i) - (W-1)/2});
const cellAt = (x, z) => clamp(Math.floor(z + W/2), 0, W-1)*W + clamp(Math.floor(x + W/2), 0, W-1);
const cheb = (a,b) => Math.max(Math.abs(cx(a)-cx(b)), Math.abs(cz(a)-cz(b)));
const neigh8 = i => { const r=[]; for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dz)continue; const x=cx(i)+dx,z=cz(i)+dz; if(x>=0&&x<W&&z>=0&&z<W) r.push(z*W+x);} return r; };
const neigh4 = i => { const r=[]; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=cx(i)+dx,z=cz(i)+dz; if(x>=0&&x<W&&z>=0&&z<W) r.push(z*W+x); } return r; };
const hash = (a, b=0) => { const s = Math.sin(a*127.1 + b*311.7 + 13.13) * 43758.5453; return s - Math.floor(s); };

/* ========================================================= 状態 */
let S;
function newState(){
  const s = {
    v:1, seed:Math.random()*1000, gold:P.startGold, items:{}, sat:{}, auto:{}, seen:{log:true}, satCap:{},
    day:1, time:P.dayLen*P.dayFrac*3/14, mood:65, speed:1,
    tut:0, flags:{mine:false, sacred:false, steam:false, craft:false, forest:false, protectUntil:0, holidayDay:0, wageBonus:0, crack:false, stoneSafeUntil:0},
    upg:{route:0, axe:0, carry:0, road:0}, nightShift:false, nightUsed:false, nsStreak:0,
    contracts:[], loans:[], story:[], doneEvents:{}, lastEvent:'', airport:false,
    land:{x0:1,x1:10,z0:1,z1:10}, expand:0, wear:[], res:{stone:P.reserveStone, ore:P.reserveOre}, resTotal:P.reserveStone + P.reserveOre,
    festDay:0, rainDay:0, whaleDay:0, meteorNight:0,
    stats:{earned:0, sold:0, soldBy:{}, made:{}, treesCut:0, planted:0, nightShifts:0, festivals:0, holidays:0, contractsDone:0, contractsFail:0, loans:0, quits:0, moodSum:0, moodN:0, clicks:0, collects:0, pets:0},
    cells:[],
  };
  for (const k of ITEM_KEYS){ s.items[k]=0; s.sat[k]=1; s.auto[k]=false; s.stats.made[k]=0; s.stats.soldBy[k]=0; }
  for (let i=0;i<W*W;i++){ const x = cx(i), z = cz(i); s.cells.push(x>=1 && x<=10 && z>=1 && z<=10 ? {t:'grass', r:Math.random()} : {t:'void'}); s.wear.push(0); }
  const centers = [[2.5,3],[8.5,2.5],[2.5,7.5],[9,7]].sort(()=>Math.random()-.5).slice(0,3);
  for (let i=0;i<W*W;i++){
    if (s.cells[i].t === 'void' || cheb(i,WH) <= 1) continue;
    let best = 99; for (const [x,z] of centers) best = Math.min(best, Math.hypot(cx(i)-x, cz(i)-z));
    if (best < 2.4 && Math.random() < 0.62) s.cells[i] = {t:'tree', hp:P.treeHP, r:Math.random()};
  }
  let rocks = 0, guard = 0;
  while (rocks < 8 && guard++ < 500){
    const i = Math.floor(Math.random()*W*W);
    if (s.cells[i].t !== 'grass' || cheb(i,WH) <= 2) continue;
    s.cells[i] = {t:'rock', hp:P.rockHP, r:Math.random()}; rocks++;
  }
  s.cells[WH] = {t:'b', r:.5, b:{type:'warehouse', lvl:1, workers:0, inb:0, st:{}, prog:0, build:0}};
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
    stars:{value:STARS}, yaw:{value:0}, meteor:{value:new THREE.Vector4(0,0,0,2)}, outline:{value:1} },
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader:`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res;
    uniform vec3 skyTop; uniform vec3 skyBot; uniform float night; uniform float time; uniform float edgeTh; uniform float outline;
    #define NSTAR ${STARS.length}
    uniform vec4 stars[NSTAR]; uniform float yaw; uniform vec4 meteor;
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
          if (meteor.w < 1.0){
            vec2 D = normalize(vec2(cos(meteor.z), sin(meteor.z)) * res);
            vec2 rel = vUv*res - (meteor.xy + vec2(cos(meteor.z), sin(meteor.z))*meteor.w*0.3)*res;
            float along = dot(rel, D), perp = abs(rel.x*D.y - rel.y*D.x);
            if (along < 0.0 && along > -28.0 && perp < 0.75) col += vec3(1.0,0.95,0.8) * (1.0 + along/28.0) * night * (1.0 - meteor.w);
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
function makeRT(){
  if (rt){ rt.depthTexture.dispose(); rt.dispose(); }
  const sc = Math.min(innerWidth, innerHeight) < 600 ? Math.max(2, SET.pixel - 1) : SET.pixel;
  const w = Math.max(64, Math.floor(innerWidth / sc)), h = Math.max(64, Math.floor(innerHeight / sc));
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
  const a = innerWidth / innerHeight, h = Math.max(13, 16 / a) / camS.zoom;
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
for (let i=0;i<LIGHT_N;i++){ const l = new THREE.PointLight(0xffb060, 0, 2.6, 2); l.position.set(0,-10,0); scene.add(l); lightPool.push({l, cell:-1, fire:false}); }

/* ---- マテリアルと形 */
const gradTex = new THREE.DataTexture(new Uint8Array([80,80,80,255, 165,165,165,255, 255,255,255,255]), 3, 1);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true;
const matCache = {};
const MT = hex => matCache[hex] || (matCache[hex] = new THREE.MeshToonMaterial({color:hex, gradientMap:gradTex}));
const winMat  = new THREE.MeshToonMaterial({color:0x3a4868, emissive:0xffc860, emissiveIntensity:0, gradientMap:gradTex});
const fireMat = new THREE.MeshToonMaterial({color:0x902a10, emissive:0xff6a1a, emissiveIntensity:0.7, gradientMap:gradTex});
const ghostOk = new THREE.MeshBasicMaterial({color:0x7ee08a, transparent:true, opacity:0.55, depthWrite:false});
const ghostNg = new THREE.MeshBasicMaterial({color:0xff6b6b, transparent:true, opacity:0.55, depthWrite:false});
const G = {
  box: new THREE.BoxGeometry(1,1,1), cyl: new THREE.CylinderGeometry(1,1,1,8), cyl6: new THREE.CylinderGeometry(1,1,1,6), cyl3: new THREE.CylinderGeometry(1,1,1,3),
  ico1: new THREE.IcosahedronGeometry(1,1), cone4: new THREE.ConeGeometry(1,1,4), cone6: new THREE.ConeGeometry(1,1,6),
  ico: new THREE.IcosahedronGeometry(1,0), dod: new THREE.DodecahedronGeometry(1,0), sph: new THREE.IcosahedronGeometry(1,2),
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
const islandDirt = part(G.box, 0x9a6440, 8, 0.9, 8, 0, -0.75, 0); islandDirt.castShadow = false; scene.add(islandDirt);
const rockBase = part(G.cone6, 0x6a4c3c, 6.6, 4.2, 6.6, 0, -3.3, 0); rockBase.rotation.x = Math.PI; rockBase.rotation.y = 0.3; scene.add(rockBase);
const rb2 = part(G.cone6, 0x55402f, 3.2, 2.6, 3.2, 0.6, -6.3, -0.4); rb2.rotation.x = Math.PI; scene.add(rb2);
for (let k=0;k<5;k++){ const a=k/5*Math.PI*2+0.4, r=8+k%2; const f = part(G.dod, 0x6a4c3c, 0.5+k%3*0.2, 0.4, 0.5, Math.cos(a)*r, -2.5-k%3, Math.sin(a)*r); f.userData.float = k; scene.add(f); floaters.push(f); }

// 地面：市松の芝
const TILE_A = new THREE.Color(0x86c95e), TILE_B = new THREE.Color(0x7bbd56);
function updateTiles(){
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0,0,0), col = new THREE.Color();
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t === 'void'){ tileMesh.setMatrixAt(i, zero); continue; }
    const p = wpos(i); m4.makeTranslation(p.x, -0.15, p.z); tileMesh.setMatrixAt(i, m4);
    col.copy(((cx(i)+cz(i))%2) ? TILE_A : TILE_B); col.offsetHSL(0, 0, ((i*37)%7-3)*0.006); tileMesh.setColorAt(i, col);
  }
  tileMesh.instanceMatrix.needsUpdate = true; tileMesh.instanceColor.needsUpdate = true;
  const Ld = S.land, w = Ld.x1-Ld.x0+1, h = Ld.z1-Ld.z0+1;
  islandDirt.scale.set(Math.max(0.1, w-2), 0.9, Math.max(0.1, h-2));
  islandDirt.position.set((Ld.x0+Ld.x1)/2 - (W-1)/2, -0.75, (Ld.z0+Ld.z1)/2 - (W-1)/2);
  buildStrata();
}

// 自動でできる細い道：よく通るマスの中心と、通るマス同士・建物をつなぐ
const pathMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,0.02,1), MT(0xffffff), W*W*5);
pathMesh.receiveShadow = true; scene.add(pathMesh);
const PATH_C = new THREE.Color(0xcfb27a), PAVE_C = new THREE.Color(0xb3afa8);
function updatePaths(){
  const m4 = new THREE.Matrix4(), col = new THREE.Color(); let n = 0;
  const worn = i => S.cells[i].t !== 'void' && S.cells[i].t !== 'b' && S.wear[i] > 0.22;
  const put = (x, z, sx, sz, wv) => {
    m4.makeScale(sx, 1, sz); m4.setPosition(x, 0.012, z); pathMesh.setMatrixAt(n, m4);
    col.copy(S.upg.road && wv > 0.45 ? PAVE_C : PATH_C); col.offsetHSL(0, 0, (1-Math.min(1,wv))*0.05); pathMesh.setColorAt(n, col); n++;
  };
  for (let i=0;i<W*W;i++){
    if (!worn(i)) continue;
    const p = wpos(i), wv = S.wear[i], w = 0.18 + Math.min(0.08, wv*0.1);
    put(p.x, p.z, w, w, wv);
    for (const j of neigh4(i)){
      if (!(worn(j) || S.cells[j].t === 'b')) continue;
      const q = wpos(j), dx = q.x - p.x, dz = q.z - p.z;
      put(p.x + dx*0.25, p.z + dz*0.25, dx ? 0.5 : w, dz ? 0.5 : w, wv);
    }
  }
  pathMesh.count = n; pathMesh.instanceMatrix.needsUpdate = true; if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;
}

// 島の断面：まわりの崖に地層が見える。坑道を掘るとトンネルとランタンが現れる
const strataMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,0.3,1), MT(0xffffff), 160);
strataMesh.receiveShadow = true; scene.add(strataMesh);
const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08,0.08,0.08), new THREE.MeshBasicMaterial({color:0xffd080}), 160); scene.add(lampMesh);
const UG_COL = {1:0x8a5a3a, 2:0x8f949e, 3:0xa05ac8};
let strata = [], strataDug = -1;
function buildStrata(){
  strata = [];
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t === 'void') continue;
    let nx = 0, nz = 0;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x = cx(i)+dx, z = cz(i)+dz; if (x<0||x>=W||z<0||z>=W||S.cells[z*W+x].t==='void'){ nx += dx; nz += dz; } }
    if (!nx && !nz) continue;
    const Ln = Math.hypot(nx, nz); nx /= Ln; nz /= Ln;
    for (let Ly=0; Ly<3; Ly++){
      const h = hash(i + Ly*200, S.seed), oreP = [0.08,0.2,0.35][Ly];
      strata.push({i, L:Ly, kind: h < oreP ? 3 : h < oreP + 0.5 ? 2 : 1, order: hash(i*7 + Ly, S.seed + 1), nx, nz});
    }
  }
  strata.sort((a,b)=>a.order-b.order);
  strataDug = -1; updateStrata();
}
function dugCount(){ return S.flags.mine ? Math.round(strata.length * clamp(1 - (S.res.stone + S.res.ore)/S.resTotal, 0, 1)) : 0; }
function updateStrata(){
  const dn = dugCount(); if (dn === strataDug) return; strataDug = dn;
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0,0,0), col = new THREE.Color();
  strata.forEach((v, k) => {
    const p = wpos(v.i), y = -0.45 - v.L*0.3, dug = k < dn;
    m4.makeTranslation(p.x, y, p.z); strataMesh.setMatrixAt(k, m4);
    col.set(dug ? 0x2a1c14 : UG_COL[v.kind]); col.offsetHSL(0, 0, ((v.i*7+v.L*3)%5-2)*0.012 - v.L*0.04); strataMesh.setColorAt(k, col);
    if (dug && k % 3 === 0){ m4.makeTranslation(p.x + v.nx*0.5, y + 0.05, p.z + v.nz*0.5); lampMesh.setMatrixAt(k, m4); } else lampMesh.setMatrixAt(k, zero);
  });
  strataMesh.count = strata.length; lampMesh.count = strata.length;
  strataMesh.instanceMatrix.needsUpdate = true; if (strataMesh.instanceColor) strataMesh.instanceColor.needsUpdate = true; lampMesh.instanceMatrix.needsUpdate = true;
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
const trade = {state:'away', t:8};

// となりの島（遠くに見える）：次は酪農、その次は農耕の島
const farIslands = [];
function makeFarIsland(kind){
  const g = new THREE.Group();
  g.add(part(G.box, kind === 'dairy' ? 0x8cc860 : 0x9ccc62, 5, 0.35, 5, 0, -0.17, 0));
  g.add(part(G.box, 0x9a6440, 5, 0.8, 5, 0, -0.75, 0));
  const c = part(G.cone6, 0x6a4c3c, 3.4, 3, 3.4, 0, -2.6, 0); c.rotation.x = Math.PI; g.add(c);
  if (kind === 'dairy'){
    g.add(part(G.box, 0xb83a2a, 1.2, 0.8, 0.9, -1, 0.4, -1));
    const r = part(G.cyl3, 0x5a3a2a, 0.55, 1.25, 0.55, -1, 0.95, -1); r.rotation.z = Math.PI/2; r.rotation.y = Math.PI/2; g.add(r);
    g.add(part(G.cyl, 0xd8d8d8, 0.3, 1.3, 0.3, -0.1, 0.65, -1.3)); g.add(part(G.sph, 0xd8d8d8, 0.3, 0.2, 0.3, -0.1, 1.3, -1.3));
    for (let k=0;k<10;k++) g.add(part(G.box, 0xe8e0c8, 0.05, 0.25, 0.05, -2.2 + k*0.45, 0.12, 1.9));
    for (let k=0;k<4;k++){ const cw = new THREE.Group(); cw.add(part(G.box, 0xf4f4f4, 0.4,0.22,0.22, 0,0.25,0)); cw.add(part(G.box, 0x222222, 0.14,0.14,0.23, 0.05,0.28,0)); cw.add(part(G.box, 0xf4f4f4, 0.14,0.14,0.14, 0.25,0.32,0)); cw.position.set(0.3 + (k%2)*0.8, 0, 0.3 + Math.floor(k/2)*0.7); cw.rotation.y = k; g.add(cw); }
  } else {
    for (let k=0;k<6;k++) g.add(part(G.box, k%2 ? 0xd8c050 : 0x6a9a3a, 0.7, 0.08, 3.2, -1.9 + k*0.72, 0.04, 0.4));
    g.add(part(G.cyl, 0xe8dcc0, 0.3, 1.4, 0.35, 1.4, 0.7, -1.5)); g.add(part(G.cone6, 0x8a4a3a, 0.4, 0.4, 0.4, 1.4, 1.6, -1.5));
    const blades = new THREE.Group(); blades.position.set(1.4, 1.2, -1.1);
    for (let k=0;k<4;k++){ const b = part(G.box, 0xf4f0e0, 0.12, 0.9, 0.03, Math.cos(k*Math.PI/2)*0.45, Math.sin(k*Math.PI/2)*0.45, 0); b.rotation.z = k*Math.PI/2; blades.add(b); }
    g.add(blades); g.userData.blades = blades;
  }
  return g;
}
{
  const d = makeFarIsland('dairy'); d.position.set(17, -3, -17); d.scale.setScalar(0.62); scene.add(d); farIslands.push(d);
  const f = makeFarIsland('farm'); f.position.set(-22, -4.5, -10); f.scale.setScalar(0.5); scene.add(f); farIslands.push(f);
}

// 雲クジラ
const whale = new THREE.Group();
{
  const body = new THREE.Mesh(G.ico1, MT(0xf4f8ff)); body.scale.set(2.6,1.0,1.1); whale.add(body);
  const belly = new THREE.Mesh(G.ico1, MT(0xdfe8f4)); belly.scale.set(2.2,0.6,0.9); belly.position.set(0.2,-0.45,0); whale.add(belly);
  const tail = new THREE.Mesh(G.ico1, MT(0xf4f8ff)); tail.scale.set(0.5,0.18,1.1); tail.position.set(-2.8,0.35,0); whale.add(tail); whale.userData.tail = tail;
  for (const z of [-0.9, 0.9]){ const f = new THREE.Mesh(G.ico1, MT(0xf4f8ff)); f.scale.set(0.6,0.12,0.4); f.position.set(0.6,-0.5,z); whale.add(f); }
  for (const z of [-0.75, 0.75]) whale.add(part(G.box, 0x2a2a40, 0.1,0.1,0.06, 2.1,0.15,z));
  whale.traverse(o=>{ if (o.isMesh) o.castShadow = true; });
  whale.visible = false; scene.add(whale);
}
const rain = []; for (let k=0;k<60;k++){ const m = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({color:0xbfe0ff})); m.scale.set(0.02,0.25,0.02); m.visible = false; scene.add(m); rain.push(m); }
// 島を浮かべている浮遊石
const leviStone = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshToonMaterial({color:0x4a8af0, emissive:0x3a7ae0, emissiveIntensity:0.8, gradientMap:gradTex}));
leviStone.scale.set(0.9,1.4,0.9); leviStone.position.set(0, -6.6, 0); scene.add(leviStone);

/* =========================================================
   建物・木・岩・住民の見た目
   ========================================================= */
function makeTree(c){
  const g = new THREE.Group();
  const tones = c.gold ? [0xd8a820, 0xf4d040] : [[0x2f8f4a,0x46ad5c],[0x2a8044,0x3e9e52],[0x3a9a48,0x5cbf62]][Math.floor(c.r*3)];
  g.add(part(G.cyl6, 0x7a4a2a, 0.08, 0.36, 0.08, 0, 0.18, 0));
  g.add(part(G.cone6, tones[0], 0.36, 0.55, 0.36, 0, 0.58, 0));
  g.add(part(G.cone6, tones[1], 0.27, 0.45, 0.27, 0, 0.88, 0));
  g.rotation.y = c.r * 6.28; g.userData.base = 0.85 + c.r*0.3;
  return g;
}
function makeRock(c){
  const g = new THREE.Group();
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
      g.add(part(G.box, 0x8a6a40, 0.5,0.06,1.2, 0.1,-0.03,0.95));
      for (const z of [0.6, 1.0, 1.45]) g.add(part(G.cyl6, 0x6a4a2a, 0.04,0.7,0.04, 0.33,-0.3,z));
      g.add(part(G.cyl, 0xdddddd, 0.02,0.6,0.02, 0.38,0.8,0.25)); g.add(part(G.box, 0xe04040, 0.22,0.13,0.02, 0.5,1.02,0.25));
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
      const gear = new THREE.Group(); gear.position.set(0.47,0.3,0.15); gear.rotation.z = Math.PI/2;
      gear.add(part(G.cyl, 0xe8b840, 0.16,0.05,0.16, 0,0,0));
      for (let k=0;k<6;k++){ const t = part(G.box, 0xe8b840, 0.06,0.05,0.08, Math.cos(k*Math.PI/3)*0.19,0,Math.sin(k*Math.PI/3)*0.19); t.rotation.y = -k*Math.PI/3; gear.add(t); }
      g.add(gear); u.spin.push([gear,'y',3]);
      g.add(part(G.cyl, 0x666666, 0.07,0.6,0.07, -0.3,0.75,-0.25)); u.smoke=[-0.3,1.06,-0.25];
      win(g, -0.2,0.25,0.405); win(g, 0.1,0.25,0.405); u.light=[0,0.4,0.6];
      break; }
  }
  // 工事中の足場（建設・移動のあいだだけ見える）
  const sc = new THREE.Group();
  for (const [x,z] of [[-.4,-.4],[.4,-.4],[-.4,.4],[.4,.4]]) sc.add(part(G.box, 0xc8a060, 0.04,0.8,0.04, x,0.4,z));
  for (const y of [0.3, 0.7]) for (const [x,z,sx,sz] of [[0,-.4,.84,.04],[0,.4,.84,.04],[-.4,0,.04,.84],[.4,0,.04,.84]]) sc.add(part(G.box, 0xc8a060, sx,0.04,sz, x,y,z));
  sc.visible = false; g.add(sc); u.scaffold = sc;
  return g;
}
function makeWorkerMesh(job){
  const g = new THREE.Group();
  const col = {chop:0x3a7a3a, quarry:0x5a5a7a, proc:0x3a5ab0, haul:0xd0802a}[job] || 0x3a5ab0;
  const body = part(G.box, col, 0.14,0.15,0.1, 0,0.13,0);
  const head = part(G.box, 0xf0c8a0, 0.13,0.12,0.12, 0,0.27,0);
  const hat  = part(G.box, job==='chop'?0xd04030:job==='quarry'?0xe8c030:job==='haul'?0x3a6ab0:0xf0f0f0, 0.15,0.04,0.14, 0,0.35,0);
  const legL = part(G.box, 0x3a2a1a, 0.05,0.07,0.06, -0.035,0.035,0), legR = part(G.box, 0x3a2a1a, 0.05,0.07,0.06, 0.035,0.035,0);
  const carry = part(G.box, 0xffffff, 0.12,0.08,0.12, 0,0.43,0); carry.visible = false;
  g.add(body, head, hat, legL, legR, carry);
  g.userData = {body, carry, legL, legR, head, hat};
  return g;
}

/* ---- セルのメッシュ管理 */
const CM = [];
let pickables = [];
function rebuildPickables(){ pickables = []; for (const g of CM) if (g) pickables.push(g); }
function setCellMesh(i){
  if (CM[i]) { scene.remove(CM[i]); CM[i] = null; }
  const c = S.cells[i], p = wpos(i); let g = null;
  if (c.t === 'tree' || c.t === 'sapling') g = makeTree(c);
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
const housing = () => 3 + allB('house').reduce((a,i)=>a + 3 + (S.cells[i].b.lvl-1)*2, 0);
const hourOf = t => { const d = P.dayLen*P.dayFrac; return t < d ? 5 + 14*t/d : 19 + 10*(t-d)/(P.dayLen-d); };
const isNight = () => { const h = hourOf(S.time); return h >= 19.25 || h < 5.5; };
const workTime = () => (!isNight() || (S.nightShift && S.meteorNight !== S.day)) && S.flags.holidayDay !== S.day;
const festActive = () => S.festDay === S.day && hourOf(S.time) >= 17;
const holidayNow = () => S.flags.holidayDay === S.day && !isNight();
const moodF = () => 0.5 + S.mood/100;
const carryCap = () => 2 + S.upg.carry;
const haulCap = () => P.haulCap + 2*S.upg.carry;
const bufCap = b => 6 + 3*b.lvl;
const slots = b => (b.type === 'warehouse' || BUILD[b.type].job || BUILD[b.type].in) ? Math.min(6, b.lvl + 1) : 0;
const hireCost = () => Math.round(P.hireBase * Math.pow(P.hireGrow, workerCount()));
const stTotal = b => { let n = 0; for (const k in b.st || {}) n += b.st[k]; return n; };
const stCap = b => BUILD[b.type].in ? bufCap(b) : 10 + 5*b.lvl;
function stAdd(b, it, n){ b.st = b.st || {}; b.st[it] = (b.st[it] || 0) + n; }
function stMain(b){ let best = null, bn = 0; for (const k in b.st || {}) if (b.st[k] >= 1 && b.st[k] > bn){ bn = b.st[k]; best = k; } return best; }
function buildCost(type){
  const d = BUILD[type], n = countB(type);
  return {g: Math.round(d.cost.g * Math.pow(type==='house'?1.25:1.35, n)), stone: Math.round((d.cost.stone||0) * Math.pow(1.2, n))};
}
const lvlCost = b => Math.round(BUILD[b.type].cost.g * 1.5 * Math.pow(1.8, b.lvl-1));
function price(it){
  let m = S.sat[it]; const cap = S.satCap[it]; if (cap && S.day < cap.until) m = Math.min(m, cap.v);
  const craft = S.flags.craft && (it === 'furn' || it === 'gear') ? 1.3 : 1;
  return ITEMS[it].p * m * craft;
}
function partnerAdj(i){ const d = BUILD[S.cells[i].b.type]; return !!d.partner && neigh8(i).some(j => isB(j, d.partner)); }
function nearBonus(i){ for (let j=0;j<W*W;j++) if (j!==i && S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.near && cheb(i,j) <= 2) return true; return false; }
function noisePairs(){ let n = 0; for (const h of [...allB('house'), ...allB('bakery')]) for (const j of neigh8(h)) if (S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.ind) n++; return n; }
function speedMult(i){
  const b = S.cells[i].b; let m = Math.pow(1.4, b.lvl-1) * moodF();
  if (partnerAdj(i)) m *= 1.3; if (S.flags.steam) m *= 1.35; if (S.flags.forest) m *= 0.9;
  return m;
}
function moodBreakdown(){
  const Lst = [[L('基本','Base'), 50]];
  const t = treeCount(); Lst.push([L('木の数','Trees')+'('+t+')', Math.min(18, t*0.7) * (S.flags.forest?1.5:1)]);
  const bk = allB('bakery').reduce((a,i)=>a + 6 + (S.cells[i].b.lvl-1)*3, 0); if (bk) Lst.push([L('パン屋','Bakeries'), Math.min(30, bk)]);
  if (S.flags.sacred) Lst.push([L('聖なる岩山','Sacred rocks'), 8]);
  if (S.flags.craft) Lst.push([L('職人の誇り','Craft pride'), 4]);
  if (S.flags.steam) Lst.push([L('工場の煙','Factory smoke'), -8]);
  const np = noisePairs(); if (np) Lst.push([L('工場の騒音','Factory noise')+'('+np+')', -3*np]);
  const hl = Math.max(0, workerCount() - housing()); if (hl) Lst.push([L('家なし','Homeless')+'('+hl+')', -6*hl]);
  if (S.nightShift && isNight() && workerCount()) Lst.push([L('夜勤中','Night shift'), -18]);
  return Lst;
}
const moodTarget = () => clamp(moodBreakdown().reduce((a,[,v])=>a+v, 0), 0, 100);
function addMood(v){ S.mood = clamp(S.mood + v, 0, 100); }
function story(ja, en){ S.story.push({d:S.day, t:[ja, en]}); }

/* ---- 売買（石材が足りなければ市場で買う） */
function sell(it, n, silent){
  n = Math.min(n, Math.floor(S.items[it])); if (n <= 0) return 0;
  let earn = 0;
  for (let k=0;k<n;k++){ earn += price(it); S.sat[it] = Math.max(P.satFloor, S.sat[it]*(1-P.satDrop)); }
  earn = Math.round(earn);
  S.items[it] -= n; S.gold += earn; S.stats.earned += earn; S.stats.sold += n; S.stats.soldBy[it] += n;
  if (!silent){ popAt(wpos(WH).x, 1.2, wpos(WH).z, '+'+fmt(earn)+'G', 'g'); coinBurst(Math.min(8, 1+Math.floor(earn/60))); sfx('coin'); }
  return earn;
}
const stoneShort = c => Math.max(0, (c.stone||0) - Math.floor(S.items.stone));
const totalGold = c => c.g + stoneShort(c) * P.stoneBuy;
function canPay(c){ return S.gold >= totalGold(c); }
function pay(cost){
  if (!canPay(cost)) return false;
  const short = stoneShort(cost);
  if (short){ S.gold -= short * P.stoneBuy; S.items.stone += short; toast(L('足りない石材 '+short+'個を市場で購入（-'+fmt(short*P.stoneBuy)+'G）', 'Bought '+short+' missing stone (-'+fmt(short*P.stoneBuy)+'G)')); }
  S.gold -= cost.g; S.items.stone -= (cost.stone||0); return true;
}
function costTxt(c){ const sh = stoneShort(c); return fmt(c.g)+'G' + (c.stone ? ' + '+N(ITEMS.stone.n)+c.stone : '') + (sh ? '<br><small style="color:var(--sub)">'+L('不足の石材は購入 +','Missing stone: +')+fmt(sh*P.stoneBuy)+'G</small>' : ''); }
function buyStone(n){ const c = n * P.stoneBuy; if (S.gold < c) return; S.gold -= c; S.items.stone += n; S.seen.stone = true; sfx('coin'); }

/* ---- 建設・移動・撤去 */
function canPlace(type, i){
  const c = S.cells[i];
  if (c.t === 'void') return L('島の外です（新エリアで島を広げられる）','Outside the island (expand it from New Areas)');
  if (c.t === 'b') return L('すでに建物がある','Already built here');
  if (c.t === 'rock') return L('岩がある','A rock is here');
  if (type && BUILD[type].req === 'mine' && !S.flags.mine) return L('まだ建てられない','Not unlocked yet');
  if (type && !canPay(buildCost(type))) return L('お金が足りない','Not enough gold');
  return '';
}
function newB(type){ return {type, lvl:1, workers:0, inb:0, st:{}, prog:0, build:P.buildTime, buildMax:P.buildTime}; }
function clearSpot(i){
  const c = S.cells[i];
  if (c.t === 'tree'){ const n = c.hp * (c.gold ? 3 : 1); S.items.log += n; S.stats.treesCut++; popAt(wpos(i).x, 0.8, wpos(i).z, '+'+n+' '+N(ITEMS.log.n)); }
  if (reserved[i]) delete reserved[i];
}
function place(type, i){
  if (canPlace(type, i)) return false;
  pay(buildCost(type)); clearSpot(i);
  const b = newB(type); if (type === 'house') b.look = houseLook(null, Math.random());
  S.cells[i] = {t:'b', r:Math.random(), b};
  setCellMesh(i); CM[i].userData.pop = 0.35; sfx('build'); shake(0.06);
  burst(wpos(i).x, 0.3, wpos(i).z, 'stone', 6);
  assignLights(); return true;
}
function moveBuilding(from, to){
  if (from === to || canPlace(null, to)) return false;
  const src = S.cells[from], b = src.b;
  clearSpot(to);
  b.build = P.moveTime; b.buildMax = P.moveTime;
  S.cells[to] = {t:'b', r:src.r, b};
  S.cells[from] = {t:'grass', r:Math.random()};
  for (const w of workers) if (w.bi === from){ release(w); w.bi = to; w.tasks = []; w.under = false; }
  delete haulRes[from];
  setCellMesh(from); setCellMesh(to); CM[to].userData.pop = 0.35;
  sfx('build'); assignLights(); if (selCell === from) select(to);
  toast(L('移動中…（'+P.moveTime+'秒ほどで再開）', 'Moving… (back to work in ~'+P.moveTime+'s)'));
  return true;
}
function demolish(i){
  const b = S.cells[i].b; if (!b || b.type === 'warehouse') return;
  while (b.workers > 0) removeWorker(i);
  S.gold += Math.round(BUILD[b.type].cost.g * 0.4);
  if (BUILD[b.type].in) S.items[BUILD[b.type].in] += b.inb;
  for (const k in b.st || {}) S.items[k] += Math.floor(b.st[k]);
  S.cells[i] = {t:'grass', r:Math.random()}; setCellMesh(i); assignLights(); select(-1);
}
function hire(i){
  const b = S.cells[i].b;
  if (b.workers >= slots(b)) return toast(L('満員です（レベルを上げると枠が増える）','Full (level up for more slots)'),'bad');
  if (workerCount() >= housing()) return toast(L('住む家が足りない！住宅を建てよう','No room! Build a House.'),'bad');
  const c = hireCost(); if (S.gold < c) return toast(L('お金が足りない','Not enough gold'),'bad');
  S.gold -= c; addWorker(i); sfx('hire');
}
function levelUp(i){
  const b = S.cells[i].b; if (b.lvl >= 5) return;
  const c = lvlCost(b); if (S.gold < c) return;
  S.gold -= c; b.lvl++; CM[i].userData.pop = 0.35; sfx('build'); burst(wpos(i).x, 0.6, wpos(i).z, 'coin', 8);
}
function changeLook(i, key){
  const b = S.cells[i].b; if (S.gold < LOOK_COST) return;
  b.look = houseLook(b, S.cells[i].r);
  const max = {s:HOUSE_STYLES.length, w:HOUSE_WALLS.length, r:HOUSE_ROOFS.length}[key];
  b.look = {...b.look, [key]: (b.look[key] + 1) % max};
  S.gold -= LOOK_COST; setCellMesh(i); CM[i].userData.pop = 0.3; sfx('hire');
}

/* ---- 住民
   木こり：近くの木を伐って小屋に貯める／採石：岩を割る（坑道が開けば地下を掘る）
   加工：持ち場で機械を動かす／運搬係：作った物を次の加工所へ直接、余りは市場へ */
function addWorker(bi){
  const b = S.cells[bi].b; b.workers++;
  const job = b.type === 'warehouse' ? 'haul' : (BUILD[b.type].job || 'proc');
  const p = wpos(WH);
  const w = {bi, job, x:p.x + rnd(-.2,.2), z:p.z - 0.5, tasks:[], carry:null, n:0, sleep:false, under:false, t:0, ox:rnd(-.22,.22), mesh:makeWorkerMesh(job), face:0, walk:0, work:false, dance:0};
  w.mesh.position.set(w.x, 0, w.z); scene.add(w.mesh); workers.push(w);
}
function release(w){ for (const m of [reserved, haulRes]) for (const k in m) if (m[k] === w) delete m[k]; }
function removeWorker(bi){
  const idx = workers.map(w=>w.bi).lastIndexOf(bi); if (idx < 0) return;
  const w = workers[idx];
  if (w.carry) S.items[w.carry] += w.n;
  release(w); scene.remove(w.mesh); workers.splice(idx, 1); S.cells[bi].b.workers--;
}
const whPt = w => ({x: wpos(WH).x + w.ox, z: wpos(WH).z - 0.5});
const bPt = (i, w) => { const p = wpos(i); return {x:p.x + w.ox, z: Math.min(W/2 - 0.15, p.z + 0.42)}; };
const PLAZA = {x: wpos(WH).x, z: wpos(WH).z - 1.7};
function homeOf(w){ let best = WH, bd = 99; for (const h of allB('house')){ const d = cheb(h, w.bi); if (d < bd){ bd = d; best = h; } } return best; }
function findNearest(kind, from){
  let best = -1, bd = 1e9;
  for (let i=0;i<W*W;i++){
    if (S.cells[i].t !== kind || reserved[i]) continue;
    const d = Math.hypot(cx(i)-cx(from), cz(i)-cz(from)); if (d < bd){ bd = d; best = i; }
  }
  return best;
}
const upIf = w => w.under ? [{k:'up'}] : [];
const canDig = () => S.flags.mine && (S.res.stone + S.res.ore) > 0;
function plan(w){
  const c = S.cells[w.bi]; if (!c || c.t !== 'b') return [{k:'wait', d:1}];
  const b = c.b;
  if (festActive()){ const a = Math.random()*Math.PI*2, r = 0.5 + Math.random()*0.4; return [...upIf(w), {k:'go', x:PLAZA.x + Math.cos(a)*r, z:PLAZA.z + Math.sin(a)*r}, {k:'dance', d:rnd(3,6)}]; }
  if (holidayNow()){ const land = S.cells.map((c,i)=>c.t==='void'||c.t==='b'?-1:i).filter(i=>i>=0), p = wpos(land[Math.floor(Math.random()*land.length)]); return [...upIf(w), {k:'go', x:p.x + rnd(-.3,.3), z:p.z + rnd(-.3,.3)}, {k:'dance', d:rnd(2,4), calm:true}]; }
  if (!workTime()){ const h = homeOf(w); const p = h === WH ? whPt(w) : bPt(h, w); return [...upIf(w), {k:'go', ...p}, {k:'sleep'}]; }
  if (b.broken || b.build > 0) return [...upIf(w), {k:'go', ...bPt(w.bi,w)}, {k:'wait', d:1.5}];
  if (w.job === 'haul') return planHaul(w);
  if (w.job === 'chop'){
    if (S.day < S.flags.protectUntil || stTotal(b) >= stCap(b)) return [{k:'go', ...bPt(w.bi,w)}, {k:'wait', d:2}];
    const tgt = findNearest('tree', w.bi);
    if (tgt < 0) return [{k:'go', ...bPt(w.bi,w)}, {k:'wait', d:2}];
    reserved[tgt] = w;
    const tp = wpos(tgt), dx = w.x - tp.x, dz = w.z - tp.z, Ln = Math.hypot(dx,dz) || 1;
    return [{k:'go', x:tp.x + dx/Ln*0.32, z:tp.z + dz/Ln*0.32}, {k:'work', cell:tgt, kind:'tree'}, {k:'go', ...bPt(w.bi,w)}, {k:'store'}];
  }
  if (w.job === 'quarry'){
    if (stTotal(b) >= stCap(b)) return [...upIf(w), {k:'go', ...bPt(w.bi,w)}, {k:'wait', d:2}];
    if (canDig()) return [...(w.under ? [] : [{k:'go', ...bPt(w.bi,w)}, {k:'down'}]), {k:'dig', t:0}];
    const tgt = findNearest('rock', w.bi);
    if (tgt < 0) return [...upIf(w), {k:'go', ...bPt(w.bi,w)}, {k:'wait', d:3}];
    reserved[tgt] = w;
    const tp = wpos(tgt), dx = w.x - tp.x, dz = w.z - tp.z, Ln = Math.hypot(dx,dz) || 1;
    return [...upIf(w), {k:'go', x:tp.x + dx/Ln*0.34, z:tp.z + dz/Ln*0.34}, {k:'work', cell:tgt, kind:'rock'}, {k:'go', ...bPt(w.bi,w)}, {k:'store'}];
  }
  return [{k:'go', ...bPt(w.bi,w)}, {k:'op', d:2}];
}
// 運搬係：できた物は「必要としている加工所」へ直接運ぶ。行き先がなければ市場へ
function planHaul(w){
  const cap = haulCap(); let best = null, bs = 0;
  const consumer = (it, from) => { let c = -1, bd = 1e9; for (const j of allB()){ const bj = S.cells[j].b, dj = BUILD[bj.type]; if (dj.in !== it || bj.build > 0 || bj.broken || bj.inb >= bufCap(bj) - 1) continue; const d = cheb(j, from); if (d < bd){ bd = d; c = j; } } return c; };
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
  if (!best) return [{k:'go', ...whPt(w)}, {k:'wait', d:1}];
  haulRes[best.i] = w;
  if (best.kind === 'pick'){
    if (best.to === WH) return [{k:'go', ...bPt(best.i, w)}, {k:'take', i:best.i, it:best.it}, {k:'rel'}, {k:'go', ...whPt(w)}, {k:'dep'}];
    return [{k:'go', ...bPt(best.i, w)}, {k:'take', i:best.i, it:best.it, room:best.to}, {k:'rel'}, {k:'go', ...bPt(best.to, w)}, {k:'putIn', i:best.to}];
  }
  return [{k:'go', ...whPt(w)}, {k:'takeIn', i:best.i}, {k:'go', ...bPt(best.i, w)}, {k:'putIn', i:best.i}, {k:'rel'}];
}
// 持ち場から遠いほど急に遅くなる（遠い木・遠い建物は極端に非効率）
function farPenalty(w){ const d = cheb(cellAt(w.x, w.z), w.bi); return d > P.farFrom ? 1 / (1 + P.farK * (d - P.farFrom) ** 2) : 1; }
function walkSpeed(w){
  const paved = S.upg.road && S.wear[cellAt(w.x, w.z)] > 0.45;
  return P.walk * moodF() * (nearBonus(w.bi) ? 1.25 : 1) * (paved ? 1 + 0.25*S.upg.road : 1) * farPenalty(w);
}
function updateWorker(w, dt){
  w.work = false; w.dance = 0;
  if (w.sleep){ if (workTime() || festActive() || holidayNow()){ w.sleep = false; w.mesh.visible = true; w.tasks = []; } else return; }
  if (!w.tasks.length) w.tasks = plan(w);
  const t = w.tasks[0]; if (!t) return;
  const cb = S.cells[w.bi]; if (cb.t !== 'b'){ w.tasks = []; return; }
  const b = cb.b;
  switch (t.k){
    case 'go': {
      const dx = t.x - w.x, dz = t.z - w.z, Ln = Math.hypot(dx, dz), st = walkSpeed(w)*dt;
      if (Ln <= st){ w.x = t.x; w.z = t.z; w.tasks.shift(); }
      else {
        w.x += dx/Ln*st; w.z += dz/Ln*st; w.face = Math.atan2(dx, dz); w.walk += dt*14;
        const ci = cellAt(w.x, w.z); if (S.cells[ci].t === 'grass' || S.cells[ci].t === 'sapling') S.wear[ci] = Math.min(1, S.wear[ci] + dt*0.03);
      }
      break; }
    case 'wait': t.d -= dt; if (t.d <= 0) w.tasks.shift(); break;
    case 'op': t.d -= dt; w.work = true; w.t += dt; if (t.d <= 0) w.tasks.shift(); break;
    case 'dance': t.d -= dt; w.dance = t.calm ? 1 : 2; if (Math.random() < dt*0.25) popAt(w.x, 0.7, w.z, '♪'); if (t.d <= 0) w.tasks.shift(); break;
    case 'sleep': w.sleep = true; w.mesh.visible = false; w.tasks = []; break;
    case 'down': w.under = true; w.tasks.shift(); break;
    case 'up': { w.under = false; const p = bPt(w.bi, w); w.x = p.x; w.z = p.z; w.tasks.shift(); break; }
    case 'work': {
      const c = S.cells[t.cell];
      if (c.t !== t.kind || (t.kind === 'tree' && S.day < S.flags.protectUntil)){ delete reserved[t.cell]; if (w.n > 0) w.tasks.shift(); else w.tasks = []; break; }
      const tp = wpos(t.cell); w.face = Math.atan2(tp.x - w.x, tp.z - w.z); w.work = true;
      w.t += dt * moodF() * (1 + 0.25*S.upg.axe) * (1 + 0.2*(b.lvl-1));
      if (w.t >= (t.kind === 'tree' ? P.chopTime : P.quarryTime)){
        w.t = 0; c.hp--;
        if (t.kind === 'tree'){ w.carry = 'log'; w.n += c.gold ? 3 : 1; if (CM[t.cell]) CM[t.cell].userData.hit = 0.18; fellCheck(t.cell); }
        else { w.carry = 'stone'; w.n += 1; if (CM[t.cell]) CM[t.cell].userData.hit = 0.18; rockCheck(t.cell); }
        if (w.n >= carryCap() || S.cells[t.cell].t !== t.kind){ delete reserved[t.cell]; w.tasks.shift(); }
      }
      break; }
    case 'dig': {
      if (!canDig()){ w.tasks.shift(); break; }
      w.work = true; t.t += dt * moodF() * (1 + 0.25*S.upg.axe) * (1 + 0.2*(b.lvl-1));
      if (t.t >= P.digTime){
        const ore = S.res.ore > 0 && Math.random() < S.res.ore / (S.res.ore + S.res.stone);
        const it = ore ? 'ore' : 'stone', n = Math.min(2, S.res[it]);
        S.res[it] -= n; stAdd(b, it, n); S.stats.made[it] += n; S.seen[it] = true;
        if (CM[w.bi]) CM[w.bi].userData.hit = 0.1;
        if (S.res.stone + S.res.ore <= 0) toast(L('地下の鉱脈を掘り尽くした…','The underground veins are exhausted…'),'bad');
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
      if (w.carry){ w.tasks = [{k:'go', ...whPt(w)}, {k:'dep'}]; break; }   // 入りきらなかった分は市場へ
      w.tasks.shift(); break; }
    case 'dep':
      if (w.carry){ S.items[w.carry] += w.n; S.seen[w.carry] = true; }
      w.carry = null; w.n = 0; w.tasks.shift(); break;
  }
}
function fellCheck(i){
  const c = S.cells[i];
  if (c.t === 'tree' && c.hp <= 0){ S.cells[i] = {t:'grass', r:Math.random()}; setCellMesh(i); S.stats.treesCut++; burst(wpos(i).x, 0.5, wpos(i).z, 'leaf', 6); }
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
    burst(p.x, 0.6, p.z, k === 'log' ? 'log' : k === 'stone' ? 'stone' : 'item', Math.min(5, n), ITEMS[k].c);
  }
  if (d.in && S.items[d.in] >= 1 && b.inb < bufCap(b)){
    const n = Math.min(Math.floor(S.items[d.in]), bufCap(b) - b.inb); S.items[d.in] -= n; b.inb += n; got.push(L(N(ITEMS[d.in].n)+'を'+n+'個補充', 'Supplied '+n+' '+N(ITEMS[d.in].n)));
  }
  if (got.length){ popAt(p.x, 1.1, p.z, got.join(' / ')); sfx('coinS'); hitStop = 0.03; if (CM[i]) CM[i].userData.hit = 0.15; S.stats.collects++; }
  return got.length > 0;
}

/* ---- クリック（手作業） */
function clickCell(i){
  const c = S.cells[i], p = wpos(i);
  if (c.t === 'tree'){
    const n = (1 + S.upg.axe) * (c.gold ? 3 : 1);
    S.items.log += n; c.hp--; S.stats.clicks++;
    CM[i].userData.hit = 0.2; shake(0.035); hitStop = 0.045;
    burst(p.x, 0.6, p.z, 'log', 1 + Math.min(3, n)); popAt(p.x, 1.1, p.z, '+'+n+' '+N(ITEMS.log.n)); sfx('chop');
    if (reserved[i] && c.hp <= 0) delete reserved[i];
    fellCheck(i); return true;
  }
  if (c.t === 'rock'){
    const n = (1 + S.upg.axe) * (S.flags.sacred ? 2 : 1);
    S.items.stone += n; S.seen.stone = true; c.hp--; S.stats.clicks++;
    CM[i].userData.hit = 0.2; shake(0.04); hitStop = 0.05;
    burst(p.x, 0.4, p.z, 'stone', 3); popAt(p.x, 0.9, p.z, '+'+n+' '+N(ITEMS.stone.n)); sfx('rock');
    if (reserved[i] && c.hp <= 0) delete reserved[i];
    rockCheck(i); return true;
  }
  if (c.t === 'sapling'){ popAt(p.x, 0.7, p.z, L('まだ若木…','Still a sapling…')); return true; }
  if (c.t === 'b'){ if (c.b.type === 'warehouse') openPanel('market'); else { collect(i); select(i); } sfx('ui'); return true; }
  return false;
}

/* ---- 1日の区切り */
function onDawn(){
  S.day++;
  if (S.nightUsed){ S.stats.nightShifts++; S.nsStreak++; } else S.nsStreak = 0;
  S.nightUsed = false;
  const wages = workerCount() * (P.wage + S.flags.wageBonus) + allB('bakery').reduce((a,i)=>a + 20*S.cells[i].b.lvl, 0);
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
    story(ITEMS[C.it].n[0]+'の大口注文を守れなかった', 'Failed a big order of '+ITEMS[C.it].n[1]);
  }
  if (S.mood < 20 && workerCount() > 0 && Math.random() < 0.6){
    const w = workers[Math.floor(Math.random()*workers.length)]; removeWorker(w.bi); S.stats.quits++;
    toast(L('不満が爆発！住民が1人島を去った','Fed up, a resident left the island'),'bad');
  }
  // 聖地を守ると、岩が少しずつ戻ってくる
  if (S.flags.sacred && S.day % 2 === 0 && S.cells.filter(c=>c.t==='rock').length < 10){
    const g = S.cells.map((c,i)=>c.t==='grass' && !allB().some(j=>cheb(i,j)<=1) ? i : -1).filter(i=>i>=0);
    if (g.length){ const i = g[Math.floor(Math.random()*g.length)]; S.cells[i] = {t:'rock', hp:P.rockHP, r:Math.random()}; setCellMesh(i); CM[i].userData.pop = 0.4; }
  }
  if (S.meteorNight === S.day - 1){
    addMood(12);
    const gift = Math.random() < 0.5 ? Math.round(rnd(200, 600)) : 0;
    if (gift){ S.gold += gift; toast(L('願いがかなった！流れ星のかけら +','A wish came true! Star shard +')+fmt(gift)+'G','good'); }
    else toast(L('流れ星の夜を過ごして、みんなご機嫌だ','Everyone is cheerful after the meteor night'),'good');
  }
  if (S.tut < 0) queueEvent();
}

/* ---- 毎フレームの経済 */
let regrowAcc = 0, moodAcc = 0, wearAcc = 0;
function sim(dt){
  S.time += dt;
  if (S.time >= P.dayLen){ S.time -= P.dayLen; onDawn(); }
  if (S.nightShift && isNight() && workerCount()) S.nightUsed = true;
  wearAcc += dt; if (wearAcc >= 2){ wearAcc = 0; for (let i=0;i<W*W;i++) if (S.wear[i] > 0) S.wear[i] *= 0.996; }
  for (const k of ITEM_KEYS) S.sat[k] += (1 - S.sat[k]) * (S.sat[k] < 1 ? P.satRecover : 0.004) * dt;
  regrowAcc += dt;
  const regMul = (S.flags.steam ? 0.5 : 1) * (S.flags.forest ? 2 : 1) * (S.day < S.flags.protectUntil ? 3 : 1) * (S.rainDay === S.day ? 3 : 1);
  for (let i=0;i<W*W;i++){
    const c = S.cells[i];
    if (c.t === 'sapling'){ c.g += dt / P.saplingTime * (S.flags.forest ? 1.5 : 1); if (c.g >= 1){ S.cells[i] = {t:'tree', hp:P.treeHP, r:c.r}; setCellMesh(i); CM[i].userData.pop = 0.3; } }
  }
  if (regrowAcc >= P.regrowTick){
    regrowAcc -= P.regrowTick;
    for (let i=0;i<W*W;i++){
      if (S.cells[i].t !== 'grass' || i === WH) continue;
      const n = neigh8(i).filter(j=>S.cells[j].t==='tree').length;
      if (n && Math.random() < P.regrowP * n * regMul) sprout(i);
    }
  }
  // 施設
  const ops = {}; for (const w of workers) if (!w.sleep && w.job === 'proc' && !w.dance) ops[w.bi] = (ops[w.bi] || 0) + 1;
  const canWork = workTime() && !festActive();
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; if (c.t !== 'b') continue; const b = c.b, d = BUILD[b.type]; b._working = false;
    if (b.build > 0){ b.build = Math.max(0, b.build - dt); if (!b.build){ if (CM[i]) CM[i].userData.pop = 0.3; sfx('hire'); } continue; }
    if (d.in){
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
  }
  for (const w of workers) updateWorker(w, dt);
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
function sprout(i){ S.cells[i] = {t:'sapling', g:0, r:Math.random()}; setCellMesh(i); }

/* =========================================================
   毎朝の相談ごと（正解のないジレンマ）
   ========================================================= */
let eventQueue = []; const queuedIds = {};
function estPerDay(it){
  let r = 0; for (const i of allB()){ const b = S.cells[i].b, d = BUILD[b.type]; if (d.out === it && b.workers) r += P.dayLen*P.dayFrac / d.time * speedMult(i); }
  if (it === 'log') r = allB('camp').reduce((a,i)=>a + S.cells[i].b.workers*16, 0);
  return r;
}
const EVENTS = [
  {id:'vein', fixed:3, make:()=>({img:'vein', title:L('岩山に鉄の鉱脈！','An iron vein in the rocks!'), text:L('調査隊が地下に鉄の鉱脈を見つけた。一方、長老は「岩山は島の守り神じゃ」と首を振る。','Surveyors found an iron vein underground. But the elder shakes his head: "The rocks protect our island."'), opts:[
    {l:L('坑道を掘る','Open a mine shaft'), d:L('採石場が地下の石と鉄を掘るようになり、製鉄所・機械工場が建てられる。地下の量は多いが無限ではない。幸福 -5','Quarries dig stone and iron underground, and Smelters/Factories unlock. Plenty underground, but not endless. Happiness -5'), f:()=>{
      S.flags.mine = true; addMood(-5); strataDug = -1; story('長老を説得し、坑道を掘ると決めた','Convinced the elder and opened a shaft');
      return {img:'mine', title:L('坑道を掘る！','Into the mine!'), text:L('つるはしの音が島に響きはじめた。島の崖に、坑道のランタンが見えるようになる。','Pickaxes ring across the island. Lantern-lit tunnels now show in the cliffs.')}; }},
    {l:L('聖地として守る','Keep it sacred'), d:L('鉄は掘らない。そのかわり幸福 +8（ずっと）、岩をクリックした時の石材 ×2、岩が少しずつ戻ってくる','No iron. Instead: happiness +8 forever, double stone from clicks, and rocks slowly return.'), f:()=>{
      S.flags.sacred = true; story('岩山を聖地として守ると誓った','Vowed to keep the rocks sacred');
      return {img:'sacred', title:L('岩山は島の守り神','The rocks are sacred'), text:L('しめ縄を張り、みんなで手を合わせた。島は静かな誇りに包まれている。','A sacred rope was tied and everyone prayed. The island is filled with quiet pride.')}; }},
  ]})},
  {id:'policy', fixed:5, make:()=>({img:'policy', title:L('島の進む道','The island’s path'), text:L('島が大きくなり、住民集会が開かれた。これからのやり方を決めよう。この決定はずっと続く。','The island has grown and a town meeting is held. Choose how it will grow. This lasts forever.'), opts:[
    {l:L('蒸気機関を入れる','Bring in steam engines'), d:L('加工の速度 +35%。ただし煙で幸福 -8、木の自然再生が半分に','Crafting +35%. Smoke: happiness -8, tree regrowth halved'), f:()=>{ S.flags.steam = true; story('蒸気機関を導入した','Brought in steam engines'); return {img:'steam', title:L('蒸気機関、始動！','Steam engines roar!'), text:L('もくもくと煙が上がり、歯車がうなる。','Smoke billows and gears hum.')}; }},
    {l:L('職人の誇りを守る','Keep the craft pride'), d:L('高級家具・歯車の売値 +30%、幸福 +4','Furniture & machinery sell +30%, happiness +4'), f:()=>{ S.flags.craft = true; story('職人の道を選んだ','Chose the way of craft'); return {img:'craft', title:L('職人の誇り','Craft pride'), text:L('ひとつひとつ、ていねいに。この島の品は本土で高く売れるようになった。','Carefully, one by one. The island’s goods now fetch a high price.')}; }},
    {l:L('森と共に生きる','Live with the forest'), d:L('木の再生・植林 ×2、木による幸福 ×1.5。加工の速度 -10%','Regrowth & planting x2, tree happiness x1.5. Crafting -10%'), f:()=>{ S.flags.forest = true; story('森と共に生きる道を選んだ','Chose to live with the forest'); return {img:'forest', title:L('森と共に','With the forest'), text:L('苗木を植え、森を育てる。小鳥やリスが戻ってきた。','Saplings are planted and birds return to the island.')}; }},
  ]})},
  {id:'contract', w:3, cond:()=>S.contracts.length < 2, make:()=>{
    const it = countB('workshop') ? 'furn' : countB('sawmill') ? 'plank' : 'log';
    const est = Math.max(3, estPerDay(it)), need = Math.max(5, Math.round(est * rnd(1.1, 2.1)));
    const reward = Math.round(need * ITEMS[it].p * 2.1), penalty = Math.round(need * ITEMS[it].p * 0.8);
    return {img:'contract', title:L('大口の注文','A big order'), text:L('本土の商会から「'+N(ITEMS[it].n)+'を'+need+'個、2日後の朝までに」と注文が来た。今のペースは1日およそ'+Math.round(est)+'個。', 'A mainland guild wants '+need+' '+N(ITEMS[it].n)+' within 2 days. You make about '+Math.round(est)+' a day.'), opts:[
      {l:L('引き受ける','Accept'), d:L('市場に入った分から自動で納品。成功で '+fmt(reward)+'G。失敗すると違約金 '+fmt(penalty)+'G と幸福 -5', 'Goods reaching the market are delivered automatically. Success: '+fmt(reward)+'G. Failure: '+fmt(penalty)+'G penalty, happiness -5'),
        f:()=>{ S.contracts.push({it, need, got:0, reward, penalty, due:S.day+2, start:(S.day-1)*P.dayLen + S.time}); }},
      {l:L('断る','Decline'), d:L('何も起きない','Nothing happens'), f:()=>{}},
    ]};
  }},
  {id:'festival', w:2, cond:()=>workerCount() >= 2, make:()=>{
    const cost = 80 + 30*workerCount();
    return {img:'festival', title:L('収穫祭をやりたい！','Let’s have a festival!'), text:L('住民たちが「たまには祭りで騒ぎたい」と言っている。今の幸福度は '+Math.round(S.mood)+'。','The residents want a harvest festival. Happiness is '+Math.round(S.mood)+'.'), opts:[
      {l:L('祭りを開く（'+fmt(cost)+'G）','Hold it ('+fmt(cost)+'G)'), d:L('幸福 +20。今夜は広場で踊りと花火（夕方から仕事は休み）','Happiness +20. Dancing and fireworks tonight (work stops at dusk)'), dis:()=>S.gold < cost, f:()=>{
        S.gold -= cost; addMood(20); S.stats.festivals++; S.festDay = S.day; story('Day'+S.day+'、にぎやかな収穫祭を開いた','Held a lively harvest festival on day '+S.day);
        return {img:'festival_go', title:L('今夜は収穫祭！','Festival tonight!'), text:L('夕方になったら、みんな広場に集まって踊りだす。夜空には花火も上がる。','At dusk everyone gathers in the square to dance, with fireworks in the sky.')}; }},
      {l:L('今は働くとき','Keep working'), d:L('お金は残る。幸福 -6','Save the gold. Happiness -6'), f:()=>{ addMood(-6); }},
    ]};
  }},
  {id:'storm', w:2, cond:()=>allB().some(i=>BUILD[S.cells[i].b.type]?.ind), make:()=>{
    const cost = Math.max(100, Math.round(S.gold * 0.15));
    return {img:'storm', title:L('嵐が近づいている','A storm is coming'), text:L('今夜は大荒れらしい。工場の屋根が心配だ。','A big storm tonight. The workshops’ roofs might not hold.'), opts:[
      {l:L('補強する（'+fmt(cost)+'G）','Reinforce ('+fmt(cost)+'G)'), d:L('確実に被害なし','Guaranteed safe'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; }},
      {l:L('運を天に任せる','Leave it to luck'), d:L('50%：工場ひとつが壊れる／50%：流れ着いた丸太 +12','50%: one workshop breaks / 50%: 12 driftwood logs'), f:()=>{
        if (Math.random() < 0.5){ const c = allB().filter(i=>BUILD[S.cells[i].b.type]?.ind); const i = c[Math.floor(Math.random()*c.length)]; S.cells[i].b.broken = true; CM[i].rotation.z = 0.12; story('嵐の賭けに負けた','Lost the storm gamble');
          return {img:'storm_lose', title:L('嵐の爪あと','Storm damage'), text:L(N(BUILD[S.cells[i].b.type].n)+'が壊れた。クリックして修理しよう。', 'The '+N(BUILD[S.cells[i].b.type].n)+' broke. Click it to repair.')}; }
        S.items.log += 12; story('嵐の賭けに勝った','Won the storm gamble');
        return {img:'storm_win', title:L('嵐のおくりもの','A gift from the storm'), text:L('浜辺に丸太がどっさり流れ着いていた。<b>丸太 +12</b>','Logs washed up everywhere. <b>Logs +12</b>')}; }},
    ]};
  }},
  {id:'loan', w:1.5, cond:()=>S.day >= 3 && !S.loans.length, make:()=>{
    const amt = 1500 + 500*S.day, repay = Math.round(amt*1.5);
    return {img:'loan', title:L('投資家からの申し出','An investor’s offer'), text:L('「今すぐ '+fmt(amt)+'G 貸しましょう。3日後に '+fmt(repay)+'G 返してくれれば結構」','"I’ll lend you '+fmt(amt)+'G now. Pay back '+fmt(repay)+'G in 3 days."'), opts:[
      {l:L('借りる','Borrow'), d:L('今すぐ +'+fmt(amt)+'G。3日後に -'+fmt(repay)+'G','+'+fmt(amt)+'G now, -'+fmt(repay)+'G in 3 days'), f:()=>{ S.gold += amt; S.loans.push({repay, due:S.day+3, start:(S.day-1)*P.dayLen + S.time}); S.stats.loans++; story(fmt(amt)+'Gを借りて勝負に出た','Borrowed '+fmt(amt)+'G to take a chance'); }},
      {l:L('断る','Decline'), d:L('堅実にいく','Play it safe'), f:()=>{}},
    ]};
  }},
  {id:'protect', w:3, cond:()=>treeCount() < 12 && !S.flags.forest && S.day >= S.flags.protectUntil && countB('camp'), make:()=>({img:'protect', title:L('森が減っている','The forest is shrinking'), text:L('木が '+treeCount()+' 本まで減った。森の保護団体が「2日間だけ伐採を休んで」と頼んできた。','Only '+treeCount()+' trees left. Forest keepers ask you to stop logging for 2 days.'), opts:[
    {l:L('約束する','Promise'), d:L('2日間、木こり小屋が休む。木の再生 ×3、助成金 +250G、幸福 +8','Lumber camps rest 2 days. Regrowth x3, grant +250G, happiness +8'), f:()=>{ S.flags.protectUntil = S.day + 2; S.gold += 250; addMood(8); story('森を休ませる約束をした','Let the forest rest'); return {img:'forest', title:L('森を休ませる','Resting the forest'), text:L('2日間、斧の音が止む。若木がぐんぐん伸びていく。','For 2 days the axes fall silent and saplings shoot up.')}; }},
    {l:L('断る','Refuse'), d:L('伐採は続く。幸福 -10','Keep logging. Happiness -10'), f:()=>{ addMood(-10); story('森の保護団体の頼みを断った','Refused the forest keepers'); }},
  ]})},
  {id:'tired', w:5, cond:()=>S.nsStreak >= 2, make:()=>({img:'tired', title:L('みんなヘトヘトだ','Everyone is exhausted'), text:L('夜勤が続いて住民がフラフラだ。「今日1日だけ休ませてほしい」','Night after night of work. "Please, just one day off."'), opts:[
    {l:L('今日は休日にする','Make today a holiday'), d:L('今日は誰も働かない。幸福 +22','No work today. Happiness +22'), f:()=>{ S.flags.holidayDay = S.day; addMood(22); S.nsStreak = 0; S.stats.holidays++; story('Day'+S.day+'を島の休日にした','Made day '+S.day+' a holiday'); return {img:'holiday', title:L('島の休日','Island holiday'), text:L('ピクニックに昼寝、凧あげ。今日はみんな思い思いに過ごす。','Picnics, naps and kites. Everyone relaxes today.')}; }},
    {l:L('却下する','Refuse'), d:L('幸福 -10。40%で住民が1人去る','Happiness -10. 40%: a resident leaves'), f:()=>{ addMood(-10); if (Math.random() < 0.4 && workers.length){ removeWorker(workers[0].bi); S.stats.quits++; toast(L('住民が1人、島を去った…','A resident left the island…'),'bad'); } story('休みの願いを却下した','Refused a day off'); }},
  ]})},
  {id:'artisan', w:1.5, cond:()=>allB().some(i=>BUILD[S.cells[i].b.type]?.in && S.cells[i].b.lvl < 5), make:()=>{
    const c = allB().filter(i=>BUILD[S.cells[i].b.type]?.in && S.cells[i].b.lvl < 5); const i = c[Math.floor(Math.random()*c.length)];
    return {img:'artisan', title:L('腕利きの職人一家','A family of master crafters'), text:L('職人一家が「'+N(BUILD[S.cells[i].b.type].n)+'で働きたい。ただし給料は上げてほしい」と言っている。','A crafter family wants to work at the '+N(BUILD[S.cells[i].b.type].n)+', if wages go up.'), opts:[
      {l:L('迎え入れる','Welcome them'), d:L(N(BUILD[S.cells[i].b.type].n)+'がタダでレベル+1。全員の日給 +3G（ずっと）。幸福 +4', N(BUILD[S.cells[i].b.type].n)+' +1 level free. Everyone’s wage +3G forever. Happiness +4'), f:()=>{ S.cells[i].b.lvl++; S.flags.wageBonus += 3; addMood(4); story('職人一家を迎え入れた','Welcomed the crafter family'); }},
      {l:L('丁重に断る','Politely decline'), d:L('何も起きない','Nothing happens'), f:()=>{}},
    ]};
  }},
  {id:'rival', w:1.5, cond:()=>S.stats.made.furn + S.stats.made.plank > 12, make:()=>{
    const it = S.stats.made.furn > 4 ? 'furn' : 'plank', cost = 300 + S.day*60;
    return {img:'rival', title:L('ライバル島の安売り','A rival island’s sale'), text:L('隣の島が'+N(ITEMS[it].n)+'を安売りし始めた。','A rival island started dumping cheap '+N(ITEMS[it].n)+'.'), opts:[
      {l:L('宣伝で対抗（'+fmt(cost)+'G）','Advertise ('+fmt(cost)+'G)'), d:L(N(ITEMS[it].n)+'の相場が125%に上がる', N(ITEMS[it].n)+' price rises to 125%'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; S.sat[it] = 1.25; story('宣伝合戦に打って出た','Fought back with ads'); }},
      {l:L('受け流す','Let it be'), d:L('3日間、'+N(ITEMS[it].n)+'の売値が最大60%に','For 3 days, '+N(ITEMS[it].n)+' sells at most 60%'), f:()=>{ S.satCap[it] = {v:0.6, until:S.day+3}; }},
    ]};
  }},
  {id:'whale', w:2, cond:()=>S.day >= 3, make:()=>{
    const cost = 60 + 15*workerCount();
    return {img:'whale', title:L('雲クジラがやってきた','A cloud whale appears'), text:L('島のすぐ横を、雲でできた大きなクジラが泳いでいる。歌でもてなすと恵みの雨を降らせてくれるという。','A huge whale made of clouds swims beside the island. Legend says a song will bring blessed rain.'), opts:[
      {l:L('歌と宴でもてなす（'+fmt(cost)+'G）','Sing and feast ('+fmt(cost)+'G)'), d:L('苗木がすべて大きな木になり、今日は木の再生 ×3。幸福 +8','All saplings grow into trees, regrowth x3 today. Happiness +8'), dis:()=>S.gold < cost, f:()=>{
        S.gold -= cost; addMood(8); S.rainDay = S.day; S.whaleDay = S.day;
        for (let i=0;i<W*W;i++) if (S.cells[i].t === 'sapling'){ S.cells[i] = {t:'tree', hp:P.treeHP, r:S.cells[i].r}; setCellMesh(i); CM[i].userData.pop = 0.4; }
        story('雲クジラをもてなし、恵みの雨を受けた','Welcomed the cloud whale and its rain');
        return {img:'whale_rain', title:L('恵みの雨','Blessed rain'), text:L('雲クジラが潮を吹くと、やさしい雨が島に降りそそいだ。','The whale spouted, and gentle rain fell over the island.')}; }},
      {l:L('静かに見送る','Watch it pass'), d:L('雲クジラはどこかへ泳いでいく','The whale swims away'), f:()=>{ S.whaleDay = S.day; }},
    ]};
  }},
  {id:'levistone', w:2, cond:()=>S.day >= 5 && S.day >= (S.flags.stoneSafeUntil||0), make:()=>{
    const need = 12 + 2*S.day;
    return {img:'levistone', title:L('浮遊石にひびが…','A crack in the floatstone'), text:L('島を空に浮かべている青い浮遊石に、小さなひびが見つかった。','A small crack appeared in the blue stone that keeps the island aloft.'), opts:[
      {l:L('石材'+need+'個で修繕する','Repair with '+need+' stone'), d:L('確実に直る（足りない石材は買う）。幸福 +3','Fixed for sure (missing stone is bought). Happiness +3'), dis:()=>!canPay({g:0, stone:need}), f:()=>{
        pay({g:0, stone:need}); addMood(3); S.flags.stoneSafeUntil = S.day + 6; S.flags.crack = false; story('浮遊石を修繕した','Repaired the floatstone');
        return {img:'stone_ok', title:L('浮遊石、ふたたび輝く','The floatstone shines again'), text:L('みんなで石材を運び、ひびを埋めた。島はまっすぐに戻った。','Everyone hauled stone and sealed the crack. The island is level again.')}; }},
      {l:L('様子を見る','Wait and see'), d:L('50%：何も起きない／50%：島が揺れ、貯蔵の半分がこぼれ、施設がひとつ壊れる。幸福 -8','50%: nothing / 50%: a quake spills half of all storage and breaks a building. Happiness -8'), f:()=>{
        S.flags.crack = true;
        if (Math.random() < 0.5){ S.flags.stoneSafeUntil = S.day + 3; toast(L('ひびは広がらなかった…今のところは','The crack held… for now'),'ev'); return; }
        quake(); story('浮遊石のひびを放っておき、島が揺れた','Ignored the crack and the island shook');
        return {img:'levistone', title:L('島が揺れた！','The island shook!'), text:L('島全体が傾き、貯まっていた物が半分こぼれ落ちた。修繕を考えたほうがいい。','The whole island tilted and half of the stored goods fell. Better repair it soon.')}; }},
    ]};
  }},
  {id:'pirates', w:1.5, cond:()=>S.day >= 5 && S.gold >= 1500, make:()=>{
    const toll = Math.round(S.gold*0.15);
    return {img:'pirates', title:L('空賊の影','Sky pirates!'), text:L('ドクロの帆の飛行船が近づいてきた。「通行料に '+fmt(toll)+'G よこしな」','A skull-sailed airship approaches. "Pay '+fmt(toll)+'G, or else."'), opts:[
      {l:L('通行料を払う','Pay the toll'), d:L('確実に去っていく','They leave for sure'), f:()=>{ S.gold -= toll; story('空賊に通行料を払った','Paid the sky pirates'); }},
      {l:L('見張りを立てて追い返す','Stand guard'), d:L('60%：撃退して落とし物 +'+fmt(Math.round(toll*0.6))+'G、幸福 +6／40%：市場の品物を3割奪われる','60%: repel them, loot +'+fmt(Math.round(toll*0.6))+'G, happiness +6 / 40%: lose 30% of market goods'), f:()=>{
        if (Math.random() < 0.6){ S.gold += Math.round(toll*0.6); addMood(6); story('空賊を追い返した','Drove off the sky pirates'); toast(L('空賊を追い返した！','Pirates repelled!'),'good'); }
        else { for (const k of ITEM_KEYS) S.items[k] = Math.floor(S.items[k]*0.7); addMood(-4); story('空賊に市場を荒らされた','Pirates raided the market'); toast(L('品物を奪われた…','Goods were stolen…'),'bad'); }
      }},
    ]};
  }},
  {id:'traveler', w:1.5, cond:()=>S.day >= 3, make:()=>({img:'balloon', title:L('気球の旅人','A balloon traveler'), text:L('旅人が「金色の苗木を板材10枚と交換しませんか？伐ると丸太が3倍とれますよ」と言う。','A traveler offers a golden sapling for 10 planks. "It yields triple logs!"'), opts:[
    {l:L('板材10枚と交換','Trade 10 planks'), d:L('空き地に「金の木」が1本生える','A golden tree appears'), dis:()=>S.items.plank < 10 || !S.cells.some(c=>c.t==='grass'), f:()=>{
      S.items.plank -= 10; const g = S.cells.map((c,i)=>c.t==='grass'?i:-1).filter(i=>i>=0); const i = g[Math.floor(Math.random()*g.length)];
      S.cells[i] = {t:'tree', hp:P.treeHP, r:Math.random(), gold:true}; setCellMesh(i); CM[i].userData.pop = 0.5; story('金の苗木を譲り受けた','Received a golden sapling');
      return {img:'balloon', title:L('金の木','A golden tree'), text:L('苗木はみるみる金色の木に育った。伐るかどうかはあなた次第。','The sapling grew into a golden tree. Whether to cut it is up to you.')}; }},
    {l:L('断る','Decline'), d:L('旅人は次の島へ','The traveler drifts on'), f:()=>{}},
  ]})},
  {id:'meteor', w:1.5, cond:()=>S.day >= 2, make:()=>({img:'meteor', title:L('流れ星の夜','A night of shooting stars'), text:L('今夜は流れ星がたくさん降るらしい。「みんなで願い事をしたい！」','Shooting stars tonight! "Let’s make wishes together!"'), opts:[
    {l:L('みんなで夜空を見る','Watch together'), d:L('今夜は夜勤なし。明日の朝、幸福 +12 と願いがかなうかも','No night shift tonight. Tomorrow: happiness +12 and maybe a wish comes true'), f:()=>{ S.meteorNight = S.day; story('みんなで流れ星に願い事をした','Wished upon shooting stars'); }},
    {l:L('ふだんどおり','Business as usual'), d:L('何も起きない','Nothing happens'), f:()=>{}},
  ]})},
  {id:'bigvein', w:3, cond:()=>S.flags.mine && (S.res.stone + S.res.ore) < S.resTotal*0.5 && !S.doneEvents.bigvein, make:()=>{
    const cost = 600 + S.day*40;
    return {img:'vein', title:L('眠れる大鉱脈','A sleeping great vein'), text:L('坑道の奥で、さらに大きな鉱脈が見つかった。掘り進めるには支柱を組む必要がある。','Deep in the shaft lies a much bigger vein. Shoring it up costs money.'), opts:[
      {l:L('掘り進める（'+fmt(cost)+'G）','Dig deeper ('+fmt(cost)+'G)'), d:L('地下の石 +300・鉄 +200','Underground stone +300, iron +200'), dis:()=>S.gold < cost, f:()=>{ S.gold -= cost; S.res.stone += 300; S.res.ore += 200; S.resTotal += 500; strataDug = -1; story('大鉱脈を掘り当てた','Struck the great vein'); return {img:'mine', title:L('大鉱脈！','The great vein!'), text:L('坑道がさらに奥へ伸びた。しばらくは鉄に困らない。','The tunnels reach deeper. Iron will flow for a while.')}; }},
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
  for (const e of EVENTS) if (e.fixed && !S.doneEvents[e.id] && !queuedIds[e.id] && S.day >= e.fixed){ ev = e; break; }
  if (!ev && Math.random() < 0.85){
    const pool = EVENTS.filter(e => !e.fixed && e.id !== S.lastEvent && (!e.cond || e.cond()));
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
    sfx('fanfare');
    box.innerHTML = evImg(E.img) + '<h2>'+E.title+'</h2><p>'+E.text+'</p><div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('つづける','Continue')+'</div></button></div>';
    curEvent = null; $('#modal').hidden = false; return;
  }
  sfx('event');
  box.innerHTML = '<div class="day">'+L('Day '+S.day+' の朝','Morning of day '+S.day)+'</div>' + evImg(E.img) + '<h2>'+E.title+'</h2><p>'+E.text+'</p><div class="opts">' +
    E.opts.map((o,k)=>'<button class="opt" data-act="ev:'+k+'" '+(o.dis && o.dis() ? 'disabled':'')+'><div class="n">▶ '+o.l+'</div><div class="d">'+o.d+'</div></button>').join('') + '</div>';
  curEvent = E; $('#modal').hidden = false;
}
function chooseEvent(k){
  const E = curEvent; if (!E) return; const o = E.opts[k]; if (o.dis && o.dis()) return;
  const res = o.f(); S.doneEvents[E.id] = true; curEvent = null; $('#modal').hidden = true; sfx('ui');
  if (res) eventQueue.unshift({result:true, ...res}); else toast('「'+o.l+'」','ev');
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
  $('#modal .mbox').innerHTML = '<h2>'+L('ここからが本番！','Now the real game begins!')+'</h2>' +
    '<p>'+L('ここからは<b>あなたの島</b>です。','From here on, it’s <b>your island</b>.')+'</p><p class="kv">' +
    L('・毎朝、島に相談ごとが届きます。正解はありません。<br>・木も岩もいつかは尽きます。<br>・持ち場から遠い仕事ほど、ぐんと時間がかかります。<br>・建物は「移動」で無料で動かせます（少し時間がかかる）。<br>・目標は <b>'+fmt(P.goal)+'G で空港を開き、飛行船を呼ぶ</b>こと。',
      '• Every morning brings a dilemma. There is no right answer.<br>• Trees and rocks run out eventually.<br>• Work far from a building takes much longer.<br>• Buildings can be moved for free (it takes a little time).<br>• Goal: <b>open an airport for '+fmt(P.goal)+'G and call an airship</b>.') +
    '</p><div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('はじめる','Start')+'</div></button></div>';
  $('#modal').hidden = false;
}

/* =========================================================
   エンディング：島の称号
   ========================================================= */
const TITLES = {
  nature:  [['森と共に生きる島','Island of the Living Forest'], ['木々のざわめきが聞こえる、緑の楽園になった。','A green haven where the trees whisper.']],
  industry:[['煙突と歯車の都','City of Chimneys and Gears'], ['昼も夜も機械の音が響く、工業の都になった。','An industrial city humming day and night.']],
  craft:   [['名工の里','Home of Master Crafters'], ['この島の家具は、本土でも名品として知られている。','Its furniture is famous on the mainland.']],
  merchant:[['商いの港町','Merchant’s Harbor'], ['約束と勝負で富を築いた、したたかな港町になった。','A shrewd harbor built on deals and bold bets.']],
  happy:   [['笑顔あふれる村','Village of Smiles'], ['忙しくても、みんなが笑っている村になった。','Busy, but everyone is smiling.']],
  grind:   [['眠らない島','The Sleepless Island'], ['明かりの消えない島。たくさん稼いだ……たぶん。','The lights never go out. Lots of money… probably.']],
};
function evaluate(){
  const st = S.stats, avg = st.moodN ? st.moodSum/st.moodN : S.mood;
  const ind = allB().filter(i=>BUILD[S.cells[i].b.type]?.ind).length;
  const ax = {
    nature:  Math.min(30, treeCount()*0.8) + Math.min(15, st.planted*0.15) + (S.flags.sacred?15:0) + (S.flags.forest?30:0),
    industry:Math.min(45, st.made.gear*0.5 + st.made.ingot*0.1) + (S.flags.steam?30:0) + ind*2,
    craft:   Math.min(40, st.made.furn*0.06) + (S.flags.craft?30:0),
    merchant:st.contractsDone*12 + st.loans*8 + Math.min(20, st.earned/5000),
    happy:   Math.max(0, avg-50)*1.5 + st.festivals*8 + st.holidays*8 + Math.min(10, st.pets*0.5),
    grind:   st.nightShifts*7 + (st.nightShifts ? Math.max(0, 45-avg)*0.6 : 0) + st.quits*6,
  };
  const sorted = Object.entries(ax).sort((a,b)=>b[1]-a[1]);
  return {main:TITLES[sorted[0][0]], sub:TITLES[sorted[1][0]], ax, avg};
}
function showEnding(){
  const r = evaluate(), st = S.stats;
  $('#modal .mbox').innerHTML = '<div class="day">'+L('Day '+S.day+'　空港に飛行船がやってきた！','Day '+S.day+' — An airship arrives at your airport!')+'</div>' + evImg('airship') +
    '<h2>'+L('あなたの島の称号','Your island’s title')+'</h2><div class="title-big">『'+N(r.main[0])+'』</div>' +
    '<p style="text-align:center">'+N(r.main[1])+'<br><small style="color:var(--sub)">'+L('ちょっぴり「'+N(r.sub[0])+'」の気配も。','With a hint of "'+N(r.sub[0])+'".')+'</small></p>' +
    '<div class="kv">'+L('稼いだ総額','Total earned')+'：'+fmt(st.earned)+'G／'+L('残った木','Trees')+'：'+treeCount()+'／'+L('平均幸福','Avg happiness')+'：'+Math.round(r.avg)+'<br>' +
    L('家具','Furniture')+' '+st.made.furn+'・'+L('歯車','Machinery')+' '+st.made.gear+'／'+L('注文 達成','Orders done')+' '+st.contractsDone+'・'+L('失敗','failed')+' '+st.contractsFail+'／'+L('祭り','Festivals')+' '+st.festivals+'・'+L('夜勤','Night shifts')+' '+st.nightShifts+'</div>' +
    '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('島の歩み','Your story')+'</h4><div class="kv">' + (S.story.length ? S.story.slice(-10).map(s=>'Day'+s.d+'：'+N(s.t)).join('<br>') : L('（大きな決断はしなかった）','(No big decisions)')) + '</div>' +
    '<p class="kv" style="color:var(--sub)">'+L('飛行船の船長「次は<b>酪農の島</b>へ案内しよう。その先には<b>農耕の島</b>もあるぞ」（準備中）','Captain: "Next I’ll take you to the <b>Dairy Island</b>, and beyond that the <b>Farm Island</b>." (coming soon)')+'</p>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+L('このまま島を育てる','Keep building this island')+'</div></button><button class="opt" data-act="reset"><div class="n">▶ '+L('新しい島で別の道を試す','Try another path on a new island')+'</div><div class="d">'+L('選択が違えば、称号も変わる','Different choices, different title')+'</div></button></div>';
  $('#modal').hidden = false; sfx('fanfare');
}

/* =========================================================
   動物（島の住人たち）
   ========================================================= */
const critters = [];
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
function landCells(pred){ const r = []; for (let i=0;i<W*W;i++){ const c = S.cells[i]; if (c.t !== 'void' && c.t !== 'b' && c.t !== 'rock' && (!pred || pred(i))) r.push(i); } return r; }
function spawnCritters(){
  const add = (type, n) => { for (let k=0;k<n;k++){ const m = makeCritter(type); const Lc = landCells(); const i = Lc[Math.floor(Math.random()*Lc.length)], p = wpos(i);
    const c = {type, mesh:m, x:p.x, z:p.z, tx:p.x, tz:p.z, t:rnd(0,3), y:0, vy:0, ph:Math.random()*6, a:Math.random()*6, r:rnd(2.5,6), h:rnd(1.8,3)};
    m.position.set(c.x, 0, c.z); scene.add(m); critters.push(c); } };
  add('rabbit', 3); add('sheep', 2); add('cat', 1); add('bird', 4);
}
function updateCritters(dt){
  const trees = treeCount(), night = isNight();
  for (const c of critters){
    const m = c.mesh;
    if (c.type === 'bird'){
      m.visible = !night; c.a += dt * 0.5; c.ph += dt*14;
      m.position.set(Math.cos(c.a)*c.r, c.h + Math.sin(c.a*2.3)*0.3, Math.sin(c.a)*c.r); m.rotation.y = -c.a;
      m.userData.wl.rotation.z = Math.sin(c.ph)*0.7; m.userData.wr.rotation.z = -Math.sin(c.ph)*0.7;
      continue;
    }
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
let petCool = 0;
function critterAt(){
  const hits = raycaster.intersectObjects(critters.filter(c=>c.mesh.visible).map(c=>c.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object; while (o && !o.userData.critter) o = o.parent;
  return critters.find(c => c.mesh === o) || null;
}
function petCritter(c){
  const say = {rabbit:L('ぴょん！','Hop!'), sheep:L('メェ〜','Baa~'), cat:L('にゃー','Meow'), bird:L('ピピッ','Tweet!')}[c.type];
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
  p.alive = true; p.life = 1.0; p.v = new THREE.Vector3(x, y, z); p.el.textContent = text; p.el.className = 'pop ' + cls; p.el.style.display = 'block';
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
    else if (type==='fw'){ noise(0, 0.25, 0.18, 300); tone(90, 0, 0.3, 'triangle', 0.12, 40); }
    else if (type==='event'){ [523,659,784,1047].forEach((f,k)=>tone(f, k*0.08, 0.12, 'square', 0.04)); }
    else if (type==='fanfare'){ [784,988,1175,1568].forEach((f,k)=>tone(f, k*0.07, 0.14, 'square', 0.045)); }
  } catch(e){}
}

/* =========================================================
   昼夜と光
   ========================================================= */
const SKY = {day:[new THREE.Color(0x5fb4f0),new THREE.Color(0xd2f0ff)], dusk:[new THREE.Color(0x5a4a9a),new THREE.Color(0xffa070)], night:[new THREE.Color(0x070a24),new THREE.Color(0x1c2350)]};
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
let nightAmt = 0;
function assignLights(){
  const cand = allB().filter(i=>BUILD[S.cells[i].b.type]?.light || ['camp','quarry'].includes(S.cells[i].b.type));
  cand.sort((a,b)=>(S.cells[b].b.type==='smelter') - (S.cells[a].b.type==='smelter'));
  lightPool.forEach((Lp,k)=>{
    const i = cand[k]; Lp.cell = i ?? -1;
    if (i === undefined){ Lp.l.position.set(0,-10,0); return; }
    const p = wpos(i), o = CM[i]?.userData.light || [0,0.5,0.5];
    Lp.l.position.set(p.x + o[0], o[1], p.z + o[2]); Lp.fire = !!CM[i]?.userData.fire;
    Lp.l.color.set(Lp.fire ? 0xff7a30 : 0xffc070);
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
  postMat.uniforms.skyTop.value.copy(_c1); postMat.uniforms.skyBot.value.copy(_c2);
  postMat.uniforms.night.value = nightAmt; postMat.uniforms.time.value = t; postMat.uniforms.yaw.value = camS.yaw;
  const mt = postMat.uniforms.meteor.value;
  if (mt.w < 1) mt.w += 1/60 * 1.4; else if (nightAmt > 0.8 && Math.random() < (S.meteorNight === S.day ? 0.04 : 0.0015)) mt.set(rnd(0.25,0.85), rnd(0.75,0.95), Math.PI + rnd(0.35,0.7), 0);
  winMat.emissiveIntensity = nightAmt * 1.6;
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
  keys[e.key] = true;
  if (e.key === 'Escape'){ if (mode) cancelMode(); else { closePanel(); select(-1); } }
  if (DEBUG && e.key === 'F8'){ S.gold += 5000; S.items.stone += 30; }
});
addEventListener('keyup', e => { keys[e.key] = false; });
const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0), _gp = new THREE.Vector3();
function pick(){
  mouse.set(mx/innerWidth*2-1, -(my/innerHeight)*2+1);
  raycaster.setFromCamera(mouse, cam);
  if (!mode){
    for (const h of raycaster.intersectObjects(pickables, true)){
      let o = h.object; while (o && o.userData.cell === undefined) o = o.parent;
      if (o) return o.userData.cell;
    }
  }
  if (raycaster.ray.intersectPlane(groundPlane, _gp)){
    const x = Math.floor(_gp.x + W/2), z = Math.floor(_gp.z + W/2);
    if (x >= 0 && x < W && z >= 0 && z < W && S.cells[z*W + x].t !== 'void') return z*W + x;
  }
  return -1;
}
function modeWhy(i){ return mode.kind === 'build' ? canPlace(mode.type, i) : (i === mode.from ? L('同じ場所','Same spot') : canPlace(null, i)); }
function doMode(i){
  const why = modeWhy(i); if (why){ toast(why, 'bad'); sfx('ui'); return; }
  if (mode.kind === 'build'){ const t = mode.type; place(t, i); if (!keys.Shift) cancelMode(); select(i); }
  else { moveBuilding(mode.from, i); cancelMode(); }
}
function onClickCell(i, touch){
  if (mode){
    if (i < 0) return;
    if (touch){ pending = i; showConfirm(); return; }   // スマホは「置く場所を選ぶ → ✓で決定」の2段階
    doMode(i); return;
  }
  if (i < 0){ select(-1); return; }
  if (!clickCell(i)) select(-1);
}
function showConfirm(){
  const el = $('#confirm'); el.style.display = 'flex';
  $('#confirmTxt').textContent = mode.kind === 'build' ? L('ここに建てる？','Build here?') : L('ここへ移動？','Move here?');
}
function cancelMode(){ document.body.classList.remove('placing'); mode = null; pending = -1; if (ghost){ scene.remove(ghost); ghost = null; } $('#tip').style.display = 'none'; $('#confirm').style.display = 'none'; }
function startMode(m){
  cancelMode(); closePanel(); mode = m; document.body.classList.add('placing');
  const type = m.kind === 'build' ? m.type : S.cells[m.from].b.type;
  ghost = makeBuilding(type, 0.5, m.kind === 'move' ? S.cells[m.from].b : null);
  ghost.userData.scaffold.visible = false;
  ghost.traverse(o=>{ if (o.isMesh){ o.material = ghostOk; o.castShadow = false; }});
  ghost.visible = false; scene.add(ghost);
  if (m.kind === 'move') select(-1);
  toast(m.kind === 'build' ? L(N(BUILD[type].n)+'：置きたい場所を選ぶ', N(BUILD[type].n)+': choose a spot') : L('移動先を選ぶ（無料・'+P.moveTime+'秒ほど止まる）','Choose a new spot (free, pauses ~'+P.moveTime+'s)'));
}
function placementInfo(i){
  const type = mode.kind === 'build' ? mode.type : S.cells[mode.from].b.type, d = BUILD[type], Lst = [];
  const why = modeWhy(i); if (why) Lst.push('<span class="r">× '+why+'</span>');
  if (S.cells[i].t === 'tree') Lst.push(L('木を伐って建てる','The tree will be cut'));
  if (d.partner && neigh8(i).some(j=>isB(j, d.partner))) Lst.push('<span class="g">'+L('隣接ボーナス：速い','Neighbor bonus: faster')+'</span>');
  if (d.ind && neigh8(i).some(j=>isB(j,'house')||isB(j,'bakery'))) Lst.push('<span class="r">'+L('隣の家がうるさがる','Noisy for the neighbors')+'</span>');
  if (d.near && neigh8(i).some(j=>S.cells[j].t==='b' && BUILD[S.cells[j].b.type]?.ind)) Lst.push('<span class="r">'+L('工場の隣はうるさい','Factory next door is noisy')+'</span>');
  const nearCount = kind => S.cells.filter((c,j)=>c.t===kind && cheb(i,j)<=P.farFrom).length;
  if (d.job === 'chop'){ const n = nearCount('tree'); Lst.push((n>=8?'<span class="g">':n<4?'<span class="r">':'<span>')+L('近くの木 ','Nearby trees ')+n+'</span>'); }
  if (d.job === 'quarry' && !S.flags.mine){ const n = nearCount('rock'); Lst.push((n>=2?'<span class="g">':'<span class="r">')+L('近くの岩 ','Nearby rocks ')+n+'</span>'); }
  if (type !== 'house' && type !== 'bakery' && type !== 'forester'){ const dist = cheb(i, WH); Lst.push(dist <= 3 ? '<span class="g">'+L('市場に近い','Close to the market')+'</span>' : dist >= 6 ? '<span class="r">'+L('市場から遠い（運ぶのがとても遅い）','Far from the market (slow hauling)')+'</span>' : L('市場まで ','Market distance ')+dist); }
  return '<b>'+N(d.n)+'</b>　'+(mode.kind === 'build' ? costTxt(buildCost(type)) : L('移動：無料','Move: free'))+'<div class="kv">'+Lst.join('<br>')+'</div>';
}

/* =========================================================
   UI
   ========================================================= */
const panelEl = $('#panel'), bpanelEl = $('#bpanel');
let panelName = null, buildTab = 'res', lastPanelHTML = '', lastBHTML = '';
function openPanel(n){ if (panelName === n){ closePanel(); return; } panelName = n; panelEl.hidden = false; document.body.classList.add('panel-open'); lastPanelHTML = ''; renderPanel(); }
function closePanel(){ panelName = null; panelEl.hidden = true; document.body.classList.remove('panel-open'); }
function select(i){ selCell = i; bpanelEl.hidden = i < 0; lastBHTML = ''; if (i >= 0) renderBPanel(); }
function setHTML(el, html, key){ if (key === 'p' ? html === lastPanelHTML : html === lastBHTML) return; el.innerHTML = html; if (key === 'p') lastPanelHTML = html; else lastBHTML = html; }
const head = t => '<div class="ph"><span>'+t+'</span><button class="btn x" data-act="closePanel">×</button></div>';
const segBtn = (act, label, on) => '<button class="btn '+(on?'on':'')+'" data-act="'+act+'">'+label+'</button>';
function renderPanel(){
  if (!panelName) return;
  let h = '';
  if (panelName === 'build'){
    h = head(L('建設','Build')) + '<div class="tabs">' + CATS.map(([k,n])=>segBtn('tab:'+k, N(n), buildTab===k)).join('') + '</div><div class="grid">' +
      Object.entries(BUILD).filter(([k,d])=>!d.hidden && d.cat === buildTab && (!d.req || S.flags.mine)).map(([k,d])=>{
        const c = buildCost(k);
        return '<button class="opt" data-act="build:'+k+'" '+(canPay(c)?'':'disabled')+'><div class="n">'+N(d.n)+'</div><div class="c">'+costTxt(c)+'</div><div class="d">'+N(d.d)+'</div></button>';
      }).join('') + '</div>' + (buildTab === 'proc' && !S.flags.mine && !S.flags.sacred ? '<div class="kv" style="color:var(--sub);margin-top:6px">'+L('？？？：地下に眠る資源があるらしい…','??? Something sleeps underground…')+'</div>' : '');
  } else if (panelName === 'upg'){
    h = head(L('アップグレード','Upgrades')) + '<div class="grid">' + UPGS.map(u=>{
      const lv = S.upg[u.id], c = u.cost[lv], max = c === undefined;
      return '<button class="opt" data-act="upg:'+u.id+'" '+(max || S.gold < c ? 'disabled' : '')+'><div class="n">'+N(u.n)+(u.cost.length>1?' Lv'+lv+'/'+u.cost.length:'')+'</div><div class="c">'+(max?L('取得済み','Owned'):fmt(c)+'G')+'</div><div class="d">'+N(u.d)+'</div></button>';
    }).join('') + '</div>';
  } else if (panelName === 'market'){
    const wh = S.cells[WH].b, lc = lvlCost(wh);
    const tb = trade.state === 'docked' ? L('交易気球：停泊中','Trade balloon: docked') : trade.state === 'away' ? L('交易気球：あと'+Math.ceil(trade.t)+'秒','Trade balloon: in '+Math.ceil(trade.t)+'s') : L('交易気球：移動中','Trade balloon: flying');
    h = head(L('市場と桟橋','Market & Dock')) +
      '<div class="row"><span class="grow">'+L('運搬係','Haulers')+' <b style="color:var(--hi)">'+wh.workers+'/'+slots(wh)+'</b><br><small>'+L('できた物を次の加工所へ直接運ぶ。余りは市場へ','Carry goods straight to the next workshop; extras to the market')+'</small></span>' +
      '<button class="btn hot" data-act="hireWH" '+(wh.workers<slots(wh) && S.gold>=hireCost() && workerCount()<housing() ? '' : 'disabled')+'>'+L('雇う','Hire')+' '+fmt(hireCost())+'G</button>' +
      '<button class="btn" data-act="fireWH" '+(wh.workers?'':'disabled')+'>'+L('減らす','Remove')+'</button>' +
      (wh.lvl < 5 ? '<button class="btn" data-act="lvlWH" '+(S.gold>=lc?'':'disabled')+'>'+L('枠+1','+1 slot')+' '+fmt(lc)+'G</button>' : '') + '</div>' +
      (workerCount() >= housing() ? '<div class="kv r">'+L('家が満員：住宅を建てると雇える','Houses are full: build a House to hire')+'</div>' : '') +
      '<div class="kv" style="color:var(--sub)">'+tb+'　'+L('同じ物を売り続けると値が下がり、時間で戻る','Prices drop as you sell and recover over time')+'</div>' +
      ITEM_KEYS.filter(k=>S.seen[k] || k==='stone').map(k=>{
        const pr = price(k), pct = Math.round(pr/ITEMS[k].p*100);
        return '<div class="row"><span class="grow">'+N(ITEMS[k].n)+' <b style="color:var(--hi)">'+fmt(S.items[k])+'</b><br><small>'+fmt(pr)+'G（'+pct+'%）</small></span>' +
          '<button class="btn" data-act="sell1:'+k+'" '+(S.items[k]>=1?'':'disabled')+'>'+L('1個','1')+'</button>' +
          '<button class="btn" data-act="sellAll:'+k+'" '+(S.items[k]>=1?'':'disabled')+'>'+L('全部','All')+'</button>' +
          (S.upg.route ? '<button class="btn '+(S.auto[k]?'on':'')+'" data-act="auto:'+k+'">'+L('定期便','Auto')+' '+(S.auto[k]?'ON':'OFF')+'</button>' : '') +
          (k === 'stone' ? '<button class="btn" data-act="buyStone" '+(S.gold >= 10*P.stoneBuy ? '' : 'disabled')+'>'+L('10個買う','Buy 10')+' '+fmt(10*P.stoneBuy)+'G</button>' : '') + '</div>';
      }).join('');
  } else if (panelName === 'area'){
    const r = evaluate();
    const xb = Object.keys(EXPAND_DIRS).map(k=>'<button class="btn" data-act="expand:'+k+'" '+(canExpand(k) && S.gold >= expandCost() ? '' : 'disabled')+'>'+N(EXPAND_DIRS[k][0])+'</button>').join('');
    h = head(L('新エリア','New Areas')) + (S.airport ?
      '<p>'+L('空港は開港している。島の称号：','The airport is open. Title: ')+'<b style="color:var(--hi)">『'+N(r.main[0])+'』</b></p><div class="btns"><button class="btn" data-act="ending">'+L('称号を見る','See title')+'</button></div>'
      : '<p>'+L('空港を開いて飛行船を呼ぶと、島の歩みに応じた<b>称号</b>が決まる。','Open an airport and call an airship to earn your island’s <b>title</b>.')+'</p><div class="kv">'+L('費用','Cost')+'：<b style="color:var(--hi)">'+fmt(P.goal)+'G</b>（'+L('いま','now')+' '+fmt(S.gold)+'G）<br>'+L('今の雰囲気','Current mood')+'：『'+N(r.main[0])+'』</div>' +
        '<div class="btns"><button class="btn hot" data-act="airport" '+(S.gold >= P.goal ? '' : 'disabled')+'>'+L('空港を開く','Open airport')+'（'+fmt(P.goal)+'G）</button></div>') +
      '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('島を広げる','Expand the island')+'</h4><div class="kv">'+L('1列ぶん陸地が増える。費用 ','Adds one row of land. Cost ')+fmt(expandCost())+'G</div><div class="btns">'+xb+'</div>' +
      '<h4 style="color:var(--hi);font-weight:normal;margin:10px 0 4px">'+L('となりの島','Neighboring islands')+'</h4><div class="kv">'+L('・酪農の島（遠くに牛と納屋が見える）……準備中<br>・農耕の島（風車と畑）……準備中','• Dairy Island (cows and a barn in the distance)… coming soon<br>• Farm Island (windmill and fields)… coming soon')+'</div>';
  } else if (panelName === 'settings'){
    const row = (label, html) => '<div class="row"><span class="grow">'+label+'</span><div class="seg">'+html+'</div></div>';
    h = head(L('設定','Settings')) +
      row(L('言語 / Language','Language / 言語'), segBtn('set:lang:ja','日本語',SET.lang==='ja') + segBtn('set:lang:en','English',SET.lang==='en')) +
      row(L('建物のアイコン','Building icons'), segBtn('set:icons:auto',L('自動','Auto'),SET.icons==='auto') + segBtn('set:icons:on',L('いつも','Always'),SET.icons==='on') + segBtn('set:icons:warn',L('注意だけ','Alerts'),SET.icons==='warn') + segBtn('set:icons:off',L('なし','Off'),SET.icons==='off')) +
      '<div class="kv" style="color:var(--sub)">'+L('自動：チュートリアル中だけ表示。「注意だけ」は満杯や人手なしのときだけ出る','Auto: shown only during the tutorial. Alerts: only when full or unstaffed')+'</div>' +
      row(L('音','Sound'), segBtn('set:sound:1','ON',SET.sound) + segBtn('set:sound:0','OFF',!SET.sound)) +
      row(L('ドットの粗さ','Pixel size'), segBtn('set:pixel:2',L('細かい','Fine'),SET.pixel==2) + segBtn('set:pixel:3',L('ふつう','Normal'),SET.pixel==3) + segBtn('set:pixel:4',L('粗い','Chunky'),SET.pixel==4)) +
      row(L('画面の揺れ','Screen shake'), segBtn('set:shake:1','ON',SET.shake) + segBtn('set:shake:0','OFF',!SET.shake)) +
      row(L('影（重いときはOFF）','Shadows (off = faster)'), segBtn('set:shadows:1','ON',SET.shadows) + segBtn('set:shadows:0','OFF',!SET.shadows)) +
      row(L('文字の大きさ','UI size'), segBtn('set:ui:0.9',L('小','S'),SET.ui==0.9) + segBtn('set:ui:1',L('中','M'),SET.ui==1) + segBtn('set:ui:1.15',L('大','L'),SET.ui==1.15)) +
      '<div class="kv" style="color:var(--sub);margin-top:6px">'+(TOUCH ? L('操作：1本指で移動・2本指で拡大と回転・⟲⟳で回転','Controls: 1 finger pans, 2 fingers zoom & rotate, ⟲⟳ rotate') : L('操作：左ドラッグで回転・右ドラッグで移動・ホイールで拡大','Controls: left-drag rotate, right-drag pan, wheel zoom'))+'</div>' +
      '<div class="btns"><button class="btn" data-act="confirmReset">'+L('最初からやり直す','Start over')+'</button></div>';
  }
  setHTML(panelEl, h, 'p');
}
function renderBPanel(){
  if (selCell < 0) return;
  const c = S.cells[selCell]; if (c.t !== 'b'){ select(-1); return; }
  const b = c.b, d = BUILD[b.type], Lst = [];
  let status = '';
  if (b.build > 0) status = '<span style="color:var(--hi)">'+L('工事中… あと','Under construction… ')+Math.ceil(b.build)+L('秒','s')+'</span>';
  else if (b.broken) status = '<span class="r">'+L('故障中','Broken')+'</span>';
  else if (!workTime() && (d.in||d.job)) status = L('夜は休み','Resting at night');
  else if (d.in) status = b._working ? '<span class="g">'+L('稼働中','Working')+'</span>' : !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : b.inb < 1 ? '<span class="r">'+L('材料待ち','Waiting for materials')+'</span>' : stTotal(b) >= bufCap(b) ? '<span class="r">'+L('完成品が満杯','Output full')+'</span>' : L('待機','Idle');
  else if (d.job) status = !b.workers ? '<span class="r">'+L('住民がいない','No workers')+'</span>' : stTotal(b) >= stCap(b) ? '<span class="r">'+L('貯蔵が満杯','Storage full')+'</span>' : '<span class="g">'+L('作業中','Working')+'</span>';
  if (status) Lst.push(status);
  if (d.in) Lst.push(N(ITEMS[d.in].n)+' '+b.inb+'/'+bufCap(b)+' → '+N(ITEMS[d.out].n)+' '+Math.floor(stTotal(b))+'/'+bufCap(b));
  if (d.job){ const it = Object.keys(b.st||{}).filter(k=>b.st[k]>=1).map(k=>N(ITEMS[k].n)+' '+Math.floor(b.st[k])).join('・'); Lst.push(L('貯蔵','Stored')+' '+Math.floor(stTotal(b))+'/'+stCap(b)+(it?'（'+it+'）':'')); }
  if (d.job === 'quarry') Lst.push(S.flags.mine ? L('地下の残り：石 ','Underground left: stone ')+fmt(S.res.stone)+L('・鉄 ',' / iron ')+fmt(S.res.ore) : L('近くの岩を割っている','Breaking nearby rocks'));
  if (d.job || d.in) Lst.push(L('住民 ','Workers ')+b.workers+'/'+slots(b));
  if (d.housing) Lst.push(L('住める人数 +','Homes +')+(3+(b.lvl-1)*2)+'（'+L('島全体 ','island ')+workerCount()+'/'+housing()+'）');
  if (d.mood) Lst.push(L('幸福 +','Happiness +')+(6+(b.lvl-1)*3)+'／'+L('維持費 ','upkeep ')+(20*b.lvl)+'G');
  let btns = '';
  if (b.broken){ const rc = Math.round(d.cost.g*0.4); btns += '<button class="btn hot" data-act="repair" '+(S.gold>=rc?'':'disabled')+'>'+L('修理','Repair')+' '+fmt(rc)+'G</button>'; }
  if (stTotal(b) >= 1 || d.in) btns += '<button class="btn hot" data-act="collect">'+L(d.in?'回収・補充':'回収', d.in?'Collect & supply':'Collect')+'</button>';
  if (d.job || d.in){
    btns += '<button class="btn hot" data-act="hire" '+(b.workers<slots(b) && S.gold>=hireCost() && workerCount()<housing() ? '' : 'disabled')+'>'+L('雇う','Hire')+' '+fmt(hireCost())+'G</button>';
    btns += '<button class="btn" data-act="fire" '+(b.workers?'':'disabled')+'>'+L('減らす','Remove')+'</button>';
  }
  if (b.lvl < 5){ const lc = lvlCost(b); btns += '<button class="btn" data-act="lvl" '+(S.gold>=lc?'':'disabled')+'>Lv'+(b.lvl+1)+' '+fmt(lc)+'G</button>'; }
  btns += '<button class="btn" data-act="move">'+L('移動（無料）','Move (free)')+'</button><button class="btn" data-act="demolish">'+L('撤去','Demolish')+'</button>';
  let look = '';
  if (b.type === 'house'){
    const lk = houseLook(b, c.r);
    look = '<div class="row"><span class="grow">'+L('屋根の形','Roof')+'：'+N(HOUSE_STYLES[lk.s])+'</span><button class="btn" data-act="look:s" '+(S.gold>=LOOK_COST?'':'disabled')+'>▶ '+LOOK_COST+'G</button></div>' +
      '<div class="row"><span class="grow">'+L('壁の色','Walls')+' <span class="swatch" style="background:#'+HOUSE_WALLS[lk.w].toString(16).padStart(6,'0')+'"></span></span><button class="btn" data-act="look:w" '+(S.gold>=LOOK_COST?'':'disabled')+'>▶ '+LOOK_COST+'G</button></div>' +
      '<div class="row"><span class="grow">'+L('屋根の色','Roof color')+' <span class="swatch" style="background:#'+HOUSE_ROOFS[lk.r].toString(16).padStart(6,'0')+'"></span></span><button class="btn" data-act="look:r" '+(S.gold>=LOOK_COST?'':'disabled')+'>▶ '+LOOK_COST+'G</button></div>';
  }
  const extra = (workerCount() >= housing() && (d.job||d.in)) ? '<div class="kv r">'+L('家が満員：住宅を建てると雇える','Houses full: build a House to hire')+'</div>' : '';
  setHTML(bpanelEl, '<div class="ph"><span>'+N(d.n)+' Lv'+b.lvl+'</span><button class="btn x" data-act="unselect">×</button></div><div class="kv">'+N(d.d)+'<br>'+Lst.join('<br>')+'</div>'+extra+look+'<div class="btns">'+btns+'</div>', 'b');
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
function doAct(actStr, el){
  const [act, ...rest] = actStr.split(':'), arg = rest.join(':');
  sfx('ui');
  switch (act){
    case 'panel': openPanel(arg); break;
    case 'closePanel': closePanel(); break;
    case 'tab': buildTab = arg; break;
    case 'build': startMode({kind:'build', type:arg}); break;
    case 'upg': { const u = UPGS.find(u=>u.id===arg), c = u.cost[S.upg[arg]]; if (c !== undefined && S.gold >= c){ S.gold -= c; S.upg[arg]++; toast(N(u.n)+L(' を手に入れた！',' acquired!'),'good'); sfx('fanfare'); if (arg === 'road') updatePaths(); } break; }
    case 'sell1': sell(arg, 1); break;
    case 'sellAll': case 'sellchip': sell(arg, S.items[arg]); break;
    case 'buyStone': buyStone(10); break;
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
    case 'skipTut': S.tut = TUT.length; endTutorial(); break;
    case 'airport': if (S.gold >= P.goal && !S.airport){ S.gold -= P.goal; S.airport = true; story('空港を開き、飛行船を迎えた','Opened an airport and welcomed an airship'); closePanel(); buildAirport(false); } break;
    case 'expand': expandIsland(arg); break;
    case 'ending': showEnding(); break;
    case 'confirmReset': el.dataset.act = 'reset'; el.textContent = L('本当にやり直す？（もう一度押す）','Really start over? (press again)'); return;
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
for (const k of ITEM_KEYS){ const el = document.createElement('div'); el.className = 'chip item'; el.id = 'chip-'+k; el.dataset.act = 'sellchip:'+k; el.innerHTML = '<span></span> <b></b> <small></small>'; chipsEl.appendChild(el); }
function applySettings(){
  document.documentElement.lang = SET.lang;
  document.documentElement.style.setProperty('--ui', SET.ui);
  sun.castShadow = SET.shadows; renderer.shadowMap.needsUpdate = true;
  makeRT();
  $('#rot').style.display = TOUCH ? 'flex' : 'none';
  $('#btnBuild').textContent = L('建設','Build'); $('#btnUpg').textContent = L('アップグレード','Upgrades'); $('#btnMarket').textContent = L('市場','Market'); $('#btnArea').textContent = L('新エリア','New Areas');
  $('#tutH').textContent = L('チュートリアル','Tutorial'); $('#tutSkip').textContent = L('スキップ','Skip');
  $('#goalH').textContent = L('目標：空港を開いて飛行船を呼ぶ','Goal: open an airport for the airship');
  for (const k of ITEM_KEYS){ const el = document.getElementById('chip-'+k); el.children[0].textContent = N(ITEMS[k].n); el.title = L('クリックで全部売る','Click to sell all'); }
  lastPanelHTML = ''; lastBHTML = '';
}
function renderTop(){
  $('#gold').textContent = fmt(S.gold);
  for (const k of ITEM_KEYS){
    const el = document.getElementById('chip-'+k); el.hidden = !S.seen[k];
    if (S.seen[k]){ el.children[1].textContent = fmt(S.items[k]); el.children[2].textContent = '@'+fmt(price(k)); }
  }
  const h = hourOf(S.time) % 24, hh = Math.floor(h), mm = Math.floor((h-hh)*6)*10;
  $('#clock').textContent = 'Day '+S.day+' '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+' '+(isNight()?'☾':'☀');
  const md = Math.round(S.mood), tgt = Math.round(moodTarget());
  $('#mood').textContent = md + (tgt > md+1 ? '↑' : tgt < md-1 ? '↓' : '');
  $('#moodChip').title = L('幸福度（目標 ','Happiness (target ')+tgt+')\n' + moodBreakdown().map(([k,v])=>k+' '+(v>=0?'+':'')+Math.round(v)).join('\n');
  $('#nsBtn').textContent = L('夜勤 ','Night ')+(S.nightShift ? 'ON' : 'OFF'); $('#nsBtn').classList.toggle('on', S.nightShift);
  $('#spdBtn').textContent = '▶ x'+S.speed;
  $('#goalTxt').innerHTML = S.airport ? L('空港が開港！','Airport open!')+'『'+N(evaluate().main[0])+'』' : fmt(S.gold)+' / '+fmt(P.goal)+'G<br><small style="color:var(--sub)">'+L('住民 ','Residents ')+workerCount()+'/'+housing()+'・'+L('木 ','Trees ')+treeCount()+'</small>';
  $('#goalBar').style.width = (S.airport ? 100 : clamp(S.gold/P.goal*100, 0, 100)) + '%';
  // 進行中の注文・借金：達成率と期日までの残り時間をバーで
  const now = (S.day-1)*P.dayLen + S.time;
  const tbar = (start, due) => { const end = (due-1)*P.dayLen, f = clamp((end - now)/Math.max(1, end - start), 0, 1); return '<div class="mbar t'+(f < 0.25 ? ' late' : '')+'"><i style="width:'+(f*100)+'%"></i></div>'; };
  $('#missions').innerHTML = S.contracts.map(C=>'<div class="mis">📦 '+N(ITEMS[C.it].n)+' '+C.got+'/'+C.need+'　'+L('期限 Day','Due day ')+C.due+L('の朝','')+'　+'+fmt(C.reward)+'G<div class="bars"><div class="mbar"><i style="width:'+(C.got/C.need*100)+'%"></i></div>'+tbar(C.start ?? now, C.due)+'</div></div>').join('') +
    S.loans.map(Ln=>'<div class="mis">💰 '+L('返済','Repay')+' '+fmt(Ln.repay)+'G　Day'+Ln.due+'<div class="bars">'+tbar(Ln.start ?? now, Ln.due)+'</div></div>').join('');
  // チュートリアル
  const tutEl = $('#tut');
  document.querySelectorAll('.pulse').forEach(e=>e.classList.remove('pulse'));
  if (S.tut >= 0 && TUT[S.tut]){
    let msg = N(TUT[S.tut].m);
    if (S.tut === 6 && countB('sawmill') && workerCount() >= housing()) msg = L('住む家が満員で雇えない！<b>住宅</b>を建てるか、木こり小屋の住民を<b>減らそう</b>。','No room to hire! Build a <b>House</b> or <b>remove</b> a worker from the camp.');
    tutEl.hidden = false; tutEl.querySelector('.msg').innerHTML = '<small style="color:var(--sub)">'+(S.tut+1)+'/'+TUT.length+'</small><br>'+msg;
    const T = TUT[S.tut]; if (T.el){ const e = $(T.el); if (e) e.classList.add('pulse'); }
  } else tutEl.hidden = true;
}
function toast(msg, cls=''){
  const el = document.createElement('div'); el.className = 'toast '+cls; el.textContent = msg;
  const box = $('#toasts'); box.appendChild(el); while (box.children.length > 5) box.firstChild.remove();
  setTimeout(()=>el.remove(), 4500);
}
// 建物の看板アイコン（UIの下に表示。チュートリアル中だけ／設定で変更）
const ICONS = {warehouse:'💰', camp:'🌲', quarry:'⛏️', sawmill:'🔨', workshop:'🛋️', bakery:'🍞', forester:'🌱', smelter:'🔥', factory:'⚙️', house:'🏠'};
const badgeEls = {};
function updateBadges(){
  const box = $('#badges'), mode2 = SET.icons === 'auto' ? (S.tut >= 0 ? 'on' : 'off') : SET.icons;
  for (let i=0;i<W*W;i++){
    const c = S.cells[i]; let el = badgeEls[i];
    if (c.t !== 'b' || mode2 === 'off'){ if (el) el.style.display = 'none'; continue; }
    const b = c.b, d = BUILD[b.type];
    const warn = b.broken || ((d.job || d.in) && !b.workers && b.build <= 0) || (b.type !== 'warehouse' && (d.job || d.in) && stTotal(b) >= stCap(b));
    const show = b.build > 0 || (mode2 === 'on') || (mode2 === 'warn' && warn);
    if (!show){ if (el) el.style.display = 'none'; continue; }
    if (!el){ el = badgeEls[i] = document.createElement('div'); el.className = 'badge'; box.appendChild(el); }
    const icon = b.build > 0 ? '🏗️' : ICONS[b.type];
    if (el.dataset.t !== icon){ el.dataset.t = icon; el.textContent = icon; el.classList.toggle('small', b.type === 'house'); }
    el.classList.toggle('warn', !!warn && b.build <= 0); el.classList.toggle('build', b.build > 0);
    const p = wpos(i), [sx, sy] = toScreen(p.x, b.type === 'house' ? 0.9 : 1.15, p.z);
    el.style.display = 'flex'; el.style.left = sx + 'px'; el.style.top = sy + 'px';
  }
}

/* ---- マーカー・ホバー枠 */
const marker = new THREE.Mesh(G.cone4, new THREE.MeshBasicMaterial({color:0xffd35a})); marker.scale.set(0.15,0.25,0.15); marker.rotation.x = Math.PI; scene.add(marker);
const hover = new THREE.Group();
for (let k=0;k<4;k++){ const m = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({color:0xffffff})); m.scale.set(k<2?1:0.06, 0.03, k<2?0.06:1); m.position.set(k<2?0:(k===2?-0.47:0.47), 0.02, k<2?(k===0?-0.47:0.47):0); hover.add(m); }
scene.add(hover);
function markerTarget(){
  const T = S.tut >= 0 ? TUT[S.tut] : null; if (!T || !T.mark) return -1;
  if (T.mark === 'tree'){ let best=-1, bd=99; for (let i=0;i<W*W;i++) if (S.cells[i].t==='tree'){ const d = cheb(i,WH); if (d<bd){bd=d;best=i;} } return best; }
  const l = allB(T.mark); return l.length ? l[0] : -1;
}

/* ---- 島を広げる */
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
    S.cells[i] = r < 0.35 ? {t:'tree', hp:P.treeHP, r:Math.random()} : r < 0.43 ? {t:'rock', hp:P.rockHP, r:Math.random()} : {t:'grass', r:Math.random()};
    setCellMesh(i); if (CM[i]) CM[i].userData.pop = 0.4;
  }
  updateTiles(); sfx('build'); shake(0.12);
  story('島を広げた','Expanded the island'); toast(L('島が広がった！','The island grew!'),'good');
}

/* ---- 空港と飛行船（ゴール演出） */
let airship = null;
function buildAirport(docked){
  const Ld = S.land, px = Ld.x0 - (W-1)/2 - 1.9, pz = (Ld.z0 + Ld.z1)/2 - (W-1)/2;
  const g = new THREE.Group(); g.position.set(px, 0, pz);
  g.add(part(G.box, 0x9a9aa2, 2.4,0.16,2.4, 0,-0.08,0));
  for (const [x,z] of [[-1,-1],[1,-1],[-1,1],[1,1]]) g.add(part(G.cyl, 0x6a5a4a, 0.07,1.6,0.07, x,-0.9,z));
  g.add(part(G.box, 0x8a6a40, 1.0,0.1,0.4, 1.6,-0.05,0));
  for (let k=0;k<8;k++){ const a = k/8*Math.PI*2; g.add(part(G.box, 0xffd35a, 0.14,0.02,0.14, Math.cos(a)*0.8, 0.01, Math.sin(a)*0.8)); }
  g.add(part(G.cyl, 0xd8d8e0, 0.12,0.9,0.12, -0.8,0.45,-0.8)); g.add(part(G.box, 0, 0.36,0.22,0.36, -0.8,1.0,-0.8, winMat));
  g.add(part(G.cone4, 0x4a6ab0, 0.3,0.2,0.3, -0.8,1.21,-0.8));
  g.add(part(G.cyl, 0xeeeeee, 0.03,1.6,0.03, 0.75,0.8,0.75));
  const sock = part(G.cone6, 0xff6a3a, 0.08,0.3,0.08, 0.92,1.4,0.75); sock.rotation.z = -Math.PI/2; g.add(sock);
  scene.add(g);
  const a = new THREE.Group();
  const bal = new THREE.Mesh(G.sph, MT(0xe8d8b0)); bal.scale.set(1.5,0.55,0.55); bal.castShadow = true; a.add(bal);
  for (const z of [-0.2, 0.2]) a.add(part(G.box, 0xc84a3a, 2.2,0.04,0.02, 0,0.1,z*2.6));
  a.add(part(G.box, 0xc84a3a, 0.4,0.5,0.04, 1.4,0,0)); a.add(part(G.box, 0xc84a3a, 0.4,0.04,0.5, 1.4,0,0));
  a.add(part(G.box, 0x8a5a2e, 0.7,0.22,0.3, 0,-0.7,0)); a.add(part(G.box, 0, 0.5,0.08,0.31, 0,-0.66,0, winMat));
  const prop = part(G.box, 0x444444, 0.04,0.5,0.06, 0.42,-0.7,0); a.add(prop);
  scene.add(a);
  airship = {g:a, prop, pad:new THREE.Vector3(px, 1.5, pz), t: docked ? 1 : 0, ended: docked};
  if (docked) a.position.copy(airship.pad); else { sfx('fanfare'); shake(0.1); toast(L('空港が完成！飛行船がやってくる…','Airport built! An airship is coming…'),'good'); }
}
function updateAirship(dt, t){
  if (!airship) return;
  const A = airship;
  if (A.t < 1){
    A.t = Math.min(1, A.t + dt/6); const k = 1 - Math.pow(1 - A.t, 3);
    A.g.position.set(A.pad.x - 22*(1-k), A.pad.y + 6*(1-k), A.pad.z + 8*(1-k));
    if (A.t >= 1 && !A.ended){ A.ended = true; burst(A.pad.x, 1, A.pad.z, 'coin', 16); showEnding(); }
  } else A.g.position.y = A.pad.y + Math.sin(t*1.2)*0.06;
  A.prop.rotation.x += dt*20;
}
function updateTradeBalloon(t){
  const w = wpos(WH), D = new THREE.Vector3(w.x + 0.1, 0.95, w.z + 1.65), A1 = new THREE.Vector3(D.x + 14, D.y + 5, D.z + 10), A2 = new THREE.Vector3(D.x - 12, D.y + 6, D.z + 10);
  const st = trade.state;
  tradeBalloon.visible = st !== 'away';
  if (st === 'arrive'){ const k = 1 - Math.pow(trade.t/4, 2); tradeBalloon.position.lerpVectors(A1, D, k); }
  else if (st === 'docked'){ tradeBalloon.position.set(D.x, D.y + Math.sin(t*1.5)*0.04, D.z); }
  else if (st === 'leave'){ const k = Math.pow(1 - trade.t/4, 2); tradeBalloon.position.lerpVectors(D, A2, k); }
}

/* =========================================================
   保存
   ========================================================= */
const SAVE_KEY = 'di_save_v1';
let noSave = false;
function save(){ if (noSave) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch(e){} }
function load(){ try { const s = localStorage.getItem(SAVE_KEY); if (s){ const o = JSON.parse(s); if (o && o.v === 1) return o; } } catch(e){} return null; }
function initWorld(){
  for (let i=0;i<W*W;i++) setCellMesh(i);
  for (const w of workers.splice(0)) scene.remove(w.mesh);
  for (const m of [reserved, haulRes]) for (const k in m) delete m[k];
  for (let i=0;i<W*W;i++) if (S.cells[i].t === 'b'){ const b = S.cells[i].b, n = b.workers; b.workers = 0; for (let k=0;k<n;k++) addWorker(i); if (b.broken) CM[i].rotation.z = 0.12; }
  updateTiles(); updatePaths(); assignLights(); if (S.airport) buildAirport(true);
}
function resetGame(){ noSave = true; try { localStorage.removeItem(SAVE_KEY); } catch(e){} location.reload(); }
addEventListener('beforeunload', save);
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
  if (gdt > 0){ const n = Math.ceil(gdt / 0.05); for (let k=0;k<n;k++) sim(gdt/n); }
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
  for (let i=0;i<W*W;i++){
    const g = CM[i]; if (!g) continue; const c = S.cells[i], u = g.userData;
    let s = 1;
    if (c.t === 'tree') s = u.base; else if (c.t === 'sapling') s = u.base * (0.25 + 0.6*c.g);
    else if (c.t === 'rock') s = 0.45 + 0.55*c.hp/P.rockHP;
    if (u.pop > 0){ u.pop -= dt; s *= 1 + Math.sin((0.35-u.pop)/0.35*Math.PI)*0.25; }
    if (u.hit > 0){
      u.hit -= dt; const k = u.hit/0.2;
      if (k > 0.75) g.scale.set(s*1.15, s*0.82, s*1.15); else { g.scale.setScalar(s); g.rotation.z = Math.sin(u.hit*60)*0.18*k; }
    } else { g.scale.setScalar(s); if (!(c.t==='b' && c.b.broken)) g.rotation.z = 0; }
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
  let underK = 0; const dn = dugCount();
  for (const w of workers){
    const m = w.mesh, u = m.userData;
    if (w.under){
      const v = dn > 0 ? strata[Math.max(0, dn - 1 - underK*3)] : null; underK++;
      m.visible = !!v && !w.sleep; if (!m.visible) continue;
      const p = wpos(v.i); m.position.set(p.x + v.nx*0.4, -0.6 - v.L*0.3, p.z + v.nz*0.4); m.scale.setScalar(0.7);
      m.rotation.y = Math.atan2(-v.nx, -v.nz); u.body.rotation.x = Math.max(0, Math.sin(elapsed*9))*0.6; u.carry.visible = false; continue;
    }
    m.scale.setScalar(1);
    if (!w.sleep) m.visible = true;
    if (!m.visible) continue;
    m.position.set(w.x, w.dance === 2 ? Math.abs(Math.sin(elapsed*8 + w.ox*20))*0.12 : 0, w.z);
    if (w.dance === 2) w.face += dt*4;
    m.rotation.y += ((w.face - m.rotation.y + Math.PI*3) % (Math.PI*2) - Math.PI) * Math.min(1, dt*14);
    const moving = w.tasks[0]?.k === 'go', bob = moving ? Math.abs(Math.sin(w.walk))*0.035 : 0;
    u.body.position.y = 0.13 + bob; u.head.position.y = 0.27 + bob; u.hat.position.y = 0.35 + bob; u.carry.position.y = 0.43 + bob;
    u.legL.position.z = moving ? Math.sin(w.walk)*0.035 : 0; u.legR.position.z = -u.legL.position.z;
    u.body.rotation.x = w.work ? Math.max(0, Math.sin(w.t*9))*0.6 : 0;
    u.carry.visible = !!w.carry; if (w.carry) u.carry.material = MT(ITEMS[w.carry].c);
  }
  // 空のものたち
  for (const c of clouds){ const a = Math.atan2(c.position.z, c.position.x) + c.userData.v*dt*0.05, r = Math.hypot(c.position.x, c.position.z); c.position.x = Math.cos(a)*r; c.position.z = Math.sin(a)*r; }
  for (const f of floaters) f.position.y += Math.sin(elapsed*0.8 + f.userData.float)*0.002;
  for (const g of bgBalloons){ const u = g.userData; u.a += dt*u.v; g.position.set(Math.cos(u.a)*u.r, u.h + Math.sin(elapsed*0.4 + u.r)*0.4, Math.sin(u.a)*u.r); }
  for (const f of farIslands){ f.position.y += Math.sin(elapsed*0.5 + f.position.x)*0.0015; if (f.userData.blades) f.userData.blades.rotation.z += dt*0.8; }
  updateTradeBalloon(elapsed);
  if (S.whaleDay === S.day && !isNight()){
    whale.visible = true; const k = (hourOf(S.time) - 5) / 14, a = k*Math.PI*2 + 0.8;
    whale.position.set(Math.cos(a)*10, 3.2 + Math.sin(elapsed*0.6)*0.25, Math.sin(a)*10); whale.rotation.y = -a - Math.PI/2;
    whale.userData.tail.rotation.z = Math.sin(elapsed*1.5)*0.25;
  } else whale.visible = false;
  const raining = S.rainDay === S.day && !isNight();
  for (const m of rain){ if (!raining){ m.visible = false; continue; } if (!m.visible || m.position.y < 0){ m.visible = true; m.position.set(rnd(-6,6), rnd(3,7), rnd(-6,6)); } m.position.y -= dt*9; }
  leviStone.rotation.y += dt*0.3; leviStone.position.y = -6.6 + Math.sin(elapsed*0.8)*0.1;
  leviStone.material.emissiveIntensity = S.flags.crack ? 0.3 + Math.abs(Math.sin(elapsed*7))*0.5 : 0.8 + Math.sin(elapsed*1.5)*0.15;
  if (festActive()){
    festLight.position.set(PLAZA.x, 0.5, PLAZA.z); festLight.intensity = 2.6 + Math.sin(elapsed*13)*0.5;
    if (!bonfire.visible){ bonfire.visible = true; bonfire.position.set(PLAZA.x, 0, PLAZA.z); }
    if (nightAmt > 0.3 && wdt){ fwAcc += dt; if (fwAcc > 0.8){ fwAcc = 0; firework(); } }
  } else if (bonfire.visible){ bonfire.visible = false; festLight.intensity = 0; }
  updateFx(wdt ? dt : 0); updatePops(dt); updateAirship(dt, elapsed); updateCritters(wdt ? dt : 0); updateBadges();
  // マーカー・ホバー・置き場所プレビュー
  const mt = markerTarget();
  if (mt >= 0){ const p = wpos(mt); marker.visible = true; marker.position.set(p.x, 1.35 + Math.abs(Math.sin(elapsed*5))*0.2, p.z); } else marker.visible = false;
  hoverCell = mode && TOUCH ? pending : (mouseIn && !drag) ? pick() : -1;
  if (hoverCell >= 0){ const p = wpos(hoverCell); hover.visible = true; hover.position.set(p.x, 0, p.z); } else hover.visible = false;
  if (mode && ghost){
    const tip = $('#tip');
    if (hoverCell >= 0){
      const p = wpos(hoverCell), ok = !modeWhy(hoverCell);
      ghost.visible = true; ghost.position.set(p.x, 0.02, p.z);
      ghost.traverse(o=>{ if (o.isMesh) o.material = ok ? ghostOk : ghostNg; });
      tip.style.display = 'block'; tip.innerHTML = placementInfo(hoverCell);
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
   起動
   ========================================================= */
function showTitle(){
  const fresh = S.tut === 0 && S.stats.clicks === 0;
  $('#modal .mbox').innerHTML = '<img src="assets/logo.png" alt="Diorama Island" style="display:block;width:min(300px,70vw);margin:0 auto">' +
    '<div style="text-align:center;color:var(--hi);font-size:20px;margin-top:4px">ジオラマアイランド</div>' +
    '<p style="text-align:center">'+L('中身は3D、見た目はドット絵。<br>空に浮かぶ島を、あなたのやり方で育てよう。','A 3D world in pixel art.<br>Grow your floating island your own way.')+'</p>' +
    '<div class="seg" style="justify-content:center">'+segBtn('lang:ja','日本語',SET.lang==='ja')+segBtn('lang:en','English',SET.lang==='en')+'</div>' +
    '<div class="opts"><button class="opt" data-act="closeModal"><div class="n">▶ '+(fresh ? L('はじめる','Start') : L('つづきから（Day '+S.day+'）','Continue (day '+S.day+')'))+'</div><div class="d">'+(TOUCH ? L('1本指で移動・2本指で拡大と回転・タップで伐採や建物を選ぶ','1 finger pans, 2 fingers zoom & rotate, tap to chop or select') : L('左ドラッグ：回転　右ドラッグ：移動　ホイール：拡大　クリック：伐採・建物を選ぶ','Left-drag rotate, right-drag pan, wheel zoom, click to chop or select'))+'</div></button>' +
    (fresh ? '' : '<button class="opt" data-act="confirmReset"><div class="n">▶ '+L('新しい島ではじめる','Start a new island')+'</div></button>') + '</div>';
  $('#modal').hidden = false;
}
S = load() || newState();
for (const k of ITEM_KEYS){ S.items[k] ??= 0; S.sat[k] ??= 1; S.stats.made[k] ??= 0; S.stats.soldBy[k] ??= 0; }
makeClouds();
initWorld();
spawnCritters();
applySettings();
renderTop();
if (S.tut < 0) for (const e of EVENTS) if (e.fixed && !S.doneEvents[e.id] && S.day >= e.fixed){ queuedIds[e.id] = true; const E = e.make(); E.id = e.id; eventQueue.push(E); }
showTitle();
requestAnimationFrame(frame);

// テスト・デバッグ用の窓口
window.DTT = {get S(){return S;}, P, W, WH, place, hire, levelUp, sell, clickCell, collect, moveBuilding, chooseEvent, workers, allB, evaluate, treeCount, sim, onDawn, EVENTS, eventQueue, critters, expandIsland,
  buyUpg:(id)=>{const u=UPGS.find(u=>u.id===id),c=u.cost[S.upg[id]]; if(c!==undefined&&S.gold>=c){S.gold-=c;S.upg[id]++;return true;} return false;},
  skipTut:()=>{S.tut=-1;$('#tut').hidden=true;}, reset:resetGame,
  screenOf:(i)=>{const p=wpos(i); return toScreen(p.x,0,p.z);},
  bench:(n=30)=>{const px=new Uint8Array(4);const gl=renderer.getContext();const t0=performance.now();for(let k=0;k<n;k++){renderer.setRenderTarget(rt);renderer.render(scene,cam);renderer.setRenderTarget(null);renderer.render(postScene,postCam);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}return (performance.now()-t0)/n;},
  get trade(){return trade;}, get mode(){return mode;}, setLang:(l)=>{SET.lang=l; applySettings(); renderTop();}};
