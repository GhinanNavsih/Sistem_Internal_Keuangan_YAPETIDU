import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { validateSuratMasukInput, validateSuratKeluarInput } from '@/lib/surat-menyurat/validation';
import { parseLetterDraft } from '@/lib/surat-menyurat/templates';
import { DisposisiSurat, SuratMasuk, SuratKeluar, SuratStats } from '@/lib/surat-menyurat/types';
import { loadReservationContact } from '@/lib/server/venueContact';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const COLLECTION_NAME = 'SatkerLetters';

function getActorSatker(actor: { satkerName?: string; displayName: string; uid: string }): { satkerId: string; satkerName: string } {
  const rawSatker = (actor.satkerName || '').trim();
  const name = rawSatker || actor.displayName || 'Satuan Kerja Loyalis';
  const id = rawSatker
    ? rawSatker.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    : `satker-${actor.uid}`;
  return { satkerId: id, satkerName: name };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) {
      throw new HttpError(403, 'Anda tidak memiliki hak akses surat-menyurat.');
    }

    const { searchParams } = new URL(request.url);
    const filterSatker = searchParams.get('satkerId') || '';
    const filterYear = searchParams.get('year') || '';
    const filterMonth = searchParams.get('month') || '';
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const isSuperAdmin = actor.role === 'super_admin';

    const actorSatker = getActorSatker(actor);
    const effectiveSatkerId = isSuperAdmin ? (filterSatker || null) : actorSatker.satkerId;

    let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION_NAME);
    if (effectiveSatkerId) {
      query = query.where('satkerId', '==', effectiveSatkerId);
    }

    const snapshot = await query.get();
    const allDocs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Collect all unique satker info for super_admin filter
    const satkerMap = new Map<string, string>();
    if (isSuperAdmin) {
      const allSatkerLetters = await adminDb.collection(COLLECTION_NAME).select('satkerId', 'satkerName').get();
      allSatkerLetters.docs.forEach((d) => {
        const data = d.data();
        if (data.satkerId && data.satkerName) {
          satkerMap.set(data.satkerId, data.satkerName);
        }
      });
      // Also include active satker heads from users
      const heads = await adminDb.collection('users').where('role', '==', 'satker_head_loyalis').get();
      heads.docs.forEach((h) => {
        const u = h.data();
        if (u.satkerName) {
          const sid = u.satkerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          satkerMap.set(sid, u.satkerName.trim());
        }
      });
    }

    const suratMasuk: SuratMasuk[] = [];
    const suratKeluar: SuratKeluar[] = [];

    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

    let totalMasuk = 0;
    let totalKeluar = 0;
    let menungguDisposisi = 0;
    let diproses = 0;
    let selesaiMasuk = 0;
    let draftKeluar = 0;
    let terkirimKeluar = 0;
    let suratBulanIni = 0;

    for (const item of allDocs) {
      const type = (item as { type?: string }).type || 'masuk';
      const tanggal = String((item as { tanggalSurat?: string }).tanggalSurat || '');
      const itemYear = tanggal.slice(0, 4);
      const itemMonth = tanggal.slice(5, 7);

      const isCurrentMonth = itemYear === currentYear && itemMonth === currentMonth;
      if (isCurrentMonth) suratBulanIni++;

      // Apply Year & Month filters
      if (filterYear && itemYear !== filterYear) continue;
      if (filterMonth && itemMonth !== filterMonth.padStart(2, '0')) continue;

      // Apply Search filter
      if (search) {
        const targetSearchText = [
          (item as { nomorSurat?: string }).nomorSurat,
          (item as { perihal?: string }).perihal,
          (item as { pengirim?: string }).pengirim,
          (item as { tujuan?: string }).tujuan,
          (item as { ringkasan?: string }).ringkasan,
          (item as { kategori?: string }).kategori,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!targetSearchText.includes(search)) continue;
      }

      if (type === 'masuk') {
        const m = item as unknown as SuratMasuk;
        suratMasuk.push(m);
        totalMasuk++;
        if (m.status === 'menunggu_disposisi') menungguDisposisi++;
        else if (m.status === 'diproses') diproses++;
        else if (m.status === 'selesai') selesaiMasuk++;
      } else {
        const k = item as unknown as SuratKeluar;
        suratKeluar.push(k);
        totalKeluar++;
        if (k.status === 'draft') draftKeluar++;
        else if (k.status === 'terkirim') terkirimKeluar++;
      }
    }

    // Sort descending by date
    suratMasuk.sort((a, b) => (b.tanggalSurat || b.createdAt).localeCompare(a.tanggalSurat || a.createdAt));
    suratKeluar.sort((a, b) => (b.tanggalSurat || b.createdAt).localeCompare(a.tanggalSurat || a.createdAt));

    const stats: SuratStats = {
      totalMasuk,
      totalKeluar,
      menungguDisposisi,
      diproses,
      selesaiMasuk,
      draftKeluar,
      terkirimKeluar,
      suratBulanIni,
    };

    const satkerList = Array.from(satkerMap.entries()).map(([id, name]) => ({ id, name }));

    let userPhone = '';
    try {
      const contact = await loadReservationContact(adminDb, actor);
      userPhone = contact.phone || '';
    } catch {
      // safe fallback
    }

    return NextResponse.json({
      ok: true,
      suratMasuk,
      suratKeluar,
      stats,
      satkerList,
      actorSatker,
      userContact: {
        email: actor.email || '',
        phone: userPhone,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) {
      throw new HttpError(403, 'Anda tidak memiliki hak akses untuk membuat surat.');
    }

    const body = await request.json();
    const type = body.type === 'keluar' ? 'keluar' : 'masuk';
    const actorSatker = getActorSatker(actor);
    const targetSatkerId = (actor.role === 'super_admin' && body.satkerId) ? body.satkerId : actorSatker.satkerId;
    const targetSatkerName = (actor.role === 'super_admin' && body.satkerName) ? body.satkerName : actorSatker.satkerName;

    const id = body.id || randomUUID();
    const nowIso = new Date().toISOString();

    if (type === 'masuk') {
      const validation = validateSuratMasukInput(body);
      if (!validation.ok || !validation.data) {
        throw new HttpError(400, validation.error || 'Data surat masuk tidak valid.');
      }

      const docData: SuratMasuk & { type: string } = {
        id,
        type: 'masuk',
        satkerId: targetSatkerId,
        satkerName: targetSatkerName,
        ...(validation.data.institutionScope !== undefined && { institutionScope: validation.data.institutionScope }),
        ...(validation.data.nomorUrut !== undefined && { nomorUrut: validation.data.nomorUrut }),
        ...(validation.data.kodeSurat !== undefined && { kodeSurat: validation.data.kodeSurat }),
        ...(validation.data.kodeArsip !== undefined && { kodeArsip: validation.data.kodeArsip }),
        ...(validation.data.usiaArsip !== undefined && { usiaArsip: validation.data.usiaArsip }),
        nomorSurat: validation.data.nomorSurat,
        tanggalSurat: validation.data.tanggalSurat,
        tanggalDiterima: validation.data.tanggalDiterima,
        pengirim: validation.data.pengirim,
        penerima: validation.data.penerima,
        perihal: validation.data.perihal,
        sifat: validation.data.sifat,
        kategori: validation.data.kategori,
        ringkasan: validation.data.ringkasan,
        status: validation.data.status,
        disposisi: null,
        attachments: validation.data.attachments || [],
        createdAt: nowIso,
        updatedAt: nowIso,
        createdByUid: actor.uid,
        createdByName: actor.displayName,
      };

      await adminDb.collection(COLLECTION_NAME).doc(id).set(docData);
      return NextResponse.json({ ok: true, data: docData });
    } else {
      const validation = validateSuratKeluarInput(body);
      if (!validation.ok || !validation.data) {
        throw new HttpError(400, validation.error || 'Data surat keluar tidak valid.');
      }
      const letterDraft = body.letterDraft === undefined ? undefined : parseLetterDraft(body.letterDraft);
      if (letterDraft === null) throw new HttpError(400, 'Naskah surat tidak valid atau terlalu panjang.');

      const docData: SuratKeluar & { type: string } = {
        id,
        type: 'keluar',
        satkerId: targetSatkerId,
        satkerName: targetSatkerName,
        ...(validation.data.institutionScope !== undefined && { institutionScope: validation.data.institutionScope }),
        ...(validation.data.nomorUrut !== undefined && { nomorUrut: validation.data.nomorUrut }),
        ...(validation.data.nomorUrutEnd !== undefined && { nomorUrutEnd: validation.data.nomorUrutEnd }),
        ...(validation.data.kodeSurat !== undefined && { kodeSurat: validation.data.kodeSurat }),
        ...(validation.data.kodeArsip !== undefined && { kodeArsip: validation.data.kodeArsip }),
        ...(validation.data.usiaArsip !== undefined && { usiaArsip: validation.data.usiaArsip }),
        nomorSurat: validation.data.nomorSurat,
        tanggalSurat: validation.data.tanggalSurat,
        tujuan: validation.data.tujuan,
        perihal: validation.data.perihal,
        sifat: validation.data.sifat,
        kategori: validation.data.kategori,
        ringkasan: validation.data.ringkasan,
        penandatanganNama: validation.data.penandatanganNama || actor.displayName,
        penandatanganJabatan: validation.data.penandatanganJabatan || 'Kepala SatKer',
        status: validation.data.status,
        ...(validation.data.templateType !== undefined && { templateType: validation.data.templateType as SuratKeluar['templateType'] }),
        ...(validation.data.contentBody !== undefined && { contentBody: validation.data.contentBody }),
        ...(validation.data.lampiranKeterangan !== undefined && { lampiranKeterangan: validation.data.lampiranKeterangan }),
        ...(letterDraft !== undefined && { letterDraft }),
        attachments: validation.data.attachments || [],
        createdAt: nowIso,
        updatedAt: nowIso,
        createdByUid: actor.uid,
        createdByName: actor.displayName,
      };

      await adminDb.collection(COLLECTION_NAME).doc(id).set(docData);
      return NextResponse.json({ ok: true, data: docData });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) {
      throw new HttpError(403, 'Anda tidak memiliki hak akses untuk mengubah surat.');
    }

    const body = await request.json();
    const id = body.id;
    if (!id || typeof id !== 'string') {
      throw new HttpError(400, 'ID surat tidak valid.');
    }

    const docRef = adminDb.collection(COLLECTION_NAME).doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      throw new HttpError(404, 'Data surat tidak ditemukan.');
    }

    const existingData = existing.data()!;
    const actorSatker = getActorSatker(actor);
    const isSuperAdmin = actor.role === 'super_admin';
    if (!isSuperAdmin && existingData.satkerId !== actorSatker.satkerId && existingData.createdByUid !== actor.uid) {
      throw new HttpError(403, 'Anda tidak berwenang mengedit surat dari SatKer lain.');
    }

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      updatedAt: nowIso,
    };

    if (body.letterDraft !== undefined) {
      if (existingData.type !== 'keluar') throw new HttpError(400, 'Naskah hanya untuk surat keluar.');
      const letterDraft = parseLetterDraft(body.letterDraft);
      if (!letterDraft) throw new HttpError(400, 'Naskah surat tidak valid atau terlalu panjang.');
      updates.letterDraft = letterDraft;
      updates.templateType = letterDraft.templateType;
    }

    // Handle Disposisi update on Surat Masuk
    if (body.disposisi !== undefined) {
      if (body.disposisi === null) {
        updates.disposisi = null;
      } else {
        const d = body.disposisi;
        const disposisiObj: DisposisiSurat = {
          instruksi: String(d.instruksi || '').trim(),
          diteruskanKepada: String(d.diteruskanKepada || '').trim(),
          diteruskanChecklist: Array.isArray(d.diteruskanChecklist) ? d.diteruskanChecklist : [],
          tindakanChecklist: Array.isArray(d.tindakanChecklist) ? d.tindakanChecklist : [],
          catatan: String(d.catatan || '').trim(),
          tanggalDisposisi: d.tanggalDisposisi || nowIso.slice(0, 10),
          disposisiOleh: actor.displayName,
          disposisiOlehUid: actor.uid,
        };
        updates.disposisi = disposisiObj;
        if (existingData.status === 'menunggu_disposisi') {
          updates.status = 'diproses';
        }
      }
    }

    // Common field updates
    if (typeof body.institutionScope === 'string') updates.institutionScope = body.institutionScope;
    if (typeof body.nomorUrut === 'number') updates.nomorUrut = body.nomorUrut;
    if (typeof body.nomorUrutEnd === 'number') updates.nomorUrutEnd = body.nomorUrutEnd;
    if (typeof body.kodeSurat === 'string') updates.kodeSurat = body.kodeSurat.trim();
    if (typeof body.kodeArsip === 'string') updates.kodeArsip = body.kodeArsip.trim();
    if (typeof body.usiaArsip === 'string') updates.usiaArsip = body.usiaArsip.trim();
    if (typeof body.status === 'string') updates.status = body.status;
    if (typeof body.nomorSurat === 'string') updates.nomorSurat = body.nomorSurat.trim();
    if (typeof body.tanggalSurat === 'string') updates.tanggalSurat = body.tanggalSurat.trim();
    if (typeof body.perihal === 'string') updates.perihal = body.perihal.trim();
    if (typeof body.sifat === 'string') updates.sifat = body.sifat;
    if (typeof body.kategori === 'string') updates.kategori = body.kategori;
    if (typeof body.ringkasan === 'string') updates.ringkasan = body.ringkasan;
    if (Array.isArray(body.attachments)) updates.attachments = body.attachments;

    // Masuk-specific
    if (typeof body.tanggalDiterima === 'string') updates.tanggalDiterima = body.tanggalDiterima.trim();
    if (typeof body.pengirim === 'string') updates.pengirim = body.pengirim.trim();
    if (typeof body.penerima === 'string') updates.penerima = body.penerima.trim();

    // Keluar-specific
    if (typeof body.tujuan === 'string') updates.tujuan = body.tujuan.trim();
    if (typeof body.penandatanganNama === 'string') updates.penandatanganNama = body.penandatanganNama.trim();
    if (typeof body.penandatanganJabatan === 'string') updates.penandatanganJabatan = body.penandatanganJabatan.trim();
    if (typeof body.contentBody === 'string') updates.contentBody = body.contentBody;
    if (typeof body.lampiranKeterangan === 'string') updates.lampiranKeterangan = body.lampiranKeterangan.trim();

    await docRef.update(updates);
    const updatedDoc = (await docRef.get()).data();
    return NextResponse.json({ ok: true, data: { id, ...updatedDoc } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) {
      throw new HttpError(403, 'Anda tidak memiliki hak akses untuk menghapus surat.');
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) throw new HttpError(400, 'ID surat wajib disertakan.');

    const docRef = adminDb.collection(COLLECTION_NAME).doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      throw new HttpError(404, 'Surat tidak ditemukan.');
    }

    const existingData = existing.data()!;
    const actorSatker = getActorSatker(actor);
    const isSuperAdmin = actor.role === 'super_admin';
    if (!isSuperAdmin && existingData.satkerId !== actorSatker.satkerId && existingData.createdByUid !== actor.uid) {
      throw new HttpError(403, 'Anda tidak berwenang menghapus surat dari SatKer lain.');
    }

    await docRef.delete();
    return NextResponse.json({ ok: true, message: 'Surat berhasil dihapus.' });
  } catch (error) {
    return errorResponse(error);
  }
}
