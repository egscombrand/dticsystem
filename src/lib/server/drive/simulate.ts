import "server-only";
import { getZonedParts } from "@/lib/dates";
import { sanitizeDriveSegment } from "@/lib/drive";
import { driveClient } from "@/lib/server/drive/index";
import { isDriveEnabled, resolveDriveConfig } from "@/lib/server/drive/config";
import { randomUUID } from "node:crypto";

/**
 * Data simulasi (UAT) di dalam folder PIC yang SUDAH ADA langsung di bawah root Drive A — dibuat untuk
 * pengujian manual, selalu ditandai "TESTING" pada nama/isi file, dan tidak pernah terhubung ke request
 * produksi nyata (lihat catatan `requestId: null` di bawah). Folder PIC HANYA dideteksi dari Drive (anak
 * langsung root) lalu dicocokkan ke anggota AKTIF di database by nama — bukan daftar nama yang ditulis
 * manual, dan folder Drive yang tidak cocok dengan anggota mana pun ditandai "ambiguous" dan DILEWATI
 * (tidak pernah disentuh), sesuai permintaan.
 */

const UAT_SUBFOLDERS = ["01_Dokumen_Permintaan", "02_Dokumen_Pendukung", "03_Hasil_Pekerjaan", "04_Laporan_dan_Review", "05_Dokumentasi"] as const;

export type SimulationPlanItem = {
  memberId: string;
  memberName: string;
  picFolderId: string;
  uatFolderPath: string[]; // [Tahun, Tanggal, "UAT_DTIC_Test"]
  filesToCreate: string[]; // nama file per subfolder, mis. "01_Dokumen_Permintaan/TESTING_Surat_Permintaan.txt"
};

export type SimulationPlan = {
  testRunId: string;
  dateSegment: string;
  items: SimulationPlanItem[];
  ambiguousDriveFolders: { id: string; name: string }[]; // folder langsung di bawah root yang TIDAK cocok anggota aktif manapun
};

/** Cocokkan folder Drive langsung di bawah root ke anggota AKTIF (berdasarkan nama yang disanitasi — sama persis dengan yang dipakai syncMemberFolders). */
export async function buildSimulationPlan(members: { id: string; name: string }[]): Promise<SimulationPlan> {
  const cfg = requireDriveConfig();
  const client = await driveClient();
  const rootChildren = await client.listFolders(cfg.rootFolderId);
  const byName = new Map(rootChildren.map((f) => [f.name, f] as const));

  const now = new Date();
  const p = getZonedParts(now);
  const year = String(p.year);
  const dateSegment = `${String(p.day).padStart(2, "0")}-${String(p.month).padStart(2, "0")}-${year}`;
  const testRunId = randomUUID();

  const matchedNames = new Set<string>();
  const items: SimulationPlanItem[] = [];
  for (const m of members) {
    const folderName = sanitizeDriveSegment(m.name, m.id);
    const folder = byName.get(folderName);
    if (!folder) continue; // belum disinkronkan (jalankan "Sinkronkan Folder Anggota" dulu) — bukan error simulasi
    matchedNames.add(folderName);
    items.push({
      memberId: m.id,
      memberName: m.name,
      picFolderId: folder.id,
      uatFolderPath: [year, dateSegment, "UAT_DTIC_Test"],
      filesToCreate: UAT_SUBFOLDERS.flatMap((sub) => [`${sub}/${fileNameFor(sub)}`]),
    });
  }

  const ambiguousDriveFolders = rootChildren.filter((f) => !matchedNames.has(f.name)).map((f) => ({ id: f.id, name: f.name }));

  return { testRunId, dateSegment, items, ambiguousDriveFolders };
}

function fileNameFor(subfolder: string): string {
  if (subfolder === "01_Dokumen_Permintaan") return "TESTING_Surat_Permintaan.txt";
  if (subfolder === "02_Dokumen_Pendukung") return "TESTING_Data_Pendukung.txt";
  if (subfolder === "03_Hasil_Pekerjaan") return "TESTING_Hasil_Pekerjaan.txt";
  if (subfolder === "04_Laporan_dan_Review") return "TESTING_Laporan_Review.txt";
  return "README_TESTING.txt";
}

function fileContentFor(subfolder: string, input: { memberName: string; testRunId: string; dateSegment: string }): string {
  const header = `[DATA SIMULASI / TESTING — BUKAN DOKUMEN KLIEN SUNGGUHAN]\nPIC: ${input.memberName}\ntest_run_id: ${input.testRunId}\nTanggal pengujian: ${input.dateSegment}\n\n`;
  if (subfolder === "01_Dokumen_Permintaan") {
    return `${header}Nomor simulasi: SIM-${input.testRunId.slice(0, 8).toUpperCase()}\nNama pemohon simulasi: Pemohon UAT ${input.memberName}\nJudul permintaan: Permintaan desain uji coba (UAT)\nStatus: UAT\n`;
  }
  if (subfolder === "02_Dokumen_Pendukung") {
    return `${header}Data pendukung ilustrasi (fiktif, tanpa data pribadi/klien sungguhan):\n- Referensi warna: Biru #1E40AF, Putih #FFFFFF\n- Ukuran: A4 (210x297mm)\n- Catatan: contoh brief fiktif untuk pengujian end-to-end.\n`;
  }
  if (subfolder === "03_Hasil_Pekerjaan") {
    return `${header}Ringkasan hasil pekerjaan (simulasi): Draf desain uji coba telah "diselesaikan" untuk kebutuhan UAT.\nStatus simulasi: Selesai (dummy)\n`;
  }
  if (subfolder === "04_Laporan_dan_Review") {
    return `${header}Status pemeriksaan: Lulus (simulasi)\nCatatan reviewer (simulasi): Tidak ada revisi — ini hanya data uji.\nHasil akhir pengujian: OK (dummy)\n`;
  }
  return `${header}Tujuan pengujian: memverifikasi struktur folder Drive A end-to-end.\nPeringatan: SEMUA file dalam folder UAT_DTIC_Test ini adalah data dummy, bukan dokumen produksi.\n`;
}

