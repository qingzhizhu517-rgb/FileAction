import { createContext, useContext } from "react";
import { ApiClient } from "../shared/api";
import type { User } from "../shared/types";
export type SessionValue = {
  api: ApiClient;
  user: User;
  logout: () => Promise<void>;
};
export const SessionContext = createContext<SessionValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("需要登录");
  return value;
}
