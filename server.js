// =============================================================================
// ARCHIVO: server.js - Servidor Principal de la Aplicación (Backend Express)
// =============================================================================
// Este es el archivo central de todo el sistema. Aquí es donde se reciben todas
// las peticiones que hacen los usuarios desde sus celulares o computadoras:
// 1. Iniciar sesión y registrarse.
// 2. Guardar, consultar y borrar ingresos (mesadas, regalos, etc.).
// 3. Guardar, consultar y borrar gastos (comida, fotocopias, pasajes, etc.).
// 4. Calcular el resumen y los reportes con filtros por día, semana y mes.
// 5. Conectar con el panel de administración y entregar las páginas web al navegador.
// =============================================================================

// Librerías que utiliza el servidor:
const express = require('express');          // Crea el servidor web y gestiona las direcciones/rutas (URL)
const session = require('express-session');  // Administra sesiones: recuerda quién está conectado en cada dispositivo
const cors = require('cors');                // Permite conexiones seguras entre el navegador y el servidor
const path = require('path');                // Ayuda a manejar rutas de archivos y carpetas del sistema operativo
const db = require('./db');                  // Nuestra conexión permanente con la base de datos MySQL
const security = require('./security');      // Funciones de seguridad (cifrado, bloqueos, bitácora de accesos)
const adminRouter = require('./admin');      // Rutas exclusivas del panel de administrador
require('dotenv').config();                  // Carga variables del archivo '.env'

// Inicializamos la aplicación de Express
const app = express();
// Puerto de comunicación (usa el puerto definido en la configuración o el 3000 por defecto)
const PORT = process.env.PORT || 3000;

// =============================================================================
// CONFIGURACIÓN DE MIDDLEWARES (PROCESADORES DE PETICIONES)
// =============================================================================
app.use(cors());                                    // Habilita peticiones entre diferentes dominios si fuera necesario
app.use(express.json());                            // Permite que el servidor entienda datos enviados en formato JSON
app.use(express.urlencoded({ extended: true }));    // Permite que el servidor entienda datos de formularios web normales
app.use(express.static(path.join(__dirname, 'public'))); // Sirve directamente archivos públicos (imágenes, CSS, JS, etc.)

// =============================================================================
// GESTIÓN DE SESIONES DE USUARIO (RECUERDA QUIÉN HA INICIADO SESIÓN)
// =============================================================================
// Cuando un estudiante inicia sesión, el servidor crea una "tarjeta digital" (sesión)
// y le entrega al navegador una cookie encriptada. Así el usuario no tiene que
// escribir su contraseña cada vez que toca una pestaña o registra un gasto.
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_super_seguro_ue_2026', // Clave secreta para firmar las cookies
    resave: false,                                                        // No guarda la sesión si no hubo cambios
    saveUninitialized: false,                                             // No crea sesiones vacías sin autenticar
    cookie: { 
        httpOnly: true,                                                   // Protege la cookie para que ningún script malicioso la robe
        sameSite: 'lax',                                                  // Protege contra ataques de falsificación (CSRF)
        maxAge: 1000 * 60 * 60 * 24                                       // La sesión dura activa 24 horas continuas
    }
}));

// Este candado asegura que solo los estudiantes puedan ver o modificar sus propias finanzas
const requireAuth = security.requireEstudiante;

// Crea una sesión limpia cada vez que alguien inicia sesión (buena práctica de seguridad:
// previene el ataque conocido como "fijación de sesión").
function iniciarSesion(req, usuarioSesion) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(err => {
            if (err) return reject(err);
            req.session.user = usuarioSesion; // Guardamos en memoria los datos del usuario conectado
            resolve();
        });
    });
}

// =============================================================================
// 1. RUTAS DE AUTENTICACIÓN, REGISTRO Y CIERRE DE SESIÓN
// =============================================================================

