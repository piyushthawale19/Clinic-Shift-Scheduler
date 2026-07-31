// Auth context — provides authentication state and login/logout functions to the app.
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { setAuthToken } from "../api/client";

interface User {
  userId: number;
  email: string;
  role: "manager" | "staff";
  profession: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Restore auth state from localStorage on mount.
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setAuthToken(savedToken);
    }
  }, []);

  function setAuth(newToken: string, newUser: User) {
    setToken(newToken);
    setUser(newUser);
    setAuthToken(newToken);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
  }

  function logout() {
    setToken(null);
    setUser(null);
    setAuthToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  return (
    <AuthContext.Provider
      value={{ user, token, setAuth, logout, isManager: user?.role === "manager" }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
