import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { api } from './api.js';
import { bindUnlock, loadOverrides } from './lib/sfx/index.js';
import AuthPage from './pages/AuthPage.jsx';
import HubLayout from './features/hub/pages/HubLayout.jsx';
import CampanasSection from './features/hub/components/CampanasSection.jsx';
import CrearSection from './features/hub/components/CrearSection.jsx';
import EscaramuzasSection from './features/hub/components/EscaramuzasSection.jsx';
import EscenariosSection from './features/hub/components/EscenariosSection.jsx';
import DondeJuegoSection from './features/hub/components/DondeJuegoSection.jsx';
import CharactersPage from './pages/CharactersPage.jsx';
import BibliotecaPage from './pages/BibliotecaPage.jsx';
import CompendiumPage from './pages/CompendiumPage.jsx';
import SoundSettingsPage from './pages/SoundSettingsPage.jsx';
import CharacterSheetPage from './pages/CharacterSheetPage.jsx';
import CharacterWizardPage from './pages/CharacterWizardPage.jsx';
import ParchmentShell from './components/ParchmentShell.jsx';
import DiceOverlay from './components/DiceOverlay.jsx';
import ToastStack from './components/ToastStack.jsx';
import { isDiceContext } from './lib/gameContext.js';

const CampaignGamePage = lazy(() => import('./features/tactical-map/pages/CampaignGamePage.jsx'));
const MapEditorPage = lazy(() => import('./features/map-editor/pages/MapEditorPage.jsx'));
const WorldMapEditorPage = lazy(() => import('./features/world-map/pages/WorldMapEditorPage.jsx'));
const CampaignArchivePage = lazy(() => import('./features/campaign-archive/pages/CampaignArchivePage.jsx'));
const TallerLayout = lazy(() => import('./features/taller/pages/TallerLayout.jsx'));
const TallerStepPage = lazy(() => import('./features/taller/pages/TallerStepPage.jsx'));
const TallerIndexRedirect = lazy(() =>
  import('./features/taller/pages/TallerStepPage.jsx').then((m) => ({ default: m.TallerIndexRedirect }))
);

// La mesa de juego (chat) y el tablero eran dos pantallas; ahora es una
// sola en /campanas/:id — este enlace antiguo sigue funcionando
function RedirectToCampaign() {
  const { id } = useParams();
  return <Navigate to={`/campanas/${id}`} replace />;
}

// El asistente y la gestión de campaña se fundieron en el Taller; los
// enlaces y marcadores antiguos siguen funcionando.
function RedirectToTaller({ seccion = '' }) {
  const { id } = useParams();
  return <Navigate to={`/campanas/${id}/taller${seccion ? `/${seccion}` : ''}`} replace />;
}

function ContextualDiceOverlay() {
  const { pathname } = useLocation();
  return isDiceContext(pathname) ? <DiceOverlay /> : null;
}

// Zona autenticada. El tirador solo acompaña a la mesa y a las fichas: el
// Taller, las Crónicas y los editores quedan libres de controles de juego.
function Protected() {
  const { user, loading } = useAuth();

  // Arranque del sonido, una vez por sesión: se queda esperando al primer
  // gesto del usuario (los navegadores no dejan sonar nada antes) y se trae los
  // sonidos personalizados de la instalación. Si algo de esto falla, la mesa se
  // queda en silencio pero nada más se rompe.
  useEffect(() => {
    if (!user) return;
    bindUnlock();
    loadOverrides(api);
  }, [user]);

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
      <ContextualDiceOverlay />
      {/* Los avisos acompañan a toda la zona autenticada: el tirador es solo
          de la mesa, pero un error puede saltar en cualquier pantalla. */}
      <ToastStack />
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
        {/* La zona de campañas vive en /campanas con sus secciones como
            segmentos estáticos, que React Router prioriza sobre el
            /campanas/:id del detalle. El antiguo Hub en / redirige. */}
        <Route path="/" element={<Navigate to="/campanas" replace />} />
        <Route
          path="/campanas"
          element={
            <ParchmentShell>
              <HubLayout />
            </ParchmentShell>
          }
        >
          <Route index element={<CampanasSection />} />
          <Route path="crear" element={<CrearSection />} />
          <Route path="escaramuzas" element={<EscaramuzasSection />} />
          <Route path="escenarios" element={<EscenariosSection />} />
          <Route path="donde-juego" element={<DondeJuegoSection />} />
        </Route>
        <Route
          path="/personajes"
          element={
            <ParchmentShell>
              <CharactersPage />
            </ParchmentShell>
          }
        />
        <Route
          path="/biblioteca"
          element={
            <ParchmentShell>
              <BibliotecaPage />
            </ParchmentShell>
          }
        />
        <Route
          path="/compendio"
          element={
            <ParchmentShell>
              <CompendiumPage />
            </ParchmentShell>
          }
        />
        <Route
          path="/configuracion/sonidos"
          element={
            <ParchmentShell>
              <SoundSettingsPage />
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
        <Route path="/campanas/:id/gestion" element={<RedirectToTaller seccion="reparto" />} />
        <Route path="/campanas/:id/asistente" element={<RedirectToTaller />} />
        <Route
          path="/campanas/:id/taller"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-night-950 text-bone">
                  <p className="font-display text-lg tracking-wide text-gold">Abriendo el taller...</p>
                </div>
              }
            >
              <TallerLayout />
            </Suspense>
          }
        >
          <Route index element={<TallerIndexRedirect />} />
          <Route path=":seccion" element={<TallerStepPage />} />
        </Route>
        <Route
          path="/campanas/:id/archivo"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-night-950 text-bone">
                  <p className="font-display text-lg tracking-wide text-gold">Abriendo el Archivo de campaña...</p>
                </div>
              }
            >
              <CampaignArchivePage />
            </Suspense>
          }
        />
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
