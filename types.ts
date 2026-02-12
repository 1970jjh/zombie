
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
  submittedAt: number;
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
  isMissionStarted: boolean;
  missionStartedAt: number;
  missionDuration: number;
  // Timer pause support
  isPaused: boolean;
  pausedAt: number;
  pausedElapsed: number;
  // Communication round settings
  teamInternalRounds: number;
  teamCrossRounds: number;
  roundDuration: number;
  submitDuration: number;
  // Answer reveal controls
  isAnswerRevealed: boolean;
  isSuccessRevealed: boolean;
  isResultReleased: boolean;
  submissions: { [teamNumber: number]: SubmissionData };
  participants: Participant[];
  liveChat: { [participantId: string]: ChatEntry };
  createdAt: number;
}

export interface MissionPhaseInfo {
  type: 'TEAM_INTERNAL' | 'TEAM_CROSS' | 'SUBMIT';
  index: number;
  roundNumber: number;
  totalPhases: number;
  phaseRemaining: number;
  phaseProgress: number;
}
