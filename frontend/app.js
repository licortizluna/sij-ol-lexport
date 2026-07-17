const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let expedientes = [];
let clientes = [];
let agenda = [];
let agendaFilter = "pendiente";
let documentos = [];
let currentGenerationId = null;
let currentAnalysisJob = null;
let currentGenerationJob = null;
let csrfToken = "";
let currentAgreementExp = null;
let currentPortfolioJob = null;
let portfolioTimer = null;
let portfolioPolling = false;
let portfolioCacheRun = null;
let portfolioMovementCache = new Map();
let tareas = [];
let taskFilter = "pendiente";
let currentDetailExp = null;
let detailReturnView = "expedientes";
let detailReturnY = 0;

async function loadDrafts() {
  const rows = await api("/api/generaciones");
  $("#draft-list").innerHTML = rows.map(item => `<div class="item draft-row"><div><span class="state ${item.aprobado_at ? "approved" : ""}">${item.aprobado_at ? "AUTORIZADO" : "BORRADOR"}</span><h3>${esc(item.tipo_escrito)} · ${esc(item.expediente_numero || "Sin expediente")}</h3><p>${esc(item.cliente || item.actor || "Sin parte registrada")} · ${new Date(item.created_at).toLocaleString("es-MX")}</p></div><button type="button" data-open-draft="${item.id}">Abrir</button></div>`).join("") || '<div class="item">Todavía no hay borradores.</div>';
  document.querySelectorAll("[data-open-draft]").forEach(button => button.onclick = () => openDraft(Number(button.dataset.openDraft)));
}

async function openDraft(id) {
  try {
    const item = await api(`/api/generaciones/${id}`);
    currentGenerationId = item.id;
    $("#resultado-editor").value = item.resultado;
    $("#control-calidad").textContent = item.control_calidad || "Sin control de calidad registrado.";
    $("#aprobado-por").value = item.aprobado_por || "";
    $("#gen-review").classList.remove("hidden");
    const approved = Boolean(item.aprobado_at);
    $("#approval-status").textContent = approved ? `Autorizado · ${new Date(item.aprobado_at).toLocaleString("es-MX")}` : "Pendiente de autorización";
    $("#approval-status").classList.toggle("approved", approved);
    $("#download-word").href = approved ? `/api/generaciones/${id}/exportar/docx` : "#";
    $("#download-pdf").href = approved ? `/api/generaciones/${id}/exportar/pdf` : "#";
    $("#download-word").classList.toggle("disabled", !approved);
    $("#download-pdf").classList.toggle("disabled", !approved);
    $("#gen-review").scrollIntoView({ behavior:"smooth", block:"start" });
  } catch(error) { toast(error.message, true); }
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#8b2635" : "#192f45";
  element.style.display = "block";
  setTimeout(() => element.style.display = "none", 5000);
}

async function api(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    options.headers = new Headers(options.headers || {});
    if (csrfToken) options.headers.set("X-SIJOL-CSRF", csrfToken);
  }
  const response = await fetch(url, options);
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sesión vencida"); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Error de operación");
  return data;
}

document.querySelectorAll("nav button").forEach(button => button.onclick = () => {
  document.querySelectorAll("nav button,.view").forEach(element => element.classList.remove("active"));
  button.classList.add("active");
  $("#" + button.dataset.view).classList.add("active");
  if (button.dataset.view === "auditoria") loadAudit();
  if (button.dataset.view === "respaldos") loadBackups();
  if (button.dataset.view === "acuerdos" && currentAgreementExp) loadAcuerdos();
  if (button.dataset.view === "acuerdos") loadLatestPortfolio();
  if (button.dataset.view === "inicio") loadDashboard();
  if (button.dataset.view === "tareas") loadTareas();
});

async function loadDashboard() {
  const data = await api("/api/dashboard");
  const metrics = [["Expedientes", data.total], ["Activos", data.activos], ["Suspendidos", data.suspendidos||0], ["Concluidos", data.concluidos||0], ["Datos por completar", data.incompletos], ["Fuentes validadas", data.tesauro]];
  $("#metrics").innerHTML = metrics.map(([label,value]) => `<div class="metric"><strong>${Number(value).toLocaleString("es-MX")}</strong><span>${esc(label)}</span></div>`).join("");
  $("#dash-agenda").innerHTML = data.proximos.map(item => `<div class="item"><span class="meta">${esc(item.fecha)} ${esc(item.hora)} · ${esc(item.tipo)}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.expediente_numero || "Sin expediente vinculado")}</p></div>`).join("") || '<div class="item">No hay vencimientos próximos registrados.</div>';
  const max = Math.max(1, ...data.estados.map(item => item.total));
  $("#dash-estados").innerHTML = data.estados.map(item => `<div class="bar-row"><span>${esc(item.nombre)}</span><div class="bar"><i style="width:${Math.round(item.total/max*100)}%"></i></div><strong>${item.total}</strong></div>`).join("");
  $("#dash-tareas").innerHTML = (data.avisos_tareas||[]).map(item=>`<div class="item task-row semaforo-${esc(item.semaforo)}"><span class="meta">${esc(item.aviso).toUpperCase()} · ${esc(item.fecha_vencimiento)} ${esc(item.hora)}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.expediente_numero||"Sin expediente")}</p></div>`).join("")||'<div class="item">No hay tareas vencidas, de hoy o de mañana.</div>';
}
document.querySelectorAll("[data-open-tasks]").forEach(button=>button.onclick=()=>document.querySelector('nav button[data-view="tareas"]').click());

