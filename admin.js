const express = require('express');
const db = require('./db');
const security = require('./security');

const router = express.Router();
router.use(security.requireAdmin);

function validarId(req, res, next) {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Identificador inválido' });
    }
    next();
}

// ==========================================
// 1. CRUD DE CUENTAS DE ESTUDIANTES
// ==========================================

router.get('/estudiantes', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT e.id, e.nombre_completo, e.usuario, e.curso, e.fecha_registro,
                   (SELECT COUNT(*) FROM ingresos i WHERE i.estudiante_id = e.id) AS total_ingresos,
                   (SELECT COUNT(*) FROM gastos g WHERE g.estudiante_id = e.id) AS total_gastos
            FROM estudiantes e
            ORDER BY e.nombre_completo ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error al listar estudiantes:', err.message);
        res.status(500).json({ error: 'Error al obtener los estudiantes' });
    }
});

router.post('/estudiantes', async (req, res) => {
    const datos = limpiarDatos(req.body);
    const error = security.validarDatosEstudiante(datos, { passwordRequerida: true });
    if (error) return res.status(400).json({ error });

    try {
        if (!(await security.usuarioDisponible(datos.usuario))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
        }
        const hash = await security.hashPassword(datos.password);
        await db.query(
            'INSERT INTO estudiantes (nombre_completo, usuario, password, curso) VALUES (?, ?, ?, ?)',
            [datos.nombre_completo, datos.usuario, hash, datos.curso || null]
        );
        await security.registrarEvento(req, {
            evento: 'ADMIN_CREAR_ESTUDIANTE', rol: 'admin', usuario: req.session.user.usuario,
            detalle: `Cuenta creada: ${datos.usuario}`
        });
        res.json({ mensaje: 'Estudiante registrado correctamente' });
    } catch (err) {
        console.error('❌ Error al crear estudiante:', err.message);
        res.status(500).json({ error: 'Error al registrar el estudiante' });
    }
});

router.put('/estudiantes/:id', validarId, async (req, res) => {
    const id = Number(req.params.id);
    const datos = limpiarDatos(req.body);
    const error = security.validarDatosEstudiante(datos, { passwordRequerida: false });
    if (error) return res.status(400).json({ error });

    try {
        const [existe] = await db.query('SELECT usuario FROM estudiantes WHERE id = ?', [id]);
        if (existe.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }
        if (!(await security.usuarioDisponible(datos.usuario, id))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
        }

        if (datos.password) {
            const hash = await security.hashPassword(datos.password);
            await db.query(
                'UPDATE estudiantes SET nombre_completo = ?, usuario = ?, curso = ?, password = ? WHERE id = ?',
                [datos.nombre_completo, datos.usuario, datos.curso || null, hash, id]
            );
        } else {
            await db.query(
                'UPDATE estudiantes SET nombre_completo = ?, usuario = ?, curso = ? WHERE id = ?',
                [datos.nombre_completo, datos.usuario, datos.curso || null, id]
            );
        }

        await security.registrarEvento(req, {
            evento: 'ADMIN_EDITAR_ESTUDIANTE', rol: 'admin', usuario: req.session.user.usuario,
            detalle: `Cuenta editada: ${existe[0].usuario}${datos.password ? ' (contraseña restablecida)' : ''}`
        });
        res.json({ mensaje: 'Estudiante actualizado correctamente' });
    } catch (err) {
        console.error('❌ Error al editar estudiante:', err.message);
        res.status(500).json({ error: 'Error al actualizar el estudiante' });
    }
});

// Los ingresos y gastos del estudiante se eliminan en cascada
router.delete('/estudiantes/:id', validarId, async (req, res) => {
    const id = Number(req.params.id);
    try {
        const [existe] = await db.query('SELECT usuario FROM estudiantes WHERE id = ?', [id]);
        if (existe.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }
        await db.query('DELETE FROM estudiantes WHERE id = ?', [id]);
        await security.registrarEvento(req, {
            evento: 'ADMIN_ELIMINAR_ESTUDIANTE', rol: 'admin', usuario: req.session.user.usuario,
            detalle: `Cuenta eliminada: ${existe[0].usuario}`
        });
        res.json({ mensaje: 'Estudiante eliminado' });
    } catch (err) {
        console.error('❌ Error al eliminar estudiante:', err.message);
        res.status(500).json({ error: 'Error al eliminar el estudiante' });
    }
});

function limpiarDatos(body) {
    return {
        nombre_completo: (body.nombre_completo || '').trim(),
        usuario: (body.usuario || '').trim(),
        password: body.password || '',
        curso: (body.curso || '').trim()
    };
}

