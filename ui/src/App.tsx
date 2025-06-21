import { useMemo } from "react";

function useUUID() {
  return useMemo(() => crypto.randomUUID(), []);
}

function App() {
  const id = useUUID();

  return <>{id}</>;
}

export default App;
