import { describe, expect, it } from "vitest";
import {
  badgeLabels,
  badgeTotal,
  briefChangeProblem,
  firstUnreadIndex,
  forgetOrderNumber,
  groupMessageActivity,
  lastSeqOf,
  mergeMessages,
  messageProblem,
  normalizeMessageBody,
  parseStoredOrderNumbers,
  rememberOrderNumber,
  sortActivity,
  unreadCount,
  type ChatMessage,
  type OrderBadges,
} from "@/lib/collab";

const msg = (seq: number, senderKind: ChatMessage["senderKind"], at: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${seq}`,
  seq,
  senderKind,
  senderName: senderKind === "requester" ? "Ani (Pemohon)" : "Fathin",
  body: `pesan ${seq}`,
  createdAt: at,
  attachments: [],
  ...over,
});

describe("normalizeMessageBody / messageProblem", () => {
  it("membuang karakter kontrol & berbahaya tampilan, merapikan baris kosong, memotong tepi", () => {
    const dirty = ["  halo", String.fromCharCode(0), String.fromCharCode(0x200b), " dunia\r\n\r\n\r\n\r\n\r\nlagi ", String.fromCharCode(0x202e), " "].join("");
    expect(normalizeMessageBody(dirty)).toBe("halo dunia\n\n\nlagi");
    expect(normalizeMessageBody(123)).toBe("");
    expect(normalizeMessageBody("a\tb")).toBe("a\tb");
  });

  it("menolak pesan kosong tanpa lampiran, terlalu panjang, terlalu banyak/besar lampiran", () => {
    expect(messageProblem("", [])?.field).toBe("body");
    expect(messageProblem("x".repeat(2001), [])?.field).toBe("body");
    expect(messageProblem("", [{ size: 10 }])).toBeNull(); // hanya lampiran boleh
    expect(messageProblem("ok", [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }])?.field).toBe("attachments");
    expect(messageProblem("ok", [{ size: 3 * 1024 * 1024 }, { size: 2 * 1024 * 1024 }])?.field).toBe("attachments");
    expect(messageProblem("ok", [{ size: 1024 }])).toBeNull();
  });
});

describe("mergeMessages / unread", () => {
  const a = msg(1, "requester", "2026-11-10T01:00:00Z");
  const b = msg(2, "staff", "2026-11-10T01:01:00Z");
  const c = msg(3, "staff", "2026-11-10T01:02:00Z");

  it("menggabungkan tanpa duplikat dan terurut menurut seq", () => {
    const merged = mergeMessages([c, a], [b, a]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(mergeMessages([a], [])).toEqual([a]);
    expect(lastSeqOf(merged)).toBe(3);
    expect(lastSeqOf([])).toBe(0);
  });

  it("menghitung pesan belum dibaca hanya dari pihak lain setelah kursor", () => {
    expect(unreadCount([a, b, c], 0, "requester")).toBe(2);
    expect(unreadCount([a, b, c], 2, "requester")).toBe(1);
    expect(unreadCount([a, b, c], 3, "requester")).toBe(0);
    expect(unreadCount([a, b, c], 0, "staff")).toBe(1); // dari sudut PIC, hanya pesan Pemohon
    expect(firstUnreadIndex([a, b, c], 1, "requester")).toBe(1);
    expect(firstUnreadIndex([a, b, c], 3, "requester")).toBe(-1);
  });
});

describe("groupMessageActivity", () => {
  it("meringkas pesan beruntun pengirim sama dalam 15 menit menjadi satu baris tanpa isi pesan", () => {
    const items = groupMessageActivity([
      msg(1, "staff", "2026-11-10T01:00:00Z"),
      msg(2, "staff", "2026-11-10T01:05:00Z", { attachments: [{ id: "f", fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1 }] }),
      msg(3, "requester", "2026-11-10T01:06:00Z"),
      msg(4, "staff", "2026-11-10T02:00:00Z"),
    ]);
    expect(items.map((i) => i.label)).toEqual([
      "PIC Fathin mengirim 2 pesan dan 1 lampiran",
      "Pemohon mengirim 1 pesan",
      "PIC Fathin mengirim 1 pesan",
    ]);
    expect(items.every((i) => !i.label.includes("pesan 1"))).toBe(true);
    expect(groupMessageActivity([])).toEqual([]);
  });

  it("sortActivity stabil menurut waktu", () => {
    const sorted = sortActivity([
      { key: "b", at: "2026-11-10T02:00:00Z", kind: "status", label: "b", actor: null, detail: null },
      { key: "a", at: "2026-11-10T01:00:00Z", kind: "status", label: "a", actor: null, detail: null },
      { key: "c", at: "2026-11-10T02:00:00Z", kind: "status", label: "c", actor: null, detail: null },
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["a", "b", "c"]);
  });
});

describe("briefChangeProblem", () => {
  it("alasan wajib, isi harus berbeda dari brief saat ini", () => {
    expect(briefChangeProblem("", "isi baru yang cukup panjang", "isi lama")?.field).toBe("reason");
    expect(briefChangeProblem("ab", "isi baru yang cukup panjang", "isi lama")?.field).toBe("reason");
    expect(briefChangeProblem("a".repeat(1001), "isi baru yang cukup panjang", "isi lama")?.field).toBe("reason");
    expect(briefChangeProblem("Data berubah", "isi  sama\n dengan lama", "isi sama dengan lama")?.field).toBe("briefDoc");
    expect(briefChangeProblem("Tanggal berubah", "isi baru yang cukup panjang", "isi lama")).toBeNull();
  });
});

describe("badges", () => {
  const base: OrderBadges = { orderNumber: "DTIC-2026-00001", status: "assigned", unreadMessages: 0, awaitingDeadline: false, newResults: 0, awaitingClarification: false, briefChangePending: true };
  it("total & label hanya dari penanda yang perlu tindakan/perhatian Pemohon", () => {
    expect(badgeTotal(base)).toBe(0); // usulan brief menunggu PIC bukan tindakan Pemohon
    expect(badgeLabels(base)).toEqual([]);
    const b = { ...base, unreadMessages: 2, awaitingDeadline: true, newResults: 1, awaitingClarification: true };
    expect(badgeTotal(b)).toBe(5);
    expect(badgeLabels(b)).toEqual(["2 pesan baru", "Deadline menunggu persetujuan", "Hasil/draft baru", "Permintaan klarifikasi"]);
  });
});

describe("Request saya (nomor order di browser)", () => {
  it("menyimpan hanya nomor berformat benar, terbaru di depan, tanpa duplikat, dibatasi", () => {
    let list: string[] = [];
    list = rememberOrderNumber(list, " dtic-2026-00028 ");
    list = rememberOrderNumber(list, "DTIC-2026-00019");
    list = rememberOrderNumber(list, "DTIC-2026-00028");
    expect(list).toEqual(["DTIC-2026-00028", "DTIC-2026-00019"]);
    expect(rememberOrderNumber(list, "bukan nomor")).toEqual(list);
    expect(rememberOrderNumber(list, "DTIC-2026-00005", 2)).toEqual(["DTIC-2026-00005", "DTIC-2026-00028"]);
    expect(forgetOrderNumber(list, "DTIC-2026-00019")).toEqual(["DTIC-2026-00028"]);
  });

  it("membaca penyimpanan rusak/berbahaya dengan aman", () => {
    expect(parseStoredOrderNumbers(null)).toEqual([]);
    expect(parseStoredOrderNumbers("{rusak")).toEqual([]);
    expect(parseStoredOrderNumbers('{"a":1}')).toEqual([]);
    expect(parseStoredOrderNumbers('["DTIC-2026-00028","<script>","DTIC-2026-00028",5]')).toEqual(["DTIC-2026-00028"]);
  });
});

describe("pemisah tanggal percakapan", () => {
  it("dayKeyWib memakai hari WIB (23.30 UTC sudah hari berikutnya di WIB)", async () => {
    const { dayKeyWib } = await import("@/lib/collab");
    expect(dayKeyWib("2026-11-10T16:59:00Z")).toBe("2026-11-10");
    expect(dayKeyWib("2026-11-10T17:01:00Z")).toBe("2026-11-11");
  });

  it("dayLabel: Hari ini, Kemarin, lalu tanggal panjang", async () => {
    const { dayLabel } = await import("@/lib/collab");
    const now = new Date("2026-11-10T05:00:00Z");
    const long = () => "Senin, 2 November 2026";
    expect(dayLabel("2026-11-10T01:00:00Z", now, long)).toBe("Hari ini");
    expect(dayLabel("2026-11-09T05:00:00Z", now, long)).toBe("Kemarin");
    expect(dayLabel("2026-11-02T05:00:00Z", now, long)).toBe("Senin, 2 November 2026");
  });

  it("dayStartIndexes menandai pesan pertama setiap hari", async () => {
    const { dayStartIndexes } = await import("@/lib/collab");
    const ms = ["2026-11-09T01:00:00Z", "2026-11-09T02:00:00Z", "2026-11-10T01:00:00Z"].map((createdAt) => ({ createdAt }));
    expect([...dayStartIndexes(ms)]).toEqual([0, 2]);
  });
});
