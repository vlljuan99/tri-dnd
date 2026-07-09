import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import AuthPage from './pages/AuthPage.jsx';
import HubPage from './pages/HubPage.jsx';
import CharactersPage from './pages/CharactersPage.jsx';
import CharacterSheetPage from './pages/CharacterSheetPage.jsx';
import CharacterWizardPage from './pages/CharacterWizardPage.jsx';
import CampaignWizardPage from './pages/CampaignWizardPage.jsx';
import ParchmentShell from './components/ParchmentShell.jsx';
import DiceOverlay from './components/DiceOverlay.jsx';

const CampaignGamePage = lazy(() => import('./features/tactical-map/pages/CampaignGamePage.jsx'));
const MapEditorPage = lazy(() => import('./features/map-editor/pages/MapEditorPage.jsx'));
const WorldMapEditorPage = lazy(() => import('./features/world-map/pages/WorldMapEditorPage.jsx'));

// La mesa de juego (chat) y el tablero eran dos pantallas; ahora es una
// sola en /campanas/:id — este enlace antiguo sigue funcionando
function RedirectToCampaign() {
  const { id } = useParams();
  return <Navigate to={`/campanas/${id}`} replace />;
}

// Zona autenticada: cualquier pantalla lleva el tirador de dados flotante
function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-parchment-100 text-ink">
        <p className="font-display text-lg tracking-wide">Cargando…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/acceso" replace />;
  return (
    <>
      <Outlet />
      <DiceOverlay />
    </>
  );
}

export default function App() {
  const loadSession = useAuth((s) => s.loadSession);
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  return (
    <Routes>
      <Route path="/acceso" element={<AuthPage />} />
      <Route element={<Protected />}>
        <Route
          path="/"
          element={
            <ParchmentShell>
              <HubPage />
            </ParchmentShell>
          }
        />
        <Route
          path="/personajes"
          element={
            <ParchmentShell>
              <CharactersPage />
            </ParchmentShell>
          }
        />
        <Route path="/personajes/:id/asistente" element={<CharacterWizardPage />} />
        <Route path="/personajes/:id" element={<CharacterSheetPage />} />
        <Route
          path="/campanas/:id"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-night-950 text-bone">
                  <p className="font-display text-lg tracking-wide text-gold">Cargando mesa de juego...</p>
                </div>
              }
            >
              <CampaignGamePage />
            </Suspense>
          }
        />
        <Route path="/campanas/:id/tablero" element={<RedirectToCampaign />} />
        <Route path="/campanas/:id/asistente" element={<CampaignWizardPage />} />
        <Route
          path="/campanas/:id/mundo"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-night-950 text-bone">
                  <p className="font-display text-lg tracking-wide text-gold">Cargando mapa de mundo...</p>
                </div>
              }
            >
              <WorldMapEditorPage />
            </Suspense>
          }
        />
        <Route
          path="/campanas/:id/editor"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-night-950 text-bone">
                  <p className="font-display text-lg tracking-wide text-gold">Cargando editor...</p>
                </div>
              }
            >
              <MapEditorPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