// ==========================================
// 2. MONITOREO DEL ESTADO DE SEGURIDAD
// ==========================================

const NIVELES = { ok: 0, advertencia: 1, critico: 2 };
const SECRETOS_DEBILES = ['secreto_super_seguro_ue_2026', 'Root123', 'secret', '123456'];

router.get('/seguridad', async (req, res) => {
    try {
        const [[estudiantes]] = await db.query(`
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(password NOT LIKE '$2%'), 0) AS sin_cifrar,
                   COALESCE(SUM(fecha_registro >= NOW() - INTERVAL 7 DAY), 0) AS nuevos_semana
            FROM estudiantes
        `);
        const [admins] = await db.query('SELECT usuario, password FROM administradores');
        const [[accesos]] = await db.query(`
            SELECT COALESCE(SUM(evento = 'LOGIN_OK'), 0) AS exitosos,
                   COALESCE(SUM(evento = 'LOGIN_FALLIDO'), 0) AS fallidos,
                   COALESCE(SUM(evento = 'LOGIN_BLOQUEADO'), 0) AS bloqueados
            FROM bitacora_seguridad
            WHERE fecha >= NOW() - INTERVAL 1 DAY
        `);
        const [[backup]] = await db.query(
            "SELECT MAX(fecha) AS ultimo FROM bitacora_seguridad WHERE evento = 'BACKUP' AND exito = 1"
        );
        const [eventos] = await db.query(
            'SELECT id, evento, rol, usuario, ip, detalle, exito, fecha FROM bitacora_seguridad ORDER BY id DESC LIMIT 50'
        );

        let adminsConPasswordDefecto = 0;
        for (const admin of admins) {
            if (await security.verificarPassword(security.ADMIN_PASSWORD_DEFECTO, admin.password)) {
                adminsConPasswordDefecto++;
            }
        }

        const sinCifrar = Number(estudiantes.sin_cifrar);
        const fallidos = Number(accesos.fallidos);
        const bloqueadas = security.cuentasBloqueadas();
        const secreto = process.env.SESSION_SECRET || '';
        const diasDesdeBackup = backup.ultimo
            ? Math.floor((Date.now() - new Date(backup.ultimo).getTime()) / 86400000)
            : null;

        const controles = [
            adminsConPasswordDefecto > 0
                ? { nivel: 'critico', titulo: 'Contraseña de administrador por defecto', detalle: 'Cambia la contraseña del administrador desde este panel.' }
                : { nivel: 'ok', titulo: 'Contraseña de administrador', detalle: 'No se usa la contraseña por defecto.' },
            sinCifrar > 0
                ? { nivel: 'advertencia', titulo: 'Contraseñas sin cifrar', detalle: `${sinCifrar} cuenta(s) de estudiante guardan la contraseña en texto plano. Se cifran automáticamente al iniciar sesión o al restablecerlas.` }
                : { nivel: 'ok', titulo: 'Contraseñas cifradas', detalle: 'Todas las contraseñas de estudiantes están cifradas con bcrypt.' },
            (!secreto || secreto.length < 16 || SECRETOS_DEBILES.includes(secreto))
                ? { nivel: 'advertencia', titulo: 'Clave de sesión débil', detalle: 'Define en .env un SESSION_SECRET largo y aleatorio (mínimo 16 caracteres).' }
                : { nivel: 'ok', titulo: 'Clave de sesión', detalle: 'SESSION_SECRET configurado correctamente.' },
            fallidos >= 10
                ? { nivel: 'advertencia', titulo: 'Muchos intentos fallidos', detalle: `${fallidos} inicios de sesión fallidos en las últimas 24 horas.` }
                : { nivel: 'ok', titulo: 'Intentos de acceso', detalle: `${fallidos} inicios de sesión fallidos en las últimas 24 horas.` },
            bloqueadas.length > 0
                ? { nivel: 'advertencia', titulo: 'Cuentas bloqueadas', detalle: `${bloqueadas.length} cuenta(s) bloqueadas temporalmente por exceso de intentos.` }
                : { nivel: 'ok', titulo: 'Cuentas bloqueadas', detalle: 'No hay cuentas bloqueadas.' },
            diasDesdeBackup === null
                ? { nivel: 'advertencia', titulo: 'Sin copias de seguridad', detalle: 'Aún no se ha generado ningún backup desde el panel.' }
                : diasDesdeBackup > 7
                    ? { nivel: 'advertencia', titulo: 'Backup desactualizado', detalle: `El último backup tiene ${diasDesdeBackup} días.` }
                    : { nivel: 'ok', titulo: 'Copias de seguridad', detalle: `Último backup hace ${diasDesdeBackup} día(s).` }
        ];

        const peor = controles.reduce((max, c) => NIVELES[c.nivel] > NIVELES[max] ? c.nivel : max, 'ok');

        res.json({
            estado: peor,
            controles,
            metricas: {
                estudiantes: Number(estudiantes.total),
                estudiantesNuevosSemana: Number(estudiantes.nuevos_semana),
                administradores: admins.length,
                loginsExitosos24h: Number(accesos.exitosos),
                loginsFallidos24h: fallidos,
                intentosBloqueados24h: Number(accesos.bloqueados),
                ultimoBackup: backup.ultimo,
                servidorActivoMin: Math.floor(process.uptime() / 60)
            },
            bloqueadas,
            eventos
        });
    } catch (err) {
        console.error('❌ Error en monitoreo de seguridad:', err.message);
        res.status(500).json({ error: 'Error al obtener el estado de seguridad' });
    }
});

