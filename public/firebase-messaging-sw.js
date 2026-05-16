importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCbfQFInBd9jIfw-6F-261i3y1hSK7T1dg",
  authDomain: "internal-bak.firebaseapp.com",
  projectId: "internal-bak",
  storageBucket: "internal-bak.firebasestorage.app",
  messagingSenderId: "12358920235",
  appId: "1:12358920235:web:7e181c72ad3f45f051a26e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/next.svg'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
