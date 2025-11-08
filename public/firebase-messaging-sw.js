// Scripts para inicializar o Firebase no Service Worker
// ATUALIZADO: Versão do Firebase atualizada de 9.6.1 para 10.7.0
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// NOTA: Service Workers têm limitações para buscar configuração dinamicamente no carregamento.
// As credenciais do Firebase aqui são públicas e devem ser protegidas via Firebase Security Rules.
// Em produção, garanta que apenas domínios autorizados possam usar estas credenciais.

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: "cinep-fb345.firebaseapp.com",
  projectId: "cinep-fb345",
  storageBucket: "cinep-fb345.firebasestorage.app",
  messagingSenderId: "961799456736",
  appId: "1:961799456736:web:3c67607bca49b853144d85"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Lida com notificações em segundo plano
messaging.onBackgroundMessage((payload) => {
  // NOVO: Log detalhado para quando a mensagem chega com o app fechado/minimizado
  console.log('%c[Service Worker] MENSAGEM RECEBIDA EM SEGUNDO PLANO:', 'color: blue; font-weight: bold;', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png' // Ícone que aparecerá na notificação
  };

  // self.registration.showNotification é o comando que cria a notificação visual
  return self.registration.showNotification(notificationTitle, notificationOptions);

});
