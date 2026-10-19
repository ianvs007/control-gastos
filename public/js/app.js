// =============================================================================
// ARCHIVO: app.js - Lógica Interactiva del Frontend (Cliente / Navegador)
// =============================================================================
// Este archivo es el "cerebro" que se ejecuta dentro del navegador web (en el
// teléfono celular o en la computadora del estudiante o administrador).
// Sus funciones principales son:
// 1. Manejar el inicio de sesión y registro de estudiantes.
// 2. Controlar la navegación táctil entre pestañas (Inicio, Ingresos, Gastos, Reportes).
// 3. Registrar y borrar ingresos y gastos en tiempo real sin recargar la página.
// 4. Procesar los filtros de fecha (Día, Semanal, Mes y Todo).
// 5. Dibujar los gráficos circulares interactivos con Chart.js:
//    - Torta 1: Estado del Presupuesto (Gastado vs Restante).
//    - Torta 2: Meta de Ahorro del 30% (Ahorro actual vs Faltante).
//    - Torta 3: Gastos por Categoría y su desglose en tabla.
// 6. Gestionar el Panel de Administración (estudiantes, seguridad y copias de seguridad).
// =============================================================================

// Variables globales para guardar las instancias activas de los 3 gráficos circulares.
// Es necesario guardarlas porque antes de volver a dibujar un gráfico nuevo, debemos
// destruir el gráfico anterior para que no se superpongan ni parpadeen.
let categoryChartInstance = null; // Gráfico de gastos por categoría
let budgetChartInstance = null;   // Gráfico de estado del presupuesto
let savingsChartInstance = null;  // Gráfico de meta de ahorro

// =============================================================================
// 1. INICIALIZACIÓN DEL SISTEMA AL CARGAR LA PÁGINA
// =============================================================================
// Este evento se dispara automáticamente apenas el navegador termina de leer el HTML.
document.addEventListener('DOMContentLoaded', () => {
    checkSession();         // 1. Pregunta al servidor si el usuario ya tenía su sesión abierta
    setupNavigation();      // 2. Activa los botones de navegación inferior
    setupForms();           // 3. Conecta los formularios para registrar ingresos y gastos
    setupAdmin();           // 4. Prepara los botones y buscador del panel administrativo
    setupReportFilters();   // 5. Configura los botones de filtro por Día, Semana, Mes y Todo
    setDefaultDates();      // 6. Pone la fecha de hoy automáticamente en los formularios
});

// Función de protección: Convierte caracteres especiales en texto seguro
// para evitar que alguien intente inyectar código dañino (ataques XSS).
function escapeHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// =============================================================================
// 2. CONTROL DE ACCESO Y SESIÓN DE USUARIOS
// =============================================================================

// Pregunta al servidor si existe una sesión activa actualmente
async function checkSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();

        if (data.autenticado) {
            // Si el usuario ya estaba conectado, entramos directamente a su pantalla
            enterAs(data.usuario);
        } else {
            // Si no estaba conectado, mostramos la pantalla de inicio de sesión
            showLogin();
        }
    } catch {
        // En caso de que no haya conexión con el servidor, mostramos la pantalla de login
        showLogin();
    }
}

// Muestra la pantalla de acceso (login) y oculta las demás pantallas
function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'replace' });
}

// Redirige al usuario según su rol: 'admin' al panel administrativo, estudiante a la app principal
function enterAs(usuario) {
    if (usuario.rol === 'admin') showAdmin(usuario);
    else showApp(usuario);
}

// Alterna visualmente entre el formulario de Iniciar Sesión y el de Registrarse
function showAuthForm(tipo, { historial = 'push' } = {}) {
    const esRegistro = tipo === 'registro';
    document.getElementById('form-login').style.display = esRegistro ? 'none' : 'block';
    document.getElementById('form-registro').style.display = esRegistro ? 'block' : 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('registro-error').style.display = 'none';
    setUrl(esRegistro ? '/registro' : '/login', historial);
}

// =============================================================================
// 2.1 DIRECCIONES URL Y NAVEGACIÓN LIMPIA (SPA - Single Page Application)
// =============================================================================

