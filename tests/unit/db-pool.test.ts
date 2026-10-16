import { describe, expect, it } from "vitest";
import { poolMax } from "@/lib/server/pool-config";

describe("ukuran pool database per instance", () => {
  it("default 1 bila DB_POOL_MAX tidak diisi (aman untuk session pooler)", () => {
    expect(poolMax(undefined)).toBe(1);
    expect(poolMax("")).toBe(1);
  });
  it("nilai valid dipakai; dibatasi maksimum 10; nilai tak valid kembali ke 1", () => {
    expect(poolMax("3")).toBe(3);
    expect(poolMax("50")).toBe(10);
    expect(poolMax("0")).toBe(1);
    expect(poolMax("-4")).toBe(1);
    expect(poolMax("abc")).toBe(1);
  });
});
