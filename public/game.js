// CENTRAL — client joueur : synchronisation Firebase + écrans de mission
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const C = window.CENTRAL;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const { sfx, tone } = C;
const NS = "http://www.w3.org/2000/svg";
const el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e };
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 };
const wait = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const IDS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
const BUILD = { "01": bCopy, "02": bHex, "03": bSignal, "04": bWorld, "05": bDials, "06": bCipher, "07": bSpectral, "08": bTimeline, "09": bTerm };

/* =====================================================================
   RÉSEAU
   ===================================================================== */
const ST = { uid: null, epoch: undefined, name: "", missions: {}, progress: {}, hints: {}, frags: {}, unsub: [], live: false, first: true };
const Net = { ready: false, session: false, error: "" };
window.Net = Net;

let app, auth, db;
const ref = (...p) => doc(db, ...p);
const agentName = () => ST.name || ("AGENT-" + (ST.uid || "0000").slice(0, 4).toUpperCase());
const isOpen = m => !!m && !m.locked && (!m.openAt || m.openAt.toMillis() <= Date.now());
const fmtDate = ts => ts ? ts.toDate().toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

function fail(msg) { Net.error = msg; Net.ready = false; const s = $("#sub"); if (s && !C.isLogged()) { s.className = "bad"; s.textContent = msg } }

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("REMPLACER")) {
  fail("TERMINAL NON CONFIGURÉ // VOIR config.js");
} else {
  try { app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app) }
  catch (e) { fail("LIAISON SERVEUR IMPOSSIBLE") }
}

if (auth) onAuthStateChanged(auth, async u => {
  if (!u) { signInAnonymously(auth).catch(() => fail("LIAISON SERVEUR IMPOSSIBLE // RÉSEAU ?")); return }
  ST.uid = u.uid;
  onSnapshot(ref("config", "public"), async s => {
    const ep = s.exists() ? s.data().epoch : null;
    const changed = ST.epoch !== undefined && ep !== ST.epoch;
    ST.epoch = ep;
    if (ep === null) { fail("TERMINAL NON INITIALISÉ // CONTACTER L’ORDRE"); return }
    if (changed && ST.live) {
      stopLive(); Net.session = false;
      if (C.isLogged()) { closeMission(); C.revoke("CLÉ RENOUVELÉE // NOUVELLE AUTHENTIFICATION REQUISE") }
      return
    }
    if (!Net.ready) {
      try {
        const p = await getDoc(ref("players", ST.uid));
        if (p.exists() && p.data().epoch === ep) { ST.name = p.data().name || ""; Net.session = true; startLive() }
      } catch (e) { }
      Net.error = ""; Net.ready = true;
    }
  }, () => fail("LIAISON SERVEUR PERDUE"));
});

Net.login = async (code, name) => {
  const c = norm(code);
  if (!c) return { ok: false, msg: "SAISIR UNE CLÉ D’AUTHENTIFICATION" };
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
  try {
    await withTimeout(setDoc(ref("players", ST.uid), { code: c, epoch: ST.epoch, name: n, at: serverTimestamp() }), 12000);
    ST.name = n; Net.session = true; startLive(); return { ok: true };
  } catch (e) {
    if (e && e.code === "permission-denied") return { ok: false, msg: "ACCÈS REFUSÉ // CLÉ INVALIDE" };
    return { ok: false, msg: "LIAISON SERVEUR PERDUE // RÉESSAYER" };
  }
};
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r({ code: "timeout" }), ms))]) }

function startLive() {
  stopLive(); ST.live = true; ST.first = true;
  ST.unsub.push(onSnapshot(collection(db, "missions"), q => {
    q.forEach(d => ST.missions[d.id] = d.data()); ST.loaded = true; onData(false);
  }, () => { }));
  ST.unsub.push(onSnapshot(collection(db, "progress"), { includeMetadataChanges: true }, q => {
    const next = {};
    q.docs.forEach(d => { if (!d.metadata.hasPendingWrites) next[d.id] = d.data() });
    const fresh = Object.keys(next).filter(k => !ST.progress[k]);
    const gone = Object.keys(ST.progress).filter(k => !next[k]);
    ST.progress = next;
    gone.forEach(k => { delete ST.frags[k] });
    if (!ST.first) fresh.forEach(k => {
      const p = next[k]; C.pushLog("RSTR", `SECTOR ${k} RESTORED / ${(p.name || "AGENT").toUpperCase()}`);
      if (p.by !== ST.uid) { sfx.ok(); toastSector(k, p.name) }
    });
    ST.first = false; onData(true);
  }, () => { }));
}
function stopLive() { ST.unsub.splice(0).forEach(u => { try { u() } catch (e) { } }); ST.live = false; ST.loaded = false }
setInterval(() => { if (ST.live) onData(false) }, 30000);

function toastSector(id, name) {
  const p = $("#p" + +id); if (!p) return;
  p.animate([{ filter: "brightness(2.2)" }, { filter: "none" }], { duration: 900 });
}

/* =====================================================================
   TABLEAU DE BORD
   ===================================================================== */
const solved = id => !!ST.progress[id];
function refresh() {
  $$(".pnl.sec").forEach(p => {
    const id = p.dataset.s, m = ST.missions[id], ok = solved(id), closed = ST.live && ST.loaded && !ok && !isOpen(m);
    p.classList.toggle("done", ok); p.classList.toggle("closed", closed);
    let r = p.querySelector(".rst");
    if (ok && !r) { r = document.createElement("span"); r.className = "rst"; r.textContent = "✓"; r.setAttribute("aria-label", "restauré"); p.querySelector(".hd").appendChild(r) }
    if (!ok && r) r.remove();
    let c = p.querySelector(".cls");
    if (closed && !c) { c = document.createElement("span"); c.className = "cls"; c.textContent = "FERMÉ"; p.appendChild(c) }
    if (!closed && c) c.remove();
  });
  const n = IDS.filter(solved).length, pl = $(".pills span");
  if (pl && ST.live) pl.textContent = `SECTEURS RESTAURÉS ${n} / ${IDS.length}`;
  const all = n === IDS.length && C.isLogged();
  $("#center").classList.toggle("final", all);
  if (all) { const s = $("#sub"); s.className = "ok"; s.textContent = "PROTOCOLE FINAL DISPONIBLE" }
}
function onData(progressChanged) {
  refresh();
  if (cur && mx.classList.contains("show")) {
    const wasOpen = curOpen; curOpen = isOpen(ST.missions[cur]) || solved(cur);
    if (wasOpen !== curOpen) open(cur, lastPanel, true);
    else { renderText(); renderHints(); renderSolved() }
  }
}

