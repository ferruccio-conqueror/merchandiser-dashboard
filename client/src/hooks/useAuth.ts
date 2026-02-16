import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { FULL_ACCESS_ROLES, LIMITED_ACCESS_ROLES } from "@shared/schema";

export interface AuthUser {
  id: number;
  name: string;
  role: string;
  email: string | null;
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const hasFullAccess = user ? FULL_ACCESS_ROLES.includes(user.role as any) : false;
  const hasLimitedAccess = user ? LIMITED_ACCESS_ROLES.includes(user.role as any) : false;

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    hasFullAccess,
    hasLimitedAccess,
    error,
  };
}

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { email, password });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useSetupPassword() {
  return useMutation({
    mutationFn: async ({ email, password, confirmPassword }: { email: string; password: string; confirmPassword: string }) => {
      const response = await apiRequest("POST", "/api/auth/setup-password", { email, password, confirmPassword });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.clear();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword, confirmPassword }: { 
      currentPassword: string; 
      newPassword: string; 
      confirmPassword: string 
    }) => {
      const response = await apiRequest("POST", "/api/auth/change-password", { 
        currentPassword, 
        newPassword, 
        confirmPassword 
      });
      return response.json();
    },
  });
}
