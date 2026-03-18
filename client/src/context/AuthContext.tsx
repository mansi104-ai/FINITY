"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import * as api from "../services/api";
import type { AuthUser, RiskProfile } from "../types";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  saveProfile: (budget: number, riskProfile: RiskProfile) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistSession(tokens: { accessToken: string; refreshToken: string } | null): void {
  api.persistSessionTokens(tokens);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const profile = await api.getProfile();
    setUser(profile.user);
  }, []);

  useEffect(() => {
    // Rehydrate auth state from the browser so route changes keep the user signed in.
    const hydrate = async () => {
      const savedAccessToken = api.getAccessToken();
      const savedRefreshToken = api.getRefreshToken();
      if (!savedAccessToken && !savedRefreshToken) {
        setLoading(false);
        return;
      }

      if (savedAccessToken) {
        setToken(savedAccessToken);
      }

      try {
        // A successful profile call confirms the restored session is still valid.
        await refreshProfile();
        setToken(api.getAccessToken());
      } catch {
        // Clear any stale tokens so the UI does not loop on an expired session.
        persistSession(null);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    void hydrate();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setToken(result.accessToken);
    setUser(result.user);
    // Persist both tokens because the client auto-refreshes access tokens in the background.
    persistSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const result = await api.register(email, password);
    setToken(result.accessToken);
    setUser(result.user);
    persistSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  }, []);

  const logout = useCallback(() => {
    void api.logout().catch(() => undefined);
    setToken(null);
    setUser(null);
    persistSession(null);
  }, []);

  const saveProfile = useCallback(async (budget: number, riskProfile: RiskProfile) => {
    const result = await api.updateProfile({ budget, riskProfile });
    setUser(result.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      login,
      register,
      logout,
      refreshProfile,
      saveProfile
    }),
    [loading, login, logout, refreshProfile, register, saveProfile, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
