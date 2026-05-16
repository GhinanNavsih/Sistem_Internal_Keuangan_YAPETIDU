"use client";

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { collection, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface SalaryRow {
  id: string;
  tahun: number;
  bulan: number;
  salaries: Record<string, number>;
}

export default function SalaryMasterPage() {
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [gradeCodes, setGradeCodes] = useState<string[]>([]);
  const [activeVersion, setActiveVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 1. Get Active Version
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

        // 3. Fetch Salary Rows
        const rowsSnapshot = await getDocs(collection(db, 'SalaryMatrix', version, 'rows'));
        const rowsList = rowsSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        })) as SalaryRow[];
        
        // Sort by year
        setRows(rowsList.sort((a, b) => a.tahun - b.tahun));
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
  };

  const saveChanges = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const batch = writeBatch(db);

      // Update each row
      rows.forEach(row => {
        const rowRef = doc(db, 'SalaryMatrix', activeVersion, 'rows', row.id);
        batch.update(rowRef, {
          salaries: row.salaries,
          updatedAt: serverTimestamp()
        });
      });

      // Update metadata timestamp
      const metaRef = doc(db, 'SalaryMatrix', activeVersion);
      batch.update(metaRef, {
        'metadata.updatedAt': serverTimestamp(),
      });

      await batch.commit();
      setMessage({ type: 'success', text: 'Perubahan berhasil disimpan!' });
      
      // Clear success message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving changes:", error);
      setMessage({ type: 'error', text: 'Gagal menyimpan perubahan. Silakan coba lagi.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50 p-8 font-sans text-slate-800">
      <div className="max-w-[1400px] mx-auto">
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
              <p className="text-slate-500 text-sm">Kelola matriks gaji berdasarkan golongan dan masa kerja</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {activeVersion && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium">
                Versi Aktif: {activeVersion}
              </div>
            )}
            {message && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium animate-in fade-in slide-in-from-top-2 ${
                message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {message.text}
              </div>
            )}
            <Button variant="outline" className="rounded-xl bg-white border-slate-200 shadow-sm">
              <History className="w-4 h-4 mr-2" /> Riwayat
            </Button>
            <Button 
              onClick={saveChanges} 
              disabled={saving || loading}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 px-6"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Simpan Perubahan
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.1)] border-none overflow-hidden border border-slate-100">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100">
                  <TableHead className="w-20 font-semibold text-slate-900 bg-slate-50/80 pl-8">Tahun</TableHead>
                  <TableHead className="w-20 font-semibold text-slate-900 bg-slate-50/80">Bulan</TableHead>
                  {gradeCodes.map(code => (
                    <TableHead key={code} className="min-w-[120px] font-bold text-center text-indigo-600 bg-slate-50/80">
                      Gol. {code}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={gradeCodes.length + 2} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        <p className="animate-pulse">Memuat matriks gaji...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                    <TableCell className="font-bold text-slate-700 pl-8">{row.tahun}</TableCell>
                    <TableCell className="text-slate-500 font-medium">{row.bulan}</TableCell>
                    {gradeCodes.map(code => (
                      <TableCell key={code} className="p-2">
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
        </Card>
      </div>
    </div>
  );
}
