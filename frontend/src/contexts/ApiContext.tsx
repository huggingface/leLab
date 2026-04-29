import React, { createContext, useContext, ReactNode } from "react";

interface ApiContextType {
  baseUrl: string;
  wsBaseUrl: string;
  fetchWithHeaders: (url: string, options?: RequestInit) => Promise<Response>;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

const DEFAULT_LOCALHOST = "http://localhost:8000";
const DEFAULT_WS_LOCALHOST = "ws://localhost:8000";

interface ApiProviderProps {
  children: ReactNode;
}

export const ApiProvider: React.FC<ApiProviderProps> = ({ children }) => {
  const baseUrl = DEFAULT_LOCALHOST;
  const wsBaseUrl = DEFAULT_WS_LOCALHOST;

  // Enhanced fetch function that automatically includes necessary headers
  const fetchWithHeaders = async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const enhancedOptions: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    return fetch(url, enhancedOptions);
  };

  return (
    <ApiContext.Provider
      value={{
        baseUrl,
        wsBaseUrl,
        fetchWithHeaders,
      }}
    >
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
