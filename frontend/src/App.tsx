import { LobbyView } from "./components/LobbyView";
import { GameView } from "./components/GameView";
import { emitWithAck } from "./lib/socket";
import { useGameState } from "./hooks/useGameState";
import type { StrokePoint } from "./types/socket";
import { useState } from "react";

export function App() {
  const game = useGameState();
  const [lobbyMessage, setLobbyMessage] = useState("");
  const [gameMessage, setGameMessage] = useState("");

  const explain = (res: unknown) => {
    const r = (res ?? {}) as { error?: string; maxPlayers?: number };
    if (!r.error) return "";
    if (r.error === "ROOM_FULL" && r.maxPlayers) return `Room is full (max ${r.maxPlayers} players).`;
    const map: Record<string, string> = {
      NAME_REQUIRED: "Please enter your name.",
      ROOM_NAME_REQUIRED: "Please enter a room name.",
      ROOM_ID_REQUIRED: "Please enter a room ID.",
      ROOM_NOT_FOUND: "Room not found. Check the room ID.",
      GAME_ALREADY_STARTED: "Game already started in that room.",
      NOT_IN_ROOM: "You are not currently in a room.",
      INVALID_PHASE: "That action is not allowed in the current phase.",
      ONLY_HOST_CAN_START: "Only host can start the game.",
      NOT_ENOUGH_PLAYERS: "Not enough players to start.",
      NO_SAVED_IDENTITY: "No saved identity found to reconnect.",
      SOCKET_NOT_READY: "Socket is not ready yet. Please retry.",
    };
    return map[r.error] ?? r.error;
  };

  return (
    <main className="app">
      <h1>Draw and Guess (React)</h1>
      <LobbyView
        connected={game.connected}
        inRoom={game.inRoom}
        serverUrl={game.serverUrl}
        setServerUrl={game.setServerUrl}
        me={game.me}
        players={game.players}
        phase={game.phase}
        hasSavedIdentity={game.hasSavedIdentity}
        savedIdentity={game.savedIdentity}
        onCreateRoom={async (name, roomName, rounds, maxPlayers) => {
          const res = await game.createRoom(name, roomName, rounds, maxPlayers);
          setLobbyMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
        }}
        onJoinRoom={async (name, roomId, useSavedIdentity) => {
          const res = await game.joinRoom(name, roomId, useSavedIdentity);
          setLobbyMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
        }}
        onReconnectSaved={async () => {
          const res = await game.reconnectAsSavedIdentity();
          setLobbyMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
        }}
        onChangePlayer={() => {
          game.clearSavedIdentity();
          setLobbyMessage("");
        }}
        onStartGame={async () => {
          const res = await game.startGame();
          const msg = explain(res);
          setLobbyMessage(msg);
          setGameMessage(msg);
        }}
        onLeaveRoom={async () => {
          const res = await game.leaveRoom();
          setLobbyMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
          setGameMessage("");
        }}
        onCopyRoomId={async () => {
          if (!game.me?.roomId) return;
          await navigator.clipboard.writeText(game.me.roomId);
          setLobbyMessage("Room ID copied to clipboard.");
        }}
        message={lobbyMessage}
      />

      {game.inRoom && (
        <GameView
          phase={game.phase}
          me={game.me}
          players={game.players}
          prompt={game.prompt}
          myAssignedWord={game.myAssignedWord}
          strokesByPlayer={game.strokesByPlayer}
          chat={game.chat}
          reveal={game.reveal}
          currentRound={game.currentRound}
          maxRounds={game.maxRounds}
          totalScores={game.totalScores}
          timeLeftMs={game.timeLeftMs}
          onStrokeBegin={async (strokeId: string, color: string, thickness: number) => {
            await emitWithAck("stroke:begin", { strokeId, color, thickness });
          }}
          onStrokePoints={async (strokeId: string, points: StrokePoint[]) => {
            await emitWithAck("stroke:points", { strokeId, points });
          }}
          onStrokeEnd={async (strokeId: string) => {
            await emitWithAck("stroke:end", { strokeId });
          }}
          onSubmitGuess={async (text: string) => {
            const res = await game.submitGuess(text);
            setGameMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
          }}
          onFinishDrawing={async () => {
            const res = await game.finishDrawing();
            setGameMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
          }}
          onClearCanvas={async () => {
            const res = await game.clearCanvas();
            setGameMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
          }}
          onReturnToLobby={async () => {
            const res = await game.returnToLobby();
            setGameMessage((res as { ok?: boolean })?.ok ? "" : explain(res));
          }}
          message={gameMessage}
        />
      )}
    </main>
  );
}
