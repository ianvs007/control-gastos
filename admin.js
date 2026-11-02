// =============================================================================
// ARCHIVO: admin.js - Panel de Control del Administrador
// =============================================================================
// En este archivo están todas las funciones a las que solo el Administrador
// (profesor, director o encargado del colegio) tiene acceso:
// 1. Ver la lista de todos los estudiantes, registrar nuevos, editarlos o borrarlos.
// 2. Monitorear la salud y seguridad del sistema (cuentas bloqueadas, accesos fallidos).
// 3. Descargar una copia de seguridad (Backup SQL) con toda la información.
// 4. Cambiar la contraseña del administrador.
// =============================================================================

const express = require('express');
const db = require('./db');
const security = require('./security');

// Creamos un "enrutador" de Express para agrupar todas las rutas administrativas
const router = express.Router();

// CANDADO GENERAL: Todas las rutas de este archivo exigen que quien las use sea un Administrador.
// Si un estudiante o un visitante intenta entrar aquí, el sistema lo detiene de inmediato.
router.use(security.requireAdmin);

// Función de filtro: comprueba que el ID numérico enviado sea realmente un número entero válido
function validarId(req, res, next) {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Identificador inválido (debe ser un número)' });
    }
    next();
}

// =============================================================================
// 1. GESTIÓN DE CUENTAS DE ESTUDIANTES (CRUD: Listar, Crear, Editar, Eliminar)
// =============================================================================

// RUTA GET /api/admin/estudiantes -> Obtiene la lista completa de estudiantes registrados
router.get('/estudiantes', async (req, res) => {
    try {
        // Consultamos los datos de cada estudiante y además contamos cuántos ingresos y gastos tiene registrados
        const [rows] = await db.query(`
            SELECT e.id, e.nombre_completo, e.usuario, e.curso, e.fecha_registro,
                   (SELECT COUNT(*) FROM ingresos i WHERE i.estudiante_id = e.id) AS total_ingresos,
                   ((SELECT COUNT(*) FROM gastos g WHERE g.estudiante_id = e.id) + (SELECT COUNT(*) FROM gastos_escolares ge WHERE ge.estudiante_id = e.id)) AS total_gastos
            FROM estudiantes e
            ORDER BY e.nombre_completo ASC
        `);
        // Enviamos la lista en formato JSON al navegador
        res.json(rows);
    } catch (err) {
        console.error('❌ Error al listar estudiantes:', err.message);
        res.status(500).json({ error: 'Error al obtener la lista de estudiantes' });
    }
});

// RUTA POST /api/admin/estudiantes -> El administrador crea una cuenta nueva para un estudiante
router.post('/estudiantes', async (req, res) => {
    // Limpiamos los espacios en blanco sobrantes alrededor del texto
    const datos = limpiarDatos(req.body);

    // Verificamos que el nombre, usuario y contraseña cumplan las reglas básicas
    const error = security.validarDatosEstudiante(datos, { passwordRequerida: true });
    if (error) return res.status(400).json({ error });

    try {
        // Comprobamos que el nombre de usuario no esté repetido
        if (!(await security.usuarioDisponible(datos.usuario))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso por otra persona' });
        }

        // Ciframos la contraseña antes de guardarla para proteger al estudiante
        const hash = await security.hashPassword(datos.password);

        // Guardamos al nuevo estudiante en la tabla 'estudiantes'
        await db.query(
            'INSERT INTO estudiantes (nombre_completo, usuario, password, curso) VALUES (?, ?, ?, ?)',
            [datos.nombre_completo, datos.usuario, hash, datos.curso || null]
        );

        // Anotamos en el libro de eventos (bitácora) que el administrador creó esta cuenta
        await security.registrarEvento(req, {
            evento: 'ADMIN_CREAR_ESTUDIANTE', rol: 'admin', usuario: req.session.user.usuario,
            detalle: `Cuenta creada: ${datos.usuario}`
        });

        res.json({ mensaje: 'Estudiante registrado correctamente' });
    } catch (err) {
        console.error('❌ Error al crear estudiante:', err.message);
        res.status(500).json({ error: 'Error al registrar el estudiante en la base de datos' });
    }
});