function resetTaskForm(){const form=$("#task-form");form.reset();form.elements.id.value="";$("#task-form-title").textContent="Nueva tarea";$("#task-save").textContent="Agregar tarea";$("#task-cancel-edit").classList.add("hidden");}
function editTask(id){const item=tareas.find(row=>row.id===id);if(!item)return;const form=$("#task-form");for(const key of ["id","expediente_id","titulo","fecha_vencimiento","hora","prioridad","notas"])if(form.elements[key])form.elements[key].value=item[key]??"";$("#task-form-title").textContent="Editar tarea";$("#task-save").textContent="Guardar cambios";$("#task-cancel-edit").classList.remove("hidden");form.scrollIntoView({behavior:"smooth",block:"start"});form.elements.titulo.focus({preventScroll:true});}
function renderTareas(){const query=$("#task-search").value.trim().toLocaleLowerCase("es"),base=taskFilter==="todos"?tareas:tareas.filter(item=>item.estado==="pendiente"),rows=base.filter(item=>!query||[item.titulo,item.expediente_numero,item.expediente_referencia,item.actor,item.demandado,item.notas].some(value=>String(value||"").toLocaleLowerCase("es").includes(query)));$("#task-count").textContent=`${rows.length} de ${base.length} tarea(s) mostrada(s)`;$("#task-list").innerHTML=rows.map(item=>`<div class="item task-row semaforo-${esc(item.semaforo)}"><span class="meta">${esc(item.aviso).toUpperCase()} · ${esc(item.fecha_vencimiento||"SIN FECHA")} ${esc(item.hora)} · ${esc(item.origen).toUpperCase()} · ${esc(item.prioridad).toUpperCase()}${item.fecha_realizacion?` · REALIZADA ${esc(item.fecha_realizacion)}`:""}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.expediente_numero||item.expediente_referencia||"Sin expediente vinculado")}</p><p>${esc(item.notas)}</p><span class="sync-badge ${esc(item.google_sync_estado)}">GOOGLE: ${esc(item.google_sync_estado||"sin sincronizar").replaceAll("_"," ").toUpperCase()}</span>${item.google_sync_error?`<p class="error-text">${esc(item.google_sync_error)}</p>`:""}<div class="task-row-actions"><button type="button" data-task-edit="${item.id}" class="secondary">Editar</button><button type="button" data-task-google="${item.id}" class="secondary" ${item.fecha_vencimiento?"":"disabled"}>Google Calendar</button><button type="button" data-task-iphone="${item.id}" class="secondary" ${item.fecha_vencimiento?"":"disabled"}>Enviar a iPhone</button>${item.estado==="pendiente"?`<button type="button" data-task-state="${item.id}" data-next-state="cumplido">Marcar cumplida</button>`:`<button type="button" data-task-state="${item.id}" data-next-state="pendiente">Reabrir</button>`}</div></div>`).join("")||'<div class="item">No hay tareas en esta vista.</div>';document.querySelectorAll("[data-task-edit]").forEach(button=>button.onclick=()=>editTask(Number(button.dataset.taskEdit)));document.querySelectorAll("[data-task-state]").forEach(button=>button.onclick=async()=>{const estado=button.dataset.nextState;await api(`/api/tareas/${button.dataset.taskState}/estado`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado})});toast(estado==="cumplido"?"Tarea marcada como cumplida":"Tarea reabierta");await Promise.all([loadTareas(),loadAgenda(),loadDashboard()]);});document.querySelectorAll("[data-task-google]").forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/api/tareas/${button.dataset.taskGoogle}/google-calendar`,{method:"POST"});toast("Tarea sincronizada con Google Calendar");await loadTareas();}catch(error){toast(error.message,true);}finally{button.disabled=false;}});document.querySelectorAll("[data-task-iphone]").forEach(button=>button.onclick=async()=>{try{const result=await api(`/api/tareas/${button.dataset.taskIphone}/recordatorio-iphone`);location.href=result.shortcut_url;toast(`Enviando al atajo ${result.shortcut_name}`);}catch(error){toast(error.message,true);}});}
async function loadTareas(){tareas=await api(`/api/tareas?estado=${taskFilter}`);renderTareas();await loadCalendarStatus();}
async function loadCalendarStatus(){try{const status=await api("/api/integraciones/calendario");$("#calendar-status").textContent=status.connected?`Google Calendar conectado · privacidad ${status.privacy}`:status.configured?"Google Calendar listo para conectar":"Google Calendar requiere configuración inicial";$("#connect-google").classList.toggle("hidden",status.connected);$("#sync-google").classList.toggle("hidden",!status.connected);$("#disconnect-google").classList.toggle("hidden",!status.connected);if(status.ultimo_error)$("#calendar-status").textContent+=` · Último error: ${status.ultimo_error}`;}catch(error){$("#calendar-status").textContent=error.message;}}
$("#connect-google").onclick=async()=>{try{const {url}=await api("/api/integraciones/google/autorizar");location.href=url;}catch(error){toast(error.message,true);}};
$("#sync-google").onclick=async event=>{event.currentTarget.disabled=true;try{const result=await api("/api/integraciones/google/sincronizar",{method:"POST"});toast(`${result.ok} de ${result.total} tarea(s) sincronizada(s)`);await loadTareas();}catch(error){toast(error.message,true);}finally{event.currentTarget.disabled=false;}};
$("#disconnect-google").onclick=async()=>{if(!confirm("¿Desconectar Google Calendar? Los eventos ya creados permanecerán en Google."))return;await api("/api/integraciones/google",{method:"DELETE"});toast("Google Calendar desconectado");await loadCalendarStatus();};
$("#iphone-help").onclick=()=>$("#iphone-setup").classList.toggle("hidden");
document.querySelectorAll("[data-task-filter]").forEach(button=>button.onclick=()=>{taskFilter=button.dataset.taskFilter;document.querySelectorAll("[data-task-filter]").forEach(item=>item.classList.toggle("active",item===button));loadTareas();});
$("#task-search").oninput=renderTareas;
$("#task-cancel-edit").onclick=resetTaskForm;
$("#task-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),id=Number(data.id||0);delete data.id;try{await api(id?`/api/tareas/${id}`:"/api/tareas",{method:id?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});resetTaskForm();toast(id?"Tarea actualizada":"Tarea agregada");await Promise.all([loadTareas(),loadDashboard()]);}catch(error){toast(error.message,true);}};

function renderClientes(query = "") {
  const q = query.trim().toLocaleLowerCase("es");
  const rows = clientes.filter(item => !q || [item.nombre, ...item.contrapartes, ...item.expedientes.map(e => e.numero)].some(value => String(value).toLocaleLowerCase("es").includes(q)));
  $("#client-list").innerHTML = rows.slice(0,50).map(item => `<div class="item"><span class="meta">CLIENTE · ${item.expedientes.length} EXPEDIENTE(S)</span><h3>${esc(item.nombre)}</h3><p><strong>Expedientes:</strong> ${item.expedientes.map(e => esc(e.numero)).join(", ")}</p><p><strong>Contrapartes:</strong> ${item.contrapartes.map(esc).join(" · ") || "Sin dato"}</p></div>`).join("") || '<div class="item">No se encontraron clientes.</div>';
}
async function loadClientes() { clientes = await api("/api/clientes"); renderClientes($("#client-search").value); }
$("#client-search").oninput = event => renderClientes(event.target.value);

function renderAgenda() {
  const rows = agendaFilter === "todos" ? agenda : agenda.filter(item => item.estado === "pendiente");
  $("#agenda-list").innerHTML = rows.map(item => `<div class="item status-${esc(item.estado)}"><span class="meta">${esc(item.fecha)} ${esc(item.hora)} · ${esc(item.tipo).toUpperCase()} · ${esc(item.estado).toUpperCase()}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.expediente_numero || "Sin expediente vinculado")}</p><p>${esc(item.notas)}</p>${item.estado === "pendiente" ? `<button data-agenda-done="${item.id}">Marcar cumplido</button>` : ""}</div>`).join("") || '<div class="item">No hay eventos en esta vista.</div>';
  document.querySelectorAll("[data-agenda-done]").forEach(button => button.onclick = async () => { await api(`/api/agenda/${button.dataset.agendaDone}/estado`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({estado:"cumplido"}) }); toast("Evento marcado como cumplido"); await Promise.all([loadAgenda(), loadDashboard()]); });
}
async function loadAgenda() { agenda = await api("/api/agenda"); renderAgenda(); }
document.querySelectorAll("[data-agenda-filter]").forEach(button => button.onclick = () => { agendaFilter = button.dataset.agendaFilter; document.querySelectorAll("[data-agenda-filter]").forEach(b => b.classList.toggle("active", b === button)); renderAgenda(); });
$("#agenda-form").onsubmit = async event => { event.preventDefault(); const form=event.currentTarget; try { await api("/api/agenda",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); form.reset(); toast("Evento agregado a la agenda"); await Promise.all([loadAgenda(),loadDashboard()]); } catch(error){ toast(error.message,true); } };

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function renderDocumentos() {
  const expedienteId = Number($("#doc-filter").value || 0);
  const rows = expedienteId ? documentos.filter(item => item.expediente_id === expedienteId) : documentos;
  $("#doc-list").innerHTML = rows.map(item => `<div class="item"><span class="meta">${esc(item.tipo).toUpperCase()} · VERSIÓN ${item.version}</span><h3>${esc(item.titulo)}</h3><p><strong>Expediente:</strong> ${esc(item.expediente_numero)} · ${esc(item.archivo_nombre)} · ${formatBytes(item.tamano)}</p><span class="hash" title="${esc(item.sha256)}">SHA-256: ${esc(item.sha256)}</span><p>${esc(item.notas)}</p><div class="doc-actions"><a href="/api/documentos/${item.id}/descargar">Descargar</a><small>${esc(item.created_at)}</small></div></div>`).join("") || '<div class="item">No hay documentos para este expediente.</div>';
}
async function loadDocumentos() { documentos = await api("/api/documentos"); renderDocumentos(); }
$("#doc-filter").onchange = renderDocumentos;
$("#doc-form").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; form.classList.add("loading");
  try { const result = await api("/api/documentos", { method:"POST", body:new FormData(form) }); form.reset(); toast(`Documento incorporado · versión ${result.version}`); await loadDocumentos(); }
  catch(error) { toast(error.message, true); } finally { form.classList.remove("loading"); }
};

function setExpMode(mode) {
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#exp-form").classList.toggle("hidden", mode !== "manual");
  $("#exp-ai-form").classList.toggle("hidden", mode !== "ia");
}
document.querySelectorAll("[data-mode]").forEach(button => button.onclick = () => setExpMode(button.dataset.mode));

function matchesExpediente(item, normalized) {
  return [item.numero, item.folio_interno, item.cliente, item.actor, item.demandado, item.contraparte, item.juzgado, item.asunto]
    .some(value => String(value || "").toLocaleLowerCase("es").includes(normalized));
}

function renderExpedientes(query = "") {
  const normalized = query.trim().toLocaleLowerCase("es");
  const filtered = normalized ? expedientes.filter(item => matchesExpediente(item, normalized)) : expedientes;
  const visible = filtered.slice(0, 40);
  $("#exp-count").textContent = expedientes.length.toLocaleString("es-MX");
  $("#exp-list").innerHTML = visible.map(item => `
    <div class="item">
      <span class="meta">${esc(item.folio_interno || item.estado_procesal || "CAPTURA MANUAL")} · <b class="case-status status-${esc(item.estado_expediente)}">${esc(item.estado_expediente||"activo").replaceAll("_"," ").toUpperCase()}</b></span>
      <h3>${esc(item.numero)}</h3>
      <p><strong>${esc(item.cliente || item.actor)}</strong></p>
      <p>${esc(item.actor)} vs. ${esc(item.demandado || item.contraparte)}</p>
      <p>${esc(item.juzgado)} · ${esc(item.distrito_judicial)} · ${esc(item.ciudad)}</p>
      <button data-edit="${item.id}">Editar</button> <button data-open-expediente="${item.id}" class="secondary">Abrir expediente</button>
    </div>`).join("") || '<div class="item">No se encontraron expedientes.</div>';
  $("#exp-limit").textContent = filtered.length > visible.length ? `Mostrando 40 de ${filtered.length}. Refine la búsqueda para localizar otro expediente.` : `${filtered.length} expediente(s) encontrado(s).`;
  document.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => editExp(Number(button.dataset.edit)));
  document.querySelectorAll("[data-open-expediente]").forEach(button => button.onclick = () => openExpediente(Number(button.dataset.openExpediente),"general","expedientes"));
}

function renderExpSuggestions(query) {
  const box = $("#exp-suggestions");
  const normalized = query.trim().toLocaleLowerCase("es");
  if (!normalized) { box.classList.add("hidden"); $("#exp-search").setAttribute("aria-expanded", "false"); return; }
  const matches = expedientes.filter(item => matchesExpediente(item, normalized)).slice(0, 12);
  box.innerHTML = matches.map(item => `<button type="button" role="option" data-exp-choice="${item.id}"><strong>${esc(item.numero)}</strong><span>${esc(item.actor || item.cliente || "Sin actor")} vs. ${esc(item.demandado || item.contraparte || "Sin demandado")}</span><small>${esc(item.juzgado || "Juzgado sin registrar")}</small></button>`).join("") || '<p class="no-suggestion">No se encontraron coincidencias.</p>';
  box.classList.remove("hidden");
  $("#exp-search").setAttribute("aria-expanded", "true");
  document.querySelectorAll("[data-exp-choice]").forEach(button => button.onclick = () => {
    const item = expedientes.find(row => row.id === Number(button.dataset.expChoice));
    $("#exp-search").value = item.numero;
    box.classList.add("hidden");
    $("#exp-search").setAttribute("aria-expanded", "false");
    renderExpedientes(item.numero);
    $("#exp-list").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

const expedienteComboboxes = new Map();
function expedienteTexto(id){const item=expedientes.find(row=>row.id===Number(id));return item?`${item.numero} — ${item.actor||item.cliente||"Sin actor"}`:"";}
function syncExpedienteCombobox(select){const control=expedienteComboboxes.get(select.id);if(!control)return;const option=[...select.options].find(row=>row.value===select.value);control.input.value=option?.textContent?.trim()||"";}
function enhanceExpedienteSelect(select){if(!select)return;let control=expedienteComboboxes.get(select.id);if(!control){const wrapper=document.createElement("div"),input=document.createElement("input"),results=document.createElement("div");wrapper.className="exp-combobox";input.type="search";input.autocomplete="off";input.placeholder="Escriba número, juzgado, actor o demandado";input.setAttribute("role","combobox");input.setAttribute("aria-autocomplete","list");results.className="exp-combobox-results hidden";select.parentNode.insertBefore(wrapper,select);wrapper.append(select,input,results);control={wrapper,input,results};expedienteComboboxes.set(select.id,control);const close=()=>results.classList.add("hidden");const render=()=>{const q=input.value.trim().toLocaleLowerCase("es"),special=[...select.options].filter(option=>option.value===""||option.value.startsWith("__")),matches=expedientes.filter(item=>!q||matchesExpediente(item,q)).slice(0,12),options=[...special.filter(option=>!q||option.textContent.toLocaleLowerCase("es").includes(q)).map(option=>({value:option.value,label:option.textContent,sub:""})),...matches.map(item=>({value:String(item.id),label:`${item.numero} — ${item.actor||item.cliente||"Sin actor"}`,sub:`${item.demandado||item.contraparte||"Sin contraparte"} · ${item.juzgado||"Sin juzgado"} · ${String(item.estado_expediente||"activo").replaceAll("_"," ").toUpperCase()}`}))];results.innerHTML=options.map(option=>`<button type="button" data-combobox-value="${esc(option.value)}"><strong>${esc(option.label)}</strong>${option.sub?`<small>${esc(option.sub)}</small>`:""}</button>`).join("")||'<p class="no-suggestion">No se encontraron coincidencias.</p>';results.classList.remove("hidden");results.querySelectorAll("[data-combobox-value]").forEach(button=>button.onclick=()=>{select.value=button.dataset.comboboxValue;input.value=button.querySelector("strong").textContent;close();select.dispatchEvent(new Event("change",{bubbles:true}));});};input.onfocus=render;input.oninput=()=>{select.value="";render();};input.onkeydown=event=>{if(event.key==="Escape")close();if(event.key==="Enter"){const first=results.querySelector("[data-combobox-value]");if(first){event.preventDefault();first.click();}}};document.addEventListener("click",event=>{if(!wrapper.contains(event.target))close();});if(select.form)select.form.addEventListener("reset",()=>setTimeout(()=>syncExpedienteCombobox(select),0));}
  syncExpedienteCombobox(select);
}
function refreshExpedienteComboboxes(){for(const id of ["gen-exp","agenda-exp","task-exp","doc-exp","doc-filter","acuerdo-exp"]){const select=$("#"+id);enhanceExpedienteSelect(select);syncExpedienteCombobox(select);}}

async function loadExp() {
  expedientes = await api("/api/expedientes");
  renderExpedientes($("#exp-search").value);
  $("#gen-exp").innerHTML = '<option value="">Seleccione…</option><option value="__pendiente__">＋ Asunto nuevo — número pendiente</option>' + expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
  $("#agenda-exp").innerHTML = '<option value="">Sin vincular</option>' + expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
  $("#task-exp").innerHTML = '<option value="">Sin vincular</option>' + expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
  const docOptions = expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
  $("#doc-exp").innerHTML = '<option value="">Seleccione…</option>' + docOptions;
  $("#doc-filter").innerHTML = '<option value="">Todos los expedientes</option>' + docOptions;
  $("#acuerdo-exp").innerHTML = '<option value="">Seleccione…</option>' + docOptions;
  if (currentAgreementExp) $("#acuerdo-exp").value = String(currentAgreementExp);
  refreshExpedienteComboboxes();
}

function renderDuplicateGroups(groups){const container=$("#duplicate-results"),button=$("#consolidate-duplicates");container.innerHTML=groups.map((group,index)=>`<div class="item duplicate-group"><label><input type="checkbox" data-duplicate-key="${esc(group.clave)}" checked> Consolidar grupo ${index+1}: expediente ${esc(group.numero)}</label><p><strong>${esc(group.organo)}</strong></p>${group.candidatos.map(row=>`<div class="duplicate-candidate"><span>${row.sera_principal?"✓":"→"}</span><div><strong>Registro interno #${row.id}${row.sera_principal?" · SE CONSERVA COMO PRINCIPAL":" · SE ARCHIVA TRAS CONSOLIDAR"}</strong><p>${esc(row.actor||"Sin actor")} ${row.demandado?`vs. ${esc(row.demandado)}`:""}</p><p>${esc(row.juzgado||"Sin juzgado")}</p><small>${row.conteos.documentos} documento(s) · ${row.conteos.acuerdos} acuerdo(s) · ${row.conteos.etapas||0} etapa(s) · ${row.conteos.tareas} tarea(s) · ${row.conteos.agenda} evento(s)</small></div></div>`).join("")}</div>`).join("")||'<div class="item">No se detectaron duplicados seguros.</div>';button.classList.toggle("hidden",!groups.length);}
$("#analyze-duplicates").onclick=async()=>{const button=$("#analyze-duplicates");button.disabled=true;try{const result=await api("/api/expedientes/duplicados");renderDuplicateGroups(result.grupos||[]);toast(result.grupos?.length?`Se detectaron ${result.grupos.length} grupo(s) para revisar`:"No se detectaron duplicados seguros");}catch(error){toast(error.message,true);}finally{button.disabled=false;}};
$("#consolidate-duplicates").onclick=async()=>{const claves=[...document.querySelectorAll("[data-duplicate-key]:checked")].map(input=>input.dataset.duplicateKey);if(!claves.length)return toast("Seleccione al menos un grupo",true);if(!confirm(`Se consolidarán ${claves.length} grupo(s). Los documentos y movimientos se conservarán en el expediente principal. ¿Continuar?`))return;const button=$("#consolidate-duplicates");button.disabled=true;try{const result=await api("/api/expedientes/duplicados/consolidar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmacion:"CONSOLIDAR",claves})});toast(`${result.grupos} grupo(s) consolidados · ${result.archivados} duplicado(s) archivados`);await loadExp();const preview=await api("/api/expedientes/duplicados");renderDuplicateGroups(preview.grupos||[]);}catch(error){toast(error.message,true);}finally{button.disabled=false;}};

async function openAcuerdos(id){currentAgreementExp=id;$("#acuerdo-exp").value=String(id);syncExpedienteCombobox($("#acuerdo-exp"));document.querySelectorAll("nav button,.view").forEach(element=>element.classList.remove("active"));document.querySelector('nav button[data-view="acuerdos"]').classList.add("active");$("#acuerdos").classList.add("active");setAgreementTab("resumen");await loadAcuerdos();$("#acuerdo-workspace").scrollIntoView({behavior:"smooth",block:"start"});}

function setDetailTab(tab){document.querySelectorAll("[data-detail-tab]").forEach(button=>button.classList.toggle("active",button.dataset.detailTab===tab));document.querySelectorAll(".detail-panel").forEach(panel=>panel.classList.add("hidden"));$("#detail-"+tab).classList.remove("hidden");}
document.querySelectorAll("[data-detail-tab]").forEach(button=>button.onclick=()=>setDetailTab(button.dataset.detailTab));

async function openExpediente(id,tab="general",returnView="expedientes"){
  currentDetailExp=id;detailReturnView=returnView;detailReturnY=window.scrollY;
  document.querySelectorAll("nav button,.view").forEach(element=>element.classList.remove("active"));
  const sourceButton=document.querySelector(`nav button[data-view="${returnView}"]`);if(sourceButton)sourceButton.classList.add("active");
  $("#expediente-detalle").classList.add("active");setDetailTab(tab);window.scrollTo({top:0,behavior:"smooth"});
  try{await loadExpedienteDetalle();}catch(error){toast(error.message,true);}
}
async function loadExpedienteDetalle(){
  const expediente=expedientes.find(item=>item.id===currentDetailExp);if(!expediente)throw new Error("Expediente no encontrado");
  const [acuerdos,resumen,docs,taskRows,stages]=await Promise.all([api(`/api/acuerdos?expediente_id=${expediente.id}`),api(`/api/expedientes/${expediente.id}/resumen-acuerdos`),api(`/api/documentos?expediente_id=${expediente.id}`),api(`/api/tareas?estado=todos&expediente_id=${expediente.id}`),api(`/api/expedientes/${expediente.id}/etapas`)]);
  $("#detail-title").textContent=`Expediente ${expediente.numero}`;$("#detail-subtitle").textContent=`${expediente.actor||expediente.cliente||"Sin actor"} vs. ${expediente.demandado||expediente.contraparte||"Sin demandado"}`;
  const fields=[["Tipo de juicio",expediente.tipo_juicio],["Actor",expediente.actor||expediente.cliente],["Demandado",expediente.demandado||expediente.contraparte],["Juzgado",expediente.juzgado],["Distrito judicial",expediente.distrito_judicial],["Ciudad",expediente.ciudad],["Estado procesal",expediente.estado_procesal],["Situación",String(expediente.estado_expediente||"activo").replaceAll("_"," ").toUpperCase()],["Próxima etapa",expediente.etapa_proxima],["Fecha objetivo",expediente.proximo_termino],["Última actuación",expediente.ultima_actuacion],["Notas",expediente.notas]];
  $("#detail-general").innerHTML=`<div class="case-status-control"><label>Situación operativa<select id="detail-case-status"><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="concluido">Concluido</option><option value="archivado">Archivado</option><option value="pendiente_numero">Provisional · número pendiente</option></select></label><small>Los suspendidos, concluidos y archivados se conservan, pero no se incluyen en la consulta automática diaria.</small></div><div class="detail-grid">${fields.map(([label,value])=>`<div class="detail-field"><strong>${esc(label)}</strong>${esc(value||"Sin dato")}</div>`).join("")}</div><p><button type="button" data-detail-edit="${expediente.id}">Editar datos</button></p>`;
  $("#detail-case-status").value=["activo","suspendido","concluido","archivado","pendiente_numero"].includes(expediente.estado_expediente)?expediente.estado_expediente:"activo";
  $("#detail-case-status").onchange=async event=>{const nuevo=event.target.value;if(!confirm(`Cambiar la situación del expediente ${expediente.numero} a ${nuevo.toUpperCase()}?`)){event.target.value=expediente.estado_expediente;return;}event.target.disabled=true;try{await api(`/api/expedientes/${expediente.id}/estado`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado:nuevo})});toast("Situación del expediente actualizada");await loadExp();await Promise.all([loadExpedienteDetalle(),loadDashboard()]);}catch(error){event.target.value=expediente.estado_expediente;toast(error.message,true);}finally{event.target.disabled=false;}};
  $("#detail-general [data-detail-edit]").onclick=()=>{document.querySelector('nav button[data-view="expedientes"]').click();setTimeout(()=>editExp(expediente.id),0);};
  $("#detail-agreement-count").textContent=`${acuerdos.length} publicación(es) incorporada(s)`;$("#detail-summary").textContent=resumen.resumen_acuerdos||"Todavía no existe un resumen procesal.";$("#detail-agreement-download").href=`/api/expedientes/${expediente.id}/acuerdos.csv`;
  $("#detail-agreement-list").innerHTML=acuerdos.map(item=>`<div class="item"><span class="meta">${esc(item.fecha_publicacion||item.created_at.slice(0,10))} · ${esc(item.tipo_asunto)}</span><h3>${esc(item.numero_asunto||expediente.numero)}</h3><p>${esc(item.organo)}</p><div class="official-text">${esc(item.texto||item.sintesis)}</div><small>Fuente: ${esc(item.fuente_url)} · SHA-256 ${esc(item.sha256)}</small></div>`).join("")||'<div class="item">No hay publicaciones incorporadas.</div>';
  $("#detail-document-list").innerHTML=docs.map(item=>`<div class="item"><span class="meta">${esc(item.tipo).toUpperCase()} · VERSIÓN ${item.version}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.archivo_nombre)} · ${formatBytes(item.tamano)}</p><a class="download" href="/api/documentos/${item.id}/descargar">Descargar</a></div>`).join("")||'<div class="item">Este expediente no tiene documentos incorporados.</div>';
  $("#detail-task-list").innerHTML=taskRows.map(item=>`<div class="item task-row semaforo-${esc(item.semaforo)}"><span class="meta">${esc(item.aviso).toUpperCase()} · ${esc(item.fecha_vencimiento||"SIN FECHA")} ${esc(item.hora)}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.notas)}</p>${item.estado==="pendiente"?`<button data-detail-task-done="${item.id}">Marcar cumplida</button>`:""}</div>`).join("")||'<div class="item">Este expediente no tiene tareas.</div>';
  renderStages(stages);
  document.querySelectorAll("[data-detail-task-done]").forEach(button=>button.onclick=async()=>{await api(`/api/tareas/${button.dataset.detailTaskDone}/estado`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado:"cumplido"})});toast("Tarea marcada como cumplida");await Promise.all([loadExpedienteDetalle(),loadTareas(),loadAgenda(),loadDashboard()]);});
}
function resetStageForm(){const form=$("#stage-form");form.reset();form.elements.id.value="";$("#stage-form-title").textContent="Nueva etapa";form.classList.add("hidden");}
function renderStages(data){$("#stage-progress").value=data.avance||0;$("#stage-progress-label").textContent=`${data.avance||0}% completado · ${data.completadas||0} de ${data.total||0} etapas`;$("#stage-list").innerHTML=(data.rows||[]).map(row=>`<article class="stage-item ${esc(row.estado)}"><span class="stage-dot"></span><div><span class="meta">ETAPA ${row.orden} · ${esc(row.estado).replaceAll("_"," ").toUpperCase()}${row.fecha_objetivo?` · OBJETIVO ${esc(row.fecha_objetivo)}`:""}</span><h3>${esc(row.titulo)}</h3><p>${esc(row.notas)}</p><div class="stage-actions"><button type="button" data-stage-edit="${row.id}" class="secondary">Editar</button>${row.estado!=="en_curso"&&row.estado!=="completada"?`<button type="button" data-stage-state="${row.id}" data-stage-next="en_curso">Iniciar</button>`:""}${row.estado!=="completada"?`<button type="button" data-stage-state="${row.id}" data-stage-next="completada">Marcar completada</button>`:""}${row.estado==="completada"?`<button type="button" data-stage-state="${row.id}" data-stage-next="pendiente" class="secondary">Reabrir</button>`:""}</div></div></article>`).join("")||'<div class="item">Todavía no hay etapas. Agregue la primera para iniciar el control de avance.</div>';document.querySelectorAll("[data-stage-state]").forEach(button=>button.onclick=async()=>{await api(`/api/etapas/${button.dataset.stageState}/estado`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado:button.dataset.stageNext})});toast("Etapa actualizada");await Promise.all([loadExp(),loadExpedienteDetalle(),loadTareas(),loadDashboard()]);});document.querySelectorAll("[data-stage-edit]").forEach(button=>button.onclick=async()=>{const data=await api(`/api/expedientes/${currentDetailExp}/etapas`),row=data.rows.find(item=>item.id===Number(button.dataset.stageEdit));if(!row)return;const form=$("#stage-form");for(const field of ["id","titulo","fecha_objetivo","estado","notas"])if(form.elements[field])form.elements[field].value=row[field]??"";form.elements.estado.disabled=true;$("#stage-form-title").textContent="Editar etapa";form.classList.remove("hidden");form.scrollIntoView({behavior:"smooth",block:"center"});});}
$("#new-stage").onclick=()=>{resetStageForm();$("#stage-form").elements.estado.disabled=false;$("#stage-form").classList.remove("hidden");};
$("#cancel-stage").onclick=()=>{$("#stage-form").elements.estado.disabled=false;resetStageForm();};
$("#stage-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),id=Number(data.id||0);delete data.id;try{await api(id?`/api/etapas/${id}`:`/api/expedientes/${currentDetailExp}/etapas`,{method:id?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});form.elements.estado.disabled=false;resetStageForm();toast(id?"Etapa corregida":"Etapa agregada");await Promise.all([loadExp(),loadExpedienteDetalle(),loadTareas(),loadDashboard()]);}catch(error){toast(error.message,true);}};
$("#detail-back").onclick=()=>{const button=document.querySelector(`nav button[data-view="${detailReturnView}"]`);if(button)button.click();requestAnimationFrame(()=>window.scrollTo({top:detailReturnY,behavior:"smooth"}));};
$("#detail-summarize").onclick=async()=>{if(!currentDetailExp)return;const button=$("#detail-summarize");button.disabled=true;try{const result=await api(`/api/expedientes/${currentDetailExp}/resumen-acuerdos`,{method:"POST"});$("#detail-summary").textContent=result.resumen;toast("Resumen procesal actualizado");}catch(error){toast(error.message,true);}finally{button.disabled=false;}};

function setAgreementTab(tab){document.querySelectorAll("[data-agreement-tab]").forEach(button=>button.classList.toggle("active",button.dataset.agreementTab===tab));$("#agreement-resumen").classList.toggle("hidden",tab!=="resumen");$("#agreement-historico").classList.toggle("hidden",tab!=="historico");$("#acuerdo-form").classList.toggle("hidden",tab!=="incorporar");}
document.querySelectorAll("[data-agreement-tab]").forEach(button=>button.onclick=()=>setAgreementTab(button.dataset.agreementTab));

async function loadAcuerdos(){
  const id=Number($("#acuerdo-exp").value||currentAgreementExp||0);currentAgreementExp=id||null;$("#acuerdo-workspace").classList.toggle("hidden",!id);if(!id)return;
  const expediente=expedientes.find(item=>item.id===id),[rows,resumen]=await Promise.all([api(`/api/acuerdos?expediente_id=${id}`),api(`/api/expedientes/${id}/resumen-acuerdos`)]);
  const form=$("#acuerdo-form");form.elements.expediente_id.value=id;form.elements.numero_asunto.value=expediente?.numero||"";form.elements.organo.value=expediente?.juzgado||"";
  $("#acuerdo-count").textContent=`${rows.length} publicación(es) vinculada(s)`;$("#acuerdo-summary").textContent=resumen.resumen_acuerdos||"Todavía no se ha generado un resumen del histórico.";$("#download-acuerdos").href=`/api/expedientes/${id}/acuerdos.csv`;
  $("#acuerdo-list").innerHTML=rows.map(item=>`<div class="item"><span class="meta">${esc(item.fecha_publicacion||item.created_at.slice(0,10))} · ${esc(item.tipo_asunto)}</span><h3>${esc(item.numero_asunto||expediente?.numero)}</h3><p>${esc(item.organo)}</p><div class="official-text">${esc(item.texto||item.sintesis)}</div><small>Texto incorporado desde: ${esc(item.fuente_url)} · SHA-256 ${esc(item.sha256)}</small></div>`).join("")||'<div class="item">No hay publicaciones incorporadas.</div>';
}
$("#acuerdo-exp").onchange=event=>{currentAgreementExp=Number(event.target.value||0)||null;loadAcuerdos().catch(error=>toast(error.message,true));};
$("#acuerdo-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;form.classList.add("loading");try{const result=await api("/api/acuerdos",{method:"POST",body:new FormData(form)});form.elements.archivo.value="";form.elements.texto.value="";toast(result.coincide_numero?"Publicación incorporada al expediente":"Publicación incorporada; verifique manualmente que corresponde al expediente");await Promise.all([loadAcuerdos(),loadExp()]);}catch(error){toast(error.message,true);}finally{form.classList.remove("loading");}};
$("#summarize-acuerdos").onclick=async()=>{if(!currentAgreementExp)return;$("#summarize-acuerdos").disabled=true;toast("Analizando la cronología de acuerdos…");try{const result=await api(`/api/expedientes/${currentAgreementExp}/resumen-acuerdos`,{method:"POST"});$("#acuerdo-summary").textContent=result.resumen;toast(`Resumen actualizado con ${result.total} publicación(es)`);}catch(error){toast(error.message,true);}finally{$("#summarize-acuerdos").disabled=false;}};
$("#refresh-acuerdos").onclick=()=>loadAcuerdos().catch(error=>toast(error.message,true));

function renderPortfolio(run){
  if(!run?.id)return;
  if(portfolioCacheRun!==run.id){portfolioCacheRun=run.id;portfolioMovementCache=new Map();}
  for(const row of run.movimientos||[]){
    const key=[row.expediente_id,row.fecha_publicacion,String(row.sintesis||"").trim().toUpperCase()].join("|");
    const previous=portfolioMovementCache.get(key);
    portfolioMovementCache.set(key,previous?{...previous,...row,organo:previous.organo||row.organo,secretaria:previous.secretaria||row.secretaria}:row);
  }
  currentPortfolioJob=run.id;
  const percent=run.total?Math.round(run.procesados/run.total*100):0;
  const modo=run.modo==="historico"?"CARGA HISTÓRICA INICIAL":`CONSULTA DIARIA ${run.fecha_consulta||""}`;
  const active=run.estado==="ejecutando";
  $("#portfolio-progress").value=percent;
  $("#portfolio-status").textContent=`${modo} · ${run.estado.toUpperCase()} · ${run.procesados} de ${run.total} revisados · ${run.encontrados} expedientes con publicaciones · ${run.nuevas_publicaciones} movimientos nuevos · ${run.errores} por revisar`;
  $("#query-portfolio").disabled=active;
  $("#query-portfolio").textContent=run.modo==="historico"&&run.estado!=="terminada"?"Continuar carga histórica":"Consultar movimientos de hoy";
  $("#stop-portfolio").classList.toggle("hidden",!active);
  $("#download-portfolio").classList.toggle("disabled",active);
  $("#download-portfolio").href=active?"#":`/api/acuerdos/consulta-cartera/${run.id}/concentrado.csv`;
  const visibles=(run.detalle||[]).filter(row=>row.publicaciones||row.estado==="error"||row.estado==="sin_configuracion");
  if(run.modo==="diario"){
    if(active){
      $("#portfolio-results").innerHTML=`<div class="item portfolio-staging"><h3>Consulta en proceso</h3><p>Se han localizado ${Number(run.encontrados||0)} expediente(s) con publicaciones.</p><p>El concentrado definitivo se mostrará al concluir para evitar movimientos, duplicados o desaparición temporal de filas.</p></div>`;
      return;
    }
    const grupos=new Map();for(const row of portfolioMovementCache.values()){const organo=row.organo||"ÓRGANO JUDICIAL SIN IDENTIFICAR";if(!grupos.has(organo))grupos.set(organo,new Map());const secretaria=row.secretaria||"Secretaría no identificada";if(!grupos.get(organo).has(secretaria))grupos.get(organo).set(secretaria,[]);grupos.get(organo).get(secretaria).push(row);}
    $("#portfolio-results").innerHTML=[...grupos].map(([organo,secretarias])=>`<section class="stj-list"><header><h3>${esc(organo)}</h3><p>${esc(run.fecha_consulta||"")}</p></header>${[...secretarias].map(([secretaria,rows])=>`<h4>${esc(secretaria)}</h4><div class="stj-column-labels"><span>Asunto</span><span>Partes</span><span>Síntesis</span><span>Acción</span></div>${rows.map(row=>`<article class="stj-publication"><strong>${esc(row.tipo_asunto||"Exp.")} ${esc(row.numero_asunto||row.numero)}</strong><p>${esc(row.partes||[row.actor,row.demandado].filter(Boolean).join(" VS ")||"Partes no identificadas")}</p><p>${esc(row.sintesis||"Sin síntesis publicada")}</p><button type="button" data-open-result="${row.expediente_id}">Abrir expediente</button></article>`).join("")}`).join("")}</section>`).join("")||'<div class="item">No se encontraron publicaciones de expedientes de la cartera en la lista de hoy.</div>';
  }else{
    $("#portfolio-results").innerHTML=visibles.slice(0,40).map(row=>`<div class="item"><span class="meta">${esc(row.estado).toUpperCase()} · ${row.publicaciones} PUBLICACIÓN(ES) · ${row.nuevas} NUEVA(S)</span><h3>${esc(row.numero)}</h3><p><strong>${esc(row.stj_organo_oficial||row.juzgado||"Órgano sin identificar")}</strong></p><p>${esc(row.actor||"")} ${row.demandado?`vs. ${esc(row.demandado)}`:""}</p><p>${esc(row.ultima_fecha?`Última publicación: ${row.ultima_fecha}`:row.mensaje)}</p><button type="button" data-open-result="${row.expediente_id}">Abrir expediente</button></div>`).join("")||'<div class="item">Aún no hay coincidencias para mostrar.</div>';
  }
  document.querySelectorAll("[data-open-result]").forEach(button=>button.onclick=()=>openExpediente(Number(button.dataset.openResult),"acuerdos","acuerdos"));
  if(!active&&portfolioTimer){clearInterval(portfolioTimer);portfolioTimer=null;loadExp().catch(()=>{});}
}
async function pollPortfolio(){if(!currentPortfolioJob||portfolioPolling)return;portfolioPolling=true;const requestedJob=currentPortfolioJob;try{const run=await api(`/api/acuerdos/consulta-cartera/${requestedJob}`);if(requestedJob===currentPortfolioJob)renderPortfolio(run);}catch(error){if(portfolioTimer)clearInterval(portfolioTimer);portfolioTimer=null;toast(error.message,true);}finally{portfolioPolling=false;}}
async function loadLatestPortfolio(){try{const run=await api("/api/acuerdos/consulta-cartera/ultima");if(run.id){renderPortfolio(run);if(run.estado==="ejecutando"&&!portfolioTimer)portfolioTimer=setInterval(pollPortfolio,1500);}}catch(error){toast(error.message,true);}}
$("#query-portfolio").onclick=async()=>{try{const result=await api("/api/acuerdos/consulta-cartera",{method:"POST"});currentPortfolioJob=result.id;portfolioCacheRun=result.id;portfolioMovementCache=new Map();toast("Consulta de toda la cartera iniciada");await pollPortfolio();if(!portfolioTimer)portfolioTimer=setInterval(pollPortfolio,1500);}catch(error){toast(error.message,true);}};
$("#stop-portfolio").onclick=async()=>{if(!currentPortfolioJob)return;try{await api(`/api/acuerdos/consulta-cartera/${currentPortfolioJob}/detener`,{method:"POST"});toast("Se solicitó detener la consulta");}catch(error){toast(error.message,true);}};

function editExp(id) {
  const item = expedientes.find(row => row.id === id);
  const form = $("#exp-form");
  setExpMode("manual");
  Object.keys(item).forEach(key => { if (form.elements[key]) form.elements[key].value = item[key] ?? ""; });
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#exp-search").oninput = event => { renderExpSuggestions(event.target.value); renderExpedientes(event.target.value); };
$("#exp-search").onfocus = event => renderExpSuggestions(event.target.value);
$("#exp-search").onkeydown = event => {
  if (event.key === "Escape") { $("#exp-suggestions").classList.add("hidden"); event.currentTarget.setAttribute("aria-expanded", "false"); }
  if (event.key === "Enter") { const first = $("#exp-suggestions [data-exp-choice]"); if (first) { event.preventDefault(); first.click(); } }
};
document.addEventListener("click", event => { if (!event.target.closest(".smart-search")) { $("#exp-suggestions").classList.add("hidden"); $("#exp-search").setAttribute("aria-expanded", "false"); } });
$("#nuevo").onclick = () => { $("#exp-form").reset(); setExpMode("manual"); $("#exp-form").scrollIntoView({ behavior: "smooth" }); };
$("#exp-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  try {
    await api(id ? `/api/expedientes/${id}` : "/api/expedientes", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    form.reset();
    toast(id ? "Expediente corregido y cambio auditado" : "Expediente creado");
    await loadExp();
  } catch (error) { toast(error.message, true); }
};

$("#exp-ai-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  form.classList.add("loading");
  try {
    const result = await api("/api/expedientes/ia/estructurar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const manual = $("#exp-form");
    manual.reset();
    Object.entries(result.propuesta).forEach(([key, value]) => { if (manual.elements[key]) manual.elements[key].value = value || ""; });
    setExpMode("manual");
    toast("Propuesta creada. Revise todos los campos antes de guardar.");
  } catch (error) { toast(error.message, true); } finally { form.classList.remove("loading"); }
};

async function loadTes(query = "") {
  const rows = await api(`/api/tesauro?q=${encodeURIComponent(query)}`);
  $("#tes-list").innerHTML = rows.map(item => `<div class="item"><span class="meta">${esc(item.clase.replaceAll("_", " ").toUpperCase())}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.organo)} · ${esc(item.expediente_origen)} · ${esc(item.fecha_resolucion)}</p><p>Estado: ${esc(item.estado)} · Archivo: ${esc(item.archivo_nombre)}</p></div>`).join("") || '<div class="item">No se encontraron documentos.</div>';
}
let searchTimer;
$("#tes-search").oninput = event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadTes(event.target.value), 250); };
$("#tes-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add("loading");
  toast("Extrayendo texto; un PDF escaneado puede tardar varios minutos");
  try {
    const result = await api("/api/tesauro", { method: "POST", body: new FormData(form) });
    toast(`Documento incorporado: ${result.caracteres.toLocaleString()} caracteres · ${result.metodo_extraccion}`);
    form.reset();
    await loadTes();
  } catch (error) { toast(error.message, true); } finally { form.classList.remove("loading"); }
};

$("#gen-form").elements.anexos.onchange = () => {
  $("#gen-form").elements.analisis_id.value = "";
  $("#extracted-panel").classList.add("hidden");
};

$("#analyze-docs").onclick = async () => {
  const form = $("#gen-form");
  const files = form.elements.anexos.files;
  if (!files.length) return toast("Seleccione la escritura o documentos fuente", true);
  const data = new FormData();
  for (const file of files) data.append("anexos", file);
  data.append("expediente_id", form.elements.expediente_id.value);
  $("#analyze-docs").disabled = true;
  $("#analysis-progress").classList.remove("hidden");
  $("#analysis-bar").style.width = "1%";
  $("#analysis-status").textContent = "Subiendo documentos…";
  toast("Análisis iniciado. Puede seguir el progreso en pantalla.");
  try {
    const started = await api("/api/generaciones/analizar", { method:"POST", body:data });
    currentAnalysisJob = started.job_id;
    let status;
    const deadline = Date.now() + 45 * 60 * 1000;
    do {
      await new Promise(resolve => setTimeout(resolve, 2000));
      status = await api(`/api/generaciones/analizar/${currentAnalysisJob}`);
      $("#analysis-bar").style.width = `${status.porcentaje || 0}%`;
      $("#analysis-status").textContent = `${status.porcentaje || 0}% · ${status.fase || "Procesando"}`;
      if (["error","cancelado"].includes(status.estado)) throw new Error(status.error || status.fase || "El análisis no concluyó");
      if (Date.now() > deadline) throw new Error("El análisis excedió 45 minutos y fue detenido");
    } while (status.estado !== "completado");
    const result = status.resultado;
    form.elements.analisis_id.value = result.id;
    for (const [key,value] of Object.entries(result.datos)) if (form.elements[key]) form.elements[key].value = value || "";
    $("#extracted-panel").classList.remove("hidden");
    $("#extracted-panel").scrollIntoView({ behavior:"smooth", block:"start" });
    toast(`Extracción terminada: ${result.archivos.length} documento(s). Revise los datos antes de generar.`);
  } catch(error) { toast(error.message, true); }
  finally { $("#analyze-docs").disabled = false; currentAnalysisJob = null; }
};

$("#cancel-analysis").onclick = async () => {
  if (!currentAnalysisJob) return;
  try { await api(`/api/generaciones/analizar/${currentAnalysisJob}`, { method:"DELETE" }); $("#analysis-status").textContent = "Cancelación solicitada…"; }
  catch(error) { toast(error.message, true); }
};

$("#gen-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.anexos.files.length && !form.elements.analisis_id.value) return toast("Primero presione Analizar y extraer datos", true);
  if (currentGenerationJob) return toast("Ya existe una generación en curso", true);
  $("#generate-draft").disabled = true;
  $("#generation-progress").classList.remove("hidden");
  $("#generation-bar").style.width = "1%";
  $("#generation-status").textContent = "Enviando datos confirmados…";
  toast("Generación iniciada. Puede observar el avance o detener el proceso.");
  try {
    const data = new FormData(form);
    if (form.elements.analisis_id.value) data.delete("anexos");
    const started = await api("/api/generaciones", { method:"POST", body:data });
    currentGenerationJob = started.job_id;
    let status;
    do {
      await new Promise(resolve => setTimeout(resolve, 2000));
      status = await api(`/api/generaciones/proceso/${currentGenerationJob}`);
      $("#generation-bar").style.width = `${status.porcentaje || 0}%`;
      $("#generation-status").textContent = `${status.porcentaje || 0}% · ${status.fase || "Procesando"}`;
      if (["error","cancelado"].includes(status.estado)) throw new Error(status.error || status.fase || "La generación no concluyó");
    } while (status.estado !== "completado");
    const result = status.resultado;
    currentGenerationId = result.id;
    $("#resultado-editor").value = result.resultado;
    $("#control-calidad").textContent = result.control_calidad;
    $("#gen-review").classList.remove("hidden");
    $("#approval-status").textContent = "Pendiente de autorización";
    $("#approval-status").classList.remove("approved");
    for (const link of [$("#download-word"), $("#download-pdf")]) { link.classList.add("disabled"); link.href = "#"; }
    const provisional = result.expediente?.pendiente_numero ? ` · expediente provisional ${result.expediente.numero} creado` : "";
    toast(`Borrador generado con ${result.modelo}; ${result.fuentes.length} fuentes recuperadas${provisional}`);
    $("#gen-review").scrollIntoView({ behavior:"smooth", block:"start" });
    if (result.expediente?.pendiente_numero) await Promise.all([loadExp(), loadClientes(), loadDashboard()]);
    await loadDrafts();
  } catch (error) { toast(error.message, true); }
  finally { $("#generate-draft").disabled = false; currentGenerationJob = null; }
};

$("#cancel-generation").onclick = async () => {
  if (!currentGenerationJob) return;
  try {
    await api(`/api/generaciones/proceso/${currentGenerationJob}`, { method:"DELETE" });
    $("#generation-status").textContent = "Deteniendo generación…";
    $("#cancel-generation").disabled = true;
  } catch(error) { toast(error.message, true); }
  finally { setTimeout(() => { $("#cancel-generation").disabled = false; }, 2500); }
};

$("#resultado-editor").oninput = () => {
  $("#approval-status").textContent = "Cambios pendientes de autorización";
  $("#approval-status").classList.remove("approved");
  $("#download-word").classList.add("disabled");
  $("#download-pdf").classList.add("disabled");
};

$("#aprobar-final").onclick = async () => {
  if (!currentGenerationId) return toast("Primero genere un borrador", true);
  try {
    const result = await api(`/api/generaciones/${currentGenerationId}/aprobar`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ texto:$("#resultado-editor").value, aprobado_por:$("#aprobado-por").value }) });
    $("#approval-status").textContent = `Autorizado · ${new Date(result.aprobado_at).toLocaleString("es-MX")}`;
    $("#approval-status").classList.add("approved");
    $("#download-word").href = `/api/generaciones/${currentGenerationId}/exportar/docx`;
    $("#download-pdf").href = `/api/generaciones/${currentGenerationId}/exportar/pdf`;
    $("#download-word").classList.remove("disabled");
    $("#download-pdf").classList.remove("disabled");
    toast("Versión final autorizada. Descargas habilitadas.");
    await loadDrafts();
  } catch(error) { toast(error.message, true); }
};

$("#save-draft").onclick = async () => {
  if (!currentGenerationId) return toast("Primero genere o abra un borrador", true);
  try {
    await api(`/api/generaciones/${currentGenerationId}/borrador`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ texto:$("#resultado-editor").value }) });
    $("#approval-status").textContent = "Borrador guardado · pendiente de autorización";
    $("#approval-status").classList.remove("approved");
    $("#download-word").classList.add("disabled"); $("#download-pdf").classList.add("disabled");
    toast("Cambios guardados. No se consumieron créditos de OpenAI.");
    await loadDrafts();
  } catch(error) { toast(error.message, true); }
};

$("#refresh-drafts").onclick = loadDrafts;

$("#gen-exp").onchange = event => {
  const pendiente = event.target.value === "__pendiente__";
  $("#gen-pendiente").classList.toggle("hidden", !pendiente);
};

async function loadAudit() {
  const rows = await api("/api/auditoria");
  $("#audit-list").innerHTML = rows.map(item => `<div class="item"><span class="meta">${esc(item.created_at)} · ${esc(item.usuario || "sistema")}</span><h3>${esc(item.accion)} · ${esc(item.entidad)} #${esc(item.entidad_id)}</h3><p>${esc(item.detalle)}</p></div>`).join("") || '<div class="item">Sin movimientos.</div>';
}

