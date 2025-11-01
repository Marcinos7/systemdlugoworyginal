import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCzvmsNg9FmfL1w-BxdwtO0E-qY0J7V3PM',
  authDomain: 'systemdlugow.firebaseapp.com',
  projectId: 'systemdlugow',
  storageBucket: 'systemdlugow.appspot.com',
  messagingSenderId: '1094952385361',
  appId: '1:1094952385361:web:ffb9635d9220b945e33170'
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);