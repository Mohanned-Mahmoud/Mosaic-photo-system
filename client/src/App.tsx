import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./features/app.css";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const AdminPage = lazy(() => import("./features/admin/AdminPage"));
const BoothPage = lazy(() => import("./features/booth/BoothPage"));
const GalleryPage = lazy(() => import("./features/gallery/GalleryPage"));
const MosaicPage = lazy(() => import("./features/mosaic/MosaicPage"));

function Router() {
  return (
    <Suspense fallback={<main className="screen-message"><p className="eyebrow">MOSAIC</p><h1>One moment.</h1></main>}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/booth" component={BoothPage} />
        <Route path="/mosaic" component={MosaicPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/gallery/:eventId" component={GalleryPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
