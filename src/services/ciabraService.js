'use strict';

const axios = require('axios');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { PaymentSettings } = require('../../models');

const CIABRA_API_URL = 'https://api.az.center';
const CIABRA_PUBLIC_KEY = process.env.CIABRA_PUBLIC_KEY;
const CIABRA_PRIVATE_KEY = process.env.CIABRA_PRIVATE_KEY;
const CIABRA_WEBHOOK_URL =
    process.env.CIABRA_WEBHOOK_URL ||
    'https://cinepremiumedit.domcloud.dev/ciabra-webhook';

// Cache para o gateway ativo
let cachedActiveGateway = null;
let gatewayLastFetch = 0;
const GATEWAY_CACHE_TTL = 60000; // 1 minuto

// Cache para códigos PIX temporários (installmentId → pixData)
const pixCodesCache = new Map();
const PIX_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

// Array de debug logs (compartilhado com o app)
const debugLogs = [];
const MAX_DEBUG_LOGS = 1000;

function addDebugLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    debugLogs.push(logEntry);
    if (debugLogs.length > MAX_DEBUG_LOGS) {
        debugLogs.shift();
    }
    console.log(logEntry);
}

function getCiabraAuthToken() {
    if (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY) return null;
    const credentials = `${CIABRA_PUBLIC_KEY}:${CIABRA_PRIVATE_KEY}`;
    return Buffer.from(credentials).toString('base64');
}

async function getActivePaymentGateway() {
    const now = Date.now();
    if (cachedActiveGateway && now - gatewayLastFetch < GATEWAY_CACHE_TTL) {
        return cachedActiveGateway;
    }
    try {
        let settings = await PaymentSettings.findOne();
        if (!settings) {
            settings = await PaymentSettings.create({ activeGateway: 'ciabra' });
            console.log('✅ Configuração de pagamento criada com gateway padrão: ciabra');
        }
        cachedActiveGateway = settings.activeGateway;
        gatewayLastFetch = now;
        return cachedActiveGateway;
    } catch (error) {
        console.error('❌ Erro ao obter gateway ativo:', error);
        return 'ciabra';
    }
}

async function setActivePaymentGateway(gateway) {
    if (!['ciabra'].includes(gateway)) {
        throw new Error('Gateway inválido. Use: ciabra');
    }
    try {
        let settings = await PaymentSettings.findOne();
        if (!settings) {
            settings = await PaymentSettings.create({ activeGateway: gateway });
        } else {
            await settings.update({ activeGateway: gateway });
        }
        cachedActiveGateway = gateway;
        gatewayLastFetch = Date.now();
        console.log(`✅ Gateway de pagamento alterado para: ${gateway}`);
        return settings;
    } catch (error) {
        console.error('❌ Erro ao alterar gateway:', error);
        throw error;
    }
}

