SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `categorias_gastos`;
CREATE TABLE `categorias_gastos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `icono` varchar(30) DEFAULT 'bi-tag',
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `categorias_gastos` (`id`, `nombre`, `icono`) VALUES
(1, 'Alimentación', 'fas fa-utensils'),
(2, 'Transporte', 'fas fa-bus'),
(3, 'Material escolar', 'fas fa-book'),
(4, 'Entretenimiento', 'fas fa-gamepad'),
(5, 'Compras', 'fas fa-shopping-bag'),
(6, 'Otros', 'fas fa-ellipsis-h');

DROP TABLE IF EXISTS `estudiantes`;
CREATE TABLE `estudiantes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre_completo` varchar(120) NOT NULL,
  `usuario` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `curso` varchar(50) DEFAULT NULL,
  `fecha_registro` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario` (`usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `estudiantes` (`id`, `nombre_completo`, `usuario`, `password`, `curso`, `fecha_registro`) VALUES
(1, 'Juan Pérez Rodríguez', 'juan.perez', '$2b$10$aXzwYZKufKU/9aq2Rz6x.OEmcvOOHbcC0J8v/MiQjUeT6EAQDDaYO', '5to de Secundaria', '2026-10-07 12:32:34.000'),
(2, 'María López Flores', 'maria.lopez', '123456', '6to de Secundaria', '2026-10-07 12:32:34.000'),
(5, 'Alain Alarcon', 'alain.alarcon', '$2b$10$bN3tM3H7S7ddmKkyRRqX3ucqvHd8Rj6Ch7UojDVBqDYP6ZO4YbpZu', '5to secundaria', '2026-10-09 09:24:17.000');

DROP TABLE IF EXISTS `gastos`;
CREATE TABLE `gastos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `estudiante_id` int NOT NULL,
  `categoria_id` int NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha` date NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_en` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_gastos_estudiante` (`estudiante_id`),
  KEY `fk_gastos_categoria` (`categoria_id`),
  CONSTRAINT `fk_gastos_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias_gastos` (`id`),
  CONSTRAINT `fk_gastos_estudiante` FOREIGN KEY (`estudiante_id`) REFERENCES `estudiantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `gastos` (`id`, `estudiante_id`, `categoria_id`, `monto`, `fecha`, `descripcion`, `creado_en`) VALUES
(1, 1, 1, '150.00', '2026-03-03 00:00:00.000', 'Almuerzos y meriendas del recreo', '2026-10-07 12:34:24.000'),
(2, 1, 2, '80.00', '2026-03-05 00:00:00.000', 'Pasajes en micro y trufi', '2026-10-07 12:34:24.000'),
(3, 1, 3, '50.00', '2026-03-12 00:00:00.000', 'Cuaderno espiral y bolígrafos', '2026-10-07 12:34:24.000'),
(4, 1, 4, '70.00', '2026-03-18 00:00:00.000', 'Salida al cine con amigos', '2026-10-07 12:34:24.000'),
(5, 2, 1, '65.00', '2026-03-04 00:00:00.000', 'Recreo de la semana', '2026-10-07 12:34:39.000'),
(6, 2, 3, '70.00', '2026-03-08 00:00:00.000', 'Fotocopias y cartulinas para exposición', '2026-10-07 12:34:39.000'),
(7, 2, 5, '50.00', '2026-03-16 00:00:00.000', 'Audífonos nuevos', '2026-10-07 12:34:39.000'),
(8, 1, 4, '15.00', '2026-10-08 00:00:00.000', 'Ciner', '2026-10-07 23:43:42.000');

DROP TABLE IF EXISTS `ingresos`;
CREATE TABLE `ingresos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `estudiante_id` int NOT NULL,
  `fuente` varchar(80) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha` date NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_en` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_ingresos_estudiante` (`estudiante_id`),
  CONSTRAINT `fk_ingresos_estudiante` FOREIGN KEY (`estudiante_id`) REFERENCES `estudiantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `ingresos` (`id`, `estudiante_id`, `fuente`, `monto`, `fecha`, `descripcion`, `creado_en`) VALUES
(1, 1, 'Mesada de mis padres', '300.00', '2026-03-01 00:00:00.000', 'Mesada mensual para el colegio', '2026-10-07 12:34:15.000'),
(2, 1, 'Regalo de cumpleaños', '150.00', '2026-03-10 00:00:00.000', 'Regalo de mis abuelos', '2026-10-07 12:34:15.000'),
(3, 1, 'Trabajo de fin de semana', '150.00', '2026-03-15 00:00:00.000', 'Ayuda en la tienda de mi tío', '2026-10-07 12:34:15.000'),
(4, 2, 'Mesada semanal', '200.00', '2026-03-02 00:00:00.000', 'Primera quincena', '2026-10-07 12:34:30.000'),
(5, 2, 'Venta de postres', '200.00', '2026-03-14 00:00:00.000', 'Venta de galletas en el curso', '2026-10-07 12:34:30.000'),
(6, 1, 'Recreo', '20.00', '2026-10-08 00:00:00.000', 'para mi colegrio', '2026-10-07 23:42:48.000'),
(7, 1, 'regalo', '100.00', '2026-10-07 00:00:00.000', 'cumpleaños', '2026-10-08 00:10:11.000');

DROP TABLE IF EXISTS `metas_ahorro`;
CREATE TABLE `metas_ahorro` (
  `id` int NOT NULL AUTO_INCREMENT,
  `estudiante_id` int NOT NULL,
  `titulo` varchar(120) NOT NULL,
  `categoria` varchar(50) DEFAULT 'Personal',
  `monto_objetivo` decimal(10,2) NOT NULL,
  `monto_ahorrado` decimal(10,2) NOT NULL DEFAULT '0.00',
  `estado` varchar(20) NOT NULL DEFAULT 'en_progreso',
  `visible_panel` tinyint(1) NOT NULL DEFAULT '1',
  `fecha_creacion` date NOT NULL,
  `fecha_completada` datetime DEFAULT NULL,
  `creado_en` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_metas_estudiante` (`estudiante_id`),
  CONSTRAINT `fk_metas_estudiante` FOREIGN KEY (`estudiante_id`) REFERENCES `estudiantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `metas_ahorro` (`id`, `estudiante_id`, `titulo`, `categoria`, `monto_objetivo`, `monto_ahorrado`, `estado`, `visible_panel`, `fecha_creacion`, `fecha_completada`) VALUES
(1, 1, 'Audífonos Bluetooth', 'Tecnología', '180.00', '120.00', 'en_progreso', 1, '2026-10-05', NULL),
(2, 1, ' Pelota de Fútbol Oficial', 'Deporte', '100.00', '100.00', 'completada', 1, '2026-09-15', '2026-10-10 15:30:00'),
(3, 2, 'Calculadora Científica', 'Estudios', '150.00', '90.00', 'en_progreso', 1, '2026-10-02', NULL);

DROP TABLE IF EXISTS `gastos_escolares`;
CREATE TABLE `gastos_escolares` (
  `id` int NOT NULL AUTO_INCREMENT,
  `estudiante_id` int NOT NULL,
  `tipo` varchar(60) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha` date NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_en` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_gastos_escolares_estudiante` (`estudiante_id`),
  KEY `idx_gastos_escolares_fecha` (`fecha`),
  CONSTRAINT `fk_gastos_escolares_estudiante` FOREIGN KEY (`estudiante_id`) REFERENCES `estudiantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `gastos_escolares` (`id`, `estudiante_id`, `tipo`, `monto`, `fecha`, `descripcion`) VALUES
(1, 1, 'Fotocopias e Impresiones', '5.00', '2026-10-08', 'Fotocopias de práctica de Matemáticas'),
(2, 1, 'Materiales para clase', '25.00', '2026-10-14', 'Cartulinas, marcadores y pegamento para exposición'),
(3, 1, 'Recreo / Merienda escolar', '12.00', '2026-10-16', 'Sándwich y jugo en el quiosco del colegio'),
(4, 2, 'Fotocopias e Impresiones', '8.00', '2026-10-09', 'Impresión de informe de Biología');

DROP TABLE IF EXISTS `administradores`;
CREATE TABLE `administradores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre_completo` varchar(120) NOT NULL,
  `usuario` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `fecha_registro` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario` (`usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `administradores` (`id`, `nombre_completo`, `usuario`, `password`, `fecha_registro`) VALUES
(1, 'Administrador del Sistema', 'admin', '$2b$10$3KCxXfBMs5AuXc2laV3otusPLWoXxDwO43Hj7xqRBOG693YBrmoXC', '2026-10-09 09:19:16.000');

DROP TABLE IF EXISTS `bitacora_seguridad`;
CREATE TABLE `bitacora_seguridad` (
  `id` int NOT NULL AUTO_INCREMENT,
  `evento` varchar(40) NOT NULL,
  `rol` varchar(20) DEFAULT NULL,
  `usuario` varchar(50) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `detalle` varchar(255) DEFAULT NULL,
  `exito` tinyint(1) NOT NULL DEFAULT '1',
  `fecha` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bitacora_fecha` (`fecha`),
  KEY `idx_bitacora_evento` (`evento`)
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 ;

INSERT INTO `bitacora_seguridad` (`id`, `evento`, `rol`, `usuario`, `ip`, `detalle`, `exito`, `fecha`) VALUES
(1, 'REGISTRO', 'estudiante', 'prueba.reg', '::1', NULL, 1, '2026-10-09 09:19:29.000'),
(2, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:19:29.000'),
(3, 'LOGIN_FALLIDO', 'estudiante', 'prueba.reg', '::1', NULL, 0, '2026-10-09 09:19:29.000'),
(4, 'LOGIN_FALLIDO', 'estudiante', 'prueba.reg', '::1', NULL, 0, '2026-10-09 09:19:29.000'),
(5, 'LOGIN_FALLIDO', 'estudiante', 'prueba.reg', '::1', NULL, 0, '2026-10-09 09:19:30.000'),
(6, 'LOGIN_FALLIDO', 'estudiante', 'prueba.reg', '::1', NULL, 0, '2026-10-09 09:19:30.000'),
(7, 'LOGIN_FALLIDO', 'estudiante', 'prueba.reg', '::1', 'Cuenta bloqueada por exceso de intentos', 0, '2026-10-09 09:19:30.000'),
(8, 'LOGIN_BLOQUEADO', NULL, 'prueba.reg', '::1', NULL, 0, '2026-10-09 09:19:30.000'),
(9, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:19:30.000'),
(10, 'BACKUP', 'admin', 'admin', '::1', 'backup-control_gastos-20261009-131930.sql', 1, '2026-10-09 09:19:30.000'),
(11, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:20:04.000'),
(12, 'ADMIN_EDITAR_ESTUDIANTE', 'admin', 'admin', '::1', 'Cuenta editada: prueba.reg (contraseña restablecida)', 1, '2026-10-09 09:20:04.000'),
(13, 'ADMIN_CREAR_ESTUDIANTE', 'admin', 'admin', '::1', 'Cuenta creada: otra.prueba', 1, '2026-10-09 09:20:04.000'),
(14, 'LOGIN_OK', 'estudiante', 'otra.prueba', '::1', NULL, 1, '2026-10-09 09:20:04.000'),
(15, 'ADMIN_ELIMINAR_ESTUDIANTE', 'admin', 'admin', '::1', 'Cuenta eliminada: prueba.reg', 1, '2026-10-09 09:20:05.000'),
(16, 'ADMIN_ELIMINAR_ESTUDIANTE', 'admin', 'admin', '::1', 'Cuenta eliminada: otra.prueba', 1, '2026-10-09 09:20:05.000'),
(17, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:21:08.000'),
(18, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:21:58.000'),
(19, 'REGISTRO', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-09 09:24:17.000'),
(20, 'LOGOUT', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-09 09:24:26.000'),
(21, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:24:37.000'),
(22, 'LOGOUT', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:26:50.000'),
(23, 'LOGIN_OK', 'estudiante', 'juan.perez', '::ffff:127.0.0.1', NULL, 1, '2026-10-09 09:28:58.000'),
(24, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:30:14.000'),
(25, 'LOGOUT', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:30:22.000'),
(26, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:46:32.000'),
(27, 'LOGIN_FALLIDO', 'estudiante', 'alain.alarcon', '::1', NULL, 0, '2026-10-09 09:50:27.000'),
(28, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:50:35.000'),
(29, 'LOGOUT', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 09:50:48.000'),
(30, 'LOGIN_FALLIDO', 'estudiante', 'alain.alarcon', '::1', NULL, 0, '2026-10-09 09:50:55.000'),
(31, 'LOGIN_FALLIDO', 'estudiante', 'alain.alarcon', '::1', NULL, 0, '2026-10-09 09:51:00.000'),
(32, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:51:47.000'),
(33, 'ADMIN_EDITAR_ESTUDIANTE', 'admin', 'admin', '::1', 'Cuenta editada: alain.alarcon (contraseña restablecida)', 1, '2026-10-09 09:52:02.000'),
(34, 'BACKUP', 'admin', 'admin', '::1', 'backup-control_gastos-20261009-135426.sql', 1, '2026-10-09 09:54:26.000'),
(35, 'LOGOUT', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 09:54:55.000'),
(36, 'LOGIN_OK', 'estudiante', 'juan.perez', '::ffff:127.0.0.1', NULL, 1, '2026-10-09 10:28:47.000'),
(37, 'LOGOUT', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-09 10:28:59.000'),
(38, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-09 10:28:59.000'),
(39, 'LOGIN_OK', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-09 10:31:41.000'),
(40, 'LOGOUT', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-09 10:32:07.000'),
(41, 'LOGIN_FALLIDO', 'admin', 'admin', '::1', NULL, 0, '2026-10-13 08:51:35.000'),
(42, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-13 08:51:39.000'),
(43, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-13 09:11:18.000'),
(44, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-13 09:36:30.000'),
(45, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-18 18:09:59.000'),
(46, 'LOGIN_OK', 'estudiante', 'juan.perez', '::1', NULL, 1, '2026-10-18 18:10:30.000'),
(47, 'LOGIN_OK', 'admin', 'admin', '::1', NULL, 1, '2026-10-18 18:18:07.000'),
(48, 'LOGOUT', 'admin', 'admin', '::1', NULL, 1, '2026-10-18 18:18:10.000'),
(49, 'LOGIN_FALLIDO', 'estudiante', 'alain.alarcon', '::1', NULL, 0, '2026-10-18 18:18:16.000'),
(50, 'LOGIN_OK', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-18 18:18:20.000'),
(51, 'LOGOUT', 'estudiante', 'alain.alarcon', '::1', NULL, 1, '2026-10-18 18:18:48.000');

SET FOREIGN_KEY_CHECKS = 1;
