import { useEffect, useState } from "react";
import { CanvasGrid } from "./CanvasGrid";
import type { Player, StrokePoint } from "../types/socket";
import { Badge, Button, Card, Input, LabelField, Message, SectionTitle, Surface } from "./ui";

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
  const [finishClicked, setFinishClicked] = useState(false);

  useEffect(() => {
    setGuessText("");
    setBrushColor("#000000");
    setBrushThickness(3);
    setFinishClicked(false);
  }, [props.currentRound]);

  const canDraw = props.phase === "DRAWING";
  const canGuess = props.phase === "VIEW_GUESS";

  return (
    <Surface className={`panel ${canDraw || canGuess ? "low-motion-zone" : ""}`}>
      <SectionTitle
        title="Game"
        subtitle={`Round ${props.currentRound}/${props.maxRounds} ${
          props.timeLeftMs !== null ? `• ${Math.max(0, Math.floor(props.timeLeftMs / 1000))}s` : ""
        }`}
        right={<Badge tone="brand">{props.phase}</Badge>}
      />
      {props.phase === "DRAWING" && (
        <Card title="Your Drawing Clue">
          <p>
            Your word: <b>{props.myAssignedWord || "(waiting)"}</b>
          </p>
        </Card>
      )}
      {props.phase === "VIEW_GUESS" && <Card title="Prompt">{props.prompt.join(" ")}</Card>}

      {props.phase === "DRAWING" && (
        <Card title="Drawing Controls">
          <div className="actions">
            <LabelField label="Color" className="compact-field">
              <Input type="color" value={brushColor} onChange={setBrushColor} />
            </LabelField>
            <LabelField label={`Thickness: ${brushThickness}`} className="compact-field">
              <Input type="range" min={1} max={20} value={brushThickness} onChange={(v) => setBrushThickness(Number(v))} />
            </LabelField>
            <Button variant="secondary" onClick={() => void props.onClearCanvas()}>
              Clear
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (finishClicked) return;
                setFinishClicked(true);
                await props.onFinishDrawing();
              }}
              disabled={finishClicked}
            >
              {finishClicked ? "Finished" : "Finish Drawing"}
            </Button>
          </div>
        </Card>
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
        <Card title="Guess">
          <Input
            value={guessText}
            onChange={setGuessText}
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
          <Button
            className="mt-2"
            variant="primary"
            onClick={() => {
              if (!guessText.trim()) return;
              void props.onSubmitGuess(guessText.trim());
              setGuessText("");
            }}
          >
            Submit
          </Button>
        </Card>
      )}

      <Card title="Chat">
        <div className="chat">
          {props.chat.map((c, idx) => (
            <div key={idx}>
              <b>{c.name}: </b>
              {c.isCorrect ? "✓ Correct!" : c.text}
            </div>
          ))}
        </div>
      </Card>

      {props.phase === "REVEAL" && props.reveal && (
        <Card title="Reveal">
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
        </Card>
      )}

      {props.phase === "GAME_OVER" && (
        <Card title="Game Over" subtitle="Final scores">
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
          {props.me?.isHost && (
            <Button variant="primary" onClick={() => void props.onReturnToLobby()}>
              Return to Lobby
            </Button>
          )}
        </Card>
      )}
      <Message text={props.message} />
    </Surface>
  );
}
