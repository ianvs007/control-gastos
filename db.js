const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'Root123',
    database: process.env.DB_NAME || 'control_gastos_estudiantes',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Exportamos directamente el pool para que db.query funcione siempre
module.exports = pool;