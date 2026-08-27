"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Button,
} from '@/components/ui/button';
import {
  Input,
} from '@/components/ui/input';
import {
  Label,
} from '@/components/ui/label';
import {
  Badge,
} from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Plus,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  Send,
  Sparkles,
  Trash2,
  Eye,
  Save,
  Camera,
  PackageSearch,
  Images,
} from 'lucide-react';
import {
  ImageExifViewer,
} from '@/components/ImageExifViewer';
import {
  SwapLiburConfirmModal,
} from '@/components/satpam/SwapLiburConfirmModal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select';
import {
  POSTS_CONFIG,
} from './activityModel';
import type { EmployeeActivitiesModel } from './activityModel';
import ActivityHistoryPanel from './ActivityHistoryPanel';
import EmployeeActivityFab from './EmployeeActivityFab';
import ActivityFormDialog from './ActivityFormDialog';

interface SatpamActivitiesViewProps {
  model: EmployeeActivitiesModel;
}

export default function SatpamActivitiesView({ model }: SatpamActivitiesViewProps) {
  const {
    profile,
    foundItemPhotoInputRef,
    isKetuaShiftSatpam,
    myShiftTeam,
    allSatpamEmployees,
    loadingSatpamConfig,
    satpamReportDate,
    satpamSubmitting,
    postAssignments,
    extraPostName,
    setExtraPostName,
    extraEmployeeId,
    setExtraEmployeeId,
    setExtraShiftType,
    setExtraOvertimeReason,
    satpamFlexibilityEnabled,
    satpamDutyPlan,
    satpamSuggestedShiftName,
    setSatpamReportedShiftName,
    satpamOpenPeriods,
    satpamReviewStatus,
    satpamAnomalies,
    satpamDraftHydrated,
    satpamDraftSyncStatus,
    satpamHasPendingDraft,
    isExtraPostVisible,
    setIsExtraPostVisible,
    loadingSubmittedSatpam,
    isSatpamReportSubmitted,
    showConfirmModal,
    setShowConfirmModal,
    pendingDailyLiburSwap,
    dailyLiburSwapWorking,
    dailyLiburSwapError,
    postPhotoUploading,
    setExtraPhotoUrl,
    extraPhotoUrl,
    setExtraPhotoAuditMetadata,
    setSatpamPreviewPhoto,
    satpamPreviewPhoto,
    setPostPhotoInputRef,
    openPostPhotoInput,
    satpamShiftCardRef,
    setShowForm,
    setShowSatpamSpjChoice,
    showSatpamSpjChoice,
    setShowFoundItemForm,
    showFoundItemForm,
    editingActivity,
    submitting,
    setFoundItemCategory,
    foundItemCategory,
    foundItemName,
    setFoundItemName,
    foundItemDate,
    setFoundItemDate,
    foundItemPhotos,
    setFoundItemPhotos,
    uploadingFoundItemPhotos,
    setMessage,
    resetForm,
    resetFoundItemForm,
    groupEmployeeIds,
    groupEmployees,
    pos9GuardIds,
    visibleGroupEmployees,
    visibleExternalEmployees,
    visiblePos9Employees,
    visibleAllSatpamEmployees,
    isCrossTeamPos9Guard,
    activeShift,
    isSatpamReportLocked,
    isSatpamPhotoUploadInProgress,
    assignedEmployeeIds,
    offDutyMembers,
    getDefaultShiftTypeForDate,
    handleSatpamDateChange,
    satpamFormWarnings,
    handleShiftTypeChange,
    handleSelectGuard,
    cancelDailyLiburSwap,
    useDailyLemburCover,
    confirmDailyLiburSwap,
    handleUploadPostPhoto,
    handleRemovePostPhoto,
    handleUploadFoundItemPhotos,
    handleCoverDetail,
    executeSubmitSatpamShift,
    handleSubmitSatpamShift,
    handleSubmitFoundItem,
  } = model;

  if (!profile) return null;

  return (
    <>
{isKetuaShiftSatpam && (
          <Card ref={satpamShiftCardRef} className="bg-white rounded-2xl shadow-sm border-none overflow-hidden py-0 scroll-mt-4">
            <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                  <ClipboardList className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-white">Lapor Roster Shift Regu</CardTitle>
                  <CardDescription className="text-purple-100 text-base mt-1">
                    {myShiftTeam ? `Regu ${myShiftTeam.id.split('_')[1]} (Ketua: ${myShiftTeam.ketuaShiftName})` : 'Mengambil data regu...'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {loadingSatpamConfig ? (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600 mb-2" />
                  <span className="text-base font-semibold">Memuat data regu Satpam...</span>
                </div>
              ) : (
                <form onSubmit={handleSubmitSatpamShift} className="space-y-4">
                  {/* Date selection & Shift Display */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 pb-3">
                    <div className="space-y-2">
                      <Label htmlFor="satpamDate" className="text-sm font-bold text-slate-600">
                        Pilih Tanggal Dinas
                      </Label>
                      <Input
                        id="satpamDate"
                        type="date"
                        value={satpamReportDate}
                        onChange={(e) => handleSatpamDateChange(e.target.value)}
                        // Deliberately excludes isSatpamReportLocked: an
                        // auditor-locked report still locks every other
                        // field, but the Ketua must still be able to switch
                        // dates to view/report a different day.
                        disabled={
                          !satpamFlexibilityEnabled ||
                          satpamSubmitting ||
                          isSatpamPhotoUploadInProgress
                        }
                        className="h-12 rounded-xl border-slate-200 focus:border-purple-400 focus:ring-purple-400/20 text-base font-bold text-slate-700 bg-white"
                        required
                      />
                    </div>

                    <div className="flex flex-col justify-center space-y-2">
                      <Label className="text-sm font-bold text-slate-600">Shift yang Dilaporkan</Label>
                      <Select
                        value={activeShift}
                        onValueChange={(value) => value && setSatpamReportedShiftName(value as 'Pagi' | 'Sore' | 'Malam')}
                        disabled={
                          isSatpamReportLocked ||
                          loadingSubmittedSatpam ||
                          !satpamFlexibilityEnabled
                        }
                      >
                        <SelectTrigger className="h-12 w-full rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-700 px-3 flex items-center justify-between shadow-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[280px] rounded-xl border border-slate-100 shadow-xl bg-white p-1.5 z-50">
                          <SelectItem value="Pagi" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Pagi</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(08:00 – 14:00 WIB)</span>
                          </SelectItem>
                          <SelectItem value="Sore" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Sore</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(14:00 – 22:00 WIB)</span>
                          </SelectItem>
                          <SelectItem value="Malam" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Malam</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(22:00 – 08:00 WIB)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-slate-600">
                        Saran sistem: <strong>Shift {satpamSuggestedShiftName}</strong>. Anda tetap boleh memilih shift yang benar.
                      </p>
                      {!satpamFlexibilityEnabled && (
                        <p className="text-sm font-semibold text-amber-800">
                          Alur fleksibel sedang diuji pada regu lain; regu ini masih memakai tanggal dan rota hari ini.
                        </p>
                      )}
                    </div>


                    {/* Shift Date Range Helper */}
                    <div className="sm:col-span-2 pt-2 border-t border-slate-200/60 mt-1 flex items-start gap-2 text-base font-semibold text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-purple-500" />
                      <span>
                        Waktu Dinas: {(() => {
                          if (!satpamReportDate) return '';
                          const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                          const startDate = new Date(satpamReportDate);
                          const startStr = startDate.toLocaleDateString('id-ID', options);
                          if (activeShift === 'Malam') {
                            const endDate = new Date(startDate);
                            endDate.setDate(startDate.getDate() + 1);
                            const endStr = endDate.toLocaleDateString('id-ID', options);
                            return `${startStr} (22:00) s/d ${endStr} (08:00 WIB)`;
                          } else if (activeShift === 'Pagi') {
                            return `${startStr} (08:00 s/d 14:00 WIB)`;
                          } else {
                            return `${startStr} (14:00 s/d 22:00 WIB)`;
                          }
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* 9 Posts Duty Grid */}
                  <div className="space-y-3">
                    {satpamDutyPlan?.warning && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                          <span>{satpamDutyPlan.warning}</span>
                        </div>
                      </div>
                    )}
                    <h3 className="text-base font-bold text-slate-600 border-b border-slate-100 pb-2">
                      Penugasan Pos Keamanan (9 Pos)
                    </h3>
                    {pos9GuardIds.size < 3 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                        Tiga petugas Pos 9 belum lengkap dari rencana regu periode ini. Pos 9 tetap dapat dilaporkan, tetapi perlu diperiksa Kepala SatKer.
                      </div>
                    )}

                    <div className="space-y-3.5">
                      {POSTS_CONFIG.map((post) => {
                        const defaultShiftTypeForRender = getDefaultShiftTypeForDate(satpamReportDate);
                        const val = postAssignments[post.id] || { employeeId: '', shiftType: defaultShiftTypeForRender };
                        const isCrossTeamPos9 = isCrossTeamPos9Guard(post.id, val.employeeId);
                        const isExternalGuard = Boolean(
                          val.employeeId && !groupEmployeeIds.includes(val.employeeId),
                        );
        const isKetuaGuard = Boolean(
                          val.employeeId && val.employeeId === myShiftTeam?.ketuaShiftId,
                        );
                        const isPos9 = post.id === 'Pos 9';
                        const isDesignatedPos9 = Boolean(
                          isPos9 && val.employeeId && pos9GuardIds.has(val.employeeId),
                        );
                        const selectedShiftType = isKetuaGuard
                          ? (['Harian', 'Jumat & Libur', 'Lembur Sendiri'].includes(val.shiftType)
                            ? val.shiftType
                            : defaultShiftTypeForRender)
                          : isCrossTeamPos9
                          ? (['Harian', 'Lembur Sendiri', 'Lembur Cover'].includes(val.shiftType)
                            ? val.shiftType
                            : defaultShiftTypeForRender)
                          : isDesignatedPos9
                            ? (['Harian', 'Jumat & Libur', 'Lembur Sendiri'].includes(val.shiftType)
                              ? val.shiftType
                              : defaultShiftTypeForRender)
                          : isExternalGuard
                            ? (['Harian', 'Lembur Cover'].includes(val.shiftType)
                              ? val.shiftType
                              : 'Harian')
                            : (val.shiftType === 'Lembur Cover'
                              ? 'Lembur Cover'
                              : defaultShiftTypeForRender);
                        const plannedEmployeeForPost = satpamDutyPlan?.day?.assignments.find(
                          (assignment) => assignment.postId === post.id,
                        )?.employeeId;
                        const coverCandidates = isCrossTeamPos9 && satpamDutyPlan?.fixedPost9EmployeeId
                          ? groupEmployees.filter((employee) => employee.id === satpamDutyPlan.fixedPost9EmployeeId)
                          : isExternalGuard && plannedEmployeeForPost
                            ? groupEmployees.filter((employee) => employee.id === plannedEmployeeForPost)
                            : visibleGroupEmployees.filter((employee) => !assignedEmployeeIds.includes(employee.id));
                        const isPlannedRegular = Boolean(
                          val.employeeId &&
                          satpamDutyPlan?.day?.assignments.some(
                            assignment => assignment.employeeId === val.employeeId,
                          ),
                        );
                        const plannedPayLabel = isPlannedRegular
                          ? `${defaultShiftTypeForRender} (${defaultShiftTypeForRender === 'Jumat & Libur' ? 'Rp25.000' : 'Rp12.500'})`
                          : val.employeeId
                            ? 'Lembur Cover (Rp50.000)'
                            : 'Pilih petugas dahulu';
                        return (
                          <div key={post.id} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow">
                            {/* Pos Name Label */}
                            <div className="md:col-span-3">
                              <span className="text-base font-black text-slate-600 block leading-tight">{post.id}</span>
                              <span className="text-base font-extrabold text-slate-900 block mt-1">{post.name}</span>
                              {post.id === 'Pos 2' && (
                                <span className="mt-1 block text-sm font-bold text-blue-700">
                                  Ketua Shift / Keliling
                                </span>
                              )}
                              {post.id === 'Pos 9' && satpamDutyPlan?.day && (
                                <span className="mt-1 block text-sm font-bold text-violet-700">
                                  Pos 9 Satpam Regu
                                </span>
                              )}
                            </div>

                            {/* Guard Dropdown */}
                            <div className="md:col-span-5">
                              <Select
                                value={val.employeeId || 'none'}
                                onValueChange={(v: string | null) => handleSelectGuard(post.id, v === 'none' || v === null ? '' : v)}
                                disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                              >
                                <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                  <span className={val.employeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                    {allSatpamEmployees.find(emp => emp.id === val.employeeId)?.name || '-- Pilih Petugas --'}
                                  </span>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                  <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                    -- Kosongkan Pos --
                                  </SelectItem>
                                  {post.id === 'Pos 9' ? (
                                    <SelectGroup>
                                      <SelectLabel className="text-base font-black text-violet-700 px-2 py-2 bg-violet-50/50">
                                        Tiga Pos 9 Satpam
                                      </SelectLabel>
                                      {visiblePos9Employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                          {emp.name}
                                        </SelectItem>
                                      ))}
                                      <SelectSeparator className="my-1" />
                                      <SelectLabel className="text-base font-black text-slate-600 px-2 py-2 bg-slate-50">
                                        Petugas Satpam Lain (pengganti)
                                      </SelectLabel>
                                      {visibleAllSatpamEmployees
                                        .filter((employee) => !pos9GuardIds.has(employee.id))
                                        .map((emp) => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {groupEmployeeIds.includes(emp.id) ? '· Regu Anda' : '· Regu lain'}
                                          </SelectItem>
                                        ))}
                                    </SelectGroup>
                                  ) : (
                                    <>
                                      <SelectGroup>
                                        <SelectLabel className="text-base font-black text-purple-700 px-2 py-2 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                        {visibleGroupEmployees.map(emp => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                      <SelectSeparator className="my-1" />
                                      <SelectGroup>
                                        <SelectLabel className="text-base font-black text-slate-600 px-2 py-2 bg-slate-50">Satpam Regu Lain (Substitusi — default Harian)</SelectLabel>
                                        {visibleExternalEmployees.map(emp => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {emp.isActive === false ? '· perlu verifikasi' : ''}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Shift / pay type is normally derived from the work
                                calendar. Ketua Shift defaults to Harian and can
                                choose Lembur Sendiri. Any Satpam from another
                                regu defaults to Harian, with an explicit
                                Lembur Cover option.
                                The designated cross-team Pos 9 guards additionally
                                retain the Lembur Sendiri option. */}
                            <div className="md:col-span-4">
                              {satpamDutyPlan?.enabled && satpamDutyPlan.day && !isExternalGuard && !isPos9 && !isKetuaGuard ? (
                                <div className="flex min-h-12 w-full items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-base font-extrabold text-indigo-800">
                                  {plannedPayLabel}
                                </div>
                              ) : (
                              <Select
                                value={selectedShiftType}
                                onValueChange={(type: string | null) => {
                                  if (type) handleShiftTypeChange(post.id, type);
                                }}
                                disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                              >
                                <SelectTrigger className="w-full h-12 text-base font-extrabold text-slate-700 bg-white border border-slate-200 rounded-lg">
                                  <SelectValue placeholder="Pilih Jenis Shift" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white">
                                  {isKetuaGuard ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      {defaultShiftTypeForRender === 'Jumat & Libur' && (
                                        <SelectItem value="Jumat & Libur" className="text-base font-bold">
                                          Jumat &amp; Libur (Rp25.000)
                                        </SelectItem>
                                      )}
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">
                                        Lembur Sendiri (Rp30.000)
                                      </SelectItem>
                                    </>
                                  ) : isCrossTeamPos9 ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">Lembur Sendiri (Rp30.000)</SelectItem>
                                      <SelectItem value="Lembur Cover" className="text-base font-bold">Lembur Cover (Rp50.000)</SelectItem>
                                    </>
                                  ) : isDesignatedPos9 ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      {defaultShiftTypeForRender === 'Jumat & Libur' && (
                                        <SelectItem value="Jumat & Libur" className="text-base font-bold">
                                          Jumat &amp; Libur (Rp25.000)
                                        </SelectItem>
                                      )}
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">
                                        Lembur Sendiri (Rp30.000)
                                      </SelectItem>
                                    </>
                                  ) : isExternalGuard ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      <SelectItem value="Lembur Cover" className="text-base font-bold">Lembur Cover (Rp50.000)</SelectItem>
                                    </>
                                  ) : (
                                    <SelectItem value={defaultShiftTypeForRender} className="text-base font-bold">
                                      {defaultShiftTypeForRender} ({defaultShiftTypeForRender === 'Jumat & Libur' ? 'Rp25.000' : 'Rp12.500'})
                                    </SelectItem>
                                  )}
                                  {!isCrossTeamPos9 && !isExternalGuard && !isPos9 && (
                                    <SelectItem value="Lembur Cover" className="text-base font-bold">
                                      Lembur Cover (Rp50.000)
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              )}
                            </div>
                            {val.shiftType === 'Lembur Cover' && (
                              <div className="md:col-span-12">
                                <Select
                                  value={val.coveredEmployeeId || 'none'}
                                  onValueChange={(value: string | null) =>
                                    handleCoverDetail(post.id, 'coveredEmployeeId', value === 'none' || value === null ? '' : value)}
                                  disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                                >
                                  <SelectTrigger className="w-full h-12 rounded-lg bg-amber-50 border-amber-200 text-base font-bold">
                                    <span>
                                      {groupEmployees.find(emp => emp.id === val.coveredEmployeeId)?.name ||
                                        '-- Pilih anggota yang digantikan --'}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[240px] rounded-xl border border-slate-100 shadow-xl bg-white p-1 z-50">
                                    <SelectItem value="none">-- Pilih anggota --</SelectItem>
                                    {coverCandidates.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {/* Guard-post proof photo; use the native Android photo/files source picker. */}
                            <div className="md:col-span-12">
                              <input
                                type="file"
                                accept="image/*"
                                ref={(element) => setPostPhotoInputRef(post.id, element)}
                                onChange={event => {
                                  const file = event.target.files?.[0];
                                  if (file) handleUploadPostPhoto(post.id, file);
                                  event.target.value = '';
                                }}
                                className="hidden"
                              />
                              {val.photoUrl ? (
                                <div className="flex items-center justify-between gap-2 p-2 bg-blue-50/80 border border-blue-200 rounded-xl text-base">
                                  <div className="flex items-center gap-1.5 truncate font-bold text-blue-800">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                    <span className="truncate">Foto bukti {post.id} terunggah</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setSatpamPreviewPhoto({ url: val.photoUrl!, title: `${post.id} — ${post.name}` })}
                                      className="min-h-12 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-base flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                    >
                                      <Eye className="w-3 h-3" /> Lihat Foto
                                    </button>
                                    {!isSatpamReportLocked && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemovePostPhoto(post.id)}
                                        className="h-12 w-12 flex items-center justify-center hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                        title="Hapus Foto Ini"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                // A missing photo can still be supplied after an auditor
                                // lock (see handleUploadPostPhoto) — everything else about
                                // this post stays read-only.
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={postPhotoUploading[post.id] || loadingSubmittedSatpam}
                                  onClick={() => openPostPhotoInput(post.id)}
                                  className="w-full h-12 rounded-lg border-dashed border-slate-300 bg-slate-50/60 hover:bg-slate-100 text-base font-bold text-slate-700 gap-2"
                                >
                                  {postPhotoUploading[post.id] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Camera className="w-3.5 h-3.5 text-slate-500" />
                                  )}
                                  <span>{postPhotoUploading[post.id] ? 'Mengunggah...' : 'Upload Foto'}</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {!isExtraPostVisible ? (
                        !isSatpamReportLocked && (
                          <div
                            onClick={() => setIsExtraPostVisible(true)}
                            className="flex items-center justify-center bg-slate-50/50 hover:bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300 hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer h-[66px] animate-in fade-in duration-200"
                          >
                            <span className="text-base font-extrabold text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
                              <Plus className="w-4.5 h-4.5" /> Tambah Petugas
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow animate-in fade-in slide-in-from-top-2 duration-300">
                          {/* Pilih Pos Dropdown */}
                          <div className="md:col-span-3">
                            <Select
                              value={extraPostName || 'none'}
                              onValueChange={(v: string | null) => setExtraPostName(v === 'none' || v === null ? '' : v)}
                              disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                <span className={extraPostName ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {POSTS_CONFIG.find(p => p.id === extraPostName || p.name === extraPostName)?.name || '-- Pilih Pos --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white">
                                <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                  -- Pilih Pos --
                                </SelectItem>
                                {POSTS_CONFIG.map((post) => (
                                  <SelectItem key={post.id} value={post.id} className="text-base py-3 pl-3">
                                    {post.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Pilih Petugas Dropdown */}
                          <div className="md:col-span-5">
                            <Select
                              value={extraEmployeeId || 'none'}
                              onValueChange={(v: string | null) => {
                                const empId = v === 'none' || v === null ? '' : v;
                                setExtraEmployeeId(empId);
                                if (empId) {
                                  setExtraShiftType('Lembur Sendiri');
                                }
                              }}
                              disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                <span className={extraEmployeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {allSatpamEmployees.find(emp => emp.id === extraEmployeeId)?.name || '-- Pilih Petugas --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                  -- Kosongkan Pos --
                                </SelectItem>
                                <SelectGroup>
                                  <SelectLabel className="text-base font-black text-purple-700 px-2 py-2 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                  {visibleGroupEmployees.map(emp => (
                                    <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                      {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''} {emp.isActive === false ? '· perlu verifikasi' : ''}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Fixed overtime type */}
                          <div className="md:col-span-3">
                            <div className="w-full text-base font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 h-12 flex items-center">
                              Lembur Sendiri (Rp30.000)
                            </div>
                          </div>

                          {/* Cancel/Remove Button */}
                          <div className="md:col-span-1 flex justify-center">
                            {!isSatpamReportLocked && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setIsExtraPostVisible(false);
                                  setExtraPostName('');
                                  setExtraEmployeeId('');
                                  setExtraShiftType('Lembur Sendiri');
                                  setExtraOvertimeReason('');
                                  setExtraPhotoUrl('');
                                  setExtraPhotoAuditMetadata(undefined);
                                }}
                                className="h-12 w-12 p-0 text-slate-400 hover:text-red-500 transition-colors"
                              >
                                <X className="w-5 h-5" />
                              </Button>
                            )}
                          </div>

                          <div className="md:col-span-12">
                            <input
                              type="file"
                              accept="image/*"
                              ref={(element) => setPostPhotoInputRef('extra', element)}
                              onChange={event => {
                                const file = event.target.files?.[0];
                                if (file) handleUploadPostPhoto('extra', file);
                                event.target.value = '';
                              }}
                              className="hidden"
                            />
                            {extraPhotoUrl ? (
                              <div className="flex items-center justify-between gap-2 p-2 bg-indigo-50 border border-indigo-200 rounded-xl text-base">
                                <div className="flex items-center gap-1.5 truncate font-bold text-indigo-800">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span className="truncate">Foto bukti Lembur Sendiri terunggah</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setSatpamPreviewPhoto({ url: extraPhotoUrl, title: 'Lembur Sendiri' })}
                                    className="min-h-12 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-base flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" /> Lihat Foto
                                  </button>
                                  {!isSatpamReportLocked && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePostPhoto('extra')}
                                      className="h-12 w-12 flex items-center justify-center hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                      title="Hapus Foto Ini"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              // A missing photo can still be supplied after an auditor lock
                              // (see handleUploadPostPhoto), but only once the extra post is
                              // known — before that there's no report row to attach it to.
                              (!isSatpamReportLocked || extraPostName) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={postPhotoUploading['extra'] || loadingSubmittedSatpam}
                                  onClick={() => openPostPhotoInput('extra')}
                                  className="w-full h-12 rounded-lg border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 text-base font-bold text-indigo-700 gap-2"
                                >
                                  {postPhotoUploading['extra'] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Camera className="w-3.5 h-3.5" />
                                  )}
                                  <span>{postPhotoUploading['extra'] ? 'Mengunggah...' : 'Upload Foto'}</span>
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Plain-language summary */}
                  <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-100 text-base font-medium space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-800">Ringkasan sebelum dikirim</span>
                      <Badge variant="outline" className="bg-white border-purple-200 text-purple-800">
                        {assignedEmployeeIds.length} penugasan
                      </Badge>
                    </div>
                    {offDutyMembers.length === 0 ? (
                      <p className="text-slate-600">Semua anggota regu tercantum dalam laporan.</p>
                    ) : (
                      <p className="text-slate-600">
                        Belum tercantum: {offDutyMembers.map((employee) => employee.name).join(', ')}.
                      </p>
                    )}
                  </div>

                  {(satpamFormWarnings.length > 0 || satpamAnomalies.length > 0) && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
                      <div className="flex items-start gap-2 font-bold">
                        <AlertCircle className="mt-0.5 w-5 h-5 shrink-0" />
                        <span>Laporan tetap boleh dikirim. Auditor akan memeriksa catatan berikut:</span>
                      </div>
                      <ul className="mt-2 pl-5 list-disc space-y-1.5">
                        {(satpamFormWarnings.length > 0
                          ? satpamFormWarnings
                          : satpamAnomalies.map((anomaly) => anomaly.message)
                        ).map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  )}

                  {isSatpamReportSubmitted && (
                    <div className={`rounded-xl border p-4 text-base ${
                      isSatpamReportLocked
                        ? 'border-blue-300 bg-blue-50 text-blue-950'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                    }`}>
                      <p className="font-bold">
                        Status: {
                          satpamReviewStatus === 'approved'
                            ? 'Disetujui'
                            : satpamReviewStatus === 'partially_approved'
                              ? 'Disetujui Sebagian'
                            : satpamReviewStatus === 'declined'
                              ? 'Ditolak'
                              : isSatpamReportLocked
                                ? 'Sedang Diperiksa'
                                : 'Menunggu Auditor'
                        }
                      </p>
                      <p className="mt-1">
                        {isSatpamReportLocked
                          ? 'Auditor sudah menangani laporan ini. Perubahan berikutnya dilakukan oleh auditor.'
                          : 'Anda masih dapat mengubah laporan ini sampai auditor mulai menanganinya.'}
                      </p>
                    </div>
                  )}
                  {!isSatpamReportLocked &&
                    satpamDraftHydrated &&
                    (!isSatpamReportSubmitted || satpamHasPendingDraft) && (
                      <div className={`rounded-xl border p-3 text-base ${
                        satpamDraftSyncStatus === 'saved'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : satpamDraftSyncStatus === 'offline' ||
                              satpamDraftSyncStatus === 'error'
                            ? 'border-amber-300 bg-amber-50 text-amber-950'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}>
                        <strong>
                          {satpamDraftSyncStatus === 'saving'
                            ? 'Menyimpan draf... '
                            : satpamDraftSyncStatus === 'saved'
                              ? 'Draf tersimpan. '
                              : satpamDraftSyncStatus === 'offline'
                                ? 'Draf tersimpan di perangkat. '
                                : satpamDraftSyncStatus === 'error'
                                  ? 'Sinkronisasi draf perlu diulang. '
                                  : 'Status: Draf. '}
                        </strong>
                        {satpamDraftSyncStatus === 'saved'
                          ? 'Perubahan sudah tersinkron ke server dan akan kembali saat aplikasi dibuka lagi.'
                          : satpamDraftSyncStatus === 'offline'
                            ? 'Koneksi sedang offline; sinkronisasi server akan dicoba otomatis saat online.'
                            : satpamDraftSyncStatus === 'error'
                              ? 'Perubahan tetap aman di perangkat ini. Pastikan koneksi tersedia atau muat ulang halaman.'
                              : satpamDraftSyncStatus === 'saving'
                                ? 'Perubahan sudah dicadangkan di perangkat sambil disinkronkan ke server.'
                                : 'Setiap perubahan akan disimpan otomatis di perangkat dan server.'}
                      </div>
                    )}

                  {/* Action Buttons */}
                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={satpamSubmitting || isSatpamReportLocked || loadingSubmittedSatpam}
                      className={`w-full rounded-xl font-extrabold text-base min-h-12 flex items-center justify-center gap-2 border-none shadow-md ${isSatpamReportLocked
                        ? 'bg-slate-500 hover:bg-slate-500 text-white cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-purple-100 cursor-pointer'
                        }`}
                    >
                      {satpamSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Mengirim Laporan Regu...</span>
                        </>
                      ) : loadingSubmittedSatpam ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Memeriksa Status Laporan...</span>
                        </>
                      ) : isSatpamReportLocked ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white" />
                          <span>{
                            satpamReviewStatus === 'approved'
                              ? 'Laporan Disetujui'
                              : satpamReviewStatus === 'partially_approved'
                                ? 'Laporan Disetujui Sebagian'
                              : satpamReviewStatus === 'declined'
                                ? 'Laporan Ditolak'
                                : 'Sedang Diperiksa Auditor'
                          }</span>
                        </>
                      ) : isSatpamReportSubmitted ? (
                        <>
                          <Save className="w-4 h-4 text-white" />
                          <span>Simpan Perubahan</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-white" />
                          <span>Laporkan Shift</span>
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}
<ActivityHistoryPanel model={model} />
<EmployeeActivityFab model={model} />
<Dialog open={showSatpamSpjChoice} onOpenChange={setShowSatpamSpjChoice}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <Sparkles className="h-5 w-5" /> Lapor SPJ Pribadi
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-teal-50">
                Pilih jenis laporan yang ingin Anda kirim.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-3 p-5">
            <button
              type="button"
              onClick={() => {
                setShowSatpamSpjChoice(false);
                resetForm();
                setShowForm(true);
              }}
              className="flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 border-teal-200 bg-teal-50 p-4 text-left transition-colors hover:bg-teal-100 active:bg-teal-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white">
                <ClipboardList className="h-7 w-7" />
              </span>
              <span>
                <span className="block text-lg font-black text-slate-900">Lapor Kegiatan</span>
                <span className="mt-1 block text-base leading-5 text-slate-600">
                  Kegiatan pribadi dengan waktu mulai dan selesai.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSatpamSpjChoice(false);
                setFoundItemCategory('satpam_found_item');
                setShowFoundItemForm(true);
              }}
              className="flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-left transition-colors hover:bg-amber-100 active:bg-amber-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
                <PackageSearch className="h-7 w-7" />
              </span>
              <span>
                <span className="block text-lg font-black text-slate-900">Laporan Lainnya</span>
                <span className="mt-1 block text-base leading-5 text-slate-600">
                  Penemuan barang atau teguran pengendara, dengan bukti foto.
                </span>
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowSatpamSpjChoice(false)}
              className="min-h-12 w-full rounded-xl text-base font-bold text-slate-600"
            >
              Batal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showFoundItemForm}
        onOpenChange={(open) => {
          // Same reasoning as the activity form: an in-flight submit must not be
          // dismissed out from under the user, or they will file it twice.
          if (!open && (submitting || uploadingFoundItemPhotos)) return;
          setShowFoundItemForm(open);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-lg max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-y-auto">
          <div className="sticky top-0 z-10 bg-gradient-to-r from-amber-500 to-orange-500 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <PackageSearch className="h-5 w-5" />
                {editingActivity ? 'Edit Laporan Lainnya' : 'Laporan Lainnya'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-amber-50">
                Satu laporan untuk satu kejadian. Kepala SatKer akan memeriksa foto dan nominalnya.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmitFoundItem} className="space-y-5 p-5">
            <div className="space-y-2">
              <Label htmlFor="foundItemCategory" className="text-base font-bold text-slate-700">
                Jenis Laporan
              </Label>
              <Select
                value={foundItemCategory}
                onValueChange={(value) =>
                  setFoundItemCategory(value as 'satpam_found_item' | 'satpam_reprimand')
                }
                disabled={Boolean(editingActivity)}
              >
                <SelectTrigger id="foundItemCategory" className="h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-700">
                  <SelectValue>
                    {foundItemCategory === 'satpam_reprimand'
                      ? 'Teguran Pengendara (Rp15.000)'
                      : 'Penemuan Barang (Rp5.000)'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                  <SelectItem value="satpam_found_item" className="text-base py-3">
                    Penemuan Barang (Rp5.000)
                  </SelectItem>
                  <SelectItem value="satpam_reprimand" className="text-base py-3">
                    Teguran Pengendara (Rp15.000)
                  </SelectItem>
                </SelectContent>
              </Select>
              {editingActivity && (
                <p className="text-sm text-slate-500">Jenis laporan tidak dapat diubah setelah dibuat.</p>
              )}
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-950">
              Rekomendasi awal kompensasi{' '}
              <strong>{foundItemCategory === 'satpam_reprimand' ? 'Rp15.000' : 'Rp5.000'}</strong>.
              Nominal akhir ditentukan saat audit.
            </div>

            <div className="space-y-2">
              <Label htmlFor="foundItemName" className="text-base font-bold text-slate-700">
                {foundItemCategory === 'satpam_reprimand' ? 'Keterangan Teguran' : 'Nama Barang'}
              </Label>
              <Input
                id="foundItemName"
                value={foundItemName}
                onChange={(event) => setFoundItemName(event.target.value)}
                placeholder={
                  foundItemCategory === 'satpam_reprimand'
                    ? 'Contoh: Motor Honda Beat, plat merah, 3 penumpang'
                    : 'Contoh: Kunci motor dengan gantungan merah'
                }
                maxLength={180}
                autoComplete="off"
                autoFocus
                required
                className="h-14 rounded-xl border-slate-300 px-4 text-base"
              />
              <p className="text-sm text-slate-500">
                {foundItemCategory === 'satpam_reprimand'
                  ? 'Buat laporan terpisah untuk setiap teguran.'
                  : 'Buat laporan terpisah jika menemukan barang lain.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="foundItemDate" className="text-base font-bold text-slate-700">
                {foundItemCategory === 'satpam_reprimand' ? 'Tanggal Kejadian' : 'Tanggal Penemuan'}
              </Label>
              <Input
                id="foundItemDate"
                type="date"
                value={foundItemDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  if (
                    nextDate &&
                    !satpamOpenPeriods.some(
                      (period) =>
                        nextDate >= period.startDate && nextDate <= period.endDate,
                    )
                  ) {
                    setMessage({
                      type: 'error',
                      text: 'Tanggal kejadian harus berada dalam periode payroll terbuka.',
                    });
                    return;
                  }
                  setFoundItemDate(nextDate);
                }}
                required
                className="h-14 rounded-xl border-slate-300 px-4 text-base"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-base font-bold text-slate-700">
                  {foundItemCategory === 'satpam_reprimand' ? 'Foto Bukti' : 'Foto Barang'}
                </Label>
                <Badge className="border-none bg-slate-100 text-sm font-bold text-slate-700">
                  {foundItemPhotos.length}/5 foto
                </Badge>
              </div>
              <p className="text-sm text-slate-500">Wajib minimal satu foto. Anda dapat mengunggah sampai lima sudut foto.</p>
              <input
                ref={foundItemPhotoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handleUploadFoundItemPhotos(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />

              {foundItemPhotos.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {foundItemPhotos.map((photo, index) => (
                    <div
                      key={`${photo.url}#${index}`}
                      className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={`Foto bukti ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-bold text-white">
                        Foto {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          // Remove by position: two uploads can legitimately share
                          // a URL (same file picked twice, or content-addressed
                          // storage dedup), and filtering by url would drop both.
                          setFoundItemPhotos((photos) =>
                            photos.filter((_, candidateIndex) => candidateIndex !== index),
                          )
                        }
                        className="absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-xl bg-white/95 text-rose-600 shadow-lg"
                        aria-label={`Hapus foto ${index + 1}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {foundItemPhotos.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingFoundItemPhotos}
                  onClick={() => foundItemPhotoInputRef.current?.click()}
                  className="min-h-14 w-full gap-2 rounded-xl border-dashed border-amber-300 bg-amber-50 text-base font-bold text-amber-900"
                >
                  {uploadingFoundItemPhotos ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Images className="h-5 w-5" />
                  )}
                  {uploadingFoundItemPhotos
                    ? 'Mengunggah foto…'
                    : foundItemPhotos.length === 0
                      ? 'Upload Foto'
                      : 'Tambah Foto'}
                </Button>
              )}
            </div>

            <div className="flex gap-3 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={submitting || uploadingFoundItemPhotos}
                onClick={resetFoundItemForm}
                className="min-h-12 flex-1 rounded-xl text-base font-bold text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  uploadingFoundItemPhotos ||
                  foundItemPhotos.length < 1
                }
                className="min-h-12 flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-base font-bold text-white"
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-5 w-5" />
                )}
                {editingActivity ? 'Ajukan Ulang' : 'Laporkan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
<ActivityFormDialog model={model} />
<Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-white animate-pulse" /> Konfirmasi Tanggal Dinas
              </DialogTitle>
              <DialogDescription className="text-amber-50 text-base mt-1">
                Harap periksa kembali tanggal dinas untuk Shift Malam Anda.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 text-base text-slate-600">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-extrabold text-amber-900 text-base">Roster Shift Malam (22:00 - 08:00 WIB)</h4>
                  <p className="text-base text-amber-800 leading-relaxed mt-1">
                    Shift Malam dimulai pada tanggal yang dipilih dan berakhir keesokan paginya. Gunakan tanggal saat shift malam mulai.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tanggal Dinas Terpilih</span>
                <span className="font-black text-slate-800 text-sm">
                  {(() => {
                    if (!satpamReportDate) return '';
                    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                    return new Date(satpamReportDate).toLocaleDateString('id-ID', options);
                  })()}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Jam Dinas Dinas</span>
                <span className="font-extrabold text-indigo-600 text-xs bg-indigo-50 px-2.5 py-1 rounded-md">
                  {(() => {
                    if (!satpamReportDate) return '';
                    const startDate = new Date(satpamReportDate);
                    const endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 1);
                    const formatOpt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
                    const startStr = startDate.toLocaleDateString('id-ID', formatOpt);
                    const endStr = endDate.toLocaleDateString('id-ID', formatOpt);
                    return `${startStr} (22:00) s/d ${endStr} (08:00 WIB)`;
                  })()}
                </span>
              </div>
            </div>

            <p className="text-xs font-medium text-slate-400 text-center leading-relaxed">
              Jika shift Anda dimulai pada malam **{(() => {
                if (!satpamReportDate) return '';
                const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
                return new Date(satpamReportDate).toLocaleDateString('id-ID', options);
              })()}**, silakan klik **Ya, Kirim Laporan**. Jika tidak, silakan batalkan dan sesuaikan tanggal dinas.
            </p>
          </div>

          <DialogFooter className="p-5 pt-0 border-t-0 flex flex-row items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="flex-1 rounded-xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors h-11"
            >
              Batalkan
            </Button>
            <Button
              type="button"
              onClick={executeSubmitSatpamShift}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-extrabold hover:from-amber-600 hover:to-orange-700 shadow-md shadow-orange-100 transition-colors h-11 border-none"
            >
              Ya, Kirim Laporan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
<SwapLiburConfirmModal
        open={Boolean(pendingDailyLiburSwap)}
        prompt={pendingDailyLiburSwap}
        working={dailyLiburSwapWorking}
        error={dailyLiburSwapError}
        onSwap={() => void confirmDailyLiburSwap()}
        onCover={useDailyLemburCover}
        onCancel={cancelDailyLiburSwap}
      />
{satpamPreviewPhoto && (
        <ImageExifViewer
          imageUrl={satpamPreviewPhoto.url}
          title={satpamPreviewPhoto.title}
          activityDate={satpamReportDate}
          isOpen={Boolean(satpamPreviewPhoto)}
          onClose={() => setSatpamPreviewPhoto(null)}
          showMetadata={false}
        />
      )}
</>
  );
}
