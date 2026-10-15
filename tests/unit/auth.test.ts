import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password.mjs";
import { passwordPolicyError } from "@/lib/auth/policy.mjs";
import { can, CAPABILITIES, ROLES, isRole, assignableRoles } from "@/lib/auth/permissions";

describe("kebijakan & hash kata sandi", () => {
  it("menolak kata sandi yang lemah", () => {
    expect(passwordPolicyError("pendek1")).toMatch(/minimal 12/);
    expect(passwordPolicyError("hanya-huruf-saja")).toMatch(/huruf dan angka/);
    expect(passwordPolicyError("x".repeat(300) + "1")).toMatch(/maksimal/);
    expect(passwordPolicyError("KataSandiKuat2026")).toBeNull();
  });

  it("hash scrypt: format benar, salt acak, verifikasi benar/salah", async () => {
    const h1 = await hashPassword("KataSandiKuat2026");
    const h2 = await hashPassword("KataSandiKuat2026");
    expect(h1).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain("KataSandiKuat2026");
    expect(await verifyPassword("KataSandiKuat2026", h1)).toBe(true);
    expect(await verifyPassword("KataSandiSalah2026", h1)).toBe(false);
    expect(await verifyPassword("apa-saja", "bukan-hash")).toBe(false);
  });
});

describe("matriks hak akses", () => {
  it("Super Admin memiliki seluruh kapabilitas", () => {
    for (const cap of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
      expect(can("super_admin", cap), cap).toBe(true);
    }
  });

  it("Manager tidak dapat mengelola akun, master data, atau menghapus order; boleh mengelola PIC", () => {
    expect(can("manager", "users.manage")).toBe(false);
    expect(can("manager", "master.manage")).toBe(false);
    expect(can("manager", "orders.delete")).toBe(false);
    expect(can("manager", "orders.view_all")).toBe(true);
    expect(can("manager", "orders.manage_pic")).toBe(true);
    expect(can("manager", "members.view")).toBe(true);
  });

  it("Super Admin dan Manager dapat mengelola PIC; tidak ada role lain", () => {
    expect(can("super_admin", "orders.manage_pic")).toBe(true);
    expect(can("staff", "orders.manage_pic")).toBe(false);
  });

  it("Staff hanya dasar: tidak melihat semua order, tidak menugaskan, tidak mengelola apa pun", () => {
    expect(can("staff", "orders.view_all")).toBe(false);
    expect(can("staff", "orders.manage_pic")).toBe(false);
    expect(can("staff", "orders.update")).toBe(false);
    expect(can("staff", "orders.delete")).toBe(false);
    expect(can("staff", "users.manage")).toBe(false);
    expect(can("staff", "master.manage")).toBe(false);
    expect(can("staff", "orders.status")).toBe(true);
    expect(can("staff", "dashboard.view")).toBe(true);
  });

  it("hanya tiga role yang valid; Manager tidak dapat membuat Super Admin", () => {
    expect(ROLES).toEqual(["super_admin", "manager", "staff"]);
    expect(isRole("admin")).toBe(false);
    expect(isRole("super_admin")).toBe(true);
    expect(assignableRoles("manager")).toEqual([]);
    expect(assignableRoles("super_admin")).toContain("super_admin");
  });
});
