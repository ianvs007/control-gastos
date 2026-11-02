// =============================================================================
// ARCHIVO: app.js - Lógica Interactiva del Frontend (Cliente / Navegador)
// =============================================================================
// Este archivo es el "cerebro" que se ejecuta dentro del navegador web (en el
// teléfono celular o en la computadora del estudiante o administrador).
// Sus funciones principales son:
// 1. Manejar el inicio de sesión y registro de estudiantes.
// 2. Controlar la navegación animada entre pestañas (Inicio, Ingresos, Gastos, Calendario, Reportes).
// 3. Alertar inmediatamente cuando el estudiante tenga SALDO INSUFICIENTE.
// 4. Gestionar el Panel de Metas de Ahorro Personal y el Historial de Todas las Metas.
// 5. Alternar entre Tema Claro y Tema Oscuro (con persistencia en el navegador).
// 6. Gestionar el Calendario Escolar interactivo para gastos exclusivos del colegio.
// 7. Generar e imprimir el Reporte Mensual Completo y dibujar gráficos animados con Chart.js.
// 8. Gestionar el Panel de Administración (estudiantes, seguridad y copias de seguridad).
// =============================================================================

// Variables globales para guardar las instancias activas de los gráficos de Chart.js
let categoryChartInstance = null;       // Gráfico de gastos por categoría
let budgetChartInstance = null;         // Gráfico de estado del presupuesto
let savingsChartInstance = null;        // Gráfico de meta de ahorro (30%)
let schoolCalendarChartInstance = null; // Gráfico animado de gastos del calendario escolar

// Estado global del estudiante conectado y su saldo disponible actual
let currentStudentUser = null;
let saldoGlobalDisponible = 0;
let totalIngresosGlobal = 0;
let pendingForceAction = null; // Guarda la operación pendiente si el usuario decide forzar con saldo insuficiente

// Estado del Calendario Escolar
const hoyISO = new Date().toISOString().split('T')[0];
let calendarState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0 = Enero ... 11 = Diciembre
    selectedDate: hoyISO,
    gastosMes: [],
    porTipo: [],
    totalMes: 0
};

const NOMBRES_MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// =============================================================================
// 1. INICIALIZACIÓN DEL SISTEMA AL CARGAR LA PÁGINA
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();            // 1. Aplica el Tema Claro u Oscuro preferido del usuario
    checkSession();         // 2. Pregunta al servidor si el usuario ya tenía su sesión abierta
    setupNavigation();      // 3. Activa los botones de navegación inferior con animación
    setupForms();           // 4. Conecta los formularios de ingresos, gastos, metas y calendario escolar
    setupLiveBalanceWarnings(); // 5. Conecta avisos en vivo de saldo insuficiente al escribir montos
    setupAdmin();           // 6. Prepara los botones y buscador del panel administrativo
    setupReportFilters();   // 7. Configura los botones de filtro por Día, Semana, Mes y Todo
    setDefaultDates();      // 8. Pone la fecha de hoy automáticamente en los formularios
});

