const $ = s => document.querySelector(s);
let games = [], selectedGame = null, timer = null;
async function api(path, options={}) {
  const res = await fetch(path, { credentials:"same-origin", headers:{"content-type":"application/json", ...(options.headers||{})}, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function showDashboard() { $("#login").classList.add("hidden"); $("#dashboard").classList.remove("hidden"); }
function showLogin() { $("#dashboard").classList.add("hidden"); $("#login").classList.remove("hidden"); }
async function init() {
  try { await api("/api/me"); showDashboard(); await loadGames(); }
  catch { showLogin(); }
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#loginError").textContent="";
  const fd=new FormData(e.target);
  try { await api("/api/login",{method:"POST",body:JSON.stringify({username:fd.get("username"),password:fd.get("password")})}); showDashboard(); await loadGames(); }
  catch(err){$("#loginError").textContent=err.message;}
});
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});clearInterval(timer);showLogin();};
function openModal(){ $("#modal").classList.remove("hidden"); }
$("#addGameTop").onclick=$("#addGameEmpty").onclick=openModal;
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
$("#gameForm").addEventListener("submit",async e=>{
  e.preventDefault();$("#gameError").textContent="";
  const fd=new FormData(e.target), payload=Object.fromEntries(fd.entries());
  try { await api("/api/games",{method:"POST",body:JSON.stringify(payload)});e.target.reset();$("#modal").classList.add("hidden");await loadGames(); }
  catch(err){$("#gameError").textContent=err.message;}
});
async function loadGames(){
  const data=await api("/api/games");games=data.games||[];
  $("#noGame").classList.toggle("hidden",games.length>0);$("#dashContent").classList.toggle("hidden",games.length===0);
  if(!games.length){clearInterval(timer);return;}
  const select=$("#gameSelect");select.innerHTML=games.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("");
  if(!games.some(g=>g.id===selectedGame))selectedGame=games[0].id;
  select.value=selectedGame;select.onchange=()=>{selectedGame=select.value;refreshData();};
  await refreshData();clearInterval(timer);timer=setInterval(refreshData,12000);
}
async function refreshData(){
  if(!selectedGame)return;
  try{
    const [ev,pl]=await Promise.all([api(`/api/games/${selectedGame}/events`),api(`/api/games/${selectedGame}/players`)]);
    const events=ev.events||[],players=pl.players||[],blocked=players.filter(p=>Number(p.blocked)).length;
    $("#playerCount").textContent=players.length;$("#eventCount").textContent=events.length;$("#blockedCount").textContent=blocked;
    $("#eventsTable").innerHTML=events.length?events.map(e=>`<tr><td>${esc(e.event_type)}</td><td>${esc(e.playfab_id||"—")}</td><td>${esc(e.astral_id||"—")}</td><td><span class="pill ${e.severity==="high"?"high":""}">${esc(e.severity)}</span></td><td>${new Date(e.created_at).toLocaleString()}</td></tr>`).join(""):`<tr><td colspan="5" class="muted">No security events recorded yet.</td></tr>`;
    $("#playersTable").innerHTML=players.length?players.map(p=>`<tr><td>${esc(p.playfab_id)}</td><td>${esc(p.astral_id)}</td><td>${new Date(p.last_seen).toLocaleString()}</td><td><span class="pill ${p.blocked?"blocked":""}">${p.blocked?"BLOCKED":"ACTIVE"}</span></td><td>${p.blocked?"—":`<button class="table-action" data-block="${esc(p.playfab_id)}">Block</button>`}</td></tr>`).join(""):`<tr><td colspan="5" class="muted">No players recorded yet. Player records appear after Astral authentication.</td></tr>`;
    document.querySelectorAll("[data-block]").forEach(b=>b.onclick=async()=>{if(confirm(`Permanently block ${b.dataset.block} from future Astral-authenticated connections?`)){await api(`/api/games/${selectedGame}/blocks`,{method:"POST",body:JSON.stringify({playFabId:b.dataset.block,reason:"Blocked from Astral dashboard"})});await refreshData();}});
  }catch(e){console.error(e);}
}
$("#refresh").onclick=refreshData;
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
init();