/* =====================================================================
   FENÊTRE DE MISSION
   ===================================================================== */
let cur = null, curOpen = false, destroy = null, lastPanel = null, pending = false;
const mx = $("#mx"), inp = $("#mxIn"), msg = $("#mxMsg");
const api = {
  setAnswer(v) { if (!solved(cur)) inp.value = v },
  submit(v) { inp.value = v; return check() },
  sfx, tone,
  solved: () => solved(cur),
};

function renderText() {
  const m = ST.missions[cur] || {};
  $("#mxNarr").textContent = m.narr || "";
  $("#mxCons").textContent = m.cons || "Ce secteur n’a pas encore de consigne.";
  $("#mxPlace").textContent = m.place || "—";
}

function open(id, panel, keep) {
  cur = id; lastPanel = panel;
  if (destroy) { try { destroy() } catch (e) { } destroy = null }
  const m = ST.missions[id];
  curOpen = isOpen(m) || solved(id);
  $("#mxNum").textContent = id; $("#mxTitle").textContent = panel.dataset.n;
  renderText();
  if (!keep) { msg.textContent = ""; msg.className = "mx-msg"; inp.value = "" }
  const host = $("#mxPlay"); host.innerHTML = "";
  const play = document.createElement("div"); host.appendChild(play);
  $(".mx-side").style.visibility = curOpen ? "" : "hidden";
  if (!curOpen) {
    play.className = "mx-closed"; play.style.height = "100%";
    const when = m && m.openAt && !m.locked ? `Ouverture prévue ${fmtDate(m.openAt)}.` : "L’ORDRE n’a pas encore ouvert ce secteur.";
    play.innerHTML = `<b>SECTEUR SCELLÉ</b><span>${esc(when)}</span>`;
  } else {
    destroy = BUILD[id](play, api) || null;
  }
  renderHints(); renderSolved();
  if (!keep) {
    mx.classList.add("show"); const b = $("#mxBox"); b.classList.remove("on"); void b.offsetWidth; b.classList.add("on");
    sfx.open();
    setTimeout(() => { const f = play.querySelector("[data-focus]") || (inp.disabled || !curOpen ? $("#mxClose") : inp); try { f.focus({ preventScroll: true }) } catch (e) { } }, 60);
  }
}
function closeMission() {
  if (!mx.classList.contains("show")) return;
  if (destroy) { try { destroy() } catch (e) { } destroy = null }
  mx.classList.remove("show"); cur = null; sfx.blip(); if (lastPanel) lastPanel.focus(); refresh();
}
$("#mxClose").onclick = closeMission;
mx.addEventListener("click", e => { if (e.target === mx) closeMission() });
addEventListener("keydown", e => { if (e.key === "Escape") { if ($("#fin").classList.contains("show")) closeFin(); else closeMission() } });

/* indices partagés : révélés pour tout le monde */
let hintReq = 0;
async function renderHints() {
  const id = cur, m = ST.missions[id] || {}, n = m.hintsShown || 0, total = m.hintCount || 0;
  const b = $("#mxHint");
  b.disabled = n >= total || solved(id) || !isOpen(m);
  b.textContent = total === 0 ? "AUCUN INDICE" : n >= total ? "PLUS D’INDICE" : `DEMANDER UN INDICE (${n + 1}/${total})`;
  const cache = ST.hints[id] = ST.hints[id] || [];
  const my = ++hintReq;
  for (let i = 0; i < n; i++) if (cache[i] === undefined) {
    // en cas de refus (révélation pas encore enregistrée côté serveur) ou de coupure : ne rien mémoriser, on réessaiera
    try { const d = await getDoc(ref("missions", id, "hints", String(i))); cache[i] = d.exists() ? d.data().text : "" } catch (e) { }
  }
  if (my !== hintReq || id !== cur) return;
  const box = $("#mxHints"), before = box.children.length;
  box.innerHTML = Array.from({ length: n }, (_, i) => `<div>${esc(cache[i] === undefined ? "…" : cache[i])}</div>`).join("");
  if (n > before) box.scrollTop = box.scrollHeight;
}
$("#mxHint").onclick = async () => {
  const b = $("#mxHint"); b.disabled = true;
  // l'indice n'est lisible qu'une fois la révélation confirmée par le serveur : on recharge à ce moment-là
  try { await withTimeout(updateDoc(ref("missions", cur), { hintsShown: increment(1) }), 10000); sfx.beep(); renderHints() }
  catch (e) { msg.className = "mx-msg bad"; msg.textContent = "INDICE INDISPONIBLE // RÉESSAYER"; renderHints() }
};

async function fragmentOf(id) {
  if (ST.frags[id] !== undefined) return ST.frags[id];
  try { const d = await getDoc(ref("fragments", id)); ST.frags[id] = d.exists() ? d.data().text : "" } catch (e) { return "" }
  return ST.frags[id];
}

function renderSolved() {
  const id = cur, ok = solved(id), st = $("#mxState");
  st.textContent = ok ? "RESTAURÉ" : curOpen ? "CORROMPU" : "SCELLÉ"; st.className = "mx-state" + (ok ? " ok" : "");
  [inp, $("#mxGo"), $("#mxForm label")].forEach(e => e.style.display = ok ? "none" : "");
  inp.disabled = ok || pending; $("#mxGo").disabled = ok || pending;
  const f = $("#mxFrag");
  if (!ok) { f.classList.remove("show"); return }
  if (f.dataset.id === id && f.classList.contains("show")) return;
  f.dataset.id = id; f.classList.add("show");
  const p = ST.progress[id];
  f.innerHTML = `<span class="lbl" style="display:block;margin-bottom:6px;white-space:normal">FRAGMENT ${id} // RESTAURÉ PAR ${esc((p.name || "UN AGENT").toUpperCase())}</span><span class="ft">…</span>`;
  fragmentOf(id).then(t => { if (cur === id) { const o = f.querySelector(".ft"); if (o) o.textContent = t } });
}