// Función de protección contra ataques XSS
function escapeHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// Muestra una notificación flotante animada (Toast) en la parte superior
function showToast(mensaje, tipo = 'primary') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const iconos = {
        primary: 'fa-info-circle',
        success: 'fa-check-circle',
        danger: 'fa-exclamation-triangle',
        warning: 'fa-exclamation-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${tipo}`;
    toast.innerHTML = `
        <i class="fas ${iconos[tipo] || iconos.primary}"></i>
        <div style="flex:1;">${escapeHtml(mensaje)}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 260);
    }, 3800);
}

// =============================================================================
// 1.1 TEMA CLARO Y TEMA OSCURO (DARK / LIGHT MODE)
// =============================================================================
function initTheme() {
    const guardado = localStorage.getItem('finanzgagnon_theme') || 'light';
    applyTheme(guardado);
}

function toggleTheme() {
    const actual = document.documentElement.getAttribute('data-theme') || 'light';
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    localStorage.setItem('finanzgagnon_theme', nuevo);
    applyTheme(nuevo);
    showToast(nuevo === 'dark' ? '🌙 Tema oscuro activado' : '☀️ Tema claro activado', 'primary');
}

function applyTheme(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    const esOscuro = tema === 'dark';

    document.querySelectorAll('.theme-icon').forEach(ic => {
        ic.className = esOscuro ? 'fas fa-sun theme-icon' : 'fas fa-moon theme-icon';
    });
    document.querySelectorAll('.theme-label').forEach(lbl => {
        lbl.innerText = esOscuro ? 'Modo Claro' : 'Modo Oscuro';
    });

    // Actualiza colores de texto y bordes de los gráficos activos para que luzcan nítidos en ambos temas
    const textColor = esOscuro ? '#f1f5f9' : '#1e293b';
    const borderColor = esOscuro ? '#1e293b' : '#ffffff';

    [budgetChartInstance, savingsChartInstance, categoryChartInstance, schoolCalendarChartInstance].forEach(chart => {
        if (!chart) return;
        if (chart.options?.plugins?.legend?.labels) {
            chart.options.plugins.legend.labels.color = textColor;
        }
        if (chart.options?.scales) {
            if (chart.options.scales.x?.ticks) chart.options.scales.x.ticks.color = textColor;
            if (chart.options.scales.y?.ticks) chart.options.scales.y.ticks.color = textColor;
        }
        chart.data?.datasets?.forEach(ds => {
            if (ds.borderWidth) ds.borderColor = borderColor;
        });
        chart.update();
    });
}

function getChartThemeColors() {
    const esOscuro = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        textColor: esOscuro ? '#f1f5f9' : '#1e293b',
        gridColor: esOscuro ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.25)',
        borderColor: esOscuro ? '#1e293b' : '#ffffff'
    };
}

// =============================================================================
// 2. CONTROL DE ACCESO Y SESIÓN DE USUARIOS
// =============================================================================
async function checkSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();

        if (data.autenticado) {
            enterAs(data.usuario);
        } else {
            showLogin();
        }
    } catch {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'replace' });
}

function enterAs(usuario) {
    if (usuario.rol === 'admin') showAdmin(usuario);
    else showApp(usuario);
}

function showAuthForm(tipo, { historial = 'push' } = {}) {
    const esRegistro = tipo === 'registro';
    document.getElementById('form-login').style.display = esRegistro ? 'none' : 'block';
    document.getElementById('form-registro').style.display = esRegistro ? 'block' : 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('registro-error').style.display = 'none';
    setUrl(esRegistro ? '/registro' : '/login', historial);
}

// =============================================================================
// 2.1 DIRECCIONES URL Y NAVEGACIÓN ANIMADA (SPA)
// =============================================================================
const RUTAS = {
    '/inicio': 'tab-inicio',
    '/ingresos': 'tab-ingresos',
    '/gastos': 'tab-gastos',
    '/calendario': 'tab-calendario',
    '/reportes': 'tab-reportes',
    '/admin/estudiantes': 'tab-admin-estudiantes',
    '/admin/seguridad': 'tab-admin-seguridad',
    '/admin/backup': 'tab-admin-backup',
    '/admin/password': 'tab-admin-password'
};
const RUTA_DE_TAB = Object.fromEntries(Object.entries(RUTAS).map(([ruta, tab]) => [tab, ruta]));

function setUrl(ruta, historial) {
    if (historial === 'none' || !ruta || location.pathname === ruta) return;
    if (historial === 'replace') history.replaceState(null, '', ruta);
    else history.pushState(null, '', ruta);
}

function tabInicial(screenId, tabPorDefecto) {
    const tab = RUTAS[location.pathname];
    return tab && document.getElementById(screenId).contains(document.getElementById(tab)) ? tab : tabPorDefecto;
}

// Activa una pestaña con animación fluida y carga sus datos actualizados
function activateTab(tabId, { historial = 'push' } = {}) {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    const screen = tab.closest('.view');

    // Marca el botón activo en la barra inferior
    screen.querySelectorAll('.bottom-nav .nav-item').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-tab') === tabId));

    // Oculta todas las pestañas y activa con animación la seleccionada
    screen.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active-tab'));
    // Forzamos reflow para que la animación de cambio de menú se reproduzca siempre
    void tab.offsetWidth;
    tab.classList.add('active-tab');

    setUrl(RUTA_DE_TAB[tabId], historial);
    TAB_LOADERS[tabId]?.();
}

window.addEventListener('popstate', () => {
    const tabId = RUTAS[location.pathname];
    const loginVisible = document.getElementById('login-screen').style.display !== 'none';

    if (loginVisible) {
        showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'none' });
    } else if (tabId && document.getElementById(tabId)?.closest('.view').style.display !== 'none') {
        activateTab(tabId, { historial: 'none' });
    }
});

// Abre la pantalla principal del estudiante
function showApp(estudiante) {
    currentStudentUser = estudiante;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    // Muestra el nombre del estudiante y su curso
    document.getElementById('user-display').innerText = estudiante.nombre.split(' ')[0];
    document.getElementById('welcome-msg').innerText = `¡Hola, ${estudiante.nombre}!`;
    document.getElementById('course-msg').innerText = `Curso: ${estudiante.curso || 'Estudiante'}`;

    const tab = tabInicial('app-screen', 'tab-inicio');
    activateTab(tab, { historial: 'replace' });
    if (tab !== 'tab-inicio') loadDashboard();
    loadCategoriasSelect();
}

// Procesa el formulario de Inicio de Sesión
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();

    const usuario = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value.trim();
    const errorBox = document.getElementById('login-error');

    errorBox.style.display = 'none';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });
        const data = await res.json();

        if (res.ok) {
            document.getElementById('form-login').reset();
            enterAs(data.usuario);
        } else {
            errorBox.innerText = data.error || 'Credenciales inválidas';
            errorBox.style.display = 'block';
        }
    } catch {
        errorBox.innerText = 'Error de conexión con el servidor';
        errorBox.style.display = 'block';
    }
});

// Procesa el formulario de Registro de Estudiante
document.getElementById('form-registro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('registro-error');
    errorBox.style.display = 'none';

    const password = document.getElementById('reg-pass').value;
    if (password !== document.getElementById('reg-pass2').value) {
        errorBox.innerText = 'Las contraseñas no coinciden';
        errorBox.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/registro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre_completo: document.getElementById('reg-nombre').value.trim(),
                curso: document.getElementById('reg-curso').value.trim(),
                usuario: document.getElementById('reg-user').value.trim(),
                password
            })
        });
        const data = await res.json();

        if (res.ok) {
            document.getElementById('form-registro').reset();
            showAuthForm('login');
            enterAs(data.usuario);
        } else {
            errorBox.innerText = data.error || 'No se pudo crear la cuenta';
            errorBox.style.display = 'block';
        }
    } catch {
        errorBox.innerText = 'Error de conexión con el servidor';
        errorBox.style.display = 'block';
    }
});

// Botones para cerrar sesión
['btn-logout', 'btn-admin-logout'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.reload();
    });
});

// =============================================================================
// 3. NAVEGACIÓN INFERIOR (MENÚ CON ANIMACIÓN)
// =============================================================================
const TAB_LOADERS = {
    'tab-inicio': () => { loadDashboard(); loadMetas(); },
    'tab-ingresos': () => loadIngresos(),
    'tab-gastos': () => loadGastos(),
    'tab-calendario': () => loadCalendarioEscolar(),
    'tab-reportes': () => loadReportes(),
    'tab-admin-estudiantes': () => loadAdminEstudiantes(),
    'tab-admin-seguridad': () => loadSeguridad(),
    'tab-admin-backup': () => loadSeguridad(),
    'tab-admin-password': () => loadSeguridad()
};

function setupNavigation() {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });
}

// =============================================================================
// 4. VENTANAS FLOTANTES (MODALES) Y FECHAS POR DEFECTO
// =============================================================================
function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    // Limpia advertencias previas al abrir
    el.querySelectorAll('.alert-error').forEach(w => { w.style.display = 'none'; });
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    ['ingreso-fecha', 'gasto-fecha', 'escolar-fecha'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });
}

// =============================================================================
// 5. SISTEMA DE ALERTA DE SALDO INSUFICIENTE Y PANEL DEL ESTUDIANTE
// =============================================================================
async function loadDashboard() {
    try {
        const res = await fetch('/api/resumen');
        const data = await res.json();

        saldoGlobalDisponible = Number(data.saldoDisponible || 0);
        totalIngresosGlobal = Number(data.totalIngresos || 0);

        document.getElementById('dash-ingresos').innerText = `Bs. ${data.totalIngresos.toFixed(2)}`;
        document.getElementById('dash-gastos').innerText = `Bs. ${data.totalGastos.toFixed(2)}`;
        document.getElementById('dash-saldo').innerText = `Bs. ${data.saldoDisponible.toFixed(2)}`;

        const subEscolar = document.getElementById('dash-gastos-escolares-sub');
        if (subEscolar) {
            subEscolar.innerText = `Colegio: Bs. ${(data.totalGastosEscolares || 0).toFixed(2)}`;
        }

        const dashMetasAhorro = document.getElementById('dash-metas-ahorro');
        if (dashMetasAhorro) {
            dashMetasAhorro.innerText = `Bs. ${(data.totalAhorradoMetas || 0).toFixed(2)}`;
        }
        const dashMetasCount = document.getElementById('dash-metas-count');
        if (dashMetasCount) {
            const cant = data.cantidadMetasActivas || 0;
            dashMetasCount.innerText = `${cant} meta${cant === 1 ? '' : 's'} activa${cant === 1 ? '' : 's'}`;
        }

        actualizarEstadoVisualSaldo(data.saldoDisponible, data.totalIngresos, data.totalGastos);
    } catch (e) {
        console.error("Error al cargar balances:", e);
    }
}

// Evalúa si el estudiante tiene saldo insuficiente o por agotarse y muestra el banner/alerta
function actualizarEstadoVisualSaldo(saldo, totalIngresos, totalGastos) {
    const banner = document.getElementById('alerta-saldo-banner');
    const titulo = document.getElementById('alerta-saldo-titulo');
    const desc = document.getElementById('alerta-saldo-desc');
    const cardSaldo = document.getElementById('card-saldo-box');
    const estadoSub = document.getElementById('dash-saldo-estado');

    if (!banner || !cardSaldo) return;

    if (saldo < 0) {
        banner.style.display = 'flex';
        banner.className = 'insufficient-balance-banner';
        titulo.innerText = '⚠️ ¡Alerta de Saldo Insuficiente (En Negativo)!';
        desc.innerText = `Tus gastos superaron tus ingresos por Bs. ${Math.abs(saldo).toFixed(2)}. Registra un nuevo ingreso o reduce tus gastos.`;
        cardSaldo.classList.add('balance-insuficiente');
        if (estadoSub) estadoSub.innerText = '⚠️ Saldo insuficiente (negativo)';
    } else if (saldo === 0 && (totalIngresos > 0 || totalGastos > 0)) {
        banner.style.display = 'flex';
        banner.className = 'insufficient-balance-banner';
        titulo.innerText = '⚠️ ¡Te quedaste sin Saldo Disponible (Bs. 0.00)!';
        desc.innerText = 'Has agotado todo tu saldo disponible. Necesitas registrar un ingreso antes de realizar más gastos.';
        cardSaldo.classList.add('balance-insuficiente');
        if (estadoSub) estadoSub.innerText = '⚠️ Sin saldo disponible';
    } else if (saldo > 0 && saldo <= 20 && totalIngresos > 0) {
        banner.style.display = 'flex';
        banner.className = 'insufficient-balance-banner low-balance-warning';
        titulo.innerText = '⚠️ ¡Atención! Tu saldo está por agotarse';
        desc.innerText = `Solo te quedan Bs. ${saldo.toFixed(2)} disponibles. Administra con cuidado tus próximos gastos.`;
        cardSaldo.classList.remove('balance-insuficiente');
        if (estadoSub) estadoSub.innerText = '⚡ Saldo bajo';
    } else {
        banner.style.display = 'none';
        cardSaldo.classList.remove('balance-insuficiente');
        if (estadoSub) estadoSub.innerText = saldo > 0 ? '✓ Saldo saludable' : 'Registra tu primer ingreso';
    }
}

// Muestra el Modal interactivo de Alerta de Saldo Insuficiente cuando un gasto o abono supera el saldo
function mostrarModalSaldoInsuficiente({ mensaje, saldoDisponible, montoSolicitado, faltante, onForzar }) {
    const disp = Number(saldoDisponible ?? saldoGlobalDisponible);
    const solic = Number(montoSolicitado || 0);
    const falt = Number(faltante ?? (solic - Math.max(disp, 0)));

    document.getElementById('modal-alerta-saldo-msg').innerText =
        mensaje || `No cuentas con saldo suficiente para realizar este registro de Bs. ${solic.toFixed(2)}.`;
    document.getElementById('alerta-val-disponible').innerText = `Bs. ${disp.toFixed(2)}`;
    document.getElementById('alerta-val-solicitado').innerText = `Bs. ${solic.toFixed(2)}`;
    document.getElementById('alerta-val-faltante').innerText = `Bs. ${Math.max(falt, 0).toFixed(2)}`;

    pendingForceAction = onForzar || null;
    const btnForzar = document.getElementById('btn-forzar-saldo-negativo');
    if (btnForzar) {
        btnForzar.style.display = onForzar ? 'inline-flex' : 'none';
        btnForzar.onclick = async () => {
            closeModal('modal-alerta-saldo');
            if (typeof pendingForceAction === 'function') {
                await pendingForceAction();
                pendingForceAction = null;
            }
        };
    }

    showToast('⚠️ ¡Alerta! Saldo insuficiente para esta operación', 'danger');
    openModal('modal-alerta-saldo');
}

// Conecta advertencias en tiempo real dentro de los formularios cuando el monto escrito supera el saldo
function setupLiveBalanceWarnings() {
    const pares = [
        { input: 'gasto-monto', warn: 'gasto-inline-warning', label: 'Este gasto' },
        { input: 'escolar-monto', warn: 'escolar-inline-warning', label: 'Este gasto escolar' },
        { input: 'meta-ahorrado-inicial', warn: 'meta-inline-warning', label: 'Este monto inicial' },
        { input: 'abonar-meta-monto', warn: 'abonar-inline-warning', label: 'Este abono' }
    ];

    pares.forEach(({ input, warn, label }) => {
        const elInput = document.getElementById(input);
        const elWarn = document.getElementById(warn);
        if (!elInput || !elWarn) return;

        elInput.addEventListener('input', () => {
            const val = parseFloat(elInput.value);
            if (!isNaN(val) && val > 0 && val > saldoGlobalDisponible) {
                const faltante = val - Math.max(saldoGlobalDisponible, 0);
                elWarn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <strong>¡Saldo insuficiente!</strong> ${label} (Bs. ${val.toFixed(2)}) supera tu saldo disponible actual (Bs. ${saldoGlobalDisponible.toFixed(2)}). Te faltan Bs. ${faltante.toFixed(2)}.`;
                elWarn.style.display = 'block';
            } else {
                elWarn.style.display = 'none';
            }
        });
    });
}

