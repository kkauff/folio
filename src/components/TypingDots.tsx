/**
 * A small typewriter-style loading indicator: three plum dots that bounce in
 * sequence, like someone typing. Plum on light themes, pale plum on dark (the
 * brand color), via CSS light-dark().
 */
export function TypingDots({ label = "Working" }: { label?: string }) {
  return (
    <span className="typing-dots" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}
