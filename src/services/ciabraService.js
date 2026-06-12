'use strict';

const axios = require('axios');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { PaymentSettings } = require('../../models');

const CIABRA_API_URL = 'https://api.az.center';
const CIABRA_PUBLIC_KEY = process.env.CIABRA_PUBLIC_KEY;
const CIABRA_PRIVATE_KEY = process.env.CIABRA_PRIVATE_KEY;
const CIABRA_WEBHOOK_URL = process.env.CIABRA_WEBHOOK_URL || '';

// Cache para o gateway ativo
let cachedActiveGateway = null;
let gatewayLastFetch = 0;
const GATEWAY_CACHE_TTL = 60000; // 1 minuto

// Browser singleton para reutilização entre chamadas
let browserInstance = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutos sem uso → fecha o browser

async function getOrCreateBrowser() {
    if (browserInstance) {
        try {
            // Verifica se o browser ainda está ativo
            await browserInstance.version();
            browserLastUsed = Date.now();
            return browserInstance;
        } catch (e) {
            addDebugLog('[BROWSER POOL] Browser anterior não está mais ativo, criando novo...');
            browserInstance = null;
        }
    }

    addDebugLog('[BROWSER POOL] Lançando novo browser...');
    browserInstance = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas', '--disable-gpu',
            '--disable-software-rasterizer', '--disable-extensions',
            '--disable-background-networking', '--disable-default-apps',
            '--disable-sync', '--disable-translate',
            '--metrics-recording-only', '--no-first-run',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-component-update',
            '--disable-ipc-flooding-protection',
            '--single-process'
        ]
    });
    browserLastUsed = Date.now();

    // Auto-fechar browser após período de inatividade
    const idleCheck = setInterval(async () => {
        if (Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
            clearInterval(idleCheck);
            if (browserInstance) {
                try {
                    await browserInstance.close();
                    addDebugLog('[BROWSER POOL] Browser fechado por inatividade');
                } catch (e) { /* já fechado */ }
                browserInstance = null;
            }
        }
    }, 60000);

    return browserInstance;
}

// Tipos de recursos a bloquear na automação (não necessários para capturar dados PIX)
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font', 'media']);

