const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const security = require('./security');
const adminRouter = require('./admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Manejo de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_super_seguro_ue_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 // Sesión activa por 24 horas
    }
}));

// Solo los estudiantes acceden a sus finanzas; el administrador no
const requireAuth = security.requireEstudiante;

// Crea una sesión nueva (evita reutilizar el identificador previo al login)
function iniciarSesion(req, usuarioSesion) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(err => {
            if (err) return reject(err);
            req.session.user = usuarioSesion;
            resolve();
        });
    });
}

// ==========================================
// 1. RUTAS DE AUTENTICACIÓN, REGISTRO Y SESIÓN
// ==========================================

// Inicio de sesión para administradores y estudiantes
app.post('/api/login', async (req, res) => {
    const usuario = (req.body.usuario || '').trim();
    const password = req.body.password || '';

    if (!usuario || !password) {
        return res.status(400).json({ error: 'Por favor ingresa usuario y contraseña' });
    }

    const minutos = security.minutosBloqueo(usuario);
    if (minutos > 0) {
        await security.registrarEvento(req, { evento: 'LOGIN_BLOQUEADO', usuario, exito: false });
        return res.status(429).json({ error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).` });
    }

    try {
        let cuenta = null;
        let rol = null;

        const [admins] = await db.query('SELECT * FROM administradores WHERE usuario = ?', [usuario]);
        if (admins.length > 0) {
            cuenta = admins[0];
            rol = 'admin';
        } else {
            const [estudiantes] = await db.query('SELECT * FROM estudiantes WHERE usuario = ?', [usuario]);
            if (estudiantes.length > 0) {
                cuenta = estudiantes[0];
                rol = 'estudiante';
            }
        }

        if (!cuenta || !(await security.verificarPassword(password, cuenta.password))) {
            const bloqueada = security.registrarFallo(usuario);
            await security.registrarEvento(req, {
                evento: 'LOGIN_FALLIDO', rol, usuario, exito: false,
                detalle: bloqueada ? 'Cuenta bloqueada por exceso de intentos' : null
            });
            const mensaje = bloqueada
                ? `Demasiados intentos fallidos. La cuenta se bloqueó por 15 minutos.`
                : 'Usuario o contraseña incorrectos';
            return res.status(bloqueada ? 429 : 401).json({ error: mensaje });
        }

        security.limpiarFallos(usuario);

        // Cifra las contraseñas antiguas guardadas en texto plano
        if (rol === 'estudiante' && !security.esHashBcrypt(cuenta.password)) {
            const hash = await security.hashPassword(password);
            await db.query('UPDATE estudiantes SET password = ? WHERE id = ?', [hash, cuenta.id]);
        }

        const usuarioSesion = {
            id: cuenta.id,
            nombre: cuenta.nombre_completo,
            usuario: cuenta.usuario,
            curso: rol === 'estudiante' ? cuenta.curso : null,
            rol
        };
        await iniciarSesion(req, usuarioSesion);
        await security.registrarEvento(req, { evento: 'LOGIN_OK', rol, usuario: cuenta.usuario });

        return res.json({ mensaje: 'Acceso exitoso', usuario: usuarioSesion });

    } catch (err) {
        console.error("❌ Error en consulta de login:", err.message);
        return res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// Registro público de estudiantes desde la pantalla de login
app.post('/api/registro', async (req, res) => {
    const datos = {
        nombre_completo: (req.body.nombre_completo || '').trim(),
        usuario: (req.body.usuario || '').trim(),
        password: req.body.password || '',
        curso: (req.body.curso || '').trim()
    };

    const error = security.validarDatosEstudiante(datos, { passwordRequerida: true });
    if (error) return res.status(400).json({ error });

    try {
        if (!(await security.usuarioDisponible(datos.usuario))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso, elige otro' });
        }

        const hash = await security.hashPassword(datos.password);
        const [resultado] = await db.query(
            'INSERT INTO estudiantes (nombre_completo, usuario, password, curso) VALUES (?, ?, ?, ?)',
            [datos.nombre_completo, datos.usuario, hash, datos.curso || null]
        );

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
        res.status(500).json({ error: 'Error al crear la cuenta' });
    }
});

// Cerrar sesión
app.post('/api/logout', async (req, res) => {
    if (req.session.user) {
        await security.registrarEvento(req, { evento: 'LOGOUT', rol: req.session.user.rol, usuario: req.session.user.usuario });
    }
    req.session.destroy(() => {
        res.json({ mensaje: 'Sesión finalizada correctamente' });
    });
});

// Comprobar estado de la sesión activa
app.get('/api/session', (req, res) => {
    if (req.session.user && req.session.user.rol) {
        return res.json({ autenticado: true, usuario: req.session.user });
    }
    res.json({ autenticado: false });
});

// Panel del administrador: cuentas, seguridad y backups
app.use('/api/admin', adminRouter);

// ==========================================
// 2. DASHBOARD Y REPORTES
// ==========================================

// Helper para construir cláusulas SQL de filtro por día, semana o mes
function construirFiltroFecha(query, campoFecha = 'fecha') {
    const { periodo, fecha, mes, semanaInicio, semanaFin } = query || {};
    let sql = '';
    let params = [];

    if (periodo === 'dia') {
        const diaTarget = fecha || new Date().toISOString().split('T')[0];
        sql = ` AND ${campoFecha} = ?`;
        params.push(diaTarget);
    } else if (periodo === 'semana') {
        let ini = semanaInicio;
        let fin = semanaFin;
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
        const mesTarget = mes || (fecha ? fecha.substring(0, 7) : new Date().toISOString().substring(0, 7));
        sql = ` AND DATE_FORMAT(${campoFecha}, '%Y-%m') = ?`;
        params.push(mesTarget);
    }
    return { sql, params };
}

// Resumen de saldos (Ingresos, Gastos y Saldo Disponible) con soporte de filtros
app.get('/api/resumen', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const filtroIng = construirFiltroFecha(req.query, 'fecha');
        const filtroGas = construirFiltroFecha(req.query, 'fecha');

        const [ingresos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM ingresos WHERE estudiante_id = ?${filtroIng.sql}`, 
            [estudianteId, ...filtroIng.params]
        );
        const [gastos] = await db.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE estudiante_id = ?${filtroGas.sql}`, 
            [estudianteId, ...filtroGas.params]
        );

        const totalIngresos = parseFloat(ingresos[0].total);
        const totalGastos = parseFloat(gastos[0].total);
        const saldoDisponible = totalIngresos - totalGastos;

        res.json({
            totalIngresos,
            totalGastos,
            saldoDisponible,
            periodo: req.query.periodo || 'todo'
        });
    } catch (err) {
        console.error("❌ Error en resumen:", err.message);
        res.status(500).json({ error: 'Error al obtener el balance' });
    }
});

// Reporte de gastos clasificados por categoría con soporte de filtros
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
        res.json(rows);
    } catch (err) {
        console.error("❌ Error en reporte de categorías:", err.message);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

// ==========================================
// 3. MÓDULO DE INGRESOS
// ==========================================

app.get('/api/ingresos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        const [rows] = await db.query(
            'SELECT * FROM ingresos WHERE estudiante_id = ? ORDER BY fecha DESC, id DESC', 
            [estudianteId]
        );
        res.json(rows);
    } catch (err) {
        console.error("❌ Error al listar ingresos:", err.message);
        res.status(500).json({ error: 'Error al obtener ingresos' });
    }
});

app.post('/api/ingresos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const { fuente, monto, fecha, descripcion } = req.body;

    if (!fuente || !monto || !fecha) {
        return res.status(400).json({ error: 'Datos incompletos para el ingreso' });
    }

    try {
        await db.query(
            'INSERT INTO ingresos (estudiante_id, fuente, monto, fecha, descripcion) VALUES (?, ?, ?, ?, ?)',
            [estudianteId, fuente, monto, fecha, descripcion || '']
        );
        res.json({ mensaje: 'Ingreso guardado exitosamente' });
    } catch (err) {
        console.error("❌ Error al guardar ingreso:", err.message);
        res.status(500).json({ error: 'Error al guardar el ingreso' });
    }
});

app.delete('/api/ingresos/:id', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    try {
        await db.query('DELETE FROM ingresos WHERE id = ? AND estudiante_id = ?', [req.params.id, estudianteId]);
        res.json({ mensaje: 'Ingreso eliminado' });
    } catch (err) {
        console.error("❌ Error al borrar ingreso:", err.message);
        res.status(500).json({ error: 'Error al eliminar el registro' });
    }
});

// ==========================================
// 4. MÓDULO DE GASTOS Y CATEGORÍAS
// ==========================================

// Lista de categorías para el selector
app.get('/api/categorias', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM categorias_gastos ORDER BY nombre ASC');
        res.json(rows);
    } catch (err) {
        console.error("❌ Error al listar categorías:", err.message);
        res.status(500).json({ error: 'Error al cargar categorías' });
    }
});

// Lista de gastos del estudiante
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
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
});

// Guardar nuevo gasto
app.post('/api/gastos', requireAuth, async (req, res) => {
    const estudianteId = req.session.user.id;
    const { categoria_id, monto, fecha, descripcion } = req.body;

    if (!categoria_id || !monto || !fecha) {
        return res.status(400).json({ error: 'Datos incompletos para el gasto' });
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

// Eliminar un gasto
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

// ==========================================
// 5. DIRECCIONES DE LAS PANTALLAS (FRONTEND)
// ==========================================

// Cada módulo tiene su URL (ej. /gastos); todas cargan la misma página y el frontend muestra el módulo
const RUTAS_PANTALLAS = [
    '/login', '/registro',
    '/inicio', '/ingresos', '/gastos', '/reportes',
    '/admin', '/admin/estudiantes', '/admin/seguridad', '/admin/backup'
];
app.get(RUTAS_PANTALLAS, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 6. INICIO DEL SERVIDOR
// ==========================================
security.initSecuritySchema()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`===============================================`);
            console.log(`🚀 SERVIDOR INICIADO EN EL PUERTO: ${PORT}`);
            console.log(`🔗 Abre en tu navegador: http://localhost:${PORT}`);
            console.log(`===============================================`);
        });
    })
    .catch(err => {
        console.error('❌ No se pudo preparar el esquema de seguridad:', err.message);
        process.exit(1);
    });