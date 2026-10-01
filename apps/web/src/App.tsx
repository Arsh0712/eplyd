import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './state/auth';
import { ToastProvider } from './state/toast';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import type { Me } from './api/types';

const SettingsSectionRouter = lazy(() =>
  import('./pages/settings/sections').then((m) => ({
    default: function S(): JSX.Element {
      const { section = 'general' } = useParams();
      return <m.SettingsSection name={section} />;
    }
  }))
);

const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const NewProjectPage = lazy(() => import('./pages/NewProjectPage'));
const ProjectLayout = lazy(() => import('./pages/project/ProjectLayout'));
const ConsolePage = lazy(() => import('./pages/project/ConsolePage'));
const FilesPage = lazy(() => import('./pages/project/FilesPage'));
const EnvironmentPage = lazy(() => import('./pages/project/EnvironmentPage'));
const ProjectSettingsPage = lazy(() => import('./pages/project/ProjectSettingsPage'));
const ProjectActivityPage = lazy(() => import('./pages/project/ProjectActivityPage'));
const KeysPage = lazy(() => import('./pages/KeysPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const PlatformSettings = lazy(() => import('./pages/settings/PlatformSettings'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const ErrorPage = lazy(() => import('./pages/ErrorPage'));

function PageLoader(): JSX.Element {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!me?.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

function RequireOwner({ children }: { children: JSX.Element }): JSX.Element {
  const { me, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!me?.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (me.role !== 'owner') return <Navigate to="/403" replace />;
  return children;
}

function AppRoutes(): JSX.Element {
  const qc = useQueryClient();
  const refreshAfterLogin = async (me: Me | null): Promise<void> => {
    await qc.invalidateQueries();
  };
  void refreshAfterLogin;
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<PageLoader />}>
            <LandingPage />
          </Suspense>
        }
      />
      <Route
        path="/login"
        element={
          <Suspense fallback={<PageLoader />}>
            <LoginPage />
          </Suspense>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          path="/projects"
          element={
            <Suspense fallback={<PageLoader />}>
              <ProjectsPage />
            </Suspense>
          }
        />
        <Route
          path="/projects/new"
          element={
            <Suspense fallback={<PageLoader />}>
              <NewProjectPage />
            </Suspense>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <Suspense fallback={<PageLoader />}>
              <ProjectLayout />
            </Suspense>
          }
        >
          <Route index element={<Navigate to="console" replace />} />
          <Route
            path="console"
            element={
              <Suspense fallback={<PageLoader />}>
                <ConsolePage />
              </Suspense>
            }
          />
          <Route
            path="files"
            element={
              <Suspense fallback={<PageLoader />}>
                <FilesPage />
              </Suspense>
            }
          />
          <Route
            path="environment"
            element={
              <Suspense fallback={<PageLoader />}>
                <EnvironmentPage />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<PageLoader />}>
                <ProjectSettingsPage />
              </Suspense>
            }
          />
          <Route
            path="activity"
            element={
              <Suspense fallback={<PageLoader />}>
                <ProjectActivityPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          element={
            <RequireOwner>
              <Outlet />
            </RequireOwner>
          }
        >
          <Route
            path="/keys"
            element={
              <Suspense fallback={<PageLoader />}>
                <KeysPage />
              </Suspense>
            }
          />
          <Route
            path="/activity"
            element={
              <Suspense fallback={<PageLoader />}>
                <ActivityPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageLoader />}>
                <PlatformSettings />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="general" replace />} />
            <Route path=":section" element={<SettingsSectionRouter />} />
          </Route>
        </Route>
        <Route
          path="/docs"
          element={
            <Suspense fallback={<PageLoader />}>
              <DocsPage />
            </Suspense>
          }
        />
      </Route>
      <Route
        path="/403"
        element={
          <Suspense fallback={<PageLoader />}>
            <ErrorPage kind="403" />
          </Suspense>
        }
      />
      <Route
        path="/500"
        element={
          <Suspense fallback={<PageLoader />}>
            <ErrorPage kind="500" />
          </Suspense>
        }
      />
      <Route
        path="*"
        element={
          <Suspense fallback={<PageLoader />}>
            <ErrorPage kind="404" />
          </Suspense>
        }
      />
    </Routes>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
