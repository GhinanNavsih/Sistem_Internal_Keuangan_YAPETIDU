import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import app from './firebase';

const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

export const requestPermission = async () => {
  if (!messaging) return null;
  
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY // Add this to your .env.local if you have one
      });
      console.log('FCM Token:', token);
      return token;
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
  }
  return null;
};

export const onMessageListener = () =>
  new Promise((resolve) => {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });
