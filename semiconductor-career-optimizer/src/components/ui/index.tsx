import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

const button = cva("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none px-3 py-2 gap-2", {
  variants: { variant: { primary: "bg-ink text-white hover:bg-black", outline: "border border-line bg-white hover:bg-gray-50", ghost: "hover:bg-gray-100", danger: "bg-red-600 text-white hover:bg-red-700" }, size: { sm: "px-2 py-1 text-xs", md: "" } },
  defaultVariants: { variant: "primary", size: "md" },
});
export function Button({ className, variant, size, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...p} />;
}
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border border-line bg-white p-4 shadow-sm", className)} {...p} />;
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, r) => <input ref={r} className={cn("w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30", className)} {...p} />);
Input.displayName = "Input";
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn("w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30", className)} {...p} />;
export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn("w-full rounded-md border border-line bg-white px-3 py-2 text-sm", className)} {...p} />;
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500", className)} {...p} />;

const TONES: Record<string, string> = {
  green: "bg-green-100 text-green-800", blue: "bg-blue-100 text-blue-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", gray: "bg-gray-100 text-gray-700",
};
export const Badge = ({ tone = "gray", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES }) => <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", TONES[tone], className)} {...p} />;

export const statusTone = (s: string) => (s === "VERIFIED" ? "green" : s === "SUPPORTED" ? "blue" : s === "INFERRED" ? "amber" : "red");
export const matchTone = (m: string) => (m === "exact" ? "green" : m === "equivalent" ? "blue" : m === "related" ? "amber" : m === "weak" ? "gray" : "red");
