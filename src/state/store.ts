import { createContext, useContext, useSyncExternalStore } from "react";
import { createInitialState, reduce } from "./reducer";
import type { AppEvent, AppState } from "./types";

export interface AppStore {
  getState(): AppState;
  /** Reduces the event; listeners run only when the state object changed. */
  dispatch(event: AppEvent): void;
  subscribe(listener: () => void): () => void;
}

export function createAppStore(initial: AppState = createInitialState()): AppStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(event) {
      const next = reduce(state, event);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const StoreContext = createContext<AppStore | null>(null);

/** The store from the nearest StoreContext provider, for reading state inside event handlers; throws outside the provider. */
export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useAppStore requires a StoreContext provider");
  return store;
}

/** Subscribes to a slice of the store; `selector` must return a stable reference for unchanged input. */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useAppSelector requires a StoreContext provider");
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
