import React, { createContext, useContext, ReactNode, useState } from "react";

interface ApiContextType {
  baseUrl: string;
  wsBaseUrl: string;
  fetchWithHeaders: (url: string, options?: RequestInit) => Promise<Response>;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

const STORAGE_KEY = "lelab.apiBaseUrl";
const DEFAULT_LOCALHOST = "http://localhost:8000";

const httpToWs = (url: string): string => url.replace(/^http(s?):/, "ws$1:");

const resolveInitialBaseUrl = (): string => {
  if (typeof window === "undefined") return DEFAULT_LOCALHOST;

  const fromQuery = new URLSearchParams(window.location.search).get("api");
  if (fromQuery) {
    try {
      new URL(fromQuery);
      const clean = fromQuery.replace(/\/$/, "");
      window.localStorage.setItem(STORAGE_KEY, clean);
      return clean;
    } catch {
      console.warn("Invalid `api` query param, ignoring:", fromQuery);
    }
  }

  return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALHOST;
};

export const ApiProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [baseUrl] = useState<string>(resolveInitialBaseUrl);
  const wsBaseUrl = httpToWs(baseUrl);

  const fetchWithHeaders = async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  };

  return (
    <ApiContext.Provider value={{ baseUrl, wsBaseUrl, fetchWithHeaders }}>
      {children}
    </ApiContext.Provider>
  );
};

export const useApi = (): ApiContextType => {
  const context = useContext(ApiContext);
  if (context === undefined) {
    throw new Error("useApi must be used within an ApiProvider");
  }
  return context;
};
