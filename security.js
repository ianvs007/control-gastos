// =============================================================================
// ARCHIVO: security.js - Módulo de Seguridad, Contraseñas y Protección
// =============================================================================
// Este archivo actúa como el "guardia de seguridad" de todo el sistema.
// Sus tareas principales son:
// 1. Proteger las contraseñas para que nadie las pueda leer ni en la base de datos.
// 2. Bloquear cuentas temporalmente si alguien intenta adivinar contraseñas muchas veces.
// 3. Registrar una bitácora (historial) de quién entra, quién falla y desde qué lugar.
// 4. Asegurarse de que los estudiantes no entren al panel del administrador ni viceversa.
// =============================================================================

// 'bcryptjs' es la herramienta que transforma contraseñas normales en códigos secretos (hashes)
// que son imposibles de descifrar de vuelta, protegiendo a los usuarios.
const bcrypt = require('bcryptjs');

// Importamos la conexión a la base de datos para guardar auditorías y crear tablas de seguridad
const db = require('./db');

// =============================================================================
// CONFIGURACIÓN DE LÍMITES DE SEGURIDAD
// =============================================================================

// Número máximo de veces que una persona puede equivocarse de contraseña antes de bloquearla
const MAX_INTENTOS = 5;

// Tiempo que la cuenta queda congelada si supera los intentos fallidos (15 minutos en milisegundos)
const BLOQUEO_MS = 15 * 60 * 1000;

// Contraseña por defecto si se crea un administrador nuevo por primera vez
const ADMIN_PASSWORD_DEFECTO = 'admin123';

// Esta memoria temporal guarda los intentos fallidos de los usuarios:
// Por cada usuario guarda: cuántas veces falló y hasta qué hora exacta está bloqueado.
const intentosFallidos = new Map();