// RUTA POST /api/login -> Inicia sesión tanto para estudiantes como para el administrador
app.post('/api/login', async (req, res) => {
    const usuario = (req.body.usuario || '').trim();
    const password = req.body.password || '';

    // Verificamos que no haya dejado casillas vacías
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Por favor ingresa usuario y contraseña' });
    }

    // Comprobamos si la cuenta está congelada por haberse equivocado más de 5 veces seguidas
    const minutos = security.minutosBloqueo(usuario);
    if (minutos > 0) {
        await security.registrarEvento(req, { evento: 'LOGIN_BLOQUEADO', usuario, exito: false });
        return res.status(429).json({ error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).` });
    }

    try {
        let cuenta = null;
        let rol = null;

        // 1. Buscamos primero si el usuario es un Administrador
        const [admins] = await db.query('SELECT * FROM administradores WHERE usuario = ?', [usuario]);
        if (admins.length > 0) {
            cuenta = admins[0];
            rol = 'admin';
        } else {
            // 2. Si no es admin, buscamos si es un Estudiante
            const [estudiantes] = await db.query('SELECT * FROM estudiantes WHERE usuario = ?', [usuario]);
            if (estudiantes.length > 0) {
                cuenta = estudiantes[0];
                rol = 'estudiante';
            }
        }

        // Si el usuario no existe O la contraseña escrita no coincide con la guardada:
        if (!cuenta || !(await security.verificarPassword(password, cuenta.password))) {
            const bloqueada = security.registrarFallo(usuario); // Registramos el error
            await security.registrarEvento(req, {
                evento: 'LOGIN_FALLIDO', rol, usuario, exito: false,
                detalle: bloqueada ? 'Cuenta bloqueada por exceso de intentos' : null
            });
            const mensaje = bloqueada
                ? `Demasiados intentos fallidos. La cuenta se bloqueó por 15 minutos.`
                : 'Usuario o contraseña incorrectos';
            return res.status(bloqueada ? 429 : 401).json({ error: mensaje });
        }

        // Si la contraseña fue correcta, limpiamos su historial de fallos
        security.limpiarFallos(usuario);

        // Si el estudiante tenía una contraseña antigua en texto plano, la ciframos automáticamente ahora
        if (rol === 'estudiante' && !security.esHashBcrypt(cuenta.password)) {
            const hash = await security.hashPassword(password);
            await db.query('UPDATE estudiantes SET password = ? WHERE id = ?', [hash, cuenta.id]);
        }

        // Preparamos los datos básicos del usuario para recordar su sesión
        const usuarioSesion = {
            id: cuenta.id,
            nombre: cuenta.nombre_completo,
            usuario: cuenta.usuario,
            curso: rol === 'estudiante' ? cuenta.curso : null,
            rol
        };

        // Activamos la sesión segura
        await iniciarSesion(req, usuarioSesion);

        // Anotamos en la bitácora que el inicio de sesión fue exitoso
        await security.registrarEvento(req, { evento: 'LOGIN_OK', rol, usuario: cuenta.usuario });

        return res.json({ mensaje: 'Acceso exitoso', usuario: usuarioSesion });

    } catch (err) {
        console.error("❌ Error en consulta de login:", err.message);
        return res.status(500).json({ error: 'Error interno al intentar iniciar sesión' });
    }
});

// RUTA POST /api/registro -> Permite a un estudiante nuevo crear su propia cuenta desde el login
app.post('/api/registro', async (req, res) => {
    const datos = {
        nombre_completo: (req.body.nombre_completo || '').trim(),
        usuario: (req.body.usuario || '').trim(),
        password: req.body.password || '',
        curso: (req.body.curso || '').trim()
    };

    // Validamos que los datos cumplan con las reglas (longitudes mínimas, caracteres válidos)
    const error = security.validarDatosEstudiante(datos, { passwordRequerida: true });
    if (error) return res.status(400).json({ error });

    try {
        // Comprobamos que el nombre de usuario esté libre
        if (!(await security.usuarioDisponible(datos.usuario))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso, por favor elige otro' });
        }

        // Ciframos la contraseña con bcrypt
        const hash = await security.hashPassword(datos.password);

        // Guardamos al nuevo estudiante en la base de datos
        const [resultado] = await db.query(
            'INSERT INTO estudiantes (nombre_completo, usuario, password, curso) VALUES (?, ?, ?, ?)',
            [datos.nombre_completo, datos.usuario, hash, datos.curso || null]
        );

        // Iniciamos sesión automáticamente para que ingrese directo a su panel
        const usuarioSesion = {
            id: resultado.insertId,
            nombre: datos.nombre_completo,
            usuario: datos.usuario,
            curso: datos.curso || null,
            rol: 'estudiante'
        };
        await iniciarSesion(req, usuarioSesion);
        await security.registrarEvento(req, { evento: 'REGISTRO', rol: 'estudiante', usuario: datos.usuario });

        res.json({ mensaje: 'Cuenta creada correctamente', usuario: usuarioSesion });
    } catch (err) {
        console.error("❌ Error en registro:", err.message);
        res.status(500).json({ error: 'Error al registrar la nueva cuenta' });
    }
});

// RUTA POST /api/logout -> Cierra la sesión activa y borra la cookie
app.post('/api/logout', async (req, res) => {
    if (req.session.user) {
        await security.registrarEvento(req, { evento: 'LOGOUT', rol: req.session.user.rol, usuario: req.session.user.usuario });
    }
    req.session.destroy(() => {
        res.json({ mensaje: 'Sesión finalizada correctamente' });
    });
});

// RUTA GET /api/session -> El navegador consulta si ya hay una sesión guardada al abrir la página
app.get('/api/session', (req, res) => {
    if (req.session.user && req.session.user.rol) {
        return res.json({ autenticado: true, usuario: req.session.user });
    }
    res.json({ autenticado: false });
});

// Conectamos todas las rutas que empiezan con '/api/admin' al archivo 'admin.js'
app.use('/api/admin', adminRouter);

// =============================================================================
// 2. DASHBOARD Y REPORTES FINANCIEROS (CON FILTROS POR DÍA, SEMANA Y MES)
// =============================================================================

// Esta función auxiliar construye dinámicamente las condiciones de fecha para MySQL
// según el período que el estudiante haya elegido en la pantalla de Reportes:
// - 'dia': Busca los registros de una fecha exacta (ej: 2026-10-18).
// - 'semana': Busca los registros entre el lunes y el domingo de la semana seleccionada.
// - 'mes': Busca los registros que pertenezcan al mes indicado (ej: 2026-10).
// - 'todo': No agrega ningún filtro de fecha para mostrar todo el histórico.
function construirFiltroFecha(query, campoFecha = 'fecha') {
    const { periodo, fecha, mes, semanaInicio, semanaFin } = query || {};
    let sql = '';
    let params = [];

    if (periodo === 'dia') {
        // Si no se envió fecha, se toma la fecha de hoy por defecto
        const diaTarget = fecha || new Date().toISOString().split('T')[0];
        sql = ` AND ${campoFecha} = ?`;
        params.push(diaTarget);
    } else if (periodo === 'semana') {
        let ini = semanaInicio;
        let fin = semanaFin;
        // Si no se pasaron inicio y fin, calculamos el lunes y domingo de la semana
        if (!ini || !fin) {
            const base = fecha ? new Date(fecha + 'T00:00:00') : new Date();
            const day = base.getDay();
            const diff = (day === 0 ? -6 : 1) - day;
            const mon = new Date(base);
            mon.setDate(base.getDate() + diff);
            const sun = new Date(mon);
            sun.setDate(mon.getDate() + 6);
            ini = mon.toISOString().split('T')[0];
            fin = sun.toISOString().split('T')[0];
        }
        sql = ` AND ${campoFecha} >= ? AND ${campoFecha} <= ?`;
        params.push(ini, fin);
    } else if (periodo === 'mes') {
        // Toma el mes en formato AAAA-MM (ej: '2026-10')
        const mesTarget = mes || (fecha ? fecha.substring(0, 7) : new Date().toISOString().substring(0, 7));
        sql = ` AND DATE_FORMAT(${campoFecha}, '%Y-%m') = ?`;
        params.push(mesTarget);
    }
    return { sql, params };
}

// Función auxiliar que calcula el saldo global disponible actual del estudiante
async function obtenerSaldoGlobal(estudianteId) {
    const [[ing]] = await db.query(
        'SELECT COALESCE(SUM(monto), 0) AS total FROM ingresos WHERE estudiante_id = ?',
        [estudianteId]
    );
    const [[gas]] = await db.query(
        'SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE estudiante_id = ?',
        [estudianteId]
    );
    const [[esc]] = await db.query(
        'SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_escolares WHERE estudiante_id = ?',
        [estudianteId]
    );
    const [[met]] = await db.query(
        'SELECT COALESCE(SUM(monto_ahorrado), 0) AS total FROM metas_ahorro WHERE estudiante_id = ? AND visible_panel = 1',
        [estudianteId]
    );
    const totalIngresos = parseFloat(ing.total);
    const totalGastosGenerales = parseFloat(gas.total);
    const totalGastosEscolares = parseFloat(esc.total);
    const totalGastos = totalGastosGenerales + totalGastosEscolares;
    const totalAhorradoMetas = parseFloat(met.total);
    const saldoDisponible = totalIngresos - totalGastos;
    return {
        totalIngresos,
        totalGastosGenerales,
        totalGastosEscolares,
        totalGastos,
        totalAhorradoMetas,
        saldoDisponible
    };
}

// RUTA GET /api/resumen -> Calcula Total Ingresos, Total Gastos (generales + escolares), Ahorro en Metas y Saldo Disponible
// Puede recibir parámetros opcionales (?periodo=dia&fecha=... o ?periodo=semana... o ?periodo=mes...)
app.get('/api/resumen', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const filtroIng = construirFiltroFecha(req.query, 'fecha');
        const filtroGas = construirFiltroFecha(req.query, 'fecha');
        const filtroEsc = construirFiltroFecha(req.query, 'fecha');

        // Suma todos los ingresos del estudiante para el período solicitado
        const [ingresos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM ingresos WHERE estudiante_id = ?${filtroIng.sql}`, 
            [estudianteId, ...filtroIng.params]
        );
        // Suma todos los gastos generales del estudiante para el período solicitado
        const [gastos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE estudiante_id = ?${filtroGas.sql}`, 
            [estudianteId, ...filtroGas.params]
        );
        // Suma todos los gastos del calendario escolar para el período solicitado
        const [gastosEsc] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_escolares WHERE estudiante_id = ?${filtroEsc.sql}`, 
            [estudianteId, ...filtroEsc.params]
        );
        // Suma el dinero puesto en metas de ahorro activas
        const [metasActivas] = await db.query(
            `SELECT COALESCE(SUM(monto_ahorrado), 0) AS total, COUNT(*) AS cantidad FROM metas_ahorro WHERE estudiante_id = ? AND visible_panel = 1`,
            [estudianteId]
        );

        const totalIngresos = parseFloat(ingresos[0].total);
        const totalGastosGenerales = parseFloat(gastos[0].total);
        const totalGastosEscolares = parseFloat(gastosEsc[0].total);
        const totalGastos = totalGastosGenerales + totalGastosEscolares;
        const totalAhorradoMetas = parseFloat(metasActivas[0].total);
        const saldoDisponible = totalIngresos - totalGastos; // Saldo = Ingresos - Gastos Totales

        // Devolvemos los montos calculados e indicador de saldo insuficiente
        res.json({
            totalIngresos,
            totalGastosGenerales,
            totalGastosEscolares,
            totalGastos,
            totalAhorradoMetas,
            cantidadMetasActivas: Number(metasActivas[0].cantidad || 0),
            saldoDisponible,
            saldoInsuficiente: saldoDisponible <= 0,
            periodo: req.query.periodo || 'todo'
        });
    } catch (err) {
        console.error("❌ Error en resumen:", err.message);
        res.status(500).json({ error: 'Error al obtener el balance financiero' });
    }
});