router.post('/bloqueos/:usuario/desbloquear', async (req, res) => {
    security.limpiarFallos(req.params.usuario);
    await security.registrarEvento(req, {
        evento: 'ADMIN_DESBLOQUEAR', rol: 'admin', usuario: req.session.user.usuario,
        detalle: `Cuenta desbloqueada: ${req.params.usuario}`
    });
    res.json({ mensaje: 'Cuenta desbloqueada' });
});

router.put('/password', async (req, res) => {
    const { actual, nueva } = req.body;
    if (!nueva || nueva.length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }
    try {
        const [rows] = await db.query('SELECT password FROM administradores WHERE id = ?', [req.session.user.id]);
        if (rows.length === 0 || !(await security.verificarPassword(actual || '', rows[0].password))) {
            return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        }
        const hash = await security.hashPassword(nueva);
        await db.query('UPDATE administradores SET password = ? WHERE id = ?', [hash, req.session.user.id]);
        await security.registrarEvento(req, {
            evento: 'ADMIN_CAMBIO_PASSWORD', rol: 'admin', usuario: req.session.user.usuario
        });
        res.json({ mensaje: 'Contraseña actualizada' });
    } catch (err) {
        console.error('❌ Error al cambiar contraseña de admin:', err.message);
        res.status(500).json({ error: 'Error al cambiar la contraseña' });
    }
});

// ==========================================
// 3. BACKUP DE LA BASE DE DATOS
// ==========================================

// Lee fechas como texto para que el respaldo no dependa de la zona horaria del servidor
const fechasComoTexto = (field, next) =>
    ['DATE', 'DATETIME', 'TIMESTAMP', 'NEWDATE'].includes(field.type) ? field.string() : next();

async function generarBackupSQL() {
    const [tablas] = await db.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const nombres = tablas.map(t => Object.values(t)[0]);
    const baseDatos = process.env.DB_NAME || 'control_gastos_estudiantes';

    const lineas = [
        `-- Backup de la base de datos: ${baseDatos}`,
        `-- Generado: ${new Date().toISOString()}`,
        '',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        ''
    ];

    for (const tabla of nombres) {
        const [[crear]] = await db.query(`SHOW CREATE TABLE \`${tabla}\``);
        lineas.push(`-- Tabla: ${tabla}`, `DROP TABLE IF EXISTS \`${tabla}\`;`, `${crear['Create Table']};`, '');

        const [filas] = await db.query({ sql: `SELECT * FROM \`${tabla}\``, typeCast: fechasComoTexto });
        if (filas.length > 0) {
            const columnas = Object.keys(filas[0]).map(c => `\`${c}\``).join(', ');
            const valores = filas.map(f => `(${Object.values(f).map(v => db.escape(v)).join(', ')})`);
            lineas.push(`INSERT INTO \`${tabla}\` (${columnas}) VALUES\n${valores.join(',\n')};`, '');
        }
    }

    lineas.push('SET FOREIGN_KEY_CHECKS = 1;', '');
    return lineas.join('\n');
}

router.get('/backup', async (req, res) => {
    try {
        const sql = await generarBackupSQL();
        const marca = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        const archivo = `backup-control_gastos-${marca}.sql`;

        await security.registrarEvento(req, {
            evento: 'BACKUP', rol: 'admin', usuario: req.session.user.usuario, detalle: archivo
        });

        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
        res.send(sql);
    } catch (err) {
        console.error('❌ Error al generar backup:', err.message);
        await security.registrarEvento(req, {
            evento: 'BACKUP', rol: 'admin', usuario: req.session.user.usuario, detalle: err.message, exito: false
        });
        res.status(500).json({ error: 'Error al generar el backup' });
    }
});

module.exports = router;