async function typeFrag(id) {
  const t = await fragmentOf(id), f = $("#mxFrag"), o = f.querySelector(".ft");
  if (!o || cur !== id) return;
  for (let i = 0; i <= t.length; i++) { o.textContent = t.slice(0, i); if (i % 2) sfx.tick(); await wait(RM ? 2 : 30) }
}

async function check() {
  if (!cur || solved(cur) || pending) return false;
  const id = cur, v = norm(inp.value), form = $("#mxForm");
  if (!v) { msg.className = "mx-msg bad"; msg.textContent = "SAISISSEZ UN CODE"; return false }
  pending = true; renderSolved(); msg.className = "mx-msg"; msg.textContent = "VÉRIFICATION PAR CENTRAL…";
  let res = "err";
  try {
    await withTimeout(setDoc(ref("progress", id), { answer: v, at: serverTimestamp(), by: ST.uid, name: agentName() }), 12000);
    res = "ok";
  } catch (e) {
    if (e && e.code === "permission-denied") {
      try { const p = await getDoc(ref("progress", id)); res = p.exists() ? "taken" : "bad" } catch (_) { res = "bad" }
    }
  }
  pending = false;
  if (cur !== id) return res === "ok";
  if (res === "ok") {
    // la confirmation serveur arrive aussi par le flux temps réel
    if (!ST.progress[id]) ST.progress[id] = { name: agentName(), by: ST.uid };
    sfx.ok(); msg.className = "mx-msg ok"; msg.textContent = "SECTEUR RESTAURÉ // FRAGMENT ARCHIVÉ";
    renderSolved(); renderHints(); refresh(); typeFrag(id);
    const p = $("#mxPlay").firstElementChild; if (p) p.dispatchEvent(new CustomEvent("solved"));
    return true;
  }
  renderSolved();
  if (res === "taken") { msg.className = "mx-msg ok"; msg.textContent = "DÉJÀ RESTAURÉ PAR UN AUTRE AGENT"; return false }
  sfx.deny(); msg.className = "mx-msg bad";
  msg.textContent = res === "bad" ? "CODE REJETÉ // SECTEUR TOUJOURS CORROMPU" : "LIAISON SERVEUR PERDUE // RÉESSAYER";
  form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); inp.select();
  return false;
}
$("#mxForm").addEventListener("submit", e => { e.preventDefault(); check() });

/* =====================================================================
   PROTOCOLE FINAL
   ===================================================================== */
const fb = document.createElement("button"); fb.id = "finBtn"; fb.type = "button"; fb.textContent = "LANCER LE PROTOCOLE FINAL";
$("#center .in").appendChild(fb); fb.onclick = () => openFin(true);
let finRun = 0;
async function openFin(play) {
  if (!C.isLogged()) return;
  const my = ++finRun, box = $("#finLines"), n = IDS.filter(solved).length;
  play = play && n === IDS.length;
  $("#fin").classList.add("show");
  $("#finK").textContent = play ? "PROTOCOLE FINAL // TRANSMISSION" : `FRAGMENTS ARCHIVÉS // ${n} / ${IDS.length}`;
  $("#finAll").style.display = play ? "" : "none";
  box.innerHTML = `<div class="in">DÉCHIFFREMENT…</div>`;
  const texts = await Promise.all(IDS.map(id => solved(id) ? fragmentOf(id) : Promise.resolve(null)));
  if (my !== finRun) return;
  box.innerHTML = texts.map((t, i) => {
    const last = i === IDS.length - 1 && t !== null && play;
    return `<div class="${t === null ? "mask" : ""}${last ? " last" : ""}">${t === null ? "█".repeat(18 + (i * 7) % 11) : esc(t)}</div>`
  }).join("");
  const rows = [...box.children];
  if (!play) { rows.forEach(r => r.classList.add("in")); $("#finClose").focus(); return }
  sfx.glitch(); await wait(800);
  for (let i = 0; i < rows.length; i++) {
    if (my !== finRun) return;
    if (i === rows.length - 1) { await wait(1200); if (my !== finRun) return; sfx.impact() } else sfx.beep();
    rows[i].classList.add("in"); await wait(RM ? 200 : i === rows.length - 2 ? 2200 : 1500);
  }
  if (my === finRun) sfx.ok();
}
function closeFin() { finRun++; $("#fin").classList.remove("show"); sfx.blip() }
$("#finAll").onclick = () => { finRun++; $$("#finLines div").forEach(r => r.classList.add("in")) };
$("#finClose").onclick = closeFin;
$("#bFrag").onclick = () => { if (C.isLogged()) openFin(false) };

window.Missions = { open: (id, p) => open(id, p), onLogin: refresh, refresh };
refresh();

/* =====================================================================
   ÉCRANS DE MISSION — chaque fonction dessine l'écran et renvoie un nettoyage
   ===================================================================== */
