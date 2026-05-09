"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h1>Errore inaspettato</h1>
      <p>{error.message}</p>
      <button onClick={reset}>Riprova</button>
    </div>
  );
}
