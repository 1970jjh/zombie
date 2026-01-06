import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, remove, update } from 'firebase/database';

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyAbH9YUsku0fm8pXjk58rSnFBN5WBnxkhs",
  authDomain: "zombie-b2a13.firebaseapp.com",
  databaseURL: "https://zombie-b2a13-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zombie-b2a13",
  storageBucket: "zombie-b2a13.firebasestorage.app",
  messagingSenderId: "604991775962",
  appId: "1:604991775962:web:b4b3eddbc200aa8ae8b1e3"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 세션 관련 함수들
export const sessionsRef = ref(database, 'sessions');

export const getSessionRef = (sessionId: string) => ref(database, `sessions/${sessionId}`);

export { database, ref, onValue, set, remove, update };
