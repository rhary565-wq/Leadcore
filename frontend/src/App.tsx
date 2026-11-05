import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LangProvider, useLang } from '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import Layout from '@/yodsales/Layout';
import LoginPage from '@/yodsales/LoginPage';

// YodSales screens
const SalesHome     = lazy(() => import('@/yodsales/SalesHome'));
const SalesHub      = lazy(() => import('@/yodsales/SalesHub'));
const TerritoryMap  = lazy(() => import('@/yodsales/TerritoryMap'));
const LeadDiscovery = lazy(() => import('@/yodsales/LeadDiscovery'));
const AIAssistant   = lazy(() => import('@/yodsales/AIAssistant'));
const ProfilePage   = lazy(() => import('@/yodsales/ProfilePage'));
const AdminPortal   = lazy(() => import('@/yodsales/AdminPortal'));
const SupportPage   = lazy(() => import('@/yodsales/SupportPage'));
const FairUsagePage = lazy(() => import('@/yodsales/FairUsagePage'));
// LeadGen screens (search pipeline, approval, Apollo, HubSpot)
const JobsDashboard = lazy(() => import('@/leadgen/dashboard'));
const JobStatus     = lazy(() => import('@/leadgen/jobs-id'));
const Approval      = lazy(() => import('@/leadgen/approval-id'));
const LeadReview    = lazy(() => import('@/leadgen/leads-id'));
const JobContacts   = lazy(() => import('@/leadgen/contacts-jobId'));
const AllContacts   = lazy(() => import('@/leadgen/contacts-all'));
const ApolloSearch  = lazy(() => import('@/leadgen/apollo'));
const ApolloRuns    = lazy(() => import('@/leadgen/contacts-apollo'));
const ApolloRun     = lazy(() => import('@/leadgen/contacts-apollo-runId'));
const Guide         = lazy(() => import('@/leadgen/guide'));

function Spinner() {
  return <div className="py-32 flex justify-center"><div className="w-10 h-10 border-4 border-[#242A56] border-t-transparent rounded-full animate-spin" /></div>;
}

function YodSalesPage({ which }: { which: 'support' | 'fair' }) {
  const { lang } = useLang();
  const { theme } = useSession();
  return which === 'support' ? <SupportPage language={lang} theme={theme} /> : <FairUsagePage language={lang} theme={theme} />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, profile } = useSession();
  if (!profile) return <Spinner />;
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function Gate() {
  const { session, loading, profile } = useSession();
  const { t } = useLang();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!session) return <LoginPage />;
  if (profile?.role === 'disabled') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-4xl">🔒</p>
        <p className="font-black text-slate-800">{t('Your account is disabled. Please contact your administrator.', 'บัญชีของคุณถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ')}</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SalesHome />} />
          <Route path="hub" element={<SalesHub />} />
          <Route path="territory" element={<TerritoryMap />} />
          <Route path="discover" element={<LeadDiscovery />} />
          <Route path="ai" element={<AIAssistant />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="support" element={<YodSalesPage which="support" />} />
          <Route path="fair-usage" element={<YodSalesPage which="fair" />} />
          <Route path="admin" element={<AdminOnly><AdminPortal /></AdminOnly>} />

          <Route path="dashboard" element={<JobsDashboard />} />
          <Route path="jobs/:id" element={<JobStatus />} />
          <Route path="approval/:id" element={<Approval />} />
          <Route path="leads/:id" element={<LeadReview />} />
          <Route path="contacts/all" element={<AllContacts />} />
          <Route path="contacts/apollo" element={<ApolloRuns />} />
          <Route path="contacts/apollo/:runId" element={<ApolloRun />} />
          <Route path="contacts/:jobId" element={<JobContacts />} />
          <Route path="apollo" element={<ApolloSearch />} />
          <Route path="guide" element={<Guide />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <LangProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </LangProvider>
    </BrowserRouter>
  );
}
