// Variables globales para guardar y actualizar los gráficos circulares
let categoryChartInstance = null;
let budgetChartInstance = null;
let savingsChartInstance = null;

// =========================================================================
// 1. INICIALIZACIÓN DEL SISTEMA AL CARGAR LA PÁGINA
// =========================================================================
// Esta función se ejecuta automáticamente en cuanto el celular o la computadora termina de cargar la página web.
document.addEventListener('DOMContentLoaded', () => {
    checkSession();         // Verifica si el estudiante ya había iniciado sesión antes
    setupNavigation();      // Activa los botones del menú de la barra inferior
    setupForms();           // Prepara los formularios para guardar datos
    setupAdmin();           // Prepara el panel del administrador
    setupReportFilters();   // Activa los filtros de día, semana y mes en reportes
    setDefaultDates();      // Pone la fecha de hoy automáticamente en los formularios
});

// Evita que textos escritos por usuarios se interpreten como HTML
function escapeHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// =========================================================================
// 2. CONTROL DE ACCESO Y SESIÓN DEL ESTUDIANTE
// =========================================================================

// Pregunta al servidor si hay una sesión activa de un estudiante
async function checkSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();

        if (data.autenticado) {
            // Si ya está logueado, entramos directo a su pantalla según su rol
            enterAs(data.usuario);
        } else {
            // Si no está logueado, mostramos la pantalla de inicio de sesión
            showLogin();
        }
    } catch {
        showLogin();
    }
}

// Muestra la pantalla de acceso y oculta el contenido del sistema
function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'replace' });
}

// Abre el panel del administrador o el sistema del estudiante
function enterAs(usuario) {
    if (usuario.rol === 'admin') showAdmin(usuario);
    else showApp(usuario);
}

// Alterna entre el formulario de inicio de sesión (/login) y el de registro (/registro)
function showAuthForm(tipo, { historial = 'push' } = {}) {
    const esRegistro = tipo === 'registro';
    document.getElementById('form-login').style.display = esRegistro ? 'none' : 'block';
    document.getElementById('form-registro').style.display = esRegistro ? 'block' : 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('registro-error').style.display = 'none';
    setUrl(esRegistro ? '/registro' : '/login', historial);
}

// =========================================================================
// 2.1 DIRECCIONES (URL) DE CADA MÓDULO
// =========================================================================

// Cada módulo tiene su propia dirección, por ejemplo http://localhost:3000/gastos
const RUTAS = {
    '/inicio': 'tab-inicio',
    '/ingresos': 'tab-ingresos',
    '/gastos': 'tab-gastos',
    '/reportes': 'tab-reportes',
    '/admin/estudiantes': 'tab-admin-estudiantes',
    '/admin/seguridad': 'tab-admin-seguridad',
    '/admin/backup': 'tab-admin-backup'
};
const RUTA_DE_TAB = Object.fromEntries(Object.entries(RUTAS).map(([ruta, tab]) => [tab, ruta]));

// historial: 'push' agrega una entrada (botón Atrás funciona), 'replace' la sustituye, 'none' no toca la URL
function setUrl(ruta, historial) {
    if (historial === 'none' || location.pathname === ruta) return;
    if (historial === 'replace') history.replaceState(null, '', ruta);
    else history.pushState(null, '', ruta);
}

// Pestaña inicial según la URL actual, si pertenece a la pantalla indicada
function tabInicial(screenId, tabPorDefecto) {
    const tab = RUTAS[location.pathname];
    return tab && document.getElementById(screenId).contains(document.getElementById(tab)) ? tab : tabPorDefecto;
}

// Activa una pestaña, carga sus datos y actualiza la dirección del navegador
function activateTab(tabId, { historial = 'push' } = {}) {
    const tab = document.getElementById(tabId);
    const screen = tab.closest('.view');

    screen.querySelectorAll('.bottom-nav .nav-item').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    screen.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active-tab'));
    tab.classList.add('active-tab');

    setUrl(RUTA_DE_TAB[tabId], historial);
    TAB_LOADERS[tabId]?.();
}