// Diccionario que vincula cada dirección URL con su pestaña interna correspondiente
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

// Actualiza la barra de direcciones del navegador sin recargar la página completa
function setUrl(ruta, historial) {
    if (historial === 'none' || location.pathname === ruta) return;
    if (historial === 'replace') history.replaceState(null, '', ruta);
    else history.pushState(null, '', ruta);
}

// Determina qué pestaña debe abrirse al cargar la página según la URL escrita
function tabInicial(screenId, tabPorDefecto) {
    const tab = RUTAS[location.pathname];
    return tab && document.getElementById(screenId).contains(document.getElementById(tab)) ? tab : tabPorDefecto;
}

// Activa una pestaña seleccionada, resalta su botón inferior y carga sus datos actualizados
function activateTab(tabId, { historial = 'push' } = {}) {
    const tab = document.getElementById(tabId);
    const screen = tab.closest('.view');

    // Marca el botón activo en la barra inferior
    screen.querySelectorAll('.bottom-nav .nav-item').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    // Oculta todas las pestañas y muestra únicamente la elegida
    screen.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active-tab'));
    tab.classList.add('active-tab');

    // Cambia la dirección URL para que coincida
    setUrl(RUTA_DE_TAB[tabId], historial);
    // Ejecuta la función de carga específica de esa pestaña
    TAB_LOADERS[tabId]?.();
}

// Escucha cuando el usuario presiona el botón "Atrás" o "Adelante" en su teléfono o navegador
window.addEventListener('popstate', () => {
    const tabId = RUTAS[location.pathname];
    const loginVisible = document.getElementById('login-screen').style.display !== 'none';

    if (loginVisible) {
        showAuthForm(location.pathname === '/registro' ? 'registro' : 'login', { historial: 'none' });
    } else if (tabId && document.getElementById(tabId).closest('.view').style.display !== 'none') {
        activateTab(tabId, { historial: 'none' });
    }
});

// Abre la pantalla principal del estudiante y le da la bienvenida
function showApp(estudiante) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    // Muestra el nombre del estudiante y su curso
    document.getElementById('user-display').innerText = estudiante.nombre.split(' ')[0];
    document.getElementById('welcome-msg').innerText = `¡Hola, ${estudiante.nombre}!`;
    document.getElementById('course-msg').innerText = `Curso: ${estudiante.curso || 'Estudiante'}`;

    // Abre la pestaña correspondiente y precarga categorías
    const tab = tabInicial('app-screen', 'tab-inicio');
    activateTab(tab, { historial: 'replace' });
    if (tab !== 'tab-inicio') loadDashboard();
    loadCategoriasSelect();
}

// Procesa el formulario cuando el usuario presiona "Iniciar sesión"
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault(); // Evita recargar la página

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

// Procesa el formulario cuando un estudiante nuevo se registra
document.getElementById('form-registro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('registro-error');
    errorBox.style.display = 'none';

    const password = document.getElementById('reg-pass').value;
    // Comprobamos que las dos contraseñas sean idénticas
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

// Botones para cerrar sesión (en el perfil del estudiante y en el del administrador)
['btn-logout', 'btn-admin-logout'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.reload(); // Recarga la página limpia
    });
});

// =============================================================================
// 3. NAVEGACIÓN INFERIOR (MENÚ PARA CELULARES Y COMPUTADORAS)
// =============================================================================

// Vincula cada pestaña con la función encargada de consultar sus datos
const TAB_LOADERS = {
    'tab-inicio': () => loadDashboard(),
    'tab-ingresos': () => loadIngresos(),
    'tab-gastos': () => loadGastos(),
    'tab-reportes': () => loadReportes(),
    'tab-admin-estudiantes': () => loadAdminEstudiantes(),
    'tab-admin-seguridad': () => loadSeguridad(),
    'tab-admin-backup': () => loadSeguridad()
};

function setupNavigation() {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });
}

// =============================================================================
// 4. VENTANAS FLOTANTES (MODALES) Y FECHAS
// =============================================================================

// Abre una ventanita flotante (modal) por su ID
function openModal(id) { 
    document.getElementById(id).classList.add('active'); 
}

