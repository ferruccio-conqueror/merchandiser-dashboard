import { Building2, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClientContext } from "@/contexts/ClientContext";

export function ClientSelector() {
  const { clients, selectedClient, setSelectedClientId, isLoading } = useClientContext();

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="min-w-[140px]">
        <Building2 className="h-4 w-4 mr-2" />
        Loading...
      </Button>
    );
  }

  if (clients.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="min-w-[140px] justify-between"
          data-testid="button-client-selector"
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="truncate max-w-[120px]">
              {selectedClient ? selectedClient.shortName : "All Clients"}
            </span>
          </div>
          <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuItem
          onClick={() => setSelectedClientId(null)}
          className={!selectedClient ? "bg-accent" : ""}
          data-testid="menu-item-all-clients"
        >
          <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
          All Clients
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {clients.map((client) => (
          <DropdownMenuItem
            key={client.id}
            onClick={() => setSelectedClientId(client.id)}
            className={selectedClient?.id === client.id ? "bg-accent" : ""}
            data-testid={`menu-item-client-${client.id}`}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex flex-col">
                <span className="font-medium">{client.shortName}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[170px]">
                  {client.name}
                </span>
              </div>
              {selectedClient?.id === client.id && (
                <X 
                  className="h-3 w-3 ml-2 text-muted-foreground hover:text-foreground" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedClientId(null);
                  }}
                />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