// RUTA PUT /api/admin/estudiantes/:id -> Modifica los datos de un estudiante o restablece su contraseña
router.put('/estudiantes/:id', validarId, async (req, res) => {
    const id = Number(req.params.id);
    const datos = limpiarDatos(req.body);

    // Al editar, la contraseña es opcional (solo se cambia si el admin escribió una nueva)
    const error = security.validarDatosEstudiante(datos, { passwordRequerida: false });
    if (error) return res.status(400).json({ error });

    try {
        // Verificamos que el estudiante realmente exista
        const [existe] = await db.query('SELECT usuario FROM estudiantes WHERE id = ?', [id]);
        if (existe.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }

        // Comprobamos que el nuevo nombre de usuario no lo tenga otro estudiante
        if (!(await security.usuarioDisponible(datos.usuario, id))) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
        }

        if (datos.password) {
            // Si el admin escribió una contraseña nueva, la ciframos y actualizamos todo
            const hash = await security.hashPassword(datos.password);
            await db.query(
                'UPDATE estudiantes SET nombre_completo = ?, usuario = ?, curso = ?, password = ? WHERE id = ?',
                [datos.nombre_completo, datos.usuario, datos.curso || null, hash, id]
            );
        } else {
            // Si no escribió contraseña, mantenemos la contraseña anterior sin tocarla
            await db.query(
                'UPDATE estudiantes SET nombre_completo = ?, usuario = ?, curso = ? WHERE id = ?',
                [datos.nombre_completo, datos.usuario, datos.curso || null, id]
            );
        }

        // Dejamos constancia en la bitácora
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

// RUTA DELETE /api/admin/estudiantes/:id -> Elimina a un estudiante del sistema
// NOTA: Como la base de datos tiene "ON DELETE CASCADE", todos sus ingresos y gastos se borran automáticamente.
router.delete('/estudiantes/:id', validarId, async (req, res) => {
    const id = Number(req.params.id);
    try {
        const [existe] = await db.query('SELECT usuario FROM estudiantes WHERE id = ?', [id]);
        if (existe.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }

        // Borramos el estudiante y sus registros asociados de la base de datos
        await db.query('DELETE FROM metas_ahorro WHERE estudiante_id = ?', [id]);
        await db.query('DELETE FROM gastos_escolares WHERE estudiante_id = ?', [id]);
        await db.query('DELETE FROM estudiantes WHERE id = ?', [id]);

        // Registramos la eliminación en la bitácora
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

// Función auxiliar que retira espacios vacíos al inicio y al final de los textos recibidos
function limpiarDatos(body) {
    return {
        nombre_completo: (body.nombre_completo || '').trim(),
        usuario: (body.usuario || '').trim(),
        password: body.password || '',
        curso: (body.curso || '').trim()
    };
}

// =============================================================================
// 2. MONITOREO DEL ESTADO Y SALUD DEL SISTEMA
// =============================================================================

// Niveles de gravedad para el semáforo del estado de seguridad:
// 0 = Todo bien (ok), 1 = Alerta leve (advertencia), 2 = Problema serio (crítico)
const NIVELES = { ok: 0, advertencia: 1, critico: 2 };

// Lista de contraseñas de sesión muy comunes que no deberían usarse en producción
const SECRETOS_DEBILES = ['secreto_super_seguro_ue_2026', 'Root123', 'secret', '123456'];

// RUTA GET /api/admin/seguridad -> Revisa la seguridad del sistema y devuelve métricas completas
router.get('/seguridad', async (req, res) => {
    try {
        // 1. Estadísticas de estudiantes (total, cuántos tienen contraseña antigua, cuántos son nuevos esta semana)
        const [[estudiantes]] = await db.query(`
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(password NOT LIKE '$2%'), 0) AS sin_cifrar,
                   COALESCE(SUM(fecha_registro >= NOW() - INTERVAL 7 DAY), 0) AS nuevos_semana
            FROM estudiantes
        `);

        // 2. Lista de administradores existentes
        const [admins] = await db.query('SELECT usuario, password FROM administradores');

        // 3. Accesos de las últimas 24 horas (cuántos entraron bien, cuántos fallaron, cuántos bloqueados)
        const [[accesos]] = await db.query(`
            SELECT COALESCE(SUM(evento = 'LOGIN_OK'), 0) AS exitosos,
                   COALESCE(SUM(evento = 'LOGIN_FALLIDO'), 0) AS fallidos,
                   COALESCE(SUM(evento = 'LOGIN_BLOQUEADO'), 0) AS bloqueados
            FROM bitacora_seguridad
            WHERE fecha >= NOW() - INTERVAL 1 DAY
        `);

        // 4. Fecha del último respaldo o backup realizado con éxito
        const [[backup]] = await db.query(
            "SELECT MAX(fecha) AS ultimo FROM bitacora_seguridad WHERE evento = 'BACKUP' AND exito = 1"
        );

        // 5. Los últimos 50 eventos registrados en la bitácora
        const [eventos] = await db.query(
            'SELECT id, evento, rol, usuario, ip, detalle, exito, fecha FROM bitacora_seguridad ORDER BY id DESC LIMIT 50'
        );

        // Verificamos si algún administrador todavía usa la contraseña de fábrica 'admin123'
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

        // Lista de chequeos de seguridad explicados en lenguaje sencillo:
        const controles = [
            adminsConPasswordDefecto > 0
                ? { nivel: 'critico', titulo: 'Contraseña de administrador por defecto', detalle: 'Cambia la contraseña del administrador desde este panel para evitar intrusos.' }
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
                    ? { nivel: 'advertencia', titulo: 'Backup desactualizado', detalle: `El último backup tiene ${diasDesdeBackup} días. Se recomienda descargar uno nuevo.` }
                    : { nivel: 'ok', titulo: 'Copias de seguridad', detalle: `Último backup hace ${diasDesdeBackup} día(s).` }
        ];

        // El estado general toma el peor nivel encontrado (si hay uno crítico, el sistema marca crítico)
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

// RUTA POST /api/admin/bloqueos/:usuario/desbloquear -> Permite al admin desbloquear manualmente a un estudiante
router.post('/bloqueos/:usuario/desbloquear', async (req, res) => {
    security.limpiarFallos(req.params.usuario);
    await security.registrarEvento(req, {
        evento: 'ADMIN_DESBLOQUEAR', rol: 'admin', usuario: req.session.user.usuario,
        detalle: `Cuenta desbloqueada: ${req.params.usuario}`
    });
    res.json({ mensaje: 'Cuenta desbloqueada exitosamente' });
});

// RUTA PUT /api/admin/password -> Permite al administrador cambiar su propia contraseña
router.put('/password', async (req, res) => {
    const { actual, nueva } = req.body;
    if (!actual) {
        return res.status(400).json({ error: 'Debes ingresar tu contraseña actual' });
    }
    if (!nueva || nueva.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    if (actual === nueva) {
        return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
    }
    try {
        // Consultamos la contraseña actual del administrador en la base de datos
        const [rows] = await db.query('SELECT password FROM administradores WHERE id = ?', [req.session.user.id]);
        if (rows.length === 0 || !(await security.verificarPassword(actual, rows[0].password))) {
            await security.registrarEvento(req, {
                evento: 'ADMIN_CAMBIO_PASSWORD', rol: 'admin', usuario: req.session.user.usuario,
                detalle: 'Contraseña actual incorrecta', exito: false
            });
            return res.status(401).json({ error: 'La contraseña actual que escribiste es incorrecta' });
        }
        // Ciframos la nueva contraseña y la guardamos
        const hash = await security.hashPassword(nueva);
        await db.query('UPDATE administradores SET password = ? WHERE id = ?', [hash, req.session.user.id]);

        await security.registrarEvento(req, {
            evento: 'ADMIN_CAMBIO_PASSWORD', rol: 'admin', usuario: req.session.user.usuario,
            detalle: 'Contraseña de administrador actualizada'
        });
        res.json({ mensaje: 'Contraseña de administrador actualizada correctamente' });
    } catch (err) {
        console.error('❌ Error al cambiar contraseña de admin:', err.message);
        res.status(500).json({ error: 'Error al cambiar la contraseña' });
    }
});

// =============================================================================
// 3. GENERADOR DE COPIAS DE SEGURIDAD (BACKUP SQL)
// =============================================================================

// Convierte las fechas a texto directo sin alterarlas con zonas horarias
const fechasComoTexto = (field, next) =>
    ['DATE', 'DATETIME', 'TIMESTAMP', 'NEWDATE'].includes(field.type) ? field.string() : next();

// Esta función lee todas las tablas de la base de datos y crea un archivo de texto '.sql'
// con las instrucciones completas para reconstruir la estructura y recuperar todos los datos.
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
        // Obtenemos la instrucción SQL que crea la tabla
        const [[crear]] = await db.query(`SHOW CREATE TABLE \`${tabla}\``);
        lineas.push(`-- Tabla: ${tabla}`, `DROP TABLE IF EXISTS \`${tabla}\`;`, `${crear['Create Table']};`, '');

        // Leemos todas las filas guardadas en esa tabla
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

// RUTA GET /api/admin/backup -> Descarga el archivo de backup en la computadora del admin
router.get('/backup', async (req, res) => {
    try {
        const sql = await generarBackupSQL();
        const marca = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        const archivo = `backup-control_gastos-${marca}.sql`;

        // Registramos en la bitácora que se generó un respaldo exitoso
        await security.registrarEvento(req, {
            evento: 'BACKUP', rol: 'admin', usuario: req.session.user.usuario, detalle: archivo
        });

        // Configuramos la respuesta HTTP para que el navegador descargue el archivo automáticamente
        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
        res.send(sql);
    } catch (err) {
        console.error('❌ Error al generar backup:', err.message);
        await security.registrarEvento(req, {
            evento: 'BACKUP', rol: 'admin', usuario: req.session.user.usuario, detalle: err.message, exito: false
        });
        res.status(500).json({ error: 'Error al generar la copia de seguridad' });
    }
});

module.exports = router;
