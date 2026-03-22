import { useEffect, useState } from "react";
import { CanvasGrid } from "./CanvasGrid";
import type { Player, StrokePoint } from "../types/socket";

type Props = {
  phase: string;
  me: (Player & { roomId?: string }) | null;
  players: Player[];
  prompt: string[];
  myAssignedWord: string;
  strokesByPlayer: Record<string, Array<{ strokeId: string; playerId: string; color: string; thickness: number; points: StrokePoint[] }>>;
  chat: Array<{ name: string; text: string; isCorrect?: boolean }>;
  reveal: {
    prompt: string[];
    correctWords: string[];
    assignments: Record<string, string>;
    guesses: Record<string, string[]>;
    scores: Record<string, { totalPoints: number }>;
  } | null;
  currentRound: number;
  maxRounds: number;
  totalScores: Record<string, number>;
  timeLeftMs: number | null;
  onStrokeBegin: (strokeId: string, color: string, thickness: number) => Promise<void>;
  onStrokePoints: (strokeId: string, points: StrokePoint[]) => Promise<void>;
  onStrokeEnd: (strokeId: string) => Promise<void>;
  onSubmitGuess: (text: string) => Promise<void>;
  onFinishDrawing: () => Promise<void>;
  onClearCanvas: () => Promise<void>;
  onReturnToLobby: () => Promise<void>;
  message?: string;
};

export function GameView(props: Props) {
  const [guessText, setGuessText] = useState("");
  const [brushColor, setBrushColor] = useState("#000000");
  const [brushThickness, setBrushThickness] = useState(3);

  useEffect(() => {
    setGuessText("");
    setBrushColor("#000000");
    setBrushThickness(3);
  }, [props.currentRound]);

  const canDraw = props.phase === "DRAWING";
  const canGuess = props.phase === "VIEW_GUESS";

  return (
    <section className="panel">
      <h2>Game</h2>
      <p>
        Round {props.currentRound}/{props.maxRounds} | Phase: {props.phase}
        {props.timeLeftMs !== null ? ` | Time: ${Math.max(0, Math.floor(props.timeLeftMs / 1000))}s` : ""}
      </p>
      {props.phase === "DRAWING" && (
        <p>
          Your word: <b>{props.myAssignedWord || "(waiting)"}</b>
        </p>
      )}
      {props.phase === "VIEW_GUESS" && <p>Prompt: {props.prompt.join(" ")}</p>}

      {props.phase === "DRAWING" && (
        <div className="actions">
          <label>
            Color
            <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
          </label>
          <label>
            Thickness
            <input type="range" min={1} max={20} value={brushThickness} onChange={(e) => setBrushThickness(Number(e.target.value))} />
          </label>
          <button onClick={() => void props.onClearCanvas()}>Clear</button>
          <button onClick={() => void props.onFinishDrawing()}>Finish Drawing</button>
        </div>
      )}

      <CanvasGrid
        players={props.players}
        mePlayerId={props.me?.playerId}
        phase={props.phase}
        canDraw={canDraw}
        strokesByPlayer={props.strokesByPlayer}
        brushColor={brushColor}
        brushThickness={brushThickness}
        onStrokeBegin={props.onStrokeBegin}
        onStrokePoints={props.onStrokePoints}
        onStrokeEnd={props.onStrokeEnd}
      />

      {canGuess && (
        <div className="card">
          <h3>Guess</h3>
          <input
            value={guessText}
            onChange={(e) => setGuessText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!guessText.trim()) return;
                void props.onSubmitGuess(guessText.trim());
                setGuessText("");
              }
            }}
            placeholder="Type full prompt..."
          />
          <button
            onClick={() => {
              if (!guessText.trim()) return;
              void props.onSubmitGuess(guessText.trim());
              setGuessText("");
            }}
          >
            Submit
          </button>
        </div>
      )}

      <div className="card">
        <h3>Chat</h3>
        <div className="chat">
          {props.chat.map((c, idx) => (
            <div key={idx}>
              <b>{c.name}: </b>
              {c.isCorrect ? "✓ Correct!" : c.text}
            </div>
          ))}
        </div>
      </div>

      {props.phase === "REVEAL" && props.reveal && (
        <div className="card">
          <h3>Reveal</h3>
          <p>
            Correct:{" "}
            {(() => {
              let wi = 0;
              return props.reveal!.prompt.map((slot) => (slot === "__" ? props.reveal!.correctWords[wi++] : slot)).join(" ");
            })()}
          </p>
          <ul>
            {props.players.map((p) => (
              <li key={p.playerId}>
                {p.name}: round {props.reveal?.scores[p.playerId]?.totalPoints ?? 0}, total {props.totalScores[p.playerId] ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.phase === "GAME_OVER" && (
        <div className="card">
          <h3>Game Over</h3>
          <ul>
            {props.players
              .slice()
              .sort((a, b) => (props.totalScores[b.playerId] ?? 0) - (props.totalScores[a.playerId] ?? 0))
              .map((p) => (
                <li key={p.playerId}>
                  {p.name}: {props.totalScores[p.playerId] ?? 0}
                </li>
              ))}
          </ul>
          {props.me?.isHost && <button onClick={() => void props.onReturnToLobby()}>Return to Lobby</button>}
        </div>
      )}
      {props.message && <p className="inline-message">{props.message}</p>}
    </section>
  );
}
