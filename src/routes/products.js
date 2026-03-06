'use strict';

const express = require('express');
const { Product } = require('../../models');
const { requireLogin } = require('../middlewares/auth');
const { sanitizeInput } = require('../middlewares/validation');

const router = express.Router();

function getApplyCsrf(req) {
    return req.app.get('applyCsrf');
}

// GET /api/products — lista produtos (público)
router.get('/api/products', async (req, res) => {
    try {
        const products = await Product.findAll({ order: [['orderIndex', 'ASC']] });
        res.json(products);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar produtos.' });
    }
});

// POST /api/products — cria produto (admin)
router.post('/api/products', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { price, image } = req.body;
        const title = sanitizeInput(req.body.title);
        const description = req.body.description ? sanitizeInput(req.body.description) : '';

        if (!title || !price || !image) {
            return res.status(400).json({ error: 'Título, preço e imagem são obrigatórios.' });
        }
        if (title.length < 3) {
            return res.status(400).json({ error: 'Título inválido ou contém caracteres não permitidos.' });
        }
        const priceNum = parseInt(price);
        if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000000) {
            return res.status(400).json({ error: 'Preço inválido (deve ser entre 1 e 1.000.000 centavos).' });
        }
        if (!image || image.length > 1500000) {
            return res.status(400).json({ error: 'Imagem inválida ou muito grande (máx 1MB).' });
        }

        const product = await Product.create({ title, price: priceNum, image, description });
        res.json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar produto.' });
    }
});

// PUT /api/products/reorder — reordena produtos (admin)
router.put('/api/products/reorder', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { order } = req.body;
        if (!order || !Array.isArray(order)) {
            return res.status(400).json({ error: 'Array de ordem é obrigatório.' });
        }
        await Promise.all(
            order.map((productId, index) =>
                Product.update({ orderIndex: index }, { where: { id: productId } })
            )
        );
        res.json({ message: 'Ordem atualizada com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar a ordem dos produtos.' });
    }
});

// DELETE /api/products/:id — exclui produto (admin)
router.delete('/api/products/:id', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { id } = req.params;
        const rowsDeleted = await Product.destroy({ where: { id } });
        if (rowsDeleted === 0) {
            return res.status(404).json({ error: 'Produto não encontrado.' });
        }
        res.json({ message: 'Produto excluído com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir produto.' });
    }
});

module.exports = router;
