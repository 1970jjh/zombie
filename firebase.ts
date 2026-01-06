import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, remove, update } from 'firebase/database';

// Firebase 설정 - 아래 값을 본인의 Firebase 프로젝트 설정으로 교체하세요!
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 세션 관련 함수들
export const sessionsRef = ref(database, 'sessions');

export const getSessionRef = (sessionId: string) => ref(database, `sessions/${sessionId}`);

export { database, ref, onValue, set, remove, update };
