import { COOKIE_NAME, UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { startLogin } from "./const";
import "./index.css";

async function bootstrap() {
  const [{ default: App }, { trpc }] = await Promise.all([
    import("./App"),
    import("@/lib/trpc"),
  ]);
  const queryClient = new QueryClient();

  const redirectToLoginIfUnauthorized = (error: unknown) => {
    if (!(error instanceof TRPCClientError) || typeof window === "undefined") return;
    if (error.message === UNAUTHED_ERR_MSG) startLogin();
  };

  queryClient.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  });

  queryClient.getMutationCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  });

  const trpcClient = trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        headers() {
          // Preview auto-login fallback when a browser blocks cross-site iframe cookies.
          try {
            const raw = sessionStorage.getItem("mosaic-cookie");
            if (raw) {
              const prefix = `${COOKIE_NAME}=`;
              const pair = raw.split(";").find(value => value.trim().startsWith(prefix));
              const token = pair?.trim().slice(prefix.length);
              if (token) return { Authorization: `Bearer ${token}` };
            }
          } catch {
            // sessionStorage may be unavailable in a private kiosk browser.
          }
          return {};
        },
        fetch(input, init) {
          return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
        },
      }),
    ],
  });

  const root = document.getElementById("root");
  if (!root) throw new Error("App root element is missing");
  createRoot(root).render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

void bootstrap();