// RUTA GET /api/reportes/categorias -> Devuelve los gastos agrupados por categoría
// (Alimentación, Transporte, Material escolar, más Gastos del Calendario Escolar) respetando el filtro de fechas
app.get('/api/reportes/categorias', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const filtro = construirFiltroFecha(req.query, 'g.fecha');
        const query = `
            SELECT c.nombre AS categoria, COALESCE(SUM(g.monto), 0) AS total
            FROM categorias_gastos c
            LEFT JOIN gastos g ON g.categoria_id = c.id AND g.estudiante_id = ?${filtro.sql}
            GROUP BY c.id, c.nombre
            HAVING total > 0
            ORDER BY total DESC
        `;
        const [rows] = await db.query(query, [estudianteId, ...filtro.params]);

        // Incluimos también los gastos registrados en el Calendario Escolar dentro del período
        const filtroEsc = construirFiltroFecha(req.query, 'fecha');
        const [escRows] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_escolares WHERE estudiante_id = ?${filtroEsc.sql}`,
            [estudianteId, ...filtroEsc.params]
        );
        const totalEscolar = parseFloat(escRows[0]?.total || 0);
        if (totalEscolar > 0) {
            rows.push({
                categoria: 'Calendario Escolar (Colegio)',
                total: totalEscolar
            });
            rows.sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
        }

        res.json(rows);
    } catch (err) {
        console.error("❌ Error en reporte de categorías:", err.message);
        res.status(500).json({ error: 'Error al obtener el reporte de categorías' });
    }
});

// RUTA GET /api/reportes/mensual -> Devuelve toda la actividad del estudiante en un mes para imprimir el Reporte Mensual
app.get('/api/reportes/mensual', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const mesTarget = req.query.mes || new Date().toISOString().substring(0, 7);

    try {
        // 1. Ingresos del mes
        const [ingresos] = await db.query(
            `SELECT id, fuente, monto, fecha, descripcion
             FROM ingresos
             WHERE estudiante_id = ? AND DATE_FORMAT(fecha, '%Y-%m') = ?
             ORDER BY fecha ASC, id ASC`,
            [estudianteId, mesTarget]
        );

        // 2. Gastos generales del mes
        const [gastos] = await db.query(
            `SELECT g.id, g.monto, g.fecha, g.descripcion, c.nombre AS categoria
             FROM gastos g
             INNER JOIN categorias_gastos c ON g.categoria_id = c.id
             WHERE g.estudiante_id = ? AND DATE_FORMAT(g.fecha, '%Y-%m') = ?
             ORDER BY g.fecha ASC, g.id ASC`,
            [estudianteId, mesTarget]
        );

        // 3. Gastos del calendario escolar en el mes
        const [gastosEscolares] = await db.query(
            `SELECT id, tipo, monto, fecha, descripcion
             FROM gastos_escolares
             WHERE estudiante_id = ? AND DATE_FORMAT(fecha, '%Y-%m') = ?
             ORDER BY fecha ASC, id ASC`,
            [estudianteId, mesTarget]
        );

        // 4. Todas las metas de ahorro que tuvo o tiene el estudiante (historial completo para el reporte)
        const [metas] = await db.query(
            `SELECT id, titulo, categoria, monto_objetivo, monto_ahorrado, estado, visible_panel, fecha_creacion, fecha_completada
             FROM metas_ahorro
             WHERE estudiante_id = ?
             ORDER BY fecha_creacion DESC, id DESC`,
            [estudianteId]
        );

        // 5. Desglose por categorías en el mes
        const [categorias] = await db.query(
            `SELECT c.nombre AS categoria, COALESCE(SUM(g.monto), 0) AS total
             FROM categorias_gastos c
             LEFT JOIN gastos g ON g.categoria_id = c.id AND g.estudiante_id = ? AND DATE_FORMAT(g.fecha, '%Y-%m') = ?
             GROUP BY c.id, c.nombre
             HAVING total > 0
             ORDER BY total DESC`,
            [estudianteId, mesTarget]
        );

        const totalIngresosMes = ingresos.reduce((acc, i) => acc + parseFloat(i.monto), 0);
        const totalGastosGeneralesMes = gastos.reduce((acc, g) => acc + parseFloat(g.monto), 0);
        const totalGastosEscolaresMes = gastosEscolares.reduce((acc, ge) => acc + parseFloat(ge.monto), 0);
        const totalGastosMes = totalGastosGeneralesMes + totalGastosEscolaresMes;
        const saldoMes = totalIngresosMes - totalGastosMes;

        if (totalGastosEscolaresMes > 0) {
            categorias.push({ categoria: 'Calendario Escolar (Colegio)', total: totalGastosEscolaresMes });
            categorias.sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
        }

        const global = await obtenerSaldoGlobal(estudianteId);

        res.json({
            estudiante: req.session.user,
            mes: mesTarget,
            resumen: {
                totalIngresos: totalIngresosMes,
                totalGastosGenerales: totalGastosGeneralesMes,
                totalGastosEscolares: totalGastosEscolaresMes,
                totalGastos: totalGastosMes,
                saldoMes,
                saldoGeneral: global.saldoDisponible,
                totalAhorradoMetas: metas.reduce((acc, m) => acc + parseFloat(m.monto_ahorrado), 0),
                metasCompletadas: metas.filter(m => m.estado === 'completada').length,
                totalMetas: metas.length
            },
            ingresos,
            gastos,
            gastosEscolares,
            categorias,
            metas
        });
    } catch (err) {
        console.error("❌ Error en reporte mensual:", err.message);
        res.status(500).json({ error: 'Error al generar el reporte mensual completo' });
    }
});

// =============================================================================
// 3. MÓDULO DE INGRESOS (DINERO RECIBIDO: MESADAS, REGALOS, PREMIOS)
// =============================================================================

// RUTA GET /api/ingresos -> Lista todos los ingresos registrados por el estudiante actual
app.get('/api/ingresos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        // Traemos los ingresos ordenados desde el más reciente al más antiguo
        const [rows] = await db.query(
            'SELECT * FROM ingresos WHERE estudiante_id = ? ORDER BY fecha DESC, id DESC', 
            [estudianteId]
        );
        res.json(rows);
    } catch (err) {
        console.error("❌ Error al listar ingresos:", err.message);
        res.status(500).json({ error: 'Error al obtener la lista de ingresos' });
    }
});

// RUTA POST /api/ingresos -> Guarda un nuevo ingreso en la base de datos
app.post('/api/ingresos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const { fuente, monto, fecha, descripcion } = req.body;

    // Validación de campos obligatorios
    if (!fuente || !monto || !fecha) {
        return res.status(400).json({ error: 'Datos incompletos para registrar el ingreso' });
    }

    try {
        await db.query(
            'INSERT INTO ingresos (estudiante_id, fuente, monto, fecha, descripcion) VALUES (?, ?, ?, ?, ?)',
            [estudianteId, fuente, monto, fecha, descripcion || '']
        );
        res.json({ mensaje: 'Ingreso guardado exitosamente' });
    } catch (err) {
        console.error("❌ Error al guardar ingreso:", err.message);
        res.status(500).json({ error: 'Error al guardar el ingreso en el sistema' });
    }
});

// RUTA DELETE /api/ingresos/:id -> Elimina un ingreso específico
app.delete('/api/ingresos/:id', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        // El candado "AND estudiante_id = ?" asegura que un estudiante no pueda borrar ingresos de otro
        await db.query('DELETE FROM ingresos WHERE id = ? AND estudiante_id = ?', [req.params.id, estudianteId]);
        res.json({ mensaje: 'Ingreso eliminado' });
    } catch (err) {
        console.error("❌ Error al borrar ingreso:", err.message);
        res.status(500).json({ error: 'Error al eliminar el registro de ingreso' });
    }
});

// =============================================================================
// 4. MÓDULO DE GASTOS Y CATEGORÍAS (DINERO UTILIZADO)
// =============================================================================

// RUTA GET /api/categorias -> Lista de categorías disponibles para el selector desplegable
app.get('/api/categorias', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM categorias_gastos ORDER BY nombre ASC');
        res.json(rows);
    } catch (err) {
        console.error("❌ Error al listar categorías:", err.message);
        res.status(500).json({ error: 'Error al cargar las categorías' });
    }
});

// RUTA GET /api/gastos -> Lista todos los gastos del estudiante conectado
app.get('/api/gastos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const query = `
            SELECT g.id, g.monto, g.fecha, g.descripcion, c.nombre AS categoria, g.categoria_id
            FROM gastos g
            INNER JOIN categorias_gastos c ON g.categoria_id = c.id
            WHERE g.estudiante_id = ?
            ORDER BY g.fecha DESC, g.id DESC
        `;
        const [rows] = await db.query(query, [estudianteId]);
        res.json(rows);
    } catch (err) {
        console.error("❌ Error al listar gastos:", err.message);
        res.status(500).json({ error: 'Error al obtener la lista de gastos' });
    }
});

// RUTA POST /api/gastos -> Guarda un nuevo gasto registrado por el estudiante (con verificación de saldo insuficiente)
app.post('/api/gastos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const { categoria_id, monto, fecha, descripcion, forzar } = req.body;
    const montoNum = parseFloat(monto);

    if (!categoria_id || isNaN(montoNum) || montoNum <= 0 || !fecha) {
        return res.status(400).json({ error: 'Datos incompletos o monto inválido para registrar el gasto' });
    }

    try {
        const balance = await obtenerSaldoGlobal(estudianteId);
        // Si el gasto supera el saldo disponible y no fue confirmado explícitamente, devolvemos alerta de saldo insuficiente
        if (!forzar && montoNum > balance.saldoDisponible) {
            const faltante = montoNum - Math.max(balance.saldoDisponible, 0);
            return res.status(400).json({
                codigo: 'SALDO_INSUFICIENTE',
                error: `¡Saldo insuficiente! Tu saldo disponible es Bs. ${balance.saldoDisponible.toFixed(2)} y el gasto es de Bs. ${montoNum.toFixed(2)} (te faltan Bs. ${faltante.toFixed(2)}).`,
                saldoDisponible: balance.saldoDisponible,
                montoSolicitado: montoNum,
                faltante
            });
        }

        await db.query(
            'INSERT INTO gastos (estudiante_id, categoria_id, monto, fecha, descripcion) VALUES (?, ?, ?, ?, ?)',
            [estudianteId, categoria_id, montoNum, fecha, descripcion || '']
        );
        const nuevoSaldo = balance.saldoDisponible - montoNum;
        res.json({
            mensaje: 'Gasto guardado exitosamente',
            saldoDisponible: nuevoSaldo,
            saldoInsuficiente: nuevoSaldo <= 0
        });
    } catch (err) {
        console.error("❌ Error al registrar gasto:", err.message);
        res.status(500).json({ error: 'Error al guardar el gasto' });
    }
});

// RUTA DELETE /api/gastos/:id -> Elimina un gasto específico del estudiante
app.delete('/api/gastos/:id', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        await db.query('DELETE FROM gastos WHERE id = ? AND estudiante_id = ?', [req.params.id, estudianteId]);
        res.json({ mensaje: 'Gasto eliminado' });
    } catch (err) {
        console.error("❌ Error al borrar gasto:", err.message);
        res.status(500).json({ error: 'Error al eliminar el gasto' });
    }
});

// =============================================================================
// 5. MÓDULO DE METAS DE AHORRO PERSONAL E HISTORIAL DE METAS DEL ESTUDIANTE
// =============================================================================

// RUTA GET /api/metas -> Devuelve las metas activas del panel y el historial de todas las metas del estudiante
app.get('/api/metas', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const [todas] = await db.query(
            `SELECT * FROM metas_ahorro
             WHERE estudiante_id = ?
             ORDER BY visible_panel DESC, estado ASC, fecha_creacion DESC, id DESC`,
            [estudianteId]
        );
        const activas = todas.filter(m => Number(m.visible_panel) === 1);
        res.json({
            activas,
            historial: todas,
            resumen: {
                totalMetas: todas.length,
                metasActivas: activas.length,
                metasCompletadas: todas.filter(m => m.estado === 'completada').length,
                totalAhorradoActivo: activas.reduce((acc, m) => acc + parseFloat(m.monto_ahorrado), 0),
                totalAhorradoHistorico: todas.reduce((acc, m) => acc + parseFloat(m.monto_ahorrado), 0)
            }
        });
    } catch (err) {
        console.error("❌ Error al listar metas:", err.message);
        res.status(500).json({ error: 'Error al obtener las metas de ahorro' });
    }
});

// RUTA POST /api/metas -> Crea una nueva meta de ahorro personal para el estudiante
app.post('/api/metas', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const titulo = (req.body.titulo || '').trim();
    const categoria = (req.body.categoria || 'Personal').trim();
    const montoObjetivo = parseFloat(req.body.monto_objetivo);
    const montoInicial = parseFloat(req.body.monto_ahorrado || 0);
    const fechaCreacion = req.body.fecha_creacion || new Date().toISOString().split('T')[0];
    const forzar = Boolean(req.body.forzar);

    if (!titulo || isNaN(montoObjetivo) || montoObjetivo <= 0) {
        return res.status(400).json({ error: 'Debes indicar qué quieres comprarte y el monto de tu meta' });
    }
    if (isNaN(montoInicial) || montoInicial < 0) {
        return res.status(400).json({ error: 'El monto inicial ahorrado no puede ser negativo' });
    }

    try {
        if (montoInicial > 0 && !forzar) {
            const balance = await obtenerSaldoGlobal(estudianteId);
            if (montoInicial > balance.saldoDisponible) {
                const faltante = montoInicial - Math.max(balance.saldoDisponible, 0);
                return res.status(400).json({
                    codigo: 'SALDO_INSUFICIENTE',
                    error: `¡Saldo insuficiente! Quieres poner Bs. ${montoInicial.toFixed(2)} en tu meta, pero tu saldo disponible actual es Bs. ${balance.saldoDisponible.toFixed(2)} (te faltan Bs. ${faltante.toFixed(2)}).`,
                    saldoDisponible: balance.saldoDisponible,
                    montoSolicitado: montoInicial,
                    faltante
                });
            }
        }

        const completada = montoInicial >= montoObjetivo;
        const estado = completada ? 'completada' : 'en_progreso';
        const fechaCompletada = completada ? new Date() : null;

        await db.query(
            `INSERT INTO metas_ahorro (estudiante_id, titulo, categoria, monto_objetivo, monto_ahorrado, estado, visible_panel, fecha_creacion, fecha_completada)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [estudianteId, titulo, categoria, montoObjetivo, montoInicial, estado, fechaCreacion, fechaCompletada]
        );

        res.json({ mensaje: completada ? '¡Meta creada y completada!' : 'Meta de ahorro creada exitosamente', completada });
    } catch (err) {
        console.error("❌ Error al crear meta:", err.message);
        res.status(500).json({ error: 'Error al guardar la meta de ahorro' });
    }
});

