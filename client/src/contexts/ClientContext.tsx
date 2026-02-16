import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

interface Client {
  id: number;
  name: string;
  shortName: string;
  isActive: boolean;
}

// API returns different field names
interface ApiClient {
  id: number;
  name: string;
  code: string;
  status: string;
}

interface ClientContextType {
  clients: Client[];
  selectedClientId: number | null;
  selectedClient: Client | null;
  setSelectedClientId: (id: number | null) => void;
  isLoading: boolean;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(() => {
    const stored = localStorage.getItem("selectedClientId");
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: apiClients = [], isLoading } = useQuery<ApiClient[]>({
    queryKey: ["/api/clients"],
  });

  // Map API response to expected Client interface
  const clients: Client[] = apiClients.map(c => ({
    id: c.id,
    name: c.name,
    shortName: c.code,
    isActive: c.status === 'active',
  }));

  useEffect(() => {
    if (selectedClientId !== null) {
      localStorage.setItem("selectedClientId", String(selectedClientId));
    } else {
      localStorage.removeItem("selectedClientId");
    }
  }, [selectedClientId]);

  const selectedClient = clients.find(c => c.id === selectedClientId) || null;

  return (
    <ClientContext.Provider
      value={{
        clients,
        selectedClientId,
        selectedClient,
        setSelectedClientId,
        isLoading,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export function useClientContext() {
  const context = useContext(ClientContext);
  if (context === undefined) {
    throw new Error("useClientContext must be used within a ClientProvider");
  }
  return context;
}
