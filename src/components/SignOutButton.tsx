import { signOut } from "@/lib/auth";

export function SignOutButton({ label }: { label: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button className="text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline">{label}</button>
    </form>
  );
}
