// =============================================================================
// ARCHIVO: db.js - Conexión con la Base de Datos MySQL
// =============================================================================
// Este archivo se encarga de conectar nuestro sistema con la base de datos MySQL,
// que es donde se guardan permanentemente los estudiantes, sus ingresos, sus gastos
// y los registros de seguridad.
// =============================================================================

// Importamos la librería 'mysql2/promise', que permite hacer consultas a MySQL
// usando código moderno y ordenado (async/await) para no bloquear el sistema.
const mysql = require('mysql2/promise');

// 'dotenv' lee las variables secretas del archivo '.env' (como contraseñas y nombres de base de datos)
require('dotenv').config();

// Creamos un "Pool de Conexiones" (un grupo de conexiones listas para usar).
// En lugar de abrir y cerrar una conexión cada vez que alguien registra un gasto,
// el sistema mantiene un grupo de hasta 10 conexiones abiertas y las reutiliza.
// Esto hace que la aplicación responda de manera mucho más rápida y eficiente.
const pool = mysql.createPool({
    // Dirección donde está la base de datos (por defecto 'localhost' = en esta misma máquina)
    host: process.env.DB_HOST || 'localhost',

    // Nombre de usuario para acceder a MySQL (por defecto 'root')
    user: process.env.DB_USER || 'root',

    // Contraseña de acceso a MySQL
    password: process.env.DB_PASS || 'Root123',

    // Nombre exacto de la base de datos del proyecto
    database: process.env.DB_NAME || 'control_gastos_estudiantes',

    // Si todas las conexiones están ocupadas, espera a que una se libere en lugar de dar error
    waitForConnections: true,

    // Cantidad máxima de conexiones simultáneas que se pueden atender a la vez
    connectionLimit: 10,

    // Límite de peticiones esperando en fila (0 significa sin límite, espera turno pacientemente)
    queueLimit: 0
});

// Exportamos este grupo de conexiones para que cualquier otro archivo (como server.js o admin.js)
// pueda hacer consultas usando: await db.query('SELECT ...')
module.exports = pool;