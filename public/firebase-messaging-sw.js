// Scripts para inicializar o Firebase no Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-messaging-compat.js');

// Cole a mesma configuração do Firebase aqui (exceto a parte 'vapidKey' se houver)
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

// Opcional: Lidar com notificações em segundo plano, se necessário.
// Por padrão, o Firebase já exibe a notificação automaticamente.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/some-icon.png' // Opcional: ícone para a notificação
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});