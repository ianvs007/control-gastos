const bcrypt = require('bcryptjs');
const db = require('./db');

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const ADMIN_PASSWORD_DEFECTO = 'admin123';

// Intentos fallidos por usuario (en memoria): { fallos, bloqueadoHasta }
const intentosFallidos = new Map();

// ==========================================
// ESQUEMA DE SEGURIDAD
// ==========================================

// Crea las tablas de administradores y bitácora si no existen, y el admin inicial
async function initSecuritySchema() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS administradores (
            id INT NOT NULL AUTO_INCREMENT,
            nombre_completo VARCHAR(120) NOT NULL,
            usuario VARCHAR(50) NOT NULL,
            password VARCHAR(255) NOT NULL,
            fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY usuario (usuario)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [admins] = await db.query('SELECT COUNT(*) AS total FROM administradores');
    if (admins[0].total === 0) {
        const password = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD_DEFECTO;
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

// ==========================================
// CONTRASEÑAS
// ==========================================

function esHashBcrypt(password) {
    return typeof password === 'string' && /^\$2[aby]\$/.test(password);
}

// Admite contraseñas antiguas en texto plano para no romper cuentas existentes
async function verificarPassword(plano, almacenado) {
    if (esHashBcrypt(almacenado)) {
        return bcrypt.compare(plano, almacenado);
    }
    return plano === almacenado;
}

function hashPassword(plano) {
    return bcrypt.hash(plano, 10);
}

// ==========================================
// VALIDACIONES DE CUENTAS
// ==========================================

function validarDatosEstudiante({ nombre_completo, usuario, password, curso }, { passwordRequerida }) {
    if (!nombre_completo || nombre_completo.trim().length < 3 || nombre_completo.trim().length > 120) {
        return 'El nombre completo debe tener entre 3 y 120 caracteres';
    }
    if (!usuario || !/^[a-zA-Z0-9._-]{3,50}$/.test(usuario)) {
        return 'El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o guion bajo)';
    }
    if (passwordRequerida || password) {
        if (!password || password.length < 6) {
            return 'La contraseña debe tener al menos 6 caracteres';
        }
    }
    if (curso && curso.length > 50) {
        return 'El curso no puede superar los 50 caracteres';
    }
    return null;
}

// El nombre de usuario debe ser único entre estudiantes y administradores
async function usuarioDisponible(usuario, estudianteIdExcluido = null) {
    const [admins] = await db.query('SELECT id FROM administradores WHERE usuario = ?', [usuario]);
    if (admins.length > 0) return false;
    const [estudiantes] = await db.query(
        'SELECT id FROM estudiantes WHERE usuario = ? AND id <> ?',
        [usuario, estudianteIdExcluido || 0]
    );
    return estudiantes.length === 0;
}

// ==========================================
// BLOQUEO POR INTENTOS FALLIDOS
// ==========================================

function clave(usuario) {
    return String(usuario || '').toLowerCase();
}

// Devuelve los minutos restantes de bloqueo, o 0 si el usuario no está bloqueado
function minutosBloqueo(usuario) {
    const registro = intentosFallidos.get(clave(usuario));
    if (!registro || !registro.bloqueadoHasta) return 0;
    const restante = registro.bloqueadoHasta - Date.now();
    if (restante <= 0) {
        intentosFallidos.delete(clave(usuario));
        return 0;
    }
    return Math.ceil(restante / 60000);
}

// Registra un fallo y devuelve true si la cuenta quedó bloqueada
function registrarFallo(usuario) {
    const registro = intentosFallidos.get(clave(usuario)) || { fallos: 0, bloqueadoHasta: null };
    registro.fallos += 1;
    if (registro.fallos >= MAX_INTENTOS) {
        registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
    }
    intentosFallidos.set(clave(usuario), registro);
    return Boolean(registro.bloqueadoHasta);
}

function limpiarFallos(usuario) {
    intentosFallidos.delete(clave(usuario));
}

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

// ==========================================
// BITÁCORA DE SEGURIDAD
// ==========================================

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

// ==========================================
// MIDDLEWARES DE ACCESO POR ROL
// ==========================================

function requireRol(rol) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Sesión no iniciada' });
        }
        if (req.session.user.rol !== rol) {
            return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso' });
        }
        next();
    };
}

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
