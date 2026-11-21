import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { AuthProvider } from './auth/AuthContext';
import { MainLayout } from './layouts/MainLayout';
import { FavoritesPage } from './pages/FavoritesPage';
import { HomePage } from './pages/HomePage';
import {
  AboutPage,
  ContactPage,
  PrivacyPage,
  TermsPage,
} from './pages/LegalAndInfoPages';
import {
  CreateAdPage,
  EditAdPage,
  LoginPage,
  MemberSectionPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/MemberAndAdPages';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PropertyDetailsPage } from './pages/PropertyDetailsPage';
import { SearchPage } from './pages/SearchPage';

const SECRET_ADMIN_PATH =
  import.meta.env.VITE_ADMIN_ROUTE_PATH || '/portal-ops-shareek';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/properties/:id" element={<PropertyDetailsPage />} />
            <Route path="/ads/new" element={<CreateAdPage />} />
            <Route path="/ads/:id/edit" element={<EditAdPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/dashboard"
              element={
                <MemberSectionPage
                  title="لوحة تحكم العضو"
                  description="متابعة إحصائيات الإعلانات وطلبات الدفع وحالة الحساب."
                />
              }
            />
            <Route
              path="/my-ads"
              element={
                <MemberSectionPage
                  title="إعلاناتي العقارية"
                  description="إدارة الإعلانات المنشورة والمنتهية وطلبات الترقية للباقات المدفوعة."
                />
              }
            />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route
              path="/profile"
              element={
                <MemberSectionPage
                  title="الملف الشخصي"
                  description="تحديث الاسم الكامل ورقم الهاتف ونوع العضوية."
                />
              }
            />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path={SECRET_ADMIN_PATH} element={<AdminDashboardPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
