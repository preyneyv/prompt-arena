import { useRef } from "react";

export function useUuid() {
  const id = useRef<string>(null as never);
  if (!id.current) id.current = crypto.randomUUID();
  return id.current;
}