// RUTA POST /api/metas/:id/abonar -> Pone/agrega más dinero a una meta de ahorro existente
app.post('/api/metas/:id/abonar', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const metaId = req.params.id;
    const montoAbono = parseFloat(req.body.monto);
    const forzar = Boolean(req.body.forzar);

    if (isNaN(montoAbono) || montoAbono <= 0) {
        return res.status(400).json({ error: 'Ingresa un monto válido mayor a Bs. 0.00' });
    }

    try {
        const [metas] = await db.query('SELECT * FROM metas_ahorro WHERE id = ? AND estudiante_id = ?', [metaId, estudianteId]);
        if (metas.length === 0) {
            return res.status(404).json({ error: 'Meta de ahorro no encontrada' });
        }

        if (!forzar) {
            const balance = await obtenerSaldoGlobal(estudianteId);
            if (montoAbono > balance.saldoDisponible) {
                const faltante = montoAbono - Math.max(balance.saldoDisponible, 0);
                return res.status(400).json({
                    codigo: 'SALDO_INSUFICIENTE',
                    error: `¡Saldo insuficiente! Intentas abonar Bs. ${montoAbono.toFixed(2)} a tu meta, pero tu saldo disponible es Bs. ${balance.saldoDisponible.toFixed(2)} (te faltan Bs. ${faltante.toFixed(2)}).`,
                    saldoDisponible: balance.saldoDisponible,
                    montoSolicitado: montoAbono,
                    faltante
                });
            }
        }

        const meta = metas[0];
        const nuevoAhorrado = parseFloat(meta.monto_ahorrado) + montoAbono;
        const objetivo = parseFloat(meta.monto_objetivo);
        const completada = nuevoAhorrado >= objetivo;
        const nuevoEstado = completada ? 'completada' : 'en_progreso';
        const fechaCompletada = completada ? (meta.fecha_completada || new Date()) : null;

        await db.query(
            'UPDATE metas_ahorro SET monto_ahorrado = ?, estado = ?, fecha_completada = ? WHERE id = ? AND estudiante_id = ?',
            [nuevoAhorrado, nuevoEstado, fechaCompletada, metaId, estudianteId]
        );

        res.json({
            mensaje: completada ? '🎉 ¡Felicidades! Has completado tu meta de ahorro. Ya puedes borrarla del panel activo cuando quieras.' : 'Abono registrado en tu meta',
            completada,
            montoAhorrado: nuevoAhorrado
        });
    } catch (err) {
        console.error("❌ Error al abonar a meta:", err.message);
        res.status(500).json({ error: 'Error al registrar el abono en la meta' });
    }
});

