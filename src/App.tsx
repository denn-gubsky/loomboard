// Step 1 is just the scaffold: a placeholder shell that proves the build and
// dev server work. The real layout (sidebar + chat pane) and routing land in
// the connection-auth and chat-core steps.
export default function App() {
  return (
    <div className="app-shell">
      <main className="app-placeholder">
        <h1>loomboard</h1>
        <p>Chat surface — scaffolding in place. Wiring up loomcycle next.</p>
      </main>
    </div>
  );
}