// =============================================================================
// 5.1 MÓDULO DE METAS DE AHORRO PERSONAL Y PANEL DE TODAS LAS METAS (HISTORIAL)
// =============================================================================
const ICONOS_META = {
    'Tecnología': 'fa-headphones-alt',
    'Ropa y Calzado': 'fa-tshirt',
    'Deporte': 'fa-futbol',
    'Estudios': 'fa-graduation-cap',
    'Videojuegos y Ocio': 'fa-gamepad',
    'Regalo': 'fa-gift',
    'Personal': 'fa-star'
};

let metasCache = { activas: [], historial: [] };

async function loadMetas() {
    const contActivas = document.getElementById('list-metas-activas');
    const contHistorial = document.getElementById('list-metas-historial');
    if (!contActivas || !contHistorial) return;

    try {
        const res = await fetch('/api/metas');
        const data = await res.json();
        metasCache = data;

        const badge = document.getElementById('badge-resumen-metas');
        if (badge && data.resumen) {
            badge.innerText = `${data.resumen.metasCompletadas} de ${data.resumen.totalMetas} completadas`;
        }

        // 1. Renderizar Metas Activas en el Panel del Estudiante
        if (!data.activas || data.activas.length === 0) {
            contActivas.innerHTML = `
                <div style="text-align:center; padding:18px; color:var(--text-secondary); border:1px dashed var(--border); border-radius:10px;">
                    <i class="fas fa-piggy-bank" style="font-size:26px; color:var(--primary); margin-bottom:6px; display:block;"></i>
                    <p style="font-size:13.5px;">No tienes metas de ahorro activas en este momento.</p>
                    <small>¡Haz clic en <strong>"Nueva Meta"</strong> para poner lo que quieres comprarte y empezar a ahorrar!</small>
                </div>
            `;
        } else {
            contActivas.innerHTML = data.activas.map(m => {
                const objetivo = parseFloat(m.monto_objetivo);
                const ahorrado = parseFloat(m.monto_ahorrado);
                const pct = objetivo > 0 ? Math.min((ahorrado / objetivo) * 100, 100) : 0;
                const faltante = Math.max(objetivo - ahorrado, 0);
                const completada = m.estado === 'completada' || ahorrado >= objetivo;
                const icono = ICONOS_META[m.categoria] || 'fa-bullseye';

                return `
                    <div class="meta-card ${completada ? 'meta-completada' : ''}">
                        <div class="meta-card-top">
                            <div class="meta-title-group">
                                <strong><i class="fas ${icono}"></i> ${escapeHtml(m.titulo)}</strong>
                                <span class="meta-cat-badge">${escapeHtml(m.categoria || 'Personal')}</span>
                            </div>
                            <span class="meta-status-pill ${completada ? 'completada' : 'progreso'}">
                                ${completada ? '🎉 ¡Completada!' : `${pct.toFixed(0)}% ahorrado`}
                            </span>
                        </div>

                        <div class="meta-amounts-row">
                            <span>Puesto: <strong>Bs. ${ahorrado.toFixed(2)}</strong> de <strong>Bs. ${objetivo.toFixed(2)}</strong></span>
                            <span>${completada ? '¡Listo para comprar!' : `Faltan: Bs. ${faltante.toFixed(2)}`}</span>
                        </div>

                        <div class="meta-progress-track">
                            <div class="meta-progress-fill" style="width: ${pct.toFixed(1)}%;"></div>
                        </div>

                        <div class="meta-actions-row">
                            ${!completada ? `
                                <button type="button" class="btn btn-secondary btn-sm" onclick="openAbonarMetaModal(${m.id})">
                                    <i class="fas fa-plus-circle"></i> Poner dinero
                                </button>
                                <button type="button" class="btn btn-primary btn-sm" onclick="completarMeta(${m.id})" title="Marcar como completada">
                                    <i class="fas fa-check"></i> Completar
                                </button>
                            ` : ''}
                            <button type="button" class="btn ${completada ? 'btn-danger' : 'btn-outline-danger'} btn-sm" onclick="borrarMetaDelPanel(${m.id}, ${completada})">
                                <i class="fas fa-trash-alt"></i> ${completada ? 'Borrar meta completada' : 'Quitar del panel'}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 2. Renderizar el Panel de Todas las Metas que tuvo el Estudiante (Historial para el Reporte Mensual)
        if (!data.historial || data.historial.length === 0) {
            contHistorial.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:14px;">Aún no has registrado ninguna meta de ahorro.</p>';
        } else {
            contHistorial.innerHTML = data.historial.map(m => {
                const objetivo = parseFloat(m.monto_objetivo);
                const ahorrado = parseFloat(m.monto_ahorrado);
                const pct = objetivo > 0 ? Math.min((ahorrado / objetivo) * 100, 100) : 0;
                const completada = m.estado === 'completada' || ahorrado >= objetivo;
                const fechaStr = m.fecha_creacion ? new Date(m.fecha_creacion).toLocaleDateString() : '—';
                const retiradaPanel = Number(m.visible_panel) === 0;

                return `
                    <div class="item-card">
                        <div class="item-info">
                            <strong>
                                <i class="fas ${ICONOS_META[m.categoria] || 'fa-bullseye'}" style="color:var(--primary);"></i>
                                ${escapeHtml(m.titulo)}
                            </strong>
                            <span>
                                ${escapeHtml(m.categoria || 'Personal')} · Creada: ${fechaStr}
                                ${retiradaPanel ? ' · <em>(Retirada de activas)</em>' : ''}
                            </span>
                            <span>Ahorrado: <strong>Bs. ${ahorrado.toFixed(2)}</strong> / Meta: <strong>Bs. ${objetivo.toFixed(2)}</strong> (${pct.toFixed(0)}%)</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="meta-status-pill ${completada ? 'completada' : 'progreso'}">
                                ${completada ? '✓ Completada' : 'En progreso'}
                            </span>
                            <button class="btn-del" title="Eliminar definitivamente del historial" onclick="eliminarMetaDefinitivo(${m.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.error("Error al cargar metas de ahorro:", e);
    }
}

// Abre el modal para poner más dinero en una meta específica
function openAbonarMetaModal(metaId) {
    const meta = metasCache.activas.find(m => m.id === metaId) || metasCache.historial.find(m => m.id === metaId);
    if (!meta) return;

    document.getElementById('form-abonar-meta').reset();
    document.getElementById('abonar-meta-id').value = meta.id;
    document.getElementById('abonar-meta-nombre').innerText = `🎯 ${meta.titulo}`;
    const faltante = Math.max(parseFloat(meta.monto_objetivo) - parseFloat(meta.monto_ahorrado), 0);
    document.getElementById('abonar-meta-progreso-txt').innerText =
        `Ahorrado: Bs. ${parseFloat(meta.monto_ahorrado).toFixed(2)} / Meta: Bs. ${parseFloat(meta.monto_objetivo).toFixed(2)} (Faltan Bs. ${faltante.toFixed(2)})`;

    openModal('modal-abonar-meta');
}

// Marca una meta como completada
async function completarMeta(id) {
    const res = await fetch(`/api/metas/${id}/completar`, { method: 'PUT' });
    if (res.ok) {
        showToast('🎉 ¡Felicidades! Meta marcada como completada. Ya puedes borrarla del panel cuando quieras.', 'success');
        loadMetas();
        loadDashboard();
    }
}

// Borra la meta del panel de metas activas (conservándola en el historial para el reporte mensual)
async function borrarMetaDelPanel(id, esCompletada) {
    const msg = esCompletada
        ? '¿Deseas borrar esta meta completada de tu panel activo?\n\nQuedará guardada en tu panel de "Todas las Metas" para tu Reporte Mensual.'
        : '¿Deseas retirar esta meta de tu panel de metas activas?';
    if (!confirm(msg)) return;

    const res = await fetch(`/api/metas/${id}`, { method: 'DELETE' });
    if (res.ok) {
        showToast('Meta borrada del panel activo (guardada en el historial para tu reporte mensual)', 'success');
        loadMetas();
        loadDashboard();
    }
}

// Elimina definitivamente una meta del historial
async function eliminarMetaDefinitivo(id) {
    if (!confirm('¿Eliminar definitivamente esta meta incluso del historial y del reporte mensual?')) return;
    const res = await fetch(`/api/metas/${id}?definitivo=1`, { method: 'DELETE' });
    if (res.ok) {
        showToast('Meta eliminada definitivamente', 'primary');
        loadMetas();
        loadDashboard();
    }
}

// =============================================================================
// 5.2 CONFIGURACIÓN DE DIAGNÓSTICO (PRESUPUESTO Y AHORRO) PARA REPORTES
// =============================================================================
const META_AHORRO_PCT = 30;

const ESTADOS_PRESUPUESTO = {
    verde: {
        titulo: '🟢 ¡Vas muy bien!',
        mensaje: '¡Excelente! Estás administrando bien tu dinero. Sigue así y podrás ahorrar para cumplir tus metas.'
    },
    amarillo: {
        titulo: '🟡 ¡Presta atención!',
        mensaje: '¡Cuidado! Ya gastaste gran parte de tu presupuesto. Reduce tus gastos y trata de guardar dinero para tus ahorros.'
    },
    rojo: {
        titulo: '🔴 ¡Superaste tu límite!',
        mensaje: '¡Atención! Tus gastos superaron tu presupuesto. Revisa tus gastos y organiza mejor tu dinero para el próximo mes.'
    }
};

const ESTADOS_AHORRO = {
    verde: {
        titulo: '💰 ¡Meta cumplida o vas por buen camino!',
        mensaje: '¡Felicidades! Estás cumpliendo tu meta de ahorro. Sigue con ese buen hábito.'
    },
    amarillo: {
        titulo: '🟡 ¡Puedes mejorar!',
        mensaje: 'Aún puedes ahorrar un poco más. Intenta reducir algunos gastos para acercarte a tu meta.'
    },
    rojo: {
        titulo: '🔴 ¡Debes prestar atención a tu ahorro!',
        mensaje: 'Todavía no alcanzaste tu meta de ahorro. No te desanimes, organiza tus gastos y comienza con pequeñas cantidades.'
    }
};

function setStatusStrip(id, color, titulo, mensaje) {
    const strip = document.getElementById(id);
    if (!strip) return;
    strip.className = `status-strip status-${color}`;
    const t = strip.querySelector('.status-title');
    const m = strip.querySelector('.status-msg');
    if (t) t.innerText = titulo;
    if (m) m.innerText = mensaje;
}

function setReportStatusCard(id, color, titulo, mensaje) {
    const strip = document.getElementById(id);
    if (!strip) return;
    strip.className = `status-strip status-${color} report-status-card`;
    const t = strip.querySelector('.status-title');
    const m = strip.querySelector('.status-msg');
    if (t) t.innerText = titulo;
    if (m) m.innerText = mensaje;
}

// =============================================================================
// 6. MÓDULO DE INGRESOS (DINERO RECIBIDO)
// =============================================================================
async function loadIngresos() {
    const cont = document.getElementById('list-ingresos');
    cont.innerHTML = '<p>Cargando ingresos...</p>';

    const res = await fetch('/api/ingresos');
    const data = await res.json();

    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes ingresos registrados aún.</p>';
        return;
    }

    cont.innerHTML = data.map(i => `
        <div class="item-card">
            <div class="item-info">
                <strong>${escapeHtml(i.fuente)}</strong>
                <span>${new Date(i.fecha).toLocaleDateString()} - ${escapeHtml(i.descripcion || 'Sin detalle')}</span>
            </div>
            <div style="display:flex; align-items:center;">
                <span class="item-amount inc">+ Bs. ${parseFloat(i.monto).toFixed(2)}</span>
                <button class="btn-del" title="Eliminar" onclick="deleteIngreso(${i.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function deleteIngreso(id) {
    if (!confirm('¿Deseas eliminar este ingreso?')) return;
    await fetch(`/api/ingresos/${id}`, { method: 'DELETE' });
    showToast('Ingreso eliminado', 'primary');
    loadIngresos();
    loadDashboard();
}

// =============================================================================
// 7. MÓDULO DE GASTOS GENERALES
// =============================================================================
async function loadGastos() {
    const cont = document.getElementById('list-gastos');
    cont.innerHTML = '<p>Cargando gastos...</p>';

    const res = await fetch('/api/gastos');
    const data = await res.json();

    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes gastos registrados.</p>';
        return;
    }

    cont.innerHTML = data.map(g => `
        <div class="item-card">
            <div class="item-info">
                <strong>${escapeHtml(g.categoria)}</strong>
                <span>${new Date(g.fecha).toLocaleDateString()} - ${escapeHtml(g.descripcion || 'Sin detalle')}</span>
            </div>
            <div style="display:flex; align-items:center;">
                <span class="item-amount exp">- Bs. ${parseFloat(g.monto).toFixed(2)}</span>
                <button class="btn-del" title="Eliminar" onclick="deleteGasto(${g.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function deleteGasto(id) {
    if (!confirm('¿Deseas eliminar este gasto?')) return;
    await fetch(`/api/gastos/${id}`, { method: 'DELETE' });
    showToast('Gasto eliminado', 'primary');
    loadGastos();
    loadDashboard();
}

async function loadCategoriasSelect() {
    const select = document.getElementById('gasto-categoria');
    if (!select) return;
    const res = await fetch('/api/categorias');
    const data = await res.json();
    select.innerHTML = data.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
}

// =============================================================================
// 7.1 MÓDULO DE CALENDARIO ESCOLAR (GASTOS EXCLUSIVOS EN EL COLEGIO)
// =============================================================================
function getMesCalendarioActualStr() {
    const pad = n => String(n).padStart(2, '0');
    return `${calendarState.year}-${pad(calendarState.month + 1)}`;
}

function cambiarMesCalendario(delta) {
    calendarState.month += delta;
    if (calendarState.month < 0) {
        calendarState.month = 11;
        calendarState.year -= 1;
    } else if (calendarState.month > 11) {
        calendarState.month = 0;
        calendarState.year += 1;
    }
    const pad = n => String(n).padStart(2, '0');
    calendarState.selectedDate = `${calendarState.year}-${pad(calendarState.month + 1)}-01`;
    loadCalendarioEscolar();
}

function irAHoyCalendario() {
    const ahora = new Date();
    calendarState.year = ahora.getFullYear();
    calendarState.month = ahora.getMonth();
    calendarState.selectedDate = ahora.toISOString().split('T')[0];
    loadCalendarioEscolar();
}

function openGastoEscolarModal(fechaPreseleccionada) {
    const inputFecha = document.getElementById('escolar-fecha');
    if (inputFecha) {
        inputFecha.value = fechaPreseleccionada || calendarState.selectedDate || new Date().toISOString().split('T')[0];
    }
    openModal('modal-gasto-escolar');
}

async function loadCalendarioEscolar() {
    const mesStr = getMesCalendarioActualStr();
    const labelMes = document.getElementById('calendar-month-label');
    if (labelMes) {
        labelMes.innerText = `${NOMBRES_MESES[calendarState.month]} ${calendarState.year}`;
    }

    try {
        const res = await fetch(`/api/calendario-escolar?mes=${mesStr}`);
        const data = await res.json();

        calendarState.gastosMes = data.gastos || [];
        calendarState.porTipo = data.porTipo || [];
        calendarState.totalMes = Number(data.totalMes || 0);

        document.getElementById('cal-total-mes').innerText = `Bs. ${calendarState.totalMes.toFixed(2)}`;
        const cant = calendarState.gastosMes.length;
        document.getElementById('cal-count-mes').innerText = `${cant} registro${cant === 1 ? '' : 's'}`;

        renderCalendarGrid();
        renderGastosEscolaresDia(calendarState.selectedDate);
        renderGastosEscolaresMes();
        renderSchoolCalendarChart(calendarState.porTipo);
    } catch (e) {
        console.error("Error al cargar el calendario escolar:", e);
    }
}

function normalizarFechaISO(fechaRaw) {
    if (!fechaRaw) return '';
    return String(fechaRaw).split('T')[0];
}

function renderCalendarGrid() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const year = calendarState.year;
    const month = calendarState.month;

    // Primer día del mes (0=Dom, 1=Lun ... 6=Sáb) -> convertimos para que Lunes sea 0
    const firstDayJS = new Date(year, month, 1).getDay();
    const startOffset = (firstDayJS === 0 ? 6 : firstDayJS - 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Agrupamos el monto gastado en el colegio por cada fecha 'YYYY-MM-DD'
    const gastosPorDia = {};
    calendarState.gastosMes.forEach(g => {
        const f = normalizarFechaISO(g.fecha);
        gastosPorDia[f] = (gastosPorDia[f] || 0) + parseFloat(g.monto);
    });

    const pad = n => String(n).padStart(2, '0');
    const celdas = [];

    for (let i = 0; i < startOffset; i++) {
        celdas.push('<div class="cal-day-cell empty-cell"></div>');
    }

    for (let dia = 1; dia <= daysInMonth; dia++) {
        const fechaISO = `${year}-${pad(month + 1)}-${pad(dia)}`;
        const totalDia = gastosPorDia[fechaISO] || 0;
        const esHoy = fechaISO === hoyISO;
        const esSeleccionado = fechaISO === calendarState.selectedDate;

        celdas.push(`
            <div class="cal-day-cell ${esHoy ? 'is-today' : ''} ${esSeleccionado ? 'is-selected' : ''}"
                 onclick="seleccionarDiaCalendario('${fechaISO}')">
                <span class="cal-day-num">${dia}</span>
                ${totalDia > 0 ? `<span class="cal-day-badge">Bs.${totalDia.toFixed(0)}</span>` : '<span></span>'}
            </div>
        `);
    }

    grid.innerHTML = celdas.join('');
}

function seleccionarDiaCalendario(fechaISO) {
    calendarState.selectedDate = fechaISO;
    renderCalendarGrid();
    renderGastosEscolaresDia(fechaISO);
}

function renderGastosEscolaresDia(fechaISO) {
    const partes = (fechaISO || hoyISO).split('-');
    const fechaLegible = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : fechaISO;

    const lblSel = document.getElementById('cal-selected-label');
    if (lblSel) lblSel.innerText = fechaLegible;

    const titleEl = document.getElementById('cal-day-detail-title');
    if (titleEl) {
        titleEl.innerHTML = `<i class="fas fa-clipboard-list"></i> Gastos en el Colegio del ${fechaLegible}`;
    }

    const cont = document.getElementById('list-gastos-escolares-dia');
    if (!cont) return;

    const delDia = calendarState.gastosMes.filter(g => normalizarFechaISO(g.fecha) === fechaISO);

    if (delDia.length === 0) {
        cont.innerHTML = `
            <p style="text-align:center; color:var(--text-secondary); padding:14px; font-size:13px;">
                No hay gastos escolares anotados el <strong>${fechaLegible}</strong>.
            </p>
        `;
        return;
    }

    cont.innerHTML = delDia.map(g => `
        <div class="item-card">
            <div class="item-info">
                <strong><i class="fas fa-school" style="color:var(--accent);"></i> ${escapeHtml(g.tipo)}</strong>
                <span>${escapeHtml(g.descripcion || 'Gasto en el colegio')}</span>
            </div>
            <div style="display:flex; align-items:center;">
                <span class="item-amount exp">- Bs. ${parseFloat(g.monto).toFixed(2)}</span>
                <button class="btn-del" title="Eliminar gasto escolar" onclick="deleteGastoEscolar(${g.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function renderGastosEscolaresMes() {
    const cont = document.getElementById('list-gastos-escolares-mes');
    if (!cont) return;

    if (calendarState.gastosMes.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:14px;">No hay gastos del colegio registrados en este mes.</p>';
        return;
    }

    cont.innerHTML = calendarState.gastosMes.map(g => {
        const f = normalizarFechaISO(g.fecha).split('-');
        const fStr = f.length === 3 ? `${f[2]}/${f[1]}/${f[0]}` : g.fecha;
        return `
            <div class="item-card">
                <div class="item-info">
                    <strong>${escapeHtml(g.tipo)}</strong>
                    <span>📅 ${fStr} — ${escapeHtml(g.descripcion || 'Sin detalle')}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <span class="item-amount exp">- Bs. ${parseFloat(g.monto).toFixed(2)}</span>
                    <button class="btn-del" title="Eliminar" onclick="deleteGastoEscolar(${g.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteGastoEscolar(id) {
    if (!confirm('¿Deseas eliminar este gasto del calendario escolar?')) return;
    await fetch(`/api/calendario-escolar/${id}`, { method: 'DELETE' });
    showToast('Gasto escolar eliminado', 'primary');
    loadCalendarioEscolar();
    loadDashboard();
}

// Gráfico animado del Calendario Escolar (Distribución de gastos del colegio por tipo)
function renderSchoolCalendarChart(porTipo) {
    if (schoolCalendarChartInstance) {
        schoolCalendarChartInstance.destroy();
        schoolCalendarChartInstance = null;
    }

    const ctx = document.getElementById('schoolCalendarChart')?.getContext('2d');
    if (!ctx) return;

    const { textColor, gridColor } = getChartThemeColors();
    const hayDatos = porTipo && porTipo.length > 0;
    const labels = hayDatos ? porTipo.map(item => item.tipo) : ['Sin gastos escolares este mes'];
    const valores = hayDatos ? porTipo.map(item => parseFloat(item.total)) : [0];
    const colores = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'];

    schoolCalendarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Gasto Escolar (Bs.)',
                data: valores,
                backgroundColor: hayDatos ? colores.slice(0, valores.length) : ['#cbd5e1'],
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1100,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: textColor, font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: textColor, font: { size: 11 } },
                    grid: { color: gridColor }
                }
            }
        }
    });
}

