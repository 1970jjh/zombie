import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, remove, update } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

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
const auth = getAuth(app);

// 익명 인증 초기화 - Promise로 인증 완료를 추적
export const authReady: Promise<void> = new Promise((resolve, reject) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    if (user) {
      resolve();
    } else {
      // 로그인된 사용자가 없으면 익명 로그인 시도
      signInAnonymously(auth).then(() => resolve()).catch(reject);
    }
  });
});

// 세션 관련 함수들
export const sessionsRef = ref(database, 'sessions');

export const getSessionRef = (sessionId: string) => ref(database, `sessions/${sessionId}`);

export { database, auth, ref, onValue, set, remove, update };