/* 01 — copie vers la clé */
function bCopy(play,api){
  const FILES=[["Readme.txt",0],["Audit_bus03.log",1],["Thermal_load.csv",0],["Noyau_0094.dmp",1],["Oscillo_A04.raw",1],["Power_rail.csv",0],["Mappage_7FF.bin",1],
    ["Alerte_critique.txt",1],["Kernel_trace.log",0],["Liaison_uplink.cfg",1],["Isolation_09.plist",1],["Sample_120hz.dat",0],["Etat_final.json",1],["Checksum.md5",0]];
  play.innerHTML=`<div class="lbl">TRANSFERT // VOLUME SOURCE → SUPPORT AMOVIBLE</div>
  <div class="cp">
    <div class="cp-card cp-src" draggable="true" title="Glisser vers la clé">
      <svg width="70" height="54" viewBox="0 0 86 66"><path d="M2 10h28l8 8h46v46H2z" fill="rgba(196,16,47,.25)" stroke="#ff2d4f" stroke-width="2"/><path d="M2 24h82" stroke="#ff8aa0"/></svg>
      <b>DIAG_094</b><span class="lbl">14 éléments // 2,4 Mo</span></div>
    <div class="cp-mid"></div>
    <div class="cp-card cp-dst">
      <svg width="70" height="54" viewBox="0 0 86 66"><rect x="10" y="20" width="56" height="28" fill="rgba(196,16,47,.25)" stroke="#ff2d4f" stroke-width="2"/><rect x="66" y="26" width="14" height="16" fill="none" stroke="#ff8aa0" stroke-width="2"/><rect x="70" y="30" width="3" height="3" fill="#ff8aa0"/><rect x="70" y="35" width="3" height="3" fill="#ff8aa0"/><circle cx="22" cy="34" r="3" fill="#ff2d4f" class="usbLed"/></svg>
      <b>CLÉ CENTRAL</b><span class="lbl" id="cpCap">USB // 16 Go libres</span></div>
  </div>
  <div style="display:flex;gap:12px;margin-top:16px;align-items:center"><button class="mx-btn hot" id="cpGo" type="button" data-focus>COPIER SUR LA CLÉ</button><span class="lbl" id="cpSt">EN ATTENTE</span></div>
  <div class="cp-prog"><i id="cpBar"></i></div>
  <div class="cp-log" id="cpLog"></div>`;
  const log=play.querySelector("#cpLog"),bar=play.querySelector("#cpBar"),st=play.querySelector("#cpSt"),go=play.querySelector("#cpGo"),mid=play.querySelector(".cp-mid"),dst=play.querySelector(".cp-dst");
  let run=0,busy=false;
  async function copy(){if(busy)return;busy=true;const my=++run;go.disabled=true;log.innerHTML="";mid.classList.add("go");let err=0;
    for(let i=0;i<FILES.length;i++){if(my!==run)return;const[f,bad]=FILES[i];
      const d=document.createElement("div");d.textContent=`→ ${f.padEnd(22," ")} …`;log.appendChild(d);log.scrollTop=log.scrollHeight;
      st.textContent=`COPIE ${i+1} / ${FILES.length}`;await new Promise(r=>setTimeout(r,bad?520:240));if(my!==run)return;
      if(bad){err++;d.className="e";d.textContent=`✕ ${f.padEnd(22," ")} ERREUR -36 : lecture impossible`;sfx.deny()}
      else{d.textContent=`✓ ${f.padEnd(22," ")} copié`;sfx.tick()}
      bar.style.width=((i+1)/FILES.length*100)+"%"}
    mid.classList.remove("go");const s=document.createElement("div");s.className="s";
    s.textContent=`Copie interrompue : ${err} éléments n’ont pas pu être lus. Le volume source est marqué ANOMAL.`;log.appendChild(s);log.scrollTop=log.scrollHeight;
    st.textContent=`${FILES.length-err} COPIÉS // ${err} EN ERREUR`;go.disabled=false;go.textContent="RECOMMENCER LA COPIE";busy=false;sfx.beep()}
  go.onclick=copy;
  const src=play.querySelector(".cp-src");
  src.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain","DIAG_094");e.dataTransfer.effectAllowed="copy"});
  dst.addEventListener("dragover",e=>{e.preventDefault();dst.classList.add("over")});
  dst.addEventListener("dragleave",()=>dst.classList.remove("over"));
  dst.addEventListener("drop",e=>{e.preventDefault();dst.classList.remove("over");copy()});
  return()=>{run++}}

/* 02 — carte mémoire hexadécimale */
function bHex(play,api){
  const T={"7F13":0x4D,"7F2A":0x45,"7F38":0x4D,"7F45":0x4F,"7F5C":0x49,"7F61":0x52,"7F77":0x45};
  const r=rng(9409);let html=`<div class="lbl">SECTEUR 094 // VIDAGE MÉMOIRE 0x7F00 — 0x7F7F</div><div class="hx"><div class="hx-row hx-head"><span></span>${"0123456789ABCDEF".split("").map(c=>`<span>${c}</span>`).join("")}</div>`;
  for(let row=0;row<8;row++){const base=0x7F00+row*16;html+=`<div class="hx-row"><span class="a">${base.toString(16).toUpperCase()}</span>`;
    for(let c=0;c<16;c++){const a=(base+c).toString(16).toUpperCase();let v=T[a];
      if(v===undefined){const k=r();v=k<.12?0:k<.18?0xFF:0x41+Math.floor(r()*26)}
      html+=`<b data-a="${a}" data-v="${v}" class="${v===0||v===0xFF?"z":""}" tabindex="0" role="button" aria-label="Adresse ${a}">${v.toString(16).toUpperCase().padStart(2,"0")}</b>`}
    html+=`</div>`}
  html+=`</div><div class="hx-reg"><div><div class="lbl">REGISTRE // TRADUCTION ASCII</div><div class="v" id="hxV"></div><div class="lbl mono" id="hxA" style="margin-top:4px;letter-spacing:.06em"></div></div><button class="mx-btn" id="hxC" type="button">VIDER</button></div>`;
  play.innerHTML=html;const sel=[];
  const upd=()=>{const s=sel.map(b=>String.fromCharCode(+b.dataset.v)).join("");play.querySelector("#hxV").textContent=s||"—";
    play.querySelector("#hxA").textContent=sel.map(b=>b.dataset.a).join(" · ");api.setAnswer(s)};
  play.querySelectorAll(".hx b").forEach(b=>{const t=()=>{const i=sel.indexOf(b);if(i>=0){sel.splice(i,1);b.classList.remove("sel")}else{sel.push(b);b.classList.add("sel")}sfx.blip();upd()};
    b.onclick=t;b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t()}}});
  play.querySelector("#hxC").onclick=()=>{sel.splice(0).forEach(b=>b.classList.remove("sel"));upd()};upd()}