// RUTA PUT /api/metas/:id/completar -> Marca manualmente una meta como completada
app.put('/api/metas/:id/completar', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const metaId = req.params.id;
    try {
        const [metas] = await db.query('SELECT * FROM metas_ahorro WHERE id = ? AND estudiante_id = ?', [metaId, estudianteId]);
        if (metas.length === 0) return res.status(404).json({ error: 'Meta no encontrada' });

        const meta = metas[0];
        const montoFinal = Math.max(parseFloat(meta.monto_ahorrado), parseFloat(meta.monto_objetivo));

        await db.query(
            "UPDATE metas_ahorro SET monto_ahorrado = ?, estado = 'completada', fecha_completada = COALESCE(fecha_completada, NOW()) WHERE id = ? AND estudiante_id = ?",
            [montoFinal, metaId, estudianteId]
        );
        res.json({ mensaje: '¡Meta marcada como completada!' });
    } catch (err) {
        console.error("❌ Error al completar meta:", err.message);
        res.status(500).json({ error: 'Error al completar la meta' });
    }
});

// RUTA DELETE /api/metas/:id -> Borra la meta del panel activo (manteniéndola en el historial para el reporte mensual)
// o la elimina definitivamente si se envía ?definitivo=1
app.delete('/api/metas/:id', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const metaId = req.params.id;
    const definitivo = req.query.definitivo === '1';

    try {
        if (definitivo) {
            await db.query('DELETE FROM metas_ahorro WHERE id = ? AND estudiante_id = ?', [metaId, estudianteId]);
            return res.json({ mensaje: 'Meta eliminada definitivamente del historial' });
        } else {
            // Al borrarla del panel de metas activas, la ocultamos del panel activo pero la conservamos en el historial de todas las metas para el reporte mensual
            await db.query(
                'UPDATE metas_ahorro SET visible_panel = 0 WHERE id = ? AND estudiante_id = ?',
                [metaId, estudianteId]
            );
            return res.json({ mensaje: 'Meta retirada de tus metas activas (guardada en tu historial de metas para el reporte mensual)' });
        }
    } catch (err) {
        console.error("❌ Error al borrar meta:", err.message);
        res.status(500).json({ error: 'Error al borrar la meta de ahorro' });
    }
});

