import { createContext, useContext } from "react";
import type { AppActions } from "../state";

export { StoreContext, useAppSelector } from "../state";

export const ActionsContext = createContext<AppActions | null>(null);

/** The bridge-backed actions created once in App.tsx; throws outside the provider. */
export function useActions(): AppActions {
  const actions = useContext(ActionsContext);
  if (actions === null) throw new Error("useActions requires an ActionsContext provider");
  return actions;
}