/* 03 — capture de signal */
function bSignal(play,api){
  const TARGET=124.6,MORSE={V:"...-",E:".",I:"..",L:".-.."},WORD="VEILLE";
  play.innerHTML=`<div style="display:flex;justify-content:space-between"><span class="lbl">CANAL A / 04 // OSCILLOSCOPE</span><span class="lock" id="sgL">PAS DE PORTEUSE</span></div>
  <canvas class="osc" id="sgC" width="780" height="280"></canvas>
  <div class="tune"><span class="lbl">ACCORD</span><input type="range" id="sgR" min="80" max="160" step="0.1" value="101.3" aria-label="Fréquence" data-focus><span class="f" id="sgF">101.3 MHz</span></div>
  <div style="display:flex;align-items:center;gap:16px;margin-top:16px"><button class="mx-btn hot" id="sgP" type="button" disabled>ÉCOUTER LA TRANSMISSION</button><span class="lamp" id="sgLamp"></span><span class="lbl">TÉMOIN D’ÉMISSION</span></div>
  <div class="tape" id="sgT"></div>`;
  const cv=play.querySelector("#sgC"),g=cv.getContext("2d"),R=play.querySelector("#sgR"),F=play.querySelector("#sgF"),L=play.querySelector("#sgL"),P=play.querySelector("#sgP"),lamp=play.querySelector("#sgLamp"),tape=play.querySelector("#sgT");
  let raf,ph=0,locked=false,run=0,lastT=0;
  R.oninput=()=>{const f=+R.value;F.textContent=f.toFixed(1)+" MHz";locked=Math.abs(f-TARGET)<.25;
    L.textContent=locked?"PORTEUSE VERROUILLÉE":Math.abs(f-TARGET)<3?"PORTEUSE FAIBLE":"PAS DE PORTEUSE";L.classList.toggle("on",locked);P.disabled=!locked;
    const n=performance.now();if(n-lastT>40){lastT=n;locked?tone(1200,.05,"sine",.05):sfx.tick()}};
  function draw(){ph+=.08;const W=cv.width,Hh=cv.height,d=Math.abs(+R.value-TARGET),k=Math.min(1,d/5);
    g.fillStyle="#0a0305";g.fillRect(0,0,W,Hh);g.strokeStyle="#2a0c12";g.lineWidth=1;
    for(let x=0;x<=W;x+=W/10){g.beginPath();g.moveTo(x,0);g.lineTo(x,Hh);g.stroke()}for(let y=0;y<=Hh;y+=Hh/6){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke()}
    g.strokeStyle="#ff3a5c";g.lineWidth=2;g.shadowColor="#ff2d4f";g.shadowBlur=10;g.beginPath();
    for(let x=0;x<=W;x+=3){const clean=Math.sin(x*.045+ph)*70*(1-k);const nz=(Math.random()-.5)*160*k+Math.sin(x*.21+ph*3)*30*k;const y=Hh/2+clean+nz;x?g.lineTo(x,y):g.moveTo(x,y)}
    g.stroke();g.shadowBlur=0;raf=requestAnimationFrame(draw)}
  draw();
  P.onclick=async()=>{const my=++run;P.disabled=true;tape.textContent="";const u=RM?140:120;
    for(const ch of WORD){for(const s of MORSE[ch]){if(my!==run)return;const d=s==="."?u:u*3;lamp.classList.add("on");tone(740,d/1000,"sine",.14);
        tape.textContent+=s;await new Promise(r=>setTimeout(r,d));lamp.classList.remove("on");await new Promise(r=>setTimeout(r,u))}
      tape.textContent+=" / ";await new Promise(r=>setTimeout(r,u*2))}
    tape.textContent=tape.textContent.replace(/ \/ $/,"");P.disabled=!locked;P.textContent="RÉÉCOUTER"};
  return()=>{cancelAnimationFrame(raf);run++}}

