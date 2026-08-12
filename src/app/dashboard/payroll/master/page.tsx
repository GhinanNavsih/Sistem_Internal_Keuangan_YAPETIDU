"use client";

import React, { useState, useEffect, useRef } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Save,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  History,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import { collection, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface SalaryRow {
  id: string;
  tahun: number;
  bulan: number;
  salaries: Record<string, number>;
}

interface FunctionalRow {
  id: string;
  education_level: string;
  base_value: number;
  functional_tiers: Record<string, number>;
}

interface KepangkatanRow {
  id: string;
  credit_score: number;
  designation: string;
  allowance: number;
}

export default function SalaryMasterPage() {
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [gradeCodes, setGradeCodes] = useState<string[]>([]);
  const [activeVersion, setActiveVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [selectedTab, setSelectedTab] = useState<'blue_collar' | 'white_collar' | 'functional' | 'kepangkatan'>('blue_collar');
  const [whiteCollarRows, setWhiteCollarRows] = useState<SalaryRow[]>([]);
  const [whiteCollarGrades, setWhiteCollarGrades] = useState<string[]>([]);
  const [whiteCollarVersion, setWhiteCollarVersion] = useState<string>('');

  const [functionalRows, setFunctionalRows] = useState<FunctionalRow[]>([]);
  const [functionalVersion, setFunctionalVersion] = useState<string>('');

  const [kepangkatanRows, setKepangkatanRows] = useState<KepangkatanRow[]>([]);
  const [kepangkatanVersion, setKepangkatanVersion] = useState<string>('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 1. Get Active Version for Blue Collar
        const rootRef = doc(db, 'SalaryMatrix', '_config');
        const rootSnap = await getDoc(rootRef);
        
        let version = '2026_v1';
        if (rootSnap.exists() && rootSnap.data().activeVersion) {
          version = rootSnap.data().activeVersion;
        }
        setActiveVersion(version);
        
        // 2. Fetch Metadata for Grade Codes
        const metaDoc = await getDoc(doc(db, 'SalaryMatrix', version));
        if (metaDoc.exists()) {
          setGradeCodes(metaDoc.data().metadata?.gradeCodes || []);
        }

        // 3. Fetch Salary Rows for Blue Collar
        const rowsSnapshot = await getDocs(collection(db, 'SalaryMatrix', version, 'rows'));
        const rowsList = rowsSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        })) as SalaryRow[];
        setRows(rowsList.sort((a, b) => a.tahun - b.tahun));

        // 4. Fetch White Collar Salary Matrix from Firestore
        const wcConfigRef = doc(db, 'SalaryMatrix_WhiteCollar', '_config');
        const wcConfigSnap = await getDoc(wcConfigRef);
        let wcVersion = '2026_v1';
        if (wcConfigSnap.exists() && wcConfigSnap.data().activeVersion) {
          wcVersion = wcConfigSnap.data().activeVersion;
        }
        setWhiteCollarVersion(wcVersion);

        const wcMetaDoc = await getDoc(doc(db, 'SalaryMatrix_WhiteCollar', wcVersion));
        if (wcMetaDoc.exists()) {
          setWhiteCollarGrades(wcMetaDoc.data().metadata?.gradeCodes || []);
        }

        const wcRowsSnapshot = await getDocs(collection(db, 'SalaryMatrix_WhiteCollar', wcVersion, 'rows'));
        const wcRowsList = wcRowsSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        })) as SalaryRow[];
        setWhiteCollarRows(wcRowsList.sort((a, b) => a.tahun - b.tahun));

        // 5. Fetch Functional Salary Matrix from Firestore
        const funcConfigRef = doc(db, 'SalaryMatrix_Functional', '_config');
        const funcConfigSnap = await getDoc(funcConfigRef);
        let funcVersion = '2026_v1';
        if (funcConfigSnap.exists() && funcConfigSnap.data().activeVersion) {
          funcVersion = funcConfigSnap.data().activeVersion;
        }
        setFunctionalVersion(funcVersion);

        const funcRowsSnapshot = await getDocs(collection(db, 'SalaryMatrix_Functional', funcVersion, 'rows'));
        const funcRowsList = funcRowsSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        })) as FunctionalRow[];
        setFunctionalRows(funcRowsList.sort((a, b) => a.education_level.localeCompare(b.education_level)));

        // 6. Fetch Kepangkatan Matrix from Firestore
        const kepConfigRef = doc(db, 'SalaryMatrix_Kepangkatan', '_config');
        const kepConfigSnap = await getDoc(kepConfigRef);
        let kepVersion = '2026_v1';
        if (kepConfigSnap.exists() && kepConfigSnap.data().activeVersion) {
          kepVersion = kepConfigSnap.data().activeVersion;
        }
        setKepangkatanVersion(kepVersion);

        const kepRowsSnapshot = await getDocs(collection(db, 'SalaryMatrix_Kepangkatan', kepVersion, 'rows'));
        const kepRowsList = kepRowsSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        })) as KepangkatanRow[];
        setKepangkatanRows(kepRowsList.sort((a, b) => a.credit_score - b.credit_score));
      } catch (error) {
        console.error("Error fetching salary matrix:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSalaryChange = (tahun: number, grade: string, value: string) => {
    const numValue = parseInt(value.replace(/[^0-9]/g, '')) || 0;
    if (selectedTab === 'white_collar') {
      setWhiteCollarRows(prev => prev.map(row => {
        if (row.tahun === tahun) {
          return {
            ...row,
            salaries: {
              ...row.salaries,
              [grade]: numValue
            }
          };
        }
        return row;
      }));
    } else if (selectedTab === 'blue_collar') {
      setRows(prev => prev.map(row => {
        if (row.tahun === tahun) {
          return {
            ...row,
            salaries: {
              ...row.salaries,
              [grade]: numValue
            }
          };
        }
        return row;
      }));
    }
  };

  const handleFunctionalChange = (id: string, field: 'base' | string, value: string) => {
    const numValue = parseInt(value.replace(/[^0-9]/g, '')) || 0;
    setFunctionalRows(prev => prev.map(row => {
      if (row.id === id) {
        if (field === 'base') {
          return { ...row, base_value: numValue };
        } else {
          return {
            ...row,
            functional_tiers: {
              ...row.functional_tiers,
              [field]: numValue
            }
          };
        }
      }
      return row;
    }));
  };

  const handleKepangkatanChange = (id: string, value: string) => {
    const numValue = parseInt(value.replace(/[^0-9]/g, '')) || 0;
    setKepangkatanRows(prev => prev.map(row => {
      if (row.id === id) {
        return { ...row, allowance: numValue };
      }
      return row;
    }));
  };

  const saveChanges = async () => {
    if (isSavingRef.current) return;
    try {
      isSavingRef.current = true;
      setSaving(true);
      setMessage(null);
      const batch = writeBatch(db);

      if (selectedTab === 'white_collar') {
        // Save white collar rows
        whiteCollarRows.forEach(row => {
          const rowRef = doc(db, 'SalaryMatrix_WhiteCollar', whiteCollarVersion, 'rows', row.id);
          batch.update(rowRef, {
            salaries: row.salaries,
            updatedAt: serverTimestamp()
          });
        });
        const metaRef = doc(db, 'SalaryMatrix_WhiteCollar', whiteCollarVersion);
        batch.update(metaRef, {
          'metadata.updatedAt': serverTimestamp(),
        });
      } else if (selectedTab === 'blue_collar') {
        // Save blue collar rows
        rows.forEach(row => {
          const rowRef = doc(db, 'SalaryMatrix', activeVersion, 'rows', row.id);
          batch.update(rowRef, {
            salaries: row.salaries,
            updatedAt: serverTimestamp()
          });
        });
        const metaRef = doc(db, 'SalaryMatrix', activeVersion);
        batch.update(metaRef, {
          'metadata.updatedAt': serverTimestamp(),
        });
      } else if (selectedTab === 'functional') {
        // Save functional allowance rows
        functionalRows.forEach(row => {
          const rowRef = doc(db, 'SalaryMatrix_Functional', functionalVersion, 'rows', row.id);
          batch.update(rowRef, {
            base_value: row.base_value,
            functional_tiers: row.functional_tiers,
            updatedAt: serverTimestamp()
          });
        });
        const metaRef = doc(db, 'SalaryMatrix_Functional', functionalVersion);
        batch.update(metaRef, {
          'metadata.updatedAt': serverTimestamp(),
        });
      } else if (selectedTab === 'kepangkatan') {
        // Save Kepangkatan allowance rows
        kepangkatanRows.forEach(row => {
          const rowRef = doc(db, 'SalaryMatrix_Kepangkatan', kepangkatanVersion, 'rows', row.id);
          batch.update(rowRef, {
            allowance: row.allowance,
            updatedAt: serverTimestamp()
          });
        });
        const metaRef = doc(db, 'SalaryMatrix_Kepangkatan', kepangkatanVersion);
        batch.update(metaRef, {
          'metadata.updatedAt': serverTimestamp(),
        });
      }

      await batch.commit();
      setMessage({ type: 'success', text: 'Perubahan berhasil disimpan!' });
      
      // Clear success message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving changes:", error);
      setMessage({ type: 'error', text: 'Gagal menyimpan perubahan. Silakan coba lagi.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1400px] mx-auto relative z-10">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/payroll">
              <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm border border-slate-200 hover:bg-slate-50">
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="w-6 h-6 text-indigo-500" />
                Master Data Gaji Pokok
              </h1>
              <p className="text-slate-500 text-sm">Kelola matriks gaji berdasarkan golongan, masa kerja, dan tunjangan fungsional</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <FloatingSnackbar message={message} />
            <Button variant="outline" className="rounded-xl bg-white border-slate-200 shadow-sm">
              <History className="w-4 h-4 mr-2" /> Riwayat
            </Button>
            <Button 
              onClick={saveChanges} 
              disabled={saving || loading}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 px-6 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Simpan Perubahan
            </Button>
          </div>
        </div>

        {/* Segment Tabs Control */}
        <div className="flex flex-col xl:flex-row xl:justify-between xl:items-center gap-4 mb-6">
          <div className="flex flex-wrap bg-slate-100 p-1 rounded-2xl border border-slate-200/40 shadow-inner w-fit gap-1">
            <button
              onClick={() => setSelectedTab('blue_collar')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                selectedTab === 'blue_collar'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/20'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Pegawai Lapangan (Blue Collar)
            </button>
            <button
              onClick={() => setSelectedTab('white_collar')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                selectedTab === 'white_collar'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/20'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Users className="w-4 h-4" />
              Pegawai Kantor (White Collar)
            </button>
            <button
              onClick={() => setSelectedTab('functional')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                selectedTab === 'functional'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/20'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Tunjangan Fungsional (Staf)
            </button>
            <button
              onClick={() => setSelectedTab('kepangkatan')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                selectedTab === 'kepangkatan'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/20'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Tunjangan Kepangkatan
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs sm:text-sm font-medium w-fit">
            Versi Aktif: {selectedTab === 'blue_collar' ? activeVersion : selectedTab === 'white_collar' ? whiteCollarVersion : selectedTab === 'functional' ? functionalVersion : kepangkatanVersion}
          </div>
        </div>

        {/* Main Content */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.1)] border-none overflow-hidden border border-slate-100">
          {(() => {
            if (selectedTab === 'functional') {
              return (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-sm">
                      <TableRow className="border-slate-100">
                        <TableHead rowSpan={2} className="w-56 font-semibold text-slate-900 bg-slate-50/80 pl-8 align-middle border-r border-slate-100 text-left min-w-[200px]">
                          Tingkat Pendidikan
                        </TableHead>
                        <TableHead rowSpan={2} className="w-28 font-semibold text-slate-900 bg-slate-50/80 align-middle border-r border-slate-100 text-center min-w-[120px]">
                          Base Value
                        </TableHead>
                        <TableHead colSpan={16} className="font-bold text-center text-indigo-900 bg-indigo-50 border-b border-slate-200 py-2.5 text-xs uppercase tracking-wider">
                          Kewajiban Jam Mengajar / Beban Kerja (Pelayanan)
                        </TableHead>
                      </TableRow>
                      <TableRow className="border-slate-100">
                        {Array.from({ length: 16 }, (_, idx) => idx + 1).map((idx) => (
                          <TableHead key={idx} className="min-w-[100px] font-bold text-center text-slate-600 bg-slate-50/80 py-2 text-xs border-b border-slate-100">
                            Beban {idx}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={18} className="h-64 text-center">
                            <div className="flex flex-col items-center gap-3 text-slate-400">
                              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                              <p className="animate-pulse">Memuat matriks fungsional...</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : functionalRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={18} className="h-64 text-center text-slate-400">
                            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            Tidak ada data fungsional untuk ditampilkan.
                          </TableCell>
                        </TableRow>
                      ) : functionalRows.map((row) => (
                        <TableRow key={row.id} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                          <TableCell className="font-bold text-slate-700 pl-8 text-left border-r border-slate-100 bg-slate-50/10 min-w-[200px]" title={row.education_level}>
                            {row.education_level}
                          </TableCell>
                          <TableCell className="p-2 border-r border-slate-100 min-w-[120px]">
                            <Input
                              type="text"
                              value={row.base_value?.toLocaleString('id-ID') || '0'}
                              onChange={(e) => handleFunctionalChange(row.id, 'base', e.target.value)}
                              className="text-center font-medium h-9 border-slate-100 focus:border-indigo-300 focus:ring-indigo-100 rounded-lg transition-all"
                            />
                          </TableCell>
                          {Array.from({ length: 16 }, (_, idx) => String(idx + 1)).map((tierCode) => (
                            <TableCell key={tierCode} className="p-2 min-w-[100px]">
                              <Input
                                type="text"
                                value={row.functional_tiers[tierCode]?.toLocaleString('id-ID') || '0'}
                                onChange={(e) => handleFunctionalChange(row.id, tierCode, e.target.value)}
                                className="text-center font-medium h-9 border-slate-100 focus:border-indigo-300 focus:ring-indigo-100 rounded-lg transition-all"
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            }

            if (selectedTab === 'kepangkatan') {
              return (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-sm">
                      <TableRow className="border-slate-100">
                        <TableHead className="w-48 font-semibold text-slate-900 bg-slate-50/80 pl-8 align-middle text-center">
                          Kredit Kumulatif
                        </TableHead>
                        <TableHead className="w-64 font-semibold text-slate-900 bg-slate-50/80 align-middle text-left">
                          Jabatan (Pangkat)
                        </TableHead>
                        <TableHead className="w-64 font-semibold text-slate-900 bg-slate-50/80 align-middle text-right pr-8">
                          Tunjangan Kepangkatan (Rp)
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={3} className="h-64 text-center">
                            <div className="flex flex-col items-center gap-3 text-slate-400">
                              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                              <p className="animate-pulse">Memuat matriks kepangkatan...</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : kepangkatanRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="h-64 text-center text-slate-400">
                            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            Tidak ada data kepangkatan untuk ditampilkan.
                          </TableCell>
                        </TableRow>
                      ) : kepangkatanRows.map((row) => (
                        <TableRow key={row.id} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                          <TableCell className="font-bold text-slate-700 pl-8 text-center bg-slate-50/10">
                            {row.credit_score}
                          </TableCell>
                          <TableCell className="font-semibold text-slate-600 text-left">
                            {row.designation}
                          </TableCell>
                          <TableCell className="p-2 pr-8 text-right">
                            <div className="flex justify-end">
                              <div className="flex items-center h-9 rounded-lg bg-white border border-slate-200 px-2.5 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200 transition-all max-w-[200px]">
                                <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                                <Input
                                  type="text"
                                  value={row.allowance?.toLocaleString('id-ID') || '0'}
                                  onChange={(e) => handleKepangkatanChange(row.id, e.target.value)}
                                  className="text-right font-semibold border-none p-0 h-full outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                                />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            }

            const activeGrades = selectedTab === 'white_collar' ? whiteCollarGrades : gradeCodes;
            const activeRows = selectedTab === 'white_collar' ? whiteCollarRows : rows;
            return (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-sm">
                    {selectedTab === 'white_collar' ? (
                      <>
                        <TableRow className="border-slate-100">
                          <TableHead rowSpan={2} className="w-28 font-semibold text-slate-900 bg-slate-50/80 pl-8 align-middle border-r border-slate-100 text-center">
                            Masa Kerja (Thn)
                          </TableHead>
                          <TableHead rowSpan={2} className="w-24 font-semibold text-slate-900 bg-slate-50/80 align-middle border-r border-slate-100 text-center">
                            Bulan
                          </TableHead>
                          <TableHead colSpan={6} className="font-bold text-center text-indigo-900 bg-indigo-50 border-b border-r border-slate-200 py-2.5 text-xs uppercase tracking-wider">
                            Level 1 ( SLTP,SLTA,D1,D2 )
                          </TableHead>
                          <TableHead colSpan={6} className="font-bold text-center text-sky-900 bg-sky-50 border-b border-r border-slate-200 py-2.5 text-xs uppercase tracking-wider">
                            level 2 ( D3 ,D4,S1 )
                          </TableHead>
                          <TableHead colSpan={18} className="font-bold text-center text-violet-900 bg-violet-50 border-b border-slate-200 py-2.5 text-xs uppercase tracking-wider">
                            level 3,4,5 ( S2 ,S3 )
                          </TableHead>
                        </TableRow>
                        <TableRow className="border-slate-100">
                          {activeGrades.map((code, idx) => (
                            <TableHead
                              key={code}
                              className={`min-w-[110px] font-bold text-center text-slate-600 bg-slate-50/80 py-2 text-xs border-b border-slate-100 ${
                                idx === 5 || idx === 11 ? 'border-r border-slate-200' : ''
                              }`}
                            >
                              Gol. {code}
                            </TableHead>
                          ))}
                        </TableRow>
                      </>
                    ) : (
                      <TableRow className="border-slate-100">
                        <TableHead className="w-28 font-semibold text-slate-900 bg-slate-50/80 pl-8">Masa Kerja (Thn)</TableHead>
                        <TableHead className="w-24 font-semibold text-slate-900 bg-slate-50/80">Bulan</TableHead>
                        {activeGrades.map(code => (
                          <TableHead key={code} className="min-w-[120px] font-bold text-center text-indigo-600 bg-slate-50/80">
                            Gol. {code}
                          </TableHead>
                        ))}
                      </TableRow>
                    )}
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={activeGrades.length + 2} className="h-64 text-center">
                          <div className="flex flex-col items-center gap-3 text-slate-400">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                            <p className="animate-pulse">Memuat matriks gaji...</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : activeRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={activeGrades.length + 2} className="h-64 text-center text-slate-400">
                          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          Tidak ada data gaji untuk ditampilkan.
                        </TableCell>
                      </TableRow>
                    ) : activeRows.map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                        <TableCell className="font-bold text-slate-700 pl-8 text-center border-r border-slate-100 bg-slate-50/10">{row.tahun}</TableCell>
                        <TableCell className="text-slate-500 font-medium text-center border-r border-slate-100 bg-slate-50/10">{row.bulan}</TableCell>
                        {activeGrades.map((code, idx) => (
                          <TableCell
                            key={code}
                            className={`p-2 ${
                              selectedTab === 'white_collar' && (idx === 5 || idx === 11)
                                ? 'border-r border-slate-200'
                                : ''
                            }`}
                          >
                            <Input
                              type="text"
                              value={row.salaries[code]?.toLocaleString('id-ID') || '0'}
                              onChange={(e) => handleSalaryChange(row.tahun, code, e.target.value)}
                              className="text-center font-medium h-9 border-slate-100 focus:border-indigo-300 focus:ring-indigo-100 rounded-lg transition-all"
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
        </Card>
      </div>
    </div>
  );
}
