import { redirect } from "next/navigation";

/** /dtic → dashboard (yang memeriksa sesi). */
export default function DticIndex() {
  redirect("/dtic/dashboard");
}
