"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, ListTodo, Loader2, LogOut } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import { Button } from '@/components/ui/button';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/lib/AuthContext';
import {
  formatLoyalisTaskDate,
  isLoyalisTaskOverdue,
  sortLoyalisTasks,
  type LoyalisTaskStatus,
  type LoyalisTaskView,
} from '@/lib/loyalisTasks';
import { authenticatedJson } from '@/lib/payroll/client';
import { LOYALIS_TASKS_SUMMARY_QUERY_KEY } from '@/lib/useLoyalisTasksSummary';

type Tab = LoyalisTaskStatus;

function todayInJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

export default function EmployeeTasksPage() {
  const { profile: rawProfile, activeProfile, loading: authLoading } = useAuth();
  const requestLogout = useConfirmLogout();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = activeProfile || rawProfile;
  const canView = profile?.role === 'loyalis';
  const today = todayInJakarta();

  const [tasks, setTasks] = useState<LoyalisTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<SnackbarMessage | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await authenticatedJson<{ tasks: LoyalisTaskView[] }>('/api/employee/tasks');
      setTasks(result.tasks);
      setLoadError('');
      // Only a Loyalis who has been given tasks has this page.
      if (result.tasks.length === 0) router.replace('/employee/payslip');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Daftar tugas gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [canView, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeStatus = async (task: LoyalisTaskView, status: LoyalisTaskStatus) => {
    if (savingId) return;
    setSavingId(task.id);
    try {
      const result = await authenticatedJson<{ task: LoyalisTaskView }>(`/api/employee/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setTasks((current) => current.map((item) => (item.id === task.id ? result.task : item)));
      void queryClient.invalidateQueries({ queryKey: LOYALIS_TASKS_SUMMARY_QUERY_KEY });
      setNotice({
        type: 'success',
        text: status === 'completed' ? 'Tugas ditandai selesai.' : 'Tugas dibuka kembali.',
      });
    } catch (cause) {
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Status tugas gagal diubah.' });
    } finally {
      setSavingId(null);
    }
  };

  const sorted = useMemo(() => sortLoyalisTasks(tasks), [tasks]);
  const openCount = sorted.filter((task) => task.status === 'open').length;
  const completedCount = sorted.length - openCount;
  const visible = sorted.filter((task) => task.status === tab);

  if (authLoading) return <div className="min-h-screen bg-slate-50" />;
  if (!canView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6">
        <div className="w-full max-w-md bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-800">Daftar Tugas Tidak Tersedia</h1>
          <p className="text-sm text-slate-500">Halaman ini untuk akun Loyalis yang diberi tugas.</p>
          <Button className="rounded-sm" variant="outline" nativeButton={false} render={<Link href="/employee/payslip" />}>Kembali ke Slip Gaji</Button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'open', label: 'Belum selesai', count: openCount },
    { key: 'completed', label: 'Selesai', count: completedCount },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <FloatingSnackbar message={notice} onDismiss={() => setNotice(null)} />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/employee/payslip" aria-label="Kembali ke Slip Gaji" className="rounded-sm p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-5" /></Link>
          <div className="flex size-9 items-center justify-center rounded-sm bg-indigo-600 text-white"><ListTodo className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-slate-800">Daftar Tugas</h1>
            <p className="truncate text-xs text-slate-500">{profile?.displayName || profile?.email}</p>
          </div>
          <EmployeeNavigationMenu />
          <Button className="rounded-sm" type="button" variant="ghost" size="icon" onClick={requestLogout} aria-label="Keluar"><LogOut className="size-4" /></Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl space-y-4 px-4 py-6 pb-24 sm:px-6 sm:py-8">
        {loadError && (
          <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="size-4 shrink-0" /> {loadError}
            <Button type="button" variant="outline" size="sm" className="ml-auto rounded-sm" onClick={() => void load()}>Coba lagi</Button>
          </div>
        )}

        <section className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div role="tablist" aria-label="Status tugas" className="flex gap-1 border-b border-slate-200 px-3 pt-2 sm:px-4">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {label} <span className="tabular-nums text-slate-400">{count}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Memuat tugas…</p>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-14 text-center text-sm text-slate-500">
              <ListTodo className="size-6 text-slate-300" />
              {tab === 'open' ? 'Semua tugas sudah selesai.' : 'Belum ada tugas yang selesai.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((task) => {
                const overdue = isLoyalisTaskOverdue(task, today);
                const saving = savingId === task.id;
                return (
                  <li key={task.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div className="min-w-0 space-y-1">
                      <p className="break-words text-sm font-semibold text-slate-900">{task.title}</p>
                      {task.description && (
                        <p className="whitespace-pre-line break-words text-sm text-slate-600">{task.description}</p>
                      )}
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        {task.status === 'completed' && task.completedAt ? (
                          <span>Selesai {formatDay(task.completedAt)}</span>
                        ) : task.dueDate ? (
                          <span>Tenggat {formatLoyalisTaskDate(task.dueDate)}</span>
                        ) : (
                          <span>Tanpa tenggat</span>
                        )}
                        {overdue && <StatusDot tone="warning" className="text-xs">Lewat tenggat</StatusDot>}
                      </p>
                    </div>
                    {task.status === 'open' ? (
                      <Button
                        type="button"
                        variant="accent"
                        size="sm"
                        className="shrink-0 rounded-sm"
                        disabled={saving}
                        onClick={() => void changeStatus(task, 'completed')}
                      >
                        {saving && <Loader2 className="animate-spin" />}
                        Tandai selesai
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-sm"
                        disabled={saving}
                        onClick={() => void changeStatus(task, 'open')}
                      >
                        {saving && <Loader2 className="animate-spin" />}
                        Buka lagi
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