// Botones Atrás / Adelante del navegador
window.addEventListener('popstate', () => {
    const tabId = RUTAS[location.pathname];
    const loginVisible = document.getElementById('login-screen').style.display !== 'none';

    if (loginVisible) {
        showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'none' });
    } else if (tabId && document.getElementById(tabId).closest('.view').style.display !== 'none') {
        activateTab(tabId, { historial: 'none' });
    }
});

// Oculta el login y abre el sistema principal con el nombre del estudiante
function showApp(estudiante) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    // Coloca el nombre del estudiante y su curso en la cabecera
    document.getElementById('user-display').innerText = estudiante.nombre.split(' ')[0];
    document.getElementById('welcome-msg').innerText = `¡Hola, ${estudiante.nombre}!`;
    document.getElementById('course-msg').innerText = `Curso: ${estudiante.curso || 'Estudiante'}`;

    // Abre el módulo indicado en la URL (o Inicio) y carga las categorías
    const tab = tabInicial('app-screen', 'tab-inicio');
    activateTab(tab, { historial: 'replace' });
    if (tab !== 'tab-inicio') loadDashboard(); // Las franjas de estado necesitan el resumen
    loadCategoriasSelect();
}

// Escucha cuando el estudiante presiona el botón "Iniciar sesión"
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault(); // Evita que la página se recargue

    const usuario = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value.trim();
    const errorBox = document.getElementById('login-error');

    errorBox.style.display = 'none'; // Oculta alertas anteriores

    try {
        // Envía el usuario y contraseña al servidor
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });
        const data = await res.json();

        if (res.ok) {
            // Si las credenciales son correctas, entra según su rol
            document.getElementById('form-login').reset();
            enterAs(data.usuario);
        } else {
            // Si son incorrectas, muestra un mensaje de aviso
            errorBox.innerText = data.error || 'Credenciales inválidas';
            errorBox.style.display = 'block';
        }
    } catch {
        errorBox.innerText = 'Error de conexión con el servidor';
        errorBox.style.display = 'block';
    }
});

// Registro de un estudiante nuevo desde la pantalla de acceso
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

// Escucha los botones rojos para cerrar sesión (estudiante y administrador)
['btn-logout', 'btn-admin-logout'].forEach(id => {
    document.getElementById(id).addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.reload(); // Recarga la página para volver al login inicial
    });
});

// =========================================================================
// 3. NAVEGACIÓN ENTRE PANTALLAS (BARRA INFERIOR PARA CELULARES)
// =========================================================================

// Esta función permite cambiar de pantalla al tocar los botones inferiores: Inicio, Ingresos, Gastos o Reportes
const TAB_LOADERS = {
    'tab-inicio': () => loadDashboard(),
    'tab-ingresos': () => loadIngresos(),
    'tab-gastos': () => loadGastos(),
    'tab-reportes': () => loadReportes(),
    'tab-admin-estudiantes': () => loadAdminEstudiantes(),
    'tab-admin-seguridad': () => loadSeguridad(),
    'tab-admin-backup': () => loadSeguridad()
};

// Cada pantalla (estudiante y administrador) tiene su propia barra inferior
function setupNavigation() {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });
}

// =========================================================================
// 4. VENTANAS EMERGENTES (MODALES) Y FECHAS
// =========================================================================

// Abre una ventanita flotante para agregar un ingreso o gasto
function openModal(id) { 
    document.getElementById(id).classList.add('active'); 
}

// Cierra la ventanita flotante
function closeModal(id) { 
    document.getElementById(id).classList.remove('active'); 
}

// Asigna la fecha actual automáticamente en las casillas de fecha
function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('ingreso-fecha').value = today;
    document.getElementById('gasto-fecha').value = today;
}

