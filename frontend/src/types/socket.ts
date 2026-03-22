export type Phase = "LOBBY" | "DRAWING" | "VIEW_GUESS" | "REVEAL" | "GAME_OVER";

export type Player = {
  playerId: string;
  name: string;
  isHost?: boolean;
  socketId?: string;
};

export type StrokePoint = { x: number; y: number };
export type Stroke = {
  strokeId: string;
  playerId: string;
  color: string;
  thickness: number;
  points: StrokePoint[];
};

export type RoundScore = {
  guesserPoints: number;
  drawerPoints: number;
  totalPoints: number;
};

export type JoinAck = {
  ok: boolean;
  error?: string;
  player?: {
    playerId: string;
    name: string;
    roomId: string;
    roomName?: string;
    isHost: boolean;
  };
  snapshot?: {
    roomId: string;
    roomName?: string;
    phase: Phase;
    players: Player[];
    prompt: string[];
    correctWords: string[];
    assignments: Record<string, string>;
    slotIndices: Record<string, number>;
    guesses: Record<string, string[] | undefined>;
    strokeCounts: Record<string, number>;
    scores: Record<string, RoundScore> | null;
    strokes: Stroke[];
    timeRemaining?: number;
    currentRound?: number;
    maxRounds?: number;
    totalScores?: Record<string, number>;
    maxPlayers?: number;
  };
};

export type ChatMessage = {
  playerId?: string;
  name: string;
  text: string;
  isCorrect?: boolean;
};