// Cierra la ventanita flotante
function closeModal(id) { 
    document.getElementById(id).classList.remove('active'); 
}

// Pone la fecha del día de hoy en formato AAAA-MM-DD en los campos de fecha
function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const elIng = document.getElementById('ingreso-fecha');
    const elGas = document.getElementById('gasto-fecha');
    if (elIng) elIng.value = today;
    if (elGas) elGas.value = today;
}

// =============================================================================
// 5. PANTALLA PRINCIPAL (DASHBOARD): TOTALES Y BALANCES
// =============================================================================

// Pide al servidor las sumas de ingresos, gastos y saldo, y las pinta en las tarjetas de colores
async function loadDashboard() {
    try {
        const res = await fetch('/api/resumen');
        const data = await res.json();

        // Muestra los números en moneda boliviana con 2 decimales (ejemplo: Bs. 150.00)
        document.getElementById('dash-ingresos').innerText = `Bs. ${data.totalIngresos.toFixed(2)}`;
        document.getElementById('dash-gastos').innerText = `Bs. ${data.totalGastos.toFixed(2)}`;
        document.getElementById('dash-saldo').innerText = `Bs. ${data.saldoDisponible.toFixed(2)}`;
    } catch (e) {
        console.error("Error al cargar balances:", e);
    }
}

// =============================================================================
// 5.1 CONFIGURACIÓN DE DIAGNÓSTICO (PRESUPUESTO Y AHORRO) PARA REPORTES
// =============================================================================

// Meta recomendada: el estudiante debería ahorrar el 30% de lo que recibe
const META_AHORRO_PCT = 30;

// Mensajes educativos para el semáforo del presupuesto
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

// Mensajes motivacionales para la meta de ahorro
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

// Función auxiliar para actualizar tarjetas de estado (franjas de diagnóstico)
function setStatusStrip(id, color, titulo, mensaje) {
    const strip = document.getElementById(id);
    if (!strip) return;
    strip.className = `status-strip status-${color}`;
    const t = strip.querySelector('.status-title');
    const m = strip.querySelector('.status-msg');
    if (t) t.innerText = titulo;
    if (m) m.innerText = mensaje;
}

// Alias para las tarjetas de diagnóstico dentro de la pestaña de Reportes
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

// Consulta la lista de todos los ingresos del estudiante y los dibuja en la pantalla
async function loadIngresos() {
    const cont = document.getElementById('list-ingresos');
    cont.innerHTML = '<p>Cargando ingresos...</p>';

    const res = await fetch('/api/ingresos');
    const data = await res.json();

    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes ingresos registrados aún.</p>';
        return;
    }

    // Dibuja una tarjeta por cada ingreso con su botón para borrar
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

// Pide confirmación al estudiante y borra el ingreso seleccionado
async function deleteIngreso(id) {
    if (!confirm('¿Deseas eliminar este ingreso?')) return;
    await fetch(`/api/ingresos/${id}`, { method: 'DELETE' });
    loadIngresos();   // Refresca la lista
    loadDashboard();  // Actualiza los balances
}

// =============================================================================
// 7. MÓDULO DE GASTOS (DINERO UTILIZADO)
// =============================================================================