// =========================================================================
// 5. PANTALLA PRINCIPAL: BALANCES Y SALDO DISPONIBLE
// =========================================================================

// Pide al servidor las sumas de dinero y las muestra en las tarjetas de colores
async function loadDashboard() {
    try {
        const res = await fetch('/api/resumen');
        const data = await res.json();

        // Muestra los números en formato de moneda boliviana (Bs.)
        document.getElementById('dash-ingresos').innerText = `Bs. ${data.totalIngresos.toFixed(2)}`;
        document.getElementById('dash-gastos').innerText = `Bs. ${data.totalGastos.toFixed(2)}`;
        document.getElementById('dash-saldo').innerText = `Bs. ${data.saldoDisponible.toFixed(2)}`;
    } catch (e) {
        console.error("Error al cargar balances:", e);
    }
}

// =========================================================================
// 5.1 CONFIGURACIÓN DE DIAGNÓSTICO (PRESUPUESTO Y AHORRO) PARA REPORTES
// =========================================================================

// Porcentaje de los ingresos que el estudiante debería ahorrar
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

function setReportStatusCard(id, color, titulo, mensaje) {
    const strip = document.getElementById(id);
    if (!strip) return;
    strip.className = `status-strip status-${color} report-status-card`;
    const t = strip.querySelector('.status-title');
    const m = strip.querySelector('.status-msg');
    if (t) t.innerText = titulo;
    if (m) m.innerText = mensaje;
}

// =========================================================================
// 6. MÓDULO DE INGRESOS (DINERO RECIBIDO)
// =========================================================================

// Trae de la base de datos la lista de todos los ingresos del estudiante y los dibuja
async function loadIngresos() {
    const cont = document.getElementById('list-ingresos');
    cont.innerHTML = '<p>Cargando ingresos...</p>';

    const res = await fetch('/api/ingresos');
    const data = await res.json();

    // Mensaje si todavía no guardó ningún dinero recibido
    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes ingresos registrados aún.</p>';
        return;
    }

    // Crea una tarjeta para cada ingreso con su botón para borrar
    cont.innerHTML = data.map(i => `
        <div class="item-card">
            <div class="item-info">
                <strong>${i.fuente}</strong>
                <span>${new Date(i.fecha).toLocaleDateString()} - ${i.descripcion || 'Sin detalle'}</span>
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

// Pide confirmación al estudiante y elimina un ingreso seleccionado
async function deleteIngreso(id) {
    if (!confirm('¿Deseas eliminar este ingreso?')) return;
    await fetch(`/api/ingresos/${id}`, { method: 'DELETE' });
    loadIngresos();   // Refresca la lista
    loadDashboard();  // Actualiza los totales en pantalla
}

// =========================================================================
// 7. MÓDULO DE GASTOS (DINERO UTILIZADO)
// =========================================================================

// Trae de la base de datos la lista de gastos realizados por el estudiante
async function loadGastos() {
    const cont = document.getElementById('list-gastos');
    cont.innerHTML = '<p>Cargando gastos...</p>';

    const res = await fetch('/api/gastos');
    const data = await res.json();

    // Mensaje si no tiene gastos guardados
    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes gastos registrados.</p>';
        return;
    }

    // Dibuja una tarjeta por cada gasto
    cont.innerHTML = data.map(g => `
        <div class="item-card">
            <div class="item-info">
                <strong>${g.categoria}</strong>
                <span>${new Date(g.fecha).toLocaleDateString()} - ${g.descripcion || 'Sin detalle'}</span>
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

// Pide confirmación y elimina un gasto registrado
async function deleteGasto(id) {
    if (!confirm('¿Deseas eliminar este gasto?')) return;
    await fetch(`/api/gastos/${id}`, { method: 'DELETE' });
    loadGastos();     // Refresca la lista
    loadDashboard();  // Actualiza los totales en pantalla
}

// Llena la lista desplegable del formulario con las categorías (Alimentación, Transporte, etc.)
async function loadCategoriasSelect() {
    const select = document.getElementById('gasto-categoria');
    const res = await fetch('/api/categorias');
    const data = await res.json();
    select.innerHTML = data.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
}

// =========================================================================
// 8. MÓDULO DE REPORTES Y GRÁFICOS (CON FILTROS Y TORTAS DE DIAGNÓSTICO)
// =========================================================================

// Estado global de los filtros de reportes
let reportFilter = {
    periodo: 'mes', // 'dia' | 'semana' | 'mes' | 'todo'
    fecha: new Date().toISOString().split('T')[0],
    mes: new Date().toISOString().substring(0, 7)
};

// Calcula las fechas de inicio (lunes) y fin (domingo) para una semana dada
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

// Configura los eventos de los botones y selectores de fecha en la pantalla de Reportes
function setupReportFilters() {
    const fechaInput = document.getElementById('report-filter-fecha');
    const semanaInput = document.getElementById('report-filter-semana-fecha');
    const mesInput = document.getElementById('report-filter-mes');

    if (fechaInput) fechaInput.value = reportFilter.fecha;
    if (semanaInput) semanaInput.value = reportFilter.fecha;
    if (mesInput) mesInput.value = reportFilter.mes;

    updateSemanaTexto();

    // Cambio en fecha de día
    fechaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            loadReportes();
        }
    });

    // Cambio en fecha para semana
    semanaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            updateSemanaTexto();
            loadReportes();
        }
    });

    // Cambio en mes
    mesInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.mes = e.target.value;
            loadReportes();
        }
    });

    // Botones píldora (Día, Semanal, Mes, Todo)
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const periodo = btn.getAttribute('data-period');
            setReportPeriodo(periodo);
        });
    });
}

