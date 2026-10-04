import * as React from "react";
const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(" ");
type Variant = "primary" | "outline" | "ghost" | "danger";
const V: Record<Variant, string> = {
  primary: "bg-view text-on-view shadow-sm hover:opacity-90", outline: "border border-gray-400 bg-white hover:border-view hover:bg-view-soft", ghost: "hover:bg-view-soft", danger: "bg-red-600 text-white hover:opacity-90",
};
export function Button({ variant = "primary", size, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return <button className={cx("inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none", size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2", V[variant], className)} {...p} />;
}
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cx("rounded-lg border border-line bg-white p-4", className)} {...p} />;
const field = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-view";
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, p.className)} />;
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cx("mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500", className)} {...p} />;
const T: Record<string, string> = { green: "bg-green-100 text-green-800", blue: "bg-blue-100 text-blue-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", gray: "bg-gray-100 text-gray-700" };
export const Badge = ({ tone = "gray", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: string }) => <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-medium", T[tone], className)} {...p} />;
export const statusTone = (s: string) => (s === "VERIFIED" ? "green" : s === "SUPPORTED" ? "blue" : s === "INFERRED" ? "amber" : "red");
export const matchTone = (m: string) => (m === "exact" ? "green" : m === "equivalent" ? "blue" : m === "related" ? "amber" : m === "weak" ? "gray" : "red");
/** Meter colour band for a 0-100 value. */
export const band = (v: number) => (v >= 80 ? "hi" : v >= 65 ? "mid" : v >= 45 ? "lo" : "bad");
export { cx };
