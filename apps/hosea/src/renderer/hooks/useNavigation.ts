/**
 * Navigation hook for managing app routing
 */

import { useState, useCallback, createContext, useContext } from 'react';

export type PageId =
  | 'chat'
  | 'history'
  | 'agents'
  | 'agent-editor'
  | 'connections'
  | 'llm-connectors'
  | 'universal-connectors'
  | 'connector-catalog'
  | 'connector-create'
  | 'tool-catalog'
  | 'tool-connectors'
  | 'mcp-servers'
  | 'multimedia-studio'
  | 'routines'
  | 'routine-builder'
  | 'internals'
  | 'settings';

export interface NavigationState {
  currentPage: PageId;
  params: Record<string, string>;
  history: PageId[];
  /** Arbitrary data that can be passed between pages */
  data?: Record<string, unknown>;
}

export interface NavigationContextValue {
  state: NavigationState;
  navigate: (page: PageId, params?: Record<string, string>) => void;
  goBack: () => void;
  canGoBack: boolean;
  /** Set arbitrary data to pass to the next page */
  setData: (data: Record<string, unknown>) => void;
}

const initialState: NavigationState = {
  currentPage: 'chat',
  params: {},
  history: [],
  data: {},
};

export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigationState(): NavigationContextValue {
  const [state, setState] = useState<NavigationState>(initialState);

  const navigate = useCallback((page: PageId, params: Record<string, string> = {}) => {
    setState((prev) => ({
      currentPage: page,
      params,
      history: [...prev.history, prev.currentPage],
      data: prev.data, // Preserve data when navigating
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.history.length === 0) return prev;
      const newHistory = [...prev.history];
      const previousPage = newHistory.pop()!;
      return {
        currentPage: previousPage,
        params: {},
        history: newHistory,
        data: prev.data,
      };
    });
  }, []);

  const setData = useCallback((data: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      data,
    }));
  }, []);

  const canGoBack = state.history.length > 0;

  return {
    state,
    navigate,
    goBack,
    canGoBack,
    setData,
  };
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}