// Consulta la lista de todos los gastos del estudiante y los dibuja
async function loadGastos() {
    const cont = document.getElementById('list-gastos');
    cont.innerHTML = '<p>Cargando gastos...</p>';

    const res = await fetch('/api/gastos');
    const data = await res.json();

    if (data.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No tienes gastos registrados.</p>';
        return;
    }

    // Dibuja una tarjeta por cada gasto
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

// Pide confirmación y elimina un gasto registrado
async function deleteGasto(id) {
    if (!confirm('¿Deseas eliminar este gasto?')) return;
    await fetch(`/api/gastos/${id}`, { method: 'DELETE' });
    loadGastos();     // Refresca la lista
    loadDashboard();  // Actualiza los balances
}

// Llena la lista desplegable del formulario con las categorías (Alimentación, Transporte, etc.)
async function loadCategoriasSelect() {
    const select = document.getElementById('gasto-categoria');
    if (!select) return;
    const res = await fetch('/api/categorias');
    const data = await res.json();
    select.innerHTML = data.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
}

// =============================================================================
// 8. MÓDULO DE REPORTES Y GRÁFICOS (FILTROS Y TORTAS DE DIAGNÓSTICO)
// =============================================================================

// Estado actual del filtro seleccionado en Reportes (por defecto arranca en el mes actual)
let reportFilter = {
    periodo: 'mes', // Opciones posibles: 'dia', 'semana', 'mes', 'todo'
    fecha: new Date().toISOString().split('T')[0],
    mes: new Date().toISOString().substring(0, 7)
};

// Calcula con precisión qué día es lunes (inicio de semana) y qué día es domingo (fin de semana)
// para cualquier fecha que el estudiante elija
function getWeekRange(dateStr) {
    const parts = (dateStr || new Date().toISOString().split('T')[0]).split('-');
    const base = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = base.getDay(); // 0 = Domingo, 1 = Lunes, etc.
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

// Configura los eventos al hacer clic en los botones de filtro y en los selectores de fecha
function setupReportFilters() {
    const fechaInput = document.getElementById('report-filter-fecha');
    const semanaInput = document.getElementById('report-filter-semana-fecha');
    const mesInput = document.getElementById('report-filter-mes');

    // Inicializamos los campos con las fechas actuales
    if (fechaInput) fechaInput.value = reportFilter.fecha;
    if (semanaInput) semanaInput.value = reportFilter.fecha;
    if (mesInput) mesInput.value = reportFilter.mes;

    updateSemanaTexto();

    // Cuando el usuario cambia el día en el selector de calendario:
    fechaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            loadReportes();
        }
    });

    // Cuando el usuario cambia la fecha para consultar otra semana:
    semanaInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.fecha = e.target.value;
            updateSemanaTexto();
            loadReportes();
        }
    });

    // Cuando el usuario cambia el mes:
    mesInput?.addEventListener('change', (e) => {
        if (e.target.value) {
            reportFilter.mes = e.target.value;
            loadReportes();
        }
    });

    // Evento de clic en los botones píldora (Día, Semanal, Mes, Todo):
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const periodo = btn.getAttribute('data-period');
            setReportPeriodo(periodo);
        });
    });
}

// Muestra en pantalla el texto de la semana (ejemplo: "12/10/2026 al 18/10/2026")
function updateSemanaTexto() {
    const range = getWeekRange(reportFilter.fecha);
    const textoEl = document.getElementById('semana-rango-texto');
    if (textoEl) {
        textoEl.innerText = range.texto;
    }
}

// Cambia el período activo y muestra los controles necesarios (ocultando los que no correspondan)
function setReportPeriodo(periodo) {
    reportFilter.periodo = periodo;

    // Resalta visualmente el botón seleccionado
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-period') === periodo);
    });

    // Muestra u oculta los campos de entrada según el período
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

    // Vuelve a consultar los datos y redibuja los gráficos con el nuevo filtro
    loadReportes();
}

// Consulta al servidor los datos filtrados y actualiza números y las 3 gráficas circulares
async function loadReportes() {
    // Preparamos los parámetros que le enviaremos al backend en la URL
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
        // Pedimos en paralelo el resumen financiero y la división por categorías
        const [resResumen, resCat] = await Promise.all([
            fetch(`/api/resumen?${queryString}`),
            fetch(`/api/reportes/categorias?${queryString}`)
        ]);
        const resumen = await resResumen.json();
        const categorias = await resCat.json();

        // Mostramos los totales calculados en la parte superior del reporte
        document.getElementById('rep-ingresos').innerText = `Bs. ${resumen.totalIngresos.toFixed(2)}`;
        document.getElementById('rep-gastos').innerText = `Bs. ${resumen.totalGastos.toFixed(2)}`;
        document.getElementById('rep-saldo').innerText = `Bs. ${resumen.saldoDisponible.toFixed(2)}`;

        // 1. Dibuja la Torta de Estado de Presupuesto con su tarjeta de diagnóstico
        renderBudgetChart(resumen);

        // 2. Dibuja la Torta de Meta de Ahorro con su tarjeta motivacional
        renderSavingsChart(resumen);

        // 3. Dibuja la Torta de Gastos por Categoría y llena la tabla de detalle
        renderCategoryChart(categorias, resumen.totalGastos);
    } catch (e) {
        console.error("Error al cargar reportes:", e);
    }
}