// Actualiza el texto con el rango de fechas de la semana seleccionada
function updateSemanaTexto() {
    const range = getWeekRange(reportFilter.fecha);
    const textoEl = document.getElementById('semana-rango-texto');
    if (textoEl) {
        textoEl.innerText = range.texto;
    }
}

// Cambia el período activo y alterna los controles visibles
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

// Carga datos financieros según los filtros y actualiza números y las 3 gráficas circulares
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

    try {
        const [resResumen, resCat] = await Promise.all([
            fetch(`/api/resumen?${queryString}`),
            fetch(`/api/reportes/categorias?${queryString}`)
        ]);
        const resumen = await resResumen.json();
        const categorias = await resCat.json();

        // Números superiores del período
        document.getElementById('rep-ingresos').innerText = `Bs. ${resumen.totalIngresos.toFixed(2)}`;
        document.getElementById('rep-gastos').innerText = `Bs. ${resumen.totalGastos.toFixed(2)}`;
        document.getElementById('rep-saldo').innerText = `Bs. ${resumen.saldoDisponible.toFixed(2)}`;

        // 1. Gráfico de torta de Presupuesto
        renderBudgetChart(resumen);

        // 2. Gráfico de torta de Ahorro
        renderSavingsChart(resumen);

        // 3. Gráfico de torta y tabla de Gastos por Categoría
        renderCategoryChart(categorias, resumen.totalGastos);
    } catch (e) {
        console.error("Error al cargar reportes:", e);
    }
}

