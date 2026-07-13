const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let expedientes = [];
let clientes = [];
let agenda = [];
let agendaFilter = "pendiente";

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#8b2635" : "#192f45";
  element.style.display = "block";
  setTimeout(() => element.style.display = "none", 5000);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Error de operación");
  return data;
}

document.querySelectorAll("nav button").forEach(button => button.onclick = () => {
  document.querySelectorAll("nav button,.view").forEach(element => element.classList.remove("active"));
  button.classList.add("active");
  $("#" + button.dataset.view).classList.add("active");
  if (button.dataset.view === "auditoria") loadAudit();
  if (button.dataset.view === "inicio") loadDashboard();
});

async function loadDashboard() {
  const data = await api("/api/dashboard");
  const metrics = [["Expedientes", data.total], ["Activos", data.activos], ["Datos por completar", data.incompletos], ["Fuentes validadas", data.tesauro]];
  $("#metrics").innerHTML = metrics.map(([label,value]) => `<div class="metric"><strong>${Number(value).toLocaleString("es-MX")}</strong><span>${esc(label)}</span></div>`).join("");
  $("#dash-agenda").innerHTML = data.proximos.map(item => `<div class="item"><span class="meta">${esc(item.fecha)} ${esc(item.hora)} · ${esc(item.tipo)}</span><h3>${esc(item.titulo)}</h3><p>${esc(item.expediente_numero || "Sin expediente vinculado")}</p></div>`).join("") || '<div class="item">No hay vencimientos próximos registrados.</div>';
  const max = Math.max(1, ...data.estados.map(item => item.total));
  $("#dash-estados").innerHTML = data.estados.map(item => `<div class="bar-row"><span>${esc(item.nombre)}</span><div class="bar"><i style="width:${Math.round(item.total/max*100)}%"></i></div><strong>${item.total}</strong></div>`).join("");
}

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

function setExpMode(mode) {
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#exp-form").classList.toggle("hidden", mode !== "manual");
  $("#exp-ai-form").classList.toggle("hidden", mode !== "ia");
}
document.querySelectorAll("[data-mode]").forEach(button => button.onclick = () => setExpMode(button.dataset.mode));

function renderExpedientes(query = "") {
  const normalized = query.trim().toLocaleLowerCase("es");
  const filtered = normalized ? expedientes.filter(item => [item.numero, item.folio_interno, item.cliente, item.actor, item.demandado, item.juzgado, item.asunto].some(value => String(value || "").toLocaleLowerCase("es").includes(normalized))) : expedientes;
  const visible = filtered.slice(0, 40);
  $("#exp-count").textContent = expedientes.length.toLocaleString("es-MX");
  $("#exp-list").innerHTML = visible.map(item => `
    <div class="item">
      <span class="meta">${esc(item.folio_interno || item.estado_procesal || "CAPTURA MANUAL")}</span>
      <h3>${esc(item.numero)}</h3>
      <p><strong>${esc(item.cliente || item.actor)}</strong></p>
      <p>${esc(item.actor)} vs. ${esc(item.demandado || item.contraparte)}</p>
      <p>${esc(item.juzgado)} · ${esc(item.distrito_judicial)} · ${esc(item.ciudad)}</p>
      <button data-edit="${item.id}">Editar</button>
    </div>`).join("") || '<div class="item">No se encontraron expedientes.</div>';
  $("#exp-limit").textContent = filtered.length > visible.length ? `Mostrando 40 de ${filtered.length}. Refine la búsqueda para localizar otro expediente.` : `${filtered.length} expediente(s) encontrado(s).`;
  document.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => editExp(Number(button.dataset.edit)));
}

async function loadExp() {
  expedientes = await api("/api/expedientes");
  renderExpedientes($("#exp-search").value);
  $("#gen-exp").innerHTML = '<option value="">Seleccione…</option>' + expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
  $("#agenda-exp").innerHTML = '<option value="">Sin vincular</option>' + expedientes.map(item => `<option value="${item.id}">${esc(item.numero)} — ${esc(item.cliente || item.actor)}</option>`).join("");
}

function editExp(id) {
  const item = expedientes.find(row => row.id === id);
  const form = $("#exp-form");
  setExpMode("manual");
  Object.keys(item).forEach(key => { if (form.elements[key]) form.elements[key].value = item[key] ?? ""; });
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#exp-search").oninput = event => renderExpedientes(event.target.value);
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

$("#gen-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  form.classList.add("loading");
  $("#resultado").textContent = "Analizando expediente y Tesauro…";
  try {
    const result = await api("/api/generaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    $("#resultado").textContent = result.resultado;
    toast(`Borrador generado con ${result.modelo}; ${result.fuentes.length} fuentes recuperadas`);
  } catch (error) { $("#resultado").textContent = "No fue posible generar el borrador."; toast(error.message, true); } finally { form.classList.remove("loading"); }
};

async function loadAudit() {
  const rows = await api("/api/auditoria");
  $("#audit-list").innerHTML = rows.map(item => `<div class="item"><span class="meta">${esc(item.created_at)}</span><h3>${esc(item.accion)} · ${esc(item.entidad)} #${esc(item.entidad_id)}</h3><p>${esc(item.detalle)}</p></div>`).join("") || '<div class="item">Sin movimientos.</div>';
}

try {
  const health = await api("/api/health");
  $("#health").textContent = health.aiConfigured ? "Motor OpenAI listo" : "Motor sin configurar";
  await Promise.all([loadExp(), loadTes(), loadClientes(), loadAgenda(), loadDashboard()]);
} catch (error) { toast(error.message, true); }