// -----------------------------------------------------------------------------
// GRÁFICO 1: ESTADO DEL PRESUPUESTO (TORTA)
// -----------------------------------------------------------------------------
// Muestra cuánto dinero se gastó en relación con el presupuesto total (ingresos).
function renderBudgetChart({ totalIngresos, totalGastos, saldoDisponible }) {
    if (budgetChartInstance) {
        budgetChartInstance.destroy(); // Destruimos el gráfico anterior
        budgetChartInstance = null;
    }

    const ctx = document.getElementById('budgetChart')?.getContext('2d');
    if (!ctx) return;

    let labels = [];
    let data = [];
    let bgColors = [];

    // CASO A: No hay movimientos en este período
    if (totalIngresos <= 0 && totalGastos <= 0) {
        labels = ['Sin registros en este período'];
        data = [1];
        bgColors = ['#cbd5e1'];
        setReportStatusCard('report-status-presupuesto', 'neutral', 'Presupuesto:', 'No hay registros de ingresos ni gastos en este período.');
    }
    // CASO B: Hubo gastos pero ningún ingreso registrado
    else if (totalIngresos <= 0 && totalGastos > 0) {
        labels = [`Gastado (Bs. ${totalGastos.toFixed(2)})`];
        data = [totalGastos];
        bgColors = ['#ef4444'];
        setReportStatusCard('report-status-presupuesto', 'rojo', '🔴 ¡Superaste tu límite!', `Tienes gastos de Bs. ${totalGastos.toFixed(2)} pero ningún ingreso registrado en este período.`);
    }
    // CASO C: Hay ingresos normales registrados
    else {
        const pctGastado = (totalGastos / totalIngresos) * 100;
        // Semáforo: Verde si gastó menos del 70%, Amarillo entre 70% y 100%, Rojo si superó el 100%
        const colorPresupuesto = pctGastado < 70 ? 'verde' : pctGastado <= 100 ? 'amarillo' : 'rojo';
        const estadoP = ESTADOS_PRESUPUESTO[colorPresupuesto];

        if (totalGastos <= totalIngresos) {
            // El gasto está dentro del límite: mostramos lo gastado y lo que aún queda disponible
            labels = [`Gastado: Bs. ${totalGastos.toFixed(2)}`, `Disponible: Bs. ${saldoDisponible.toFixed(2)}`];
            data = [totalGastos, saldoDisponible];
            const sliceColor = colorPresupuesto === 'verde' ? '#3b82f6' : (colorPresupuesto === 'amarillo' ? '#f59e0b' : '#ef4444');
            bgColors = [sliceColor, '#10b981'];
        } else {
            // Se pasó de su presupuesto: mostramos la parte cubierta y el excedente en rojo
            const excedido = totalGastos - totalIngresos;
            labels = [`Presupuesto: Bs. ${totalIngresos.toFixed(2)}`, `Excedido: Bs. ${excedido.toFixed(2)}`];
            data = [totalIngresos, excedido];
            bgColors = ['#f59e0b', '#ef4444'];
        }

        // Mostramos el diagnóstico descriptivo en la tarjeta
        setReportStatusCard(
            'report-status-presupuesto',
            colorPresupuesto,
            `${estadoP.titulo} (${pctGastado.toFixed(0)}% gastado)`,
            estadoP.mensaje
        );
    }

    // Dibujamos el gráfico circular tipo 'pie'
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

// -----------------------------------------------------------------------------
// GRÁFICO 2: META DE AHORRO (TORTA)
// -----------------------------------------------------------------------------
// Evalúa si el estudiante logró retener como saldo al menos el 30% de sus ingresos.
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
        // La meta monetaria en Bolivianos es el 30% de los ingresos totales
        const metaMonto = totalIngresos * (META_AHORRO_PCT / 100);
        const pctAhorro = (saldoDisponible / totalIngresos) * 100;
        // Verde si ahorró 30% o más, amarillo si ahorró algo pero menos de 30%, rojo si no ahorró nada
        const colorAhorro = pctAhorro >= META_AHORRO_PCT ? 'verde' : pctAhorro > 0 ? 'amarillo' : 'rojo';
        const estadoA = ESTADOS_AHORRO[colorAhorro];

        if (saldoDisponible >= metaMonto) {
            // Cumplió la meta: mostramos la porción de la meta y el ahorro extra conseguido
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
            // Tiene ahorros pero aún no llega a la meta del 30%: mostramos lo que tiene y lo que le falta
            const faltante = metaMonto - saldoDisponible;
            labels = [`Ahorro actual: Bs. ${saldoDisponible.toFixed(2)}`, `Faltante para meta: Bs. ${faltante.toFixed(2)}`];
            data = [saldoDisponible, faltante];
            bgColors = ['#3b82f6', '#fcd34d'];
        } else {
            // No ahorró nada (gastó todo o quedó en saldo negativo)
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

// -----------------------------------------------------------------------------
// GRÁFICO 3: GASTOS POR CATEGORÍA (DONA) Y TABLA DE DETALLE
// -----------------------------------------------------------------------------
function renderCategoryChart(categorias, totalGastos) {
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
        categoryChartInstance = null;
    }

    // 1. Llenamos la tabla HTML con cada categoría, monto y porcentaje
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

    // 2. Dibujamos el gráfico circular tipo 'doughnut' (dona)
    const ctx = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctx) return;

    const labels = (categorias && categorias.length > 0)
        ? categorias.map(c => `${c.categoria} (Bs. ${parseFloat(c.total).toFixed(2)})`)
        : ['Sin gastos'];
    const data = (categorias && categorias.length > 0)
        ? categorias.map(c => parseFloat(c.total))
        : [1];
    // Paleta de colores atractiva para distinguir cada categoría
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

// =============================================================================
// 9. ENVÍO DE DATOS DESDE LOS FORMULARIOS AL SERVIDOR
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

        await fetch('/api/ingresos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Cierra la ventana flotante, limpia el formulario y actualiza los números en pantalla
        closeModal('modal-ingreso');
        document.getElementById('form-ingreso').reset();
        setDefaultDates();
        loadDashboard();
        loadIngresos();
    });

    // 2. Formulario para guardar un nuevo Gasto
    document.getElementById('form-gasto')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            categoria_id: document.getElementById('gasto-categoria').value,
            monto: document.getElementById('gasto-monto').value,
            fecha: document.getElementById('gasto-fecha').value,
            descripcion: document.getElementById('gasto-desc').value
        };

        await fetch('/api/gastos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        closeModal('modal-gasto');
        document.getElementById('form-gasto').reset();
        setDefaultDates();
        loadDashboard();
        loadGastos();
    });
}

