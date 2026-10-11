import { redirect } from "next/navigation";

/**
 * Middleware sends "/" to /home (or /login when signed out),
 * so this only renders if middleware is bypassed.
 */
export default function Home() {
  redirect("/login");
}