/* 04 — topologie mondiale */
function bWorld(play,api){
  const MASK="00000000000000000000010011000111011111111111111100000000000111000000000000000000000000000000000000000000000000|00000000000000000000011100111110000001111111111111000000000000000000000010000000001111111000000001111000000000|00000000000000000111111011101111000000111111111100000000000000000000000100001010111111111111110001110000000000|00000011111110011010111101110100111000001111111100000000000011111000000001101111111111111111111111111111110110|11100011111111111111111111111100011100011111100000000000000111111110111111111111111111111111111111111111111111|00000011111111111111111111110110011100011100000001000000001110111111111111111111111111111111111111111111111110|00000111110111111111111111000001110000001100000000000000011101111111111111111111111111111111111111111100011000|00000001000000011111111111100000111100000000000000000100001100111111111111111111111111111111111111000001000000|00000000000000011111111111111101111110000000000000000010000101111111111111111111111111111111111100000011000000|00000000000000000111111111111101111111000000000000001011111111111111111111111111111111111111111111000010000000|00000000000000000111111111111111111000000000000000000011111111111111111111111111111111111111111111100000000000|00000000000000000111111111111111111000000000000000000011111111111101111111111111111111111111111110000000000000|00000000000000000111111111111111110000000000000000000001101011110001111111111111111111111111111100100000000000|00000000000000000111111111111111100000000000000000001110000101101111111111111111111111111111110001000000000000|00000000000000000011111111111111000000000000000000001110000101011111111111111111111111111110010001000000000000|00000000000000000011111111111111000000000000000000000101110000100011111111111111111111111110010111000000000000|00000000000000000000111111111110000000000000000000001111111101000011111111111111111111111111000000000000000000|00000000000000000000111111010000000000000000000000001111111111111111111111111111111111111111000000000000000000|00000000000000000000001110000010000000000000000000011111111111111011110111111111111111111110000000000000000000|00000000000000000000010110000001000000000000000000111111111111111101111100011111111111111111000000000000000000|00000000000000000000000111001001000000000000000000111111111111111101111110001111100111100000000000000000000000|00000000000000000000000011110001000000000000000000111111111111111110111100000111000011100001000000000000000000|00000000000000000000000000011100000000000000000000111111111111111110111000000110000001110001000000000000000000|00000000000000000000000000000100000000000000000000111111111111111111000000000010000000110000000000000000000000|00000000000000000000000000000100111110000000000000011111111111111111110000000010000000000000000000000000000000|00000000000000000000000000000000111110000000000000001111111111111111110000000001000001000010000000000000000000|00000000000000000000000000000000111111110000000000000000001111111111100000000000000011000110000000000000000000|00000000000000000000000000000001111111110000000000000000001111111111000000000000000011101110000000000000000000|00000000000000000000000000000001111111111100000000000000001111111111000000000000000000101101000100000000000000|00000000000000000000000000000011111111111111000000000000000111111110000000000000000000100000000011100000000000|00000000000000000000000000000001111111111111000000000000000111111110000000000000000000001000000001110000000000|00000000000000000000000000000001111111111111000000000000000111111110000000000000000000000000000000001000000000|00000000000000000000000000000000111111111110000000000000000111111110000000000000000000000000001100000000000000|00000000000000000000000000000000011111111110000000000000000111111110010000000000000000000000011110100000000000|00000000000000000000000000000000001111111110000000000000000111111100110000000000000000000000111111100000000000|00000000000000000000000000000000001111111110000000000000000111111100110000000000000000000011111111110000000000|00000000000000000000000000000000001111111000000000000000000111111100100000000000000000000111111111111000000000|00000000000000000000000000000000001111110000000000000000000011111000000000000000000000000011111111111000000000|00000000000000000000000000000000011111100000000000000000000011110000000000000000000000000011111111111000000000|00000000000000000000000000000000011111100000000000000000000011100000000000000000000000000011100011111000000000|00000000000000000000000000000000011111000000000000000000000000000000000000000000000000000000000001110000000000|00000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000010|00000000000000000000000000000000011000000000000000000000000000000000000000000000000000000000000000010000000100|00000000000000000000000000000000011000000000000000000000000000000000000000000000000000000000000000000000001000|00000000000000000000000000000000111000000000000000000000000000000000000000000000000000000000000000000000000000|00000000000000000000000000000000110000000000000000000000000000000000000000000000000000000000000000000000000000|00000000000000000000000000000000110000000000000000000000000000000000000000000000000000000000000000000000000000|00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000".split("|"),W=780,Hh=340,cols=MASK[0].length,rows=MASK.length;
  const lat2y=la=>(78-la)/(78+56)*Hh,lon2x=lo=>(lo+180)/360*W;
  const CITIES=[["LISBONNE",38.7,-9.1],["ISTANBUL",41,29],["ÉDIMBOURG",55.9,-3.2],["NAIROBI",-1.3,36.8],["CUPERTINO",37.3,-122],["TOKYO",35.7,139.7],["SYDNEY",-33.9,151.2],
    ["SÃO PAULO",-23.5,-46.6],["NEW YORK",40.7,-74],["SINGAPOUR",1.3,103.8],["REYKJAVIK",64.1,-21.9],["LE CAIRE",30,31.2]];
  play.innerHTML=`<div style="display:flex;justify-content:space-between"><span class="lbl">MAILLAGE MONDIAL // 12 RELAIS // LIAISON PRINCIPALE COUPÉE</span><span class="lbl" id="wmN">ROUTE : 0 / 6</span></div>
  <svg class="wm" id="wmS" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Carte des relais"></svg>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><div class="route" id="wmR">Sélectionnez les relais un par un.</div><button class="mx-btn" id="wmC" type="button">EFFACER LA ROUTE</button></div>`;
  const svg=play.querySelector("#wmS");
  const dots=el("g",{},svg);
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)if(MASK[j][i]==="1")el("circle",{cx:(i+.5)*W/cols,cy:(j+.5)*Hh/rows,r:1.7,fill:"#7a2a38"},dots);
  for(let la=60;la>=-40;la-=30)el("line",{x1:0,x2:W,y1:lat2y(la),y2:lat2y(la),stroke:"#2a0c12","stroke-dasharray":"2 6"},svg);
  const links=el("g",{},svg),nodesG=el("g",{},svg);
  const pos=CITIES.map(([n,la,lo])=>[lon2x(lo),lat2y(la)]);
  const route=[];
  CITIES.forEach(([n],i)=>{const[x,y]=pos[i];const g=el("g",{class:"nd",tabindex:0,role:"button","aria-label":"Relais "+n},nodesG);
    const pulse=el("circle",{cx:x,cy:y,r:6,fill:"none",stroke:"#ff2d4f","stroke-width":1},g);
    el("animate",{attributeName:"r",values:"5;14;5",dur:(1.6+i*.13)+"s",repeatCount:"indefinite"},pulse);
    el("animate",{attributeName:"opacity",values:"1;0;1",dur:(1.6+i*.13)+"s",repeatCount:"indefinite"},pulse);
    el("circle",{class:"ring",cx:x,cy:y,r:6,fill:"#14050a",stroke:"#ff2d4f","stroke-width":1.5},g);
    el("circle",{class:"core",cx:x,cy:y,r:2.4,fill:"#ff2d4f"},g);
    const left=x>W-90;el("text",{x:left?x-10:x+10,y:y+4,"text-anchor":left?"end":"start","font-size":10,fill:"#f3c9d1","font-family":"Rajdhani, Arial Narrow, sans-serif","font-weight":700,"letter-spacing":1},g).textContent=n;
    const pick=()=>{if(api.solved()||route.length>=6||route.includes(i))return;route.push(i);g.querySelector(".core").setAttribute("fill","#fff");g.querySelector(".ring").setAttribute("stroke","#fff");
      if(route.length>1){const a=pos[route[route.length-2]],b=pos[i];const mx=(a[0]+b[0])/2,my=Math.min(a[1],b[1])-Math.abs(a[0]-b[0])*.22-20;
        const p=el("path",{d:`M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}`,fill:"none",stroke:"#ffd0d8","stroke-width":1.8,filter:"url(#glow)"},links);
        const L=p.getTotalLength();p.style.strokeDasharray=L;p.style.strokeDashoffset=L;p.getBoundingClientRect();p.style.transition="stroke-dashoffset .6s ease-out";p.style.strokeDashoffset=0}
      sfx.open();upd()};
    g.addEventListener("click",pick);g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick()}})});
  function upd(){play.querySelector("#wmN").textContent=`ROUTE : ${route.length} / 6`;
    play.querySelector("#wmR").textContent=route.length?route.map(i=>CITIES[i][0]).join(" → "):"Sélectionnez les relais un par un.";
    api.setAnswer(route.map(i=>norm(CITIES[i][0])[0]).join(""))}
  play.querySelector("#wmC").onclick=()=>{route.length=0;links.innerHTML="";nodesG.querySelectorAll(".core").forEach(c=>c.setAttribute("fill","#ff2d4f"));nodesG.querySelectorAll(".ring").forEach(c=>c.setAttribute("stroke","#ff2d4f"));sfx.blip();upd()};
  play.addEventListener("solved",()=>links.querySelectorAll("path").forEach(p=>p.setAttribute("stroke","#fff")))}

