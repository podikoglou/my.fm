import { QueryClient } from "@tanstack/react-query";

// create tanstack query client
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30 * 1000 },
  },
});
