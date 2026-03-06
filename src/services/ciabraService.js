const axios = require('axios');
const puppeteer = require('puppeteer');
const { PaymentSettings } = require('../../models');

const CIABRA_API_URL = "https://api.az.center";
const CIABRA_PUBLIC_KEY = process.env.CIABRA_PUBLIC_KEY;
const CIABRA_PRIVATE_KEY = process.env.CIABRA_PRIVATE_KEY;

let cachedActiveGateway = null;
let gatewayLastFetch = 0;
const GATEWAY_CACHE_TTL = 60000;

function getCiabraAuthToken() {
    if (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY) {
        return null;
    }
    const credentials = `${CIABRA_PUBLIC_KEY}:${CIABRA_PRIVATE_KEY}`;
    return Buffer.from(credentials).toString('base64');
}

async function getActivePaymentGateway() {
    const now = Date.now();
    if (cachedActiveGateway && (now - gatewayLastFetch) < GATEWAY_CACHE_TTL) {
        return cachedActiveGateway;
    }
    try {
        let settings = await PaymentSettings.findOne();
        if (!settings) {
            settings = await PaymentSettings.create({ activeGateway: 'ciabra' });
        }
        cachedActiveGateway = settings.activeGateway;
        gatewayLastFetch = now;
        return cachedActiveGateway;
    } catch (error) {
        console.error('❌ Erro ao obter gateway ativo:', error);
        return 'ciabra';
    }
}

async function createCiabraCustomer(customerData) {
    const authToken = getCiabraAuthToken();
    if (!authToken) throw new Error('Credenciais CIABRA não configuradas');
    try {
        const response = await axios.post(`${CIABRA_API_URL}/invoices/applications/customers`, customerData, {
            headers: { 'Authorization': `Basic ${authToken}`, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error('[CIABRA] Erro ao criar cliente:', error.message);
        throw error;
    }
}

async function createCiabraInvoice(payload) {
    const authToken = getCiabraAuthToken();
    if (!authToken) throw new Error('Credenciais CIABRA não configuradas');
    try {
        const response = await axios.post(`${CIABRA_API_URL}/invoices/applications/invoices`, payload, {
            headers: { 'Authorization': `Basic ${authToken}`, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error('[CIABRA] Erro ao criar cobrança:', error.message);
        throw error;
    }
}

async function getCiabraInvoiceDetails(invoiceId) {
    const authToken = getCiabraAuthToken();
    if (!authToken) throw new Error('Credenciais CIABRA não configuradas');
    try {
        const response = await axios.get(`${CIABRA_API_URL}/invoices/applications/invoices/${invoiceId}`, {
            headers: { 'Authorization': `Basic ${authToken}`, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error('[CIABRA] Erro ao obter detalhes:', error.message);
        throw error;
    }
}

module.exports = {
    getActivePaymentGateway,
    createCiabraCustomer,
    createCiabraInvoice,
    getCiabraInvoiceDetails
};
