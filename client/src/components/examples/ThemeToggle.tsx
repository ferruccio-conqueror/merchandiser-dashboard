import { ThemeToggle } from "../ThemeToggle";

export default function ThemeToggleExample() {
  return (
    <div className="p-8 flex items-center gap-4">
      <p className="text-sm">Toggle theme:</p>
      <ThemeToggle />
    </div>
  );
}
