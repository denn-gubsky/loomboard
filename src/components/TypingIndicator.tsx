// Flashing dots shown while the agent is working but hasn't produced visible
// output yet (waiting for the first token, or thinking/tool-calling silently).
export default function TypingIndicator() {
  return (
    <div className="msg assistant">
      <div className="bubble typing">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}
