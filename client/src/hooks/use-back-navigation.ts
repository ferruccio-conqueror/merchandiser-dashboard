import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

export function useBackNavigation(fallbackPath: string) {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const returnTo = searchParams.get("returnTo");

  const goBack = useCallback(() => {
    if (returnTo) {
      setLocation(decodeURIComponent(returnTo));
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation(fallbackPath);
    }
  }, [fallbackPath, setLocation, returnTo]);

  return goBack;
}
