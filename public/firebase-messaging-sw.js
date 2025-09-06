// Scripts para inicializar o Firebase no Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-messaging-compat.js');

// NOVO: Log para confirmar que o service worker foi carregado pelo navegador
console.log('[Service Worker] Arquivo carregado e pronto para receber notificações.');

const firebaseConfig = {
  apiKey: "AIzaSyAt-gad4dCXjqRrs5aVozVxdYsiv5dDL4c",
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