// Array de debug logs (compartilhado com o app)
const debugLogs = [];
const MAX_DEBUG_LOGS = process.env.NODE_ENV === 'production' ? 200 : 1000;

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
        const response = await axios.post(
            `${CIABRA_API_URL}/invoices/applications/customers`,
            customerData,
            { headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        console.log('[CIABRA] Cliente criado com sucesso. ID:', response.data?.id);
        return response.data;
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const responseData = error.response.data;
            console.error(`[CIABRA] Erro ao criar cliente — HTTP ${status}:`, JSON.stringify(responseData));
            // 409 = cliente já existe; alguns gateways retornam 400 com o recurso existente
            if ((status === 409 || status === 400) && responseData?.id) {
                console.log(`[CIABRA] Reusando cliente existente. ID: ${responseData.id}`);
                return responseData;
            }
        } else {
            console.error('[CIABRA] Erro ao criar cliente:', error.message);
        }
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
        const response = await axios.post(
            `${CIABRA_API_URL}/invoices/applications/invoices`,
            payload,
            { headers: { Authorization: `Basic ${authToken}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        console.log('[CIABRA] Cobrança criada com sucesso. ID:', response.data?.id);
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

async function generateCiabraPixWithAutomation(installmentId) {
    let page = null;
    try {
        addDebugLog('[CIABRA AUTOMATION] Iniciando automação para installment: ' + installmentId);
        const startTime = Date.now();

        const browser = await getOrCreateBrowser();
        addDebugLog(`[CIABRA AUTOMATION] Browser pronto em ${Date.now() - startTime}ms`);

        page = await browser.newPage();

        // Viewport mínimo para performance
        await page.setViewport({ width: 800, height: 600 });

        // Desabilitar cache e recursos desnecessários via request interception
        await page.setRequestInterception(true);

        let pixPaymentData = null;
        let pixResponsePromise = null;

        // Criar promise que resolve quando a resposta PIX chegar
        pixResponsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando resposta PIX (15s)')), 15000);

            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('/api/payments/pix')) {
                    try {
                        const data = await response.json();
                        addDebugLog('[CIABRA AUTOMATION] Capturado resposta do PIX');
                        pixPaymentData = data;
                        clearTimeout(timeout);
                        resolve(data);
                    } catch (e) {
                        addDebugLog('[CIABRA AUTOMATION] Erro ao parsear resposta: ' + e.message);
                    }
                }
            });
        });

        // Bloquear recursos desnecessários (imagens, fontes, CSS) para acelerar carregamento
        page.on('request', (request) => {
            if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        const paymentUrl = `https://pagar.ciabra.com.br/i/${installmentId}`;
        addDebugLog('[CIABRA AUTOMATION] Acessando: ' + paymentUrl);

        // domcontentloaded é mais rápido que networkidle2 — não precisamos esperar todos os recursos
        await page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        addDebugLog(`[CIABRA AUTOMATION] Página carregada em ${Date.now() - startTime}ms`);

        // Esperar o botão PIX aparecer no DOM em vez de delay fixo de 3s
        addDebugLog('[CIABRA AUTOMATION] Aguardando botão PIX aparecer...');
        let pixButton = null;

        try {
            // Espera até 5s pelo botão aparecer, verificando a cada 100ms via page.evaluate
            pixButton = await page.waitForFunction(() => {
                const buttons = document.querySelectorAll('button, a, div[onclick], [role="button"]');
                for (const btn of buttons) {
                    if (btn.textContent && btn.textContent.toUpperCase().includes('PIX')) {
                        return btn;
                    }
                }
                return null;
            }, { timeout: 5000 });
            addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via waitForFunction');
        } catch (e) {
            addDebugLog('[CIABRA AUTOMATION] waitForFunction para PIX falhou, tentando busca direta...');
        }

        // Fallback: busca direta se waitForFunction falhou
        if (!pixButton) {
            const allClickable = await page.$$('button, a, div[onclick], [role="button"]');
            for (const el of allClickable) {
                const text = await page.evaluate(e => e.textContent, el);
                if (text && text.toUpperCase().includes('PIX')) {
                    pixButton = el;
                    addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via busca direta');
                    break;
                }
            }
        }

        if (!pixButton) throw new Error('Botão PIX não encontrado na página');

        await pixButton.click();
        addDebugLog(`[CIABRA AUTOMATION] Clicou em PIX em ${Date.now() - startTime}ms`);

        // Esperar o botão "Pagar" aparecer no DOM em vez de delay fixo de 2s
        addDebugLog('[CIABRA AUTOMATION] Aguardando botão Pagar aparecer...');
        let pagarButton = null;

        try {
            pagarButton = await page.waitForFunction(() => {
                const elements = document.querySelectorAll('button, span[class*="Button"], div[onclick], [role="button"]');
                for (const el of elements) {
                    if (el.textContent && el.textContent.includes('Pagar')) {
                        return el;
                    }
                }
                return null;
            }, { timeout: 5000 });
            addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via waitForFunction');
        } catch (e) {
            addDebugLog('[CIABRA AUTOMATION] waitForFunction para Pagar falhou, tentando busca direta...');
        }

        // Fallback: busca direta
        if (!pagarButton) {
            const allClickable = await page.$$('button, span[class*="Button"], div[onclick], [role="button"]');
            for (const el of allClickable) {
                const text = await page.evaluate(e => e.textContent, el);
                if (text && text.includes('Pagar')) {
                    pagarButton = el;
                    addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via busca direta');
                    break;
                }
            }
        }

        if (!pagarButton) throw new Error('Botão Pagar não encontrado na página');

        // Clicar em Pagar e esperar a resposta real da API em vez de delay fixo de 5s
        await pagarButton.click();
        addDebugLog(`[CIABRA AUTOMATION] Clicou em Pagar em ${Date.now() - startTime}ms`);

        // Esperar a resposta real da API PIX (máx 15s) em vez de delay fixo de 5s
        addDebugLog('[CIABRA AUTOMATION] Aguardando resposta da API PIX...');
        await pixResponsePromise;

        const totalTime = Date.now() - startTime;
        addDebugLog(`[CIABRA AUTOMATION] Pagamento PIX gerado com sucesso em ${totalTime}ms!`);
        return pixPaymentData;

    } catch (error) {
        addDebugLog('[CIABRA AUTOMATION] ===== ERRO NA AUTOMAÇÃO =====');
        console.error('[CIABRA AUTOMATION] Error message:', error.message);
        console.error('[CIABRA AUTOMATION] ===============================');
        throw error;
    } finally {
        // Fecha apenas a página, não o browser (reutilizado)
        if (page) {
            try {
                await page.close();
            } catch (e) { /* página já fechada */ }
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
    debugLogs,
    addDebugLog,
    getCiabraAuthToken,
    getActivePaymentGateway,
    setActivePaymentGateway,
    createCiabraCustomer,
    createCiabraInvoice,
    generateCiabraPixWithAutomation,
    checkCiabraAuth,
    generateQrCodeBase64
};
