
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GamePhase, UserRole, UserProfile, Session, Clue, SubmissionData, Participant } from './types';
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
        // Firebase 객체를 배열로 변환
        const sessionsArray: Session[] = Object.keys(data).map(key => ({
          ...data[key],
          id: key,
          participants: data[key].participants ? Object.values(data[key].participants) : [],
          submissions: data[key].submissions || {}
        }));
        setSessions(sessionsArray);
      } else {
        setSessions([]);
      }
    });

    return () => unsubscribe();
  }, [isAuthReady]);

  // 학습자: 팀 제출 상태 및 결과 발표 실시간 감시
  useEffect(() => {
    if (role !== 'STUDENT' || !userProfile.sessionId) return;

    const currentSession = sessions.find(s => s.id === userProfile.sessionId);
    if (!currentSession) return;

    // 결과가 발표되면 RESULT 화면으로 이동
    if (currentSession.isResultReleased) {
      setPhase(GamePhase.RESULT);
      return;
    }

    // 우리 팀이 제출했으면 CHECKING 화면으로 이동 (STORY나 MAIN_GAME, SUBMIT에서)
    const hasTeamSubmitted = !!currentSession.submissions[userProfile.teamNumber];
    if (hasTeamSubmitted && (phase === GamePhase.STORY || phase === GamePhase.MAIN_GAME || phase === GamePhase.SUBMIT)) {
      setPhase(GamePhase.CHECKING);
    }
  }, [sessions, phase, role, userProfile.sessionId, userProfile.teamNumber]);

  // 세션 변경 시 제출 데이터 초기화
  useEffect(() => {
    setSubmitData({ day: '', ampm: '오전', hour: '00', minute: '00' });
  }, [userProfile.sessionId]);

  // 팀 메모 실시간 동기화 (새 세션 진입 시 메모 초기화)
  useEffect(() => {
    if (!userProfile.sessionId || !userProfile.teamNumber) {
      setMemo(''); // 세션 없으면 메모 초기화
      return;
    }

    // 세션/팀 변경 시 먼저 메모 초기화
    setMemo('');

    const memoRef = ref(database, `sessions/${userProfile.sessionId}/memos/${userProfile.teamNumber}`);
    const unsubscribe = onValue(memoRef, (snapshot) => {
      const data = snapshot.val();
      // 데이터가 있으면 설정, 없으면 빈 문자열 유지
      setMemo(data || '');
    });

    return () => unsubscribe();
  }, [userProfile.sessionId, userProfile.teamNumber]);

  // 메모 변경 시 Firebase에 저장 (디바운스 적용)
  const handleMemoChange = (newMemo: string) => {
    setMemo(newMemo);

    // 이전 타이머 취소
    if (memoTimeoutRef.current) {
      clearTimeout(memoTimeoutRef.current);
    }

    // 300ms 후에 Firebase에 저장 (더 빠른 동기화)
    memoTimeoutRef.current = setTimeout(async () => {
      if (userProfile.sessionId && userProfile.teamNumber) {
        await update(getSessionRef(userProfile.sessionId), {
          [`memos/${userProfile.teamNumber}`]: newMemo
        });
      }
    }, 300);
  };

  const activeSession = sessions.find(s => s.id === (role === 'ADMIN' ? activeSessionId : userProfile.sessionId));

  const myClues = useMemo(() => {
    if (!activeSession) return [];
    if (isViewAllMode) return CLUES;
    return distributeClues(CLUES, activeSession.teamCount, userProfile.teamNumber);
  }, [activeSession, userProfile.teamNumber, isViewAllMode]);

  const createSession = async (name: string, teams: number) => {
    const sessionId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const newSession = {
      groupName: name,
      teamCount: teams,
      isOpen: false,
      isResultReleased: false,
      submissions: {},
      participants: {},
      createdAt: Date.now()
    };

    await set(getSessionRef(sessionId), newSession);
    setActiveSessionId(sessionId);
  };

  const registerParticipant = async () => {
    if (!userProfile.sessionId || !userProfile.name) return;

    const session = sessions.find(s => s.id === userProfile.sessionId);
    if (!session) return;

    // 이미 등록된 이름인지 확인
    const alreadyJoined = session.participants.some(
      p => p.name === userProfile.name && p.teamNumber === userProfile.teamNumber
    );

    if (!alreadyJoined) {
      const participantId = Date.now().toString();
      const newParticipant: Participant = {
        name: userProfile.name,
        teamNumber: userProfile.teamNumber,
        joinedAt: Date.now()
      };

      await update(getSessionRef(userProfile.sessionId), {
        [`participants/${participantId}`]: newParticipant
      });
    }

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

    const newSubmission: SubmissionData = {
      ...submitData,
      userName: userProfile.name
    };

    await update(getSessionRef(userProfile.sessionId), {
      [`submissions/${userProfile.teamNumber}`]: newSubmission
    });

    setPhase(GamePhase.CHECKING);
  };

  const toggleSessionOpen = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      await update(getSessionRef(id), { isOpen: !session.isOpen });
    }
  };

  const releaseResults = async (id: string) => {
    await update(getSessionRef(id), { isResultReleased: true });
  };

  const resetSession = async (id: string) => {
    await update(getSessionRef(id), {
      isResultReleased: false,
      submissions: {},
      participants: {}
    });
  };

  const deleteSession = async (id: string) => {
    if (confirm('이 교육 그룹을 삭제하시겠습니까?')) {
      await remove(getSessionRef(id));
    }
  };

  // 정답 판정 로직
  const isMyTeamCorrect = useMemo(() => {
    if (!activeSession) return false;
    const mySub = activeSession.submissions[userProfile.teamNumber];
    if (!mySub) return false;
    return (
      mySub.day === CORRECT_ANSWER.day &&
      mySub.ampm === CORRECT_ANSWER.ampm &&
      mySub.hour === CORRECT_ANSWER.hour &&
      mySub.minute === CORRECT_ANSWER.minute
    );
  }, [activeSession, userProfile.teamNumber]);

  // --- 관리자 뷰 ---
  const renderAdmin = () => {
    if (!isAdminAuth) {
      return (
        <div className="flex items-center justify-center min-h-[80vh] px-6">
          <form onSubmit={handleAdminLogin} className="brutal-card p-10 w-full max-w-sm space-y-6">
            <h2 className="text-3xl font-poster text-white uppercase tracking-tighter text-center">Admin Access</h2>
            <div className="space-y-2">
              <label className="text-xs font-mono text-zinc-500 uppercase font-bold">Input Command Sequence</label>
              <input
                type="password"
                value={adminPassInput}
                onChange={(e) => setAdminPassInput(e.target.value)}
                placeholder="PASSWORD"
                className="brutal-input w-full text-center tracking-widest text-2xl font-poster"
              />
            </div>
            <button className="brutal-btn w-full py-4 text-xl">AUTHORIZE</button>
          </form>
        </div>
      );
    }

    return (
      <div className="p-4 max-w-lg mx-auto animate-fade-in space-y-8 pb-32">
        <div className="brutal-card bg-zinc-900 p-8 border-white shadow-[10px_10px_0px_#e11d48]">
          <h2 className="text-2xl font-poster text-red-600 mb-6 uppercase tracking-tighter">Mission Control</h2>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createSession(fd.get('name') as string, parseInt(fd.get('teams') as string));
            e.currentTarget.reset();
          }} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-zinc-400 font-bold uppercase">SESSION NAME</label>
              <input name="name" required placeholder="교육 과정명을 입력하세요" className="brutal-input w-full text-base" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                 <label className="text-[10px] font-mono text-zinc-400 font-bold uppercase">UNIT COUNT</label>
                 <select name="teams" className="brutal-input w-full appearance-none text-base">
                   {Array.from({length: 12}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} Units</option>)}
                 </select>
              </div>
              <button className="brutal-btn-red px-6 self-end h-[62px] text-lg uppercase">OPEN GATE</button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-sm font-poster text-white uppercase tracking-[0.3em]">Active Sectors</h3>
            <button onClick={() => setIsAdminAuth(false)} className="text-[10px] font-mono text-red-500 underline font-bold">Logout</button>
          </div>
          {sessions.length === 0 && <div className="text-center py-20 border-4 border-zinc-800 text-zinc-600 font-mono text-sm font-bold">NO ACTIVE SESSIONS</div>}
          {sessions.map(s => (
            <div key={s.id} className="brutal-card p-6 border-white bg-black space-y-6">
              <div className="flex justify-between items-start">
                <div>
                   <h3 className="font-poster text-xl text-white mb-2">{s.groupName}</h3>
                   <div className="flex flex-wrap gap-2 items-center">
                     <span className="text-[10px] font-mono bg-zinc-800 text-zinc-200 px-2 py-0.5 border-2 border-zinc-600 font-bold uppercase">CODE: {s.id}</span>
                     <span className="text-[10px] font-mono bg-zinc-800 text-zinc-200 px-2 py-0.5 border-2 border-zinc-600 font-bold uppercase">{s.teamCount} Teams</span>
                     <span className="text-[10px] font-mono bg-zinc-800 text-zinc-200 px-2 py-0.5 border-2 border-zinc-600 font-bold uppercase">{Object.keys(s.submissions).length} Submits</span>
                   </div>
                </div>
                <div className={`w-5 h-5 border-4 border-white ${s.isOpen ? 'bg-green-500 animate-pulse' : 'bg-red-600'}`}></div>
              </div>

              {/* 실시간 접속 인원 명단 표시 */}
              <div className="border-t-4 border-zinc-800 pt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-poster text-zinc-400 uppercase tracking-widest">Live Operatives</span>
                  <span className="text-[10px] font-mono text-white bg-red-900 px-2 py-0.5 border border-red-700 font-bold">Total: {s.participants.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({length: s.teamCount}, (_, i) => i + 1).map(tNum => {
                    const teamParticipants = s.participants.filter(p => p.teamNumber === tNum);
                    const hasSubmitted = !!s.submissions[tNum];
                    return (
                      <div key={tNum} className={`p-2 border-2 ${hasSubmitted ? 'border-emerald-600 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-950/50'} space-y-1`}>
                        <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1">
                          <span className="text-[10px] font-poster text-white uppercase">{tNum} UNIT</span>
                          {hasSubmitted && <span className="text-[8px] font-mono text-emerald-400 font-bold">READY</span>}
                        </div>
                        {teamParticipants.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {teamParticipants.map((p, idx) => (
                              <span key={idx} className="text-[9px] font-mono bg-white text-black px-1.5 py-0.5 font-bold uppercase">
                                {p.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[8px] font-mono text-zinc-700 italic">EMPTY</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button onClick={() => toggleSessionOpen(s.id)} className={`brutal-btn py-3 text-xs ${s.isOpen ? 'bg-zinc-800 text-white' : 'bg-blue-600 text-white border-white'}`}>
                  {s.isOpen ? 'GATE CLOSED' : 'OPEN GATE'}
                </button>
                <button
                  onClick={() => releaseResults(s.id)}
                  disabled={s.isResultReleased}
                  className={`brutal-btn py-3 text-xs ${s.isResultReleased ? 'opacity-30' : 'bg-emerald-600 text-white border-white'}`}
                >
                  {s.isResultReleased ? 'PUBLISHED' : 'PUBLISH RESULTS'}
                </button>
                <button onClick={() => resetSession(s.id)} className="brutal-btn py-3 text-xs bg-zinc-100">RESET DATA</button>
                <button onClick={() => deleteSession(s.id)} className="brutal-btn py-3 text-xs bg-red-800 text-white border-white">TERMINATE</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- 학습자 뷰 ---
  const renderStudentIntro = () => (
    <div className="max-w-md mx-auto px-6 h-[calc(100vh-80px)] animate-fade-in flex flex-col items-center justify-center overflow-hidden">
      <div className="w-16 h-16 mb-4 bg-red-700 border-4 border-white shadow-[6px_6px_0px_#000] flex items-center justify-center transform rotate-3">
         <span className="text-4xl font-poster text-white">Z</span>
      </div>
      <h1 className="text-3xl font-poster text-white mb-1 tracking-tighter uppercase text-center leading-none">THE<br/><span className="text-red-600 text-4xl">RESURRECTION</span></h1>
      <p className="text-[9px] font-mono text-zinc-500 tracking-[0.4em] mb-4 uppercase text-center font-bold">Protocol: Survival Simulation</p>

      <div className="w-full brutal-card p-5 bg-zinc-950 space-y-4">
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono text-zinc-400 uppercase block mb-1 font-bold">Target Sector</label>
            <select value={userProfile.sessionId} onChange={(e) => setUserProfile({...userProfile, sessionId: e.target.value})} className="brutal-input w-full py-2 appearance-none text-sm font-bold">
              <option value="">Select Operation Area...</option>
              {sessions.filter(s => s.isOpen).map(s => <option key={s.id} value={s.id}>{s.groupName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-zinc-400 uppercase block mb-1 font-bold">Squad ID</label>
            <div className="grid grid-cols-4 gap-1.5">
              {userProfile.sessionId ? (
                Array.from({length: sessions.find(s => s.id === userProfile.sessionId)?.teamCount || 0}, (_, i) => i + 1).map(num => (
                  <button key={num} onClick={() => setUserProfile({...userProfile, teamNumber: num})} className={`py-2 text-[14px] font-poster border-4 transition-all ${userProfile.teamNumber === num ? 'bg-red-600 border-white text-white translate-x-1 translate-y-1 shadow-none' : 'bg-black border-zinc-800 text-zinc-600 shadow-[2px_2px_0px_#000]'}`}>
                    {num}
                  </button>
                ))
              ) : <div className="col-span-full py-3 text-[10px] font-mono text-zinc-700 text-center border-4 border-dashed border-zinc-900 font-bold uppercase">WAITING FOR SECTOR...</div>}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-zinc-400 uppercase block mb-1 font-bold">Operative Name</label>
            <input type="text" placeholder="IDENTITY" value={userProfile.name} onChange={(e) => setUserProfile({...userProfile, name: e.target.value})} className="brutal-input w-full py-2 font-poster text-xl uppercase placeholder:opacity-30" />
          </div>
        </div>
        <button disabled={!userProfile.name || !userProfile.sessionId} onClick={registerParticipant} className="brutal-btn-red w-full py-3 text-xl tracking-[0.2em] disabled:opacity-30">INITIATE MISSION</button>
      </div>
    </div>
  );

  const renderStudentStory = () => (
    <div className="min-h-screen bg-black text-zinc-200 flex flex-col items-center pb-24 px-6 overflow-y-auto">
      <div className="w-full relative h-[300px] bg-zinc-900 border-b-[8px] border-red-700 mt-6 shadow-[10px_10px_0px_#fff]">
        <img src="https://images.unsplash.com/photo-1620121692029-d088224ddc74?q=80&w=1932&auto=format&fit=crop" className="w-full h-full object-cover grayscale contrast-150 brightness-50" alt="Zombie Poster" />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
           <span className="bg-red-700 text-white font-mono text-[11px] px-3 py-1 mb-4 border-4 border-black font-bold">CLASSIFIED</span>
           <h2 className="text-6xl font-poster text-white tracking-tighter leading-none mb-1 glitch">Z-INFEST</h2>
           <p className="text-lg font-poster text-red-600 uppercase tracking-widest">Operation: Red Dawn</p>
        </div>
      </div>

      <div className="max-w-md w-full py-12 space-y-10 animate-fade-in">
        <div className="space-y-8 text-[16px] leading-relaxed font-bold break-keep text-justify">
          <p className="first-letter:text-7xl first-letter:font-poster first-letter:text-red-700 first-letter:float-left first-letter:mr-3 first-letter:mt-1 border-l-8 border-red-700 pl-4 py-2">
            옛날 어느 마을, 청년 콜롬버스와 그의 동료 위치타가 살고 있었습니다. 평화로운 시골마을. 어느 날, 숲 속에 시체들이 돌아다닌다는 이상한 소문이 돌았습니다.
          </p>
          <p className="border-r-8 border-white pr-4 py-2 text-right">
            평화롭던 마을에 들이닥친 시체들은 바로 좀비였습니다. 좀비들은 사람을 공격하고 납치하기 시작했고, 위치타도 함께 실종 되었습니다. 그녀를 찾기 위해 수소문 하였지만, 아는 사람이 없었습니다!
          </p>
          <p className="bg-white text-black p-5 font-poster text-lg border-4 border-red-600 shadow-[8px_8px_0px_#e11d48]">
            콜롬버스는 동료들과 함께 위치타를 구하기 위해 좀비 무리를 찾기 시작합니다. 그녀를 데려간 좀비 무리를 발견하고 총으로 공격해 보았지만, 그들을 막지 못했습니다.
          </p>
          <div className="brutal-card bg-red-950 p-6 italic text-white relative border-white">
            <span className="absolute -top-4 -left-2 bg-black px-2 text-[11px] font-mono border-2 border-white font-bold">URGENT INTEL</span>
            "하지만 우연히 알게 된 정보로 '생사초'를 찾아 다시 그녀를 살리기 위해 나서는데… 과연 이 좀비들을 물리치고 동료 위치타를 무사히 구할 수 있을지…"
          </div>
          <p className="text-center font-poster text-2xl text-red-600 uppercase tracking-tighter">
            THE JOURNEY BEGINS WITH YOU.
          </p>
        </div>
        <button
          onClick={() => setPhase(GamePhase.MAIN_GAME)}
          className="brutal-btn-red w-full py-6 text-3xl tracking-[0.1em]"
        >
          ENTER THE SECTOR
        </button>
        <button type="button" onClick={() => setPhase(GamePhase.INTRO)} className="w-full text-[10px] font-mono text-zinc-600 uppercase underline font-bold mt-4">Back to Lobby</button>
      </div>
    </div>
  );

  const renderStudentMain = () => (
    <div className="max-w-md mx-auto px-5 py-8 pb-48 animate-fade-in space-y-10">
      <button type="button" onClick={() => setPhase(GamePhase.STORY)} className="text-[10px] font-mono text-zinc-600 uppercase underline font-bold">← Back to Story</button>
      <div className="brutal-card p-6 border-white bg-black flex items-center justify-between shadow-[8px_8px_0px_#e11d48]">
         <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase block font-bold">OPERATIVE</span>
            <span className="text-2xl font-poster text-white uppercase">{userProfile.name}</span>
         </div>
         <div className="text-right">
            <span className="text-[10px] font-mono text-red-600 uppercase block font-bold">UNIT SECTOR</span>
            <span className="text-5xl font-poster text-red-700 leading-none">{userProfile.teamNumber}</span>
         </div>
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-end">
           <h3 className="text-sm font-poster text-white uppercase tracking-[0.2em] flex items-center gap-2">
             <span className="w-3 h-3 bg-red-600 animate-pulse border-2 border-white"></span>
             INTEL FRAGMENTS
           </h3>
           <button
             onClick={() => setIsViewAllMode(!isViewAllMode)}
             className={`px-3 py-1 font-mono text-[10px] border-4 transition-all font-bold ${isViewAllMode ? 'bg-white text-black border-black shadow-[2px_2px_0px_#e11d48]' : 'bg-black text-zinc-500 border-zinc-800'}`}
           >
             {isViewAllMode ? 'SHOW UNIT ONLY' : 'VIEW ALL INTEL'}
           </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {myClues.map(clue => (
            <div
              key={clue.id}
              onClick={() => setSelectedClue(clue)}
              className="relative aspect-square bg-black border-4 border-zinc-800 cursor-pointer hover:border-white transition-all overflow-hidden group active:scale-95 shadow-[4px_4px_0px_rgba(0,0,0,0.5)]"
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
          <h3 className="text-sm font-poster text-white uppercase tracking-[0.2em]">COLLABORATIVE LOG</h3>
          <span className="text-[10px] font-mono text-green-500 animate-pulse">● LIVE SYNC</span>
        </div>
        <div className="brutal-card p-1 border-white shadow-none">
          <textarea
            value={memo}
            onChange={(e) => handleMemoChange(e.target.value)}
            placeholder="팀원들과 실시간 공유됩니다. 다른 팀에서 받은 정보를 기록하세요..."
            className="w-full h-64 bg-black p-5 text-base text-green-500 font-mono outline-none resize-none placeholder:text-zinc-800 border-none font-bold"
          />
        </div>
      </div>

      <div className="fixed bottom-10 left-0 right-0 px-6 max-w-md mx-auto z-[80]">
        <button
          onClick={() => setPhase(GamePhase.SUBMIT)}
          className="brutal-btn w-full py-6 text-3xl shadow-[8px_8px_0px_#000]"
        >
          SUBMIT COORDS
        </button>
      </div>

      {selectedClue && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/98 backdrop-blur-xl">
          <div className="brutal-card p-2 border-white w-full max-w-sm animate-scale-in relative">
            <button
              onClick={() => setSelectedClue(null)}
              className="absolute -top-4 -right-4 w-12 h-12 brutal-btn-red flex items-center justify-center text-3xl font-poster z-50"
            >
              X
            </button>
            <img src={selectedClue.imageUrl} alt={selectedClue.label} className="w-full h-auto border-4 border-black" />
            <div className="bg-black text-white p-4 mt-2 font-poster flex justify-between items-center border-t-4 border-white">
               <span className="text-3xl uppercase tracking-tighter">{selectedClue.label}</span>
               <span className="font-mono text-[10px] text-red-600 font-bold">ENCRYPTED DATA</span>
            </div>
          </div>
          <div className="absolute inset-0 z-[-1]" onClick={() => setSelectedClue(null)}></div>
        </div>
      )}
    </div>
  );

  const renderSubmitForm = () => (
    <div className="max-w-md mx-auto px-6 py-12 animate-fade-in space-y-10">
      <div className="text-center space-y-2">
         <span className="bg-red-700 text-white font-mono text-[11px] px-3 py-1 border-4 border-black font-bold">FINAL STEP</span>
         <h2 className="text-5xl font-poster text-white uppercase tracking-tighter">GOLDEN TIME</h2>
         <p className="text-zinc-500 font-mono text-xs uppercase font-bold">Precision is survival.</p>
      </div>

      <form onSubmit={handleFinalSubmit} className="brutal-card p-8 bg-zinc-950 space-y-8 border-white">
        <div className="space-y-2">
          <label className="text-[10px] font-mono text-zinc-400 uppercase ml-1 font-bold">Proposed Day</label>
          <select
            required
            value={submitData.day}
            onChange={(e) => setSubmitData({...submitData, day: e.target.value})}
            className="brutal-input w-full text-center font-poster text-2xl uppercase appearance-none"
          >
            <option value="">SELECT DAY</option>
            {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-zinc-400 uppercase ml-1 font-bold">Period</label>
            <select
              value={submitData.ampm}
              onChange={(e) => setSubmitData({...submitData, ampm: e.target.value})}
              className="brutal-input w-full text-center font-poster text-2xl appearance-none"
            >
              <option value="오전">AM</option>
              <option value="오후">PM</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-zinc-400 uppercase ml-1 font-bold">Time</label>
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
          <button className="brutal-btn-red w-full py-6 text-3xl uppercase tracking-widest">REPORT DATA</button>
          <button type="button" onClick={() => setPhase(GamePhase.MAIN_GAME)} className="w-full text-[10px] font-mono text-zinc-600 uppercase underline font-bold">Back to Operations</button>
        </div>
      </form>
    </div>
  );

  if (authError) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center px-6">
        <div className="brutal-card p-10 w-full max-w-sm space-y-6 text-center border-red-600">
          <h2 className="text-3xl font-poster text-red-600 uppercase tracking-tighter">CONNECTION FAILED</h2>
          <p className="text-sm font-mono text-zinc-400">{authError}</p>
          <button onClick={() => window.location.reload()} className="brutal-btn-red w-full py-4 text-xl">RETRY</button>
        </div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-t-8 border-r-8 border-red-600 border-l-8 border-l-zinc-800 border-b-8 border-b-zinc-800 rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-mono text-zinc-500 uppercase tracking-widest font-bold">Establishing Connection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-red-500 overflow-x-hidden">
      <header className="bg-black border-b-[6px] border-white p-4 flex justify-between items-center sticky top-0 z-[100] h-20 shadow-[0_6px_0px_#e11d48]">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-red-600 border-4 border-white rotate-45"></div>
          <span className="text-xl font-poster text-white uppercase italic tracking-tighter">TEAM MISSION</span>
        </div>
        <div className="flex bg-zinc-900 p-1 border-4 border-white shadow-[3px_3px_0px_#000]">
          <button onClick={() => { setRole('STUDENT'); }} className={`px-4 py-1.5 text-[14px] font-poster transition-all uppercase ${role === 'STUDENT' ? 'bg-white text-black' : 'text-zinc-500'}`}>S</button>
          <button onClick={() => { setRole('ADMIN'); }} className={`px-4 py-1.5 text-[14px] font-poster transition-all uppercase ${role === 'ADMIN' ? 'bg-white text-black' : 'text-zinc-500'}`}>A</button>
        </div>
      </header>

      <main className="relative pb-10">
        <div className="vignette"></div>
        {role === 'ADMIN' ? (
          renderAdmin()
        ) : (
          <>
            {phase === GamePhase.INTRO && renderStudentIntro()}
            {phase === GamePhase.STORY && renderStudentStory()}
            {phase === GamePhase.MAIN_GAME && renderStudentMain()}
            {phase === GamePhase.SUBMIT && renderSubmitForm()}
            {phase === GamePhase.CHECKING && (
              <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center space-y-12 animate-fade-in bg-black px-10 text-center">
                <div className="brutal-card p-10 bg-zinc-950 border-white rotate-2">
                   <div className="w-24 h-24 border-t-8 border-r-8 border-red-600 border-l-8 border-l-zinc-800 border-b-8 border-b-zinc-800 rounded-full animate-spin mx-auto mb-8"></div>
                   <h3 className="text-4xl font-poster text-white uppercase tracking-wider mb-4 glitch">UPLOADING...</h3>
                   <p className="text-zinc-500 font-mono text-[11px] uppercase tracking-[0.2em] font-bold">Data Verification In Progress</p>
                </div>
                <div className="max-w-xs space-y-4">
                  <p className="text-red-500 text-[12px] font-mono animate-pulse font-bold">DO NOT TERMINATE CONNECTION</p>
                  <p className="text-zinc-400 text-sm leading-relaxed font-bold uppercase italic">
                    Waiting for Commander approval. The fate of Wichita rests on the final sequence analysis.
                  </p>
                </div>
              </div>
            )}
            {phase === GamePhase.RESULT && (
              <div className="max-w-md mx-auto px-8 py-20 text-center flex flex-col justify-center min-h-[calc(100vh-80px)] animate-fade-in space-y-10">
                {isMyTeamCorrect ? (
                  <>
                    <div className="w-32 h-32 mx-auto bg-green-500 border-8 border-white flex items-center justify-center text-6xl shadow-[10px_10px_0px_#000] rotate-3">✓</div>
                    <h2 className="text-6xl font-poster text-green-500 leading-none tracking-tighter">MISSION<br/>SUCCESS</h2>
                    <div className="brutal-card p-8 border-green-500 bg-zinc-950 shadow-[10px_10px_0px_#000]">
                      <p className="text-slate-100 text-xl leading-relaxed font-bold break-keep">
                        완벽한 <span className="text-green-400 underline decoration-white underline-offset-4">협업</span>입니다! 골든타임을 정확히 맞췄습니다. 위치타가 의식을 되찾았고, 인류의 희망이 지켜졌습니다!
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-32 h-32 mx-auto bg-red-700 border-8 border-white flex items-center justify-center text-6xl shadow-[10px_10px_0px_#000] -rotate-3">✗</div>
                    <h2 className="text-6xl font-poster text-red-600 leading-none tracking-tighter">MISSION<br/>FAILED</h2>
                    <div className="brutal-card p-8 border-red-700 bg-zinc-950 shadow-[10px_10px_0px_#000]">
                      <p className="text-slate-100 text-xl leading-relaxed font-bold break-keep">
                        아쉽지만 해당 시간에는 생사초를 먹일 수가 없었습니다. 위치타를 구할 수 있는 골든타임은 다른 시각이었던 것 같네요. 우리 팀의 소통 과정에서 놓친 정보는 없었는지 다시 한번 이야기를 나누어 봅시다.
                      </p>
                    </div>
                  </>
                )}
                <button onClick={() => { setPhase(GamePhase.INTRO); }} className="brutal-btn w-full py-5 text-2xl">BACK TO START</button>
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
