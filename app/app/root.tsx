import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Route } from "./+types/root";
import "./app.css";
import { queryClient } from "./lib/query";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CardLayout } from "./components/ui/card-layout";
import { Frown } from "lucide-react";
import { ErrorCard } from "./components/error-card";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="root">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let description = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page Not Found";
      description = "The page you're looking for doesn't exist.";
    } else {
      title = `${error.status}`;
      description = error.statusText || "An unexpected error occurred.";
    }
  } else if (error instanceof Error) {
    description = error.message || description;
    stack = import.meta.env.DEV ? error.stack : undefined;
  }

  return (
    <CardLayout>
      <ErrorCard
        icon={<Frown />}
        title={<>{title}</>}
        description={
          <>
            {description}
            {stack && (
              <pre className="mt-2 text-left w-full rounded-lg bg-muted p-4 overflow-x-auto text-xs text-muted-foreground">
                <code>{stack}</code>
              </pre>
            )}
          </>
        }
      />
    </CardLayout>
  );
}