// =============================================================================
// 10. PANEL DEL ADMINISTRADOR
// =============================================================================

let adminEstudiantes = []; // Lista en memoria con los estudiantes cargados

// Abre la pantalla del panel administrativo y le da la bienvenida al administrador
function showAdmin(admin) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'block';
    document.getElementById('admin-display').innerText = admin.nombre.split(' ')[0];

    const tab = tabInicial('admin-screen', 'tab-admin-estudiantes');
    activateTab(tab, { historial: 'replace' });
    if (tab === 'tab-admin-estudiantes') loadSeguridad();
}

// Conecta los eventos del panel de administración
function setupAdmin() {
    document.getElementById('admin-buscar')?.addEventListener('input', renderAdminEstudiantes);
    document.getElementById('form-estudiante')?.addEventListener('submit', guardarEstudiante);
    document.getElementById('btn-backup')?.addEventListener('click', descargarBackup);
    document.getElementById('form-admin-password')?.addEventListener('submit', cambiarPasswordAdmin);
}

// Da formato legible a las fechas para humanos (ejemplo: "18/10/2026, 17:30")
function formatFecha(valor) {
    return valor ? new Date(valor).toLocaleString() : '—';
}

// ---------- CRUD de estudiantes desde el panel de admin ----------

// Pide al servidor la lista completa de estudiantes
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

