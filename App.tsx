
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GamePhase, UserRole, UserProfile, Session, Clue, SubmissionData, Participant, ChatEntry, MissionPhaseInfo, PersonalNote } from './types';
import { CLUES } from './constants';
import { sessionsRef, getSessionRef, onValue, set, remove, update, database, ref, authReady } from './firebase';

const CORRECT_ANSWER = {
  day: '일요일',
  ampm: '오전',
  hour: '09',
  minute: '30'
};

const ADMIN_PASSWORD = '6749467';

const distributeClues = (totalClues: Clue[], teamCount: number, myTeamNumber: number): Clue[] => {
  const base = Math.floor(totalClues.length / teamCount);
  const remainder = totalClues.length % teamCount;
  let start = 0;
  for (let i = 1; i <= teamCount; i++) {
    const count = base + (i <= remainder ? 1 : 0);
    if (i === myTeamNumber) {
      return totalClues.slice(start, start + count);
    }
    start += count;
  }
  return [];
};

// === 미션 페이즈 계산 (강사 제어 방식) ===
const computeMissionPhase = (session: Session, phaseElapsedSeconds: number): MissionPhaseInfo | null => {
  const phaseIndex = session.currentPhaseIndex ?? -1;
  if (phaseIndex < 0) return null;

  const totalCommPhases = (session.teamInternalRounds || 3) + (session.teamCrossRounds || 3);
  const totalPhases = totalCommPhases + 1;

  if (phaseIndex >= totalCommPhases) {
    const submitSec = (session.submitDuration || 10) * 60;
    return {
      type: 'SUBMIT',
      index: phaseIndex,
      roundNumber: 1,
      totalPhases,
      phaseRemaining: Math.max(0, submitSec - phaseElapsedSeconds),
      phaseProgress: submitSec > 0 ? Math.min(1, phaseElapsedSeconds / submitSec) : 1
    };
  }

  const isInternal = phaseIndex % 2 === 0;
  const roundSec = (session.roundDuration || 5) * 60;

  return {
    type: isInternal ? 'TEAM_INTERNAL' : 'TEAM_CROSS',
    index: phaseIndex,
    roundNumber: Math.floor(phaseIndex / 2) + 1,
    totalPhases,
    phaseRemaining: Math.max(0, roundSec - phaseElapsedSeconds),
    phaseProgress: roundSec > 0 ? Math.min(1, phaseElapsedSeconds / roundSec) : 1
  };
};

const formatTimer = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// === SVG 아이콘 ===
const HerbIcon = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 44" fill="none">
    <ellipse cx="20" cy="16" rx="14" ry="14" fill="url(#herbGlow)" opacity="0.5"/>
    <path d="M20 40 C20 40 20 28 20 20" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M20 34 C17 31 14 30 13 31 C12 32 14 33 17 32.5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <path d="M20 30 C23 27 26 26.5 27 27.5 C28 28.5 26 29 23 28.5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <path d="M20 24 Q14 18 12 20 Q10 22 16 22 Q18 22 20 20" fill="#7c3aed" opacity="0.6"/>
    <path d="M20 22 Q26 16 28 18 Q30 20 24 20 Q22 20 20 18" fill="#8b5cf6" opacity="0.5"/>
    <ellipse cx="16" cy="12" rx="3" ry="6" fill="#a855f7" opacity="0.5" transform="rotate(-30 16 12)"/>
    <ellipse cx="24" cy="12" rx="3" ry="6" fill="#a855f7" opacity="0.5" transform="rotate(30 24 12)"/>
    <ellipse cx="18" cy="10" rx="2.5" ry="5" fill="#c084fc" opacity="0.6" transform="rotate(-15 18 10)"/>
    <ellipse cx="22" cy="10" rx="2.5" ry="5" fill="#c084fc" opacity="0.6" transform="rotate(15 22 10)"/>
    <ellipse cx="20" cy="9" rx="3" ry="4" fill="#d8b4fe" opacity="0.7"/>
    <circle cx="20" cy="8" r="2.5" fill="#e9d5ff"/>
    <circle cx="20" cy="8" r="1.5" fill="#f3e8ff"/>
    <circle cx="20" cy="7.5" r="0.8" fill="#faf5ff"/>
    <defs>
      <radialGradient id="herbGlow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor="#c084fc" stopOpacity="0.6"/>
        <stop offset="60%" stopColor="#7c3aed" stopOpacity="0.2"/>
        <stop offset="100%" stopColor="#6b21a8" stopOpacity="0"/>
      </radialGradient>
    </defs>
  </svg>
);

const SunIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
);
const MoonIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
);
const FullscreenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
);
const ExitFullscreenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
);

