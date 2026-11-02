"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, ListTodo, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/ui/search-select';
import { StatusDot } from '@/components/ui/status-dot';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/AuthContext';
import {
  formatLoyalisTaskDate,
  isLoyalisTaskOverdue,
  MAX_LOYALIS_TASK_DESCRIPTION_LENGTH,
  MAX_LOYALIS_TASK_TITLE_LENGTH,
  sortLoyalisTasks,
  type LoyalisTaskStatus,
  type LoyalisTaskView,
} from '@/lib/loyalisTasks';
import { authenticatedJson } from '@/lib/payroll/client';
import { canAssignLoyalisTasks } from '@/lib/payroll/roles';
import { useEmployeesLoyalis } from '@/lib/queries/hooks';

const ALL_LOYALIS = '__all';

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

type Editor = {
  /** The task being edited; null for a new one. */
  task: LoyalisTaskView | null;
  assigneeEmployeeId: string;
  title: string;
  description: string;
  dueDate: string;
};

function emptyEditor(assigneeEmployeeId: string): Editor {
  return { task: null, assigneeEmployeeId, title: '', description: '', dueDate: '' };
}

export default function LoyalisTasksAdminPage() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const profile = activeProfile || rawProfile;
  const allowed = canAssignLoyalisTasks(profile?.role);
  const today = todayInJakarta();

  const loyalisQuery = useEmployeesLoyalis(allowed);
  const loyalisOptions = useMemo(
    () =>
      (loyalisQuery.data ?? [])
        .filter((employee) => employee.personal_info?.status === 'AKTIF')
        .map((employee) => ({ value: String(employee.id), label: String(employee.personal_info?.name || employee.id) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'id')),
    [loyalisQuery.data],
  );

  const [tasks, setTasks] = useState<LoyalisTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  const [filterEmployee, setFilterEmployee] = useState(ALL_LOYALIS);
  const [tab, setTab] = useState<LoyalisTaskStatus>('open');

  const [editor, setEditor] = useState<Editor | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LoyalisTaskView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const result = await authenticatedJson<{ tasks: LoyalisTaskView[] }>('/api/loyalis-tasks');
      setTasks(result.tasks);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Daftar tugas gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTasks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks]);

  const replaceTask = (task: LoyalisTaskView) =>
    setTasks((current) => sortLoyalisTasks(current.map((item) => (item.id === task.id ? task : item))));

  const scoped = useMemo(
    () => tasks.filter((task) => filterEmployee === ALL_LOYALIS || task.assigneeEmployeeId === filterEmployee),
    [tasks, filterEmployee],
  );
  const openCount = scoped.filter((task) => task.status === 'open').length;
  const completedCount = scoped.length - openCount;
  const visible = scoped.filter((task) => task.status === tab);

  const openNew = () => {
    setFormError('');
    setEditor(emptyEditor(filterEmployee === ALL_LOYALIS ? '' : filterEmployee));
  };

  const openEdit = (task: LoyalisTaskView) => {
    setFormError('');
    setEditor({
      task,
      assigneeEmployeeId: task.assigneeEmployeeId,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate ?? '',
    });
  };

  const closeEditor = () => {
    if (!saving) setEditor(null);
  };

  const problem = (current: Editor): string => {
    if (!current.task && !current.assigneeEmployeeId) return 'Pilih Loyalis penerima tugas.';
    if (!current.title.trim()) return 'Judul tugas wajib diisi.';
    if (current.dueDate && current.dueDate < today && current.dueDate !== current.task?.dueDate) {
      return 'Tenggat tidak boleh sebelum hari ini.';
    }
    return '';
  };

  const save = async () => {
    if (!editor || saving) return;
    const issue = problem(editor);
    if (issue) {
      setFormError(issue);
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        assigneeEmployeeId: editor.assigneeEmployeeId,
        title: editor.title,
        description: editor.description,
        dueDate: editor.dueDate,
      });
      if (editor.task) {
        const result = await authenticatedJson<{ task: LoyalisTaskView }>(`/api/loyalis-tasks/${editor.task.id}`, {
          method: 'PUT',
          body,
        });
        replaceTask(result.task);
        setMessage({ type: 'success', text: 'Tugas diperbarui.' });
      } else {
        const result = await authenticatedJson<{ task: LoyalisTaskView }>('/api/loyalis-tasks', {
          method: 'POST',
          body,
        });
        setTasks((current) => sortLoyalisTasks([result.task, ...current]));
        setTab('open');
        setMessage({ type: 'success', text: `Tugas diberikan kepada ${result.task.assigneeName}.` });
      }
      setEditor(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Tugas gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (task: LoyalisTaskView, status: LoyalisTaskStatus) => {
    try {
      const result = await authenticatedJson<{ task: LoyalisTaskView }>(`/api/loyalis-tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          dueDate: task.dueDate ?? '',
          status,
        }),
      });
      replaceTask(result.task);
      setMessage({
        type: 'success',
        text: status === 'completed' ? 'Tugas ditandai selesai.' : 'Tugas dibuka kembali.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Status tugas gagal diubah.' });
    }
  };

  const deleteTask = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await authenticatedJson(`/api/loyalis-tasks/${deleteTarget.id}`, { method: 'DELETE' });
      const id = deleteTarget.id;
      setTasks((current) => current.filter((item) => item.id !== id));
      setDeleteTarget(null);
      setMessage({ type: 'success', text: 'Tugas dihapus.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Tugas gagal dihapus.' });
    } finally {
      setDeleting(false);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto mt-16 max-w-md px-4 text-center text-sm text-slate-500">
        Tugas Loyalis hanya tersedia untuk Super Admin.
      </div>
    );
  }

  const tabs: { key: LoyalisTaskStatus; label: string; count: number }[] = [
    { key: 'open', label: 'Belum selesai', count: openCount },
    { key: 'completed', label: 'Selesai', count: completedCount },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-4 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800 sm:p-8">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />

      <div className="relative z-10">
        <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
          <div className="p-5 pb-0 sm:p-8 sm:pb-0">
            <div className="mb-6 flex items-start justify-between gap-4">
              <h1 className="text-3xl font-bold tracking-tight">Tugas Loyalis</h1>
              <Button
                type="button"
                onClick={openNew}
                className="h-auto shrink-0 rounded-sm bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700"
              >
                <Plus className="size-4" />
                Tugas baru
              </Button>
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-4">
              <div role="tablist" aria-label="Status tugas" className="flex bg-slate-100 p-1 rounded-md">
                {tabs.map(({ key, label, count }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`cursor-pointer px-4 py-1.5 rounded-sm text-xs font-semibold transition-all ${tab === key
                      ? 'bg-white text-indigo-600 shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    {label} <span className="tabular-nums opacity-60">{count}</span>
                  </button>
                ))}
              </div>

              <div className="w-full sm:w-72">
                <SearchSelect
                  aria-label="Filter Loyalis"
                  value={filterEmployee}
                  onValueChange={(value) => setFilterEmployee(value || ALL_LOYALIS)}
                  options={[{ value: ALL_LOYALIS, label: 'Semua Loyalis' }, ...loyalisOptions]}
                  placeholder="Semua Loyalis"
                  className="h-auto rounded-sm border-slate-200 py-2.5 text-xs font-semibold text-slate-600 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-100"
                  optionClassName="font-medium"
                />
              </div>
            </div>
          </div>

          <div className="p-0">
            {loadError ? (
              <div className="px-5 pb-8 sm:px-8">
                <Callout tone="error" action={(
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()}>
                    Coba lagi
                  </Button>
                )}>
                  {loadError}
                </Callout>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 p-20 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" /> Memuat tugas…
              </div>
            ) : visible.length === 0 ? (
              <div className="p-20 flex flex-col items-center justify-center text-center text-slate-400">
                <ListTodo className="w-12 h-12 mb-4 opacity-20" />
                <p>
                  {tasks.length === 0
                    ? 'Belum ada tugas. Berikan tugas pertama kepada seorang Loyalis.'
                    : tab === 'open'
                      ? 'Tidak ada tugas yang belum selesai.'
                      : 'Belum ada tugas yang selesai.'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-medium text-slate-500 pl-5 sm:pl-8">Tugas</TableHead>
                    <TableHead className="font-medium text-slate-500">Penerima</TableHead>
                    <TableHead className="font-medium text-slate-500">Tenggat</TableHead>
                    <TableHead className="font-medium text-slate-500">Status</TableHead>
                    <TableHead className="font-medium text-slate-500 text-right pr-5 sm:pr-8">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((task) => {
                    const overdue = isLoyalisTaskOverdue(task, today);
                    return (
                      <TableRow key={task.id} className="border-slate-100 transition-colors hover:bg-slate-50/50">
                        <TableCell className="py-4 pl-5 sm:pl-8 whitespace-normal min-w-[240px] max-w-[420px]">
                          <span className="block font-medium break-words">{task.title}</span>
                          {task.description && (
                            <span className="mt-0.5 block text-xs text-slate-500 line-clamp-1" title={task.description}>
                              {task.description}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">{task.assigneeName}</TableCell>
                        <TableCell className={`py-4 ${overdue ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                          {task.dueDate ? formatLoyalisTaskDate(task.dueDate) : '—'}
                        </TableCell>
                        <TableCell className="py-4">
                          {task.status === 'completed' ? (
                            <div className="flex flex-col">
                              <StatusDot tone="success">Selesai</StatusDot>
                              {task.completedAt && (
                                <span className="text-xs text-slate-500">{formatDay(task.completedAt)}</span>
                              )}
                            </div>
                          ) : overdue ? (
                            <StatusDot tone="danger">Lewat tenggat</StatusDot>
                          ) : (
                            <StatusDot tone="warning">Belum selesai</StatusDot>
                          )}
                        </TableCell>
                        <TableCell className="py-4 pr-5 text-right sm:pr-8">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(task)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            {task.status === 'open' ? (
                              <button
                                type="button"
                                onClick={() => void changeStatus(task, 'completed')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                              >
                                <CheckCheck className="w-3.5 h-3.5" />
                                Tandai selesai
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void changeStatus(task, 'open')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Buka lagi
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(task)}
                              aria-label={`Hapus ${task.title}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Hapus
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={!!editor} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-md border-none bg-white shadow-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {editor?.task ? 'Edit Tugas' : 'Tugas Baru'}
            </DialogTitle>
          </DialogHeader>
          {editor && (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field
                label="Penerima"
                htmlFor="task-assignee"
                required
                hint={editor.task ? 'Penerima tidak dapat diubah. Berikan tugas baru untuk Loyalis lain.' : undefined}
              >
                <SearchSelect
                  id="task-assignee"
                  value={editor.assigneeEmployeeId}
                  onValueChange={(value) => setEditor({ ...editor, assigneeEmployeeId: value })}
                  options={loyalisOptions}
                  placeholder="Cari nama Loyalis"
                  disabled={!!editor.task}
                  className="h-10 rounded-sm border-slate-200 font-normal text-slate-900 hover:border-indigo-300 focus-visible:border-indigo-500 focus-visible:ring-indigo-100"
                  optionClassName="font-medium"
                />
              </Field>
              <Field label="Judul" htmlFor="task-title" required>
                <Input
                  id="task-title"
                  value={editor.title}
                  maxLength={MAX_LOYALIS_TASK_TITLE_LENGTH}
                  placeholder="Contoh: Susun laporan kegiatan Oktober"
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  className="h-10 rounded-sm border-slate-200 text-sm font-normal text-slate-900 hover:border-indigo-300 focus:border-indigo-500 placeholder:text-slate-400"
                />
              </Field>
              <Field label="Deskripsi" htmlFor="task-description">
                <textarea
                  id="task-description"
                  rows={4}
                  maxLength={MAX_LOYALIS_TASK_DESCRIPTION_LENGTH}
                  value={editor.description}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  className="w-full rounded-sm border border-slate-200 p-3 text-sm font-normal text-slate-900 transition-all hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                />
              </Field>
              <Field label="Tenggat" htmlFor="task-due" hint="Boleh dikosongkan.">
                <Input
                  id="task-due"
                  type="date"
                  value={editor.dueDate}
                  min={editor.task?.dueDate && editor.task.dueDate < today ? undefined : today}
                  onChange={(event) => setEditor({ ...editor, dueDate: event.target.value })}
                  className="h-10 rounded-sm border-slate-200 text-sm font-normal text-slate-900 hover:border-indigo-300 focus:border-indigo-500"
                />
              </Field>
              {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
              <DialogFooter className="rounded-b-md">
                <Button type="button" variant="outline" className="rounded-sm" onClick={closeEditor} disabled={saving}>
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="rounded-sm bg-indigo-600 px-6 font-bold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700"
                  disabled={saving}
                >
                  {saving && <Loader2 className="animate-spin" />}
                  Simpan
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
        title="Hapus tugas?"
        description={deleteTarget
          ? `“${deleteTarget.title}” untuk ${deleteTarget.assigneeName} akan dihapus dan hilang dari daftar mereka.`
          : ''}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={() => void deleteTask()}
      />
    </div>
  );
}