// =============================================================================
// 8. MÓDULO DE REPORTES, GRÁFICOS ANIMADOS Y REPORTE MENSUAL IMPRIMIBLE
// =============================================================================
let reportFilter = {
    periodo: 'mes',
    fecha: new Date().toISOString().split('T')[0],
    mes: new Date().toISOString().substring(0, 7)
};

function getWeekRange(dateStr) {
    const parts = (dateStr || new Date().toISOString().split('T')[0]).split('-');
    const base = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = base.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = n => String(n).padStart(2, '0');
    const formatYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const formatDMY = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    return {
        inicio: formatYMD(monday),
        fin: formatYMD(sunday),
        texto: `${formatDMY(monday)} al ${formatDMY(sunday)}`
    };
}

function setupReportFilters() {
    const fechaInput = document.getElementById('report-filter-fecha');
    const semanaInput = document.getElementById('report-filter-semana-fecha');
    const mesInput = document.getElementById('report-filter-mes');

    if (fechaInput) fechaInput.value = reportFilter.fecha;
    if (semanaInput) semanaInput.value = reportFilter.fecha;
    if (mesInput) mesInput.value = reportFilter.mes;

    updateSemanaTexto();

    fechaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            loadReportes();
        }
    });

    semanaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            updateSemanaTexto();
            loadReportes();
        }
    });

    mesInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.mes = e.target.value;
            loadReportes();
        }
    });

    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const periodo = btn.getAttribute('data-period');
            setReportPeriodo(periodo);
        });
    });
}

