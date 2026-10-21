import { describe, expect, it } from "vitest";
import { buildMenuTree, DEFAULT_MENU, effectiveRoles, isMenuVisibleFor, validateMenuPatch, type MenuRow } from "@/lib/menu";

const item = (over: Partial<MenuRow>): MenuRow => ({ ...DEFAULT_MENU[0], ...over });

describe("visibilitas menu", () => {
  it("tidak pernah memberi role di atas kapabilitas, walau allowed_roles menyebutnya", () => {
    const users = item({ key: "users", requiredCapability: "users.manage", allowedRoles: ["super_admin", "manager", "staff"] });
    expect(effectiveRoles(users)).toEqual(["super_admin"]);
    expect(isMenuVisibleFor(users, "manager")).toBe(false);
    expect(isMenuVisibleFor(users, "staff")).toBe(false);
  });

  it("menu dinonaktifkan tidak tampil untuk siapa pun", () => {
    const orders = item({ key: "orders", isVisible: false });
    expect(isMenuVisibleFor(orders, "super_admin")).toBe(false);
  });

  it("pohon: anak hanya tampil bila induk tampil; role staff tidak melihat menu pengaturan", () => {
    const staffTree = buildMenuTree(DEFAULT_MENU, "staff").map((n) => n.key);
    expect(staffTree).toEqual(["dashboard", "orders", "workboard", "calendar"]);
    const adminTree = buildMenuTree(DEFAULT_MENU, "super_admin");
    const settings = adminTree.find((n) => n.key === "settings");
    expect(settings?.children.map((c) => c.key)).toEqual(["master", "website", "menu", "integrations", "google_drive"]);
    const hiddenParent = buildMenuTree(DEFAULT_MENU.map((i) => (i.key === "settings" ? { ...i, isVisible: false } : i)), "super_admin");
    expect(hiddenParent.find((n) => n.key === "master")).toBeUndefined();
  });
});

describe("validasi perubahan menu", () => {
  const users = DEFAULT_MENU.find((i) => i.key === "users")!;
  const orders = DEFAULT_MENU.find((i) => i.key === "orders")!;
  it("menolak menaikkan role di luar kapabilitas", () => {
    expect(validateMenuPatch(users, { allowedRoles: ["super_admin", "staff"] }, DEFAULT_MENU)).toMatch(/tidak memiliki izin/);
  });
  it("menolak menyembunyikan atau mencabut Super Admin dari menu inti", () => {
    expect(validateMenuPatch(users, { isVisible: false }, DEFAULT_MENU)).toMatch(/inti/);
    expect(validateMenuPatch(users, { allowedRoles: [] }, DEFAULT_MENU)).toMatch(/minimal satu/);
  });
  it("mengizinkan menu biasa diatur sesuai kapabilitasnya", () => {
    expect(validateMenuPatch(orders, { isVisible: false, label: "Order" }, DEFAULT_MENU)).toBeNull();
    expect(validateMenuPatch(orders, { allowedRoles: ["manager"] }, DEFAULT_MENU)).toBeNull();
  });
  it("submenu hanya satu tingkat dan tidak boleh menjadi induk diri sendiri", () => {
    const master = DEFAULT_MENU.find((i) => i.key === "master")!;
    expect(validateMenuPatch(master, { parentKey: "master" }, DEFAULT_MENU)).toMatch(/dirinya sendiri/);
    expect(validateMenuPatch(orders, { parentKey: "master" }, DEFAULT_MENU)).toMatch(/satu tingkat/);
  });
});

describe("Form Pengajuan", () => {
  it("bukan menu Super Admin; tetap tampil untuk Manager dan tidak untuk Staff", () => {
    const intake = DEFAULT_MENU.find((i) => i.key === "intake")!;
    expect(isMenuVisibleFor(intake, "super_admin")).toBe(false);
    expect(isMenuVisibleFor(intake, "manager")).toBe(true);
    expect(isMenuVisibleFor(intake, "staff")).toBe(false);
  });
  it("Super Admin tidak bisa mengembalikannya lewat pengaturan menu", () => {
    const intake = DEFAULT_MENU.find((i) => i.key === "intake")!;
    expect(validateMenuPatch(intake, { allowedRoles: ["super_admin", "manager"] }, DEFAULT_MENU)).toMatch(/Pengajuan/);
  });
});