/** PDF minimal satu halaman (tanpa logo/tanda tangan resmi) berisi teks peringatan TESTING. */
function minimalTestingPdf(memberName: string): Uint8Array {
  const text = `(SAMPLE TESTING ONLY - PIC: ${memberName.replace(/[()\\]/g, "")}) Tj`;
  const content = `BT /F1 14 Tf 40 760 Td (DATA SIMULASI / TESTING ONLY) Tj 0 -24 Td ${text} ET`;
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${obj}\n`;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

function requireDriveConfig() {
  if (!isDriveEnabled()) throw new Error("Konfigurasi Google Drive belum lengkap.");
  const cfg = resolveDriveConfig(process.env);
  if (!cfg.ok) throw new Error(cfg.problem ?? "Konfigurasi Google Drive belum lengkap.");
  return cfg;
}

export type SimulationRunItem = {
  memberId: string;
  memberName: string;
  foldersCreated: number;
  foldersExisting: number;
  filesCreated: number;
  filesExisting: number;
  error?: string;
};

export type SimulationRunResult = { testRunId: string; items: SimulationRunItem[]; ambiguousDriveFolders: { id: string; name: string }[] };

/** Jalankan simulasi SUNGGUHAN (bukan dry-run) berdasarkan rencana dari buildSimulationPlan. Idempoten per subfolder/file. */
export async function runSimulation(plan: SimulationPlan): Promise<SimulationRunResult> {
  const client = await driveClient();
  const items: SimulationRunItem[] = [];

  for (const planItem of plan.items) {
    const result: SimulationRunItem = { memberId: planItem.memberId, memberName: planItem.memberName, foldersCreated: 0, foldersExisting: 0, filesCreated: 0, filesExisting: 0 };
    try {
      let parent = planItem.picFolderId;
      for (const segment of [...planItem.uatFolderPath]) {
        const existing = await client.findFolder(parent, segment);
        if (existing) {
          result.foldersExisting += 1;
          parent = existing.id;
        } else {
          const created = await client.createFolder(parent, segment);
          result.foldersCreated += 1;
          parent = created.id;
        }
      }
      const uatFolderId = parent;

      for (const sub of UAT_SUBFOLDERS) {
        const existingSub = await client.findFolder(uatFolderId, sub);
        const subFolderId = existingSub ? existingSub.id : (await client.createFolder(uatFolderId, sub)).id;
        if (existingSub) result.foldersExisting += 1;
        else result.foldersCreated += 1;

        const fileName = fileNameFor(sub);
        const idempotencyKey = `simulate:${planItem.memberId}:${plan.testRunId}:${sub}`;
        const existingFile = await client.findFileByIdempotencyKey(subFolderId, idempotencyKey);
        if (existingFile) {
          result.filesExisting += 1;
        } else {
          const bytes = Buffer.from(fileContentFor(sub, { memberName: planItem.memberName, testRunId: plan.testRunId, dateSegment: plan.dateSegment }), "utf-8");
          await client.uploadFile({
            folderId: subFolderId,
            fileName,
            mimeType: "text/plain",
            bytes,
            idempotencyKey,
            extraProperties: {
              is_test_data: "true",
              test_run_id: plan.testRunId,
              pic_folder_id: planItem.picFolderId,
              request_id: "none",
              created_at: new Date().toISOString(),
              simulation_status: "standalone",
            },
          });
          result.filesCreated += 1;
        }

        if (sub === "05_Dokumentasi") {
          const pdfKey = `simulate:${planItem.memberId}:${plan.testRunId}:pdf`;
          const existingPdf = await client.findFileByIdempotencyKey(subFolderId, pdfKey);
          if (existingPdf) {
            result.filesExisting += 1;
          } else {
            await client.uploadFile({
              folderId: subFolderId,
              fileName: "SAMPLE_TESTING_ONLY.pdf",
              mimeType: "application/pdf",
              bytes: minimalTestingPdf(planItem.memberName),
              idempotencyKey: pdfKey,
              extraProperties: { is_test_data: "true", test_run_id: plan.testRunId, pic_folder_id: planItem.picFolderId, request_id: "none", created_at: new Date().toISOString(), simulation_status: "standalone" },
            });
            result.filesCreated += 1;
          }
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Gagal menjalankan simulasi untuk PIC ini.";
    }
    items.push(result);
  }

  return { testRunId: plan.testRunId, items, ambiguousDriveFolders: plan.ambiguousDriveFolders };
}
