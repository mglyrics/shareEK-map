import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, User, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const NAV_LINKS = [
  { to: '/', label: 'الرئيسية', end: true },
  { to: '/search', label: 'بحث العقارات', end: false },
  { to: '/projects', label: 'المدن الجديدة', end: false },
  { to: '/favorites', label: 'المفضلة', end: false },
  { to: '/about', label: 'من نحن', end: false },
];

export const Navbar: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated, user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single clean wordmark */}
        <Link
          to="/"
          className="shrink-0 whitespace-nowrap text-xl font-extrabold tracking-tight text-navy-900"
        >
          شريك العقاري
        </Link>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          aria-label="التنقل الرئيسي"
          className="hidden items-center gap-7 md:flex"
        >
          {NAV_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `shrink-0 whitespace-nowrap border-b-2 py-1 text-sm font-semibold transition-colors duration-150 ${
                  isActive
                    ? 'border-emerald-600 text-navy-900'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-navy-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: Member Entry + Primary Action + Mobile Menu Trigger */}
        <div className="flex shrink-0 items-center gap-2.5">
          {isAuthenticated && user ? (
            <Link
              to="/dashboard"
              className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 transition-colors hover:bg-slate-50 md:inline-flex"
            >
              <User className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              <span>لوحة العضو</span>
            </Link>
          ) : (
            <Link
              to="/login"
              className="hidden shrink-0 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 transition-colors hover:bg-slate-50 md:inline-flex"
            >
              تسجيل الدخول
            </Link>
          )}

          <Link
            to="/ads/new"
            className="hidden shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-emerald-700 md:inline-flex"
          >
            أضف إعلانك
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-navy-900 transition-colors hover:bg-slate-100 md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen ? (
        <div
          id="mobile-nav-drawer"
          className="border-t border-slate-200 bg-white px-4 py-4 md:hidden"
        >
          <nav aria-label="التنقل للجوال" className="flex flex-col gap-1">
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-slate-100 text-navy-900'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-navy-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
              <Link
                to="/ads/new"
                onClick={() => setMobileOpen(false)}
                className="flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                أضف إعلانك
              </Link>
              {isAuthenticated && user ? (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
                  >
                    لوحة العضو
                  </Link>
                  <Link
                    to="/my-ads"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
                  >
                    إعلاناتي
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
                  >
                    تسجيل الدخول
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
                  >
                    إنشاء حساب
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
};
