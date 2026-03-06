'use strict';

/**
 * Barrel de rotas — registra todos os roteadores no app Express.
 */
function registerRoutes(app) {
    const authRoutes = require('./auth');
    const paymentRoutes = require('./payment');
    const webhookRoutes = require('./webhook');
    const productRoutes = require('./products');
    const adminRoutes = require('./admin');
    const debugRoutes = require('./debug');

    app.use('/', authRoutes);
    app.use('/', paymentRoutes);
    app.use('/', webhookRoutes);
    app.use('/', productRoutes);
    app.use('/', adminRoutes);
    app.use('/', debugRoutes);
}

module.exports = { registerRoutes };
