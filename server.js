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

// RUTA GET /api/resumen -> Calcula Total Ingresos, Total Gastos y Saldo Disponible
// Puede recibir parámetros opcionales (?periodo=dia&fecha=... o ?periodo=semana... o ?periodo=mes...)
app.get('/api/resumen', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const filtroIng = construirFiltroFecha(req.query, 'fecha');
        const filtroGas = construirFiltroFecha(req.query, 'fecha');

        // Suma todos los ingresos del estudiante para el período solicitado
        const [ingresos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM ingresos WHERE estudiante_id = ?${filtroIng.sql}`, 
            [estudianteId, ...filtroIng.params]
        );
        // Suma todos los gastos del estudiante para el período solicitado
        const [gastos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE estudiante_id = ?${filtroGas.sql}`, 
            [estudianteId, ...filtroGas.params]
        );

        const totalIngresos = parseFloat(ingresos[0].total);
        const totalGastos = parseFloat(gastos[0].total);
        const saldoDisponible = totalIngresos - totalGastos; // Saldo = Ingresos - Gastos

        // Devolvemos los montos calculados
        res.json({
            totalIngresos,
            totalGastos,
            saldoDisponible,
            periodo: req.query.periodo || 'todo'
        });
    } catch (err) {
        console.error("❌ Error en resumen:", err.message);
        res.status(500).json({ error: 'Error al obtener el balance financiero' });
    }
});

// RUTA GET /api/reportes/categorias -> Devuelve los gastos agrupados por categoría
// (Alimentación, Transporte, Material escolar, etc.) respetando el filtro de fechas seleccionado
app.get('/api/reportes/categorias', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        // En esta consulta cruzamos categorías con gastos usando LEFT JOIN y filtramos por fecha en 'g.fecha'
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
        res.json(rows);
    } catch (err) {
        console.error("❌ Error en reporte de categorías:", err.message);
        res.status(500).json({ error: 'Error al obtener el reporte de categorías' });
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

// RUTA POST /api/gastos -> Guarda un nuevo gasto registrado por el estudiante
app.post('/api/gastos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const { categoria_id, monto, fecha, descripcion } = req.body;

    if (!categoria_id || !monto || !fecha) {
        return res.status(400).json({ error: 'Datos incompletos para registrar el gasto' });
    }

    try {
        await db.query(
            'INSERT INTO gastos (estudiante_id, categoria_id, monto, fecha, descripcion) VALUES (?, ?, ?, ?, ?)',
            [estudianteId, categoria_id, monto, fecha, descripcion || '']
        );
        res.json({ mensaje: 'Gasto guardado exitosamente' });
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
// 5. ENRUTAMIENTO DE PÁGINAS WEB (FRONTEND SPA)
// =============================================================================
// Como esta es una aplicación de una sola página (SPA), cualquier dirección que el usuario
// escriba directamente en el navegador (ejemplo: http://localhost:3000/reportes o /gastos)
// entregará el archivo principal 'index.html', y el JavaScript se encargará de mostrar la pestaña adecuada.
const RUTAS_PANTALLAS = [
    '/login', '/registro',
    '/inicio', '/ingresos', '/gastos', '/reportes',
    '/admin', '/admin/estudiantes', '/admin/seguridad', '/admin/backup'
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