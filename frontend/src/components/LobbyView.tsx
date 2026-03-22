import { useState } from "react";
import type { Player } from "../types/socket";

type Props = {
  connected: boolean;
  inRoom: boolean;
  serverUrl: string;
  setServerUrl: (v: string) => void;
  me: (Player & { roomId?: string; roomName?: string }) | null;
  players: Player[];
  phase: string;
  hasSavedIdentity: boolean;
  savedIdentity: { name: string; roomId: string; playerId: string } | null;
  onCreateRoom: (name: string, roomName: string, rounds: number, maxPlayers: number) => Promise<void>;
  onJoinRoom: (name: string, roomId: string, useSavedIdentity?: boolean) => Promise<void>;
  onReconnectSaved: () => Promise<void>;
  onChangePlayer: () => void;
  onStartGame: () => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onCopyRoomId: () => Promise<void>;
  message?: string;
};

export function LobbyView(props: Props) {
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [rounds, setRounds] = useState(3);
  const [maxPlayers, setMaxPlayers] = useState(6);

  if (!props.inRoom) {
    return (
      <section className="panel">
        <h2>Lobby</h2>
        <div className="field">
          <label>Server URL</label>
          <input value={props.serverUrl} onChange={(e) => props.setServerUrl(e.target.value)} />
          <small>Status: {props.connected ? "Connected" : "Disconnected"}</small>
        </div>
        {props.hasSavedIdentity ? (
          <div className="card">
            <h3>Resume Your Game</h3>
            <p>
              Reconnect as <b>{props.savedIdentity?.name}</b> in room <code>{props.savedIdentity?.roomId}</code>?
            </p>
            <div className="actions">
              <button onClick={() => void props.onReconnectSaved()}>Reconnect</button>
              <button onClick={() => props.onChangePlayer()}>Change Player</button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Your Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="grid-2">
          <div className="card">
            <h3>Create Room</h3>
            <div className="field">
              <label>Room Name</label>
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
            </div>
            <div className="field">
              <label>Rounds: {rounds}</label>
              <input type="range" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Players: {maxPlayers}</label>
              <input type="range" min={2} max={6} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
            </div>
            <button onClick={() => void props.onCreateRoom(name, roomName, rounds, maxPlayers)} disabled={props.hasSavedIdentity}>
              Create
            </button>
          </div>
          <div className="card">
            <h3>Join Room</h3>
            <div className="field">
              <label>Room ID</label>
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
            </div>
            <button onClick={() => void props.onJoinRoom(name, roomId, false)} disabled={props.hasSavedIdentity}>
              Join
            </button>
          </div>
        </div>
        {props.message && <p className="inline-message">{props.message}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>In-Room Lobby</h2>
      <p>
        You: <b>{props.me?.name}</b> | Role: <b>{props.me?.isHost ? "Host" : "Player"}</b> | Phase: <b>{props.phase}</b>
      </p>
      <p>Room: {props.me?.roomName ?? props.me?.roomId}</p>
      <ul>
        {props.players.map((p) => (
          <li key={p.playerId}>
            {p.name} {p.isHost ? "[Host]" : ""}
          </li>
        ))}
      </ul>
      {props.phase === "LOBBY" && (
        <div className="actions">
          {props.me?.isHost && <button onClick={() => void props.onStartGame()}>Start Game</button>}
          <button onClick={() => void props.onCopyRoomId()}>Copy Room ID</button>
          <button onClick={() => void props.onLeaveRoom()}>Leave Room</button>
        </div>
      )}
      {props.message && <p className="inline-message">{props.message}</p>}
    </section>
  );
}