// ========================================
//  메인 앱 컴포넌트
// ========================================
export default function App() {
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [adminPassInput, setAdminPassInput] = useState('');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: '', sessionId: '', teamNumber: 1 });
  const [phase, setPhase] = useState<GamePhase>(GamePhase.INTRO);

  const [isViewAllMode, setIsViewAllMode] = useState(false);
  const [selectedClue, setSelectedClue] = useState<Clue | null>(null);
  const [memo, setMemo] = useState('');
  const [submitData, setSubmitData] = useState({ day: '', ampm: '오전', hour: '00', minute: '00' });
  const memoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [participantId, setParticipantId] = useState<string>('');
  const [chatMessage, setChatMessage] = useState('');
  const [liveChatEntries, setLiveChatEntries] = useState<Record<string, ChatEntry>>({});
  const chatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try { return localStorage.getItem('zombie-theme') !== 'day'; } catch { return true; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [missionElapsed, setMissionElapsed] = useState(0);
  const [phaseElapsed, setPhaseElapsed] = useState(0);

  // 개인 메모
  const [personalNote, setPersonalNote] = useState('');
  const [personalNotes, setPersonalNotes] = useState<Record<string, PersonalNote>>({});
  const personalNoteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 정보카드 팝업 스와이프 인덱스
  const [cluePopupIndex, setCluePopupIndex] = useState(0);

  // 관리자 대시보드 상태
  const [adminView, setAdminView] = useState<'hub' | 'dashboard'>('hub');
  const [expandedTeamMemo, setExpandedTeamMemo] = useState<number | null>(null);
  const [adminTeamMemos, setAdminTeamMemos] = useState<Record<number, string>>({});

  // 미션 설정 상태 (관리자)
  const [cfgInternalRounds, setCfgInternalRounds] = useState(3);
  const [cfgCrossRounds, setCfgCrossRounds] = useState(3);
  const [cfgRoundDuration, setCfgRoundDuration] = useState(5);
  const [cfgSubmitDuration, setCfgSubmitDuration] = useState(10);

  // 페이즈 전환 알림
  const [phaseNotice, setPhaseNotice] = useState<string | null>(null);
  const prevPhaseIdx = useRef<number>(-1);

  // 부저/알람
  const buzzerPlayedRef = useRef<boolean>(false);

  // === 테마 & 전체화면 ===
  useEffect(() => {
    document.body.classList.toggle('theme-day', !isDarkMode);
    try { localStorage.setItem('zombie-theme', isDarkMode ? 'night' : 'day'); } catch {}
  }, [isDarkMode]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // === Firebase 인증 ===
  useEffect(() => {
    authReady
      .then(() => setIsAuthReady(true))
      .catch((err) => {
        console.error('Firebase 인증 실패:', err);
        setAuthError('Firebase 인증에 실패했습니다. 잠시 후 다시 시도해주세요.');
      });
  }, []);

  // === Firebase 실시간 동기화 ===
  useEffect(() => {
    if (!isAuthReady) return;
    const unsubscribe = onValue(sessionsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const arr: Session[] = Object.keys(data).map(key => ({
          ...data[key],
          id: key,
          participants: data[key].participants ? Object.values(data[key].participants) : [],
          submissions: data[key].submissions || {},
          isMissionStarted: data[key].isMissionStarted || false,
          missionStartedAt: data[key].missionStartedAt || 0,
          missionDuration: data[key].missionDuration || 60,
          isPaused: data[key].isPaused || false,
          pausedAt: data[key].pausedAt || 0,
          pausedElapsed: data[key].pausedElapsed || 0,
          currentPhaseIndex: data[key].currentPhaseIndex ?? -1,
          phaseStartedAt: data[key].phaseStartedAt || 0,
          isPhasePaused: data[key].isPhasePaused || false,
          phasePausedElapsed: data[key].phasePausedElapsed || 0,
          isSubmitEnabled: data[key].isSubmitEnabled || false,
          teamInternalRounds: data[key].teamInternalRounds || 3,
          teamCrossRounds: data[key].teamCrossRounds || 3,
          roundDuration: data[key].roundDuration || 5,
          submitDuration: data[key].submitDuration || 10,
          isAnswerRevealed: data[key].isAnswerRevealed || false,
          isSuccessRevealed: data[key].isSuccessRevealed || false,
          isResultReleased: data[key].isResultReleased || false,
          liveChat: data[key].liveChat || {},
          personalNotes: data[key].personalNotes || {}
        }));
        setSessions(arr);
      } else {
        setSessions([]);
      }
    }, (error) => {
      console.error('세션 데이터 읽기 실패:', error);
    });
    return () => unsubscribe();
  }, [isAuthReady]);

  // === 미션 타이머 ===
  const activeSession = sessions.find(s => s.id === (role === 'ADMIN' ? activeSessionId : userProfile.sessionId));

  // 전체 미션 경과 시간 (레거시 호환)
  useEffect(() => {
    if (!activeSession?.isMissionStarted || !activeSession?.missionStartedAt) {
      setMissionElapsed(0);
      prevPhaseIdx.current = -1;
      buzzerPlayedRef.current = false;
      return;
    }
    if (activeSession.isPaused) {
      setMissionElapsed(activeSession.pausedElapsed || 0);
      return;
    }
    const tick = () => {
      const rawElapsed = Math.floor((Date.now() - activeSession.missionStartedAt) / 1000);
      setMissionElapsed(rawElapsed);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.isMissionStarted, activeSession?.missionStartedAt, activeSession?.isPaused, activeSession?.pausedElapsed]);

  // === 페이즈 타이머 (강사 제어) ===
  useEffect(() => {
    if (!activeSession?.isMissionStarted || (activeSession.currentPhaseIndex ?? -1) < 0 || !activeSession.phaseStartedAt) {
      setPhaseElapsed(0);
      return;
    }
    if (activeSession.isPhasePaused) {
      setPhaseElapsed(activeSession.phasePausedElapsed || 0);
      return;
    }
    const tick = () => {
      setPhaseElapsed(Math.floor((Date.now() - activeSession.phaseStartedAt) / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.isMissionStarted, activeSession?.currentPhaseIndex, activeSession?.phaseStartedAt, activeSession?.isPhasePaused, activeSession?.phasePausedElapsed]);

  // 페이즈 전환 감지 (학습자)
  useEffect(() => {
    if (role !== 'STUDENT' || !activeSession?.isMissionStarted) return;
    const currentIdx = activeSession.currentPhaseIndex ?? -1;
    if (currentIdx < 0) return;
    const mp = computeMissionPhase(activeSession, phaseElapsed);
    if (!mp) return;
    if (mp.index !== prevPhaseIdx.current && prevPhaseIdx.current !== -1) {
      const label = mp.type === 'TEAM_INTERNAL' ? `팀 내 소통 ${mp.roundNumber}라운드` :
                    mp.type === 'TEAM_CROSS' ? `팀 간 소통 ${mp.roundNumber}라운드` :
                    '정답 제출 시간';
      setPhaseNotice(label);
      setTimeout(() => setPhaseNotice(null), 3000);
    }
    prevPhaseIdx.current = mp.index;
  }, [activeSession?.currentPhaseIndex, phaseElapsed, activeSession, role]);

  // === 페이즈 종료 시 부저/알람 ===
  const phaseBuzzerPlayedRef = useRef<number>(-1);
  useEffect(() => {
    if (!activeSession?.isMissionStarted || (activeSession.currentPhaseIndex ?? -1) < 0) return;
    const mp = computeMissionPhase(activeSession, phaseElapsed);
    if (!mp) return;
    if (mp.phaseRemaining <= 0 && phaseBuzzerPlayedRef.current !== mp.index) {
      phaseBuzzerPlayedRef.current = mp.index;
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const playTone = (freq: number, start: number, dur: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = 'square';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.3, audioCtx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + start + dur);
          osc.start(audioCtx.currentTime + start);
          osc.stop(audioCtx.currentTime + start + dur);
        };
        playTone(880, 0, 0.3);
        playTone(880, 0.4, 0.3);
        playTone(1100, 0.8, 0.6);
      } catch (e) { console.log('Audio not supported'); }
    }
  }, [phaseElapsed, activeSession]);

  // === 학습자: 결과 발표 감시 ===
  useEffect(() => {
    if (role !== 'STUDENT' || !userProfile.sessionId) return;
    const currentSession = sessions.find(s => s.id === userProfile.sessionId);
    if (!currentSession) return;
    if (currentSession.isResultReleased) {
      setPhase(GamePhase.RESULT);
      return;
    }
    const hasTeamSubmitted = !!currentSession.submissions[userProfile.teamNumber];
    if (hasTeamSubmitted && (phase === GamePhase.STORY || phase === GamePhase.MAIN_GAME || phase === GamePhase.SUBMIT)) {
      setPhase(GamePhase.CHECKING);
    }
  }, [sessions, phase, role, userProfile.sessionId, userProfile.teamNumber]);

  useEffect(() => {
    setSubmitData({ day: '', ampm: '오전', hour: '00', minute: '00' });
  }, [userProfile.sessionId]);

  // === 메모 동기화 ===
  useEffect(() => {
    if (!userProfile.sessionId || !userProfile.teamNumber) { setMemo(''); return; }
    setMemo('');
    const memoRef = ref(database, `sessions/${userProfile.sessionId}/memos/${userProfile.teamNumber}`);
    const unsubscribe = onValue(memoRef, (snapshot) => { setMemo(snapshot.val() || ''); });
    return () => unsubscribe();
  }, [userProfile.sessionId, userProfile.teamNumber]);

  // === 채팅 동기화 ===
  useEffect(() => {
    if (!userProfile.sessionId || !isAuthReady) { setLiveChatEntries({}); return; }
    const chatRef = ref(database, `sessions/${userProfile.sessionId}/liveChat`);
    const unsubscribe = onValue(chatRef, (snapshot) => { setLiveChatEntries(snapshot.val() || {}); });
    return () => unsubscribe();
  }, [userProfile.sessionId, isAuthReady]);

  // === 개인 메모 동기화 ===
  useEffect(() => {
    if (!userProfile.sessionId || !isAuthReady) { setPersonalNotes({}); return; }
    const notesRef = ref(database, `sessions/${userProfile.sessionId}/personalNotes`);
    const unsubscribe = onValue(notesRef, (snapshot) => { setPersonalNotes(snapshot.val() || {}); });
    return () => unsubscribe();
  }, [userProfile.sessionId, isAuthReady]);

  // === 관리자 메모 동기화 ===
  useEffect(() => {
    if (role !== 'ADMIN' || !activeSessionId || adminView !== 'dashboard') { setAdminTeamMemos({}); return; }
    const memosRef = ref(database, `sessions/${activeSessionId}/memos`);
    const unsubscribe = onValue(memosRef, (snapshot) => { setAdminTeamMemos(snapshot.val() || {}); });
    return () => unsubscribe();
  }, [role, activeSessionId, adminView]);

  useEffect(() => {
    if (role === 'ADMIN' && adminView === 'dashboard' && activeSessionId) {
      const sessionExists = sessions.some(s => s.id === activeSessionId);
      if (!sessionExists && isAuthReady) {
        setAdminView('hub');
        setActiveSessionId(null);
        setExpandedTeamMemo(null);
      }
    }
  }, [sessions, role, adminView, activeSessionId, isAuthReady]);

  // === 핸들러 ===
  const handleMemoChange = (newMemo: string) => {
    setMemo(newMemo);
    if (memoTimeoutRef.current) clearTimeout(memoTimeoutRef.current);
    memoTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && userProfile.teamNumber) {
        try {
          await update(getSessionRef(userProfile.sessionId), { [`memos/${userProfile.teamNumber}`]: newMemo });
        } catch (err) { console.error('메모 저장 실패:', err); }
      }
    }, 300);
  };

  const handleChatChange = (newMessage: string) => {
    setChatMessage(newMessage);
    if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current);
    chatTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && participantId) {
        try {
          await update(getSessionRef(userProfile.sessionId), {
            [`liveChat/${participantId}`]: { name: userProfile.name, teamNumber: userProfile.teamNumber, message: newMessage }
          });
        } catch (err) { console.error('채팅 저장 실패:', err); }
      }
    }, 300);
  };

  // === 개인 메모 핸들러 ===
  const handlePersonalNoteChange = (text: string) => {
    setPersonalNote(text);
    if (personalNoteTimeoutRef.current) clearTimeout(personalNoteTimeoutRef.current);
    personalNoteTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && participantId) {
        try {
          await update(getSessionRef(userProfile.sessionId), {
            [`personalNotes/${participantId}`]: { name: userProfile.name, teamNumber: userProfile.teamNumber, text }
          });
        } catch (err) { console.error('개인 메모 저장 실패:', err); }
      }
    }, 300);
  };

  const myClues = useMemo(() => {
    if (!activeSession) return [];
    if (isViewAllMode) return CLUES;
    return distributeClues(CLUES, activeSession.teamCount, userProfile.teamNumber);
  }, [activeSession, userProfile.teamNumber, isViewAllMode]);

  // === CRUD ===
  const createSession = async (name: string, teams: number) => {
    const sessionId = Math.random().toString(36).substr(2, 6).toUpperCase();
    try {
      await set(getSessionRef(sessionId), {
        groupName: name,
        teamCount: teams,
        isOpen: false,
        isMissionStarted: false,
        missionStartedAt: 0,
        missionDuration: 60,
        isPaused: false,
        pausedAt: 0,
        pausedElapsed: 0,
        currentPhaseIndex: -1,
        phaseStartedAt: 0,
        isPhasePaused: false,
        phasePausedElapsed: 0,
        isSubmitEnabled: false,
        teamInternalRounds: 3,
        teamCrossRounds: 3,
        roundDuration: 5,
        submitDuration: 10,
        isAnswerRevealed: false,
        isSuccessRevealed: false,
        isResultReleased: false,
        submissions: {},
        participants: {},
        liveChat: {},
        personalNotes: {},
        createdAt: Date.now()
      });
      setActiveSessionId(sessionId);
      setAdminView('dashboard');
      setExpandedTeamMemo(null);
    } catch (err) {
      console.error('세션 생성 실패:', err);
      alert('세션 생성에 실패했습니다.');
    }
  };

  const registerParticipant = async () => {
    if (!userProfile.sessionId || !userProfile.name) return;
    const session = sessions.find(s => s.id === userProfile.sessionId);
    if (!session) return;
    const alreadyJoined = session.participants.some(p => p.name === userProfile.name && p.teamNumber === userProfile.teamNumber);
    if (!alreadyJoined) {
      const newId = Date.now().toString();
      try {
        await update(getSessionRef(userProfile.sessionId), {
          [`participants/${newId}`]: { name: userProfile.name, teamNumber: userProfile.teamNumber, joinedAt: Date.now() }
        });
        setParticipantId(newId);
      } catch (err) {
        console.error('참가자 등록 실패:', err);
        alert('참가 등록에 실패했습니다.');
        return;
      }
    } else {
      if (!participantId) setParticipantId(Date.now().toString());
    }
    setChatMessage('');
    setPhase(GamePhase.STORY);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassInput === ADMIN_PASSWORD) { setIsAdminAuth(true); setAdminPassInput(''); }
    else { alert('접근 권한이 없습니다.'); setAdminPassInput(''); }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile.sessionId) return;
    try {
      await update(getSessionRef(userProfile.sessionId), {
        [`submissions/${userProfile.teamNumber}`]: { ...submitData, userName: userProfile.name, submittedAt: Date.now() }
      });
      setPhase(GamePhase.CHECKING);
    } catch (err) {
      console.error('제출 실패:', err);
      alert('답안 제출에 실패했습니다.');
    }
  };

  const toggleSessionOpen = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      try { await update(getSessionRef(id), { isOpen: !session.isOpen }); }
      catch (err) { console.error('세션 상태 변경 실패:', err); }
    }
  };

  const startMission = async (id: string) => {
    const totalMin = (cfgInternalRounds + cfgCrossRounds) * cfgRoundDuration + cfgSubmitDuration;
    try {
      await update(getSessionRef(id), {
        isMissionStarted: true,
        missionStartedAt: Date.now(),
        missionDuration: totalMin,
        teamInternalRounds: cfgInternalRounds,
        teamCrossRounds: cfgCrossRounds,
        roundDuration: cfgRoundDuration,
        submitDuration: cfgSubmitDuration,
        currentPhaseIndex: -1,
        phaseStartedAt: 0,
        isPhasePaused: false,
        phasePausedElapsed: 0,
        isSubmitEnabled: false
      });
    } catch (err) {
      console.error('미션 시작 실패:', err);
      alert('미션 시작에 실패했습니다.');
    }
  };

  // === 강사 페이즈 제어 ===
  const startPhase = async (id: string, phaseIndex: number) => {
    try {
      await update(getSessionRef(id), {
        currentPhaseIndex: phaseIndex,
        phaseStartedAt: Date.now(),
        isPhasePaused: false,
        phasePausedElapsed: 0
      });
    } catch (err) { console.error('페이즈 시작 실패:', err); }
  };

  const pausePhase = async (id: string) => {
    try {
      await update(getSessionRef(id), {
        isPhasePaused: true,
        phasePausedElapsed: phaseElapsed
      });
    } catch (err) { console.error('페이즈 일시정지 실패:', err); }
  };

  const resumePhase = async (id: string) => {
    if (!activeSession) return;
    try {
      const newStartedAt = Date.now() - ((activeSession.phasePausedElapsed || 0) * 1000);
      await update(getSessionRef(id), {
        isPhasePaused: false,
        phaseStartedAt: newStartedAt
      });
    } catch (err) { console.error('페이즈 재개 실패:', err); }
  };

  const toggleSubmitEnabled = async (id: string) => {
    if (!activeSession) return;
    try {
      await update(getSessionRef(id), { isSubmitEnabled: !activeSession.isSubmitEnabled });
    } catch (err) { console.error('제출 허용 변경 실패:', err); }
  };

  const pauseMission = async (id: string) => {
    try {
      await update(getSessionRef(id), {
        isPaused: true,
        pausedAt: Date.now(),
        pausedElapsed: missionElapsed
      });
    } catch (err) { console.error('타이머 일시정지 실패:', err); }
  };

  const resumeMission = async (id: string) => {
    if (!activeSession) return;
    try {
      const newStartedAt = Date.now() - (activeSession.pausedElapsed * 1000);
      await update(getSessionRef(id), {
        isPaused: false,
        pausedAt: 0,
        missionStartedAt: newStartedAt
      });
    } catch (err) { console.error('타이머 재개 실패:', err); }
  };

  const revealAnswers = async (id: string) => {
    try { await update(getSessionRef(id), { isAnswerRevealed: true }); }
    catch (err) { console.error('정답 공개 실패:', err); }
  };

  const revealSuccess = async (id: string) => {
    try { await update(getSessionRef(id), { isSuccessRevealed: true }); }
    catch (err) { console.error('성공여부 공개 실패:', err); }
  };

  const releaseResults = async (id: string) => {
    try { await update(getSessionRef(id), { isResultReleased: true }); }
    catch (err) { console.error('결과 발표 실패:', err); }
  };

  const resetSession = async (id: string) => {
    try {
      await update(getSessionRef(id), {
        isMissionStarted: false, missionStartedAt: 0, missionDuration: 60,
        isPaused: false, pausedAt: 0, pausedElapsed: 0,
        currentPhaseIndex: -1, phaseStartedAt: 0, isPhasePaused: false, phasePausedElapsed: 0,
        isSubmitEnabled: false,
        isAnswerRevealed: false, isSuccessRevealed: false, isResultReleased: false,
        submissions: {}, participants: {}, liveChat: {}, personalNotes: {}
      });
    } catch (err) { console.error('세션 초기화 실패:', err); }
  };

  const deleteSession = async (id: string) => {
    if (confirm('이 교육 그룹을 삭제하시겠습니까?')) {
      try {
        await remove(getSessionRef(id));
        if (activeSessionId === id) { setAdminView('hub'); setActiveSessionId(null); setExpandedTeamMemo(null); }
      } catch (err) { console.error('세션 삭제 실패:', err); }
    }
  };

  const isTeamCorrect = (sub: SubmissionData) => {
    return sub.day === CORRECT_ANSWER.day && sub.ampm === CORRECT_ANSWER.ampm && sub.hour === CORRECT_ANSWER.hour && sub.minute === CORRECT_ANSWER.minute;
  };

  const isMyTeamCorrect = useMemo(() => {
    if (!activeSession) return false;
    const mySub = activeSession.submissions[userProfile.teamNumber];
    if (!mySub) return false;
    return isTeamCorrect(mySub);
  }, [activeSession, userProfile.teamNumber]);

  // === 프로세스 스텝 컴포넌트 (강사 제어 기반) ===
  const ProcessSteps = ({ session, currentPhaseElapsed }: { session: Session; currentPhaseElapsed: number }) => {
    const totalComm = (session.teamInternalRounds || 3) + (session.teamCrossRounds || 3);
    const roundSec = (session.roundDuration || 5) * 60;
    const currentIdx = session.currentPhaseIndex ?? -1;

    const steps: { label: string; shortLabel: string; type: string; active: boolean; done: boolean; progress: number }[] = [];
    for (let i = 0; i < totalComm; i++) {
      const isInternal = i % 2 === 0;
      const stepProgress = i < currentIdx ? 1 : i === currentIdx ? Math.min(1, currentPhaseElapsed / roundSec) : 0;
      steps.push({
        label: isInternal ? `팀 내 소통 ${Math.floor(i / 2) + 1}` : `팀 간 소통 ${Math.floor(i / 2) + 1}`,
        shortLabel: isInternal ? `팀내${Math.floor(i / 2) + 1}` : `팀간${Math.floor(i / 2) + 1}`,
        type: isInternal ? 'internal' : 'cross',
        active: i === currentIdx,
        done: i < currentIdx,
        progress: stepProgress
      });
    }
    const submitSec = (session.submitDuration || 10) * 60;
    const submitProgress = currentIdx >= totalComm ? Math.min(1, currentPhaseElapsed / submitSec) : 0;
    steps.push({
      label: '정답 제출',
      shortLabel: '정답제출',
      type: 'submit',
      active: currentIdx >= totalComm,
      done: false,
      progress: submitProgress
    });

    return (
      <div className="mission-steps-bar">
        {steps.map((step, i) => (
          <div key={i} className={`mission-step ${step.active ? 'active' : step.done ? 'done' : 'pending'} ${step.type}`} style={{ flex: step.type === 'submit' ? 1.3 : 1 }}>
            <div className="mission-step-fill" style={{ width: `${(step.done ? 1 : step.progress) * 100}%` }} />
            <div className="mission-step-content">
              <span className="mission-step-num">{step.done ? '✓' : i + 1}</span>
              <span className="mission-step-label">{step.shortLabel}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // === 진도율 바 ===
  const ProgressBar = ({ session }: { session: Session }) => {
    const totalCommPhases = (session.teamInternalRounds || 3) + (session.teamCrossRounds || 3);
    const totalPhases = totalCommPhases + 1;
    const currentIdx = session.currentPhaseIndex ?? -1;
    const completedPhases = Math.max(0, currentIdx);
    const mp = currentIdx >= 0 ? computeMissionPhase(session, phaseElapsed) : null;
    const currentProgress = mp ? mp.phaseProgress : 0;
    const progress = totalPhases > 0 ? Math.min(1, (completedPhases + currentProgress) / totalPhases) : 0;
    const totalSeconds = session.missionDuration * 60;
    const estimatedElapsed = progress * totalSeconds;
    const remaining = Math.max(0, totalSeconds - estimatedElapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    const isUrgent = remaining < totalSeconds * 0.2;
    const isExpired = currentIdx >= totalCommPhases && mp && mp.phaseRemaining <= 0;

    return (
      <div className="space-y-2">
        <div className="flex justify-between items-end">
          <div>
            <span className={`font-poster text-2xl ${isUrgent ? 'animate-pulse' : ''}`} style={{ color: isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : 'var(--text-primary)' }}>
              {isExpired ? '시간 종료!' : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
            </span>
            <span className="font-mono text-xs ml-3 opacity-60 font-bold">/ {session.missionDuration}분</span>
          </div>
          <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{Math.round(progress * 100)}%</span>
        </div>
        <div className="progress-track" style={{ background: isDarkMode ? '#1a1a2e' : '#e4e4e7' }}>
          <div className="progress-fill" style={{ width: `${progress * 100}%`, background: isUrgent ? 'linear-gradient(90deg, #dc2626, #f59e0b)' : 'linear-gradient(90deg, #7c3aed, #a855f7, #e11d48)', opacity: 0.4 }} />
          <div className="progress-icon-team" style={{ left: `${Math.min(progress * 82, 82)}%` }}>
            <span role="img" aria-label="team">🏃‍♂️</span>
          </div>
          <div className="progress-icon-zombie">
            <span role="img" aria-label="zombie">🧟</span>
          </div>
          {[25, 50, 75].map(pct => (
            <div key={pct} className="absolute top-0 bottom-0 w-px opacity-20" style={{ left: `${pct}%`, background: 'var(--border-primary)' }} />
          ))}
        </div>
      </div>
    );
  };

  // === 헤더 컨트롤 ===
  const HeaderControls = () => (
    <div className="flex items-center gap-1">
      <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-10 h-10 flex items-center justify-center border-2 transition-all hover:scale-110" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }} title={isDarkMode ? '데이 모드' : '나이트 모드'}>
        {isDarkMode ? <SunIcon /> : <MoonIcon />}
      </button>
      <button onClick={toggleFullscreen} className="w-10 h-10 flex items-center justify-center border-2 transition-all hover:scale-110" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }} title={isFullscreen ? '전체화면 해제' : '전체화면'}>
        {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
      </button>
    </div>
  );

  // ============================
  //       관리자 뷰
  // ============================
  const renderAdmin = () => {
    if (!isAdminAuth) {
      return (
        <div className="flex items-center justify-center min-h-[80vh] px-6">
          <form onSubmit={handleAdminLogin} className="brutal-card p-10 w-full max-w-sm space-y-6">
            <h2 className="text-3xl font-poster tracking-tighter text-center" style={{ color: 'var(--text-primary)' }}>관리자 로그인</h2>
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>비밀번호를 입력하세요</label>
              <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} placeholder="비밀번호" className="brutal-input w-full text-center tracking-widest text-2xl font-poster" />
            </div>
            <button className="brutal-btn w-full py-4 text-xl">로그인</button>
          </form>
        </div>
      );
    }

    // === 대시보드 ===
    if (adminView === 'dashboard' && activeSessionId) {
      const s = sessions.find(ss => ss.id === activeSessionId);
      if (!s) return null;

      const submittedCount = Object.keys(s.submissions).length;
      const totalParticipants = s.participants.length;
      const mp = s.isMissionStarted && (s.currentPhaseIndex ?? -1) >= 0 ? computeMissionPhase(s, phaseElapsed) : null;
      const totalCommPhases = (s.teamInternalRounds || 3) + (s.teamCrossRounds || 3);
      const allPhaseLabels: { label: string; type: string }[] = [];
      for (let pi = 0; pi < totalCommPhases; pi++) {
        const isInt = pi % 2 === 0;
        allPhaseLabels.push({
          label: isInt ? `팀 내 소통 ${Math.floor(pi / 2) + 1}` : `팀 간 소통 ${Math.floor(pi / 2) + 1}`,
          type: isInt ? 'internal' : 'cross'
        });
      }
      allPhaseLabels.push({ label: '정답 제출', type: 'submit' });

      // 순위 계산
      const correctTeams = (Object.entries(s.submissions) as [string, SubmissionData][])
        .filter(([, sub]) => isTeamCorrect(sub))
        .sort(([, a], [, b]) => (a.submittedAt || 0) - (b.submittedAt || 0));

      return (
        <div className="animate-fade-in min-h-[calc(100vh-80px)] flex flex-col">
          {/* 상단 바 */}
          <div className="border-b-4 px-6 py-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <button onClick={() => { setAdminView('hub'); setExpandedTeamMemo(null); }} className="font-mono text-base font-bold shrink-0 hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>&larr; 목록</button>
                <div className="min-w-0">
                  <h2 className="font-poster text-3xl truncate" style={{ color: 'var(--text-primary)' }}>{s.groupName}</h2>
                  <div className="flex gap-4 items-center mt-1">
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>코드: <span style={{ color: 'var(--text-primary)' }}>{s.id}</span></span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>참가: <span style={{ color: 'var(--text-primary)' }}>{totalParticipants}명</span></span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>제출: <span className="text-emerald-500">{submittedCount}</span>/{s.teamCount}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <button onClick={() => toggleSessionOpen(s.id)} className={`px-5 py-2.5 font-poster text-base border-4 transition-all ${s.isOpen ? 'bg-emerald-600 border-emerald-400 text-white shadow-[3px_3px_0px_var(--shadow-color)]' : 'border-2 shadow-[3px_3px_0px_var(--shadow-color)]'}`} style={!s.isOpen ? { background: 'var(--bg-card)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' } : {}}>
                  {s.isOpen ? '입장 허용 중' : '입장 대기'}
                </button>
                <button onClick={() => resetSession(s.id)} className="px-3 py-2.5 font-mono text-sm font-bold border-2 hover:opacity-70" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>초기화</button>
                <button onClick={() => deleteSession(s.id)} className="px-3 py-2.5 font-mono text-sm font-bold bg-red-950 border-2 border-red-800 text-red-400 hover:text-white hover:border-red-500 transition-colors">삭제</button>
              </div>
            </div>
          </div>

          {/* 벤토 그리드 메인 */}
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="max-w-7xl mx-auto grid grid-cols-12 gap-4">

              {/* === 미션 설정 / 진행 현황 (전체 너비) === */}
              <div className="col-span-12 bento-card">
                {!s.isMissionStarted ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <HerbIcon size={24} />
                      <h3 className="font-poster text-xl" style={{ color: 'var(--text-primary)' }}>미션 설정</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>팀 내 소통</label>
                        <select value={cfgInternalRounds} onChange={e => setCfgInternalRounds(+e.target.value)} className="brutal-input w-full py-2 text-center font-poster text-lg">
                          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}회</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>팀 간 소통</label>
                        <select value={cfgCrossRounds} onChange={e => setCfgCrossRounds(+e.target.value)} className="brutal-input w-full py-2 text-center font-poster text-lg">
                          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}회</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>라운드 시간</label>
                        <select value={cfgRoundDuration} onChange={e => setCfgRoundDuration(+e.target.value)} className="brutal-input w-full py-2 text-center font-poster text-lg">
                          {[3, 5, 7, 10, 15, 20].map(n => <option key={n} value={n}>{n}분</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>제출 시간</label>
                        <select value={cfgSubmitDuration} onChange={e => setCfgSubmitDuration(+e.target.value)} className="brutal-input w-full py-2 text-center font-poster text-lg">
                          {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n}분</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t-2" style={{ borderColor: 'var(--border-secondary)' }}>
                      <div>
                        <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>총 소요 시간: </span>
                        <span className="font-poster text-xl text-purple-400">{(cfgInternalRounds + cfgCrossRounds) * cfgRoundDuration + cfgSubmitDuration}분</span>
                        <span className="font-mono text-[10px] ml-2" style={{ color: 'var(--text-secondary)' }}>
                          (팀내{cfgInternalRounds} + 팀간{cfgCrossRounds}) × {cfgRoundDuration}분 + 제출{cfgSubmitDuration}분
                        </span>
                      </div>
                      <button onClick={() => startMission(s.id)} className="px-8 py-3 font-poster text-xl border-4 bg-purple-600 border-purple-400 text-white shadow-[4px_4px_0px_var(--shadow-color)] hover:bg-purple-500 animate-pulse transition-all">
                        미션 시작
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`w-3 h-3 ${s.isPhasePaused ? 'bg-yellow-500' : 'bg-purple-500 animate-pulse'} border-2`} style={{ borderColor: 'var(--border-primary)' }}></span>
                      <h3 className="font-poster text-xl" style={{ color: 'var(--text-primary)' }}>미션 진행 현황</h3>
                      {s.isPhasePaused && <span className="font-mono text-xs font-bold px-2 py-0.5 bg-yellow-600 text-yellow-100 border-2 border-yellow-400">일시정지</span>}
                      {mp && (
                        <span className={`px-3 py-1 font-mono text-xs font-bold border-2 ml-2 ${mp.type === 'TEAM_INTERNAL' ? 'bg-purple-900 border-purple-500 text-purple-300' : mp.type === 'TEAM_CROSS' ? 'bg-blue-900 border-blue-500 text-blue-300' : 'bg-red-900 border-red-500 text-red-300'}`}>
                          {mp.type === 'TEAM_INTERNAL' ? `팀 내 소통 ${mp.roundNumber}` : mp.type === 'TEAM_CROSS' ? `팀 간 소통 ${mp.roundNumber}` : '정답 제출'} | {formatTimer(Math.floor(mp.phaseRemaining))}
                        </span>
                      )}
                    </div>

                    {/* 페이즈별 제어 버튼 */}
                    <div className="space-y-2">
                      {allPhaseLabels.map((phase, idx) => {
                        const currentIdx = s.currentPhaseIndex ?? -1;
                        const isDone = idx < currentIdx;
                        const isActive = idx === currentIdx;
                        const isPending = idx > currentIdx;
                        const isNext = idx === currentIdx + 1;
                        const phaseColor = phase.type === 'internal' ? 'purple' : phase.type === 'cross' ? 'blue' : 'red';
                        const phaseTimeExpired = isActive && mp && mp.phaseRemaining <= 0;

                        return (
                          <div key={idx} className={`flex items-center gap-3 px-4 py-3 border-2 transition-all ${isDone ? 'opacity-60' : ''} ${isActive ? `border-${phaseColor}-500` : ''}`} style={{ borderColor: isActive ? undefined : 'var(--border-secondary)', background: isActive ? (phase.type === 'internal' ? 'rgba(124,58,237,0.15)' : phase.type === 'cross' ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)') : 'var(--bg-secondary)' }}>
                            <span className={`w-8 h-8 flex items-center justify-center font-poster text-sm border-2 ${isDone ? 'bg-emerald-600 border-emerald-400 text-white' : isActive ? `bg-${phaseColor}-600 border-${phaseColor}-400 text-white` : ''}`} style={!isDone && !isActive ? { background: 'var(--bg-card)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' } : {}}>
                              {isDone ? '✓' : idx + 1}
                            </span>
                            <span className={`font-poster text-base flex-1 ${isActive ? 'text-white' : ''}`} style={!isActive ? { color: 'var(--text-primary)' } : {}}>
                              {phase.label}
                            </span>
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                              {phase.type === 'submit' ? `${s.submitDuration || 10}분` : `${s.roundDuration || 5}분`}
                            </span>
                            {/* 현재 활성 페이즈 타이머 */}
                            {isActive && mp && (
                              <span className={`font-mono text-lg font-bold ${phaseTimeExpired ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                                {phaseTimeExpired ? '시간 종료!' : formatTimer(Math.floor(mp.phaseRemaining))}
                              </span>
                            )}
                            {/* 제어 버튼 */}
                            <div className="flex items-center gap-1">
                              {isActive && !phaseTimeExpired && (
                                <button
                                  onClick={() => s.isPhasePaused ? resumePhase(s.id) : pausePhase(s.id)}
                                  className={`px-3 py-1.5 font-poster text-sm border-2 transition-all ${s.isPhasePaused ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-yellow-600 border-yellow-400 text-white'}`}
                                >
                                  {s.isPhasePaused ? '▶' : '⏸'}
                                </button>
                              )}
                              {(isNext || (isPending && idx === 0 && currentIdx === -1)) && (
                                <button
                                  onClick={() => startPhase(s.id, idx)}
                                  className={`px-4 py-1.5 font-poster text-sm border-2 bg-${phaseColor}-600 border-${phaseColor}-400 text-white hover:opacity-80 transition-all animate-pulse`}
                                >
                                  ▶ 시작
                                </button>
                              )}
                              {isActive && phaseTimeExpired && idx < allPhaseLabels.length - 1 && (
                                <button
                                  onClick={() => startPhase(s.id, idx + 1)}
                                  className="px-4 py-1.5 font-poster text-sm border-2 bg-emerald-600 border-emerald-400 text-white hover:opacity-80 transition-all animate-pulse"
                                >
                                  다음 ▶
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 제출 허용 토글 */}
                    <div className="flex items-center justify-between pt-3 border-t-2" style={{ borderColor: 'var(--border-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 ${s.isSubmitEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-red-600'} border-2`} style={{ borderColor: 'var(--border-primary)' }}></span>
                        <span className="font-poster text-base" style={{ color: 'var(--text-primary)' }}>정답 제출</span>
                        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                          {s.isSubmitEnabled ? '학습자 제출 가능' : '학습자 제출 불가'}
                        </span>
                      </div>
                      <button
                        onClick={() => toggleSubmitEnabled(s.id)}
                        className={`px-5 py-2 font-poster text-sm border-3 transition-all ${s.isSubmitEnabled ? 'bg-red-600 border-red-400 text-white' : 'bg-emerald-600 border-emerald-400 text-white'}`}
                        style={{ boxShadow: '3px 3px 0px var(--shadow-color)' }}
                      >
                        {s.isSubmitEnabled ? '제출 잠금' : '제출 허용'}
                      </button>
                    </div>

                    <ProcessSteps session={s} currentPhaseElapsed={phaseElapsed} />
                    <ProgressBar session={s} />
                  </div>
                )}
              </div>

              {/* === 조별 현황 (왼쪽) === */}
              <div className="col-span-12 lg:col-span-7 bento-card">
                <h3 className="font-poster text-lg mb-3" style={{ color: 'var(--text-primary)' }}>조별 현황</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Array.from({ length: s.teamCount }, (_, i) => i + 1).map(tNum => {
                    const teamP = s.participants.filter(p => p.teamNumber === tNum);
                    const hasSub = !!s.submissions[tNum];
                    const isMemoOpen = expandedTeamMemo === tNum;
                    const teamMemo = adminTeamMemos[tNum] || '';
                    return (
                      <div key={tNum} className={`border-3 transition-all ${hasSub ? 'border-emerald-500 bg-emerald-950/30' : ''}`} style={!hasSub ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)', borderWidth: '3px' } : { borderWidth: '3px' }}>
                        <div className={`px-3 py-2 flex justify-between items-center ${hasSub ? 'bg-emerald-900/40' : ''}`} style={!hasSub ? { background: 'var(--bg-secondary)' } : {}}>
                          <span className="font-poster text-lg" style={{ color: hasSub ? '#fff' : 'var(--text-primary)' }}>{tNum}팀</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{teamP.length}명</span>
                            {hasSub && <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse"></span>}
                          </div>
                        </div>
                        <div className="px-3 py-2 min-h-[50px]">
                          {teamP.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {teamP.map((p, idx) => (
                                <span key={idx} className="text-[11px] font-mono font-bold px-2 py-0.5 border" style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}>{p.name}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] font-mono italic" style={{ color: 'var(--text-secondary)' }}>대기 중</span>
                          )}
                        </div>
                        <div className="border-t" style={{ borderColor: 'var(--border-secondary)' }}>
                          <button onClick={() => setExpandedTeamMemo(isMemoOpen ? null : tNum)} className="w-full px-3 py-2 flex justify-between items-center text-[11px] font-mono font-bold hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>
                            <span>메모</span><span>{isMemoOpen ? '▲' : '▼'}</span>
                          </button>
                          {isMemoOpen && (
                            <div className="px-3 pb-2">
                              <div className="border p-2 max-h-24 overflow-y-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                                <pre className="text-[11px] font-mono text-green-500 whitespace-pre-wrap break-words">{teamMemo || '(없음)'}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* === 조별 답안 (오른쪽) === */}
              <div className="col-span-12 lg:col-span-5 bento-card">
                <h3 className="font-poster text-lg mb-3" style={{ color: 'var(--text-primary)' }}>조별 답안</h3>
                <div className="space-y-2 mb-4">
                  {Array.from({ length: s.teamCount }, (_, i) => i + 1).map(tNum => {
                    const sub = s.submissions[tNum];
                    const correct = sub ? isTeamCorrect(sub) : false;
                    return (
                      <div key={tNum} className="flex items-center gap-3 px-3 py-2.5 border-2" style={{ borderColor: 'var(--border-secondary)', background: 'var(--bg-secondary)' }}>
                        <span className="font-poster text-base w-10 shrink-0" style={{ color: 'var(--text-primary)' }}>{tNum}팀</span>
                        {sub ? (
                          <>
                            {!s.isAnswerRevealed ? (
                              <span className="font-mono text-sm font-bold px-3 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700">비공개</span>
                            ) : (
                              <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                {sub.day} {sub.ampm} {sub.hour}:{sub.minute}
                              </span>
                            )}
                            {s.isSuccessRevealed && (
                              <span className={`ml-auto font-poster text-sm px-2 py-0.5 border-2 ${correct ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-red-700 border-red-500 text-white'}`}>
                                {correct ? '성공' : '실패'}
                              </span>
                            )}
                            {!s.isSuccessRevealed && s.isAnswerRevealed && (
                              <span className="ml-auto font-mono text-[10px] text-zinc-500">({sub.userName})</span>
                            )}
                          </>
                        ) : (
                          <span className="font-mono text-sm italic" style={{ color: 'var(--text-secondary)' }}>미제출</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 컨트롤 버튼 */}
                <div className="flex flex-wrap gap-2 pt-3 border-t-2" style={{ borderColor: 'var(--border-secondary)' }}>
                  {!s.isAnswerRevealed && (
                    <button onClick={() => revealAnswers(s.id)} disabled={submittedCount === 0} className="px-5 py-2.5 font-poster text-base border-4 bg-purple-600 border-purple-400 text-white shadow-[3px_3px_0px_var(--shadow-color)] hover:bg-purple-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      정답 확인
                    </button>
                  )}
                  {s.isAnswerRevealed && !s.isSuccessRevealed && (
                    <button onClick={() => revealSuccess(s.id)} className="px-5 py-2.5 font-poster text-base border-4 bg-yellow-500 border-yellow-300 text-black shadow-[3px_3px_0px_var(--shadow-color)] hover:bg-yellow-400 transition-all">
                      성공여부
                    </button>
                  )}
                  {s.isSuccessRevealed && !s.isResultReleased && (
                    <button onClick={() => releaseResults(s.id)} className="px-5 py-2.5 font-poster text-base border-4 bg-red-600 border-white text-white shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[5px_5px_0px_var(--shadow-color)] transition-all">
                      결과 공유
                    </button>
                  )}
                  {s.isResultReleased && (
                    <span className="font-mono text-sm text-emerald-500 font-bold animate-pulse py-2">학습자 화면에 결과가 표시되었습니다</span>
                  )}
                </div>

                {/* 정답 표시 */}
                {s.isSuccessRevealed && (
                  <div className="mt-3 px-3 py-2 border-2 border-yellow-600 bg-yellow-950/30">
                    <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>정답: </span>
                    <span className="font-mono text-sm text-yellow-400 font-bold">{CORRECT_ANSWER.day} {CORRECT_ANSWER.ampm} {CORRECT_ANSWER.hour}:{CORRECT_ANSWER.minute}</span>
                  </div>
                )}
              </div>

              {/* === 순위표 (성공여부 공개 후) === */}
              {s.isSuccessRevealed && correctTeams.length > 0 && (
                <div className="col-span-12 bento-card border-yellow-600" style={{ borderColor: '#ca8a04' }}>
                  <h3 className="font-poster text-lg mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <span className="text-2xl">🏆</span> 순위표
                  </h3>
                  <div className="space-y-2">
                    {correctTeams.map(([teamNum, sub], idx) => {
                      const elapsed = sub.submittedAt && s.missionStartedAt ? Math.floor((sub.submittedAt - s.missionStartedAt) / 1000) : 0;
                      return (
                        <div key={teamNum} className={`flex items-center gap-4 px-4 py-3 border-2 ${idx === 0 ? 'border-yellow-500 bg-yellow-950/30' : idx === 1 ? 'border-zinc-400 bg-zinc-900/30' : idx === 2 ? 'border-amber-700 bg-amber-950/20' : ''}`} style={idx > 2 ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-secondary)' } : {}}>
                          <span className={`font-poster text-2xl w-10 text-center ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-zinc-300' : idx === 2 ? 'text-amber-600' : ''}`} style={idx > 2 ? { color: 'var(--text-secondary)' } : {}}>
                            {idx + 1}위
                          </span>
                          <span className="font-poster text-xl" style={{ color: 'var(--text-primary)' }}>{teamNum}팀</span>
                          <span className="font-mono text-sm font-bold ml-auto" style={{ color: 'var(--text-secondary)' }}>
                            소요: {formatTimer(elapsed)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      );
    }

    // === 허브 뷰 ===
    return (
      <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-8 pb-32">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-poster tracking-tighter" style={{ color: 'var(--text-primary)' }}>세션 관리</h2>
          <button onClick={() => setIsAdminAuth(false)} className="font-mono text-sm text-red-500 underline font-bold">로그아웃</button>
        </div>

        <div className="border-4 p-6" style={{ borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' }}>
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createSession(fd.get('name') as string, parseInt(fd.get('teams') as string)); e.currentTarget.reset(); }} className="flex items-end gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>과정명</label>
              <input name="name" required placeholder="교육 과정명을 입력하세요" className="brutal-input w-full text-base py-3" />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-sm font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>팀 수</label>
              <select name="teams" className="brutal-input w-full appearance-none text-base py-3">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}개 팀</option>)}
              </select>
            </div>
            <button className="brutal-btn-red px-8 py-3 text-lg shrink-0 h-[54px]">새 세션</button>
          </form>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-20 border-4 border-dashed font-mono text-base font-bold" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>활성화된 세션이 없습니다</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map(s => {
              const submittedCount = Object.keys(s.submissions).length;
              return (
                <div key={s.id} onClick={() => { setActiveSessionId(s.id); setAdminView('dashboard'); setExpandedTeamMemo(null); }} className="border-4 p-5 cursor-pointer hover:shadow-[6px_6px_0px_#7c3aed] transition-all space-y-4 group" style={{ borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' }}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-poster text-2xl group-hover:text-purple-400 transition-colors" style={{ color: 'var(--text-primary)' }}>{s.groupName}</h3>
                      <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>코드: {s.id}</span>
                    </div>
                    <div className={`w-4 h-4 border-2 ${s.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-600'}`} style={{ borderColor: 'var(--border-primary)' }}></div>
                  </div>
                  <div className="flex gap-4 font-mono text-sm">
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>팀: <span style={{ color: 'var(--text-primary)' }}>{s.teamCount}개</span></span>
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>참가: <span style={{ color: 'var(--text-primary)' }}>{s.participants.length}명</span></span>
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>제출: <span className={submittedCount === s.teamCount ? 'text-emerald-400' : 'text-yellow-400'}>{submittedCount}/{s.teamCount}</span></span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t-2" style={{ borderColor: 'var(--border-secondary)' }}>
                    <span className={`font-mono text-sm font-bold ${s.isOpen ? 'text-emerald-500' : ''}`} style={!s.isOpen ? { color: 'var(--text-secondary)' } : {}}>{s.isOpen ? '입장 허용 중' : '입장 대기'}</span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>관리 &rarr;</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ============================
  //       학습자 뷰
  // ============================
  const renderStudentIntro = () => (
    <div className="max-w-md mx-auto px-6 h-[calc(100vh-80px)] animate-fade-in flex flex-col items-center justify-center overflow-hidden">
      <div className="mb-4 herb-glow">
        <HerbIcon size={56} />
      </div>
      <h1 className="text-3xl font-poster mb-1 tracking-tighter text-center leading-none whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>생사초를 <span className="text-purple-500 text-4xl">찾아라</span></h1>
      <p className="text-[9px] font-mono tracking-[0.3em] mb-4 text-center font-bold" style={{ color: 'var(--text-secondary)' }}>소통과 협업 시뮬레이션</p>

      <div className="w-full brutal-card p-5 space-y-4" style={{ background: 'var(--bg-card)' }}>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>과정 선택</label>
            <select value={userProfile.sessionId} onChange={(e) => setUserProfile({ ...userProfile, sessionId: e.target.value })} className="brutal-input w-full py-2 appearance-none text-sm font-bold">
              <option value="">과정을 선택하세요...</option>
              {sessions.filter(s => s.isOpen).map(s => <option key={s.id} value={s.id}>{s.groupName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>팀 선택</label>
            <div className="grid grid-cols-4 gap-1.5">
              {userProfile.sessionId ? (
                Array.from({ length: sessions.find(s => s.id === userProfile.sessionId)?.teamCount || 0 }, (_, i) => i + 1).map(num => (
                  <button key={num} onClick={() => setUserProfile({ ...userProfile, teamNumber: num })} className={`py-2 text-[14px] font-poster border-4 transition-all ${userProfile.teamNumber === num ? 'bg-purple-600 border-purple-300 text-white translate-x-1 translate-y-1 shadow-none' : 'shadow-[2px_2px_0px_var(--shadow-color)]'}`} style={userProfile.teamNumber !== num ? { background: 'var(--bg-input)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' } : {}}>
                    {num}
                  </button>
                ))
              ) : <div className="col-span-full py-3 text-[10px] font-mono text-center border-4 border-dashed font-bold" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>과정을 먼저 선택하세요</div>}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>이름</label>
            <input type="text" placeholder="이름을 입력하세요" value={userProfile.name} onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })} className="brutal-input w-full py-2 font-poster text-xl placeholder:opacity-30" />
          </div>
        </div>
        <button disabled={!userProfile.name || !userProfile.sessionId} onClick={registerParticipant} className="brutal-btn-red w-full py-3 text-xl tracking-[0.2em] disabled:opacity-30">입장</button>
      </div>
    </div>
  );

  const renderStudentStory = () => (
    <div className="min-h-screen flex flex-col items-center pb-24 px-6 overflow-y-auto" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="w-full relative h-[300px] border-b-[8px] border-purple-700 mt-6 shadow-[10px_10px_0px_var(--border-primary)]" style={{ background: 'var(--bg-secondary)' }}>
        <img src="https://images.unsplash.com/photo-1620121692029-d088224ddc74?q=80&w=1932&auto=format&fit=crop" className="w-full h-full object-cover grayscale contrast-150 brightness-50" alt="Zombie Poster" />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <span className="bg-purple-700 text-white font-mono text-[11px] px-3 py-1 mb-4 border-4 border-black font-bold">극비 문서</span>
          <h2 className="text-5xl font-poster text-white tracking-tighter leading-none mb-1 glitch">생사초를 찾아라</h2>
          <p className="text-lg font-poster text-purple-400 tracking-widest">소통과 협업 시뮬레이션</p>
        </div>
      </div>

      <div className="max-w-md w-full py-12 space-y-10 animate-fade-in">
        <div className="space-y-8 text-[16px] leading-relaxed font-bold break-keep text-justify">
          <p className="first-letter:text-7xl first-letter:font-poster first-letter:text-purple-600 first-letter:float-left first-letter:mr-3 first-letter:mt-1 border-l-8 border-purple-700 pl-4 py-2">
            옛날 어느 마을, 청년 콜롬버스와 그의 동료 위치타가 살고 있었습니다. 평화로운 시골마을. 어느 날, 숲 속에 시체들이 돌아다닌다는 이상한 소문이 돌았습니다.
          </p>
          <p className="border-r-8 pr-4 py-2 text-right" style={{ borderColor: 'var(--border-primary)' }}>
            평화롭던 마을에 들이닥친 시체들은 바로 좀비였습니다. 좀비들은 사람을 공격하고 납치하기 시작했고, 위치타도 함께 실종 되었습니다.
          </p>
          <p className="p-5 font-poster text-lg border-4 border-purple-600 shadow-[8px_8px_0px_#7c3aed]" style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
            콜롬버스는 동료들과 함께 위치타를 구하기 위해 좀비 무리를 찾기 시작합니다. 그녀를 데려간 좀비 무리를 발견하고 총으로 공격해 보았지만, 그들을 막지 못했습니다.
          </p>
          <div className="brutal-card bg-purple-950 p-6 italic text-white relative" style={{ borderColor: 'var(--border-primary)' }}>
            <span className="absolute -top-4 -left-2 px-2 text-[11px] font-mono border-2 font-bold" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>긴급 정보</span>
            "하지만 우연히 알게 된 정보로 '생사초'를 찾아 다시 그녀를 살리기 위해 나서는데… 과연 이 좀비들을 물리치고 동료 위치타를 무사히 구할 수 있을지…"
          </div>
          <p className="text-center font-poster text-2xl text-purple-500 tracking-tighter">
            여정은 지금부터 시작됩니다.
          </p>
        </div>
        <button onClick={() => setPhase(GamePhase.MAIN_GAME)} className="brutal-btn-red w-full py-6 text-3xl tracking-[0.1em]">입장</button>
        <button type="button" onClick={() => setPhase(GamePhase.INTRO)} className="w-full text-[10px] font-mono underline font-bold mt-4" style={{ color: 'var(--text-secondary)' }}>돌아가기</button>
      </div>
    </div>
  );

  const renderStudentMain = () => {
    const isMissionOn = activeSession?.isMissionStarted || false;
    const allParticipants = activeSession?.participants || [];
    const teamCount = activeSession?.teamCount || 1;
    const mp = isMissionOn && activeSession && (activeSession.currentPhaseIndex ?? -1) >= 0 ? computeMissionPhase(activeSession, phaseElapsed) : null;
    const isSubmitPhase = mp?.type === 'SUBMIT';
    const isSubmitEnabled = activeSession?.isSubmitEnabled || false;

    const scrollToCard = (index: number) => {
      if (carouselRef.current) {
        const cardWidth = carouselRef.current.children[0]?.clientWidth || 0;
        carouselRef.current.scrollTo({ left: cardWidth * index, behavior: 'smooth' });
        setActiveCardIndex(index);
      }
    };
    const handleCarouselScroll = () => {
      if (carouselRef.current) {
        const scrollLeft = carouselRef.current.scrollLeft;
        const cardWidth = carouselRef.current.children[0]?.clientWidth || 1;
        setActiveCardIndex(Math.round(scrollLeft / cardWidth));
      }
    };
    const chatEntries = (Object.entries(liveChatEntries) as [string, ChatEntry][]).filter(([, e]) => e.message?.trim());

    // === 미션 대기 중 화면 ===
    const isWaiting = !isMissionOn || (activeSession?.currentPhaseIndex ?? -1) < 0;
    if (isWaiting) {
      return (
        <div className="max-w-md mx-auto px-6 min-h-[calc(100vh-80px)] animate-fade-in flex flex-col items-center justify-center text-center space-y-8">
          <div className="brutal-card p-6 flex items-center justify-between w-full shadow-[8px_8px_0px_#7c3aed]" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)' }}>
            <div>
              <span className="text-[10px] font-mono block font-bold" style={{ color: 'var(--text-secondary)' }}>이름</span>
              <span className="text-2xl font-poster" style={{ color: 'var(--text-primary)' }}>{userProfile.name}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono text-purple-500 block font-bold">소속 팀</span>
              <span className="text-5xl font-poster text-purple-600 leading-none">{userProfile.teamNumber}</span>
            </div>
          </div>

          <div className="space-y-6 py-8">
            <div className="herb-glow mx-auto w-fit">
              <HerbIcon size={80} />
            </div>
            <h2 className="font-poster text-4xl tracking-tighter" style={{ color: 'var(--text-primary)' }}>
              {isMissionOn ? '다음 단계 대기 중' : '미션 대기 중'}
            </h2>
            <p className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
              {isMissionOn ? '강사가 다음 단계를 시작할 때까지' : '강사가 미션을 시작할 때까지'}<br />기다려 주세요
            </p>
            <div className="flex justify-center">
              <div className="w-12 h-12 border-t-4 border-r-4 border-purple-500 border-l-4 border-l-transparent border-b-4 border-b-transparent rounded-full animate-spin"></div>
            </div>
          </div>

          <button type="button" onClick={() => setPhase(GamePhase.STORY)} className="text-[10px] font-mono underline font-bold" style={{ color: 'var(--text-secondary)' }}>&larr; 스토리로 돌아가기</button>
        </div>
      );
    }

    // === 미션 진행 중 화면 ===
    return (
      <div className="max-w-md mx-auto px-5 pb-48 animate-fade-in space-y-6">
        {/* 페이즈 전환 알림 팝업 */}
        {phaseNotice && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[200] animate-fade-in">
            <div className="px-6 py-3 bg-purple-600 text-white font-poster text-lg border-4 border-purple-300 shadow-[4px_4px_0px_#000]">
              {phaseNotice}
            </div>
          </div>
        )}

        {/* 일시정지 배너 */}
        {activeSession?.isPhasePaused && (
          <div className="sticky top-20 z-[95] -mx-5 px-5 py-3 bg-yellow-600 border-b-4 border-yellow-400 text-center">
            <span className="font-poster text-lg text-white">⏸ 타이머 일시정지 중</span>
          </div>
        )}

        {/* 페이즈 바 (상단 고정) */}
        {mp && !activeSession?.isPhasePaused && (
          <div className={`sticky top-20 z-[90] -mx-5 px-5 py-3 border-b-4 ${mp.type === 'TEAM_INTERNAL' ? 'bg-purple-950/95 border-purple-500' : mp.type === 'TEAM_CROSS' ? 'bg-blue-950/95 border-blue-500' : 'bg-red-950/95 border-red-500'}`} style={{ backdropFilter: 'blur(10px)' }}>
            <div className="flex justify-between items-center">
              <div>
                <span className={`font-poster text-base ${mp.type === 'TEAM_INTERNAL' ? 'text-purple-300' : mp.type === 'TEAM_CROSS' ? 'text-blue-300' : 'text-red-300'}`}>
                  {mp.type === 'TEAM_INTERNAL' ? `팀 내 소통 시간` : mp.type === 'TEAM_CROSS' ? `팀 간 소통 시간` : '정답 제출 시간'}
                </span>
                <span className="font-mono text-[10px] text-white/50 ml-2">
                  {mp.type !== 'SUBMIT' ? `${activeSession?.roundDuration || 5}분` : `${activeSession?.submitDuration || 10}분`}
                </span>
              </div>
              <span className="font-mono text-2xl text-white font-bold">{formatTimer(Math.floor(mp.phaseRemaining))}</span>
            </div>
          </div>
        )}

        {/* 프로세스 스텝 */}
        {activeSession && (
          <div className="pt-2">
            <ProcessSteps session={activeSession} currentPhaseElapsed={phaseElapsed} />
          </div>
        )}

        {/* 전체 진도율 */}
        {activeSession && (
          <div className="brutal-card p-3 shadow-none" style={{ borderColor: 'var(--border-primary)' }}>
            <ProgressBar session={activeSession} />
          </div>
        )}

        {/* 프로필 카드 */}
        <div className="brutal-card p-4 flex items-center justify-between shadow-[6px_6px_0px_#7c3aed]" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)' }}>
          <div>
            <span className="text-[10px] font-mono block font-bold" style={{ color: 'var(--text-secondary)' }}>이름</span>
            <span className="text-xl font-poster" style={{ color: 'var(--text-primary)' }}>{userProfile.name}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-mono text-purple-500 block font-bold">소속 팀</span>
            <span className="text-4xl font-poster text-purple-600 leading-none">{userProfile.teamNumber}</span>
          </div>
        </div>

        {/* 정답 제출 섹션 (강사가 허용했을 때) */}
        {isSubmitEnabled && !activeSession?.submissions[userProfile.teamNumber] && (
          <div className="border-4 border-red-500 bg-red-950/30 p-4 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 animate-pulse border-2 border-white"></span>
              <span className="font-poster text-lg text-red-300">정답 제출이 허용되었습니다!</span>
            </div>
            <button onClick={() => setPhase(GamePhase.SUBMIT)} className="brutal-btn-red w-full py-4 text-xl">
              답안 제출하기
            </button>
          </div>
        )}
        {!isSubmitEnabled && isSubmitPhase && !activeSession?.submissions[userProfile.teamNumber] && (
          <div className="border-4 border-zinc-600 bg-zinc-900/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-zinc-500 border-2 border-zinc-400"></span>
              <span className="font-poster text-lg text-zinc-400">정답 제출 대기 중</span>
            </div>
            <p className="font-mono text-xs text-zinc-500">강사가 제출을 허용하면 활성화됩니다.</p>
          </div>
        )}

        {/* 조별 정보카드 카루셀 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-yellow-500 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
            <h3 className="text-sm font-poster tracking-[0.2em]" style={{ color: 'var(--text-primary)' }}>조별 현황</h3>
            <span className="text-[10px] font-mono text-yellow-500 ml-auto font-bold">좌우 스와이프</span>
          </div>
          <div ref={carouselRef} onScroll={handleCarouselScroll} className="team-carousel flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            {Array.from({ length: teamCount }, (_, i) => i + 1).map(tNum => {
              const teamMembers = allParticipants.filter(p => p.teamNumber === tNum);
              const isMyTeam = tNum === userProfile.teamNumber;
              const hasSubmitted = !!activeSession?.submissions[tNum];
              return (
                <div key={tNum} className={`team-card flex-shrink-0 w-[85%] border-4 transition-all ${isMyTeam ? 'border-purple-500 bg-purple-950/40 shadow-[6px_6px_0px_#7c3aed]' : hasSubmitted ? 'border-emerald-500 bg-emerald-950/30 shadow-[4px_4px_0px_var(--shadow-color)]' : 'shadow-[4px_4px_0px_var(--shadow-color)]'}`} style={!isMyTeam && !hasSubmitted ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}>
                  <div className={`px-4 py-3 flex justify-between items-center ${isMyTeam ? 'bg-purple-900/50' : hasSubmitted ? 'bg-emerald-900/40' : ''}`} style={!isMyTeam && !hasSubmitted ? { background: 'var(--bg-secondary)' } : {}}>
                    <div className="flex items-center gap-3">
                      <span className="font-poster text-2xl" style={{ color: isMyTeam || hasSubmitted ? '#fff' : 'var(--text-primary)' }}>{tNum}팀</span>
                      {isMyTeam && <span className="text-[9px] font-mono bg-purple-600 text-white px-2 py-0.5 border-2 border-white font-bold">MY TEAM</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{teamMembers.length}명</span>
                      {hasSubmitted && <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></span>}
                    </div>
                  </div>
                  <div className="px-4 py-4 min-h-[80px]">
                    {teamMembers.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {teamMembers.map((p, idx) => (
                          <span key={idx} className={`text-[12px] font-mono px-3 py-1 font-bold border-2 ${p.name === userProfile.name && isMyTeam ? 'bg-purple-600 text-white border-white' : ''}`} style={!(p.name === userProfile.name && isMyTeam) ? { background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' } : {}}>
                            {p.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] font-mono italic" style={{ color: 'var(--text-secondary)' }}>대기 중...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-center gap-2">
            {Array.from({ length: teamCount }, (_, i) => (
              <button key={i} onClick={() => scrollToCard(i)} className={`transition-all ${activeCardIndex === i ? 'w-8 h-2 bg-purple-500' : 'w-2 h-2 hover:opacity-70'}`} style={activeCardIndex !== i ? { background: 'var(--border-secondary)' } : {}} />
            ))}
          </div>
        </div>

        {/* 정보 카드 */}
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <h3 className="text-sm font-poster tracking-[0.2em] flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <span className="w-3 h-3 bg-purple-600 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
              정보 카드
            </h3>
            <button onClick={() => setIsViewAllMode(!isViewAllMode)} className={`px-3 py-1 font-mono text-[10px] border-4 transition-all font-bold ${isViewAllMode ? 'shadow-[2px_2px_0px_#7c3aed]' : ''}`} style={isViewAllMode ? { background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--border-primary)' } : { background: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-secondary)' }}>
              {isViewAllMode ? '우리 팀만 보기' : '전체 보기'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {myClues.map((clue, idx) => (
              <div key={clue.id} onClick={() => { setSelectedClue(clue); setCluePopupIndex(idx); }} className="relative aspect-square border-4 cursor-pointer hover:border-purple-500 transition-all overflow-hidden group active:scale-95 shadow-[4px_4px_0px_rgba(0,0,0,0.5)]" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <img src={clue.imageUrl} alt={clue.label} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 grayscale group-hover:grayscale-0 transition-all duration-300" />
                <div className="absolute bottom-1 left-1 bg-black/90 px-1 font-mono text-[10px] text-white border-2 border-white/50 font-bold">{clue.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 실시간 소통 - 개인 작성칸 (위쪽) */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-poster tracking-[0.2em] flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <span className="w-3 h-3 bg-green-500 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
              내 메모 작성
            </h3>
            <span className="text-[10px] font-mono text-green-500 animate-pulse font-bold">● 팀 메모에 자동 동기화</span>
          </div>
          <div className="border-4 border-green-600 bg-green-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono font-bold bg-green-600 text-white px-2 py-0.5 border-2 border-white">{userProfile.name}</span>
              <span className="text-[10px] font-mono text-green-400 font-bold">{userProfile.teamNumber}팀</span>
            </div>
            <textarea value={personalNote} onChange={(e) => handlePersonalNoteChange(e.target.value)} placeholder="여기에 메모를 작성하면 팀 메모판에 자동으로 공유됩니다..." className="w-full h-28 bg-black/60 p-3 text-sm text-green-400 font-mono outline-none resize-none placeholder:text-zinc-700 border-2 border-green-800 focus:border-green-400 transition-colors font-bold" />
          </div>
        </div>

        {/* 팀 메모판 (자동 동기화) */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-poster tracking-[0.2em]" style={{ color: 'var(--text-primary)' }}>팀 메모판</h3>
            <span className="text-[10px] font-mono text-green-500 animate-pulse">● 실시간 동기화</span>
          </div>
          <div className="brutal-card p-3 shadow-none space-y-2" style={{ borderColor: 'var(--border-primary)' }}>
            {(() => {
              const teamNotes = (Object.entries(personalNotes) as [string, PersonalNote][]).filter(([, n]) => n.teamNumber === userProfile.teamNumber && n.text?.trim());
              return teamNotes.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {teamNotes.map(([id, note]) => (
                    <div key={id} className={`border-2 p-3 ${id === participantId ? 'border-green-700 bg-green-950/20' : ''}`} style={id !== participantId ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 border ${id === participantId ? 'bg-green-900/50 text-green-300 border-green-700' : ''}`} style={id !== participantId ? { background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' } : {}}>
                          {note.name} {id === participantId ? '(나)' : ''}
                        </span>
                      </div>
                      <p className="text-sm font-mono text-green-500 whitespace-pre-wrap break-words leading-relaxed font-bold">{note.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-mono text-center py-8 font-bold" style={{ color: 'var(--text-secondary)' }}>아직 작성된 메모가 없습니다.</p>
              );
            })()}
          </div>
        </div>

        {/* 실시간 채팅 */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-poster tracking-[0.2em] flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <span className="w-3 h-3 bg-blue-500 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
              실시간 소통
            </h3>
            <span className="text-[10px] font-mono text-blue-400 font-bold">{Object.keys(liveChatEntries).length}명 접속</span>
          </div>
          <div className="border-4 border-blue-500 bg-blue-950/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold bg-blue-600 text-white px-2 py-0.5 border-2 border-white">{userProfile.name}</span>
              <span className="text-[10px] font-mono text-blue-400 font-bold">{userProfile.teamNumber}팀</span>
            </div>
            <textarea value={chatMessage} onChange={(e) => handleChatChange(e.target.value)} placeholder="동료들에게 메시지를 남기세요..." className="w-full h-20 bg-black/60 p-3 text-sm text-blue-300 font-mono outline-none resize-none placeholder:text-zinc-700 border-2 border-blue-800 focus:border-blue-400 transition-colors font-bold" />
          </div>
          {chatEntries.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {chatEntries.filter(([id]) => id !== participantId).map(([id, entry]) => (
                <div key={id} className={`border-2 p-3 space-y-1 ${entry.teamNumber === userProfile.teamNumber ? 'border-purple-800 bg-purple-950/20' : ''}`} style={entry.teamNumber !== userProfile.teamNumber ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 border ${entry.teamNumber === userProfile.teamNumber ? 'bg-purple-900/50 text-purple-300 border-purple-700' : ''}`} style={entry.teamNumber !== userProfile.teamNumber ? { background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' } : {}}>
                      {entry.name}
                    </span>
                    <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>{entry.teamNumber}팀</span>
                  </div>
                  <p className="text-sm font-mono whitespace-pre-wrap break-words leading-relaxed pl-1 font-bold" style={{ color: 'var(--text-primary)' }}>{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 답안 제출 버튼 (강사가 허용했을 때만) */}
        {isSubmitEnabled && !activeSession?.submissions[userProfile.teamNumber] && (
          <div className="fixed bottom-10 left-0 right-0 px-6 max-w-md mx-auto z-[80]">
            <button onClick={() => setPhase(GamePhase.SUBMIT)} className="brutal-btn w-full py-6 text-3xl shadow-[8px_8px_0px_var(--shadow-color)]">
              답안 제출하기
            </button>
          </div>
        )}

        {/* 클루 모달 (스와이프 가능) */}
        {selectedClue && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/98 backdrop-blur-xl"
            onTouchStart={(e) => { (e.currentTarget as any)._touchStartX = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const startX = (e.currentTarget as any)._touchStartX;
              if (startX === undefined) return;
              const diff = e.changedTouches[0].clientX - startX;
              if (Math.abs(diff) > 50) {
                const newIdx = diff > 0 ? Math.max(0, cluePopupIndex - 1) : Math.min(myClues.length - 1, cluePopupIndex + 1);
                setCluePopupIndex(newIdx);
                setSelectedClue(myClues[newIdx]);
              }
            }}
          >
            <div className="brutal-card p-2 w-full max-w-sm animate-scale-in relative" style={{ borderColor: 'var(--border-primary)' }}>
              <button onClick={() => setSelectedClue(null)} className="absolute -top-4 -right-4 w-12 h-12 brutal-btn-red flex items-center justify-center text-3xl font-poster z-50">X</button>
              {/* 이전 버튼 */}
              {cluePopupIndex > 0 && (
                <button onClick={() => { const ni = cluePopupIndex - 1; setCluePopupIndex(ni); setSelectedClue(myClues[ni]); }} className="absolute left-1 top-1/2 -translate-y-1/2 z-50 w-10 h-10 bg-black/80 border-2 border-white text-white font-poster text-xl flex items-center justify-center">&lt;</button>
              )}
              {/* 다음 버튼 */}
              {cluePopupIndex < myClues.length - 1 && (
                <button onClick={() => { const ni = cluePopupIndex + 1; setCluePopupIndex(ni); setSelectedClue(myClues[ni]); }} className="absolute right-1 top-1/2 -translate-y-1/2 z-50 w-10 h-10 bg-black/80 border-2 border-white text-white font-poster text-xl flex items-center justify-center">&gt;</button>
              )}
              <img src={selectedClue.imageUrl} alt={selectedClue.label} className="w-full h-auto border-4 border-black" />
              <div className="p-4 mt-2 font-poster flex justify-between items-center border-t-4" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}>
                <span className="text-3xl uppercase tracking-tighter">{selectedClue.label}</span>
                <span className="font-mono text-[10px] text-purple-500 font-bold">{cluePopupIndex + 1} / {myClues.length}</span>
              </div>
              {/* 도트 인디케이터 */}
              <div className="flex justify-center gap-1.5 py-2">
                {myClues.map((_, i) => (
                  <button key={i} onClick={() => { setCluePopupIndex(i); setSelectedClue(myClues[i]); }} className={`transition-all ${cluePopupIndex === i ? 'w-6 h-1.5 bg-purple-500' : 'w-1.5 h-1.5'}`} style={cluePopupIndex !== i ? { background: 'var(--border-secondary)' } : {}} />
                ))}
              </div>
            </div>
            <div className="absolute inset-0 z-[-1]" onClick={() => setSelectedClue(null)}></div>
          </div>
        )}
      </div>
    );
  };

  const renderSubmitForm = () => (
    <div className="max-w-md mx-auto px-6 py-12 animate-fade-in space-y-10">
      <div className="text-center space-y-2">
        <span className="bg-purple-700 text-white font-mono text-[11px] px-3 py-1 border-4 border-black font-bold">최종 단계</span>
        <h2 className="text-5xl font-poster tracking-tighter" style={{ color: 'var(--text-primary)' }}>골든타임</h2>
        <p className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>정확한 시간이 생존을 결정합니다.</p>
      </div>

      <form onSubmit={handleFinalSubmit} className="brutal-card p-8 space-y-8" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <div className="space-y-2">
          <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>요일 선택</label>
          <select required value={submitData.day} onChange={(e) => setSubmitData({ ...submitData, day: e.target.value })} className="brutal-input w-full text-center font-poster text-2xl uppercase appearance-none">
            <option value="">요일을 선택하세요</option>
            {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>오전/오후</label>
            <select value={submitData.ampm} onChange={(e) => setSubmitData({ ...submitData, ampm: e.target.value })} className="brutal-input w-full text-center font-poster text-2xl appearance-none">
              <option value="오전">오전</option>
              <option value="오후">오후</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>시간</label>
            <div className="flex gap-2">
              <select value={submitData.hour} onChange={(e) => setSubmitData({ ...submitData, hour: e.target.value })} className="brutal-input flex-1 text-center font-poster text-2xl appearance-none">
                {['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <select value={submitData.minute} onChange={(e) => setSubmitData({ ...submitData, minute: e.target.value })} className="brutal-input flex-1 text-center font-poster text-2xl appearance-none">
                {['00', '10', '20', '30', '40', '50'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="pt-4 space-y-4">
          <button className="brutal-btn-red w-full py-6 text-3xl tracking-widest">제출하기</button>
          <button type="button" onClick={() => setPhase(GamePhase.MAIN_GAME)} className="w-full text-[10px] font-mono underline font-bold" style={{ color: 'var(--text-secondary)' }}>돌아가기</button>
        </div>
      </form>
    </div>
  );

  // ============================
  //       에러/로딩
  // ============================
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div className="brutal-card p-10 w-full max-w-sm space-y-6 text-center border-red-600">
          <h2 className="text-3xl font-poster text-red-600 tracking-tighter">연결 실패</h2>
          <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{authError}</p>
          <button onClick={() => window.location.reload()} className="brutal-btn-red w-full py-4 text-xl">다시 시도</button>
        </div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-t-8 border-r-8 border-purple-600 border-l-8 border-l-transparent border-b-8 border-b-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-mono tracking-widest font-bold" style={{ color: 'var(--text-secondary)' }}>연결 중...</p>
        </div>
      </div>
    );
  }

  // ============================
  //       메인 레이아웃
  // ============================
  return (
    <div className="min-h-screen font-sans selection:bg-purple-500 overflow-x-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="border-b-[6px] p-4 flex justify-between items-center sticky top-0 z-[100] h-20 shadow-[0_6px_0px_#7c3aed]" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-2">
          <div className="herb-glow">
            <HerbIcon size={32} />
          </div>
          <span className="text-xl font-poster tracking-tighter whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>생사초를 찾아라</span>
        </div>
        <div className="flex items-center gap-3">
          <HeaderControls />
          <div className="flex p-1 border-4 shadow-[3px_3px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
            <button onClick={() => { setRole('STUDENT'); }} className="px-3 py-1.5 text-[12px] font-poster transition-all" style={role === 'STUDENT' ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : { color: 'var(--text-secondary)' }}>학습자</button>
            <button onClick={() => { setRole('ADMIN'); }} className="px-3 py-1.5 text-[12px] font-poster transition-all" style={role === 'ADMIN' ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : { color: 'var(--text-secondary)' }}>관리자</button>
          </div>
        </div>
      </header>

      <main className="relative pb-10">
        {role !== 'ADMIN' && <div className="vignette"></div>}
        {role === 'ADMIN' ? (
          renderAdmin()
        ) : (
          <>
            {phase === GamePhase.INTRO && renderStudentIntro()}
            {phase === GamePhase.STORY && renderStudentStory()}
            {phase === GamePhase.MAIN_GAME && renderStudentMain()}
            {phase === GamePhase.SUBMIT && renderSubmitForm()}
            {phase === GamePhase.CHECKING && (
              <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center space-y-12 animate-fade-in px-10 text-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="brutal-card p-10 rotate-2" style={{ background: 'var(--bg-card)' }}>
                  <div className="w-24 h-24 border-t-8 border-r-8 border-purple-600 border-l-8 border-l-transparent border-b-8 border-b-transparent rounded-full animate-spin mx-auto mb-8"></div>
                  <h3 className="text-4xl font-poster tracking-wider mb-4 glitch" style={{ color: 'var(--text-primary)' }}>전송 중...</h3>
                  <p className="font-mono text-[11px] tracking-[0.2em] font-bold" style={{ color: 'var(--text-secondary)' }}>데이터 검증이 진행 중입니다</p>
                </div>
                <div className="max-w-xs space-y-4">
                  <p className="text-purple-500 text-[12px] font-mono animate-pulse font-bold">접속을 유지해 주세요</p>
                  <p className="text-sm leading-relaxed font-bold italic" style={{ color: 'var(--text-secondary)' }}>관리자의 결과 발표를 기다리고 있습니다.</p>
                </div>
              </div>
            )}
            {phase === GamePhase.RESULT && (
              <div className="max-w-md mx-auto px-8 py-20 text-center flex flex-col justify-center min-h-[calc(100vh-80px)] animate-fade-in space-y-10">
                {isMyTeamCorrect ? (
                  <>
                    <div className="w-32 h-32 mx-auto bg-green-500 border-8 flex items-center justify-center text-6xl shadow-[10px_10px_0px_var(--shadow-color)] rotate-3" style={{ borderColor: 'var(--border-primary)' }}>✓</div>
                    <h2 className="text-6xl font-poster text-green-500 leading-none tracking-tighter">임무<br />성공</h2>
                    <div className="brutal-card p-8 border-green-500 shadow-[10px_10px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-card)' }}>
                      <p className="text-xl leading-relaxed font-bold break-keep" style={{ color: 'var(--text-primary)' }}>
                        완벽한 <span className="text-green-400 underline decoration-white underline-offset-4">협업</span>입니다! 골든타임을 정확히 맞췄습니다. 위치타가 의식을 되찾았고, 인류의 희망이 지켜졌습니다!
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-32 h-32 mx-auto bg-red-700 border-8 flex items-center justify-center text-6xl shadow-[10px_10px_0px_var(--shadow-color)] -rotate-3" style={{ borderColor: 'var(--border-primary)' }}>✗</div>
                    <h2 className="text-6xl font-poster text-red-600 leading-none tracking-tighter">임무<br />실패</h2>
                    <div className="brutal-card p-8 border-red-700 shadow-[10px_10px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-card)' }}>
                      <p className="text-xl leading-relaxed font-bold break-keep" style={{ color: 'var(--text-primary)' }}>
                        아쉽지만 해당 시간에는 생사초를 먹일 수가 없었습니다. 우리 팀의 소통 과정에서 놓친 정보는 없었는지 다시 한번 이야기를 나누어 봅시다.
                      </p>
                    </div>
                  </>
                )}
                <button onClick={() => { setPhase(GamePhase.INTRO); }} className="brutal-btn w-full py-5 text-2xl">처음으로 돌아가기</button>
              </div>
            )}
          </>
        )}
      </main>

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
}