/* 05 — casier à rotors */
function bDials(play,api){
  const v=[0,0,0];
  play.innerHTML=`<div class="lbl">CASIER DE CONFINEMENT // VERROU À TROIS ROTORS</div>
  <div class="lockbox"><svg width="120" height="150" viewBox="0 0 120 150" id="dlL"><path class="shackle" d="M30 70V42a30 30 0 0 1 60 0v28" fill="none" stroke="#ff8aa0" stroke-width="8"/><rect x="14" y="68" width="92" height="74" fill="rgba(196,16,47,.3)" stroke="#ff2d4f" stroke-width="2"/><circle cx="60" cy="100" r="8" fill="#ff2d4f"/><rect x="57" y="104" width="6" height="18" fill="#ff2d4f"/></svg>
  <div><div class="lbl">ÉTAT</div><div style="font-family:var(--f-dis);font-size:26px;color:var(--pink)" id="dlS">VERROUILLÉ</div></div></div>
  <div class="dials">${[0,1,2].map(i=>`<div class="dial"><button type="button" data-i="${i}" data-d="1" aria-label="Rotor ${i+1} plus" ${i?"":"data-focus"}>▲</button>
    <div class="dwin" tabindex="0" data-i="${i}" role="spinbutton" aria-label="Rotor ${i+1}" aria-valuemin="0" aria-valuemax="9" aria-valuenow="0"><div class="dstrip">${[9,0,1,2,3,4,5,6,7,8,9,0].map(n=>`<span>${n}</span>`).join("")}</div></div>
    <button type="button" data-i="${i}" data-d="-1" aria-label="Rotor ${i+1} moins">▼</button></div>`).join("")}</div>`;
  const wins=[...play.querySelectorAll(".dwin")];
  const set=(i,d)=>{v[i]=(v[i]+d+10)%10;const s=wins[i].firstElementChild;s.style.transform=`translateY(${-(v[i])*56+1}px)`;wins[i].setAttribute("aria-valuenow",v[i]);
    tone(1800+i*200,.02,"square",.04);setTimeout(()=>tone(900,.02,"square",.03),40);api.setAnswer(v.join(""))};
  play.querySelectorAll(".dial button").forEach(b=>b.onclick=()=>set(+b.dataset.i,+b.dataset.d));
  wins.forEach((w,i)=>{w.addEventListener("keydown",e=>{if(e.key==="ArrowUp"){e.preventDefault();set(i,1)}if(e.key==="ArrowDown"){e.preventDefault();set(i,-1)}});
    w.addEventListener("wheel",e=>{e.preventDefault();set(i,e.deltaY<0?1:-1)},{passive:false})});
  [0,1,2].forEach(i=>set(i,0));
  const opened=()=>{play.querySelector("#dlL").classList.add("open");play.querySelector("#dlS").textContent="OUVERT"};
  if(api.solved())opened();play.addEventListener("solved",opened)}

/* 06 — charge chiffrée */
function bCipher(play,api){
  const CT="YZJLF GPCCZFTWWP. LNNPD PY PNCTEFCP : OPYTPO. WP XZE BFT QPCXP WL AZCEP PDE WP NZOP.";
  const r=rng(606),junk=n=>Array.from({length:n},()=>Math.floor(r()*256).toString(16).toUpperCase().padStart(2,"0")).join(" ");
  play.innerHTML=`<div class="lbl">ERROR PAYLOAD // CAPTURE 0x7FF0:0094 // THREAD SYS/CORE_03</div>
  <div class="pay">${junk(22)} <span class="c">${CT}</span> ${junk(18)}</div>
  <div class="tune"><span class="lbl">DÉCALAGE</span><input type="range" id="cfR" min="0" max="25" step="1" value="0" aria-label="Décalage" data-focus><span class="f" id="cfF">+00</span></div>
  <div class="lbl" style="margin-top:12px">SORTIE DU DÉCODEUR</div><div class="dec" id="cfD"></div>`;
  const R=play.querySelector("#cfR"),D=play.querySelector("#cfD"),F=play.querySelector("#cfF");
  const dec=s=>CT.replace(/[A-Z]/g,c=>String.fromCharCode((c.charCodeAt(0)-65+s)%26+65));
  const upd=()=>{const s=+R.value;F.textContent="+"+String(s).padStart(2,"0");D.textContent=dec(s);sfx.tick()};
  R.oninput=upd;upd()}

/* 07 — analyse spectrale */
function bSpectral(play,api){
  const TARGET=68;
  play.innerHTML=`<div style="display:flex;justify-content:space-between"><span class="lbl">SPECTROGRAMME // FFT 2048 // 0 — 20 kHz</span><span class="lock" id="spL">BRUIT</span></div>
  <canvas class="osc" id="spC" width="300" height="140" style="height:330px;image-rendering:pixelated"></canvas>
  <div class="tune"><span class="lbl">FILTRE PASSE-BANDE</span><input type="range" id="spR" min="0" max="100" step="0.5" value="22" aria-label="Fréquence du filtre" data-focus><span class="f" id="spF">4.4 kHz</span></div>`;
  const cv=play.querySelector("#spC"),g=cv.getContext("2d"),R=play.querySelector("#spR"),F=play.querySelector("#spF"),L=play.querySelector("#spL");
  const W=300,Hh=140;const off=document.createElement("canvas");off.width=W;off.height=Hh;const og=off.getContext("2d");
  og.fillStyle="#fff";og.font="bold 38px 'Chakra Petch', Impact, sans-serif";og.textAlign="center";og.textBaseline="middle";og.fillText("ORIGINE",W/2,Hh*(1-TARGET/100));
  const mask=og.getImageData(0,0,W,Hh).data;const img=g.createImageData(W,Hh);let raf,t=0,lt=0;
  R.oninput=()=>{F.textContent=(R.value/5).toFixed(1)+" kHz";const n=performance.now();if(n-lt>40){lt=n;sfx.tick()}};
  function draw(){t++;if(t%3===0){const v=+R.value,cy=Hh*(1-v/100),vis=Math.max(0,1-Math.abs(v-TARGET)/7);
      L.textContent=vis>.85?"SIGNAL ISOLÉ":vis>0?"SIGNAL PARTIEL":"BRUIT";L.classList.toggle("on",vis>.85);
      for(let y=0;y<Hh;y++){const inB=Math.abs(y-cy)<16;for(let x=0;x<W;x++){const i=(y*W+x)*4;
        let n=Math.random()*(inB?.45:.22)+Math.max(0,Math.sin(x*.05+y*.02+t*.02))*.08;
        const m=mask[i]/255;let val=inB?n*(1-vis*.6)+m*vis*.95:n;
        val=Math.min(1,val);img.data[i]=40+val*215;img.data[i+1]=8+val*val*170;img.data[i+2]=16+val*val*180;img.data[i+3]=255}}
      g.putImageData(img,0,0);g.fillStyle="rgba(255,180,193,.5)";g.fillRect(0,cy-16,2,32);g.fillRect(W-2,cy-16,2,32)}
    raf=requestAnimationFrame(draw)}
  draw();R.oninput();return()=>cancelAnimationFrame(raf)}

