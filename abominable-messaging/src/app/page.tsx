import { redirect } from "next/navigation";

/** The product has no marketing surface: go straight to the dashboard. */
export default function RootPage() {
  redirect("/dashboard");
}