// =============================================================================
// 6. MÓDULO DE CALENDARIO ESCOLAR (GASTOS EXCLUSIVOS EN EL COLEGIO)
// =============================================================================

// RUTA GET /api/calendario-escolar -> Obtiene los gastos del colegio del mes seleccionado y su resumen por tipo para gráficos
app.get('/api/calendario-escolar', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const mes = req.query.mes; // Formato opcional 'YYYY-MM'
    try {
        let sql = 'SELECT * FROM gastos_escolares WHERE estudiante_id = ?';
        const params = [estudianteId];

        if (mes) {
            sql += " AND DATE_FORMAT(fecha, '%Y-%m') = ?";
            params.push(mes);
        }
        sql += ' ORDER BY fecha DESC, id DESC';

        const [gastos] = await db.query(sql, params);

        // Agrupamos por tipo para el gráfico animado del calendario escolar
        const mapaTipos = {};
        let totalMes = 0;
        for (const g of gastos) {
            const m = parseFloat(g.monto);
            totalMes += m;
            mapaTipos[g.tipo] = (mapaTipos[g.tipo] || 0) + m;
        }
        const porTipo = Object.entries(mapaTipos)
            .map(([tipo, total]) => ({ tipo, total }))
            .sort((a, b) => b.total - a.total);

        res.json({
            gastos,
            porTipo,
            totalMes
        });
    } catch (err) {
        console.error("❌ Error al consultar calendario escolar:", err.message);
        res.status(500).json({ error: 'Error al cargar los gastos del calendario escolar' });
    }
});

