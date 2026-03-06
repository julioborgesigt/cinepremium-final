const admin = require('firebase-admin');
const { AdminDevice } = require('../../models');

let isFirebaseInitialized = false;

function initFirebase() {
    try {
        const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;
        if (!base64Credentials) {
            throw new Error('A variável FIREBASE_CREDENTIALS_BASE64 não está definida.');
        }

        const serviceAccountString = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const serviceAccount = JSON.parse(serviceAccountString);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin SDK inicializado com sucesso via Base64.');
        isFirebaseInitialized = true;

    } catch (error) {
        console.error('❌ Erro CRÍTICO ao inicializar o Firebase Admin SDK:', error.message);
        console.warn('⚠️ As notificações push NÃO funcionarão.');
        isFirebaseInitialized = false;
    }
}

async function sendPushNotification(title, body) {
    if (!isFirebaseInitialized) {
        console.warn('[PUSH LOG] ⚠️ Firebase não está disponível. Notificação não será enviada.');
        return;
    }

    console.log(`--- [PUSH LOG] --- Iniciando envio de notificação: "${title}"`);

    try {
        const devices = await AdminDevice.findAll({
            attributes: ['token'],
            raw: true
        });

        const tokens = devices.map(device => device.token);

        if (tokens.length === 0) {
            console.log('[PUSH LOG] Nenhum dispositivo encontrado no banco de dados. Abortando envio.');
            return;
        }

        console.log(`[PUSH LOG] Encontrado(s) ${tokens.length} dispositivo(s)`);

        const message = {
            notification: {
                title: title,
                body: body,
            },
            tokens: tokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);

        console.log('[PUSH LOG] Resposta do Firebase recebida.');
        console.log('[PUSH LOG] Sucesso:', response.successCount);
        console.log('[PUSH LOG] Falha:', response.failureCount);

        if (response.failureCount > 0) {
            const tokensToRemove = [];

            response.responses.forEach((resp, index) => {
                if (!resp.success) {
                    console.error('[PUSH LOG] Detalhe da falha:', resp.error);
                    if (resp.error?.code === 'messaging/registration-token-not-registered' ||
                        resp.error?.code === 'messaging/invalid-registration-token') {
                        tokensToRemove.push(tokens[index]);
                    }
                }
            });

            if (tokensToRemove.length > 0) {
                try {
                    const deleted = await AdminDevice.destroy({
                        where: { token: tokensToRemove }
                    });
                    console.log(`[PUSH LOG] 🗑️  Removidos ${deleted} token(s) inválido(s) do banco de dados`);
                } catch (error) {
                    console.error('[PUSH LOG] Erro ao remover tokens inválidos:', error);
                }
            }
        }
        console.log('--- [PUSH LOG] --- Fim do processo de envio.');

    } catch (error) {
        console.error('[PUSH LOG] Erro CRÍTICO ao tentar enviar notificação:', error);
        console.log('--- [PUSH LOG] --- Fim do processo de envio com erro.');
    }
}

module.exports = {
    initFirebase,
    sendPushNotification,
    isInitialized: () => isFirebaseInitialized
};