/* 08 — chronologie */
function bTimeline(play,api){
  const EV=[["LINK LOST","Perte de la liaison montante",4],["HALTED","Redémarrage du système bloqué",2],["ANOMALY","Écart d’intégrité détecté",2],["ISOLATION","Protocole d’isolation engagé",1]];
  play.innerHTML=`<div class="lbl">ÉVÉNEMENTS SCELLÉS // HORODATAGE PERDU</div>
  <div class="tl-cards">${EV.map((e,i)=>`<button type="button" class="tl-card" data-i="${i}" ${i?"":"data-focus"}><b>${e[0]}</b><span>${e[1]}</span><i>${e[2]}</i></button>`).join("")}</div>
  <div class="lbl" style="margin-top:30px">CHRONOLOGIE RECONSTITUÉE // DU PLUS ANCIEN AU PLUS RÉCENT</div>
  <div class="tl-slots">${[0,1,2,3].map(i=>`<div class="tl-slot" data-s="${i}" tabindex="0" role="button"><span class="lbl">T${i+1}</span></div>`).join("")}</div>
  <div class="lbl" style="margin-top:18px">Touchez un événement pour le placer, touchez un emplacement pour le retirer.</div>`;
  const slots=Array(4).fill(null),cards=[...play.querySelectorAll(".tl-card")],sl=[...play.querySelectorAll(".tl-slot")];
  const upd=()=>{sl.forEach((s,i)=>{const e=slots[i];s.classList.toggle("f",e!==null);s.innerHTML=e===null?`<span class="lbl">T${i+1}</span>`:`<b>${EV[e][0]}</b><i>${EV[e][2]}</i>`});
    cards.forEach((c,i)=>c.disabled=slots.includes(i));api.setAnswer(slots.every(x=>x!==null)?slots.map(e=>EV[e][2]).join(""):"")};
  cards.forEach((c,i)=>c.onclick=()=>{const k=slots.indexOf(null);if(k<0)return;slots[k]=i;sfx.open();upd()});
  sl.forEach((s,i)=>{const f=()=>{if(slots[i]===null)return;slots[i]=null;sfx.blip();upd()};s.onclick=f;s.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();f()}}});upd()}

/* 09 — terminal */
function bTerm(play,api){
  const FS={"lisez-moi.txt":"Les journaux de CENTRAL sont signés.\nCeux qui l’ont construit écrivent toujours leur nom en tête de ligne.",
    "journal_0094.log":"Opérateur introuvable sur le poste 07.\nRedémarrage refusé par le noyau.\nDélai de reconnexion dépassé.\nRequête d’accès rejetée : clé inconnue.\nÉcriture bloquée sur le secteur 094.",
    "membres.lst":null};
  if(api.solved())FS["membres.lst"]="Membres enregistrés : 3 fondateurs.\n+ tous ceux qui lisent ceci.";
  play.innerHTML=`<div class="lbl">EVENT LOG // SHELL RESTREINT // LECTURE SEULE</div><div class="term" id="tm"><div id="tmO"></div><div class="ln"><span class="p">invité@central:~$</span><input id="tmI" spellcheck="false" autocapitalize="off" aria-label="Commande" data-focus></div></div>`;
  const O=play.querySelector("#tmO"),I=play.querySelector("#tmI"),T=play.querySelector("#tm");
  const out=(t,c="o")=>{const d=document.createElement("div");d.className="o "+c;d.textContent=t;O.appendChild(d);T.scrollTop=T.scrollHeight};
  out("CENTRAL SHELL 09.04 // session invité","w");out("Tapez help pour la liste des commandes.");
  const hist=[];let hi=0;
  const run=raw=>{const [c,...a]=raw.trim().split(/\s+/);const arg=a.join(" ");out("invité@central:~$ "+raw,"p");if(!c)return;
    switch(c.toLowerCase()){
      case"help":out("ls            lister les fichiers\ncat <fichier> afficher un fichier\nwhoami        identité de session\nunlock <mot>  déverrouiller le secteur\nclear         effacer l’écran");break;
      case"ls":out(Object.keys(FS).join("    "));break;
      case"cat":if(!(arg in FS))out(`cat: ${arg||"?"}: fichier introuvable`,"r");else if(FS[arg]===null)out("cat: membres.lst: permission refusée (réservé aux membres)","r");else out(FS[arg]);break;
      case"whoami":out(api.solved()?"membre":"invité (non membre)");break;
      case"clear":O.innerHTML="";break;
      case"unlock":if(!arg){out("unlock: mot manquant","r");break}
        out("vérification…");api.submit(arg).then(ok=>{if(ok||api.solved()){out("Signature reconnue. Journal déverrouillé.","w");FS["membres.lst"]="Membres enregistrés : 3 fondateurs.\n+ tous ceux qui lisent ceci."}else out("unlock: signature refusée","r")});break;
      default:out(`${c}: commande introuvable`,"r")}};
  I.addEventListener("keydown",e=>{if(e.key==="Enter"){const v=I.value;I.value="";if(v.trim()){hist.push(v);hi=hist.length}run(v);sfx.tick()}
    else if(e.key==="ArrowUp"&&hist.length){e.preventDefault();hi=Math.max(0,hi-1);I.value=hist[hi]}
    else if(e.key==="ArrowDown"&&hist.length){e.preventDefault();hi=Math.min(hist.length,hi+1);I.value=hist[hi]||""}
    else if(e.key.length===1)tone(2400+Math.random()*600,.01,"square",.015)});
  T.addEventListener("click",()=>I.focus())}