// RUTA POST /api/calendario-escolar -> Registra un gasto exclusivo del colegio en una fecha del calendario
app.post('/api/calendario-escolar', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const tipo = (req.body.tipo || '').trim();
    const montoNum = parseFloat(req.body.monto);
    const fecha = req.body.fecha;
    const descripcion = (req.body.descripcion || '').trim();
    const forzar = Boolean(req.body.forzar);

    if (!tipo || isNaN(montoNum) || montoNum <= 0 || !fecha) {
        return res.status(400).json({ error: 'Completa el tipo de gasto escolar, monto y fecha' });
    }

    try {
        const balance = await obtenerSaldoGlobal(estudianteId);
        if (!forzar && montoNum > balance.saldoDisponible) {
            const faltante = montoNum - Math.max(balance.saldoDisponible, 0);
            return res.status(400).json({
                codigo: 'SALDO_INSUFICIENTE',
                error: `¡Saldo insuficiente! Tu saldo disponible es Bs. ${balance.saldoDisponible.toFixed(2)} y este gasto escolar (${tipo}) es de Bs. ${montoNum.toFixed(2)} (te faltan Bs. ${faltante.toFixed(2)}).`,
                saldoDisponible: balance.saldoDisponible,
                montoSolicitado: montoNum,
                faltante
            });
        }

        await db.query(
            'INSERT INTO gastos_escolares (estudiante_id, tipo, monto, fecha, descripcion) VALUES (?, ?, ?, ?, ?)',
            [estudianteId, tipo, montoNum, fecha, descripcion]
        );

        const nuevoSaldo = balance.saldoDisponible - montoNum;
        res.json({
            mensaje: 'Gasto escolar anotado en el calendario',
            saldoDisponible: nuevoSaldo,
            saldoInsuficiente: nuevoSaldo <= 0
        });
    } catch (err) {
        console.error("❌ Error al guardar gasto escolar:", err.message);
        res.status(500).json({ error: 'Error al guardar el gasto en el calendario escolar' });
    }
});