// Dibuja las tarjetas de los estudiantes y filtra en vivo cuando el admin escribe en el buscador
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

// Abre la ventanita para registrar un nuevo estudiante (si no se pasa id) o para editar uno existente (con id)
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

// Guarda los cambios del estudiante (crea nuevo o actualiza existente)
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

// Pide confirmación al administrador y elimina la cuenta del estudiante
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

// ---------- Monitoreo de seguridad y auditoría ----------

const NIVEL_SEGURIDAD = {
    ok: { color: 'verde', icono: 'fa-check-circle', texto: '🟢 Sistema seguro' },
    advertencia: { color: 'amarillo', icono: 'fa-exclamation-triangle', texto: '🟡 Requiere atención' },
    critico: { color: 'rojo', icono: 'fa-times-circle', texto: '🔴 Riesgo crítico' }
};

// Consulta el estado de seguridad y actualiza las métricas y eventos en el panel
async function loadSeguridad() {
    const res = await fetch('/api/admin/seguridad');
    if (!res.ok) return;
    const data = await res.json();
    const m = data.metricas;

    const nivel = NIVEL_SEGURIDAD[data.estado];
    const pendientes = data.controles.filter(c => c.nivel !== 'ok').length;
    setStatusStrip('admin-status-strip', nivel.color, nivel.texto,
        pendientes ? `${pendientes} control(es) con observaciones. Revisa la pestaña Seguridad.` : 'Todos los controles están en orden.');

    // Cajas de métricas numéricas
    document.getElementById('admin-metricas').innerHTML = [
        ['Estudiantes', m.estudiantes],
        ['Nuevos (7 días)', m.estudiantesNuevosSemana],
        ['Accesos OK (24 h)', m.loginsExitosos24h],
        ['Accesos fallidos (24 h)', m.loginsFallidos24h],
        ['Intentos bloqueados (24 h)', m.intentosBloqueados24h],
        ['Servidor activo', `${m.servidorActivoMin} min`]
    ].map(([titulo, valor]) => `<div class="metric-box"><span>${titulo}</span><strong>${valor}</strong></div>`).join('');

    // Lista de controles de seguridad
    document.getElementById('admin-controles').innerHTML = data.controles.map(c => `
        <div class="control-item nivel-${c.nivel}">
            <i class="fas ${NIVEL_SEGURIDAD[c.nivel].icono}"></i>
            <div><strong>${escapeHtml(c.titulo)}</strong><p>${escapeHtml(c.detalle)}</p></div>
        </div>
    `).join('');

    // Cuentas bloqueadas temporalmente
    const bloqueadasBox = document.getElementById('admin-bloqueadas-box');
    bloqueadasBox.style.display = data.bloqueadas.length ? 'block' : 'none';
    document.getElementById('admin-bloqueadas').innerHTML = data.bloqueadas.map(b => `
        <div class="control-item nivel-advertencia">
            <i class="fas fa-lock"></i>
            <div style="flex:1;"><strong>@${escapeHtml(b.usuario)}</strong><p>Bloqueada hasta ${formatFecha(b.hasta)}</p></div>
            <button class="btn btn-sm btn-primary" data-usuario="${escapeHtml(b.usuario)}" onclick="desbloquearCuenta(this.dataset.usuario)">Desbloquear</button>
        </div>
    `).join('');

    // Tabla con los últimos 50 eventos registrados en la bitácora
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

    // Información del último respaldo
    document.getElementById('backup-info').innerText = m.ultimoBackup
        ? `Último backup: ${formatFecha(m.ultimoBackup)}`
        : 'Todavía no se ha generado ningún backup.';
}

// Permite al administrador desbloquear de inmediato a un estudiante bloqueado
async function desbloquearCuenta(usuario) {
    await fetch(`/api/admin/bloqueos/${encodeURIComponent(usuario)}/desbloquear`, { method: 'POST' });
    loadSeguridad();
}

// ---------- Descarga de copias de seguridad (Backup) y cambio de contraseña ----------

// Descarga un archivo .sql con toda la base de datos
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

// Permite al administrador cambiar su contraseña desde su panel
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