async function loadBackups(){const rows=await api("/api/respaldos");$("#backup-list").innerHTML=rows.map(item=>`<div class="item"><span class="meta">${esc(new Date(item.created_at).toLocaleString("es-MX"))}</span><h3>${esc(item.nombre)}</h3><p>${formatBytes(item.tamano)}</p><a class="download" href="/api/respaldos/${encodeURIComponent(item.nombre)}/descargar">Descargar copia cifrada</a></div>`).join("")||'<div class="item">Todavía no hay respaldos.</div>';}
$("#backup-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;form.classList.add("loading");try{const result=await api("/api/respaldos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:form.elements.password.value})});form.reset();toast(`Respaldo creado y cifrado: ${result.nombre}`);await loadBackups();}catch(error){toast(error.message,true);}finally{form.classList.remove("loading");}};
$("#verify-backup-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;form.classList.add("loading");try{const result=await api("/api/respaldos/verificar",{method:"POST",body:new FormData(form)});toast(`Respaldo íntegro: ${result.archivos} archivo(s), versión ${result.app_version}`);}catch(error){toast(error.message,true);}finally{form.classList.remove("loading");}};
$("#refresh-backups").onclick=loadBackups;

try {
  const session = await api("/api/session");
  csrfToken = session.csrf || "";
  const health = await api("/api/health");
  $("#health").textContent = `${health.aiConfigured ? "Motor OpenAI listo" : "Motor sin configurar"} · v${health.version || "?"}`;
  await Promise.all([loadExp(), loadTes(), loadClientes(), loadAgenda(), loadTareas(), loadDashboard(), loadDocumentos(), loadDrafts()]);
} catch (error) { toast(error.message, true); }
