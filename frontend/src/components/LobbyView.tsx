import { useState } from "react";
import type { Player } from "../types/socket";
import { Badge, Button, Card, Input, LabelField, Message, SectionTitle, Surface, Select } from "./ui";
import { Scene, SceneEffects } from "./Effects";

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
      <Scene>
        <SceneEffects active={true} variant="lobby" />
        <Surface className="panel" glow>
          <SectionTitle
            title="Lobby"
            subtitle="Create a room, invite friends, and start the next detective round."
            right={<Badge tone="brand">Pre-Game</Badge>}
          />
          <LabelField label="Server URL" hint={`Status: ${props.connected ? "Connected" : "Disconnected"}`}>
            <Input value={props.serverUrl} onChange={props.setServerUrl} />
          </LabelField>
          {props.hasSavedIdentity ? (
            <Card title="Resume Your Game" subtitle="Quickly return with your saved identity.">
              <p>
                Reconnect as <b>{props.savedIdentity?.name}</b> in room <code>{props.savedIdentity?.roomId}</code>?
              </p>
              <div className="actions">
                <Button variant="primary" onClick={() => void props.onReconnectSaved()}>
                  Reconnect
                </Button>
                <Button variant="ghost" onClick={() => props.onChangePlayer()}>
                  Change Player
                </Button>
              </div>
            </Card>
          ) : (
            <LabelField label="Your Name">
              <Input value={name} onChange={setName} placeholder="Detective name" />
            </LabelField>
          )}
          <div className="grid-2">
            <Card title="Create Room" subtitle="Host a new match and control game settings.">
              <LabelField label="Room Name">
                <Input value={roomName} onChange={setRoomName} placeholder="e.g. ninja-room" />
              </LabelField>
              <LabelField label="Rounds">
                <Select
                  value={rounds}
                  onChange={(v) => setRounds(Number(v))}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
                />
              </LabelField>
              <LabelField label="Players">
                <Select
                  value={maxPlayers}
                  onChange={(v) => setMaxPlayers(Number(v))}
                  options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
                />
              </LabelField>
              <Button
                variant="primary"
                onClick={() => void props.onCreateRoom(name, roomName, rounds, maxPlayers)}
                disabled={props.hasSavedIdentity}
              >
                Create Room
              </Button>
            </Card>
            <Card title="Join Room" subtitle="Enter room ID and jump into the lobby.">
              <LabelField label="Room ID">
                <Input value={roomId} onChange={setRoomId} placeholder="room_xxxxxxxx" />
              </LabelField>
              <Button variant="secondary" onClick={() => void props.onJoinRoom(name, roomId, false)} disabled={props.hasSavedIdentity}>
                Join Room
              </Button>
            </Card>
          </div>
          <Message text={props.message} />
        </Surface>
      </Scene>
    );
  }

  return (
    <Scene>
      <SceneEffects active={props.phase === "LOBBY"} variant="lobby" />
      <Surface className="panel">
        <SectionTitle title="In-Room Lobby" subtitle="Waiting for host to start the round." right={<Badge tone="brand">{props.phase}</Badge>} />
        <p>
          You: <b>{props.me?.name}</b> | Role: <b>{props.me?.isHost ? "Host" : "Player"}</b> | Phase: <b>{props.phase}</b>
        </p>
        <p>
          Room: <code>{props.me?.roomName ?? props.me?.roomId}</code>
        </p>
        <Card title="Players in Room">
          <ul className="player-list">
            {props.players.map((p) => (
              <li key={p.playerId}>
                {p.name} {p.isHost ? <Badge tone="good">Host</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        {props.phase === "LOBBY" && (
          <div className="actions">
            {props.me?.isHost && (
              <Button variant="primary" onClick={() => void props.onStartGame()}>
                Start Game
              </Button>
            )}
            <Button variant="secondary" onClick={() => void props.onCopyRoomId()}>
              Copy Room ID
            </Button>
            <Button variant="danger" onClick={() => void props.onLeaveRoom()}>
              Leave Room
            </Button>
          </div>
        )}
        <Message text={props.message} />
      </Surface>
    </Scene>
  );
}