function updateSemanaTexto() {
    const range = getWeekRange(reportFilter.fecha);
    const textoEl = document.getElementById('semana-rango-texto');
    if (textoEl) {
        textoEl.innerText = range.texto;
    }
}

function setReportPeriodo(periodo) {
    reportFilter.periodo = periodo;

    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-period') === periodo);
    });

    const controlDia = document.getElementById('filter-control-dia');
    const controlSemana = document.getElementById('filter-control-semana');
    const controlMes = document.getElementById('filter-control-mes');
    const controlTodo = document.getElementById('filter-control-todo');

    if (controlDia) controlDia.style.display = periodo === 'dia' ? 'flex' : 'none';
    if (controlSemana) controlSemana.style.display = periodo === 'semana' ? 'flex' : 'none';
    if (controlMes) controlMes.style.display = periodo === 'mes' ? 'flex' : 'none';
    if (controlTodo) controlTodo.style.display = periodo === 'todo' ? 'flex' : 'none';

    if (periodo === 'semana') {
        updateSemanaTexto();
    }

    loadReportes();
}

function formatearMesLegible(mesYYYYMM) {
    const partes = (mesYYYYMM || '').split('-');
    if (partes.length !== 2) return mesYYYYMM;
    const anio = partes[0];
    const mesIdx = parseInt(partes[1], 10) - 1;
    return `${NOMBRES_MESES[mesIdx] || partes[1]} de ${anio}`;
}

async function loadReportes() {
    const params = new URLSearchParams();
    params.set('periodo', reportFilter.periodo);

    if (reportFilter.periodo === 'dia') {
        params.set('fecha', reportFilter.fecha);
    } else if (reportFilter.periodo === 'semana') {
        params.set('fecha', reportFilter.fecha);
        const weekRange = getWeekRange(reportFilter.fecha);
        params.set('semanaInicio', weekRange.inicio);
        params.set('semanaFin', weekRange.fin);
    } else if (reportFilter.periodo === 'mes') {
        params.set('mes', reportFilter.mes);
    }

    const queryString = params.toString();
    const mesParaHoja = reportFilter.mes || new Date().toISOString().substring(0, 7);

    try {
        const [resResumen, resCat, resMensual] = await Promise.all([
            fetch(`/api/resumen?${queryString}`),
            fetch(`/api/reportes/categorias?${queryString}`),
            fetch(`/api/reportes/mensual?mes=${mesParaHoja}`)
        ]);
        const resumen = await resResumen.json();
        const categorias = await resCat.json();
        const mensual = await resMensual.json();

        document.getElementById('rep-ingresos').innerText = `Bs. ${resumen.totalIngresos.toFixed(2)}`;
        document.getElementById('rep-gastos').innerText = `Bs. ${resumen.totalGastos.toFixed(2)}`;
        const repEsc = document.getElementById('rep-gastos-escolares');
        if (repEsc) repEsc.innerText = `Bs. ${(resumen.totalGastosEscolares || 0).toFixed(2)}`;
        document.getElementById('rep-saldo').innerText = `Bs. ${resumen.saldoDisponible.toFixed(2)}`;

        // 1. Dibuja la Torta Animada de Estado de Presupuesto
        renderBudgetChart(resumen);

        // 2. Dibuja la Torta Animada de Meta de Ahorro (30%)
        renderSavingsChart(resumen);

        // 3. Dibuja la Dona Animada de Gastos por Categoría
        renderCategoryChart(categorias, resumen.totalGastos);

        // 4. Llena el Reporte Mensual Completo Imprimible
        renderReporteMensualImprimible(mensual);
    } catch (e) {
        console.error("Error al cargar reportes:", e);
    }
}

