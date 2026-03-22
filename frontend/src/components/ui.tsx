import type { PropsWithChildren, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Surface(props: PropsWithChildren<{ className?: string; glow?: boolean }>) {
  return <section className={cx("ui-surface", props.glow && "ui-surface-glow", props.className)}>{props.children}</section>;
}

export function Card(props: PropsWithChildren<{ className?: string; title?: string; subtitle?: string; right?: ReactNode }>) {
  return (
    <article className={cx("ui-card", props.className)}>
      {(props.title || props.subtitle || props.right) && (
        <header className="ui-card-header">
          <div>
            {props.title && <h3 className="ui-card-title">{props.title}</h3>}
            {props.subtitle && <p className="ui-card-subtitle">{props.subtitle}</p>}
          </div>
          {props.right}
        </header>
      )}
      <div>{props.children}</div>
    </article>
  );
}

export function SectionTitle(props: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="ui-section-title">
      <div>
        <h2>{props.title}</h2>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.right}
    </div>
  );
}

export function Input(props: {
  value: string | number;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  id?: string;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <input
      id={props.id}
      className={cx("ui-input", props.className)}
      type={props.type ?? "text"}
      value={props.value}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      onKeyDown={props.onKeyDown}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function LabelField(props: PropsWithChildren<{ label: string; hint?: string; className?: string; htmlFor?: string }>) {
  return (
    <label className={cx("ui-field", props.className)} htmlFor={props.htmlFor}>
      <span className="ui-label">{props.label}</span>
      {props.children}
      {props.hint && <small className="ui-hint">{props.hint}</small>}
    </label>
  );
}

export function Select(props: {
  value: string | number;
  onChange: (next: string) => void;
  options: Array<{ value: string | number; label: string }>;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={props.id}
      className={cx("ui-input", props.className)}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((opt) => (
        <option key={String(opt.value)} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
export function Button(
  props: PropsWithChildren<{
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    className?: string;
    ariaLabel?: string;
  }>
) {
  return (
    <button
      aria-label={props.ariaLabel}
      type={props.type ?? "button"}
      className={cx("ui-btn", `ui-btn-${props.variant ?? "secondary"}`, props.className)}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Badge(props: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "brand"; className?: string }>) {
  return <span className={cx("ui-badge", `ui-badge-${props.tone ?? "neutral"}`, props.className)}>{props.children}</span>;
}

export function Message(props: { text?: string; tone?: "warn" | "good" | "info" }) {
  if (!props.text) return null;
  const isWarn = (props.tone ?? "warn") === "warn";
  return (
    <p role={isWarn ? "alert" : "status"} aria-live={isWarn ? "assertive" : "polite"} className={cx("ui-message", `ui-message-${props.tone ?? "warn"}`)}>
      {props.text}
    </p>
  );
}