async function createCiabraCustomer(customerData) {
    const authToken = getCiabraAuthToken();
    if (!authToken) {
        throw new Error('Credenciais CIABRA não configuradas (CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY)');
    }
    try {
        console.log('[CIABRA] Criando cliente...');
        console.log('[CIABRA] Customer data:', JSON.stringify(customerData, null, 2));
        const response = await axios.post(
            `${CIABRA_API_URL}/invoices/applications/customers`,
            customerData,
            { headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' } }
        );
        console.log('[CIABRA] Cliente criado com sucesso:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.error('[CIABRA] ===== ERRO AO CRIAR CLIENTE =====');
        console.error('[CIABRA] Error message:', error.message);
        if (error.response) {
            console.error('[CIABRA] HTTP Status:', error.response.status);
            console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
            if (error.response.status === 409 || error.response.status === 400) {
                console.log('[CIABRA] Cliente pode já existir. Detalhes:', error.response.data);
            }
        }
        console.error('[CIABRA] ========================================');
        throw error;
    }
}

async function createCiabraInvoice(payload) {
    const authToken = getCiabraAuthToken();
    if (!authToken) {
        throw new Error('Credenciais CIABRA não configuradas (CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY)');
    }
    try {
        console.log('[CIABRA] Criando cobrança...');
        console.log('[CIABRA] Payload:', JSON.stringify(payload, null, 2));
        const response = await axios.post(
            `${CIABRA_API_URL}/invoices/applications/invoices`,
            payload,
            { headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' } }
        );
        console.log('[CIABRA] Resposta recebida:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.error('[CIABRA] ===== ERRO AO CRIAR COBRANÇA =====');
        console.error('[CIABRA] Error message:', error.message);
        if (error.response) {
            console.error('[CIABRA] HTTP Status:', error.response.status);
            console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('[CIABRA] ========================================');
        throw error;
    }
}

async function getCiabraInvoiceDetails(invoiceId) {
    const authToken = getCiabraAuthToken();
    if (!authToken) throw new Error('Credenciais CIABRA não configuradas');
    try {
        const response = await axios.get(
            `${CIABRA_API_URL}/invoices/applications/invoices/${invoiceId}`,
            { headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' } }
        );
        return response.data;
    } catch (error) {
        console.error('[CIABRA] ===== ERRO AO OBTER DETALHES DO INVOICE =====');
        console.error('[CIABRA] Error message:', error.message);
        if (error.response) {
            console.error('[CIABRA] HTTP Status:', error.response.status);
            console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('[CIABRA] ====================================================');
        throw error;
    }
}

async function generateCiabraPixWithAutomation(installmentId) {
    let browser = null;
    try {
        addDebugLog('[CIABRA AUTOMATION] Iniciando automação para installment: ' + installmentId);
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--disable-gpu',
                '--disable-software-rasterizer', '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        let pixPaymentData = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => request.continue());
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/api/payments/pix')) {
                try {
                    const data = await response.json();
                    addDebugLog('[CIABRA AUTOMATION] Capturado resposta do PIX: ' + JSON.stringify(data, null, 2));
                    pixPaymentData = data;
                } catch (e) {
                    addDebugLog('[CIABRA AUTOMATION] Erro ao parsear resposta: ' + e.message);
                }
            }
        });

        const paymentUrl = `https://pagar.ciabra.com.br/i/${installmentId}`;
        addDebugLog('[CIABRA AUTOMATION] Acessando: ' + paymentUrl);
        await page.goto(paymentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        addDebugLog('[CIABRA AUTOMATION] Página carregada com sucesso');

        const screenshotPath = `/tmp/ciabra_${installmentId}_1.png`;
        await page.screenshot({ path: screenshotPath });
        addDebugLog('[CIABRA AUTOMATION] Screenshot salvo: ' + screenshotPath);

        const buttons = await page.$$eval('button', btns => btns.map(b => ({ text: b.textContent.trim(), html: b.innerHTML })));
        addDebugLog('[CIABRA AUTOMATION] Botões encontrados: ' + JSON.stringify(buttons, null, 2));

        await new Promise(resolve => setTimeout(resolve, 3000));

        addDebugLog('[CIABRA AUTOMATION] Procurando botão PIX...');
        let pixButton = null;

        try {
            pixButton = await page.$('button:has-text("PIX")');
            if (pixButton) addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via CSS :has-text');
        } catch (e) {
            addDebugLog('[CIABRA AUTOMATION] Método CSS falhou: ' + e.message);
        }

        if (!pixButton) {
            try {
                const pixButtons = await page.$x("//button[contains(translate(text(), 'PIX', 'pix'), 'pix')]");
                if (pixButtons.length > 0) {
                    pixButton = pixButtons[0];
                    addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via XPath');
                }
            } catch (e) {
                addDebugLog('[CIABRA AUTOMATION] Método XPath falhou: ' + e.message);
            }
        }

        if (!pixButton) {
            try {
                const allClickable = await page.$$('button, a, div[onclick], [role="button"]');
                for (const el of allClickable) {
                    const text = await page.evaluate(e => e.textContent, el);
                    if (text && text.toUpperCase().includes('PIX')) {
                        pixButton = el;
                        addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via busca manual: ' + text);
                        break;
                    }
                }
            } catch (e) {
                addDebugLog('[CIABRA AUTOMATION] Método busca manual falhou: ' + e.message);
            }
        }

        if (!pixButton) throw new Error('Botão PIX não encontrado na página após 3 tentativas');

        await pixButton.click();
        addDebugLog('[CIABRA AUTOMATION] Clicou em PIX');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const screenshotPath2 = `/tmp/ciabra_${installmentId}_2.png`;
        await page.screenshot({ path: screenshotPath2 });
        addDebugLog('[CIABRA AUTOMATION] Screenshot após PIX: ' + screenshotPath2);

        const buttons2 = await page.$$eval('button', btns => btns.map(b => ({ text: b.textContent.trim(), html: b.innerHTML })));
        addDebugLog('[CIABRA AUTOMATION] Botões após clicar em PIX: ' + JSON.stringify(buttons2, null, 2));

        let pagarButton = null;

        try {
            const pagarButtons = await page.$x("//*[contains(text(), 'Pagar')]");
            if (pagarButtons.length > 0) {
                pagarButton = pagarButtons[0];
                addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via XPath');
            }
        } catch (e) {
            addDebugLog('[CIABRA AUTOMATION] XPath para Pagar falhou: ' + e.message);
        }

        if (!pagarButton) {
            try {
                const mantineButtons = await page.$$('button[class*="mantine-Button"], span[class*="mantine-Button"]');
                for (const btn of mantineButtons) {
                    const text = await page.evaluate(el => el.textContent, btn);
                    if (text && text.includes('Pagar')) {
                        pagarButton = btn;
                        addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via Mantine: ' + text);
                        break;
                    }
                }
            } catch (e) {
                addDebugLog('[CIABRA AUTOMATION] Método Mantine falhou: ' + e.message);
            }
        }

        if (!pagarButton) {
            try {
                const allClickable = await page.$$('button, span[class*="Button"], div[onclick], [role="button"]');
                for (const el of allClickable) {
                    const text = await page.evaluate(e => e.textContent, el);
                    if (text && text.includes('Pagar')) {
                        pagarButton = el;
                        addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via busca manual: ' + text);
                        break;
                    }
                }
            } catch (e) {
                addDebugLog('[CIABRA AUTOMATION] Busca manual para Pagar falhou: ' + e.message);
            }
        }

        if (!pagarButton) throw new Error('Botão Pagar não encontrado na página após 3 tentativas');

        await pagarButton.click();
        addDebugLog('[CIABRA AUTOMATION] Clicou em Pagar');

        addDebugLog('[CIABRA AUTOMATION] Aguardando resposta do pagamento...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (!pixPaymentData) throw new Error('Não foi possível capturar dados do pagamento PIX');

        addDebugLog('[CIABRA AUTOMATION] Pagamento PIX gerado com sucesso!');
        return pixPaymentData;

    } catch (error) {
        addDebugLog('[CIABRA AUTOMATION] ===== ERRO NA AUTOMAÇÃO =====');
        console.error('[CIABRA AUTOMATION] Error message:', error.message);
        console.error('[CIABRA AUTOMATION] ===============================');
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('[CIABRA AUTOMATION] Navegador fechado');
        }
    }
}

async function checkCiabraAuth() {
    const authToken = getCiabraAuthToken();
    if (!authToken) return { success: false, error: 'Credenciais CIABRA não configuradas' };
    try {
        const response = await axios.get(`${CIABRA_API_URL}/auth/applications/check`, {
            headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' }
        });
        return { success: true, data: response.data };
    } catch (error) {
        console.error('[CIABRA] Erro ao verificar autenticação:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
        return { success: false, error: errorMsg };
    }
}

/**
 * Gera QR Code base64 a partir do código EMV PIX.
 */
async function generateQrCodeBase64(pixCode) {
    const qrCodeDataUrl = await QRCode.toDataURL(pixCode, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 1
    });
    return qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
}

module.exports = {
    CIABRA_API_URL,
    CIABRA_PUBLIC_KEY,
    CIABRA_PRIVATE_KEY,
    CIABRA_WEBHOOK_URL,
    cachedActiveGateway: () => cachedActiveGateway,
    pixCodesCache,
    debugLogs,
    addDebugLog,
    getCiabraAuthToken,
    getActivePaymentGateway,
    setActivePaymentGateway,
    createCiabraCustomer,
    createCiabraInvoice,
    getCiabraInvoiceDetails,
    generateCiabraPixWithAutomation,
    checkCiabraAuth,
    generateQrCodeBase64
};