// Dibuja el gráfico circular (torta) del estado del presupuesto
function renderBudgetChart({ totalIngresos, totalGastos, saldoDisponible }) {
    if (budgetChartInstance) {
        budgetChartInstance.destroy();
        budgetChartInstance = null;
    }

    const ctx = document.getElementById('budgetChart')?.getContext('2d');
    if (!ctx) return;

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
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// Dibuja el gráfico circular (torta) de cumplimiento de meta de ahorro
function renderSavingsChart({ totalIngresos, totalGastos, saldoDisponible }) {
    if (savingsChartInstance) {
        savingsChartInstance.destroy();
        savingsChartInstance = null;
    }

    const ctx = document.getElementById('savingsChart')?.getContext('2d');
    if (!ctx) return;

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
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// Dibuja el gráfico circular y la tabla de detalle por categoría
function renderCategoryChart(categorias, totalGastos) {
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
        categoryChartInstance = null;
    }

    // Llenar tabla
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
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// =========================================================================
// 9. ENVÍO DE DATOS DESDE LOS FORMULARIOS AL SERVIDOR
// =========================================================================

function setupForms() {
    // 1. Guardar un nuevo Ingreso
    document.getElementById('form-ingreso').addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            fuente: document.getElementById('ingreso-fuente').value,
            monto: document.getElementById('ingreso-monto').value,
            fecha: document.getElementById('ingreso-fecha').value,
            descripcion: document.getElementById('ingreso-desc').value
        };

        // Enviar a la base de datos
        await fetch('/api/ingresos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Limpia el formulario, cierra la ventana flotante y actualiza los números
        closeModal('modal-ingreso');
        document.getElementById('form-ingreso').reset();
        setDefaultDates();
        loadDashboard();
        loadIngresos();
    });

    // 2. Guardar un nuevo Gasto
    document.getElementById('form-gasto').addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            categoria_id: document.getElementById('gasto-categoria').value,
            monto: document.getElementById('gasto-monto').value,
            fecha: document.getElementById('gasto-fecha').value,
            descripcion: document.getElementById('gasto-desc').value
        };

        // Enviar a la base de datos
        await fetch('/api/gastos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Limpia el formulario, cierra la ventana flotante y actualiza los números
        closeModal('modal-gasto');
        document.getElementById('form-gasto').reset();
        setDefaultDates();
        loadDashboard();
        loadGastos();
    });
}

// =========================================================================
// 10. PANEL DEL ADMINISTRADOR
// =========================================================================

let adminEstudiantes = [];

function showAdmin(admin) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'block';
    document.getElementById('admin-display').innerText = admin.nombre.split(' ')[0];

    const tab = tabInicial('admin-screen', 'tab-admin-estudiantes');
    activateTab(tab, { historial: 'replace' });
    if (tab === 'tab-admin-estudiantes') loadSeguridad(); // La franja de seguridad se muestra siempre
}

function setupAdmin() {
    document.getElementById('admin-buscar').addEventListener('input', renderAdminEstudiantes);
    document.getElementById('form-estudiante').addEventListener('submit', guardarEstudiante);
    document.getElementById('btn-backup').addEventListener('click', descargarBackup);
    document.getElementById('form-admin-password').addEventListener('submit', cambiarPasswordAdmin);
}

function formatFecha(valor) {
    return valor ? new Date(valor).toLocaleString() : '—';
}

// ---------- CRUD de estudiantes ----------

async function loadAdminEstudiantes() {
    const cont = document.getElementById('list-admin-estudiantes');
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

// Sin id abre el formulario para registrar; con id lo abre para editar
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

// ---------- Monitoreo de seguridad ----------

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

// ---------- Backup y contraseña del administrador ----------

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
    const nueva = document.getElementById('admin-pass-nueva').value;
    msg.className = 'alert-error';
    msg.style.display = 'none';

    if (nueva !== document.getElementById('admin-pass-nueva2').value) {
        msg.innerText = 'Las contraseñas nuevas no coinciden';
        msg.style.display = 'block';
        return;
    }

    const res = await fetch('/api/admin/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: document.getElementById('admin-pass-actual').value, nueva })
    });
    const data = await res.json();

    msg.innerText = res.ok ? 'Contraseña actualizada correctamente' : (data.error || 'No se pudo actualizar');
    msg.className = res.ok ? 'alert-success' : 'alert-error';
    msg.style.display = 'block';
    if (res.ok) {
        document.getElementById('form-admin-password').reset();
        loadSeguridad();
    }
}