import type { PropsWithChildren } from "react";

type Variant = "lobby" | "reveal" | "gameover";

export function Scene(props: PropsWithChildren<{ className?: string }>) {
	return <div className={["scene", props.className].filter(Boolean).join(" ")}>{props.children}</div>;
}

export function SceneEffects(props: { active: boolean; variant: Variant }) {
	if (!props.active) return null;
	const tone =
		props.variant === "lobby" ? "fx-tone-lobby" : props.variant === "reveal" ? "fx-tone-reveal" : "fx-tone-gameover";
	return (
		<>
			<div className={["fx-layer fx-gradient", tone].join(" ")} aria-hidden="true" />
			<div className="fx-layer fx-noise" aria-hidden="true" />
			<div className="fx-layer fx-spotlight" aria-hidden="true" />
		</>
	);
}

