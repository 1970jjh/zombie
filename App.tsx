
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GamePhase, UserRole, UserProfile, Session, Clue, SubmissionData, Participant, ChatEntry } from './types';
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

// 테마/전체화면 아이콘 SVG
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

  // 학습자 채팅 & 참가자ID 상태
  const [participantId, setParticipantId] = useState<string>('');
  const [chatMessage, setChatMessage] = useState('');
  const [liveChatEntries, setLiveChatEntries] = useState<Record<string, ChatEntry>>({});
  const chatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  // 테마 & 전체화면 상태
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try { return localStorage.getItem('zombie-theme') !== 'day'; } catch { return true; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 미션 타이머
  const [missionElapsed, setMissionElapsed] = useState(0); // 초 단위
  const [missionDurationInput, setMissionDurationInput] = useState(60); // 관리자 입력용

  // 관리자 대시보드 상태
  const [adminView, setAdminView] = useState<'hub' | 'dashboard'>('hub');
  const [expandedTeamMemo, setExpandedTeamMemo] = useState<number | null>(null);
  const [showResultsTable, setShowResultsTable] = useState(false);
  const [adminTeamMemos, setAdminTeamMemos] = useState<Record<number, string>>({});

  // 테마 적용
  useEffect(() => {
    document.body.classList.toggle('theme-day', !isDarkMode);
    try { localStorage.setItem('zombie-theme', isDarkMode ? 'night' : 'day'); } catch {}
  }, [isDarkMode]);

  // 전체화면 API
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

  // Firebase 익명 인증 대기
  useEffect(() => {
    authReady
      .then(() => setIsAuthReady(true))
      .catch((err) => {
        console.error('Firebase 인증 실패:', err);
        setAuthError('Firebase 인증에 실패했습니다. 잠시 후 다시 시도해주세요.');
      });
  }, []);

  // Firebase 실시간 동기화 (인증 완료 후)
  useEffect(() => {
    if (!isAuthReady) return;

    const unsubscribe = onValue(sessionsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const sessionsArray: Session[] = Object.keys(data).map(key => ({
          ...data[key],
          id: key,
          participants: data[key].participants ? Object.values(data[key].participants) : [],
          submissions: data[key].submissions || {},
          isMissionStarted: data[key].isMissionStarted || false,
          missionStartedAt: data[key].missionStartedAt || 0,
          missionDuration: data[key].missionDuration || 60,
          liveChat: data[key].liveChat || {}
        }));
        setSessions(sessionsArray);
      } else {
        setSessions([]);
      }
    }, (error) => {
      console.error('세션 데이터 읽기 실패:', error);
    });

    return () => unsubscribe();
  }, [isAuthReady]);

  // 미션 타이머 - 1초마다 경과 시간 계산
  const activeSession = sessions.find(s => s.id === (role === 'ADMIN' ? activeSessionId : userProfile.sessionId));

  useEffect(() => {
    if (!activeSession?.isMissionStarted || !activeSession?.missionStartedAt) {
      setMissionElapsed(0);
      return;
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - activeSession.missionStartedAt) / 1000);
      setMissionElapsed(elapsed);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.isMissionStarted, activeSession?.missionStartedAt]);

  // 학습자: 팀 제출 상태 및 결과 발표 실시간 감시
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

  // 세션 변경 시 제출 데이터 초기화
  useEffect(() => {
    setSubmitData({ day: '', ampm: '오전', hour: '00', minute: '00' });
  }, [userProfile.sessionId]);

  // 팀 메모 실시간 동기화
  useEffect(() => {
    if (!userProfile.sessionId || !userProfile.teamNumber) {
      setMemo('');
      return;
    }
    setMemo('');
    const memoRef = ref(database, `sessions/${userProfile.sessionId}/memos/${userProfile.teamNumber}`);
    const unsubscribe = onValue(memoRef, (snapshot) => {
      setMemo(snapshot.val() || '');
    }, (error) => {
      console.error('메모 데이터 읽기 실패:', error);
    });
    return () => unsubscribe();
  }, [userProfile.sessionId, userProfile.teamNumber]);

  // 학습자: 실시간 채팅 동기화
  useEffect(() => {
    if (!userProfile.sessionId || !isAuthReady) {
      setLiveChatEntries({});
      return;
    }
    const chatRef = ref(database, `sessions/${userProfile.sessionId}/liveChat`);
    const unsubscribe = onValue(chatRef, (snapshot) => {
      setLiveChatEntries(snapshot.val() || {});
    }, (error) => {
      console.error('채팅 데이터 읽기 실패:', error);
    });
    return () => unsubscribe();
  }, [userProfile.sessionId, isAuthReady]);

  // 관리자: 전체 팀 메모 실시간 감시
  useEffect(() => {
    if (role !== 'ADMIN' || !activeSessionId || adminView !== 'dashboard') {
      setAdminTeamMemos({});
      return;
    }
    const memosRef = ref(database, `sessions/${activeSessionId}/memos`);
    const unsubscribe = onValue(memosRef, (snapshot) => {
      setAdminTeamMemos(snapshot.val() || {});
    }, (error) => {
      console.error('관리자 메모 데이터 읽기 실패:', error);
    });
    return () => unsubscribe();
  }, [role, activeSessionId, adminView]);

  // 관리자: 대시보드에서 세션이 삭제되면 허브로 복귀
  useEffect(() => {
    if (role === 'ADMIN' && adminView === 'dashboard' && activeSessionId) {
      const sessionExists = sessions.some(s => s.id === activeSessionId);
      if (!sessionExists && sessions.length >= 0 && isAuthReady) {
        setAdminView('hub');
        setActiveSessionId(null);
        setShowResultsTable(false);
        setExpandedTeamMemo(null);
      }
    }
  }, [sessions, role, adminView, activeSessionId, isAuthReady]);

  // 메모 변경 핸들러
  const handleMemoChange = (newMemo: string) => {
    setMemo(newMemo);
    if (memoTimeoutRef.current) clearTimeout(memoTimeoutRef.current);
    memoTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && userProfile.teamNumber) {
        try {
          await update(getSessionRef(userProfile.sessionId), {
            [`memos/${userProfile.teamNumber}`]: newMemo
          });
        } catch (err) {
          console.error('메모 저장 실패:', err);
        }
      }
    }, 300);
  };

  // 채팅 메시지 변경 핸들러
  const handleChatChange = (newMessage: string) => {
    setChatMessage(newMessage);
    if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current);
    chatTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && participantId) {
        try {
          await update(getSessionRef(userProfile.sessionId), {
            [`liveChat/${participantId}`]: {
              name: userProfile.name,
              teamNumber: userProfile.teamNumber,
              message: newMessage
            }
          });
        } catch (err) {
          console.error('채팅 저장 실패:', err);
        }
      }
    }, 300);
  };

  const myClues = useMemo(() => {
    if (!activeSession) return [];
    if (isViewAllMode) return CLUES;
    return distributeClues(CLUES, activeSession.teamCount, userProfile.teamNumber);
  }, [activeSession, userProfile.teamNumber, isViewAllMode]);

  // --- 세션 CRUD ---
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
        isResultReleased: false,
        submissions: {},
        participants: {},
        liveChat: {},
        createdAt: Date.now()
      });
      setActiveSessionId(sessionId);
      setAdminView('dashboard');
      setShowResultsTable(false);
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

    const alreadyJoined = session.participants.some(
      p => p.name === userProfile.name && p.teamNumber === userProfile.teamNumber
    );

    if (!alreadyJoined) {
      const newId = Date.now().toString();
      try {
        await update(getSessionRef(userProfile.sessionId), {
          [`participants/${newId}`]: {
            name: userProfile.name,
            teamNumber: userProfile.teamNumber,
            joinedAt: Date.now()
          }
        });
        setParticipantId(newId);
      } catch (err) {
        console.error('참가자 등록 실패:', err);
        alert('참가 등록에 실패했습니다. 다시 시도해주세요.');
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
    if (adminPassInput === ADMIN_PASSWORD) {
      setIsAdminAuth(true);
      setAdminPassInput('');
    } else {
      alert('접근 권한이 없습니다.');
      setAdminPassInput('');
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile.sessionId) return;
    try {
      await update(getSessionRef(userProfile.sessionId), {
        [`submissions/${userProfile.teamNumber}`]: { ...submitData, userName: userProfile.name }
      });
      setPhase(GamePhase.CHECKING);
    } catch (err) {
      console.error('제출 실패:', err);
      alert('답안 제출에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const toggleSessionOpen = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      try { await update(getSessionRef(id), { isOpen: !session.isOpen }); }
      catch (err) { console.error('세션 상태 변경 실패:', err); alert('세션 상태 변경에 실패했습니다.'); }
    }
  };

  const releaseResults = async (id: string) => {
    try { await update(getSessionRef(id), { isResultReleased: true }); }
    catch (err) { console.error('결과 발표 실패:', err); alert('결과 발표에 실패했습니다.'); }
  };

  const startMission = async (id: string, duration: number) => {
    try {
      await update(getSessionRef(id), {
        isMissionStarted: true,
        missionStartedAt: Date.now(),
        missionDuration: duration
      });
    } catch (err) {
      console.error('미션 시작 실패:', err);
      alert('미션 시작에 실패했습니다.');
    }
  };

  const resetSession = async (id: string) => {
    try {
      await update(getSessionRef(id), {
        isMissionStarted: false,
        missionStartedAt: 0,
        missionDuration: 60,
        isResultReleased: false,
        submissions: {},
        participants: {},
        liveChat: {}
      });
    } catch (err) {
      console.error('세션 초기화 실패:', err);
      alert('세션 초기화에 실패했습니다.');
    }
  };

  const deleteSession = async (id: string) => {
    if (confirm('이 교육 그룹을 삭제하시겠습니까?')) {
      try {
        await remove(getSessionRef(id));
        if (activeSessionId === id) {
          setAdminView('hub');
          setActiveSessionId(null);
          setShowResultsTable(false);
          setExpandedTeamMemo(null);
        }
      } catch (err) {
        console.error('세션 삭제 실패:', err);
        alert('세션 삭제에 실패했습니다.');
      }
    }
  };

  const isMyTeamCorrect = useMemo(() => {
    if (!activeSession) return false;
    const mySub = activeSession.submissions[userProfile.teamNumber];
    if (!mySub) return false;
    return mySub.day === CORRECT_ANSWER.day && mySub.ampm === CORRECT_ANSWER.ampm && mySub.hour === CORRECT_ANSWER.hour && mySub.minute === CORRECT_ANSWER.minute;
  }, [activeSession, userProfile.teamNumber]);

  const isTeamCorrect = (sub: SubmissionData) => {
    return sub.day === CORRECT_ANSWER.day && sub.ampm === CORRECT_ANSWER.ampm && sub.hour === CORRECT_ANSWER.hour && sub.minute === CORRECT_ANSWER.minute;
  };

  // --- 진도율 바 컴포넌트 ---
  const ProgressBar = ({ session }: { session: Session }) => {
    const totalSeconds = session.missionDuration * 60;
    const remaining = Math.max(0, totalSeconds - missionElapsed);
    const progress = totalSeconds > 0 ? Math.min(1, missionElapsed / totalSeconds) : 0;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const isUrgent = remaining < totalSeconds * 0.2;
    const isExpired = remaining <= 0;

    return (
      <div className="space-y-3">
        <div className="flex justify-between items-end">
          <div>
            <span className={`font-poster text-2xl ${isUrgent ? 'text-red-500 animate-pulse' : ''}`} style={{ color: isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : 'var(--text-primary)' }}>
              {isExpired ? '시간 종료!' : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`}
            </span>
            <span className="font-mono text-xs ml-3 opacity-60 font-bold">/ {session.missionDuration}분</span>
          </div>
          <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{Math.round(progress * 100)}% 경과</span>
        </div>

        <div className="progress-track" style={{ background: isDarkMode ? '#1a1a2e' : '#e4e4e7' }}>
          {/* 배경 그라데이션 */}
          <div
            className="progress-fill"
            style={{
              width: `${progress * 100}%`,
              background: isUrgent
                ? 'linear-gradient(90deg, #dc2626, #f59e0b)'
                : 'linear-gradient(90deg, #22c55e, #eab308, #ef4444)',
              opacity: 0.3
            }}
          />

          {/* 팀 아이콘 - 왼쪽에서 시작하여 오른쪽으로 이동 */}
          <div
            className="progress-icon-team"
            style={{ left: `${Math.min(progress * 82, 82)}%` }}
          >
            <span role="img" aria-label="team">🏃‍♂️</span>
          </div>

          {/* 좀비 아이콘 - 오른쪽 고정 */}
          <div className="progress-icon-zombie">
            <span role="img" aria-label="zombie">🧟</span>
          </div>

          {/* 중간 마커들 */}
          {[25, 50, 75].map(pct => (
            <div key={pct} className="absolute top-0 bottom-0 w-px opacity-20" style={{ left: `${pct}%`, background: 'var(--border-primary)' }} />
          ))}
        </div>
      </div>
    );
  };

  // --- 헤더의 테마/전체화면 버튼 ---
  const HeaderControls = () => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setIsDarkMode(!isDarkMode)}
        className="w-10 h-10 flex items-center justify-center border-2 transition-all hover:scale-110"
        style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
        title={isDarkMode ? '데이 모드' : '나이트 모드'}
      >
        {isDarkMode ? <SunIcon /> : <MoonIcon />}
      </button>
      <button
        onClick={toggleFullscreen}
        className="w-10 h-10 flex items-center justify-center border-2 transition-all hover:scale-110"
        style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
        title={isFullscreen ? '전체화면 해제' : '전체화면'}
      >
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
              <input
                type="password"
                value={adminPassInput}
                onChange={(e) => setAdminPassInput(e.target.value)}
                placeholder="비밀번호"
                className="brutal-input w-full text-center tracking-widest text-2xl font-poster"
              />
            </div>
            <button className="brutal-btn w-full py-4 text-xl">로그인</button>
          </form>
        </div>
      );
    }

    // 대시보드 뷰
    if (adminView === 'dashboard' && activeSessionId) {
      const s = sessions.find(ss => ss.id === activeSessionId);
      if (!s) return null;

      const submittedCount = Object.keys(s.submissions).length;
      const totalParticipants = s.participants.length;

      return (
        <div className="animate-fade-in min-h-[calc(100vh-80px)] flex flex-col">
          {/* 상단 바 - 큰 글씨 */}
          <div className="border-b-4 px-6 py-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <button
                  onClick={() => { setAdminView('hub'); setShowResultsTable(false); setExpandedTeamMemo(null); }}
                  className="font-mono text-base font-bold shrink-0 hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  &larr; 목록
                </button>
                <div className="min-w-0">
                  <h2 className="font-poster text-4xl truncate" style={{ color: 'var(--text-primary)' }}>{s.groupName}</h2>
                  <div className="flex gap-4 items-center mt-1">
                    <span className="font-mono text-base font-bold" style={{ color: 'var(--text-secondary)' }}>코드: <span style={{ color: 'var(--text-primary)' }}>{s.id}</span></span>
                    <span className="font-mono text-base font-bold" style={{ color: 'var(--text-secondary)' }}>참가: <span style={{ color: 'var(--text-primary)' }}>{totalParticipants}명</span></span>
                    <span className="font-mono text-base font-bold" style={{ color: 'var(--text-secondary)' }}>제출: <span className="text-emerald-500">{submittedCount}</span>/{s.teamCount}</span>
                  </div>
                </div>
              </div>

              {/* 버튼 영역 */}
              <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                <button
                  onClick={() => toggleSessionOpen(s.id)}
                  className={`px-6 py-3 font-poster text-lg border-4 transition-all ${
                    s.isOpen
                      ? 'bg-emerald-600 border-emerald-400 text-white shadow-[4px_4px_0px_var(--shadow-color)]'
                      : 'border-2 shadow-[4px_4px_0px_var(--shadow-color)]'
                  }`}
                  style={!s.isOpen ? { background: 'var(--bg-card)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' } : {}}
                >
                  {s.isOpen ? '입장 허용 중' : '입장 대기'}
                </button>

                {/* 미션 시작: 시간 설정 + 버튼 */}
                {!s.isMissionStarted ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={missionDurationInput}
                      onChange={(e) => setMissionDurationInput(parseInt(e.target.value))}
                      className="brutal-input py-3 px-2 text-center font-poster text-lg w-24"
                    >
                      {[30, 40, 50, 60, 70, 80, 90, 100].map(m => (
                        <option key={m} value={m}>{m}분</option>
                      ))}
                    </select>
                    <button
                      onClick={() => startMission(s.id, missionDurationInput)}
                      className="px-6 py-3 font-poster text-lg border-4 bg-yellow-500 border-yellow-300 text-black shadow-[4px_4px_0px_var(--shadow-color)] hover:bg-yellow-400 animate-pulse transition-all"
                    >
                      미션 시작
                    </button>
                  </div>
                ) : (
                  <span className="px-6 py-3 font-poster text-lg border-4 bg-yellow-900 border-yellow-700 text-yellow-500 cursor-not-allowed">미션 진행 중</span>
                )}

                <div className="flex gap-2">
                  <button onClick={() => resetSession(s.id)} className="px-4 py-3 font-mono text-sm font-bold border-2 hover:opacity-70 transition-opacity" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>초기화</button>
                  <button onClick={() => deleteSession(s.id)} className="px-4 py-3 font-mono text-sm font-bold bg-red-950 border-2 border-red-800 text-red-400 hover:text-white hover:border-red-500 transition-colors">삭제</button>
                </div>
              </div>
            </div>
          </div>

          {/* 메인 콘텐츠 */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-8">

              {/* 진도율 바 - 미션 시작 시에만 표시 */}
              {s.isMissionStarted && (
                <div className="brutal-card p-6 shadow-none" style={{ borderColor: 'var(--border-primary)' }}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-4 h-4 bg-yellow-500 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
                    <h3 className="font-poster text-2xl" style={{ color: 'var(--text-primary)' }}>미션 진행 현황</h3>
                  </div>
                  <ProgressBar session={s} />
                </div>
              )}

              {/* 조별 현황 그리드 - 큰 글씨, 큰 카드 */}
              <div>
                <h3 className="font-poster text-2xl mb-4" style={{ color: 'var(--text-primary)' }}>조별 현황</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                  {Array.from({length: s.teamCount}, (_, i) => i + 1).map(tNum => {
                    const teamParticipants = s.participants.filter(p => p.teamNumber === tNum);
                    const hasSubmitted = !!s.submissions[tNum];
                    const isMemoOpen = expandedTeamMemo === tNum;
                    const teamMemo = adminTeamMemos[tNum] || '';

                    return (
                      <div
                        key={tNum}
                        className={`border-4 transition-all ${
                          hasSubmitted
                            ? 'border-emerald-500 bg-emerald-950/30'
                            : ''
                        }`}
                        style={!hasSubmitted ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}
                      >
                        {/* 팀 헤더 */}
                        <div className={`px-4 py-3 flex justify-between items-center ${hasSubmitted ? 'bg-emerald-900/40' : ''}`} style={!hasSubmitted ? { background: 'var(--bg-secondary)' } : {}}>
                          <span className="font-poster text-2xl" style={{ color: hasSubmitted ? '#fff' : 'var(--text-primary)' }}>{tNum}팀</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{teamParticipants.length}명</span>
                            {hasSubmitted && <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></span>}
                          </div>
                        </div>

                        {/* 참가자 목록 */}
                        <div className="px-4 py-4 min-h-[70px]">
                          {teamParticipants.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {teamParticipants.map((p, idx) => (
                                <span key={idx} className="text-sm font-mono font-bold px-3 py-1 border-2" style={{ background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}>
                                  {p.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm font-mono italic" style={{ color: 'var(--text-secondary)' }}>대기 중</span>
                          )}
                        </div>

                        {/* 메모 토글 */}
                        <div className="border-t-2" style={{ borderColor: 'var(--border-secondary)' }}>
                          <button
                            onClick={() => setExpandedTeamMemo(isMemoOpen ? null : tNum)}
                            className="w-full px-4 py-3 flex justify-between items-center text-sm font-mono font-bold hover:opacity-70 transition-all"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <span>팀 메모</span>
                            <span>{isMemoOpen ? '▲' : '▼'}</span>
                          </button>
                          {isMemoOpen && (
                            <div className="px-4 pb-4">
                              <div className="border-2 p-3 max-h-32 overflow-y-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                                <pre className="text-sm font-mono text-green-500 whitespace-pre-wrap break-words leading-relaxed">
                                  {teamMemo || '(메모 없음)'}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 하단 컨트롤 & 결과 영역 */}
              <div className="border-t-4 pt-6 space-y-6" style={{ borderColor: 'var(--border-secondary)' }}>
                <div className="flex flex-wrap gap-3 items-center">
                  <button
                    onClick={() => setShowResultsTable(!showResultsTable)}
                    className={`px-8 py-4 font-poster text-xl border-4 transition-all ${
                      showResultsTable
                        ? 'shadow-[4px_4px_0px_#e11d48]'
                        : 'shadow-[4px_4px_0px_var(--shadow-color)] hover:opacity-80'
                    }`}
                    style={showResultsTable
                      ? { background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                      : { background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }
                    }
                  >
                    {showResultsTable ? '결과 닫기' : '조별 결과 보기'}
                  </button>
                  <button
                    onClick={() => releaseResults(s.id)}
                    disabled={s.isResultReleased}
                    className={`px-8 py-4 font-poster text-xl border-4 transition-all ${
                      s.isResultReleased
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed'
                        : 'bg-red-600 border-white text-white shadow-[4px_4px_0px_var(--shadow-color)] hover:shadow-[6px_6px_0px_var(--shadow-color)]'
                    }`}
                  >
                    {s.isResultReleased ? '결과 공유 완료' : '결과 공유'}
                  </button>
                  {s.isResultReleased && (
                    <span className="font-mono text-base text-emerald-500 font-bold animate-pulse">학습자 화면에 결과가 표시되었습니다</span>
                  )}
                </div>

                {showResultsTable && (
                  <div className="animate-fade-in">
                    <div className="border-4 overflow-hidden" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)' }}>
                      <table className="w-full">
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            <th className="px-5 py-4 text-left font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>팀</th>
                            <th className="px-5 py-4 text-center font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>요일</th>
                            <th className="px-5 py-4 text-center font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>오전/오후</th>
                            <th className="px-5 py-4 text-center font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>시간</th>
                            <th className="px-5 py-4 text-center font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>제출자</th>
                            <th className="px-5 py-4 text-center font-poster text-lg border-b-4" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }}>결과</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({length: s.teamCount}, (_, i) => i + 1).map(tNum => {
                            const sub = s.submissions[tNum];
                            const correct = sub ? isTeamCorrect(sub) : false;
                            return (
                              <tr key={tNum} className={`border-b-2 ${sub ? (correct ? 'bg-emerald-950/20' : 'bg-red-950/20') : ''}`} style={{ borderColor: 'var(--border-secondary)' }}>
                                <td className="px-5 py-4 font-poster text-2xl" style={{ color: 'var(--text-primary)' }}>{tNum}팀</td>
                                {sub ? (
                                  <>
                                    <td className="px-5 py-4 text-center font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{sub.day}</td>
                                    <td className="px-5 py-4 text-center font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{sub.ampm}</td>
                                    <td className="px-5 py-4 text-center font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{sub.hour}:{sub.minute}</td>
                                    <td className="px-5 py-4 text-center font-mono text-base font-bold" style={{ color: 'var(--text-secondary)' }}>{sub.userName}</td>
                                    <td className="px-5 py-4 text-center">
                                      {correct ? (
                                        <span className="inline-block px-4 py-2 bg-emerald-600 text-white font-poster text-lg border-2 border-emerald-400">임무 성공</span>
                                      ) : (
                                        <span className="inline-block px-4 py-2 bg-red-700 text-white font-poster text-lg border-2 border-red-500">다음 기회에</span>
                                      )}
                                    </td>
                                  </>
                                ) : (
                                  <td colSpan={5} className="px-5 py-4 text-center font-mono text-lg italic" style={{ color: 'var(--text-secondary)' }}>미제출</td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="px-5 py-4 flex justify-between items-center border-t-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
                        <span className="font-mono text-base font-bold" style={{ color: 'var(--text-secondary)' }}>정답</span>
                        <span className="font-mono text-xl text-yellow-500 font-bold">
                          {CORRECT_ANSWER.day} {CORRECT_ANSWER.ampm} {CORRECT_ANSWER.hour}:{CORRECT_ANSWER.minute}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // 허브 뷰
    return (
      <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-8 pb-32">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-poster tracking-tighter" style={{ color: 'var(--text-primary)' }}>세션 관리</h2>
          <button onClick={() => setIsAdminAuth(false)} className="font-mono text-sm text-red-500 underline font-bold">로그아웃</button>
        </div>

        <div className="border-4 p-6" style={{ borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createSession(fd.get('name') as string, parseInt(fd.get('teams') as string));
            e.currentTarget.reset();
          }} className="flex items-end gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>과정명</label>
              <input name="name" required placeholder="교육 과정명을 입력하세요" className="brutal-input w-full text-base py-3" />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-sm font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>팀 수</label>
              <select name="teams" className="brutal-input w-full appearance-none text-base py-3">
                {Array.from({length: 12}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}개 팀</option>)}
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
                <div
                  key={s.id}
                  onClick={() => { setActiveSessionId(s.id); setAdminView('dashboard'); setShowResultsTable(false); setExpandedTeamMemo(null); }}
                  className="border-4 p-5 cursor-pointer hover:shadow-[6px_6px_0px_#e11d48] transition-all space-y-4 group"
                  style={{ borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-poster text-2xl group-hover:text-red-500 transition-colors" style={{ color: 'var(--text-primary)' }}>{s.groupName}</h3>
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
                    <span className={`font-mono text-sm font-bold ${s.isOpen ? 'text-emerald-500' : ''}`} style={!s.isOpen ? { color: 'var(--text-secondary)' } : {}}>
                      {s.isOpen ? '입장 허용 중' : '입장 대기'}
                    </span>
                    <span className="font-mono text-sm font-bold transition-colors" style={{ color: 'var(--text-secondary)' }}>클릭하여 관리 &rarr;</span>
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
      <div className="w-16 h-16 mb-4 bg-red-700 border-4 shadow-[6px_6px_0px_var(--shadow-color)] flex items-center justify-center transform rotate-3" style={{ borderColor: 'var(--border-primary)' }}>
         <span className="text-4xl font-poster text-white">Z</span>
      </div>
      <h1 className="text-3xl font-poster mb-1 tracking-tighter text-center leading-none" style={{ color: 'var(--text-primary)' }}>생사초를<br/><span className="text-red-600 text-4xl">찾아라</span></h1>
      <p className="text-[9px] font-mono tracking-[0.3em] mb-4 text-center font-bold" style={{ color: 'var(--text-secondary)' }}>소통과 협업 시뮬레이션</p>

      <div className="w-full brutal-card p-5 space-y-4" style={{ background: 'var(--bg-card)' }}>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>과정 선택</label>
            <select value={userProfile.sessionId} onChange={(e) => setUserProfile({...userProfile, sessionId: e.target.value})} className="brutal-input w-full py-2 appearance-none text-sm font-bold">
              <option value="">과정을 선택하세요...</option>
              {sessions.filter(s => s.isOpen).map(s => <option key={s.id} value={s.id}>{s.groupName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>팀 선택</label>
            <div className="grid grid-cols-4 gap-1.5">
              {userProfile.sessionId ? (
                Array.from({length: sessions.find(s => s.id === userProfile.sessionId)?.teamCount || 0}, (_, i) => i + 1).map(num => (
                  <button key={num} onClick={() => setUserProfile({...userProfile, teamNumber: num})} className={`py-2 text-[14px] font-poster border-4 transition-all ${userProfile.teamNumber === num ? 'bg-red-600 border-white text-white translate-x-1 translate-y-1 shadow-none' : 'shadow-[2px_2px_0px_var(--shadow-color)]'}`}
                    style={userProfile.teamNumber !== num ? { background: 'var(--bg-input)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' } : {}}
                  >
                    {num}
                  </button>
                ))
              ) : <div className="col-span-full py-3 text-[10px] font-mono text-center border-4 border-dashed font-bold" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>과정을 먼저 선택하세요</div>}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono block mb-1 font-bold" style={{ color: 'var(--text-secondary)' }}>이름</label>
            <input type="text" placeholder="이름을 입력하세요" value={userProfile.name} onChange={(e) => setUserProfile({...userProfile, name: e.target.value})} className="brutal-input w-full py-2 font-poster text-xl placeholder:opacity-30" />
          </div>
        </div>
        <button disabled={!userProfile.name || !userProfile.sessionId} onClick={registerParticipant} className="brutal-btn-red w-full py-3 text-xl tracking-[0.2em] disabled:opacity-30">입장</button>
      </div>
    </div>
  );

  const renderStudentStory = () => (
    <div className="min-h-screen flex flex-col items-center pb-24 px-6 overflow-y-auto" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="w-full relative h-[300px] border-b-[8px] border-red-700 mt-6 shadow-[10px_10px_0px_var(--border-primary)]" style={{ background: 'var(--bg-secondary)' }}>
        <img src="https://images.unsplash.com/photo-1620121692029-d088224ddc74?q=80&w=1932&auto=format&fit=crop" className="w-full h-full object-cover grayscale contrast-150 brightness-50" alt="Zombie Poster" />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
           <span className="bg-red-700 text-white font-mono text-[11px] px-3 py-1 mb-4 border-4 border-black font-bold">극비 문서</span>
           <h2 className="text-5xl font-poster text-white tracking-tighter leading-none mb-1 glitch">생사초를 찾아라</h2>
           <p className="text-lg font-poster text-red-600 tracking-widest">소통과 협업 시뮬레이션</p>
        </div>
      </div>

      <div className="max-w-md w-full py-12 space-y-10 animate-fade-in">
        <div className="space-y-8 text-[16px] leading-relaxed font-bold break-keep text-justify">
          <p className="first-letter:text-7xl first-letter:font-poster first-letter:text-red-700 first-letter:float-left first-letter:mr-3 first-letter:mt-1 border-l-8 border-red-700 pl-4 py-2">
            옛날 어느 마을, 청년 콜롬버스와 그의 동료 위치타가 살고 있었습니다. 평화로운 시골마을. 어느 날, 숲 속에 시체들이 돌아다닌다는 이상한 소문이 돌았습니다.
          </p>
          <p className="border-r-8 pr-4 py-2 text-right" style={{ borderColor: 'var(--border-primary)' }}>
            평화롭던 마을에 들이닥친 시체들은 바로 좀비였습니다. 좀비들은 사람을 공격하고 납치하기 시작했고, 위치타도 함께 실종 되었습니다. 그녀를 찾기 위해 수소문 하였지만, 아는 사람이 없었습니다!
          </p>
          <p className="p-5 font-poster text-lg border-4 border-red-600 shadow-[8px_8px_0px_#e11d48]" style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
            콜롬버스는 동료들과 함께 위치타를 구하기 위해 좀비 무리를 찾기 시작합니다. 그녀를 데려간 좀비 무리를 발견하고 총으로 공격해 보았지만, 그들을 막지 못했습니다.
          </p>
          <div className="brutal-card bg-red-950 p-6 italic text-white relative" style={{ borderColor: 'var(--border-primary)' }}>
            <span className="absolute -top-4 -left-2 px-2 text-[11px] font-mono border-2 font-bold" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>긴급 정보</span>
            "하지만 우연히 알게 된 정보로 '생사초'를 찾아 다시 그녀를 살리기 위해 나서는데… 과연 이 좀비들을 물리치고 동료 위치타를 무사히 구할 수 있을지…"
          </div>
          <p className="text-center font-poster text-2xl text-red-600 tracking-tighter">
            여정은 지금부터 시작됩니다.
          </p>
        </div>
        <button
          onClick={() => setPhase(GamePhase.MAIN_GAME)}
          className="brutal-btn-red w-full py-6 text-3xl tracking-[0.1em]"
        >
          입장
        </button>
        <button type="button" onClick={() => setPhase(GamePhase.INTRO)} className="w-full text-[10px] font-mono underline font-bold mt-4" style={{ color: 'var(--text-secondary)' }}>돌아가기</button>
      </div>
    </div>
  );

  const renderStudentMain = () => {
    const isMissionOn = activeSession?.isMissionStarted || false;
    const allParticipants = activeSession?.participants || [];
    const teamCount = activeSession?.teamCount || 1;

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

    const chatEntries = Object.entries(liveChatEntries).filter(([, e]) => e.message?.trim());

    return (
      <div className="max-w-md mx-auto px-5 py-8 pb-48 animate-fade-in space-y-10">
        <button type="button" onClick={() => setPhase(GamePhase.STORY)} className="text-[10px] font-mono underline font-bold" style={{ color: 'var(--text-secondary)' }}>&larr; 스토리로 돌아가기</button>
        <div className="brutal-card p-6 flex items-center justify-between shadow-[8px_8px_0px_#e11d48]" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)' }}>
           <div>
              <span className="text-[10px] font-mono block font-bold" style={{ color: 'var(--text-secondary)' }}>이름</span>
              <span className="text-2xl font-poster" style={{ color: 'var(--text-primary)' }}>{userProfile.name}</span>
           </div>
           <div className="text-right">
              <span className="text-[10px] font-mono text-red-600 block font-bold">소속 팀</span>
              <span className="text-5xl font-poster text-red-700 leading-none">{userProfile.teamNumber}</span>
           </div>
        </div>

        {/* 미션 타이머 - 학습자에게도 표시 */}
        {isMissionOn && activeSession && (
          <div className="brutal-card p-4 shadow-none" style={{ borderColor: 'var(--border-primary)' }}>
            <ProgressBar session={activeSession} />
          </div>
        )}

        {/* 조별 정보카드 카루셀 */}
        {isMissionOn && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-yellow-500 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
              <h3 className="text-sm font-poster tracking-[0.2em]" style={{ color: 'var(--text-primary)' }}>조별 현황</h3>
              <span className="text-[10px] font-mono text-yellow-500 ml-auto font-bold">좌우 스와이프</span>
            </div>

            <div
              ref={carouselRef}
              onScroll={handleCarouselScroll}
              className="team-carousel flex gap-4 overflow-x-auto pb-4 -mx-2 px-2"
            >
              {Array.from({length: teamCount}, (_, i) => i + 1).map(tNum => {
                const teamMembers = allParticipants.filter(p => p.teamNumber === tNum);
                const isMyTeam = tNum === userProfile.teamNumber;
                const hasSubmitted = !!activeSession?.submissions[tNum];

                return (
                  <div
                    key={tNum}
                    className={`team-card flex-shrink-0 w-[85%] border-4 transition-all ${
                      isMyTeam
                        ? 'border-red-500 bg-red-950/40 shadow-[6px_6px_0px_#e11d48]'
                        : hasSubmitted
                          ? 'border-emerald-500 bg-emerald-950/30 shadow-[4px_4px_0px_var(--shadow-color)]'
                          : 'shadow-[4px_4px_0px_var(--shadow-color)]'
                    }`}
                    style={!isMyTeam && !hasSubmitted ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}
                  >
                    <div className={`px-4 py-3 flex justify-between items-center ${
                      isMyTeam ? 'bg-red-900/50' : hasSubmitted ? 'bg-emerald-900/40' : ''
                    }`} style={!isMyTeam && !hasSubmitted ? { background: 'var(--bg-secondary)' } : {}}>
                      <div className="flex items-center gap-3">
                        <span className="font-poster text-2xl" style={{ color: isMyTeam || hasSubmitted ? '#fff' : 'var(--text-primary)' }}>{tNum}팀</span>
                        {isMyTeam && (
                          <span className="text-[9px] font-mono bg-red-600 text-white px-2 py-0.5 border-2 border-white font-bold">MY TEAM</span>
                        )}
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
                            <span
                              key={idx}
                              className={`text-[12px] font-mono px-3 py-1 font-bold border-2 ${
                                p.name === userProfile.name && isMyTeam
                                  ? 'bg-red-600 text-white border-white'
                                  : ''
                              }`}
                              style={!(p.name === userProfile.name && isMyTeam) ? { background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' } : {}}
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] font-mono italic" style={{ color: 'var(--text-secondary)' }}>대기 중...</span>
                      )}
                    </div>
                    <div className={`px-4 py-2 border-t-2 ${isMyTeam ? 'border-red-800' : ''}`} style={!isMyTeam ? { borderColor: 'var(--border-secondary)' } : {}}>
                      <span className={`text-[10px] font-mono font-bold ${hasSubmitted ? 'text-emerald-400' : ''}`} style={!hasSubmitted ? { color: 'var(--text-secondary)' } : {}}>
                        {hasSubmitted ? '답안 제출 완료' : '분석 진행 중...'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-center gap-2">
              {Array.from({length: teamCount}, (_, i) => (
                <button
                  key={i}
                  onClick={() => scrollToCard(i)}
                  className={`transition-all ${activeCardIndex === i ? 'w-8 h-2 bg-red-500' : 'w-2 h-2 hover:opacity-70'}`}
                  style={activeCardIndex !== i ? { background: 'var(--border-secondary)' } : {}}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex justify-between items-end">
             <h3 className="text-sm font-poster tracking-[0.2em] flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
               <span className="w-3 h-3 bg-red-600 animate-pulse border-2" style={{ borderColor: 'var(--border-primary)' }}></span>
               정보 카드
             </h3>
             <button
               onClick={() => setIsViewAllMode(!isViewAllMode)}
               className={`px-3 py-1 font-mono text-[10px] border-4 transition-all font-bold ${isViewAllMode ? 'shadow-[2px_2px_0px_#e11d48]' : ''}`}
               style={isViewAllMode
                 ? { background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                 : { background: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-secondary)' }
               }
             >
               {isViewAllMode ? '우리 팀만 보기' : '전체 보기'}
             </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {myClues.map(clue => (
              <div
                key={clue.id}
                onClick={() => setSelectedClue(clue)}
                className="relative aspect-square border-4 cursor-pointer hover:border-red-500 transition-all overflow-hidden group active:scale-95 shadow-[4px_4px_0px_rgba(0,0,0,0.5)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}
              >
                <img src={clue.imageUrl} alt={clue.label} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 grayscale group-hover:grayscale-0 transition-all duration-300" />
                <div className="absolute bottom-1 left-1 bg-black/90 px-1 font-mono text-[10px] text-white border-2 border-white/50 font-bold">
                  {clue.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-poster tracking-[0.2em]" style={{ color: 'var(--text-primary)' }}>팀 공유 메모</h3>
            <span className="text-[10px] font-mono text-green-500 animate-pulse">● 실시간 동기화</span>
          </div>
          <div className="brutal-card p-1 shadow-none" style={{ borderColor: 'var(--border-primary)' }}>
            <textarea
              value={memo}
              onChange={(e) => handleMemoChange(e.target.value)}
              placeholder="팀원들과 실시간 공유됩니다. 다른 팀에서 받은 정보를 기록하세요..."
              className="w-full h-64 p-5 text-base text-green-500 font-mono outline-none resize-none border-none font-bold"
              style={{ background: 'var(--bg-input)' }}
            />
          </div>
        </div>

        {/* 실시간 채팅 */}
        {isMissionOn && (
          <div className="space-y-4">
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
              <textarea
                value={chatMessage}
                onChange={(e) => handleChatChange(e.target.value)}
                placeholder="동료들에게 메시지를 남기세요..."
                className="w-full h-20 bg-black/60 p-3 text-sm text-blue-300 font-mono outline-none resize-none placeholder:text-zinc-700 border-2 border-blue-800 focus:border-blue-400 transition-colors font-bold"
              />
            </div>

            {chatEntries.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {chatEntries
                  .filter(([id]) => id !== participantId)
                  .map(([id, entry]) => (
                    <div
                      key={id}
                      className={`border-2 p-3 space-y-1 ${
                        entry.teamNumber === userProfile.teamNumber
                          ? 'border-red-800 bg-red-950/20'
                          : ''
                      }`}
                      style={entry.teamNumber !== userProfile.teamNumber ? { borderColor: 'var(--border-secondary)', background: 'var(--bg-card)' } : {}}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 border ${
                          entry.teamNumber === userProfile.teamNumber
                            ? 'bg-red-900/50 text-red-300 border-red-700'
                            : ''
                        }`} style={entry.teamNumber !== userProfile.teamNumber ? { background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' } : {}}>
                          {entry.name}
                        </span>
                        <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>{entry.teamNumber}팀</span>
                      </div>
                      <p className="text-sm font-mono whitespace-pre-wrap break-words leading-relaxed pl-1 font-bold" style={{ color: 'var(--text-primary)' }}>
                        {entry.message}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="fixed bottom-10 left-0 right-0 px-6 max-w-md mx-auto z-[80]">
          <button
            onClick={() => setPhase(GamePhase.SUBMIT)}
            className="brutal-btn w-full py-6 text-3xl shadow-[8px_8px_0px_var(--shadow-color)]"
          >
            답안 제출하기
          </button>
        </div>

        {selectedClue && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/98 backdrop-blur-xl">
            <div className="brutal-card p-2 w-full max-w-sm animate-scale-in relative" style={{ borderColor: 'var(--border-primary)' }}>
              <button
                onClick={() => setSelectedClue(null)}
                className="absolute -top-4 -right-4 w-12 h-12 brutal-btn-red flex items-center justify-center text-3xl font-poster z-50"
              >
                X
              </button>
              <img src={selectedClue.imageUrl} alt={selectedClue.label} className="w-full h-auto border-4 border-black" />
              <div className="p-4 mt-2 font-poster flex justify-between items-center border-t-4" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}>
                 <span className="text-3xl uppercase tracking-tighter">{selectedClue.label}</span>
                 <span className="font-mono text-[10px] text-red-600 font-bold">정보 카드</span>
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
         <span className="bg-red-700 text-white font-mono text-[11px] px-3 py-1 border-4 border-black font-bold">최종 단계</span>
         <h2 className="text-5xl font-poster tracking-tighter" style={{ color: 'var(--text-primary)' }}>골든타임</h2>
         <p className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>정확한 시간이 생존을 결정합니다.</p>
      </div>

      <form onSubmit={handleFinalSubmit} className="brutal-card p-8 space-y-8" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <div className="space-y-2">
          <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>요일 선택</label>
          <select
            required
            value={submitData.day}
            onChange={(e) => setSubmitData({...submitData, day: e.target.value})}
            className="brutal-input w-full text-center font-poster text-2xl uppercase appearance-none"
          >
            <option value="">요일을 선택하세요</option>
            {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>오전/오후</label>
            <select
              value={submitData.ampm}
              onChange={(e) => setSubmitData({...submitData, ampm: e.target.value})}
              className="brutal-input w-full text-center font-poster text-2xl appearance-none"
            >
              <option value="오전">오전</option>
              <option value="오후">오후</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono ml-1 font-bold" style={{ color: 'var(--text-secondary)' }}>시간</label>
            <div className="flex gap-2">
              <select value={submitData.hour} onChange={(e) => setSubmitData({...submitData, hour: e.target.value})} className="brutal-input flex-1 text-center font-poster text-2xl appearance-none">
                {['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <select value={submitData.minute} onChange={(e) => setSubmitData({...submitData, minute: e.target.value})} className="brutal-input flex-1 text-center font-poster text-2xl appearance-none">
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
  //       에러/로딩 화면
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
          <div className="w-16 h-16 border-t-8 border-r-8 border-red-600 border-l-8 border-l-transparent border-b-8 border-b-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-mono tracking-widest font-bold" style={{ color: 'var(--text-secondary)' }}>연결 중...</p>
        </div>
      </div>
    );
  }

  // ============================
  //       메인 레이아웃
  // ============================
  return (
    <div className="min-h-screen font-sans selection:bg-red-500 overflow-x-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="border-b-[6px] p-4 flex justify-between items-center sticky top-0 z-[100] h-20 shadow-[0_6px_0px_#e11d48]" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-red-600 border-4 rotate-45" style={{ borderColor: 'var(--border-primary)' }}></div>
          <span className="text-xl font-poster tracking-tighter" style={{ color: 'var(--text-primary)' }}>생사초를 찾아라</span>
        </div>

        <div className="flex items-center gap-3">
          <HeaderControls />
          <div className="flex p-1 border-4 shadow-[3px_3px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
            <button onClick={() => { setRole('STUDENT'); }} className={`px-3 py-1.5 text-[12px] font-poster transition-all ${role === 'STUDENT' ? '' : ''}`}
              style={role === 'STUDENT' ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : { color: 'var(--text-secondary)' }}
            >학습자</button>
            <button onClick={() => { setRole('ADMIN'); }} className={`px-3 py-1.5 text-[12px] font-poster transition-all`}
              style={role === 'ADMIN' ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : { color: 'var(--text-secondary)' }}
            >관리자</button>
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
                   <div className="w-24 h-24 border-t-8 border-r-8 border-red-600 border-l-8 border-l-transparent border-b-8 border-b-transparent rounded-full animate-spin mx-auto mb-8"></div>
                   <h3 className="text-4xl font-poster tracking-wider mb-4 glitch" style={{ color: 'var(--text-primary)' }}>전송 중...</h3>
                   <p className="font-mono text-[11px] tracking-[0.2em] font-bold" style={{ color: 'var(--text-secondary)' }}>데이터 검증이 진행 중입니다</p>
                </div>
                <div className="max-w-xs space-y-4">
                  <p className="text-red-500 text-[12px] font-mono animate-pulse font-bold">접속을 유지해 주세요</p>
                  <p className="text-sm leading-relaxed font-bold italic" style={{ color: 'var(--text-secondary)' }}>
                    관리자의 결과 발표를 기다리고 있습니다. 위치타의 운명은 최종 분석에 달려 있습니다.
                  </p>
                </div>
              </div>
            )}
            {phase === GamePhase.RESULT && (
              <div className="max-w-md mx-auto px-8 py-20 text-center flex flex-col justify-center min-h-[calc(100vh-80px)] animate-fade-in space-y-10">
                {isMyTeamCorrect ? (
                  <>
                    <div className="w-32 h-32 mx-auto bg-green-500 border-8 flex items-center justify-center text-6xl shadow-[10px_10px_0px_var(--shadow-color)] rotate-3" style={{ borderColor: 'var(--border-primary)' }}>✓</div>
                    <h2 className="text-6xl font-poster text-green-500 leading-none tracking-tighter">임무<br/>성공</h2>
                    <div className="brutal-card p-8 border-green-500 shadow-[10px_10px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-card)' }}>
                      <p className="text-xl leading-relaxed font-bold break-keep" style={{ color: 'var(--text-primary)' }}>
                        완벽한 <span className="text-green-400 underline decoration-white underline-offset-4">협업</span>입니다! 골든타임을 정확히 맞췄습니다. 위치타가 의식을 되찾았고, 인류의 희망이 지켜졌습니다!
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-32 h-32 mx-auto bg-red-700 border-8 flex items-center justify-center text-6xl shadow-[10px_10px_0px_var(--shadow-color)] -rotate-3" style={{ borderColor: 'var(--border-primary)' }}>✗</div>
                    <h2 className="text-6xl font-poster text-red-600 leading-none tracking-tighter">임무<br/>실패</h2>
                    <div className="brutal-card p-8 border-red-700 shadow-[10px_10px_0px_var(--shadow-color)]" style={{ background: 'var(--bg-card)' }}>
                      <p className="text-xl leading-relaxed font-bold break-keep" style={{ color: 'var(--text-primary)' }}>
                        아쉽지만 해당 시간에는 생사초를 먹일 수가 없었습니다. 위치타를 구할 수 있는 골든타임은 다른 시각이었던 것 같네요. 우리 팀의 소통 과정에서 놓친 정보는 없었는지 다시 한번 이야기를 나누어 봅시다.
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