// =============================================================================
// 1. CREACIÓN AUTOMÁTICA DE TABLAS DE SEGURIDAD AL INICIAR
// =============================================================================
// Cuando el servidor arranca, esta función revisa si existen las tablas de
// administradores y de bitácora en MySQL. Si no existen, las crea automáticamente.
// También crea la cuenta del administrador principal si no hay ninguna.
async function initSecuritySchema() {
    // Tabla donde se guardan los administradores (directores, profesores o encargados)
    await db.query(`
        CREATE TABLE IF NOT EXISTS administradores (
            id INT NOT NULL AUTO_INCREMENT,
            nombre_completo VARCHAR(120) NOT NULL,
            usuario VARCHAR(50) NOT NULL,
            password VARCHAR(255) NOT NULL,
            fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY usuario (usuario)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Tabla de auditoría: aquí queda anotado cada inicio de sesión, error o cambio importante
    await db.query(`
        CREATE TABLE IF NOT EXISTS bitacora_seguridad (
            id INT NOT NULL AUTO_INCREMENT,
            evento VARCHAR(40) NOT NULL,
            rol VARCHAR(20) DEFAULT NULL,
            usuario VARCHAR(50) DEFAULT NULL,
            ip VARCHAR(45) DEFAULT NULL,
            detalle VARCHAR(255) DEFAULT NULL,
            exito TINYINT(1) NOT NULL DEFAULT 1,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_bitacora_fecha (fecha),
            KEY idx_bitacora_evento (evento)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Verificamos si ya existe al menos un administrador registrado
    const [admins] = await db.query('SELECT COUNT(*) AS total FROM administradores');
    if (admins[0].total === 0) {
        // Si no hay ninguno, creamos el administrador por defecto
        const password = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD_DEFECTO;
        // Ciframos la contraseña para no guardarla en texto limpio
        const hash = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO administradores (nombre_completo, usuario, password) VALUES (?, ?, ?)',
            ['Administrador del Sistema', process.env.ADMIN_USER || 'admin', hash]
        );
        console.log(`👤 Administrador inicial creado: usuario "${process.env.ADMIN_USER || 'admin'}"`);
        if (!process.env.ADMIN_PASSWORD) {
            console.log(`⚠️  Contraseña por defecto "${ADMIN_PASSWORD_DEFECTO}". Cámbiala desde el panel de administrador.`);
        }
    }
}

// =============================================================================
// 2. MANEJO Y CIFRADO DE CONTRASEÑAS
// =============================================================================

// Esta función averigua si una contraseña ya está cifrada con el formato seguro de bcrypt
// (los códigos de bcrypt siempre empiezan con caracteres especiales como '$2a$', '$2b$' o '$2y$').
function esHashBcrypt(password) {
    return typeof password === 'string' && /^\$2[aby]\$/.test(password);
}

// Compara la contraseña que el usuario escribió en la pantalla con la que tenemos guardada.
// Si la guardada está cifrada, usa la matemática de bcrypt para comprobarla de forma segura.
// Si era una contraseña antigua sin cifrar, la compara directamente.
async function verificarPassword(plano, almacenado) {
    if (esHashBcrypt(almacenado)) {
        return bcrypt.compare(plano, almacenado);
    }
    return plano === almacenado;
}

// Convierte una contraseña legible (como "secreto123") en un código seguro indescifrable
function hashPassword(plano) {
    return bcrypt.hash(plano, 10);
}

// =============================================================================
// 3. VALIDACIÓN DE DATOS AL REGISTRAR O EDITAR ESTUDIANTES
// =============================================================================
// Esta función revisa que los datos ingresados cumplan con las reglas mínimas
// antes de enviarlos a la base de datos (evita campos vacíos, nombres raros o claves muy cortas).
function validarDatosEstudiante({ nombre_completo, usuario, password, curso }, { passwordRequerida }) {
    // El nombre debe tener entre 3 y 120 letras
    if (!nombre_completo || nombre_completo.trim().length < 3 || nombre_completo.trim().length > 120) {
        return 'El nombre completo debe tener entre 3 y 120 caracteres';
    }
    // El usuario debe tener entre 3 y 50 caracteres (solo letras, números, puntos o guiones)
    if (!usuario || !/^[a-zA-Z0-9._-]{3,50}$/.test(usuario)) {
        return 'El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o guion bajo)';
    }
    // Si se pide contraseña obligatoria (o si el usuario escribió una nueva contraseña), debe tener al menos 6 letras/números
    if (passwordRequerida || password) {
        if (!password || password.length < 6) {
            return 'La contraseña debe tener al menos 6 caracteres';
        }
    }
    // El curso no puede ser excesivamente largo
    if (curso && curso.length > 50) {
        return 'El curso no puede superar los 50 caracteres';
    }
    // Si todo está correcto, no devuelve ningún mensaje de error
    return null;
}

// Verifica que no haya otra persona registrada con el mismo nombre de usuario exacto
async function usuarioDisponible(usuario, estudianteIdExcluido = null) {
    // 1. Revisa que ningún administrador tenga ese usuario
    const [admins] = await db.query('SELECT id FROM administradores WHERE usuario = ?', [usuario]);
    if (admins.length > 0) return false;

    // 2. Revisa que ningún otro estudiante tenga ese usuario (omitiendo al estudiante actual si se está editando)
    const [estudiantes] = await db.query(
        'SELECT id FROM estudiantes WHERE usuario = ? AND id <> ?',
        [usuario, estudianteIdExcluido || 0]
    );
    return estudiantes.length === 0;
}

// =============================================================================
// 4. CONTROL DE INTENTOS FALLIDOS Y BLOQUEO AUTOMÁTICO (PROTECCIÓN CONTRA ROBOS)
// =============================================================================

// Convierte el nombre de usuario a minúsculas para que "Juan" y "juan" se traten como la misma cuenta
function clave(usuario) {
    return String(usuario || '').toLowerCase();
}

// Averigua si un usuario está temporalmente castigado/bloqueado por equivocarse muchas veces.
// Si está bloqueado, devuelve cuántos minutos le faltan esperar. Si no está bloqueado, devuelve 0.
function minutosBloqueo(usuario) {
    const registro = intentosFallidos.get(clave(usuario));
    if (!registro || !registro.bloqueadoHasta) return 0;

    const restante = registro.bloqueadoHasta - Date.now();
    if (restante <= 0) {
        // El tiempo de castigo ya pasó, se le permite volver a intentar
        intentosFallidos.delete(clave(usuario));
        return 0;
    }
    // Devuelve los minutos redondeados hacia arriba (ejemplo: 2 minutos restantes)
    return Math.ceil(restante / 60000);
}

// Suma un intento fallido cada vez que alguien escribe mal su contraseña.
// Si llega a 5 fallos (MAX_INTENTOS), bloquea la cuenta por 15 minutos automáticamente.
function registrarFallo(usuario) {
    const registro = intentosFallidos.get(clave(usuario)) || { fallos: 0, bloqueadoHasta: null };
    registro.fallos += 1;
    if (registro.fallos >= MAX_INTENTOS) {
        registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
    }
    intentosFallidos.set(clave(usuario), registro);
    return Boolean(registro.bloqueadoHasta);
}

// Cuando el usuario escribe su contraseña correctamente, borramos su lista de fallos
function limpiarFallos(usuario) {
    intentosFallidos.delete(clave(usuario));
}

// Obtiene una lista de todas las cuentas que actualmente se encuentran bloqueadas
// para que el administrador pueda verlas en su pantalla de monitoreo
function cuentasBloqueadas() {
    const ahora = Date.now();
    const lista = [];
    for (const [usuario, registro] of intentosFallidos) {
        if (registro.bloqueadoHasta && registro.bloqueadoHasta > ahora) {
            lista.push({ usuario, hasta: new Date(registro.bloqueadoHasta) });
        }
    }
    return lista;
}

// =============================================================================
// 5. BITÁCORA DE SEGURIDAD (LIBRO DE REGISTROS)
// =============================================================================
// Guarda un registro formal en la tabla 'bitacora_seguridad' con los datos del evento,
// la dirección IP del dispositivo que se conectó y si la acción tuvo éxito o falló.
async function registrarEvento(req, { evento, rol = null, usuario = null, detalle = null, exito = true }) {
    try {
        await db.query(
            'INSERT INTO bitacora_seguridad (evento, rol, usuario, ip, detalle, exito) VALUES (?, ?, ?, ?, ?, ?)',
            [evento, rol, usuario, req.ip || null, detalle, exito ? 1 : 0]
        );
    } catch (err) {
        console.error('❌ Error al registrar evento de seguridad:', err.message);
    }
}

// =============================================================================
// 6. CONTROLADORES DE PERMISO (MIDDLEWARES DE ACCESO)
// =============================================================================
// Estos filtros se colocan antes de las rutas para impedir que personas no autorizadas pasen:
// - Si no has iniciado sesión, te rechaza con un error 401.
// - Si eres estudiante e intentas entrar al panel de administración, te rechaza con un error 403.
function requireRol(rol) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Sesión no iniciada' });
        }
        if (req.session.user.rol !== rol) {
            return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso' });
        }
        // Si el rol coincide, se le permite continuar a la acción solicitada
        next();
    };
}

// Exportamos todas estas herramientas para que el resto del servidor las utilice
module.exports = {
    MAX_INTENTOS,
    ADMIN_PASSWORD_DEFECTO,
    initSecuritySchema,
    esHashBcrypt,
    verificarPassword,
    hashPassword,
    validarDatosEstudiante,
    usuarioDisponible,
    minutosBloqueo,
    registrarFallo,
    limpiarFallos,
    cuentasBloqueadas,
    registrarEvento,
    requireEstudiante: requireRol('estudiante'),
    requireAdmin: requireRol('admin')
};