// Llena todas las tablas del Reporte Mensual Completo (para ver en pantalla e imprimir)
function renderReporteMensualImprimible(mensual) {
    if (!mensual) return;
    const mesLegible = formatearMesLegible(mensual.mes);

    // Encabezado de impresión
    const elTituloHoja = document.getElementById('sheet-mes-titulo');
    if (elTituloHoja) elTituloHoja.innerText = mesLegible;

    const elSubPrint = document.getElementById('print-subtitle-mes');
    if (elSubPrint) elSubPrint.innerText = `Período del Reporte Mensual: ${mesLegible}`;

    if (mensual.estudiante) {
        document.getElementById('print-est-nombre').innerText = mensual.estudiante.nombre || '—';
        document.getElementById('print-est-usuario').innerText = `@${mensual.estudiante.usuario || '—'}`;
        document.getElementById('print-est-curso').innerText = mensual.estudiante.curso || 'Estudiante';
    }
    document.getElementById('print-fecha-emision').innerText = new Date().toLocaleString();

    // 1. Tabla de Ingresos del Mes
    const tbodyIng = document.getElementById('rep-mensual-ingresos-body');
    if (tbodyIng) {
        if (!mensual.ingresos || mensual.ingresos.length === 0) {
            tbodyIng.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No se registraron ingresos en este mes.</td></tr>';
        } else {
            tbodyIng.innerHTML = mensual.ingresos.map(i => `
                <tr>
                    <td>${new Date(i.fecha).toLocaleDateString()}</td>
                    <td><strong>${escapeHtml(i.fuente)}</strong></td>
                    <td>${escapeHtml(i.descripcion || '—')}</td>
                    <td class="text-green"><strong>+ Bs. ${parseFloat(i.monto).toFixed(2)}</strong></td>
                </tr>
            `).join('') + `
                <tr>
                    <td colspan="3" style="text-align:right;"><strong>Total Ingresos del Mes:</strong></td>
                    <td class="text-green"><strong>Bs. ${mensual.resumen.totalIngresos.toFixed(2)}</strong></td>
                </tr>
            `;
        }
    }

    // 2. Tabla de Gastos Generales del Mes
    const tbodyGas = document.getElementById('rep-mensual-gastos-body');
    if (tbodyGas) {
        if (!mensual.gastos || mensual.gastos.length === 0) {
            tbodyGas.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No se registraron gastos generales en este mes.</td></tr>';
        } else {
            tbodyGas.innerHTML = mensual.gastos.map(g => `
                <tr>
                    <td>${new Date(g.fecha).toLocaleDateString()}</td>
                    <td><strong>${escapeHtml(g.categoria)}</strong></td>
                    <td>${escapeHtml(g.descripcion || '—')}</td>
                    <td class="text-red"><strong>- Bs. ${parseFloat(g.monto).toFixed(2)}</strong></td>
                </tr>
            `).join('') + `
                <tr>
                    <td colspan="3" style="text-align:right;"><strong>Total Gastos Generales del Mes:</strong></td>
                    <td class="text-red"><strong>Bs. ${mensual.resumen.totalGastosGenerales.toFixed(2)}</strong></td>
                </tr>
            `;
        }
    }

    // 3. Tabla de Calendario Escolar (Gastos en el Colegio) del Mes
    const tbodyEsc = document.getElementById('rep-mensual-escolares-body');
    if (tbodyEsc) {
        if (!mensual.gastosEscolares || mensual.gastosEscolares.length === 0) {
            tbodyEsc.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No se registraron gastos en el Calendario Escolar en este mes.</td></tr>';
        } else {
            tbodyEsc.innerHTML = mensual.gastosEscolares.map(ge => `
                <tr>
                    <td>${new Date(ge.fecha).toLocaleDateString()}</td>
                    <td><strong>${escapeHtml(ge.tipo)}</strong></td>
                    <td>${escapeHtml(ge.descripcion || '—')}</td>
                    <td class="text-red"><strong>- Bs. ${parseFloat(ge.monto).toFixed(2)}</strong></td>
                </tr>
            `).join('') + `
                <tr>
                    <td colspan="3" style="text-align:right;"><strong>Total Gastos en el Colegio del Mes:</strong></td>
                    <td class="text-red"><strong>Bs. ${mensual.resumen.totalGastosEscolares.toFixed(2)}</strong></td>
                </tr>
            `;
        }
    }

    // 4. Tabla de Todas las Metas de Ahorro del Estudiante
    const tbodyMetas = document.getElementById('rep-mensual-metas-body');
    if (tbodyMetas) {
        if (!mensual.metas || mensual.metas.length === 0) {
            tbodyMetas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">El estudiante aún no registró metas de ahorro.</td></tr>';
        } else {
            tbodyMetas.innerHTML = mensual.metas.map(m => {
                const obj = parseFloat(m.monto_objetivo);
                const aho = parseFloat(m.monto_ahorrado);
                const pct = obj > 0 ? Math.min((aho / obj) * 100, 100).toFixed(0) : '0';
                const comp = m.estado === 'completada' || aho >= obj;
                return `
                    <tr>
                        <td><strong>${escapeHtml(m.titulo)}</strong></td>
                        <td>${escapeHtml(m.categoria || 'Personal')}</td>
                        <td>Bs. ${obj.toFixed(2)}</td>
                        <td>Bs. ${aho.toFixed(2)}</td>
                        <td><strong>${pct}%</strong></td>
                        <td>${comp ? '✅ Completada' : '⏳ En progreso'}</td>
                    </tr>
                `;
            }).join('');
        }
    }
}