// RUTA DELETE /api/calendario-escolar/:id -> Elimina un gasto del calendario escolar
app.delete('/api/calendario-escolar/:id', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        await db.query('DELETE FROM gastos_escolares WHERE id = ? AND estudiante_id = ?', [req.params.id, estudianteId]);
        res.json({ mensaje: 'Gasto escolar eliminado del calendario' });
    } catch (err) {
        console.error("❌ Error al eliminar gasto escolar:", err.message);
        res.status(500).json({ error: 'Error al eliminar el gasto escolar' });
    }
});

// =============================================================================
// 7. ENRUTAMIENTO DE PÁGINAS WEB (FRONTEND SPA)
// =============================================================================
// Como esta es una aplicación de una sola página (SPA), cualquier dirección que el usuario
// escriba directamente en el navegador (ejemplo: http://localhost:3000/reportes o /gastos)
// entregará el archivo principal 'index.html', y el JavaScript se encargará de mostrar la pestaña adecuada.
const RUTAS_PANTALLAS = [
    '/login', '/registro',
    '/inicio', '/ingresos', '/gastos', '/calendario', '/reportes',
    '/admin', '/admin/estudiantes', '/admin/seguridad', '/admin/backup', '/admin/password'
];
app.get(RUTAS_PANTALLAS, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// 6. INICIO DEL SERVIDOR
// =============================================================================
// Antes de abrir el servidor al público, ejecutamos 'initSecuritySchema()' para
// asegurar que las tablas de administradores y bitácora estén listas en MySQL.
security.initSecuritySchema()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`===============================================`);
            console.log(`🚀 SERVIDOR FINANZGAGNON INICIADO EN EL PUERTO: ${PORT}`);
            console.log(`🔗 Abre en tu navegador: http://localhost:${PORT}`);
            console.log(`===============================================`);
        });
    })
    .catch(err => {
        console.error('❌ No se pudo preparar el esquema de seguridad:', err.message);
        process.exit(1);
    });