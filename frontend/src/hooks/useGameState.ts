import { useEffect, useMemo, useRef, useState } from "react";
import { connectSocket, disconnectSocket, emitWithAck, getSocket } from "../lib/socket";
import type { ChatMessage, JoinAck, Phase, Player, Stroke } from "../types/socket";

type GameRevealPayload = {
  prompt: string[];
  correctWords: string[];
  assignments: Record<string, string>;
  guesses: Record<string, string[]>;
  scores: Record<string, { guesserPoints: number; drawerPoints: number; totalPoints: number }>;
  currentRound?: number;
  maxRounds?: number;
  totalScores?: Record<string, number>;
};

export function useGameState() {
  const [serverUrl, setServerUrl] = useState(import.meta.env.VITE_SERVER_URL ?? "http://localhost:3020");
  const [connected, setConnected] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [phase, setPhase] = useState<Phase>("LOBBY");
  const [me, setMe] = useState<(Player & { roomId?: string; roomName?: string }) | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [prompt, setPrompt] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [slotIndices, setSlotIndices] = useState<Record<string, number>>({});
  const [strokesByPlayer, setStrokesByPlayer] = useState<Record<string, Stroke[]>>({});
  const [chat, setChat] = useState<Array<{ name: string; text: string; isCorrect?: boolean }>>([]);
  const [reveal, setReveal] = useState<GameRevealPayload | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(3);
  const [totalScores, setTotalScores] = useState<Record<string, number>>({});
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);
  const [hasSavedIdentity, setHasSavedIdentity] = useState(false);
  const [savedIdentity, setSavedIdentity] = useState<{ name: string; roomId: string; playerId: string } | null>(null);

  const timerBase = useRef(0);
  const timerAt = useRef(0);
  const meRef = useRef<(Player & { roomId?: string; roomName?: string }) | null>(null);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    const socket = connectSocket(serverUrl);

    const onConnect = () => {
      setConnected(true);
      const savedName = window.sessionStorage.getItem("demo_name");
      const savedRoomId = window.sessionStorage.getItem("demo_roomId");
      const savedPlayerId = window.sessionStorage.getItem("demo_playerId");
      const hasSaved = !!(savedName && savedRoomId && savedPlayerId);
      setHasSavedIdentity(hasSaved);
      setSavedIdentity(
        hasSaved
          ? { name: savedName!, roomId: savedRoomId!, playerId: savedPlayerId! }
          : null
      );
    };
    const onDisconnect = () => {
      setConnected(false);
      // Mirror old client behavior: drop to out-of-room UI and wait for explicit reconnect.
      setInRoom(false);
      timerAt.current = 0;
      setTimeLeftMs(null);
    };
    const onRoomPlayers = (payload: { players: Player[] }) => {
      const nextPlayers = payload.players ?? [];
      setPlayers(nextPlayers);
      // Keep host permissions synced from authoritative room:players updates.
      setMe((prev) => {
        if (!prev) return prev;
        const mine = nextPlayers.find((p) => p.playerId === prev.playerId);
        if (!mine) return prev;
        return { ...prev, isHost: !!mine.isHost };
      });
    };
    const onGameState = (payload: {
      phase: Phase;
      prompt?: string[];
      assignments?: Record<string, string>;
      slotIndices?: Record<string, number>;
      strokes?: Stroke[];
      timeRemaining?: number;
      currentRound?: number;
      maxRounds?: number;
      totalScores?: Record<string, number>;
    }) => {
      const prevPhase = phase; // capture current
      setPhase(payload.phase);
      if (payload.prompt) setPrompt(payload.prompt);
      if (payload.assignments) setAssignments(payload.assignments);
      if (payload.slotIndices) setSlotIndices(payload.slotIndices);
      if (payload.currentRound !== undefined) setCurrentRound(payload.currentRound);
      if (payload.maxRounds !== undefined) setMaxRounds(payload.maxRounds);
      if (payload.totalScores) setTotalScores(payload.totalScores);

      if (Array.isArray(payload.strokes)) {
        const grouped: Record<string, Stroke[]> = {};
        for (const stroke of payload.strokes) {
          if (!grouped[stroke.playerId]) grouped[stroke.playerId] = [];
          grouped[stroke.playerId].push(stroke);
        }
        setStrokesByPlayer(grouped);
      }
      // When a new DRAWING round starts, clear local canvases to mirror old client.js
      if (payload.phase === "DRAWING" && prevPhase !== "DRAWING") {
        setStrokesByPlayer({});
      }
      if (typeof payload.timeRemaining === "number") {
        timerBase.current = payload.timeRemaining;
        timerAt.current = Date.now();
      } else {
        setTimeLeftMs(null);
      }
      if (payload.phase !== "REVEAL" && payload.phase !== "GAME_OVER") {
        setReveal(null);
      }
    };

    const onGameReveal = (payload: GameRevealPayload) => {
      setPhase("REVEAL");
      setReveal(payload);
      if (payload.currentRound !== undefined) setCurrentRound(payload.currentRound);
      if (payload.maxRounds !== undefined) setMaxRounds(payload.maxRounds);
      if (payload.totalScores) setTotalScores(payload.totalScores);
    };

    const onGameOver = (payload: { totalScores?: Record<string, number> }) => {
      setPhase("GAME_OVER");
      if (payload.totalScores) setTotalScores(payload.totalScores);
    };

    const onCanvasClear = (payload: { playerId: string }) => {
      setStrokesByPlayer((prev) => ({ ...prev, [payload.playerId]: [] }));
    };

    const onChatMessage = (payload: ChatMessage) => {
      // Mirror old client: don't duplicate your own chat locally
      if (payload.playerId && payload.playerId === meRef.current?.playerId) return;
      setChat((prev) => [...prev, { name: payload.name, text: payload.text, isCorrect: payload.isCorrect }]);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:players", onRoomPlayers);
    socket.on("game:state", onGameState);
    socket.on("game:reveal", onGameReveal);
    socket.on("game:gameOver", onGameOver);
    socket.on("canvas:clear", onCanvasClear);
    socket.on("chat:message", onChatMessage);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:players", onRoomPlayers);
      socket.off("game:state", onGameState);
      socket.off("game:reveal", onGameReveal);
      socket.off("game:gameOver", onGameOver);
      socket.off("canvas:clear", onCanvasClear);
      socket.off("chat:message", onChatMessage);
      disconnectSocket();
    };
  }, [serverUrl]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!timerAt.current) return;
      const remaining = Math.max(0, timerBase.current - (Date.now() - timerAt.current));
      setTimeLeftMs(remaining);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const myAssignedWord = useMemo(() => {
    if (!me?.playerId) return "";
    return assignments[me.playerId] ?? "";
  }, [assignments, me?.playerId]);

  async function createRoom(name: string, roomName: string, maxRoundsSetting: number, maxPlayers: number) {
    const res = await emitWithAck("room:create", {
      name: name.trim(),
      roomName: roomName.trim(),
      maxRounds: maxRoundsSetting,
      maxPlayers,
    }) as JoinAck;
    if (!res.ok || !res.player || !res.snapshot) return res;
    applyJoinSnapshot(name, res);
    return res;
  }

  async function joinRoom(name: string, roomId: string, useSavedIdentity = true) {
    const resumePlayerId = useSavedIdentity
      ? window.sessionStorage.getItem("demo_playerId") || undefined
      : undefined;
    const res = await emitWithAck("player:join", {
      name: name.trim(),
      roomId: roomId.trim(),
      resumePlayerId,
    }) as JoinAck;
    if (!res.ok || !res.player || !res.snapshot) return res;
    applyJoinSnapshot(name, res);
    return res;
  }

  function applyJoinSnapshot(name: string, res: JoinAck) {
    const p = res.player!;
    const snap = res.snapshot!;
    setInRoom(true);
    setMe({ ...p });
    setPlayers(snap.players ?? []);
    setPhase(snap.phase);
    setPrompt(snap.prompt ?? []);
    setAssignments(snap.assignments ?? {});
    setSlotIndices(snap.slotIndices ?? {});
    setCurrentRound(snap.currentRound ?? 0);
    setMaxRounds(snap.maxRounds ?? 3);
    setTotalScores(snap.totalScores ?? {});
    const grouped: Record<string, Stroke[]> = {};
    for (const stroke of snap.strokes ?? []) {
      if (!grouped[stroke.playerId]) grouped[stroke.playerId] = [];
      grouped[stroke.playerId].push(stroke);
    }
    setStrokesByPlayer(grouped);
    setChat([]);
    if (
      snap.phase === "REVEAL" &&
      snap.scores &&
      snap.correctWords &&
      snap.prompt &&
      snap.assignments &&
      snap.guesses
    ) {
      setReveal({
        prompt: snap.prompt,
        correctWords: snap.correctWords,
        assignments: snap.assignments,
        guesses: Object.fromEntries(
          Object.entries(snap.guesses).map(([pid, g]) => [pid, g ?? []])
        ) as Record<string, string[]>,
        scores: snap.scores,
        currentRound: snap.currentRound,
        maxRounds: snap.maxRounds,
        totalScores: snap.totalScores,
      });
    } else {
      setReveal(null);
    }

    window.sessionStorage.setItem("demo_playerId", p.playerId);
    window.sessionStorage.setItem("demo_roomId", p.roomId);
    window.sessionStorage.setItem("demo_name", name);
    window.sessionStorage.setItem("demo_roomName", p.roomName ?? "");
    setHasSavedIdentity(true);
    setSavedIdentity({ name, roomId: p.roomId, playerId: p.playerId });
    if (typeof snap.timeRemaining === "number") {
      timerBase.current = snap.timeRemaining;
      timerAt.current = Date.now();
    } else {
      timerAt.current = 0;
      setTimeLeftMs(null);
    }
  }

  async function startGame() {
    return emitWithAck("game:start");
  }
  async function leaveRoom() {
    const res = await emitWithAck("room:leave", {});
    if ((res as { ok?: boolean }).ok) {
      setInRoom(false);
      setPhase("LOBBY");
      setPlayers([]);
      setAssignments({});
      setPrompt([]);
      setStrokesByPlayer({});
      setMe(null);
      clearSavedIdentity();
    }
    return res;
  }
  async function returnToLobby() {
    return emitWithAck("game:returnToLobby");
  }
  async function submitGuess(text: string) {
    const res = (await emitWithAck("guess:submit", { text })) as { ok?: boolean; correct?: boolean };
    if (res?.ok) {
      setChat((prev) => [
        ...prev,
        { name: me?.name ?? "You", text: res.correct ? "" : text, isCorrect: !!res.correct },
      ]);
    }
    return res;
  }
  async function finishDrawing() {
    return emitWithAck("drawing:finish");
  }
  async function clearCanvas() {
    return emitWithAck("canvas:clear");
  }

  async function reconnectAsSavedIdentity() {
    const savedName = window.sessionStorage.getItem("demo_name");
    const savedRoomId = window.sessionStorage.getItem("demo_roomId");
    if (!savedName || !savedRoomId) return { ok: false, error: "NO_SAVED_IDENTITY" };
    return joinRoom(savedName, savedRoomId, true);
  }

  function clearSavedIdentity() {
    window.sessionStorage.removeItem("demo_playerId");
    window.sessionStorage.removeItem("demo_roomId");
    window.sessionStorage.removeItem("demo_name");
    window.sessionStorage.removeItem("demo_roomName");
    setHasSavedIdentity(false);
    setSavedIdentity(null);
  }

  function roomLabel() {
    return me?.roomName ? `${me.roomName} (${me.roomId})` : me?.roomId ?? "";
  }

  return {
    connected,
    inRoom,
    phase,
    me,
    players,
    prompt,
    assignments,
    slotIndices,
    strokesByPlayer,
    chat,
    reveal,
    currentRound,
    maxRounds,
    totalScores,
    timeLeftMs,
    hasSavedIdentity,
    savedIdentity,
    myAssignedWord,
    serverUrl,
    setServerUrl,
    createRoom,
    joinRoom,
    reconnectAsSavedIdentity,
    clearSavedIdentity,
    startGame,
    leaveRoom,
    returnToLobby,
    submitGuess,
    finishDrawing,
    clearCanvas,
    roomLabel,
    socket: getSocket(),
  };
}
