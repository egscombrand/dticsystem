import { describe, expect, it } from "vitest";
import { parseTelegramLink } from "@/lib/telegram-link";

function ok(input: string) {
  const r = parseTelegramLink(input);
  if (!r.ok) throw new Error(`seharusnya valid: ${input} → ${r.code}`);
  return r.target;
}
function code(input: string) {
  const r = parseTelegramLink(input);
  if (r.ok) throw new Error(`seharusnya ditolak: ${input}`);
  return r.code;
}

describe("parser link Telegram", () => {
  it("link pesan grup privat menghasilkan kandidat -100 + ID internal", () => {
    const t = ok("https://t.me/c/2436417110/9467");
    expect(t).toEqual({
      kind: "private",
      internalId: "2436417110",
      messageId: "9467",
      topicCandidate: "9467",
      candidateChatId: "-1002436417110",
      sourceLink: "https://t.me/c/2436417110/9467",
    });
  });
  it("link username publik (grup) dan link pesan publik menghasilkan kandidat @username", () => {
    expect(ok("https://t.me/nama_grup")).toMatchObject({ kind: "public", username: "nama_grup", messageId: null, candidateChatRef: "@nama_grup" });
    expect(ok("https://t.me/nama_grup/9467")).toMatchObject({ kind: "public", messageId: "9467", candidateChatRef: "@nama_grup" });
  });
  it("link topik (t.me/c/ID/TOPIK) dan pesan di dalam topik (t.me/c/ID/TOPIK/PESAN) menghasilkan kandidat topik", () => {
    expect(ok("https://t.me/c/2436417110/52942")).toMatchObject({ topicCandidate: "52942", candidateChatId: "-1002436417110" });
    expect(ok("https://t.me/c/2436417110/52942/60001")).toMatchObject({ topicCandidate: "52942", messageId: "60001", sourceLink: "https://t.me/c/2436417110/52942/60001" });
  });
  it("link grup privat tanpa nomor pesan (t.me/c/ID) juga diterima", () => {
    expect(ok("https://t.me/c/5398414220")).toEqual({
      kind: "private",
      internalId: "5398414220",
      messageId: null,
      topicCandidate: null,
      candidateChatId: "-1005398414220",
      sourceLink: "https://t.me/c/5398414220",
    });
  });
  it("spasi di sekitar dan garis miring di akhir diabaikan dengan benar", () => {
    expect(ok("  https://t.me/c/2436417110/9467/  ")).toMatchObject({ kind: "private", candidateChatId: "-1002436417110" });
  });
  it("host tiruan, subdomain, dan host lain ditolak", () => {
    expect(code("https://t.me.evil.example/c/2436417110/9467")).toBe("unsupported_host");
    expect(code("https://evil.example/c/2436417110/9467")).toBe("unsupported_host");
    expect(code("https://telegram.me/nama_grup")).toBe("unsupported_host");
    expect(code("https://www.t.me/nama_grup")).toBe("unsupported_host");
  });
  it("skema berbahaya, HTTP biasa, dan kredensial URL ditolak", () => {
    expect(code("javascript:alert(1)")).toBe("insecure_scheme");
    expect(code("ftp://t.me/nama_grup")).toBe("insecure_scheme");
    expect(code("http://t.me/c/2436417110/9467")).toBe("insecure_scheme");
    expect(code("https://user:pass@t.me/c/2436417110/9467")).toBe("credentials");
    expect(code("https://user@t.me/nama_grup")).toBe("credentials");
  });
  it("port, query, dan fragment ditolak", () => {
    expect(code("https://t.me:8443/nama_grup")).toBe("unsupported_format");
    expect(code("https://t.me/nama_grup?start=abc")).toBe("unsupported_format");
    expect(code("https://t.me/c/2436417110/9467#x")).toBe("unsupported_format");
  });
  it("link undangan tidak didukung dengan pesan petunjuk", () => {
    expect(code("https://t.me/+AbCdEf123")).toBe("invite_link");
    expect(code("https://t.me/joinchat/AbCdEf123")).toBe("invite_link");
  });
  it("ID pesan tidak valid ditolak; ID nol atau berhuruf ditolak", () => {
    expect(code("https://t.me/c/2436417110/0")).toBe("invalid_message_id");
    expect(code("https://t.me/c/2436417110/abc")).toBe("invalid_message_id");
    expect(code("https://t.me/nama_grup/abc")).toBe("invalid_message_id");
  });
  it("format yang tidak dikenal, halaman utama, dan segmen berlebih ditolak", () => {
    expect(code("https://t.me/")).toBe("unsupported_format");
    expect(code("https://t.me/c/2436417110/9467/12/13")).toBe("unsupported_format");
    expect(code("https://t.me/nama_grup/9467/12/13")).toBe("unsupported_format");
    expect(code("https://t.me/c/2436417110/9467/extra")).toBe("invalid_message_id");
    expect(code("https://t.me/share/url")).toBe("unsupported_format");
    expect(code("https://t.me/ab")).toBe("unsupported_format");
    expect(code("https://t.me/%41bc")).toBe("unsupported_format");
  });
  it("kosong dan terlalu panjang ditolak", () => {
    expect(code("   ")).toBe("empty");
    expect(code("https://t.me/" + "a".repeat(400))).toBe("too_long");
  });
});
