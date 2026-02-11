
export enum GamePhase {
  INTRO = 'INTRO',
  STORY = 'STORY',
  MAIN_GAME = 'MAIN_GAME',
  SUBMIT = 'SUBMIT',
  CHECKING = 'CHECKING',
  RESULT = 'RESULT'
}

export type UserRole = 'ADMIN' | 'STUDENT';

export type ResultStatus = 'PENDING' | 'SUCCESS' | 'FAILURE';

export interface SubmissionData {
  day: string;
  ampm: string;
  hour: string;
  minute: string;
  userName: string;
}

export interface Participant {
  name: string;
  teamNumber: number;
  joinedAt: number;
}

export interface Clue {
  id: string;
  label: string;
  imageUrl: string;
}

export interface UserProfile {
  name: string;
  sessionId: string;
  teamNumber: number;
}

export interface ChatEntry {
  name: string;
  teamNumber: number;
  message: string;
}

export interface Session {
  id: string;
  groupName: string;
  teamCount: number;
  isOpen: boolean;
  isMissionStarted: boolean; // 관리자가 미션 시작 버튼을 눌렀는지 여부
  isResultReleased: boolean; // 관리자가 결과 발표 버튼을 눌렀는지 여부
  submissions: { [teamNumber: number]: SubmissionData }; // 조별 제출 데이터
  participants: Participant[]; // 접속자 명단
  liveChat: { [participantId: string]: ChatEntry }; // 개인별 실시간 채팅
  createdAt: number;
}