// Lleva directamente a la pestaña de Reportes en modo Mensual listo para imprimir
function irAReporteMensualImprimible() {
    activateTab('tab-reportes');
    setReportPeriodo('mes');
    setTimeout(() => {
        document.getElementById('monthly-printable-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 250);
}

// Dispara la impresión del Reporte Mensual Completo del Estudiante
async function imprimirReporteMensual() {
    if (reportFilter.periodo !== 'mes') {
        setReportPeriodo('mes');
    }
    await loadReportes();
    document.getElementById('print-fecha-emision').innerText = new Date().toLocaleString();
    setTimeout(() => {
        window.print();
    }, 300);
}

// -----------------------------------------------------------------------------
// GRÁFICO 1: ESTADO DEL PRESUPUESTO (TORTA ANIMADA)
// -----------------------------------------------------------------------------
function renderBudgetChart({ totalIngresos, totalGastos, saldoDisponible }) {
    if (budgetChartInstance) {
        budgetChartInstance.destroy();
        budgetChartInstance = null;
    }

    const ctx = document.getElementById('budgetChart')?.getContext('2d');
    if (!ctx) return;

    const { textColor, borderColor } = getChartThemeColors();
    let labels = [];
    let data = [];
    let bgColors = [];

    if (totalIngresos <= 0 && totalGastos <= 0) {
        labels = ['Sin registros en este período'];
        data = [1];
        bgColors = ['#cbd5e1'];
        setReportStatusCard('report-status-presupuesto', 'neutral', 'Presupuesto:', 'No hay registros de ingresos ni gastos en este período.');
    } else if (totalIngresos <= 0 && totalGastos > 0) {
        labels = [`Gastado (Bs. ${totalGastos.toFixed(2)})`];
        data = [totalGastos];
        bgColors = ['#ef4444'];
        setReportStatusCard('report-status-presupuesto', 'rojo', '🔴 ¡Superaste tu límite!', `Tienes gastos de Bs. ${totalGastos.toFixed(2)} pero ningún ingreso registrado en este período.`);
    } else {
        const pctGastado = (totalGastos / totalIngresos) * 100;
        const colorPresupuesto = pctGastado < 70 ? 'verde' : pctGastado <= 100 ? 'amarillo' : 'rojo';
        const estadoP = ESTADOS_PRESUPUESTO[colorPresupuesto];

        if (totalGastos <= totalIngresos) {
            labels = [`Gastado: Bs. ${totalGastos.toFixed(2)}`, `Disponible: Bs. ${saldoDisponible.toFixed(2)}`];
            data = [totalGastos, saldoDisponible];
            const sliceColor = colorPresupuesto === 'verde' ? '#3b82f6' : (colorPresupuesto === 'amarillo' ? '#f59e0b' : '#ef4444');
            bgColors = [sliceColor, '#10b981'];
        } else {
            const excedido = totalGastos - totalIngresos;
            labels = [`Presupuesto: Bs. ${totalIngresos.toFixed(2)}`, `Excedido: Bs. ${excedido.toFixed(2)}`];
            data = [totalIngresos, excedido];
            bgColors = ['#f59e0b', '#ef4444'];
        }

        setReportStatusCard(
            'report-status-presupuesto',
            colorPresupuesto,
            `${estadoP.titulo} (${pctGastado.toFixed(0)}% gastado)`,
            estadoP.mensaje
        );
    }

    budgetChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1100,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// -----------------------------------------------------------------------------
// GRÁFICO 2: META DE AHORRO 30% (TORTA ANIMADA)
// -----------------------------------------------------------------------------
function renderSavingsChart({ totalIngresos, totalGastos, saldoDisponible }) {
    if (savingsChartInstance) {
        savingsChartInstance.destroy();
        savingsChartInstance = null;
    }

    const ctx = document.getElementById('savingsChart')?.getContext('2d');
    if (!ctx) return;

    const { textColor, borderColor } = getChartThemeColors();
    let labels = [];
    let data = [];
    let bgColors = [];

    if (totalIngresos <= 0) {
        labels = ['Sin meta definida'];
        data = [1];
        bgColors = ['#cbd5e1'];
        setReportStatusCard('report-status-ahorro', 'neutral', 'Ahorro:', `Tu meta es ahorrar el ${META_AHORRO_PCT}% de tus ingresos. Registra ingresos en este período.`);
    } else {
        const metaMonto = totalIngresos * (META_AHORRO_PCT / 100);
        const pctAhorro = (saldoDisponible / totalIngresos) * 100;
        const colorAhorro = pctAhorro >= META_AHORRO_PCT ? 'verde' : pctAhorro > 0 ? 'amarillo' : 'rojo';
        const estadoA = ESTADOS_AHORRO[colorAhorro];

        if (saldoDisponible >= metaMonto) {
            const extra = saldoDisponible - metaMonto;
            if (extra > 0) {
                labels = [`Meta 30% cumplida: Bs. ${metaMonto.toFixed(2)}`, `Ahorro adicional: Bs. ${extra.toFixed(2)}`];
                data = [metaMonto, extra];
                bgColors = ['#10b981', '#059669'];
            } else {
                labels = [`Meta 30% alcanzada: Bs. ${metaMonto.toFixed(2)}`];
                data = [metaMonto];
                bgColors = ['#10b981'];
            }
        } else if (saldoDisponible > 0) {
            const faltante = metaMonto - saldoDisponible;
            labels = [`Ahorro actual: Bs. ${saldoDisponible.toFixed(2)}`, `Faltante para meta: Bs. ${faltante.toFixed(2)}`];
            data = [saldoDisponible, faltante];
            bgColors = ['#3b82f6', '#fcd34d'];
        } else {
            labels = [`Meta sugerida 30%: Bs. ${metaMonto.toFixed(2)}`, 'Sin ahorro en el período'];
            data = [metaMonto, 0.0001];
            bgColors = ['#ef4444', '#f1f5f9'];
        }

        setReportStatusCard(
            'report-status-ahorro',
            colorAhorro,
            `${estadoA.titulo} (ahorro ${Math.max(pctAhorro, 0).toFixed(0)}% de meta ${META_AHORRO_PCT}%)`,
            estadoA.mensaje
        );
    }

    savingsChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1100,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// -----------------------------------------------------------------------------
// GRÁFICO 3: GASTOS POR CATEGORÍA (DONA ANIMADA) Y TABLA DE DETALLE
// -----------------------------------------------------------------------------
function renderCategoryChart(categorias, totalGastos) {
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
        categoryChartInstance = null;
    }

    const tbody = document.getElementById('report-table-body');
    if (!categorias || categorias.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding:15px;">No hay gastos registrados en este período.</td></tr>';
    } else {
        const sumaTotal = totalGastos > 0 ? totalGastos : categorias.reduce((acc, c) => acc + parseFloat(c.total), 0);
        tbody.innerHTML = categorias.map(c => {
            const total = parseFloat(c.total);
            const pct = sumaTotal > 0 ? ((total / sumaTotal) * 100).toFixed(1) : '0.0';
            return `
                <tr>
                    <td><strong>${escapeHtml(c.categoria)}</strong></td>
                    <td>Bs. ${total.toFixed(2)}</td>
                    <td><span style="font-weight:600; color:var(--primary);">${pct}%</span></td>
                </tr>
            `;
        }).join('');
    }

    const ctx = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctx) return;

    const { textColor, borderColor } = getChartThemeColors();
    const labels = (categorias && categorias.length > 0)
        ? categorias.map(c => `${c.categoria} (Bs. ${parseFloat(c.total).toFixed(2)})`)
        : ['Sin gastos'];
    const data = (categorias && categorias.length > 0)
        ? categorias.map(c => parseFloat(c.total))
        : [1];
    const palette = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: (categorias && categorias.length > 0) ? palette.slice(0, data.length) : ['#cbd5e1'],
                borderWidth: 2,
                borderColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1150,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// =============================================================================
// 9. ENVÍO DE DATOS DESDE LOS FORMULARIOS AL SERVIDOR (CON ALERTA DE SALDO)
// =============================================================================
function setupForms() {
    // 1. Formulario para guardar un nuevo Ingreso
    document.getElementById('form-ingreso')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            fuente: document.getElementById('ingreso-fuente').value,
            monto: document.getElementById('ingreso-monto').value,
            fecha: document.getElementById('ingreso-fecha').value,
            descripcion: document.getElementById('ingreso-desc').value
        };

        const res = await fetch('/api/ingresos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('modal-ingreso');
            document.getElementById('form-ingreso').reset();
            setDefaultDates();
            showToast('Ingreso registrado correctamente', 'success');
            loadDashboard();
            loadIngresos();
        }
    });

    // 2. Formulario para guardar un nuevo Gasto General
    document.getElementById('form-gasto')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const enviarGasto = async (forzar = false) => {
            const payload = {
                categoria_id: document.getElementById('gasto-categoria').value,
                monto: document.getElementById('gasto-monto').value,
                fecha: document.getElementById('gasto-fecha').value,
                descripcion: document.getElementById('gasto-desc').value,
                forzar
            };

            const res = await fetch('/api/gastos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok && data.codigo === 'SALDO_INSUFICIENTE') {
                mostrarModalSaldoInsuficiente({
                    mensaje: data.error,
                    saldoDisponible: data.saldoDisponible,
                    montoSolicitado: data.montoSolicitado,
                    faltante: data.faltante,
                    onForzar: () => enviarGasto(true)
                });
                return;
            }

            if (res.ok) {
                closeModal('modal-gasto');
                document.getElementById('form-gasto').reset();
                setDefaultDates();
                showToast('Gasto registrado correctamente', data.saldoInsuficiente ? 'warning' : 'success');
                loadDashboard();
                loadGastos();
            }
        };

        await enviarGasto(false);
    });

    // 3. Formulario para crear una Nueva Meta de Ahorro Personal
    document.getElementById('form-meta')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const enviarMeta = async (forzar = false) => {
            const payload = {
                titulo: document.getElementById('meta-titulo').value.trim(),
                categoria: document.getElementById('meta-categoria').value,
                monto_objetivo: document.getElementById('meta-objetivo').value,
                monto_ahorrado: document.getElementById('meta-ahorrado-inicial').value || 0,
                forzar
            };

            const res = await fetch('/api/metas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok && data.codigo === 'SALDO_INSUFICIENTE') {
                mostrarModalSaldoInsuficiente({
                    mensaje: data.error,
                    saldoDisponible: data.saldoDisponible,
                    montoSolicitado: data.montoSolicitado,
                    faltante: data.faltante,
                    onForzar: () => enviarMeta(true)
                });
                return;
            }

            if (res.ok) {
                closeModal('modal-meta');
                document.getElementById('form-meta').reset();
                document.getElementById('meta-ahorrado-inicial').value = '0';
                showToast(data.mensaje || 'Meta de ahorro creada', 'success');
                loadMetas();
                loadDashboard();
            }
        };

        await enviarMeta(false);
    });

    // 4. Formulario para Poner / Abonar Dinero a una Meta de Ahorro
    document.getElementById('form-abonar-meta')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const metaId = document.getElementById('abonar-meta-id').value;

        const enviarAbono = async (forzar = false) => {
            const monto = document.getElementById('abonar-meta-monto').value;
            const res = await fetch(`/api/metas/${metaId}/abonar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ monto, forzar })
            });
            const data = await res.json();

            if (!res.ok && data.codigo === 'SALDO_INSUFICIENTE') {
                mostrarModalSaldoInsuficiente({
                    mensaje: data.error,
                    saldoDisponible: data.saldoDisponible,
                    montoSolicitado: data.montoSolicitado,
                    faltante: data.faltante,
                    onForzar: () => enviarAbono(true)
                });
                return;
            }

            if (res.ok) {
                closeModal('modal-abonar-meta');
                document.getElementById('form-abonar-meta').reset();
                showToast(data.mensaje || 'Abono guardado en tu meta', 'success');
                loadMetas();
                loadDashboard();
            }
        };

        await enviarAbono(false);
    });

    // 5. Formulario para Anotar un Gasto en el Calendario Escolar (solo colegio)
    document.getElementById('form-gasto-escolar')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const enviarEscolar = async (forzar = false) => {
            const fechaElegida = document.getElementById('escolar-fecha').value;
            const payload = {
                fecha: fechaElegida,
                tipo: document.getElementById('escolar-tipo').value,
                monto: document.getElementById('escolar-monto').value,
                descripcion: document.getElementById('escolar-desc').value,
                forzar
            };

            const res = await fetch('/api/calendario-escolar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok && data.codigo === 'SALDO_INSUFICIENTE') {
                mostrarModalSaldoInsuficiente({
                    mensaje: data.error,
                    saldoDisponible: data.saldoDisponible,
                    montoSolicitado: data.montoSolicitado,
                    faltante: data.faltante,
                    onForzar: () => enviarEscolar(true)
                });
                return;
            }

            if (res.ok) {
                closeModal('modal-gasto-escolar');
                document.getElementById('form-gasto-escolar').reset();
                setDefaultDates();
                if (fechaElegida) {
                    const partes = fechaElegida.split('-');
                    calendarState.year = parseInt(partes[0], 10);
                    calendarState.month = parseInt(partes[1], 10) - 1;
                    calendarState.selectedDate = fechaElegida;
                }
                showToast('Gasto escolar anotado en el calendario', data.saldoInsuficiente ? 'warning' : 'success');
                loadCalendarioEscolar();
                loadDashboard();
            }
        };

        await enviarEscolar(false);
    });
}

// =============================================================================
// 10. PANEL DEL ADMINISTRADOR
// =============================================================================
let adminEstudiantes = [];

function showAdmin(admin) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'block';
    document.getElementById('admin-display').innerText = admin.nombre.split(' ')[0];

    const elNombre = document.getElementById('admin-pass-nombre');
    const elUsuario = document.getElementById('admin-pass-usuario');
    if (elNombre) elNombre.innerText = admin.nombre || 'Administrador del Sistema';
    if (elUsuario) elUsuario.innerText = `Usuario: @${admin.usuario || 'admin'}`;

    const tab = tabInicial('admin-screen', 'tab-admin-estudiantes');
    activateTab(tab, { historial: 'replace' });
    if (tab === 'tab-admin-estudiantes') loadSeguridad();
}

function setupAdmin() {
    document.getElementById('admin-buscar')?.addEventListener('input', renderAdminEstudiantes);
    document.getElementById('form-estudiante')?.addEventListener('submit', guardarEstudiante);
    document.getElementById('btn-backup')?.addEventListener('click', descargarBackup);
    document.getElementById('form-admin-password')?.addEventListener('submit', cambiarPasswordAdmin);
    document.getElementById('btn-admin-go-pass')?.addEventListener('click', () => activateTab('tab-admin-password'));
}

function togglePassVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    const icon = btn?.querySelector('i');
    if (icon) {
        icon.className = mostrar ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
}

function formatFecha(valor) {
    return valor ? new Date(valor).toLocaleString() : '—';
}

async function loadAdminEstudiantes() {
    const cont = document.getElementById('list-admin-estudiantes');
    if (!cont) return;
    cont.innerHTML = '<p>Cargando estudiantes...</p>';
    const res = await fetch('/api/admin/estudiantes');
    if (!res.ok) {
        cont.innerHTML = '<p class="muted-text">No se pudo cargar la lista de estudiantes.</p>';
        return;
    }
    adminEstudiantes = await res.json();
    renderAdminEstudiantes();
}

function renderAdminEstudiantes() {
    const cont = document.getElementById('list-admin-estudiantes');
    if (!cont) return;
    const filtro = document.getElementById('admin-buscar').value.trim().toLowerCase();
    const lista = adminEstudiantes.filter(e =>
        [e.nombre_completo, e.usuario, e.curso].some(v => (v || '').toLowerCase().includes(filtro))
    );

    if (lista.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No hay estudiantes para mostrar.</p>';
        return;
    }

    cont.innerHTML = lista.map(e => `
        <div class="item-card">
            <div class="item-info">
                <strong>${escapeHtml(e.nombre_completo)}</strong>
                <span>@${escapeHtml(e.usuario)} · ${escapeHtml(e.curso || 'Sin curso')}</span>
                <span>Registrado: ${new Date(e.fecha_registro).toLocaleDateString()} · ${e.total_ingresos} ingresos · ${e.total_gastos} gastos</span>
            </div>
            <div style="display:flex; align-items:center;">
                <button class="btn-icon" title="Editar" onclick="openEstudianteModal(${e.id})">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon danger" title="Eliminar" onclick="eliminarEstudiante(${e.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function openEstudianteModal(id) {
    const est = adminEstudiantes.find(e => e.id === id);
    const passInput = document.getElementById('est-password');

    document.getElementById('form-estudiante').reset();
    document.getElementById('est-error').style.display = 'none';
    document.getElementById('est-id').value = est ? est.id : '';
    document.getElementById('est-nombre').value = est ? est.nombre_completo : '';
    document.getElementById('est-curso').value = est ? (est.curso || '') : '';
    document.getElementById('est-usuario').value = est ? est.usuario : '';

    document.getElementById('modal-estudiante-titulo').innerHTML = est
        ? '<i class="fas fa-user-edit"></i> Editar estudiante'
        : '<i class="fas fa-user-plus"></i> Registrar estudiante';
    document.getElementById('est-pass-label').innerText = est
        ? 'Nueva contraseña (déjala vacía para no cambiarla)'
        : 'Contraseña';
    passInput.required = !est;

    openModal('modal-estudiante');
}

async function guardarEstudiante(e) {
    e.preventDefault();
    const id = document.getElementById('est-id').value;
    const errorBox = document.getElementById('est-error');
    errorBox.style.display = 'none';

    const res = await fetch(id ? `/api/admin/estudiantes/${id}` : '/api/admin/estudiantes', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre_completo: document.getElementById('est-nombre').value.trim(),
            curso: document.getElementById('est-curso').value.trim(),
            usuario: document.getElementById('est-usuario').value.trim(),
            password: document.getElementById('est-password').value
        })
    });
    const data = await res.json();

    if (!res.ok) {
        errorBox.innerText = data.error || 'No se pudo guardar';
        errorBox.style.display = 'block';
        return;
    }
    closeModal('modal-estudiante');
    loadAdminEstudiantes();
}

async function eliminarEstudiante(id) {
    const est = adminEstudiantes.find(e => e.id === id);
    if (!est) return;
    const ok = confirm(`¿Eliminar la cuenta de ${est.nombre_completo} (@${est.usuario})?\n\nTambién se eliminarán todos sus ingresos y gastos. Esta acción no se puede deshacer.`);
    if (!ok) return;

    const res = await fetch(`/api/admin/estudiantes/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'No se pudo eliminar');
    }
    loadAdminEstudiantes();
}

const NIVEL_SEGURIDAD = {
    ok: { color: 'verde', icono: 'fa-check-circle', texto: '🟢 Sistema seguro' },
    advertencia: { color: 'amarillo', icono: 'fa-exclamation-triangle', texto: '🟡 Requiere atención' },
    critico: { color: 'rojo', icono: 'fa-times-circle', texto: '🔴 Riesgo crítico' }
};

async function loadSeguridad() {
    const res = await fetch('/api/admin/seguridad');
    if (!res.ok) return;
    const data = await res.json();
    const m = data.metricas;

    const nivel = NIVEL_SEGURIDAD[data.estado];
    const pendientes = data.controles.filter(c => c.nivel !== 'ok').length;
    setStatusStrip('admin-status-strip', nivel.color, nivel.texto,
        pendientes ? `${pendientes} control(es) con observaciones. Revisa la pestaña Seguridad.` : 'Todos los controles están en orden.');

    document.getElementById('admin-metricas').innerHTML = [
        ['Estudiantes', m.estudiantes],
        ['Nuevos (7 días)', m.estudiantesNuevosSemana],
        ['Accesos OK (24 h)', m.loginsExitosos24h],
        ['Accesos fallidos (24 h)', m.loginsFallidos24h],
        ['Intentos bloqueados (24 h)', m.intentosBloqueados24h],
        ['Servidor activo', `${m.servidorActivoMin} min`]
    ].map(([titulo, valor]) => `<div class="metric-box"><span>${titulo}</span><strong>${valor}</strong></div>`).join('');

    document.getElementById('admin-controles').innerHTML = data.controles.map(c => `
        <div class="control-item nivel-${c.nivel}">
            <i class="fas ${NIVEL_SEGURIDAD[c.nivel].icono}"></i>
            <div><strong>${escapeHtml(c.titulo)}</strong><p>${escapeHtml(c.detalle)}</p></div>
        </div>
    `).join('');

    const bloqueadasBox = document.getElementById('admin-bloqueadas-box');
    bloqueadasBox.style.display = data.bloqueadas.length ? 'block' : 'none';
    document.getElementById('admin-bloqueadas').innerHTML = data.bloqueadas.map(b => `
        <div class="control-item nivel-advertencia">
            <i class="fas fa-lock"></i>
            <div style="flex:1;"><strong>@${escapeHtml(b.usuario)}</strong><p>Bloqueada hasta ${formatFecha(b.hasta)}</p></div>
            <button class="btn btn-sm btn-primary" data-usuario="${escapeHtml(b.usuario)}" onclick="desbloquearCuenta(this.dataset.usuario)">Desbloquear</button>
        </div>
    `).join('');

    document.getElementById('admin-eventos').innerHTML = data.eventos.length
        ? data.eventos.map(ev => `
            <tr class="${ev.exito ? '' : 'evento-fallido'}">
                <td>${formatFecha(ev.fecha)}</td>
                <td>${escapeHtml(ev.evento)}</td>
                <td>${escapeHtml(ev.usuario || '—')}</td>
                <td>${escapeHtml(ev.ip || '—')}</td>
                <td>${escapeHtml(ev.detalle || '')}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="5" style="text-align:center;">Sin eventos registrados.</td></tr>';

    document.getElementById('backup-info').innerText = m.ultimoBackup
        ? `Último backup: ${formatFecha(m.ultimoBackup)}`
        : 'Todavía no se ha generado ningún backup.';
}

async function desbloquearCuenta(usuario) {
    await fetch(`/api/admin/bloqueos/${encodeURIComponent(usuario)}/desbloquear`, { method: 'POST' });
    loadSeguridad();
}

async function descargarBackup() {
    const btn = document.getElementById('btn-backup');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando backup...';

    try {
        const res = await fetch('/api/admin/backup');
        if (!res.ok) throw new Error();

        const disposition = res.headers.get('Content-Disposition') || '';
        const nombre = (disposition.match(/filename="(.+)"/) || [])[1] || 'backup.sql';
        const url = URL.createObjectURL(await res.blob());
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        enlace.click();
        URL.revokeObjectURL(url);
    } catch {
        alert('No se pudo generar el backup');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> Generar y descargar backup';
        loadSeguridad();
    }
}

async function cambiarPasswordAdmin(e) {
    e.preventDefault();
    const msg = document.getElementById('admin-pass-msg');
    const actual = document.getElementById('admin-pass-actual').value;
    const nueva = document.getElementById('admin-pass-nueva').value;
    msg.className = 'alert-error';
    msg.style.display = 'none';

    if (nueva.length < 6) {
        msg.innerText = 'La nueva contraseña debe tener al menos 6 caracteres';
        msg.style.display = 'block';
        return;
    }

    if (nueva !== document.getElementById('admin-pass-nueva2').value) {
        msg.innerText = 'Las contraseñas nuevas no coinciden';
        msg.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/admin/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actual, nueva })
        });
        const data = await res.json();

        msg.innerText = res.ok ? (data.mensaje || 'Contraseña actualizada correctamente') : (data.error || 'No se pudo actualizar');
        msg.className = res.ok ? 'alert-success' : 'alert-error';
        msg.style.display = 'block';
        if (res.ok) {
            document.getElementById('form-admin-password').reset();
            ['admin-pass-actual', 'admin-pass-nueva', 'admin-pass-nueva2'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.type = 'password';
            });
            document.querySelectorAll('#form-admin-password .btn-toggle-pass i').forEach(ic => {
                ic.className = 'fas fa-eye';
            });
            loadSeguridad();
        }
    } catch {
        msg.innerText = 'Error de conexión con el servidor';
        msg.className = 'alert-error';
        msg.style.display = 'block';
    }
}
